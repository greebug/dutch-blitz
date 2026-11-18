import { rng } from '../cards';
import { playHand } from '../arena';
import { seatedFactory } from './adapter';
import { champion } from './champion';
import { buildEquity } from './equity';
import { type ExpertParams, expert } from './expert';
import release from './champions/release.json';
import margins from './champions/margins.json';

/** Hard's decision time at a given particle count: npx tsx src/gin/lab/timing.run.ts [particles...] */
const params = release.params as ExpertParams;
const equity = buildEquity(new Map(Object.entries(margins as Record<string, number>).map(([m, p]) => [Number(m), p])));
for (const particles of (process.argv.slice(2).length ? process.argv.slice(2) : ['600', '4000']).map(Number)) {
  const times: number[] = [];
  const make = () => {
    const c = champion({ worlds: 150, width: 4, particles, rollout: params, equity, confidence: 1.5, seed: 7 });
    return {
      name: 'timed',
      begin: (s: Parameters<NonNullable<typeof c.begin>>[0]) => c.begin!(s),
      draw: (s: Parameters<typeof c.draw>[0]) => {
        const t = performance.now();
        const r = c.draw(s);
        times.push(performance.now() - t);
        return r;
      },
      throw: (s: Parameters<typeof c.throw>[0]) => {
        const t = performance.now();
        const r = c.throw(s);
        times.push(performance.now() - t);
        return r;
      },
    };
  };
  for (let seed = 0; seed < 40; seed++) playHand(seed, [seatedFactory(make), seatedFactory(() => expert(params))], rng(1));
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`particles ${particles}: ${times.length} decisions, mean ${mean.toFixed(1)}ms, p95 ${times[Math.floor(times.length * 0.95)].toFixed(1)}ms, max ${times[times.length - 1].toFixed(1)}ms`);
}
