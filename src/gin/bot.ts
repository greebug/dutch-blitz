import { type Card, cardPoints } from './cards';
import { analyzeHand } from './melds';
import { type GinRules, isBigGin, knockOptions } from './rules';
import {
  type GinAction,
  type GinState,
  type Phase,
  type Seat,
  apply,
  other,
} from './game';

/**
 * A deliberately simple opponent: enough to play a real hand against, and
 * enough to prove the state machine works end to end, but no search.
 *
 * It is structured so the Monte Carlo engine can replace `chooseAction`
 * wholesale later without anything around it changing. Difficulty will then be
 * rollout count; for now it is `knockThreshold` and `blunderRate`.
 *
 * What it knowingly ignores, and what a real solver will have to weigh:
 *  - Taking from the discard pile tells the opponent a great deal about your
 *    hand. This bot takes any card that helps, which is readable and therefore
 *    exploitable.
 *  - It never infers anything from what the opponent draws or throws. Belief
 *    state is phase 4; there is none here.
 *  - It knocks on a fixed threshold rather than weighing undercut risk against
 *    the chance of improving.
 */
export interface BotConfig {
  /** Knock once deadwood is at or under this. The rules cap is the ceiling. */
  knockThreshold: number;
  /** Chance per discard of throwing something other than the best card. */
  blunderRate: number;
  next: () => number;
}

export function botConfig(level: 'easy' | 'steady' | 'sharp', next: () => number): BotConfig {
  switch (level) {
    // Throws away value often enough to be beatable while still making melds.
    case 'easy':
      return { knockThreshold: 8, blunderRate: 0.35, next };
    case 'steady':
      return { knockThreshold: 8, blunderRate: 0.1, next };
    // Holds out for a cheaper knock rather than taking the first legal one,
    // which is most of the gap between "legal" and "good" in this ruleset.
    case 'sharp':
      return { knockThreshold: 4, blunderRate: 0, next };
  }
}

export function chooseAction(state: GinState, seat: Seat, config: BotConfig): GinAction {
  return chooseFrom(
    state.hands[seat],
    state.discard[state.discard.length - 1] ?? null,
    state.stock.length,
    state.phase,
    state.rules,
    config
  );
}

/**
 * The same choice, from what a player can actually see.
 *
 * Split out so the bot can be run from a redacted view rather than from the
 * state: the arena needs every strategy to answer the same question from the
 * same information, or a comparison between them means nothing.
 */
export function chooseFrom(
  hand: readonly Card[],
  top: Card | null,
  stockCount: number,
  phase: Phase,
  rules: GinRules,
  config: BotConfig
): GinAction {
  if (phase === 'draw') {
    const canTakeStock = stockCount > 0;
    if (!top) return { type: 'draw', from: 'stock' };
    if (!canTakeStock) return { type: 'draw', from: 'discard' };

    // Does the visible card actually improve the best ten we could keep?
    const current = analyzeHand(hand).deadwoodPoints;
    const withTop = knockOptions([...hand, top], rules)[0].deadwoodPoints;
    return withTop < current
      ? { type: 'draw', from: 'discard' }
      : { type: 'draw', from: 'stock' };
  }

  // Discard phase, holding handSize + 1.
  if (isBigGin(hand, rules)) return { type: 'big-gin' };

  const options = knockOptions(hand, rules);
  const best = options[0];

  if (best.legal && best.deadwoodPoints <= config.knockThreshold) {
    return { type: 'knock', discard: best.discard };
  }

  // A blunder throws a card that is useful rather than the cheapest one -- the
  // mistake a human actually makes, as opposed to random noise.
  if (config.blunderRate > 0 && options.length > 1 && config.next() < config.blunderRate) {
    const pick = 1 + Math.floor(config.next() * (options.length - 1));
    return { type: 'discard', card: options[Math.min(pick, options.length - 1)].discard };
  }

  return { type: 'discard', card: best.discard };
}

/** Highest-value card not currently in a meld -- what a human calls "the card
 * I'm about to get stuck with". Exposed for the UI's nudge, not used above. */
export function riskiestCard(hand: readonly Card[]): Card | null {
  const { deadwood } = analyzeHand(hand);
  if (deadwood.length === 0) return null;
  return deadwood.reduce((worst, c) => (cardPoints(c) > cardPoints(worst) ? c : worst));
}

/**
 * Run a hand to completion with bots in both seats.
 *
 * Doubles as the integration test for the state machine: anything that can
 * deadlock, loop, or reach an illegal state shows up here across a few thousand
 * seeds far faster than it would through a UI.
 */
export function playOut(
  state: GinState,
  configs: [BotConfig, BotConfig],
  maxTurns = 500
): GinState {
  let current = state;
  for (let i = 0; i < maxTurns && current.phase !== 'over'; i++) {
    const seat = current.turn;
    current = apply(current, seat, chooseAction(current, seat, configs[seat]));
  }
  if (current.phase !== 'over') {
    throw new Error(`hand did not finish in ${maxTurns} turns -- state machine is looping`);
  }
  return current;
}

/** Who gained, from seat 0's point of view. Handy for win-rate measurements. */
export function marginForSeat0(state: GinState): number {
  if (!state.score || state.score.winner === null) return 0;
  const knocker = state.knocker ?? 0;
  const winnerSeat = state.score.winner === 'knocker' ? knocker : other(knocker);
  return winnerSeat === 0 ? state.score.points : -state.score.points;
}
