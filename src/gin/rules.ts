import { type Card, cardPoints, handPoints } from './cards';
import { type Meld, analyzeHand, extendsMeld } from './melds';

/**
 * The ruleset, as configuration rather than constants scattered through the
 * code.
 *
 * Three of these fields are decisions that playtesting should settle, not
 * assumptions worth freezing into the engine:
 *
 *  - `stockOut`. Ten cards each plus an upcard leaves only 19 in stock out of
 *    40, roughly nine or ten draws apiece. Hands will hit the end of the stock
 *    often enough that this is routine rather than an edge case, so it is a
 *    switch: abandon the hand, or turn the discard pile over and keep going.
 *  - `tieGoesToDefender`. "Beat the other player after they knocked" could mean
 *    strictly fewer points or could include a tie. Standard Gin Rummy gives the
 *    tie to the defender, so that is the default here, but it is one boolean.
 *  - `layoffAgainstGin`. Standard Gin Rummy forbids laying off against a gin,
 *    which is most of what makes gin worth chasing. Also one boolean.
 */
/**
 * How many cards are left in the stock when a hand is a push.
 *
 * Two, which is the ordinary rule and not an arbitrary floor: a player who
 * draws the third-from-last card can still be left holding a hand nobody can
 * improve, and dealing out the last two to no purpose only makes both players
 * play on knowing the hand is already decided. Stopping at two ends it while
 * the position is still live.
 */
export const STOCK_FLOOR = 2;

export interface GinRules {
  handSize: number;
  knockMaxDeadwood: number;
  ginBonus: number;
  bigGinBonus: number;
  undercutBonus: number;
  stockOut: 'dead-hand' | 'reshuffle';
  tieGoesToDefender: boolean;
  layoffAgainstGin: boolean;
}

export const NAPOLETANE_GIN: GinRules = {
  handSize: 10,
  knockMaxDeadwood: 8,
  ginBonus: 20,
  bigGinBonus: 30,
  undercutBonus: 10,
  stockOut: 'dead-hand',
  tieGoesToDefender: true,
  layoffAgainstGin: false,
};

// --- Knocking -----------------------------------------------------------------

export interface KnockOption {
  /** The card to throw as part of knocking. */
  discard: Card;
  /** Deadwood of the ten cards left behind. */
  deadwoodPoints: number;
  legal: boolean;
  gin: boolean;
}

/**
 * Every discard available to a player holding handSize + 1 cards, with the
 * deadwood each one leaves.
 *
 * Knocking is a decision made while holding eleven cards: you keep ten and
 * throw one, and the ten you keep are what gets measured. So the question is
 * never "can this hand knock" but "is there a discard that leaves me at or
 * under the threshold", which is what this answers. Sorted cheapest first, so
 * the head of the list is the best knock available.
 */
export function knockOptions(cards: readonly Card[], rules: GinRules = NAPOLETANE_GIN): KnockOption[] {
  const options: KnockOption[] = cards.map((discard, i) => {
    const kept = cards.filter((_, j) => j !== i);
    const { deadwoodPoints } = analyzeHand(kept);
    return {
      discard,
      deadwoodPoints,
      legal: deadwoodPoints <= rules.knockMaxDeadwood,
      gin: deadwoodPoints === 0,
    };
  });
  // Cheapest first; on a tie throw the more expensive card, since holding a
  // high card is what gets punished if the opponent knocks next turn.
  return options.sort(
    (a, b) => a.deadwoodPoints - b.deadwoodPoints || cardPoints(b.discard) - cardPoints(a.discard)
  );
}

export function canKnock(cards: readonly Card[], rules: GinRules = NAPOLETANE_GIN): boolean {
  return knockOptions(cards, rules).some((o) => o.legal);
}

/**
 * Big gin: all eleven cards meld, so there is nothing to throw.
 *
 * Checked on the full hand before any discard, which is exactly what
 * distinguishes it from ordinary gin -- gin melds ten and discards the
 * eleventh, big gin melds the lot.
 */
export function isBigGin(cards: readonly Card[], rules: GinRules = NAPOLETANE_GIN): boolean {
  if (cards.length !== rules.handSize + 1) return false;
  return analyzeHand(cards).deadwoodPoints === 0;
}

// --- Laying off ---------------------------------------------------------------

/** One defender card, and which of the knocker's melds swallowed it. */
export interface LayoffPlacement {
  card: Card;
  /** Index into the `knockerMelds` array that was passed in. */
  meldIndex: number;
}

export interface LayoffResult {
  laidOff: Card[];
  /**
   * The same cards, each paired with the meld it joined.
   *
   * Recorded as it happens rather than worked out afterwards, because the
   * target is genuinely ambiguous once the dust settles: lay a 5 off onto
   * 6-7-8 and a 4 now extends the run that created, so reading the finished
   * melds cannot tell you which card arrived first. The showdown animation
   * needs the real sequence, and this is the only place that knows it.
   */
  placements: LayoffPlacement[];
  remaining: Card[];
  remainingPoints: number;
}

/**
 * Push as much of the defender's deadwood as possible onto the knocker's melds.
 *
 * Greedy by point value, and that is genuinely optimal here rather than merely
 * convenient. Laying a card off never removes an option for another card:
 * extending a run only widens the range it will accept, and a set has exactly
 * one vacancy which only one card in the deck can fill (three of the four of
 * that rank are already in the meld). The single case where two cards compete
 * is two deadwood cards of the same rank eyeing one set vacancy, and taking the
 * more expensive one first is the right answer. So highest-value-first, repeated
 * until nothing more fits, cannot be beaten.
 */
export function layOff(deadwood: readonly Card[], knockerMelds: readonly Meld[]): LayoffResult {
  // Copy the melds, since laying off mutates their extents as runs grow.
  const melds: Meld[] = knockerMelds.map((m) => ({ kind: m.kind, cards: m.cards.slice() }));
  const remaining = deadwood.slice().sort((a, b) => cardPoints(b) - cardPoints(a));
  const laidOff: Card[] = [];
  const placements: LayoffPlacement[] = [];

  for (;;) {
    let placed = false;
    for (let i = 0; i < remaining.length; i++) {
      const card = remaining[i];
      const meldIndex = melds.findIndex((m) => extendsMeld(m, card));
      if (meldIndex < 0) continue;
      melds[meldIndex].cards.push(card);
      laidOff.push(card);
      placements.push({ card, meldIndex });
      remaining.splice(i, 1);
      placed = true;
      break; // Restart: that card may have widened a run for a cheaper one.
    }
    if (!placed) break;
  }

  return { laidOff, placements, remaining, remainingPoints: handPoints(remaining) };
}

// --- Scoring ------------------------------------------------------------------

export type HandOutcome = 'gin' | 'big-gin' | 'knock' | 'undercut' | 'dead-hand';

export interface HandScore {
  outcome: HandOutcome;
  /** Who takes the points. Null only for a dead hand. */
  winner: 'knocker' | 'defender' | null;
  points: number;
  knockerDeadwood: number;
  /** Defender's deadwood after any permitted layoffs. */
  defenderDeadwood: number;
  laidOff: Card[];
  /**
   * The knocker's melds as they stood BEFORE any laying off, which is what
   * `layoffs[].meldIndex` points into.
   *
   * Carried in the score rather than left to the client to recompute. The
   * client would get the same answer today, `analyzeHand` being
   * deterministic, but only because the hand array happens to reach it in the
   * same order -- a coincidence to rest an animation on rather than a promise.
   */
  knockerMelds: Meld[];
  layoffs: LayoffPlacement[];
}

/**
 * Score a completed hand.
 *
 * `knockerCards` is the ten cards kept after the knocking discard, or all
 * eleven for a big gin. `defenderCards` is the defender's ten.
 */
export function scoreHand(
  knockerCards: readonly Card[],
  defenderCards: readonly Card[],
  rules: GinRules = NAPOLETANE_GIN
): HandScore {
  const bigGin = isBigGin(knockerCards, rules);
  const knocker = analyzeHand(knockerCards);
  const defender = analyzeHand(defenderCards);

  const knockerDeadwood = knocker.deadwoodPoints;
  const isGin = !bigGin && knockerDeadwood === 0;

  // A gin knock is normally un-layoff-able, which is the whole reason to chase
  // it rather than knock early at 8.
  const mayLayOff = rules.layoffAgainstGin || (!isGin && !bigGin);
  const layoff = mayLayOff
    ? layOff(defender.deadwood, knocker.melds)
    : {
        laidOff: [],
        placements: [],
        remaining: defender.deadwood.slice(),
        remainingPoints: defender.deadwoodPoints,
      };

  const defenderDeadwood = layoff.remainingPoints;

  if (bigGin) {
    return {
      outcome: 'big-gin',
      winner: 'knocker',
      points: rules.bigGinBonus + defenderDeadwood,
      knockerDeadwood,
      defenderDeadwood,
      laidOff: layoff.laidOff,
      knockerMelds: knocker.melds,
      layoffs: layoff.placements,
    };
  }

  if (isGin) {
    return {
      outcome: 'gin',
      winner: 'knocker',
      points: rules.ginBonus + defenderDeadwood,
      knockerDeadwood,
      defenderDeadwood,
      laidOff: layoff.laidOff,
      knockerMelds: knocker.melds,
      layoffs: layoff.placements,
    };
  }

  const undercut = rules.tieGoesToDefender
    ? defenderDeadwood <= knockerDeadwood
    : defenderDeadwood < knockerDeadwood;

  if (undercut) {
    return {
      outcome: 'undercut',
      winner: 'defender',
      points: rules.undercutBonus + (knockerDeadwood - defenderDeadwood),
      knockerDeadwood,
      defenderDeadwood,
      laidOff: layoff.laidOff,
      knockerMelds: knocker.melds,
      layoffs: layoff.placements,
    };
  }

  return {
    outcome: 'knock',
    winner: 'knocker',
    points: defenderDeadwood - knockerDeadwood,
    knockerDeadwood,
    defenderDeadwood,
    laidOff: layoff.laidOff,
    knockerMelds: knocker.melds,
    layoffs: layoff.placements,
  };
}

/** A hand that ran out of stock with nobody knocking. */
export function deadHand(): HandScore {
  return {
    outcome: 'dead-hand',
    winner: null,
    points: 0,
    knockerDeadwood: 0,
    defenderDeadwood: 0,
    laidOff: [],
    knockerMelds: [],
    layoffs: [],
  };
}
