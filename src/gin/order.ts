import { type Card, type Rank, type Suit, SUITS, cardId } from './cards';
import { type Meld, allMelds } from './melds';

/**
 * The order a hand sits in on screen.
 *
 * Purely presentational -- the engine neither knows nor cares what order the
 * cards arrive in -- but it is the difference between a hand you can read and
 * one you have to search. Two layers:
 *
 *  1. What you have built comes first, meld by meld, then everything else.
 *     A set or a run is a thing you are holding on purpose, and it should sit
 *     together where you can see it is still whole.
 *
 *  2. Inside a meld, and across the deadwood that follows, ascending by rank,
 *     leading each rank with the suit that continues the rank below -- so a
 *     6 of swords, a 7 of goblets and a 7 of swords come out 6sw, 7sw, 7go and
 *     the near-run reads as one stretch.
 *
 * The part worth explaining is what happens when a card is in two melds at
 * once. Hold the 6, 7 and Jack of goblets with two more Jacks and the Jack of
 * goblets is the end of a run AND one of three Jacks; there is no arrangement
 * that puts it inside both groups, but there is one that puts it between them:
 *
 *     6 goblets · 7 goblets · JACK OF GOBLETS · Jack of roots · Jack of swords
 *
 * So melds that share a card are laid out as one unbroken stretch, hinged on
 * the shared card, which is adjacent to every card it could be melded with.
 * That is the arrangement the two glow rings are describing, and this is the
 * row that matches it.
 */

const SUIT_INDEX = new Map<Suit, number>(SUITS.map((suit, i) => [suit, i]));

function bySuit(a: Card, b: Card): number {
  return SUIT_INDEX.get(a.suit)! - SUIT_INDEX.get(b.suit)!;
}

/**
 * A name for each meld that survives the meld growing.
 *
 * There is only one set per rank and rarely more than one run per suit, so
 * those are the names -- and a run that gains a fourth card, or a set that
 * gains its fourth suit, keeps the name it had. That is the point: the order
 * melds were finished in is only stable if a meld stays recognisably itself
 * while it grows.
 */
function keysOf(melds: readonly Meld[]): string[] {
  const runs = new Map<string, number>();
  return melds.map((meld) => {
    if (meld.kind === 'set') return `set:${meld.cards[0].rank}`;
    const suit = meld.cards[0].suit;
    const nth = runs.get(suit) ?? 0;
    runs.set(suit, nth + 1);
    return `run:${suit}:${nth}`;
  });
}

/** The melds in this hand, named, for keeping a record of what was finished. */
export function meldOrderKeys(cards: readonly Card[]): string[] {
  return keysOf(allMelds(byRank(cards)));
}

/**
 * @param completed Meld names in the order they were finished, oldest first.
 *   The melds are laid out in reverse, so the newest sits leftmost and reading
 *   the row right to left gives the order they came together in. Without it,
 *   or for a meld not named in it, melds fall back to lowest card first.
 */
export function sortHand(cards: readonly Card[], completed: readonly string[] = []): Card[] {
  // From a canonical order, so the answer depends on which cards are held and
  // never on the order they happened to arrive in.
  const canonical = byRank(cards);
  const melds = allMelds(canonical);
  if (melds.length === 0) return canonical;
  const names = keysOf(melds);

  const out: Card[] = [];
  const placed = new Set<string>();
  const walked = new Set<number>();

  /**
   * Which meld opens, and which follows.
   *
   * Newest first, so that finishing one does not move the melds already there.
   * Ordering them by rank instead reads beautifully on any single hand and is
   * miserable to play with: a run completed at the low end jumps to the front
   * and shoves everything you had already found along with it, and the hand
   * you had learned to read is gone. A meld nobody has a record of -- a hand
   * dealt with one already in it -- falls back to lowest card first.
   */
  const starts = melds
    .map((_, i) => i)
    .sort((a, b) => completed.indexOf(names[b]) - completed.indexOf(names[a]));

  for (const first of starts) {
    if (walked.has(first)) continue;
    let current = first;
    let entry: string | null = null;

    for (;;) {
      walked.add(current);
      const meld = melds[current];
      // The card to leave by: one this meld shares with a meld not yet laid
      // out. Never the card we came in on -- that one is already placed, and a
      // meld cannot hinge on the same card at both ends.
      let next = -1;
      let bridge: string | null = null;
      for (const other of starts) {
        if (walked.has(other)) continue;
        const shared = meld.cards.find(
          (c) => cardId(c) !== entry && melds[other].cards.some((o) => cardId(o) === cardId(c))
        );
        if (shared) {
          next = other;
          bridge = cardId(shared);
          break;
        }
      }

      for (const card of layOut(meld, entry, bridge)) {
        const id = cardId(card);
        if (placed.has(id)) continue;
        placed.add(id);
        out.push(card);
      }

      if (next < 0) break;
      entry = bridge;
      current = next;
    }
  }

  // Everything in no meld at all, after -- which is also everything the
  // deadwood number is counting, gathered in one place at the end of the hand.
  out.push(...byRank(cards.filter((c) => !placed.has(cardId(c)))));
  return out;
}

/**
 * One meld's cards, hinged on the cards it shares with its neighbours.
 *
 * `entry` is the card the previous meld ended on and is already on the table;
 * `bridge` is the card the next meld will start from, so it goes last. A run
 * keeps its rank order either way -- a run written out of order stops looking
 * like a run -- but it may be read downwards when that is the end the previous
 * meld left us at.
 */
function layOut(meld: Meld, entry: string | null, bridge: string | null): Card[] {
  if (meld.kind === 'run') {
    const run = meld.cards.slice().sort((a, b) => a.rank - b.rank);
    const anchor = entry ?? bridge;
    if (!anchor) return run;
    const at = run.findIndex((c) => cardId(c) === anchor);
    if (at < 0) return run;
    // Enter at the high end, and the run reads downwards so the shared card is
    // still the one touching its neighbour; leave by the high end and it reads
    // up, which is the ordinary case.
    const wantsFirst = entry !== null;
    const nearTop = at > (run.length - 1) / 2;
    return wantsFirst === nearTop ? run.reverse() : run;
  }

  const set = meld.cards.slice().sort(bySuit);
  if (entry) {
    const at = set.findIndex((c) => cardId(c) === entry);
    if (at > 0) set.unshift(set.splice(at, 1)[0]);
  }
  if (bridge && bridge !== entry) {
    const at = set.findIndex((c) => cardId(c) === bridge);
    if (at >= 0 && at < set.length - 1) set.push(set.splice(at, 1)[0]);
  }
  return set;
}

/**
 * Ascending by rank, leading each rank with the suit that continues the rank
 * below.
 *
 * This is the whole arrangement for a hand with nothing in it yet, and the
 * arrangement of the deadwood tail otherwise. The suit rule is what makes a
 * near-miss visible: two cards one rank apart in the same suit sit shoulder to
 * shoulder, so the card that would finish them is obvious.
 *
 * Rank order is never broken for it -- a hand that reshuffles itself to show
 * off a maybe is a hand you have to re-learn every turn -- so it is a
 * preference applied greedily rather than an optimisation, and where two suits
 * are doubled only one of the pairs can be adjacent.
 */
function byRank(cards: readonly Card[]): Card[] {
  const byRankMap = new Map<Rank, Card[]>();
  for (const card of cards) {
    const bucket = byRankMap.get(card.rank);
    if (bucket) bucket.push(card);
    else byRankMap.set(card.rank, [card]);
  }

  const ranks = [...byRankMap.keys()].sort((a, b) => a - b);
  const out: Card[] = [];
  let previous: Card | null = null;

  for (let i = 0; i < ranks.length; i++) {
    const rank = ranks[i];
    const group = byRankMap.get(rank)!.slice().sort(bySuit);

    // Only the immediately next rank can pair with this one; a gap in the hand
    // means nothing here is adjacent to anything there.
    const nextRank = ranks[i + 1];
    const nextSuits =
      nextRank === rank + 1 ? new Set(byRankMap.get(nextRank)!.map((c) => c.suit)) : null;

    // Lead with the suit the previous rank ended on.
    if (previous && previous.rank === rank - 1) {
      const lead = group.findIndex((c) => c.suit === previous!.suit);
      if (lead > 0) group.unshift(group.splice(lead, 1)[0]);
    }

    // End on a suit the next rank also holds, so the same pairing can happen
    // again one rank along. The leading card is only off limits when it is
    // actually earning its place there -- one card cannot serve both ends --
    // and where the rank below has nothing to pair with, the front is free.
    if (nextSuits && group.length > 1) {
      const leading = !!previous && previous.rank === rank - 1 && previous.suit === group[0].suit;
      const first = leading ? 1 : 0;
      const tail = group.findIndex((c, k) => k >= first && nextSuits.has(c.suit));
      if (tail >= first && tail < group.length - 1) group.push(group.splice(tail, 1)[0]);
    }

    out.push(...group);
    previous = group[group.length - 1];
  }

  return out;
}

/**
 * A hand the player has arranged themselves, with new cards filed by rule.
 *
 * Once someone drags a card, the automatic order stops being the truth and
 * their arrangement becomes it -- but only for the cards they have actually
 * placed. A card drawn afterwards has never been positioned by anybody, so it
 * is filed where `sortHand` would have put it: immediately after whichever of
 * its rule-order predecessors is nearest to hand. Dropping it on the end
 * instead would be simpler and much worse, because the one thing a player
 * needs from a hand is to know where a card went without hunting.
 *
 * `manual` may name cards that have since been thrown, and may be missing
 * cards that have since arrived; both are expected, and this is where the two
 * are reconciled. The result always names exactly the cards given.
 */
export function reconcileOrder(
  manual: readonly string[],
  cards: readonly Card[],
  completed: readonly string[] = []
): string[] {
  const present = new Set(cards.map(cardId));
  const out = manual.filter((id) => present.has(id));
  const placed = new Set(out);

  // In rule order, so that two cards arriving at once stay in rule order
  // relative to each other -- the first is placed, and then anchors the second.
  const ruleOrder = sortHand(cards, completed).map(cardId);
  for (let i = 0; i < ruleOrder.length; i++) {
    const id = ruleOrder[i];
    if (placed.has(id)) continue;
    let at = 0;
    for (let back = i - 1; back >= 0; back--) {
      const where = out.indexOf(ruleOrder[back]);
      if (where >= 0) {
        at = where + 1;
        break;
      }
    }
    out.splice(at, 0, id);
    placed.add(id);
  }

  return out;
}

/** The hand in `order`, which must name exactly these cards. */
export function arrangeBy(order: readonly string[], cards: readonly Card[]): Card[] {
  const byId = new Map(cards.map((c) => [cardId(c), c]));
  const out: Card[] = [];
  for (const id of order) {
    const card = byId.get(id);
    if (card) out.push(card);
  }
  return out;
}
