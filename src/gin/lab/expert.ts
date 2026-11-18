import { BIG_GIN, KNOCK, POINTS, type Policy, type Seen, bestThrow, deadwoodOf, deadwoodWithout } from './fast';

/**
 * A fast, tunable player: the thing that gets trained on millions of hands.
 *
 * Every decision in gin is one of three, and this answers each with a score
 * built from a handful of things a strong player weighs, with the weights left
 * as numbers for the tuner to settle rather than for me to guess:
 *
 *  - **What to keep.** Deadwood now, minus the value of the hand's live outs --
 *    the unseen cards that would meld with it. An out lying under the discard
 *    pile, or sitting in the opponent's hand because we watched them take it,
 *    is not an out, and is not counted. That is the "stop chasing" rule, done
 *    as arithmetic: a run needing a buried card scores like the loose cards it
 *    really is.
 *  - **What it costs to throw.** How likely the card is to help the opponent,
 *    read from the public record: cards we saw them take, cards they threw and
 *    passed over (a player throwing the 6 of suns is not collecting suns
 *    around 6, nor sixes), and which of the card's meld partners are still in
 *    play at all.
 *  - **When to knock.** A deadwood threshold that falls as the stock runs
 *    down, falls further when the opponent has been taking cards (they are
 *    building), and moves with the match score.
 *
 * Only `Seen` is consulted -- own hand plus the public record -- so this can
 * never peek, and the same code plays in the lab and against the referee.
 */

export interface ExpertParams {
  /** Deadwood points one live out is worth, with a full stock... */
  outEarly: number;
  /** ...and with an empty one. Outs are only worth what draws remain. */
  outLate: number;
  /** Overall weight on discard danger. */
  danger: number;
  /** A throw that completes a meld with cards we saw them take. */
  dComplete: number;
  /** A throw that pairs with one card we saw them take. */
  dPartial: number;
  /** Each way the throw could still meld with unseen cards. */
  dLive: number;
  /** Each sign they are not collecting around it (thrown or passed nearby). */
  dSafe: number;
  /** Margin the upcard must clear before taking it (it tells them what we hold). */
  take: number;
  /**
   * What taking the upcard is measured against: 0 is keeping the hand exactly
   * as it is, 1 is the expected hand after a blind draw (which also lets us
   * shed our worst card). At 0 every low upcard looks like a bargain to a
   * hand holding a high loose card -- take the 4, throw the King -- and a
   * search using this player as its model of the opponent learns to bait it
   * with low discards that a real opponent would never take.
   */
  blind: number;
  /** Knock threshold with a full stock... */
  knockEarly: number;
  /** ...and with an empty one. */
  knockLate: number;
  /** Threshold drop per card they have taken from the pile and still hold. */
  knockThreat: number;
  /** Threshold change when we are close to winning the match... */
  knockClose: number;
  /** ...and when they are. */
  knockDefend: number;
  /** Chance per decision of playing a random reasonable move instead. 0 for tuned play. */
  noise: number;
}

export const EXPERT_KEYS: (keyof ExpertParams)[] = [
  'outEarly',
  'outLate',
  'danger',
  'dComplete',
  'dPartial',
  'dLive',
  'dSafe',
  'take',
  'blind',
  'knockEarly',
  'knockLate',
  'knockThreat',
  'knockClose',
  'knockDefend',
];

/** A sensible starting point, before any tuning. */
export const SEED_PARAMS: ExpertParams = {
  outEarly: 1.0,
  outLate: 0.3,
  danger: 1.0,
  dComplete: 6,
  dPartial: 2,
  dLive: 0.5,
  dSafe: 1,
  take: 0.5,
  blind: 0,
  knockEarly: 8,
  knockLate: 3,
  knockThreat: 0.8,
  knockClose: 3,
  knockDefend: 2,
  noise: 0,
};

/** Search ranges for the tuner, and the box anything it proposes is clipped to. */
export const PARAM_BOUNDS: Record<keyof ExpertParams, [number, number]> = {
  outEarly: [0, 4],
  outLate: [0, 3],
  danger: [0, 4],
  dComplete: [0, 20],
  dPartial: [0, 8],
  dLive: [0, 3],
  dSafe: [0, 4],
  take: [-4, 6],
  blind: [0, 1],
  knockEarly: [0, 10],
  knockLate: [-2, 9],
  knockThreat: [0, 4],
  knockClose: [-4, 8],
  knockDefend: [-6, 8],
  noise: [0, 1],
};

const FULL_STOCK = 19;

/** Unseen by this seat: not in hand, not in the pile, not watched into their hand. */
function unseenMask(seen: Seen, out: Uint8Array): number {
  const pub = seen.pub;
  const them = seen.seat === 0 ? 1 : 0;
  out.fill(1);
  for (const c of seen.hand) out[c] = 0;
  for (const c of pub.pile) out[c] = 0;
  const taken = pub.taken[them];
  let n = 0;
  for (let c = 0; c < 40; c++) {
    if (taken[c]) out[c] = 0;
    n += out[c];
  }
  return n;
}

/**
 * Live outs of a ten-card hand: unseen cards that would meld with it.
 * `m` is the hand as suit masks, `live` flags the unseen cards.
 */
export function liveOuts(m: ArrayLike<number>, live: Uint8Array): number {
  let n = 0;
  for (let c = 0; c < 40; c++) {
    if (!live[c]) continue;
    const s = (c / 10) | 0;
    const r = c % 10;
    const ms = m[s];
    // Two of the rank already held: this makes a set or a fourth.
    const sameRank = ((m[0] >> r) & 1) + ((m[1] >> r) & 1) + ((m[2] >> r) & 1) + ((m[3] >> r) & 1);
    if (sameRank >= 2) {
      n++;
      continue;
    }
    const up1 = (ms >> (r + 1)) & 1;
    const up2 = (ms >> (r + 2)) & 1;
    const dn1 = r >= 1 ? (ms >> (r - 1)) & 1 : 0;
    const dn2 = r >= 2 ? (ms >> (r - 2)) & 1 : 0;
    if ((up1 && up2) || (dn1 && up1) || (dn1 && dn2)) n++;
  }
  return n;
}

/**
 * How dangerous `card` is to throw, from `seen.seat`'s chair.
 *
 * A meld needs the card plus two partners. For each pair of partners that
 * could make one -- two other cards of the rank, or two neighbours in suit --
 * the pair is dead if either is buried in the pile or in our own hand, live if
 * both are unseen, and partial or complete if we watched them take one or both.
 *
 * `read`, when given, is how much more likely than the background odds each
 * unseen card is to be in their hand (0 = nothing known, 1 = certain), from a
 * searcher's inference. An unseen partner then counts as that fraction of a
 * known one, so a card that would finish a run they almost surely hold is
 * dangerous even though nobody watched them pick the run up. Without a read
 * every unseen card counts as 0 and this is exactly the public-only rule.
 */
export function dangerOf(
  seen: Seen,
  card: number,
  p: ExpertParams,
  scratch: Uint8Array,
  read: ArrayLike<number> | null = null
): number {
  const pub = seen.pub;
  const them = seen.seat === 0 ? 1 : 0;
  const taken = pub.taken[them];
  // status: 0 dead, 1 unseen, 2 known theirs.
  const status = scratch;
  status.fill(1);
  for (const c of seen.hand) status[c] = 0;
  for (const c of pub.pile) status[c] = 0;
  for (let c = 0; c < 40; c++) if (taken[c]) status[c] = 2;
  status[card] = 0;

  const s = (card / 10) | 0;
  const r = card % 10;
  let complete = 0;
  let partial = 0;
  let live = 0;
  const pair = (a: number, b: number) => {
    const x = status[a];
    const y = status[b];
    if (x === 0 || y === 0) return;
    // Chance each partner is theirs: 1 if watched in, else the read (or 0).
    const pa = x === 2 ? 1 : read ? read[a] : 0;
    const pb = y === 2 ? 1 : read ? read[b] : 0;
    complete += pa * pb;
    partial += pa + pb - 2 * pa * pb;
    live += (1 - pa) * (1 - pb);
  };
  // Sets: any two of the other three of this rank.
  const others: number[] = [];
  for (let t = 0; t < 4; t++) if (t !== s) others.push(t * 10 + r);
  pair(others[0], others[1]);
  pair(others[0], others[2]);
  pair(others[1], others[2]);
  // Runs: the three windows of three that contain this card.
  const base = s * 10;
  if (r >= 2) pair(base + r - 2, base + r - 1);
  if (r >= 1 && r <= 8) pair(base + r - 1, base + r + 1);
  if (r <= 7) pair(base + r + 1, base + r + 2);

  // Signs they are not collecting here.
  const thrown = pub.thrown[them];
  const passed = pub.passed[them];
  let safe = 0;
  for (const o of others) safe += thrown[o] + passed[o];
  if (r >= 1) safe += thrown[base + r - 1] + passed[base + r - 1];
  if (r <= 8) safe += thrown[base + r + 1] + passed[base + r + 1];
  safe += passed[card];

  const raw =
    p.dComplete * Math.min(1, complete) + p.dPartial * partial + p.dLive * live - p.dSafe * safe;
  return p.danger * Math.max(0, raw);
}

export function knockThreshold(seen: Seen, p: ExpertParams): number {
  const pub = seen.pub;
  const them = seen.seat === 0 ? 1 : 0;
  const frac = Math.min(1, pub.stockCount / FULL_STOCK);
  let k = p.knockLate + (p.knockEarly - p.knockLate) * frac;
  let held = 0;
  const taken = pub.taken[them];
  for (let c = 0; c < 40; c++) held += taken[c];
  k -= p.knockThreat * held;
  if (pub.target > 0) {
    const mine = pub.target - pub.scores[seen.seat];
    const theirs = pub.target - pub.scores[them];
    if (mine <= 20) k += p.knockClose;
    if (theirs <= 20) k += p.knockDefend;
  }
  return Math.max(0, Math.min(pub.rules.knockMaxDeadwood, k));
}

/** The expert, plus two hooks the search uses: its ranking of throws, and being told what it just took. */
export interface ExpertPolicy extends Policy {
  /** Every legal discard, best first, by the expert's own score. */
  rank(seen: Seen): { card: number; score: number }[];
  /** Set the card taken from the pile this turn (so it is not thrown straight back). */
  took(card: number): void;
  /** Hand it a searcher's read of the opponent (see `dangerOf`), or null to drop it. */
  setRead(read: ArrayLike<number> | null): void;
}

/** Build the policy. `next` is only used when `noise` is above zero. */
export function expert(params: ExpertParams, next: () => number = Math.random, name = 'expert'): ExpertPolicy {
  const p = params;
  const live = new Uint8Array(40);
  const scratch = new Uint8Array(40);
  const work = new Int32Array(4);
  let justTook = -1;
  let read: ArrayLike<number> | null = null;

  /** Value of keeping `m` (lower is better). */
  function keepScore(m: ArrayLike<number>, frac: number): number {
    const w = p.outLate + (p.outEarly - p.outLate) * frac;
    return deadwoodOf(m) - (w > 0 ? w * liveOuts(m, live) : 0);
  }

  function rank(seen: Seen): { card: number; score: number }[] {
    unseenMask(seen, live);
    const frac = Math.min(1, seen.pub.stockCount / FULL_STOCK);
    const out: { card: number; score: number }[] = [];
    work.set(seen.masks);
    for (const c of seen.hand) {
      if (c === justTook) continue;
      const s = (c / 10) | 0;
      const bit = 1 << c % 10;
      work[s] &= ~bit;
      let v = keepScore(work, frac);
      work[s] |= bit;
      if (p.danger > 0) v += dangerOf(seen, c, p, scratch, read);
      out.push({ card: c, score: v });
    }
    return out.sort((a, b) => a.score - b.score || POINTS[b.card] - POINTS[a.card]);
  }

  /**
   * The expected keep-score after drawing blind and throwing the best card,
   * cheaply: a drawn card that melds (a live out) is assumed to meld and cost
   * nothing; any other card either goes straight back (score unchanged) or
   * replaces our worst card, whichever is better.
   */
  function blindValue(seen: Seen, now: number, frac: number): number {
    // Best nine: the hand without its most expendable card.
    work.set(seen.masks);
    let base = Infinity;
    for (const c of seen.hand) {
      const s = (c / 10) | 0;
      const bit = 1 << c % 10;
      work[s] &= ~bit;
      const v = keepScore(work, frac);
      work[s] |= bit;
      if (v < base) base = v;
    }
    const m = seen.masks;
    let sum = 0;
    let n = 0;
    for (let x = 0; x < 40; x++) {
      if (!live[x]) continue;
      n++;
      const s = (x / 10) | 0;
      const r = x % 10;
      const ms = m[s];
      const sameRank = ((m[0] >> r) & 1) + ((m[1] >> r) & 1) + ((m[2] >> r) & 1) + ((m[3] >> r) & 1);
      const up1 = (ms >> (r + 1)) & 1;
      const up2 = (ms >> (r + 2)) & 1;
      const dn1 = r >= 1 ? (ms >> (r - 1)) & 1 : 0;
      const dn2 = r >= 2 ? (ms >> (r - 2)) & 1 : 0;
      const melds = sameRank >= 2 || (up1 && up2) || (dn1 && up1) || (dn1 && dn2);
      sum += melds ? Math.min(now, base) : Math.min(now, base + POINTS[x]);
    }
    return n ? sum / n : now;
  }

  return {
    name,
    rank,
    took(card) {
      justTook = card;
    },
    setRead(r) {
      read = r;
    },
    begin() {
      justTook = -1;
    },
    draw(seen) {
      const pub = seen.pub;
      const top = pub.pile[pub.pile.length - 1];
      justTook = -1;
      if (p.noise > 0 && next() < p.noise) {
        if (next() < 0.25) justTook = top;
        return justTook >= 0;
      }
      unseenMask(seen, live);
      const frac = Math.min(1, pub.stockCount / FULL_STOCK);
      const now = keepScore(seen.masks, frac);
      // Best ten after taking it, never counting a throw of the card itself.
      work.set(seen.masks);
      work[(top / 10) | 0] |= 1 << top % 10;
      let best = Infinity;
      for (const c of seen.hand) {
        const s = (c / 10) | 0;
        const bit = 1 << c % 10;
        work[s] &= ~bit;
        const v = keepScore(work, frac);
        work[s] |= bit;
        if (v < best) best = v;
      }
      const blind = p.blind ? blindValue(seen, now, frac) : now;
      const base = now + (p.blind ?? 0) * (blind - now);
      const take = best + p.take < base;
      if (take) justTook = top;
      return take;
    },
    throw(seen) {
      const pub = seen.pub;
      if (deadwoodOf(seen.masks) === 0) return BIG_GIN;
      const knock = bestThrow(seen.hand, seen.masks);
      if (knock.left === 0) return KNOCK + knock.card;
      if (knock.left <= pub.rules.knockMaxDeadwood && knock.left <= knockThreshold(seen, p)) {
        return KNOCK + knock.card;
      }

      if (p.noise > 0 && next() < p.noise) {
        // A human-shaped slip: throw one of the three cheapest-looking cards.
        const ranked = seen.hand
          .filter((c) => c !== justTook)
          .map((c) => ({ c, v: deadwoodWithout(seen.masks, c) }))
          .sort((a, b) => a.v - b.v);
        return ranked[Math.min(ranked.length - 1, Math.floor(next() * 3))].c;
      }

      unseenMask(seen, live);
      const frac = Math.min(1, pub.stockCount / FULL_STOCK);
      let bestCard = -1;
      let bestScore = Infinity;
      work.set(seen.masks);
      for (const c of seen.hand) {
        if (c === justTook) continue;
        const s = (c / 10) | 0;
        const bit = 1 << c % 10;
        work[s] &= ~bit;
        let v = keepScore(work, frac);
        work[s] |= bit;
        if (p.danger > 0) v += dangerOf(seen, c, p, scratch, read);
        // Ties to the dearer card: it is the one that hurts if they knock.
        if (v < bestScore - 1e-9 || (Math.abs(v - bestScore) <= 1e-9 && POINTS[c] > POINTS[bestCard])) {
          bestScore = v;
          bestCard = c;
        }
      }
      return bestCard < 0 ? knock.card : bestCard;
    },
  };
}

export function paramsFrom(vector: readonly number[], base: ExpertParams = SEED_PARAMS): ExpertParams {
  const out = { ...base };
  EXPERT_KEYS.forEach((key, i) => {
    const [lo, hi] = PARAM_BOUNDS[key];
    out[key] = Math.max(lo, Math.min(hi, vector[i]));
  });
  return out;
}

export function vectorOf(params: ExpertParams): number[] {
  return EXPERT_KEYS.map((key) => params[key]);
}
