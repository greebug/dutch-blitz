import { deadwood, holds } from './fast';

/**
 * The particle filter from `belief.ts`, on integer cards.
 *
 * Same model, same evidence, same safeguards -- reweight before the upcard
 * leaves the pile, hold a blind draw open until the discard settles it,
 * repair rather than delete, rejuvenate after resampling -- but each guess is
 * four suit masks and every likelihood is a table lookup, which makes it about
 * thirty times cheaper. That is the difference between a search that can be
 * played for ten thousand matches and one that cannot.
 *
 * The evidence methods are the information boundary, as `Evidence` is in
 * belief.ts: our own draws and throws, and the opponent's draw SOURCE and
 * throws. There is no method that accepts the opponent's cards, because there
 * is no legitimate way to learn them.
 *
 * The behaviour model is deliberately generic, not fitted to any opponent:
 * a player takes upcards in proportion to how much they help, and throws
 * their least useful card with a soft rather than hard preference.
 */

const REJUVENATE = 0.12;
const TAU = 1.6;

export interface Inference {
  /** Opponent hands, 4 masks each. */
  masks: Int32Array;
  weights: Float64Array;
  count: number;
  /** Our hand, as masks. */
  mine: Int32Array;
  pile: number[];
  /** Cards watched into their hand and not seen since. */
  known: Uint8Array;
  /** Cards they passed over. */
  declined: Uint8Array;
  /** Cards in their hand: 10, or 11 mid-turn. */
  theirCount: number;
  /** Between their blind draw and their discard. */
  pending: boolean;
  stockCount: number;
  next: () => number;
}

function bitOf(card: number): number {
  return 1 << card % 10;
}

function suitOf(card: number): number {
  return (card / 10) | 0;
}

function popcount(x: number): number {
  x = x - ((x >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  return (((x + (x >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

export function unseenCards(inf: Inference): number[] {
  const out: number[] = [];
  const onPile = new Uint8Array(40);
  for (const c of inf.pile) onPile[c] = 1;
  for (let c = 0; c < 40; c++) if (!onPile[c] && !holds(inf.mine, c)) out.push(c);
  return out;
}

function guessSize(inf: Inference): number {
  return inf.theirCount - (inf.pending ? 1 : 0);
}

export function createInference(
  hand: readonly number[],
  upcard: number,
  stockCount: number,
  next: () => number,
  count = 1000
): Inference {
  const mine = new Int32Array(4);
  for (const c of hand) mine[suitOf(c)] |= bitOf(c);
  const inf: Inference = {
    masks: new Int32Array(count * 4),
    weights: new Float64Array(count).fill(1 / count),
    count,
    mine,
    pile: [upcard],
    known: new Uint8Array(40),
    declined: new Uint8Array(40),
    theirCount: hand.length,
    pending: false,
    stockCount,
    next,
  };
  const pool = unseenCards(inf);
  for (let p = 0; p < count; p++) {
    const copy = pool.slice();
    for (let k = 0; k < inf.theirCount; k++) {
      const c = copy.splice(Math.floor(next() * copy.length), 1)[0];
      inf.masks[p * 4 + suitOf(c)] |= bitOf(c);
    }
  }
  return inf;
}

// --- The behaviour model ----------------------------------------------------

function dwAt(m: Int32Array, o: number): number {
  return deadwood(m[o], m[o + 1], m[o + 2], m[o + 3]);
}

/** Deadwood of particle p with `card` added. */
function dwPlus(m: Int32Array, o: number, card: number): number {
  const s = suitOf(card);
  const b = bitOf(card);
  return deadwood(
    s === 0 ? m[o] | b : m[o],
    s === 1 ? m[o + 1] | b : m[o + 1],
    s === 2 ? m[o + 2] | b : m[o + 2],
    s === 3 ? m[o + 3] | b : m[o + 3]
  );
}

export function takeChanceFor(gain: number): number {
  return 0.03 + 0.94 / (1 + Math.exp(-(gain - 3.2) / 1.4));
}

const w4 = new Int32Array(4);

/**
 * How likely an eleven-card hand (`m` at offset o, which must hold `card`) is
 * to throw `card`: a softmax over every throw by the deadwood it leaves.
 */
function throwChance(m: Int32Array, o: number, card: number): number {
  w4[0] = m[o];
  w4[1] = m[o + 1];
  w4[2] = m[o + 2];
  w4[3] = m[o + 3];
  let total = 0;
  let mineW = 0;
  for (let s = 0; s < 4; s++) {
    let bits = w4[s];
    while (bits) {
      const b = bits & -bits;
      bits &= ~b;
      w4[s] &= ~b;
      const left = deadwood(w4[0], w4[1], w4[2], w4[3]);
      w4[s] |= b;
      const weight = Math.exp(-left / TAU);
      total += weight;
      if (s === suitOf(card) && b === bitOf(card)) mineW = weight;
    }
  }
  return total > 0 ? mineW / total : 0;
}

// --- Evidence ---------------------------------------------------------------

export function weDraw(inf: Inference, card: number, fromPile: boolean): void {
  inf.mine[suitOf(card)] |= bitOf(card);
  if (fromPile) inf.pile.pop();
  else inf.stockCount--;
  repair(inf);
}

export function weThrow(inf: Inference, card: number): void {
  inf.mine[suitOf(card)] &= ~bitOf(card);
  inf.pile.push(card);
}

export function theyDraw(inf: Inference, fromPile: boolean): void {
  const top = inf.pile.length ? inf.pile[inf.pile.length - 1] : -1;
  inf.theirCount++;
  const m = inf.masks;
  if (fromPile) {
    if (top < 0) return;
    // Before the card leaves the pile: see belief.ts for why the order matters.
    reweight(inf, (o) => takeChanceFor(dwAt(m, o) - dwPlus(m, o, top)));
    inf.pile.pop();
    inf.known[top] = 1;
    const s = suitOf(top);
    const b = bitOf(top);
    for (let p = 0; p < inf.count; p++) m[p * 4 + s] |= b;
    inf.pending = false;
  } else {
    if (top >= 0) {
      inf.declined[top] = 1;
      reweight(inf, (o) => 1 - takeChanceFor(dwAt(m, o) - dwPlus(m, o, top)));
    }
    inf.stockCount--;
    inf.pending = true;
  }
}

export function theyThrow(inf: Inference, card: number): void {
  const m = inf.masks;
  const s = suitOf(card);
  const b = bitOf(card);
  if (inf.pending) {
    settle(inf, card);
  } else {
    reweight(inf, (o) => ((m[o + s] & b) !== 0 ? throwChance(m, o, card) : 0));
    for (let p = 0; p < inf.count; p++) m[p * 4 + s] &= ~b;
  }
  inf.known[card] = 0;
  inf.theirCount--;
  inf.pile.push(card);
  repair(inf);
}

/** The blind draw, resolved by what they threw. Same two stories as belief.ts. */
function settle(inf: Inference, thrown: number): void {
  const m = inf.masks;
  const s = suitOf(thrown);
  const b = bitOf(thrown);
  const pool = unseenCards(inf).filter((c) => c !== thrown);
  const picks = new Int32Array(inf.count).fill(-1);
  normalise(inf);
  for (let p = 0; p < inf.count; p++) {
    const o = p * 4;
    if (m[o + s] & b) {
      // Held it: they kept whatever they drew. One sample stands in.
      let pick = -1;
      for (let tries = 0; tries < 8 && pick < 0; tries++) {
        const c = pool[Math.floor(inf.next() * pool.length)];
        if (!(m[o + suitOf(c)] & bitOf(c))) pick = c;
      }
      if (pick < 0) {
        for (const c of pool) if (!(m[o + suitOf(c)] & bitOf(c))) { pick = c; break; }
      }
      picks[p] = pick;
      if (pick >= 0) m[o + suitOf(pick)] |= bitOf(pick);
      inf.weights[p] *= throwChance(m, o, thrown);
      if (pick >= 0) m[o + suitOf(pick)] &= ~bitOf(pick);
    } else {
      // Drew the very card and threw it straight back.
      const odds = pool.length > 0 ? 1 / (pool.length + 1) : 0;
      m[o + s] |= b;
      inf.weights[p] *= odds * throwChance(m, o, thrown);
      m[o + s] &= ~b;
    }
  }
  normalise(inf);
  for (let p = 0; p < inf.count; p++) {
    const o = p * 4;
    m[o + s] &= ~b;
    const pick = picks[p];
    if (pick >= 0) m[o + suitOf(pick)] |= bitOf(pick);
  }
  inf.pending = false;
  if (effective(inf) < inf.count / 2) resample(inf);
}

// --- Mechanics --------------------------------------------------------------

function reweight(inf: Inference, likelihood: (offset: number) => number): void {
  let total = 0;
  for (let p = 0; p < inf.count; p++) {
    inf.weights[p] *= likelihood(p * 4);
    total += inf.weights[p];
  }
  if (total <= 0) {
    inf.weights.fill(1 / inf.count);
    return;
  }
  for (let p = 0; p < inf.count; p++) inf.weights[p] /= total;
  if (effective(inf) < inf.count / 2) resample(inf);
}

function normalise(inf: Inference): void {
  let total = 0;
  for (let p = 0; p < inf.count; p++) total += inf.weights[p];
  if (total <= 0) {
    inf.weights.fill(1 / inf.count);
    return;
  }
  for (let p = 0; p < inf.count; p++) inf.weights[p] /= total;
}

function effective(inf: Inference): number {
  let sum = 0;
  for (let p = 0; p < inf.count; p++) sum += inf.weights[p] * inf.weights[p];
  return sum > 0 ? 1 / sum : 0;
}

function resample(inf: Inference): void {
  const n = inf.count;
  const out = new Int32Array(n * 4);
  const step = 1 / n;
  let point = inf.next() * step;
  let cumulative = 0;
  let k = 0;
  for (let p = 0; p < n && k < n; p++) {
    cumulative += inf.weights[p];
    while (point < cumulative && k < n) {
      out.set(inf.masks.subarray(p * 4, p * 4 + 4), k * 4);
      k++;
      point += step;
    }
  }
  for (; k < n; k++) out.set(inf.masks.subarray((n - 1) * 4, n * 4), k * 4);
  inf.masks = out;
  inf.weights.fill(step);
  rejuvenate(inf);
}

function rejuvenate(inf: Inference): void {
  const pool = unseenCards(inf);
  if (pool.length === 0) return;
  const m = inf.masks;
  for (let p = 0; p < inf.count; p++) {
    if (inf.next() >= REJUVENATE) continue;
    const o = p * 4;
    const movable: number[] = [];
    for (let c = 0; c < 40; c++) if (m[o + suitOf(c)] & bitOf(c) && !inf.known[c]) movable.push(c);
    if (!movable.length) continue;
    const out = movable[Math.floor(inf.next() * movable.length)];
    const free = pool.filter((c) => !(m[o + suitOf(c)] & bitOf(c)));
    if (!free.length) continue;
    const into = free[Math.floor(inf.next() * free.length)];
    m[o + suitOf(out)] &= ~bitOf(out);
    m[o + suitOf(into)] |= bitOf(into);
  }
}

/** Make every guess consistent with what we can see, without deleting any. */
export function repair(inf: Inference): void {
  const pool = unseenCards(inf);
  const live = new Int32Array(4);
  for (const c of pool) live[suitOf(c)] |= bitOf(c);
  const knownMask = new Int32Array(4);
  for (let c = 0; c < 40; c++) if (inf.known[c]) knownMask[suitOf(c)] |= bitOf(c);
  const size = guessSize(inf);
  const m = inf.masks;
  for (let p = 0; p < inf.count; p++) {
    const o = p * 4;
    let n = 0;
    for (let s = 0; s < 4; s++) {
      m[o + s] = (m[o + s] & live[s]) | (knownMask[s] & live[s]);
      n += popcount(m[o + s]);
    }
    let drops = 0;
    while (n > size && drops++ < 400) {
      // Drop a random unlocked card.
      const c = pool[Math.floor(inf.next() * pool.length)];
      if (m[o + suitOf(c)] & bitOf(c) && !inf.known[c]) {
        m[o + suitOf(c)] &= ~bitOf(c);
        n--;
      }
    }
    let guard = 0;
    while (n < size && guard++ < 400) {
      const c = pool[Math.floor(inf.next() * pool.length)];
      if (!(m[o + suitOf(c)] & bitOf(c))) {
        m[o + suitOf(c)] |= bitOf(c);
        n++;
      }
    }
  }
}

/** One guess at their hand, in proportion to how well it fits. */
export function sampleTheirs(inf: Inference): number[] {
  const roll = inf.next();
  let seen = 0;
  let p = inf.count - 1;
  for (let i = 0; i < inf.count; i++) {
    seen += inf.weights[i];
    if (roll <= seen) {
      p = i;
      break;
    }
  }
  const out: number[] = [];
  const o = p * 4;
  for (let c = 0; c < 40; c++) if (inf.masks[o + suitOf(c)] & bitOf(c)) out.push(c);
  return out;
}

/** The chance they hold `card`. */
export function holdsChanceOf(inf: Inference, card: number): number {
  const s = suitOf(card);
  const b = bitOf(card);
  let held = 0;
  for (let p = 0; p < inf.count; p++) if (inf.masks[p * 4 + s] & b) held += inf.weights[p];
  return held;
}
