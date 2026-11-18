import { readFileSync } from 'node:fs';

import { analyzeAll } from './analysis';
import { saved } from './registry';

/**
 * One logged decision, reviewed again and again under different random seeds,
 * to see how much a verdict moves with the noise the standard error does not
 * count (the particle filter's own randomness, and the search's shortlist).
 *
 *   npx tsx src/gin/lab/deepreview.run.ts MATCH HAND TURN [worlds check particles] [--runs n]
 */
const a = process.argv.slice(2);
const [matchId, hand, turn] = a;
const [w, c, p] = [a[3], a[4], a[5]].map((x, i) => Number(x ?? [300, 400, 800][i]));
const runs = a.includes('--runs') ? Number(a[a.indexOf('--runs') + 1]) : 6;
const r = readFileSync('logs/gin-hands.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((x) => x.matchId === matchId && String(x.hand) === hand);
const t0 = Date.now();
for (let k = 0; k < runs; k++) {
  const ms = analyzeAll(r, { rollout: saved('release'), worlds: w, check: c, particles: p, seed: 1000 + k });
  const m = ms.find((x) => x.turn === Number(turn) && x.kind === 'throw')!;
  console.log(`seed ${k}: best ${m.best.text} -- ${m.verdict} ${m.cost.toFixed(2)} +/- ${m.se.toFixed(2)}`);
}
console.log(`${((Date.now() - t0) / runs / 1000).toFixed(1)}s per review of the hand`);
