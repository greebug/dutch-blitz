import type { Player } from './arena';
import { type MatchContext, seated } from './lab/adapter';
import { champion } from './lab/champion';
import { buildEquity } from './lab/equity';
import type { ExpertParams } from './lab/expert';
import { expert } from './lab/expert';
import { makePolicy } from './lab/panel';
import release from './lab/champions/release.json';
import margins from './lab/champions/margins.json';

/**
 * The opponents a person can sit down against.
 *
 *  - **Hard** is the tournament champion: inference over the opponent's hand,
 *    then a search over sampled worlds, scored in match equity.
 *  - **Medium** is the tuned expert the champion searches with (expert-v4),
 *    playing without the search: strong, and about a point a hand weaker.
 *  - **Easy** is the human model -- takes anything that completes a meld,
 *    knocks the moment it can, shies away from feeding your pickups, and
 *    slips one decision in seven.
 *
 * Every level plays through the adapter, so it sees exactly what a person in
 * its chair would: its own cards and the public record. None of them reads the
 * game state, even though in solo play it sits in the same browser tab.
 */
export type Level = 'easy' | 'medium' | 'hard';

export const LEVELS: { level: Level; label: string; blurb: string }[] = [
  { level: 'easy', label: 'Easy', blurb: 'plays like a casual human' },
  { level: 'medium', label: 'Medium', blurb: 'the tuned expert, no lookahead' },
  { level: 'hard', label: 'Hard', blurb: 'the champion' },
];

const params = release.params as ExpertParams;
const equity = buildEquity(new Map(Object.entries(margins as Record<string, number>).map(([m, p]) => [Number(m), p])));

/**
 * Search effort for Hard. The edge over Medium grows with worlds (+1.0 per
 * hand at 60, +1.4 at 200 in the lab); 150 keeps a decision well under a
 * tenth of a second in a browser.
 */
/**
 * Stamped on every logged hand, so games against different builds of the
 * computer can be told apart. Bump it whenever a level changes.
 *   v3      expert-v3; Hard at 600 particles (first release)
 *   v4-p4k  expert-v4 (blind-draw upcard rule); Hard at 4,000 particles
 */
export const OPPONENTS_VERSION = 'v4-p4k';

export const HARD_WORLDS = 150;

/**
 * Guesses at the opponent's hand. 4,000 beat 600 by +0.50 +/- 0.13 points a
 * hand over 10,000 hands, at no measurable cost in decision time (~25ms
 * either way): the filter is cheap next to the rollouts, and a thin cloud of
 * guesses is a noisy read of the person's hand.
 */
export const HARD_PARTICLES = 4000;

export function makeOpponent(level: Level, seed: number, match: () => MatchContext): Player {
  switch (level) {
    case 'easy':
      return seated(makePolicy({ kind: 'human' }, seed), match);
    case 'medium':
      return seated(expert(params, Math.random, 'medium'), match);
    case 'hard':
      return seated(
        champion({
          worlds: HARD_WORLDS,
          width: 4,
          particles: HARD_PARTICLES,
          rollout: params,
          equity,
          confidence: 1.5,
          seed,
          name: 'champion',
        }),
        match
      );
  }
}
