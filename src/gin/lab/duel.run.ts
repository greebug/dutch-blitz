import { type Job, mean, stderr } from './jobs';
import { specName } from './panel';
import { createPool, measure } from './pool';
import { positional, resolve as resolveName, settingsFrom } from './registry';

/**
 * One pairing, settled properly.
 *
 *   npx tsx src/gin/lab/duel.run.ts A B [count] [--matches] [--worlds n] [--width n]
 *
 * A and B are panel names, `expert-v1` (or any champions/*.json), `champion`
 * (search, scored in points) or `champion-eq` (search, scored in match equity).
 */
const args = process.argv.slice(2);
const plain = positional(args);
const names = plain.filter((a) => !/^\d+$/.test(a));
const count = Number(plain.find((a) => /^\d+$/.test(a)) ?? 1000);
const asMatches = args.includes('--matches');
const settings = settingsFrom(args);
const resolve = (name: string) => resolveName(name, settings);

async function main(): Promise<void> {
  const [a, b] = names.map(resolve);
  const pool = createPool();
  const t0 = Date.now();
  const chunk = a.kind === 'champion' || b.kind === 'champion' ? (asMatches ? 2 : 10) : asMatches ? 100 : 500;
  const tally = await measure(
    pool,
    (from, n): Job => (asMatches ? { kind: 'matches', a, b, from, count: n } : { kind: 'hands', a, b, from, count: n }),
    count,
    3_000_000_000,
    chunk
  );
  await pool.close();
  const e = mean(tally);
  const s = stderr(tally);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (asMatches) {
    console.log(`${specName(a)} vs ${specName(b)}: ${count * 2} matches (${tally.hands} hands), ${secs}s`);
    console.log(`  ${specName(a)} wins ${(50 + 50 * e).toFixed(1)}% +/- ${(50 * s).toFixed(1)}  (${(Math.abs(e) / s).toFixed(1)} standard errors)`);
  } else {
    console.log(`${specName(a)} vs ${specName(b)}: ${count * 2} hands, ${secs}s`);
    console.log(`  ${e >= 0 ? '+' : ''}${e.toFixed(2)} +/- ${s.toFixed(2)} points per hand to ${specName(a)}  (${(Math.abs(e) / s).toFixed(1)} standard errors)`);
    console.log(`  hands won ${tally.aWins}-${tally.bWins}, pushed ${tally.pushes}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
