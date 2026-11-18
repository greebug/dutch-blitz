import { type Card, cardFromIndex, cardIndex, describe } from '../cards';
import { type GinAction, type Seat, apply, deal, viewFor } from '../game';
import { analyzeHand as meldsOf } from '../melds';
import { advancePublic, seated } from './adapter';
import { type Ends, type Explanation, champion } from './champion';
import { type ExpertParams, expert, liveOuts } from './expert';
import { makePolicy } from './panel';
import { rng } from '../cards';
import { type Equity, buildEquity, equityAt } from './equity';
import margins from './champions/margins.json';
import { BIG_GIN, KNOCK, POINTS, type Policy, type Public, blankPublic, deadwoodOf, deadwoodWithout, masksOf } from './fast';

/**
 * Hand analysis for a person: every decision they made, what the champion
 * would have done from the same chair, what the difference was worth, and --
 * where the cards make it plain -- why.
 *
 * How a verdict is reached, decision by decision:
 *
 *  1. The champion shadows the person's seat, seeing exactly what they saw
 *     (their cards and the public record; never the opponent's hand) and
 *     keeping its notes on what really happened, not on what it would have
 *     done.
 *  2. Its search plays every candidate out in a few hundred sampled worlds --
 *     guesses at the opponent's hand drawn from its inference, the rest
 *     shuffled into a stock -- and picks the best on average, in points.
 *  3. If that is not what the person did, the two moves are replayed on fresh
 *     worlds. Best-of-several on one sample flatters the winner, so the
 *     reported cost comes from the second, independent sample, with its
 *     standard error; a gap the noise could explain is called a close call,
 *     not a mistake.
 *
 * The "why" is a separate, plainer layer: facts from the public record and
 * the hand -- a pickup the discard feeds, outs that are already buried, a
 * knock that gets undercut in N% of the worlds -- kept only when they point
 * the same way as the verdict. The search is the judge; these are the
 * reasons a person can check with their own eyes.
 */

export interface HandForAnalysis {
  seed: number;
  /** The person's seat. Seat 0 opens. */
  humanSeat: Seat;
  history: GinAction[];
  /**
   * Who sat across. The bot is modelled by the rollout expert, which is what
   * Medium and Hard play, grabbing low upcards to shed high cards included. A
   * person takes the upcard almost only to complete a meld (54 of 56 pickups
   * in the logged games), so a two-player hand is played out against a model
   * that does just that. Bot by default.
   */
  opponent?: 'bot' | 'human';
  /**
   * The match score going into this hand, when the hand was part of a match
   * with a target. Then every decision is judged on the chance of winning the
   * MATCH, as the Hard bot plays it: at 86-46 in a match to 100, a sure small
   * knock that ends the match beats chasing a bigger gin, though the gin
   * scores more on average. Without it, decisions are judged in points.
   */
  match?: { you: number; them: number; target: number };
}

export type Verdict = 'best' | 'close' | 'inaccuracy' | 'mistake' | 'blunder' | 'forced';

export interface Choice {
  /** Draw: 1 take the upcard, 0 draw blind. Throw: card index, KNOCK + card, or BIG_GIN. */
  code: number;
  text: string;
  /** The card the move puts down (or picks up), for highlighting. */
  card: Card | null;
}

export interface Odds {
  /** Share of sampled worlds in which the hand was won, lost. */
  win: number;
  lose: number;
  /** Average points to the person per hand. */
  mean: number;
}

export interface Moment {
  /** Position in the hand's action log. */
  index: number;
  /** The person's turn number in this hand, from 1. */
  turn: number;
  kind: 'draw' | 'throw';
  /** What the person held as they decided (11 cards on a throw). */
  hand: Card[];
  upcard: Card | null;
  stockCount: number;
  yours: Choice;
  best: Choice;
  verdict: Verdict;
  /** Points per hand the person's move gave up, from the independent replay. */
  cost: number;
  se: number;
  /** Worlds behind `cost`. */
  worlds: number;
  odds?: { yours: Odds; best: Odds };
  /**
   * Judged on the match: the chance of winning it after each move, and the
   * score it was judged at. `cost` is then that gap in points at this score.
   */
  match?: { you: number; them: number; target: number; yours: number; best: number };
  why: string[];
}

export interface AnalysisOptions {
  rollout: ExpertParams;
  /** Worlds for the search over every candidate. */
  worlds?: number;
  /** Fresh worlds for the head-to-head of the person's move and the best one. */
  check?: number;
  particles?: number;
  width?: number;
  /** Randomness for the search and the inference; the deal's seed by default. */
  seed?: number;
  /**
   * Our side of the play-outs uses the inference for discard danger
   * (ChampionOptions.readRollouts). On by default: without it a move can be
   * charged for a later throw into a meld the champion already knows they
   * hold, which the person would not make. Measured neutral for the bot's own
   * strength (+0.07 +/- 0.07 points per hand over 30,000 hands), so Hard
   * itself is unchanged; it is the review that needed it.
   */
  readRollouts?: boolean;
}

export interface Progress {
  done: number;
  total: number;
  moment?: Moment;
}

/** Points per hand below which a difference is not worth calling a mistake. */
const CLOSE = 0.75;
/** At or below this, the replay found the two moves equal (or yours better). */
const TIE = 0.1;
/**
 * Standard errors a gap must clear to be called an error. Above two because
 * the error bar only counts the sampled worlds: the inference behind them is
 * itself a random cloud, and a review that cries wolf teaches nothing.
 */
const SIGNIFICANT = 2.5;
/**
 * Noise the replay's own error bar does not see, in points: reviewing the
 * same decision under ten different seeds moved the verdict by 0.4-0.8 points
 * between runs (deepreview.run.ts, seven disputed live positions), against
 * reported error bars of 0.3-0.5. The difference is the inference -- each run
 * samples the opponent's hand from its own random cloud. Added in quadrature,
 * so a gap must clear both before it is called an error.
 */
const MODEL_NOISE = 0.45;
const INACCURACY = 2;
const MISTAKE = 5;

/** Whose entry `index` of the log is: two entries a turn, seat 0 first. */
function seatAt(index: number): Seat {
  return (Math.floor(index / 2) % 2) as Seat;
}

function code(action: GinAction): number | null {
  if (action.type === 'draw') return action.from === 'discard' ? 1 : 0;
  if (action.type === 'discard') return cardIndex(action.card);
  if (action.type === 'knock') return KNOCK + cardIndex(action.discard);
  if (action.type === 'big-gin') return BIG_GIN;
  return null;
}

const the = (c: number) => `the ${describe(cardFromIndex(c))}`;

function list(items: string[], joiner = 'and'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${joiner} ${items[items.length - 1]}`;
}

const pct = (x: number) => `${Math.round(100 * x)}%`;
const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;

function choice(kind: 'draw' | 'throw', c: number, upcard: number): Choice {
  if (kind === 'draw') {
    return c
      ? { code: c, text: `take ${the(upcard)}`, card: cardFromIndex(upcard) }
      : { code: c, text: 'draw from the stock', card: null };
  }
  if (c === BIG_GIN) return { code: c, text: 'lay down big gin', card: null };
  if (c >= KNOCK) return { code: c, text: `knock, throwing ${the(c - KNOCK)}`, card: cardFromIndex(c - KNOCK) };
  return { code: c, text: `throw ${the(c)}`, card: cardFromIndex(c) };
}

function odds(values: number[]): Odds {
  const n = Math.max(1, values.length);
  let win = 0;
  let lose = 0;
  let sum = 0;
  for (const v of values) {
    if (v > 0) win++;
    else if (v < 0) lose++;
    sum += v;
  }
  return { win: win / n, lose: lose / n, mean: sum / n };
}

/** Mean and standard error of a - b, world by world. */
function paired(a: number[], b: number[]): { mean: number; se: number; n: number } {
  const n = Math.min(a.length, b.length);
  if (n < 2) return { mean: 0, se: Infinity, n };
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    s += d;
    s2 += d * d;
  }
  const mean = s / n;
  return { mean, se: Math.sqrt(Math.max(0, s2 / n - mean * mean) / (n - 1)), n };
}

// ---------------------------------------------------------------------------
// The reasons layer.

/** What the person could see when deciding. */
interface Scene {
  hand: number[];
  masks: Int32Array;
  pub: Public;
  them: Seat;
  /** Cards they took off the pile and still hold, with the log index of the pickup. */
  pickups: Map<number, number>;
  /** Log index of the decision. */
  at: number;
  upcard: number;
  /** Chance per card that they hold it, from the champion's inference. */
  holds?: number[];
  /** Share of worlds in which they would take [the best throw, yours] straight up. */
  takes?: [number, number];
  /** How the play-outs ended for [the best throw, yours]. */
  ends?: [Ends, Ends];
}

function when(scene: Scene, pickedAt: number): string {
  // Their draws after the pickup, before now.
  let later = 0;
  for (let j = pickedAt + 1; j < scene.at; j++) if (j % 2 === 0 && seatAt(j) === scene.them) later++;
  return later === 0 ? 'on their last turn' : `${later + 1} turns ago`;
}

/** 0 dead to everyone (pile or our hand), 1 unseen, 2 known to be theirs. */
function statusOf(scene: Scene, except: number): Uint8Array {
  const st = new Uint8Array(40).fill(1);
  for (const c of scene.hand) st[c] = 0;
  for (const c of scene.pub.pile) st[c] = 0;
  for (const c of scene.pickups.keys()) st[c] = 2;
  st[except] = 0;
  return st;
}

/** The two-card partner pairs that would make a meld with `card`: two of its rank, or a suit window. */
function partnerPairs(card: number): [number, number][] {
  const s = (card / 10) | 0;
  const r = card % 10;
  const others: number[] = [];
  for (let t = 0; t < 4; t++) if (t !== s) others.push(t * 10 + r);
  const out: [number, number][] = [
    [others[0], others[1]],
    [others[0], others[2]],
    [others[1], others[2]],
  ];
  const b = s * 10;
  if (r >= 2) out.push([b + r - 2, b + r - 1]);
  if (r >= 1 && r <= 8) out.push([b + r - 1, b + r + 1]);
  if (r <= 7) out.push([b + r + 1, b + r + 2]);
  return out;
}

/** How a throw of `card` reads against their pickups: the cards of theirs it would join. */
function feeds(scene: Scene, card: number): { cards: number[]; complete: boolean; needs: number[] } {
  const st = statusOf(scene, card);
  const cards = new Set<number>();
  /** For a half-made meld: the unseen cards that would still finish it. */
  const needs = new Set<number>();
  let complete = false;
  for (const [a, b] of partnerPairs(card)) {
    if (st[a] === 0 || st[b] === 0) continue;
    if (st[a] === 2 && st[b] === 2) complete = true;
    if (st[a] === 2) cards.add(a);
    if (st[b] === 2) cards.add(b);
    if (st[a] === 2 && st[b] === 1) needs.add(b);
    if (st[b] === 2 && st[a] === 1) needs.add(a);
  }
  return { cards: [...cards], complete, needs: [...needs] };
}

/** True when every pair that could meld with `card` is already broken. */
function deadToThem(scene: Scene, card: number): boolean {
  const st = statusOf(scene, card);
  return partnerPairs(card).every(([a, b]) => st[a] === 0 || st[b] === 0);
}

/** Cards near `card` they threw or passed over: signs they are not collecting there. */
function cold(scene: Scene, card: number): { thrown: number[]; passed: number[] } {
  const thrown: number[] = [];
  const passed: number[] = [];
  const s = (card / 10) | 0;
  const r = card % 10;
  const near: number[] = [];
  for (let t = 0; t < 4; t++) if (t !== s) near.push(t * 10 + r);
  if (r >= 1) near.push(s * 10 + r - 1);
  if (r <= 8) near.push(s * 10 + r + 1);
  for (const c of near) {
    if (scene.pub.thrown[scene.them][c]) thrown.push(c);
    else if (scene.pub.passed[scene.them][c]) passed.push(c);
  }
  if (scene.pub.passed[scene.them][card]) passed.push(card);
  return { thrown, passed };
}

/** Unseen cards: not ours, not in the pile, not watched into their hand. */
function unseen(scene: Scene, hand: number[]): Uint8Array {
  const live = new Uint8Array(40).fill(1);
  for (const c of hand) live[c] = 0;
  for (const c of scene.pub.pile) live[c] = 0;
  for (const c of scene.pickups.keys()) live[c] = 0;
  return live;
}

function without(masks: Int32Array, c: number): Int32Array {
  const m = Int32Array.from(masks);
  m[(c / 10) | 0] &= ~(1 << c % 10);
  return m;
}

function withCard(masks: Int32Array, c: number): Int32Array {
  const m = Int32Array.from(masks);
  m[(c / 10) | 0] |= 1 << c % 10;
  return m;
}

/**
 * The combinations `card` belongs to in `hand`, and the cards that would
 * finish them: a pair of its rank wants a third, two in suit want the ends
 * or the gap.
 */
function combos(hand: number[], card: number): { partner: number; needs: number[] }[] {
  const held = new Uint8Array(40);
  for (const c of hand) held[c] = 1;
  const s = (card / 10) | 0;
  const r = card % 10;
  const out: { partner: number; needs: number[] }[] = [];
  for (let t = 0; t < 4; t++) {
    const p = t * 10 + r;
    if (t === s || !held[p]) continue;
    const needs: number[] = [];
    for (let u = 0; u < 4; u++) if (u !== s && u !== t && !held[u * 10 + r]) needs.push(u * 10 + r);
    out.push({ partner: p, needs });
  }
  const b = s * 10;
  for (const d of [-2, -1, 1, 2]) {
    const q = r + d;
    if (q < 0 || q > 9 || !held[b + q]) continue;
    const lo = Math.min(r, q);
    const hi = Math.max(r, q);
    const needs = hi - lo === 2 ? [b + lo + 1] : [lo - 1, hi + 1].filter((x) => x >= 0 && x <= 9).map((x) => b + x);
    out.push({ partner: b + q, needs: needs.filter((n) => !held[n]) });
  }
  return out;
}

/**
 * When nothing on the table explains a throw, say what the play-outs saw.
 *
 * These are not reasons in the sense the others are -- no single card -- but
 * they are what the verdict actually rests on, and a person can weigh them:
 * whether the card thrown is one they would want, and how the hand tends to
 * end either way. Only differences big enough to matter are mentioned.
 */
function playoutReasons(scene: Scene, x: number, y: number): string[] {
  const out: string[] = [];
  const keepX = `keeping ${the(x)}`;
  if (scene.takes) {
    const [tBest, tYours] = scene.takes;
    if (tYours - tBest >= 0.06) {
      out.push(
        `${cap(the(x))} is more use to them: in the hands they could be holding, they would pick it up straight away ` +
          `${pct(tYours)} of the time, against ${pct(tBest)} for ${the(y)}.`
      );
    }
  }
  const ends = scene.ends;
  if (ends) {
    const [best, yours] = ends;
    const gin = best.gin - yours.gin;
    if (gin >= 0.04) {
      out.push(`${cap(keepX)}, you went gin in ${pct(best.gin)} of the play-outs; throwing it, only ${pct(yours.gin)}.`);
    }
    const theirsBest = best.theyKnock + best.theyGin;
    const theirsYours = yours.theyKnock + yours.theyGin;
    if (theirsYours - theirsBest >= 0.03) {
      out.push(
        `They got down first in ${pct(theirsYours)} of the play-outs after you threw ${the(x)}, ` +
          `against ${pct(theirsBest)} after ${the(y)}.`
      );
    }
    const undercut = yours.undercut - best.undercut;
    if (undercut >= 0.03) {
      out.push(`Your knocks got undercut in ${pct(yours.undercut)} of the play-outs your way, against ${pct(best.undercut)}.`);
    }
    if (!out.length) {
      const winsBest = best.gin + best.knock + best.weUndercut;
      const winsYours = yours.gin + yours.knock + yours.weUndercut;
      if (winsBest - winsYours >= 0.02) {
        out.push(`${cap(keepX)} won ${pct(winsBest)} of the play-outs, against ${pct(winsYours)} throwing it.`);
      }
    }
  }
  return out;
}

/**
 * A card they picked up that our hand has since made nearly useless to them,
 * and that the card we are keeping could use: they are likely to throw it
 * back, and then it is ours. The mirror image of feeding a pickup -- and when
 * both are true, this is usually the one that matters (a live match had them
 * throw the King back in 91% of the play-outs, finishing our set 85% of the
 * time).
 */
function comeback(scene: Scene, keep: number, thrown: number): { pickup: number; blockers: number[] } | null {
  const kept = without(scene.masks, thrown);
  for (const p of scene.pickups.keys()) {
    if (!partnerPairs(keep).some(([a, b]) => a === p || b === p)) continue;
    // Their ways to meld it: pairs whose partners are neither ours nor in the pile.
    const st = statusOf(scene, p);
    const pairs = partnerPairs(p);
    if (pairs.filter(([a, b]) => st[a] !== 0 && st[b] !== 0).length > 1) continue;
    // And it would meld for us, with the card kept.
    const withP = withCard(kept, p);
    if (deadwoodOf(withP) >= deadwoodOf(kept) + POINTS[p]) continue;
    const blockers = [...new Set(pairs.flat().filter((c) => scene.hand.includes(c) && c !== thrown))];
    return { pickup: p, blockers };
  }
  return null;
}

function whyThrow(scene: Scene, mine: number, best: number, check: Moment['odds'], their: string): string[] {
  const out: string[] = [];
  const knocking = best >= KNOCK || best === BIG_GIN;
  const iKnocked = mine >= KNOCK || mine === BIG_GIN;
  const pickups = scene.pickups.size;

  if (best === BIG_GIN || (best >= KNOCK && deadwoodWithout(scene.masks, best - KNOCK) === 0)) {
    out.push('Every card was melded: gin scores their whole deadwood plus the bonus, and it cannot be undercut.');
    return out;
  }

  if (knocking && !iKnocked && check) {
    const left = deadwoodWithout(scene.masks, best - KNOCK);
    const grim = check.best.mean < 0 && check.yours.mean < 0;
    out.push(
      `${grim ? 'Neither option was good, but knocking lost less: k' : 'K'}nocking on ${left} won the hand in ` +
        `${pct(check.best.win)} of the hands they could have been holding ` +
        `(${signed(check.best.mean)} points on average); playing on came out at ${signed(check.yours.mean)}.`
    );
    if (pickups >= 2) out.push(`They had taken ${pickups} cards from the pile, so they were building toward a knock of their own.`);
    if (scene.pub.stockCount <= 8) out.push(`Only ${scene.pub.stockCount} cards were left in the stock, so there was little time left to improve.`);
    return out;
  }

  if (iKnocked && !knocking && check) {
    const left = mine === BIG_GIN ? 0 : deadwoodWithout(scene.masks, mine - KNOCK);
    if (check.yours.lose < 0.15) {
      // Safe knock; the case against it is what waiting earns.
      out.push(
        `Knocking on ${left} was safe (undercut in only ${pct(check.yours.lose)} of the hands they could have been holding), ` +
          `but playing on was worth more: ${signed(check.best.mean)} points on average against ${signed(check.yours.mean)}.`
      );
      if (left <= 3) out.push(`With ${left} deadwood you were one card from gin, and gin pays a bonus and cannot be undercut.`);
      else if (pickups === 0) out.push(`They hadn't taken anything from the pile, so they were unlikely to be close to knocking.`);
      return out;
    }
    out.push(
      `Knocking on ${left} got undercut in ${pct(check.yours.lose)} of the hands they could have been holding ` +
        `(${signed(check.yours.mean)} points on average); playing on came out at ${signed(check.best.mean)}.`
    );
    if (pickups >= 2) out.push(`They had taken ${pickups} cards from the pile, so their hand was likely close to done.`);
    else if (scene.pub.stockCount >= 14) out.push('It was early, with plenty of stock left to get lower before knocking.');
    return out;
  }

  const x = mine >= KNOCK ? mine - KNOCK : mine;
  const y = best >= KNOCK ? best - KNOCK : best;
  if (x === y || x < 0 || y < 0) return out;

  // 0. A pickup of theirs that is stuck, and that the card you threw would have used.
  const back = comeback(scene, x, y);
  if (back) {
    const by = back.blockers.length ? ` with ${list(back.blockers.map(the))} in your hand` : '';
    out.push(
      `They picked up ${the(back.pickup)}, but${by} it has almost nothing left to meld with for them, ` +
        `so they are likely to throw it back — and keeping ${the(x)} is what lets you use it when they do.`
    );
  }

  // 1. Feeding their pickups.
  const fx = feeds(scene, x);
  const fy = feeds(scene, y);
  if (!back && fx.cards.length && (fx.cards.length > fy.cards.length || (fx.complete && !fy.complete))) {
    const what = fx.cards.map((c) => `${the(c)} ${when(scene, scene.pickups.get(c)!)}`);
    out.push(
      `They picked up ${list(what)}; ${the(x)} ${fx.complete ? 'completes a meld with' : 'fits with'} ` +
        `${fx.cards.length > 1 ? 'those' : 'it'}${
          fx.complete
            ? ''
            : fx.needs.length === 1
              ? `, and ${the(fx.needs[0])} would finish it (the only card left that can)`
              : ` if they also find ${list(fx.needs.map(the), 'or')}`
        }.`
    );
  }

  // 1b. What their play says they are holding, even if we never saw it.
  if (scene.takes && scene.holds && !fx.cards.length) {
    const [tBest, tYours] = scene.takes;
    if (tYours >= 0.3 && tYours - tBest >= 0.2) {
      const st = statusOf(scene, x);
      const likely = new Set<number>();
      for (const [a, b] of partnerPairs(x)) {
        for (const c of [a, b]) if (st[c] === 1 && scene.holds[c] >= 0.5) likely.add(c);
      }
      const named = [...likely].sort((a, b) => scene.holds![b] - scene.holds![a]).slice(0, 3);
      const lead = named.length
        ? `Reading what they have thrown, kept and passed on, they probably hold ${list(named.map((c) => `${the(c)} (${pct(scene.holds![c])})`))}. `
        : '';
      out.push(
        `${lead}In ${pct(tYours)} of the hands consistent with their play they would pick up ${the(x)} straight away` +
          `${tBest < 0.1 ? `; ${the(y)} is one they would almost never want` : ` (against ${pct(tBest)} for ${the(y)})`}.`
      );
    }
  }

  // 2. The card kept instead was chasing buried cards.
  const yCombos = combos(scene.hand, y);
  const xCombos = combos(scene.hand, x);
  const live = statusOf(scene, -1);
  const liveNeeds = (cs: { needs: number[] }[]) => cs.reduce((a, c) => a + c.needs.filter((n) => live[n] === 1).length, 0);
  if (yCombos.length && liveNeeds(yCombos) === 0) {
    const c = yCombos[0];
    const gone = c.needs.map((n) => the(n));
    const where = c.needs.some((n) => live[n] === 2) ? 'already gone (in the pile or in their hand)' : 'already in the discard pile';
    if (c.needs.length) {
      out.push(
        `${cap(the(y))} and ${the(c.partner)} could only be finished by ${list(gone)}, ` +
          `and ${c.needs.length > 1 ? 'those are' : 'that is'} ${where}.`
      );
    }
  } else if (!yCombos.length && xCombos.length && liveNeeds(xCombos) > 0) {
    out.push(`${cap(the(y))} wasn't part of any combination, while ${the(x)} still had live cards to grow into a meld.`);
  }

  // 3. Live outs kept.
  const ox = liveOuts(without(scene.masks, x), unseen(scene, scene.hand));
  const oy = liveOuts(without(scene.masks, y), unseen(scene, scene.hand));
  if (oy >= ox + 2 && out.length < 2) {
    out.push(`Keeping ${the(x)} leaves ${oy} unseen cards that would make you a meld; throwing it left ${ox}.`);
  }

  // 4. Why the card thrown instead is safe.
  if (!fy.cards.length && out.length < 3) {
    if (deadToThem(scene, y) && !deadToThem(scene, x)) {
      out.push(`Everything that could meld with ${the(y)} is already in the discard pile or your hand, so it cannot help them.`);
    } else {
      const cy = cold(scene, y);
      const cx = cold(scene, x);
      const ny = cy.thrown.length + cy.passed.length;
      if (ny > cx.thrown.length + cx.passed.length) {
        const bits: string[] = [];
        if (cy.thrown.length) bits.push(`threw ${list(cy.thrown.map(the))}`);
        if (cy.passed.length) bits.push(`passed on ${list(cy.passed.map(the))}`);
        out.push(`They ${bits.join(' and ')}, so they are unlikely to want ${the(y)}.`);
      }
    }
  }

  // 5. Deadwood, either way.
  const dx = deadwoodWithout(scene.masks, x);
  const dy = deadwoodWithout(scene.masks, y);
  const plain = out.length;
  // Nothing on the table explains it by itself: it comes from the play-outs
  // (whose numbers the review shows alongside).
  if (!plain && dy >= dx) {
    const seen = playoutReasons(scene, x, y);
    if (seen.length) out.push(...seen);
    else out.push(`No single card on the table explains this one; keeping ${the(x)} simply plays out better from here.`);
  }
  if (dy < dx) out.push(`${plain ? 'It also leaves' : 'It leaves'} you on ${dy} deadwood instead of ${dx}.`);
  else if (dy > dx) out.push(`That holds even though it keeps ${dy} deadwood rather than ${dx}.`);
  void their;
  void check;
  return out;
}

function whyDraw(scene: Scene, mine: number, check: Moment['odds']): string[] {
  const out: string[] = [];
  const up = scene.upcard;
  const before = deadwoodOf(scene.masks);
  const taken = withCard(scene.masks, up);
  // Deadwood after taking it and throwing the best other card.
  let after = Infinity;
  let throwAfter = -1;
  for (const c of scene.hand) {
    const v = deadwoodWithout(taken, c);
    if (v < after) {
      after = v;
      throwAfter = c;
    }
  }
  const melds = deadwoodOf(taken) < before + POINTS[up];
  if (mine === 0) {
    // They drew blind; taking was better.
    if (melds && throwAfter >= 0) {
      const kept = [...scene.hand.filter((c) => c !== throwAfter), up].map(cardFromIndex);
      const upCard = cardFromIndex(up);
      const meld = meldsOf(kept).melds.find((m) => m.cards.some((c) => c.suit === upCard.suit && c.rank === upCard.rank));
      if (meld) {
        const rest = meld.cards.filter((c) => !(c.suit === upCard.suit && c.rank === upCard.rank));
        out.push(`${cap(the(up))} made a ${meld.kind} with your ${list(rest.map(describe))}.`);
      } else out.push(`${cap(the(up))} melded with your hand.`);
    }
    if (after < before) {
      out.push(`Taking it and throwing ${the(throwAfter)} would have dropped your deadwood from ${before} to ${after}.`);
    }
  } else {
    // They took it; drawing blind was better.
    const canKnock = after <= scene.pub.rules.knockMaxDeadwood;
    if (canKnock && check) {
      out.push(
        `Taking it let you knock at once on ${after}, which won the hand ${pct(check.yours.win)} of the time ` +
          `but for less: drawing blind kept your gin chances and averaged ${signed(check.best.mean)} points ` +
          `against ${signed(check.yours.mean)}.`
      );
    } else if (!melds) {
      out.push(`${cap(the(up))} didn't make a meld with anything you held.`);
    }
    // Only worth saying when the meld it shows them could still grow: four of
    // a kind, or a run with both ends gone, gives nothing away.
    if (!canKnock && (!melds || growable(scene, up, throwAfter))) {
      out.push(
        `Taking from the pile tells them what you are collecting; ` +
          `a blind draw gives nothing away${melds ? '' : ' and is a fresh shot at a card you need'}.`
      );
    }
    out.push(...drawPlayout(scene));
    const outs = liveOuts(scene.masks, unseen(scene, scene.hand));
    if (!melds && outs > 0 && out.length < 3) out.push(`There were ${outs} unseen cards that would make you a meld.`);
  }
  void check;
  return out;
}

/** Whether the meld the upcard makes could still take another unseen card. */
function growable(scene: Scene, up: number, throwAfter: number): boolean {
  const kept = [...scene.hand.filter((c) => c !== throwAfter), up].map(cardFromIndex);
  const u = cardFromIndex(up);
  const meld = meldsOf(kept).melds.find((m) => m.cards.some((c) => c.suit === u.suit && c.rank === u.rank));
  if (!meld) return true;
  const live = unseen(scene, scene.hand);
  live[up] = 0;
  const idx = meld.cards.map(cardIndex);
  if (meld.kind === 'set') return idx.length < 4 && [0, 1, 2, 3].some((s) => live[s * 10 + (up % 10)] === 1);
  const lo = Math.min(...idx);
  const hi = Math.max(...idx);
  return (lo % 10 > 0 && live[lo - 1] === 1) || (hi % 10 < 9 && live[hi + 1] === 1);
}

/** What the play-outs saw, for a draw: [drawing blind, taking it]. */
function drawPlayout(scene: Scene): string[] {
  const out: string[] = [];
  if (!scene.ends) return out;
  const [blind, took] = scene.ends;
  if (blind.gin - took.gin >= 0.04) {
    out.push(`Drawing blind, you went gin in ${pct(blind.gin)} of the play-outs; taking it, ${pct(took.gin)}.`);
  }
  const tb = blind.theyKnock + blind.theyGin;
  const tt = took.theyKnock + took.theyGin;
  if (tt - tb >= 0.03) {
    out.push(`They got down first in ${pct(tt)} of the play-outs after you took it, against ${pct(tb)} drawing blind.`);
  }
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------

const equities = new Map<number, Equity>();
function equityFor(target: number): Equity {
  let e = equities.get(target);
  if (!e) {
    e = buildEquity(new Map(Object.entries(margins as Record<string, number>).map(([m, q]) => [Number(m), q])), target);
    equities.set(target, e);
  }
  return e;
}

/**
 * What one point is worth in match equity at this score, so a gap in match
 * chances can be quoted on the usual points scale. Measured over a dozen
 * points either way; floored so a decided match does not divide by nothing.
 */
function pointWorth(e: Equity, you: number, them: number, weOpenNext: boolean): number {
  const up = equityAt(e, you + 12, them, weOpenNext);
  const down = equityAt(e, you, them + 12, weOpenNext);
  return Math.max(0.002, (up - down) / 24);
}

/**
 * Analyse one finished hand, yielding as each of the person's decisions is
 * judged (for progress bars). Pure computation; runs in a worker or in Node.
 */
export function* analyzeHand(hand: HandForAnalysis, opts: AnalysisOptions): Generator<Progress> {
  const seat = hand.humanSeat;
  const them: Seat = seat === 0 ? 1 : 0;
  const total = hand.history.filter((_, i) => seatAt(i) === seat).length;

  let current: GinAction = hand.history[0];
  let last: Explanation | null = null;
  const policy = champion({
    worlds: opts.worlds ?? 600,
    check: opts.check ?? 1500,
    width: opts.width ?? 5,
    particles: opts.particles ?? 8000,
    rollout: opts.rollout,
    confidence: 0,
    seed: opts.seed ?? hand.seed,
    readRollouts: opts.readRollouts ?? true,
    equity: hand.match ? equityFor(hand.match.target) : null,
    actual: {
      draw: () => (current.type === 'draw' ? current.from === 'discard' : null),
      throw: () => (current.type === 'draw' ? null : code(current)),
    },
    consider: () => (current.type === 'draw' ? null : code(current)),
    explain: (info) => {
      last = info;
    },
    ...(hand.opponent === 'human'
      ? (() => {
          const seed = opts.seed ?? hand.seed;
          const pair: [Policy, Policy] = [expert(opts.rollout, rng(seed ^ 0x5bd1e995), 'me'), makePolicy({ kind: 'human' }, seed)];
          return { rollers: () => pair };
        })()
      : {}),
  });
  const scores: [number, number] | null = hand.match
    ? seat === 0
      ? [hand.match.you, hand.match.them]
      : [hand.match.them, hand.match.you]
    : null;
  const player = seated(policy, scores && hand.match ? () => ({ scores, target: hand.match!.target }) : undefined);
  // Seat 0 opened this hand, so seat 1 opens the next.
  const worth = hand.match ? pointWorth(equityFor(hand.match.target), hand.match.you, hand.match.them, seat === 1) : 1;
  let state = deal(hand.seed);
  player.begin!(seat, state.hands[seat], state.discard[state.discard.length - 1], state.stock.length);

  const pub = blankPublic();
  pub.pile.push(cardIndex(state.discard[state.discard.length - 1]));
  pub.stockCount = state.stock.length;
  const pickups = new Map<number, number>();

  let done = 0;
  let turn = 0;
  for (let i = 0; i < hand.history.length; i++) {
    const action = hand.history[i];
    if (seatAt(i) === seat) {
      const view = viewFor(state, seat);
      const kind = action.type === 'draw' ? 'draw' : 'throw';
      if (kind === 'draw') turn++;
      const upIdx = view.discardTop ? cardIndex(view.discardTop) : -1;
      const handIdx = view.hand.map(cardIndex);
      const mine = code(action)!;
      current = action;
      last = null;

      const forced = kind === 'draw' && (!view.discardTop || view.stockCount === 0);
      let moment: Moment;
      if (forced) {
        const c = choice('draw', mine, upIdx);
        moment = {
          index: i, turn, kind, hand: view.hand.slice(), upcard: view.discardTop, stockCount: view.stockCount,
          yours: c, best: c, verdict: 'forced', cost: 0, se: 0, worlds: 0, why: [],
        };
        // Keep the shadow in step even though there is no choice to judge.
        player.act(view, hand.history.slice(0, i));
      } else {
        player.act(view, hand.history.slice(0, i));
        const info = last as Explanation | null;
        const bestCode = info ? info.moves[info.chosen] : mine;
        const yours = choice(kind, mine, upIdx);
        const best = choice(kind, bestCode, upIdx);
        moment = {
          index: i, turn, kind, hand: view.hand.slice(), upcard: view.discardTop, stockCount: view.stockCount,
          yours, best, verdict: 'best', cost: 0, se: 0, worlds: info?.samples[0]?.length ?? 0, why: [],
        };
        if (info && bestCode !== mine) {
          // The cost comes from the independent replay when there is one.
          const pair = info.check
            ? { best: info.check.samples[0], mine: info.check.samples[1] }
            : { best: info.samples[info.chosen], mine: info.samples[info.moves.indexOf(mine)] ?? [] };
          const raw = paired(pair.best, pair.mine);
          // In a match the samples are chances of winning it; quote the gap in
          // points at this score, and take the odds from the hand's points.
          const d = { mean: raw.mean / worth, se: Math.hypot(raw.se / worth, MODEL_NOISE), n: raw.n };
          moment.cost = d.mean;
          moment.se = d.se;
          moment.worlds = d.n;
          const pts = hand.match ? info.check?.margins : { 0: pair.best, 1: pair.mine };
          if (pts) moment.odds = { yours: odds(pts[1]), best: odds(pts[0]) };
          if (hand.match) {
            const avg = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
            moment.match = { ...hand.match, yours: avg(pair.mine), best: avg(pair.best) };
          }
          const c = d.mean;
          moment.verdict =
            c <= TIE
              ? 'best'
              : c <= Math.max(CLOSE, SIGNIFICANT * d.se)
                ? 'close'
                : c < INACCURACY
                  ? 'inaccuracy'
                  : c < MISTAKE
                    ? 'mistake'
                    : 'blunder';
          // Your move came out as good on the replay: it is a best move too.
          if (moment.verdict === 'best') moment.best = yours;
          const scene: Scene = {
            hand: handIdx,
            masks: masksOf(handIdx),
            pub,
            them,
            pickups,
            at: i,
            upcard: upIdx,
            holds: info.holds,
            takes: info.check?.takes,
            ends: info.check?.ends,
          };
          if (moment.verdict !== 'close' && moment.verdict !== 'best') {
            moment.why = kind === 'draw' ? whyDraw(scene, mine, moment.odds) : whyThrow(scene, mine, bestCode, moment.odds, 'they');
          }
        }
      }
      done++;
      yield { done, total, moment };
    }

    // The public record, and their pickups, move on.
    if (action.type === 'draw' && action.from === 'discard' && seatAt(i) === them) {
      pickups.set(pub.pile[pub.pile.length - 1], i);
    }
    if ((action.type === 'discard' || action.type === 'knock') && seatAt(i) === them) {
      pickups.delete(cardIndex(action.type === 'discard' ? action.card : action.discard));
    }
    advancePublic(pub, action, i);
    state = apply(state, state.turn, action);
  }
}

/** Run to completion and return every moment. */
export function analyzeAll(hand: HandForAnalysis, opts: AnalysisOptions): Moment[] {
  const out: Moment[] = [];
  for (const p of analyzeHand(hand, opts)) if (p.moment) out.push(p.moment);
  return out;
}
