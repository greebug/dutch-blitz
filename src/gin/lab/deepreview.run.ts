import { readFileSync } from 'node:fs';

import { analyzeAll } from './analysis';
import { saved } from './registry';

/**
 * One logged decision, reviewed again and again under different random seeds,
 * to see how much a verdict moves with the noise the standard error does not
 * count (the particle filter's own randomness, and the search's shortlist).
 *
 *   npx tsx src/gin/lab/deepreview.run.ts MATCH HAND TURN [--runs n] [--file F] [--draw]
 *       [--worlds n] [--check n] [--particles n] [--points]
 *
 * Defaults are the in-game review's own settings, judged on the match score
 * unless --points.
 */
const a = process.argv.slice(2);
const [matchId, hand, turn] = a;
const opt = (name: string, d: number) => (a.includes(name) ? Number(a[a.indexOf(name) + 1]) : d);
const runs = opt('--runs', 6);
const worlds = opt('--worlds', 600);
const check = opt('--check', 1500);
const particles = opt('--particles', 8000);
const file = a.includes('--file') ? a[a.indexOf('--file') + 1] : 'logs/gin-hands.jsonl';
const kind = a.includes('--draw') ? 'draw' : 'throw';

const r = readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .find((x) => x.matchId === matchId && String(x.hand) === hand);
if (!r) throw new Error('no such hand');
const match = !a.includes('--points') && r.target ? { you: r.before.you, them: r.before.bot, target: r.target } : undefined;

const t0 = Date.now();
const costs: number[] = [];
for (let k = 0; k < runs; k++) {
  const ms = analyzeAll({ ...r, match }, { rollout: saved('release'), worlds, check, particles, seed: 1000 + k });
  const m = ms.find((x) => x.turn === Number(turn) && x.kind === kind)!;
  // A run that agreed with the move costs nothing.
  const cost = m.yours.code === m.best.code ? 0 : m.cost;
  costs.push(cost);
  console.log(`seed ${k}: best ${m.best.text} -- ${m.verdict} ${cost.toFixed(2)} +/- ${m.se.toFixed(2)}`);
}
const mean = costs.reduce((s, x) => s + x, 0) / costs.length;
const sd = Math.sqrt(costs.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, costs.length - 1));
console.log(`mean cost ${mean.toFixed(2)}, spread between runs ${sd.toFixed(2)}`);
console.log(`${((Date.now() - t0) / runs / 1000).toFixed(1)}s per review of the hand`);
