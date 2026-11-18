import { type Policy, playSeed } from './fast';

/**
 * Matches: hands until someone reaches the target.
 *
 * The ruleset says a game is played to 100 and says nothing else, so the
 * assumptions are written down here rather than buried:
 *
 *  - The first hand is opened by the first-named player and the opening
 *    alternates every deal after that, pushes included. (Gin's "winner deals"
 *    convention is a switch below, but alternating is the neutral default --
 *    it gives neither style of play a structural edge.)
 *  - A push scores nothing and the next deal comes straight away.
 *  - Reaching the target ends the match at once; no game or box bonuses.
 *
 * Deal k of match `seed` always comes from the same shuffle, whoever is
 * playing, which is what lets two players be compared on identical cards: play
 * the match once each way round and the deals cancel out.
 */
export interface MatchRules {
  target: number;
  opener: 'alternate' | 'loser-opens';
}

export const MATCH_RULES: MatchRules = { target: 100, opener: 'alternate' };

export interface MatchResult {
  /** 0 if the first-named player won, 1 if the second did. */
  winner: 0 | 1;
  hands: number;
  scores: [number, number];
}

export function dealSeed(match: number, hand: number): number {
  return (Math.imul(match, 0x9e3779b1) ^ Math.imul(hand + 1, 0x85ebca6b)) >>> 0;
}

/**
 * Play one match. `players[0]` is the first-named player throughout; the seat
 * each occupies changes hand by hand with the opening.
 */
export function playMatch(
  players: readonly [Policy, Policy],
  match: number,
  rules: MatchRules = MATCH_RULES,
  maxHands = 200
): MatchResult {
  const scores: [number, number] = [0, 0];
  let opener: 0 | 1 = 0;
  for (let k = 0; k < maxHands; k++) {
    const order: [Policy, Policy] = opener === 0 ? [players[0], players[1]] : [players[1], players[0]];
    // Scores as each seat sees them: seat 0 is whoever opens.
    const seatScores: [number, number] =
      opener === 0 ? [scores[0], scores[1]] : [scores[1], scores[0]];
    const t = playSeed(dealSeed(match, k), order, undefined, seatScores, rules.target);
    // Seat 0 of the table is player `opener`.
    const toFirst: number = opener === 0 ? t.margin : -t.margin;
    if (toFirst > 0) scores[0] += toFirst;
    else if (toFirst < 0) scores[1] += -toFirst;

    if (scores[0] >= rules.target || scores[1] >= rules.target) {
      return { winner: scores[0] >= rules.target ? 0 : 1, hands: k + 1, scores };
    }
    if (rules.opener === 'alternate' || toFirst === 0) opener = opener === 0 ? 1 : 0;
    else opener = toFirst > 0 ? 1 : 0;
  }
  return { winner: scores[0] >= scores[1] ? 0 : 1, hands: maxHands, scores };
}
