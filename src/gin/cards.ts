/**
 * The Napoletane deck, and the one modelling decision everything else rests on.
 *
 * 40 cards: ten ranks in four suits. The ranks are 1-7 plus Jack, Horse and
 * King; the suits are roots, suns, swords and goblets (the traditional
 * Neapolitan bastoni, denari, spade and coppe, should we ever want authentic
 * artwork).
 *
 * THE IMPORTANT PART: a card's run position and its point value are two
 * DIFFERENT numbers here, unlike standard 52-card Gin where they track each
 * other.
 *
 *   rank   1 2 3 4 5 6 7  Jack=8  Horse=9  King=10   <- ordering, for runs
 *   points 1 2 3 4 5 6 7       8        8        8   <- scoring, for deadwood
 *
 * Collapsing those two into one field is the single most tempting mistake in
 * this file. Score Jack, Horse and King as 8 and you've also made them
 * interchangeable in a sequence, so `7-Jack-Horse` stops being a run and
 * `Jack-Horse-King` becomes indistinguishable from three-of-a-kind. Keep them
 * separate. Everything downstream -- meld search, deadwood, the solver's
 * rollouts -- reads `rank` for adjacency and `points` for cost, never one for
 * the other.
 */

/** Two-letter codes, deliberately not one: suns and swords both start with S. */
export const SUITS = ['ro', 'su', 'sw', 'go'] as const;
export type Suit = (typeof SUITS)[number];

export const SUIT_LABELS: Record<Suit, string> = {
  ro: 'roots',
  su: 'suns',
  sw: 'swords',
  go: 'goblets',
};

/** Run position. 1-7 are themselves; the three face cards continue the sequence. */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export const RANKS: Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export const RANK_LABELS: Record<Rank, string> = {
  1: '1',
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: 'Jack',
  9: 'Horse',
  10: 'King',
};

export interface Card {
  suit: Suit;
  rank: Rank;
}

/** Deadwood cost. Face cards are flat 8s; everything else is worth its number. */
export function points(rank: Rank): number {
  return rank <= 7 ? rank : 8;
}

export function cardPoints(card: Card): number {
  return points(card.rank);
}

export function handPoints(cards: readonly Card[]): number {
  return cards.reduce((total, card) => total + cardPoints(card), 0);
}

/** Stable 0-39 id. The solver will want integer cards for fast set maths. */
export function cardIndex(card: Card): number {
  return SUITS.indexOf(card.suit) * 10 + (card.rank - 1);
}

export function cardFromIndex(index: number): Card {
  return { suit: SUITS[Math.floor(index / 10)], rank: ((index % 10) + 1) as Rank };
}

/** Compact, readable in test failures and log lines: `ro1`, `sw10`, `go8`. */
export function cardId(card: Card): string {
  return `${card.suit}${card.rank}`;
}

export function parseCardId(id: string): Card {
  const suit = id.slice(0, 2) as Suit;
  const rank = Number(id.slice(2)) as Rank;
  if (!SUITS.includes(suit) || !RANKS.includes(rank)) {
    throw new Error(`not a card id: ${id}`);
  }
  return { suit, rank };
}

/** Shorthand for tests and fixtures: `hand('ro1 ro2 ro3 sw10')`. */
export function hand(ids: string): Card[] {
  return ids.trim().split(/\s+/).filter(Boolean).map(parseCardId);
}

export function describe(card: Card): string {
  return `${RANK_LABELS[card.rank]} of ${SUIT_LABELS[card.suit]}`;
}

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ suit, rank });
  return deck;
}

/**
 * mulberry32 -- small, fast, and crucially SEEDED.
 *
 * Not for anything security-sensitive; it shuffles cards. The seed is the point:
 * a hand that can be replayed from `(seed, actions)` costs a few bytes to store
 * instead of a full snapshot per turn, which is what makes the review mode cheap
 * rather than something that needs its own table of board states.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates, returning a new array. */
export function shuffled(cards: readonly Card[], next: () => number): Card[] {
  const out = cards.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
