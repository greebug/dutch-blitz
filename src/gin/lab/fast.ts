import { type Card, cardFromIndex, cardIndex, makeDeck, rng, shuffled } from '../cards';
import { type GinRules, type HandScore, NAPOLETANE_GIN, STOCK_FLOOR, scoreHand } from '../rules';

/**
 * The same game as `game.ts`, rebuilt for speed.
 *
 * `game.ts` is the referee: immutable states, readable Card objects, every
 * action checked. That is the right shape for a server and the wrong one for
 * the lab, where a tuning run wants millions of hands and a search wants
 * thousands of rollouts per decision. This file plays the identical game --
 * same deal from the same seed, same draw order, same end-of-stock rule, and
 * the referee's own `scoreHand` at the end -- with cards as integers 0..39 and
 * hands as four 10-bit suit masks, mutated in place.
 *
 * The parity is tested, not hoped for: `fast.test.ts` plays the same seeds
 * through both engines with the same decisions and requires identical results.
 *
 * Card index = suit * 10 + (rank - 1), exactly `cardIndex` in cards.ts.
 */

export const RANK_POINTS = [1, 2, 3, 4, 5, 6, 7, 8, 8, 8];
export const POINTS = new Int8Array(40);
for (let i = 0; i < 40; i++) POINTS[i] = RANK_POINTS[i % 10];

/**
 * RUN[mask]: the least deadwood one suit can be left with using runs alone.
 *
 * Runs never cross suits, so once the sets are chosen every suit is its own
 * little problem with 1024 possible shapes -- small enough to solve all of them
 * once, up front, and look the answer up for ever after.
 */
export const RUN = new Int16Array(1024);
{
  const f = new Int16Array(11);
  for (let mask = 0; mask < 1024; mask++) {
    f[10] = 0;
    for (let p = 9; p >= 0; p--) {
      if (!((mask >> p) & 1)) {
        f[p] = f[p + 1];
        continue;
      }
      let best = RANK_POINTS[p] + f[p + 1];
      let end = p;
      while (end < 10 && (mask >> end) & 1) {
        end++;
        if (end - p >= 3 && f[end] < best) best = f[end];
      }
      f[p] = best;
    }
    RUN[mask] = f[0];
  }
}

/**
 * For each 4-bit "which suits hold this rank" pattern, the sets that could be
 * taken out of it: none, any three, or all four.
 */
const SET_CHOICES: number[][] = [];
for (let s = 0; s < 16; s++) {
  const out = [0];
  const bits = [0, 1, 2, 3].filter((b) => (s >> b) & 1);
  if (bits.length === 3) out.push(s);
  if (bits.length === 4) {
    for (const skip of bits) out.push(s & ~(1 << skip));
    out.push(s);
  }
  SET_CHOICES.push(out);
}

/**
 * Exact least deadwood of a hand given as four suit masks.
 *
 * Exact for the same reason `analyzeHand` is exact: every way of taking sets
 * out is tried (an eleven-card hand has at most three ranks with three or more
 * cards, so at most 72 combinations and usually one), and what is left is
 * runs-only, which the table answers suit by suit.
 */
export function deadwood(a: number, b: number, c: number, d: number): number {
  const ranks = (a & b & c) | (a & b & d) | (a & c & d) | (b & c & d);
  if (ranks === 0) return RUN[a] + RUN[b] + RUN[c] + RUN[d];
  return withSets(a, b, c, d, ranks);
}

function withSets(a: number, b: number, c: number, d: number, ranks: number): number {
  const bit = ranks & -ranks;
  const rest = ranks & ~bit;
  const suits = (a & bit ? 1 : 0) | (b & bit ? 2 : 0) | (c & bit ? 4 : 0) | (d & bit ? 8 : 0);
  let best = 1 << 30;
  for (const take of SET_CHOICES[suits]) {
    const na = take & 1 ? a & ~bit : a;
    const nb = take & 2 ? b & ~bit : b;
    const nc = take & 4 ? c & ~bit : c;
    const nd = take & 8 ? d & ~bit : d;
    const v = rest === 0 ? RUN[na] + RUN[nb] + RUN[nc] + RUN[nd] : withSets(na, nb, nc, nd, rest);
    if (v < best) best = v;
  }
  return best;
}

export function deadwoodOf(m: ArrayLike<number>): number {
  return deadwood(m[0], m[1], m[2], m[3]);
}

/** Deadwood with one card left out -- the "if I threw this" question. */
export function deadwoodWithout(m: ArrayLike<number>, card: number): number {
  const s = (card / 10) | 0;
  const bit = 1 << card % 10;
  return deadwood(
    s === 0 ? m[0] & ~bit : m[0],
    s === 1 ? m[1] & ~bit : m[1],
    s === 2 ? m[2] & ~bit : m[2],
    s === 3 ? m[3] & ~bit : m[3]
  );
}

/** Deadwood with one card added. */
export function deadwoodWith(m: ArrayLike<number>, card: number): number {
  const s = (card / 10) | 0;
  const bit = 1 << card % 10;
  return deadwood(
    s === 0 ? m[0] | bit : m[0],
    s === 1 ? m[1] | bit : m[1],
    s === 2 ? m[2] | bit : m[2],
    s === 3 ? m[3] | bit : m[3]
  );
}

/** Deadwood with one card swapped for another. */
export function deadwoodSwap(m: ArrayLike<number>, add: number, drop: number): number {
  const w = [m[0], m[1], m[2], m[3]];
  w[(add / 10) | 0] |= 1 << add % 10;
  w[(drop / 10) | 0] &= ~(1 << drop % 10);
  return deadwood(w[0], w[1], w[2], w[3]);
}

export function masksOf(cards: readonly number[]): Int32Array {
  const m = new Int32Array(4);
  for (const c of cards) m[(c / 10) | 0] |= 1 << c % 10;
  return m;
}

export function holds(m: ArrayLike<number>, card: number): boolean {
  return ((m[(card / 10) | 0] >> card % 10) & 1) === 1;
}

/**
 * The best ten to keep out of eleven, by the referee's own tie-break: least
 * deadwood, then throw the dearer card, then the earlier one in the hand.
 */
export function bestThrow(hand: readonly number[], m: ArrayLike<number>): { card: number; left: number } {
  let card = hand[0];
  let left = 1 << 30;
  for (const c of hand) {
    const v = deadwoodWithout(m, c);
    if (v < left || (v === left && POINTS[c] > POINTS[card])) {
      left = v;
      card = c;
    }
  }
  return { card, left };
}

// --- The public record ------------------------------------------------------

/**
 * Everything both players can see. A policy gets this plus its own hand and
 * nothing else; the stock and the other hand live in `Table`, which no policy
 * is ever handed.
 */
export interface Public {
  rules: GinRules;
  /** Oldest first; the last is the upcard. */
  pile: number[];
  stockCount: number;
  /** Whose move it is. */
  turn: 0 | 1;
  /** Completed turns (draw + throw) so far this hand. */
  turns: number;
  /** Cards each seat took off the pile and has not thrown back since. */
  taken: [Uint8Array, Uint8Array];
  /** Cards each seat has thrown this hand. */
  thrown: [Uint8Array, Uint8Array];
  /** Upcards each seat passed over by drawing blind while it lay there. */
  passed: [Uint8Array, Uint8Array];
  /** Match context: points so far, and the target. Zeros outside a match. */
  scores: [number, number];
  target: number;
}

/** What one seat knows: its own cards plus the public record. */
export interface Seen {
  seat: 0 | 1;
  hand: number[];
  masks: Int32Array;
  pub: Public;
}

/** Hidden state. Only the engine touches this. */
export interface Table {
  pub: Public;
  seen: [Seen, Seen];
  stock: number[];
  /** Next stock card to draw. */
  at: number;
  over: boolean;
  /** Points to seat 0 (negative: to seat 1). */
  margin: number;
  outcome: HandScore['outcome'] | null;
  knocker: 0 | 1 | null;
  points: number;
}

/**
 * A strategy, as the lab plays it.
 *
 * `draw` answers take-the-upcard (true) or draw blind (false). `throw` answers
 * with a move code: a card index 0..39 to discard it, KNOCK + card to knock
 * throwing it, or BIG_GIN.
 */
export interface Policy {
  name: string;
  draw(seen: Seen): boolean;
  throw(seen: Seen): number;
  /** Told when a hand begins, for anything that keeps its own notes. */
  begin?(seen: Seen): void;
}

export const KNOCK = 100;
export const BIG_GIN = -1;

export function deal(seed: number, rules: GinRules = NAPOLETANE_GIN): Table {
  const deck = shuffled(makeDeck(), rng(seed)).map(cardIndex);
  return tableFrom(deck.slice(0, 10), deck.slice(10, 20), deck[20], deck.slice(21), rules);
}

export function blankPublic(rules: GinRules = NAPOLETANE_GIN): Public {
  return {
    rules,
    pile: [],
    stockCount: 0,
    turn: 0,
    turns: 0,
    taken: [new Uint8Array(40), new Uint8Array(40)],
    thrown: [new Uint8Array(40), new Uint8Array(40)],
    passed: [new Uint8Array(40), new Uint8Array(40)],
    scores: [0, 0],
    target: 0,
  };
}

export function tableFrom(
  first: number[],
  second: number[],
  upcard: number | null,
  stock: number[],
  rules: GinRules = NAPOLETANE_GIN
): Table {
  const pub = blankPublic(rules);
  if (upcard !== null) pub.pile.push(upcard);
  pub.stockCount = stock.length;
  return tableOver(pub, first, second, stock);
}

/** A table around an existing public record (for searching mid-hand). */
export function tableOver(pub: Public, first: number[], second: number[], stock: number[]): Table {
  return {
    pub,
    seen: [
      { seat: 0, hand: first.slice(), masks: masksOf(first), pub },
      { seat: 1, hand: second.slice(), masks: masksOf(second), pub },
    ],
    stock: stock.slice(),
    at: 0,
    over: false,
    margin: 0,
    outcome: null,
    knocker: null,
    points: 0,
  };
}

export function clonePublic(pub: Public): Public {
  return {
    rules: pub.rules,
    pile: pub.pile.slice(),
    stockCount: pub.stockCount,
    turn: pub.turn,
    turns: pub.turns,
    taken: [pub.taken[0].slice(), pub.taken[1].slice()],
    thrown: [pub.thrown[0].slice(), pub.thrown[1].slice()],
    passed: [pub.passed[0].slice(), pub.passed[1].slice()],
    scores: [pub.scores[0], pub.scores[1]],
    target: pub.target,
  };
}

function add(seen: Seen, card: number): void {
  seen.hand.push(card);
  seen.masks[(card / 10) | 0] |= 1 << card % 10;
}

function remove(seen: Seen, card: number): boolean {
  const i = seen.hand.indexOf(card);
  if (i < 0) return false;
  seen.hand.splice(i, 1);
  seen.masks[(card / 10) | 0] &= ~(1 << card % 10);
  return true;
}

/** Draw for the seat on move. Returns the card drawn. */
export function drawStep(t: Table, takeUpcard: boolean): number {
  const pub = t.pub;
  const seat = pub.turn;
  const top = pub.pile.length ? pub.pile[pub.pile.length - 1] : -1;
  if (top >= 0 && (takeUpcard || t.at >= t.stock.length)) {
    pub.pile.pop();
    pub.taken[seat][top] = 1;
    add(t.seen[seat], top);
    return top;
  }
  if (top >= 0) pub.passed[seat][top] = 1;
  const card = t.stock[t.at++];
  pub.stockCount--;
  add(t.seen[seat], card);
  return card;
}

const FOUL = 'policy foul:';

/** Throw for the seat on move, ending the hand on a knock or big gin. */
export function throwStep(t: Table, move: number): void {
  const pub = t.pub;
  const seat = pub.turn;
  const seen = t.seen[seat];
  if (move === BIG_GIN) {
    if (deadwoodOf(seen.masks) !== 0) throw new Error(`${FOUL} big gin without melding`);
    finish(t, seat, seen.hand.slice());
    return;
  }
  const knock = move >= KNOCK;
  const card = knock ? move - KNOCK : move;
  if (!remove(seen, card)) throw new Error(`${FOUL} threw ${card}, not held`);
  pub.pile.push(card);
  pub.thrown[seat][card] = 1;
  pub.taken[seat][card] = 0;
  if (knock) {
    const left = deadwoodOf(seen.masks);
    if (left > pub.rules.knockMaxDeadwood) throw new Error(`${FOUL} knocked on ${left}`);
    finish(t, seat, seen.hand.slice());
    return;
  }
  pub.turns++;
  pub.turn = seat === 0 ? 1 : 0;
  if (pub.stockCount <= STOCK_FLOOR) {
    t.over = true;
    t.outcome = 'dead-hand';
    t.margin = 0;
  }
}

function finish(t: Table, knocker: 0 | 1, kept: number[]): void {
  const defender = t.seen[knocker === 0 ? 1 : 0].hand;
  const score = scoreHand(kept.map(cardFromIndex), defender.map(cardFromIndex), t.pub.rules);
  t.over = true;
  t.outcome = score.outcome;
  t.knocker = knocker;
  t.points = score.points;
  const winner = score.winner === 'knocker' ? knocker : knocker === 0 ? 1 : 0;
  t.margin = winner === 0 ? score.points : -score.points;
}

/** Play the hand out from wherever it stands. */
export function play(t: Table, policies: readonly [Policy, Policy], maxTurns = 200): Table {
  for (let i = 0; i < maxTurns && !t.over; i++) {
    const seat = t.pub.turn;
    const p = policies[seat];
    const seen = t.seen[seat];
    drawStep(t, t.pub.pile.length > 0 && p.draw(seen));
    throwStep(t, p.throw(seen));
  }
  // Two players who both keep taking the upcard never touch the stock, and
  // nothing in the rules stops them. The referee gives up after 400 entries;
  // this calls it a push, which is what such a hand is worth to either side.
  if (!t.over) {
    t.over = true;
    t.outcome = 'dead-hand';
    t.margin = 0;
  }
  return t;
}

/** One hand from a seed, both policies told it began. */
export function playSeed(
  seed: number,
  policies: readonly [Policy, Policy],
  rules: GinRules = NAPOLETANE_GIN,
  scores: [number, number] = [0, 0],
  target = 0
): Table {
  const t = deal(seed, rules);
  t.pub.scores = scores;
  t.pub.target = target;
  policies[0].begin?.(t.seen[0]);
  policies[1].begin?.(t.seen[1]);
  return play(t, policies);
}

export function toCards(cards: readonly number[]): Card[] {
  return cards.map(cardFromIndex);
}
