import {
  type PlayerFactory,
  careless,
  duel,
  formatTable,
  greedy,
  heuristic,
  hoarder,
  magpie,
  roundRobin,
  solverPlayer,
} from './arena';
import { DEFAULT_SOLVE, FAST_SOLVE } from './solver';

/**
 * Run the tournament.
 *
 *   npx tsx src/gin/arena.run.ts [hands] [--no-solver] [--slow]
 *
 * `hands` is per pairing, each played twice with the seats swapped. The solver
 * is far slower than the rest of the panel, so it runs on `FAST_SOLVE`
 * settings unless `--slow` is passed.
 */
const args = process.argv.slice(2);
const hands = Number(args.find((a) => /^\d+$/.test(a)) ?? 40);
const withSolver = !args.includes('--no-solver');
const settings = args.includes('--slow') ? DEFAULT_SOLVE : FAST_SOLVE;

const entrants: { name: string; make: PlayerFactory }[] = [
  { name: 'heuristic-sharp', make: heuristic('sharp') },
  { name: 'heuristic-steady', make: heuristic('steady') },
  { name: 'greedy', make: greedy() },
  { name: 'hoarder', make: hoarder(2) },
  { name: 'magpie', make: magpie() },
  { name: 'careless', make: careless() },
];
if (withSolver) {
  entrants.unshift({ name: 'solver', make: solverPlayer(settings) });
}
// A second solver that thinks harder, for checking that the thinking is what
// is doing the work: if more samples does not play better, the rollouts are
// not measuring anything and the wins are coming from somewhere else.
if (args.includes('--strong') || args.includes('--vs')) {
  entrants.push({ name: 'solver-strong', make: solverPlayer(DEFAULT_SOLVE, 'solver-strong') });
}

console.log(
  `${entrants.length} strategies, ${hands} deals per pairing (each played twice, seats swapped)`
);
if (withSolver) {
  console.log(
    `solver: ${settings.samples} worlds x ${settings.width} candidates, ${settings.particles} particles`
  );
}
console.log();

// A single pairing, for settling a close one: --vs solver greedy
const vsAt = args.indexOf('--vs');
if (vsAt >= 0) {
  const want = args.slice(vsAt + 1, vsAt + 3);
  const find = (name: string) => {
    const entry = entrants.find((e) => e.name === name);
    if (!entry) {
      throw new Error(`no strategy called ${name}; have ${entrants.map((e) => e.name).join(', ')}`);
    }
    return entry;
  };
  const left = find(want[0]);
  const right = find(want[1]);
  const t0 = Date.now();
  const result = duel(left.make, right.make, hands, 101);
  const sign = result.edge >= 0 ? '+' : '';
  console.log(`${left.name} vs ${right.name} over ${hands} deals (${hands * 2} hands)`);
  console.log(
    `  ${sign}${result.edge.toFixed(2)} +/- ${result.error.toFixed(2)} points per hand to ${
      left.name
    }`
  );
  console.log(`  hands won ${result.aWins}-${result.bWins}, pushed ${result.pushes}`);
  // Two standard errors is the usual bar for believing a difference is there
  // at all, and most of these pairings are close enough to need it.
  const t = Math.abs(result.edge) / Math.max(1e-9, result.error);
  console.log(
    `  ${t >= 2 ? 'a real edge' : 'inside the noise'} (${t.toFixed(1)} standard errors), ${(
      (Date.now() - t0) /
      1000
    ).toFixed(0)}s`
  );
  process.exit(0);
}

const started = Date.now();
const { table } = roundRobin(entrants, hands, 11, (result) => {
  const sign = result.edge >= 0 ? '+' : '';
  console.log(
    `  ${result.a} vs ${result.b}: ${sign}${result.edge.toFixed(2)} +/- ${result.error.toFixed(
      2
    )} per hand  (${result.aWins}-${result.bWins}-${result.pushes})${
      result.fouls ? `  FOULS ${result.fouls}` : ''
    }`
  );
});

console.log();
console.log(formatTable(table));
console.log();
console.log(`${((Date.now() - started) / 1000).toFixed(1)}s`);

// A strategy is only worth calling strong if it beats the whole panel. One
// losing pairing means it has found a hole in one opponent, not a way to play.
const best = table[0];
if (best.worst > 0) {
  console.log(`${best.name} beat every opponent (worst pairing ${best.worst.toFixed(2)}/hand)`);
} else {
  console.log(
    `${best.name} leads on average but loses to ${best.worstAgainst} (${best.worst.toFixed(2)}/hand)`
  );
}
