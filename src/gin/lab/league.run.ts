import { readFileSync, existsSync } from 'node:fs';

import { mean, stderr } from './jobs';
import { PANEL, type Spec, specName } from './panel';
import { createPool, measure } from './pool';

/**
 * Round robin over the fast panel, in hands or in matches.
 *
 *   npx tsx src/gin/lab/league.run.ts [deals] [--matches] [--with file.json ...]
 *
 * `--with` adds expert parameter files (as written by the tuner) to the panel.
 */
const args = process.argv.slice(2);
const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 4000);
const asMatches = args.includes('--matches');
const entrants: Spec[] = [...PANEL];
args.forEach((arg, i) => {
  if (arg !== '--with') return;
  const file = args[i + 1];
  if (!existsSync(file)) throw new Error(`no such file ${file}`);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  entrants.unshift({ kind: 'expert', params: saved.params, name: saved.name ?? file });
});

async function main(): Promise<void> {
const pool = createPool();
const started = Date.now();
const rows = new Map<string, { sum: number; n: number; worst: number; against: string }>();
for (const e of entrants) rows.set(specName(e), { sum: 0, n: 0, worst: Infinity, against: '-' });

for (let i = 0; i < entrants.length; i++) {
  for (let k = i + 1; k < entrants.length; k++) {
    const a = entrants[i];
    const b = entrants[k];
    const tally = await measure(
      pool,
      (from, n) => (asMatches ? { kind: 'matches', a, b, from, count: n } : { kind: 'hands', a, b, from, count: n }),
      count,
      (i * 97 + k) * 1_000_000
    );
    // Matches report win rate; hands report points per hand.
    const edge = asMatches ? mean(tally) / 2 : mean(tally);
    const err = asMatches ? stderr(tally) / 2 : stderr(tally);
    for (const [name, e] of [
      [specName(a), edge],
      [specName(b), -edge],
    ] as const) {
      const row = rows.get(name)!;
      row.sum += e;
      row.n++;
      if (e < row.worst) {
        row.worst = e;
        row.against = name === specName(a) ? specName(b) : specName(a);
      }
    }
    const unit = asMatches ? '' : '/hand';
    const show = (x: number) => (asMatches ? `${(50 + 100 * x).toFixed(1)}%` : `${x >= 0 ? '+' : ''}${x.toFixed(2)}`);
    console.log(
      `  ${specName(a)} vs ${specName(b)}: ${show(edge)}${unit} +/- ${asMatches ? (100 * err).toFixed(1) + '%' : err.toFixed(2)}`
    );
  }
}

const table = [...rows.entries()].sort((x, y) => y[1].sum / y[1].n - x[1].sum / x[1].n);
console.log();
const fmt = (x: number) => (asMatches ? `${(50 + 100 * x).toFixed(1)}%` : x.toFixed(2));
console.log(`${'strategy'.padEnd(18)} ${(asMatches ? 'avg win%' : 'edge/hand').padStart(10)} ${'worst'.padStart(8)}  against`);
for (const [name, row] of table) {
  console.log(`${name.padEnd(18)} ${fmt(row.sum / row.n).padStart(10)} ${fmt(row.worst).padStart(8)}  ${row.against}`);
}
console.log(`\n${((Date.now() - started) / 1000).toFixed(1)}s on ${pool.size} threads`);
await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
