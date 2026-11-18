import { careless, greedy, heuristic, hoarder, magpie, playHand, solverPlayer } from './arena';
import { DEFAULT_SOLVE } from './solver';
import { format, record, review } from './review';
import { botConfig, playOut } from './bot';
import { deal } from './game';
import { rng } from './cards';

/**
 * Review a hand.
 *
 *   npx tsx src/gin/review.run.ts [seed] [seat]
 *
 * Plays a hand between two bots, then goes back over it for the chosen seat
 * using only what that seat could see at each move.
 */
const args = process.argv.slice(2);
const seed = Number(args[0] ?? 4242);
const seat = (Number(args[1] ?? 0) === 1 ? 1 : 0) as 0 | 1;

const next = rng(seed + 1);
const finished = playOut(deal(seed), [botConfig('steady', next), botConfig('sharp', next)]);
const hand = record(finished);

console.log(
  `hand ${seed}: ${finished.score?.outcome ?? 'unfinished'} for ${
    finished.knocker === null ? 'nobody' : `seat ${finished.knocker}`
  }, ${finished.score?.points ?? 0} points, ${hand.history.length} moves`
);
console.log(`reviewing seat ${seat}\n`);

const started = Date.now();
const decisions = review(hand, seat, { ...DEFAULT_SOLVE, next });
console.log(format(decisions, `seat ${seat}`));
console.log(`\n${((Date.now() - started) / 1000).toFixed(1)}s`);
