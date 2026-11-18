import { readFileSync, writeFileSync } from 'node:fs';

import { buildEquity, equityAt } from './equity';
import { HIST_OFFSET, mean } from './jobs';
import { createPool, measure } from './pool';

/**
 * Measure how single hands go between two equal players, and turn it into a
 * match-equity table.
 *
 *   npx tsx src/gin/lab/equity.run.ts [deals] [--params file.json]
 */
const args = process.argv.slice(2);
const deals = Number(args.find((a) => /^\d+$/.test(a)) ?? 500000);
const at = args.indexOf('--params');
const file = at >= 0 ? args[at + 1] : 'src/gin/lab/champions/expert-v1.json';

async function main(): Promise<void> {
  const params = JSON.parse(readFileSync(file, 'utf8')).params;
  const pool = createPool();
  const spec = { kind: 'expert' as const, params };
  const t0 = Date.now();
  const tally = await measure(pool, (from, count) => ({ kind: 'margins', a: spec, b: spec, from, count }), deals, 0, 2000);
  await pool.close();
  const hist = tally.hist!;
  const margins = new Map<number, number>();
  hist.forEach((n, i) => {
    if (n > 0) margins.set(i - HIST_OFFSET, n / tally.n);
  });
  writeFileSync('src/gin/lab/champions/margins.json', JSON.stringify(Object.fromEntries(margins)));

  const p = (pred: (m: number) => boolean) =>
    [...margins.entries()].filter(([m]) => pred(m)).reduce((s, [, q]) => s + q, 0);
  console.log(`${tally.n} hands in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`opener wins ${(100 * p((m) => m > 0)).toFixed(1)}%, loses ${(100 * p((m) => m < 0)).toFixed(1)}%, pushes ${(100 * p((m) => m === 0)).toFixed(1)}%`);
  console.log(`opener's average margin ${mean(tally).toFixed(2)} points per hand`);
  const e = buildEquity(margins);
  console.log(`match win chance at 0-0 for whoever opens the first hand: ${(100 * equityAt(e, 0, 0, true)).toFixed(1)}%`);
  for (const [a, b] of [
    [90, 0],
    [0, 90],
    [50, 50],
    [80, 60],
    [95, 95],
  ]) {
    console.log(`  ${a}-${b}: ${(100 * equityAt(e, a, b, true)).toFixed(1)}% opening, ${(100 * equityAt(e, a, b, false)).toFixed(1)}% replying`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
