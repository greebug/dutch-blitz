import { rng } from '../cards';
import { type Equity, equityAt } from './equity';
import { type ExpertParams, type ExpertPolicy, expert } from './expert';
import {
  BIG_GIN,
  KNOCK,
  type Policy,
  type Seen,
  type Table,
  bestThrow,
  clonePublic,
  deadwoodOf,
  drawStep,
  play,
  tableOver,
  throwStep,
} from './fast';
import {
  type Inference,
  createInference,
  holdsChanceOf,
  sampleTheirs,
  theyDraw,
  theyThrow,
  unseenCards,
  weDraw,
  weThrow,
} from './inference';

/**
 * The tournament player: inference, then search, then the match score.
 *
 * At every decision it does what a strong human does in their head, only a
 * few thousand times:
 *
 *  1. **Who has what.** The particle filter in `inference.ts` holds a cloud of
 *     guesses at the opponent's ten cards, each weighted by how well it
 *     explains everything they have done -- every upcard taken or passed,
 *     every discard. It only ever sees the public record and our own hand.
 *  2. **What happens next.** Draw a guess from the cloud, shuffle everything
 *     still unseen into a stock, and play the rest of the hand out with the
 *     tuned expert in both chairs -- once for each move under consideration,
 *     on the same guess and the same stock, so the moves are compared on
 *     identical cards.
 *  3. **What it is worth.** Each finished rollout is scored in match equity,
 *     the chance of winning the whole match from the score it leaves, not in
 *     points. That is what makes it knock on 8 when it is on 95 and cling to
 *     the hand when the opponent is.
 *
 * Opportunity cost falls out of this rather than being bolted on: a hand
 * chasing a buried card loses its rollouts, because in every sampled world
 * that card never arrives; a card the cloud is sure they hold arrives for
 * them, not for us.
 */
export interface ChampionOptions {
  /** Worlds per decision. */
  worlds: number;
  /** How many discards to search, from the expert's ranking. */
  width: number;
  particles: number;
  /** How both sides play inside the rollouts. */
  rollout: ExpertParams;
  /** Score in match equity when set; in points when not. */
  equity?: Equity | null;
  seed?: number;
  name?: string;
  /**
   * How sure the search must be before overruling the expert, in standard
   * errors of the paired difference. The expert's move is the default; noise
   * in the rollouts should not be allowed to talk the player out of it.
   */
  confidence?: number;
  /**
   * Ablation switch: ignore the particle filter and guess their hand
   * uniformly, keeping only the cards we watched them take. For measuring
   * what the inference is worth, never for play.
   */
  uniform?: boolean;
  /**
   * Told about every searched decision: the candidates (for a draw, 1 = take
   * the upcard and 0 = draw blind; for a throw, the move codes), each one's
   * value relative to the first, and which was chosen. For review tools.
   */
  /**
   * Review mode: the moves actually played at this seat. When set, the search
   * still answers with its own choice, but its notes on the hand follow what
   * really happened, so it can shadow somebody else's game.
   */
  actual?: { draw: () => boolean | null; throw: () => number | null };
  /** For review tools: one more throw to evaluate alongside the shortlist. */
  consider?: () => number | null;
  /**
   * Review mode: when the move actually played differs from the search's
   * choice, replay just those two on this many FRESH worlds. Picking the best
   * of several noisy candidates flatters the winner; a second, independent
   * sample of the two moves is what an honest "this cost you N points" needs.
   */
  check?: number;
  explain?: (info: Explanation) => void;
  /**
   * Diagnostics: who plays the rollouts out, ours first, instead of the
   * expert in both chairs. Called per rollout. For testing a verdict against
   * a stronger continuation; far too slow for play.
   */
  rollers?: () => [Policy, Policy];
  /** Diagnostics: every finished rollout, with which candidate it was and in which phase. */
  onRollout?: (phase: 'search' | 'check', candidate: number, table: Table) => void;
}

export interface Explanation {
  kind: 'draw' | 'throw';
  /** For a draw, 1 = take the upcard and 0 = draw blind; for a throw, move codes. */
  moves: number[];
  /** Each candidate's mean value relative to the first. */
  values: number[];
  chosen: number;
  /** Per-candidate value in each sampled world (same worlds for every candidate). */
  samples: number[][];
  /**
   * The independent replay of [chosen, actually played], when `check` asked
   * for one. `takes`, for a throw: the share of worlds in which the opponent
   * (as the rollouts model them) would pick the thrown card straight up.
   */
  check?: { moves: [number, number]; samples: [number[], number[]]; takes?: [number, number] };
  /** Review mode: the chance, per card index, that the opponent holds it, from the inference. */
  holds?: number[];
}

function holdsAll(live: Inference): number[] {
  return Array.from({ length: 40 }, (_, c) => holdsChanceOf(live, c));
}

export function champion(options: ChampionOptions): Policy {
  const next = rng(options.seed ?? 12345);
  const me = expert(options.rollout, next, 'roll-me');
  const them = expert(options.rollout, next, 'roll-them');
  const guide = expert(options.rollout, next, 'guide');
  let inf: Inference | null = null;
  let seat: 0 | 1 = 0;
  /** The upcard when the opponent's turn began. */
  let theirTop = -1;
  /** pub.turns once our last throw has landed; their turn is the one after. */
  let synced = 0;
  let tookTop = -1;

  function start(seen: Seen): Inference {
    seat = seen.seat;
    const pub = seen.pub;
    const top = pub.pile.length ? pub.pile[pub.pile.length - 1] : -1;
    inf = createInference(seen.hand, top, pub.stockCount, next, options.particles);
    theirTop = top;
    synced = 0;
    tookTop = -1;
    return inf;
  }

  /** Fold in the opponent's turn, if there has been one since ours. */
  function sync(seen: Seen): Inference {
    const live = inf ?? start(seen);
    const pub = seen.pub;
    if (pub.turns > synced) {
      const they = seat === 0 ? 1 : 0;
      const took = theirTop >= 0 && pub.taken[they][theirTop] === 1;
      theyDraw(live, took);
      theyThrow(live, pub.pile[pub.pile.length - 1]);
      synced = pub.turns;
    }
    return live;
  }

  /** One sampled world, or null if the guess does not fit the table. */
  function world(seen: Seen, live: Inference): { theirs: number[]; stock: number[] } | null {
    const theirs = options.uniform ? uniformGuess(live) : sampleTheirs(live);
    const held = new Uint8Array(40);
    for (const c of theirs) held[c] = 1;
    const pool = unseenCards(live).filter((c) => !held[c]);
    if (theirs.length !== 10 || pool.length !== seen.pub.stockCount) return null;
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const x = pool[i];
      pool[i] = pool[j];
      pool[j] = x;
    }
    return { theirs, stock: pool };
  }

  function uniformGuess(live: Inference): number[] {
    const out: number[] = [];
    for (let c = 0; c < 40; c++) if (live.known[c]) out.push(c);
    const rest = unseenCards(live).filter((c) => !live.known[c]);
    while (out.length < 10 && rest.length) out.push(rest.splice(Math.floor(next() * rest.length), 1)[0]);
    return out;
  }

  function tableFor(seen: Seen, theirs: number[], stock: number[]): Table {
    const pub = clonePublic(seen.pub);
    const mine = seen.hand.slice();
    return seat === 0 ? tableOver(pub, mine, theirs, stock) : tableOver(pub, theirs, mine, stock);
  }

  function value(t: Table, pubScores: [number, number]): number {
    const margin = seat === 0 ? t.margin : -t.margin;
    if (!options.equity) return margin;
    const they = seat === 0 ? 1 : 0;
    const a = pubScores[seat] + Math.max(0, margin);
    const b = pubScores[they] + Math.max(0, -margin);
    // Opening alternates: seat 0 opened this hand, so seat 1 opens the next.
    return equityAt(options.equity, a, b, seat === 1);
  }

  function rollout(t: Table): void {
    const [a, b] = options.rollers?.() ?? [me, them];
    a.begin!(t.seen[seat]);
    b.begin!(t.seen[seat === 0 ? 1 : 0]);
    if (!t.over) play(t, seat === 0 ? [a, b] : [b, a]);
  }

  /**
   * Pick a candidate. Candidate 0 is the expert's own move; any other has to
   * beat it, on the same worlds, by more than `confidence` standard errors
   * of the paired difference.
   */
  /** Every candidate played out on the same `worlds` sampled worlds: samples[k][w]. */
  function sample(
    seen: Seen,
    live: Inference,
    count: number,
    apply: (t: Table, k: number) => void,
    worlds: number,
    phase: 'search' | 'check' = 'search'
  ): number[][] {
    const out: number[][] = Array.from({ length: count }, () => []);
    const scores: [number, number] = [seen.pub.scores[0], seen.pub.scores[1]];
    for (let w = 0, tries = 0; w < worlds && tries < worlds * 3; tries++) {
      const guess = world(seen, live);
      if (!guess) continue;
      w++;
      for (let k = 0; k < count; k++) {
        const t = tableFor(seen, guess.theirs, guess.stock);
        apply(t, k);
        if (phase === 'check' && !t.over && t.pub.turn !== seat && t.pub.pile.length) {
          // Would they take what we just threw? Asked of the rollout opponent
          // before the rollout begins (begin() resets it again afterwards).
          const theirs = t.seen[seat === 0 ? 1 : 0];
          them.begin!(theirs);
          if (them.draw(theirs)) lastTakes[k]++;
        }
        rollout(t);
        out[k].push(value(t, scores));
        options.onRollout?.(phase, k, t);
      }
    }
    return out;
  }

  function choose(seen: Seen, live: Inference, count: number, apply: (t: Table, k: number) => void): number {
    const samples = sample(seen, live, count, apply, options.worlds);
    lastSamples = samples;
    const n = samples[0].length;
    const diff = new Float64Array(count);
    const diff2 = new Float64Array(count);
    for (let w = 0; w < n; w++) {
      for (let k = 1; k < count; k++) {
        const d = samples[k][w] - samples[0][w];
        diff[k] += d;
        diff2[k] += d * d;
      }
    }
    lastMeans = Array.from({ length: count }, (_, k) => (k === 0 || !n ? 0 : diff[k] / n));
    if (n < 2) return 0;
    const z = options.confidence ?? 1.5;
    let best = 0;
    let bestMean = 0;
    for (let k = 1; k < count; k++) {
      const m = diff[k] / n;
      const se = Math.sqrt(Math.max(0, diff2[k] / n - m * m) / (n - 1));
      if (m > bestMean && m > z * se) {
        best = k;
        bestMean = m;
      }
    }
    return best;
  }

  /** Each candidate's value relative to the expert's move, from the last search. */
  let lastMeans: number[] = [];
  let lastSamples: number[][] = [];
  let lastTakes: number[] = [0, 0];

  /** Review mode: the independent replay of the chosen move against the one actually played. */
  function checked(
    seen: Seen,
    live: Inference,
    moves: number[],
    chosen: number,
    played: number | null | undefined,
    apply: (t: Table, k: number) => void
  ): Explanation['check'] {
    if (!options.check || played === null || played === undefined) return undefined;
    const k = moves.indexOf(played);
    if (k < 0 || k === chosen) return undefined;
    const pair = [chosen, k];
    lastTakes = [0, 0];
    const s = sample(seen, live, 2, (t, i) => apply(t, pair[i]), options.check, 'check');
    const n = Math.max(1, s[0].length);
    return {
      moves: [moves[chosen], played],
      samples: [s[0], s[1]],
      takes: [lastTakes[0] / n, lastTakes[1] / n],
    };
  }

  return {
    name: options.name ?? 'champion',
    begin(seen) {
      start(seen);
    },
    draw(seen) {
      const live = sync(seen);
      const pub = seen.pub;
      const top = pub.pile[pub.pile.length - 1];
      tookTop = -1;
      guide.begin!(seen);
      const usual = guide.draw(seen);
      const options2 = [usual, !usual];
      const apply = (t: Table, k: number) => {
        drawStep(t, options2[k]);
        // Finish our own turn the way the expert would, then hand over.
        const mine = t.seen[seat];
        me.begin!(mine);
        if (options2[k]) me.took(top);
        throwStep(t, me.throw(mine));
      };
      const pick = choose(seen, live, 2, apply);
      const actually = options.actual?.draw() ?? null;
      if (options.explain) {
        const moves = options2.map(Number);
        const samples = lastSamples;
        const values = lastMeans;
        const check = checked(seen, live, moves, pick, actually === null ? null : Number(actually), apply);
        options.explain({ kind: 'draw', moves, values, chosen: pick, samples, check, holds: holdsAll(live) });
      }
      const take = options2[pick];
      // In review, the move that really happened is what goes in the notes.
      const did = actually ?? take;
      if (did) tookTop = top;
      return take;
    },
    throw(seen) {
      const live = sync(seen);
      // Our draw, as far as the filter is concerned.
      if (tookTop >= 0) weDraw(live, tookTop, true);
      else {
        const fresh = seen.hand.find((c) => !((live.mine[(c / 10) | 0] >> c % 10) & 1));
        if (fresh !== undefined) weDraw(live, fresh, false);
      }

      let move: number;
      const knock = bestThrow(seen.hand, seen.masks);
      // Gin is never worth searching, except in review when somebody passed it up.
      const forced = deadwoodOf(seen.masks) === 0 ? BIG_GIN : knock.left === 0 ? KNOCK + knock.card : null;
      const played = forced !== null ? options.consider?.() : null;
      if (forced !== null && (played === null || played === undefined || played === forced)) move = forced;
      else if (forced !== null) {
        const moves = [forced, played!];
        const apply = (t: Table, k: number) => throwStep(t, moves[k]);
        const pick = choose(seen, live, 2, apply);
        const samples = lastSamples;
        const values = lastMeans;
        const check = checked(seen, live, moves, pick, played, apply);
        options.explain?.({ kind: 'throw', moves, values, chosen: pick, samples, check, holds: holdsAll(live) });
        move = forced;
      } else {
        {
          guide.begin!(seen);
          if (tookTop >= 0) guide.took(tookTop);
          // The expert's own move first, then its next best discards, then
          // the knock if it did not already choose it.
          const moves = [guide.throw(seen)];
          for (const r of guide.rank(seen).slice(0, options.width)) if (!moves.includes(r.card)) moves.push(r.card);
          if (knock.left <= seen.pub.rules.knockMaxDeadwood && !moves.includes(KNOCK + knock.card)) {
            moves.push(KNOCK + knock.card);
          }
          const extra = options.consider?.();
          if (extra !== undefined && extra !== null && !moves.includes(extra)) moves.push(extra);
          if (moves.length === 1) move = moves[0];
          else {
            const apply = (t: Table, k: number) => throwStep(t, moves[k]);
            const pick = choose(seen, live, moves.length, apply);
            if (options.explain) {
              const samples = lastSamples;
              const values = lastMeans;
              const check = checked(seen, live, moves, pick, extra, apply);
              options.explain({ kind: 'throw', moves, values, chosen: pick, samples, check, holds: holdsAll(live) });
            }
            move = moves[pick];
          }
        }
      }

      const done = options.actual?.throw() ?? move;
      if (done !== BIG_GIN && done < KNOCK) {
        weThrow(live, done);
        theirTop = done;
        synced = seen.pub.turns + 1;
      }
      tookTop = -1;
      return move;
    },
  };
}
