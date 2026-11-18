import { duel, heuristic, solverPlayer } from '../arena';
import { FAST_SOLVE } from '../solver';
import { seatedFactory } from './adapter';
import { makePolicy } from './panel';
import { positional, resolve, settingsFrom } from './registry';

/**
 * Lab players against the original arena players, on the real referee.
 *
 *   npx tsx src/gin/lab/referee.run.ts PLAYER [deals] [--vs solver|heuristic-sharp]
 *
 * The arena's `solver` is the earlier belief-and-rollout player from
 * solver.ts: a different program, built before any of the lab existed, so it
 * is the nearest thing here to an outside competitor.
 */
const args = process.argv.slice(2);
const plain = positional(args);
const who = plain[0] ?? 'champion-eq';
const deals = Number(plain[1] ?? 100);
const vsAt = args.indexOf('--vs');
const vs = vsAt >= 0 ? args[vsAt + 1] : 'solver';
const spec = resolve(who, settingsFrom(args));
let seed = 1;
const mine = seatedFactory(() => makePolicy(spec, seed++));
const theirs = vs === 'solver' ? solverPlayer(FAST_SOLVE) : heuristic('sharp');

const t0 = Date.now();
const result = duel(mine, theirs, deals, Number(process.env.GIN_SEED) || 404);
const t = Math.abs(result.edge) / result.error;
console.log(`${who} vs ${vs} on the referee, ${deals * 2} hands, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`  ${result.edge >= 0 ? '+' : ''}${result.edge.toFixed(2)} +/- ${result.error.toFixed(2)} points per hand (${t.toFixed(1)} standard errors)`);
console.log(`  hands won ${result.aWins}-${result.bWins}, pushed ${result.pushes}, fouls ${result.fouls}`);
