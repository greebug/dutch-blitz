import { type Card, type Rank, type Suit, cardId, cardPoints, handPoints } from './cards';

/**
 * Finding the best way to arrange a hand -- the foundation the whole game and
 * the whole solver sit on.
 *
 * A meld is either a SET (three or four cards of the same rank) or a RUN (three
 * or more consecutive ranks in one suit, using `rank` so that 7-Jack-Horse is a
 * run and Jack-Horse-King is a run rather than a set). Ace is low and there is
 * no King-1-2 wrap.
 *
 * The job is to pick disjoint melds leaving the cheapest pile of unmelded cards.
 *
 * This is done EXACTLY, not greedily, and that matters. The obvious approach --
 * take the longest run, then the biggest set, then whatever is left -- is wrong
 * in ordinary hands, because melds compete for cards. Holding
 * `ro5 su5 sw5 ro6 ro7` you can have the set of 5s (leaving 6+7=13 deadwood) or
 * the run ro5-ro6-ro7 (leaving 5+5=10). A greedy pass that prefers sets, or
 * prefers length, picks wrong depending on which it happens to try first. There
 * is no ordering heuristic that is always right, so we search.
 *
 * Cost: hands are at most 11 cards, so a hand is a bitmask of at most 11 bits
 * and there are at most 2048 distinct sub-hands to consider. Memoised over that
 * mask the search is effectively instant, which is what lets the solver call it
 * thousands of times per decision inside a Monte Carlo rollout.
 */

export type MeldKind = 'set' | 'run';

export interface Meld {
  kind: MeldKind;
  cards: Card[];
}

export interface HandAnalysis {
  /** Chosen disjoint melds. */
  melds: Meld[];
  /** Cards left over, cheapest arrangement found. */
  deadwood: Card[];
  /** Point total of `deadwood`. This is the number the knock rule tests. */
  deadwoodPoints: number;
}

interface Candidate {
  kind: MeldKind;
  /** Bitmask over positions in the hand array, not card identities. */
  mask: number;
  indices: number[];
}

/**
 * Every meld that could be built from this hand, including shorter versions of
 * longer ones.
 *
 * Both the 3- and 4-card forms are listed on purpose. A four-card meld is not
 * automatically better: the fourth card may be worth more inside a different
 * meld, and dropping it from this one can leave the rest of the hand cheaper.
 * The search decides; enumeration just offers the options.
 */
function candidates(cards: readonly Card[]): Candidate[] {
  const out: Candidate[] = [];

  // --- Sets: same rank, any suits. A 40-card deck holds exactly four of each
  // rank, so a set is three or four cards and never more.
  const byRank = new Map<Rank, number[]>();
  cards.forEach((card, i) => {
    const bucket = byRank.get(card.rank);
    if (bucket) bucket.push(i);
    else byRank.set(card.rank, [i]);
  });

  for (const indices of byRank.values()) {
    if (indices.length < 3) continue;
    // All 3-subsets, plus the whole thing when there are four.
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        for (let c = b + 1; c < indices.length; c++) {
          out.push(makeCandidate('set', [indices[a], indices[b], indices[c]]));
        }
      }
    }
    if (indices.length === 4) out.push(makeCandidate('set', indices.slice()));
  }

  // --- Runs: consecutive ranks within one suit. Ranks are unique per suit in a
  // 40-card deck, so after sorting, "consecutive" is a simple +1 walk.
  const bySuit = new Map<string, number[]>();
  cards.forEach((card, i) => {
    const bucket = bySuit.get(card.suit);
    if (bucket) bucket.push(i);
    else bySuit.set(card.suit, [i]);
  });

  for (const indices of bySuit.values()) {
    const sorted = indices.slice().sort((x, y) => cards[x].rank - cards[y].rank);
    for (let start = 0; start < sorted.length; start++) {
      for (let end = start + 2; end < sorted.length; end++) {
        let consecutive = true;
        for (let k = start; k < end; k++) {
          if (cards[sorted[k + 1]].rank !== cards[sorted[k]].rank + 1) {
            consecutive = false;
            break;
          }
        }
        // Once the chain breaks, every longer window from this start breaks too.
        if (!consecutive) break;
        out.push(makeCandidate('run', sorted.slice(start, end + 1)));
      }
    }
  }

  return out;
}

function makeCandidate(kind: MeldKind, indices: number[]): Candidate {
  let mask = 0;
  for (const i of indices) mask |= 1 << i;
  return { kind, mask, indices };
}

/**
 * The cheapest arrangement of a hand.
 *
 * Ties on points are broken towards FEWER leftover cards. Two arrangements can
 * both leave 8 points -- one as a single 8, one as 1+7 -- and the single card is
 * strictly better to hold: it is one fewer card an opponent can lay off against
 * after a knock, and one fewer card to replace.
 */
export function analyzeHand(cards: readonly Card[]): HandAnalysis {
  if (cards.length > 30) {
    // The bitmask is per-hand-position, so this is only ever a programming
    // error (a deck passed where a hand was meant), not a reachable game state.
    throw new Error(`analyzeHand expects a hand, got ${cards.length} cards`);
  }

  const cands = candidates(cards);
  const full = cards.length === 0 ? 0 : (1 << cards.length) - 1;

  // memo[mask] = best achievable from exactly these remaining cards.
  const bestPoints = new Map<number, number>();
  const bestCount = new Map<number, number>();
  const bestPick = new Map<number, Candidate | null>();

  function solve(mask: number): number {
    const seen = bestPoints.get(mask);
    if (seen !== undefined) return seen;

    // Melding nothing further: every remaining card is deadwood.
    let points = 0;
    let count = 0;
    for (let i = 0; i < cards.length; i++) {
      if (mask & (1 << i)) {
        points += cardPoints(cards[i]);
        count++;
      }
    }
    let pick: Candidate | null = null;

    // Memo-before-recurse is safe: removing a meld always shrinks the mask, so
    // the recursion is strictly decreasing and cannot revisit `mask`.
    bestPoints.set(mask, points);
    bestCount.set(mask, count);
    bestPick.set(mask, null);

    for (const cand of cands) {
      if ((cand.mask & mask) !== cand.mask) continue;
      const rest = mask & ~cand.mask;
      const restPoints = solve(rest);
      const restCount = bestCount.get(rest) ?? 0;
      if (restPoints < points || (restPoints === points && restCount < count)) {
        points = restPoints;
        count = restCount;
        pick = cand;
      }
    }

    bestPoints.set(mask, points);
    bestCount.set(mask, count);
    bestPick.set(mask, pick);
    return points;
  }

  const deadwoodPoints = solve(full);

  // Walk the recorded choices back out into actual melds.
  const melds: Meld[] = [];
  let mask = full;
  for (;;) {
    const pick = bestPick.get(mask);
    if (!pick) break;
    melds.push({ kind: pick.kind, cards: pick.indices.map((i) => cards[i]) });
    mask &= ~pick.mask;
  }

  const deadwood: Card[] = [];
  for (let i = 0; i < cards.length; i++) if (mask & (1 << i)) deadwood.push(cards[i]);

  return { melds, deadwood, deadwoodPoints };
}

/** Convenience for the hot path: the solver only ever wants the number. */
export function deadwoodPoints(cards: readonly Card[]): number {
  return analyzeHand(cards).deadwoodPoints;
}

/**
 * Whether `card` extends `meld` -- the layoff test.
 *
 * A set takes a fourth of the same rank. A run extends at either end, and only
 * within 1..10, which is where "ace is low, no wrap" is actually enforced: there
 * is no rank 0 and no rank 11, so nothing can be laid off past either end.
 */
export function extendsMeld(meld: Meld, card: Card): boolean {
  if (meld.kind === 'set') {
    return meld.cards.length < 4 && meld.cards[0].rank === card.rank;
  }
  if (card.suit !== meld.cards[0].suit) return false;
  const ranks = meld.cards.map((c) => c.rank);
  const low = Math.min(...ranks);
  const high = Math.max(...ranks);
  return card.rank === low - 1 || card.rank === high + 1;
}

export function meldId(meld: Meld): string {
  return `${meld.kind}:${meld.cards.map(cardId).join('-')}`;
}

/** Sanity helper used by the tests and worth keeping: melds must be disjoint,
 * must cover no card twice, and together with deadwood must equal the hand. */
export function analysisIsConsistent(cards: readonly Card[], a: HandAnalysis): boolean {
  const seen = new Map<string, number>();
  const bump = (c: Card) => seen.set(cardId(c), (seen.get(cardId(c)) ?? 0) + 1);
  for (const m of a.melds) m.cards.forEach(bump);
  a.deadwood.forEach(bump);
  if (seen.size !== cards.length) return false;
  for (const c of cards) if (seen.get(cardId(c)) !== 1) return false;
  return a.deadwoodPoints === handPoints(a.deadwood);
}

/**
 * Every meld the hand contains, each counted once at its longest.
 *
 * Different question from `analyzeHand`, and the difference matters. That one
 * answers "how should these cards be arranged to score best", so it returns
 * melds that are DISJOINT -- each card used once, because each card can only
 * be scored once. This one answers "what have I got", and the honest answer
 * overlaps: holding the Jack, Horse and King of roots plus two more Jacks, the
 * Jack of roots belongs to a run AND to a set, and a player deciding what to
 * throw needs to see both.
 *
 * Maximal only -- a four-card run is reported as one run, not as the three
 * overlapping three-card windows inside it. That keeps the count honest (a
 * four-run is one thing you have, not three) and has a useful consequence:
 * maximal runs within a suit are disjoint by construction and there is one set
 * per rank, so no card is ever in more than two of these. Two is therefore the
 * most a card ever has to display.
 */
export function allMelds(cards: readonly Card[]): Meld[] {
  const out: Meld[] = [];

  const byRank = new Map<Rank, Card[]>();
  for (const card of cards) {
    const bucket = byRank.get(card.rank);
    if (bucket) bucket.push(card);
    else byRank.set(card.rank, [card]);
  }
  for (const group of byRank.values()) {
    if (group.length >= 3) out.push({ kind: 'set', cards: group.slice() });
  }

  const bySuit = new Map<Suit, Card[]>();
  for (const card of cards) {
    const bucket = bySuit.get(card.suit);
    if (bucket) bucket.push(card);
    else bySuit.set(card.suit, [card]);
  }
  for (const group of bySuit.values()) {
    const sorted = group.slice().sort((a, b) => a.rank - b.rank);
    let start = 0;
    for (let i = 1; i <= sorted.length; i++) {
      // Walk to the end of each consecutive chain, then emit it if it is long
      // enough. Ranks are unique within a suit in a 40-card deck, so a break is
      // simply a gap of more than one.
      const broken = i === sorted.length || sorted[i].rank !== sorted[i - 1].rank + 1;
      if (!broken) continue;
      if (i - start >= 3) out.push({ kind: 'run', cards: sorted.slice(start, i) });
      start = i;
    }
  }

  // Sorted so that a given hand always produces the same order, which is what
  // lets the UI colour melds by position without them swapping hues on an
  // unrelated re-render.
  return out.sort(
    (a, b) =>
      a.cards[0].rank - b.cards[0].rank ||
      a.kind.localeCompare(b.kind) ||
      a.cards[0].suit.localeCompare(b.cards[0].suit)
  );
}

/** Which of `melds` contain `card`, by index. At most two -- see `allMelds`. */
export function meldsHolding(melds: readonly Meld[], card: Card): number[] {
  const id = cardId(card);
  const out: number[] = [];
  melds.forEach((meld, i) => {
    if (meld.cards.some((c) => cardId(c) === id)) out.push(i);
  });
  return out;
}
