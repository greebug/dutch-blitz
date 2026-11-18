import { appendFileSync, writeFileSync } from 'node:fs';

import { type Job, mean, stderr } from './jobs';
import { PANEL, type Spec, specName } from './panel';
import { createPool, measure } from './pool';
import { CHAMPIONS_DIR, flag, positional, resolve, settingsFrom } from './registry';

/**
 * The championship: one player against everybody, in full matches to 100.
 *
 *   npx tsx src/gin/lab/championship.run.ts PLAYER [pairs] [--extra a,b] [--hands n]
 *
 * Every pairing is played as mirrored pairs of matches -- each match twice,
 * on the same deals, with the seats swapped -- so the only thing that differs
 * between the two is who made the decisions. Reports match win rate with a
 * 95% interval, and (with --hands) points per hand as well, which is the
 * lower-noise measure of the same thing.
 *
 * The verdict line is the one that matters: the worst pairing. A player that
 * wins on average but loses to someone has found a hole in the field, not a
 * way to play.
 */
const args = process.argv.slice(2);
const plain = positional(args);
const who = plain[0] ?? 'champion-eq';
const pairs = Number(plain[1] ?? 1000);
const handDeals = flag(args, '--hands', 0);
const extraAt = args.indexOf('--extra');
const settings = settingsFrom(args);
const player = resolve(who, settings);
const field: Spec[] = [
  ...PANEL,
  ...(extraAt >= 0 ? args[extraAt + 1].split(',').map((n) => resolve(n, settings)) : []),
];
const report = `${CHAMPIONS_DIR}/championship-${who}.md`;

async function main(): Promise<void> {
  const pool = createPool();
  const slow = player.kind === 'champion' || field.some((f) => f.kind === 'champion');
  const t0 = Date.now();
  writeFileSync(
    report,
    `# Championship: ${who}\n\n${pairs * 2} matches to 100 per opponent (mirrored pairs)${
      player.kind === 'champion' ? `; search ${settings.worlds} worlds, width ${settings.width}, rollouts ${settings.rollout}` : ''
    }\n\n| opponent | match wins | 95% interval | ${handDeals ? 'points/hand | ' : ''}hands |\n|---|---|---|${handDeals ? '---|' : ''}---|\n`
  );
  let worst = { name: '-', rate: 2 };
  let totalMatches = 0;
  let totalHands = 0;
  const results = await Promise.all(
    field.map(async (b) => {
      const m = await measure(
        pool,
        (from, n): Job => ({ kind: 'matches', a: player, b, from, count: n }),
        pairs,
        4_000_000_000 % 2 ** 31,
        slow ? 3 : 200
      );
      const h = handDeals
        ? await measure(pool, (from, n): Job => ({ kind: 'hands', a: player, b, from, count: n }), handDeals, 1_500_000_000, slow ? 10 : 500)
        : null;
      return { b, m, h };
    })
  );
  for (const { b, m, h } of results) {
    const rate = 0.5 + mean(m) / 2;
    const half = 1.96 * (stderr(m) / 2);
    totalMatches += m.n * 2;
    totalHands += m.hands + (h?.hands ?? 0);
    if (rate < worst.rate) worst = { name: specName(b), rate };
    const pts = h ? `${mean(h) >= 0 ? '+' : ''}${mean(h).toFixed(2)} +/- ${(1.96 * stderr(h)).toFixed(2)} | ` : '';
    const line = `| ${specName(b)} | ${(100 * rate).toFixed(1)}% | ${(100 * (rate - half)).toFixed(1)}-${(100 * (rate + half)).toFixed(1)}% | ${pts}${m.hands + (h?.hands ?? 0)} |`;
    console.log(line);
    appendFileSync(report, line + '\n');
  }
  const verdict =
    worst.rate > 0.5
      ? `\n**${who} beat every opponent.** Worst pairing: ${worst.name} at ${(100 * worst.rate).toFixed(1)}%.`
      : `\n**${who} did not beat everyone**: ${worst.name} held it to ${(100 * worst.rate).toFixed(1)}%.`;
  const tail = `${verdict}\n\n${totalMatches} matches, ${totalHands} hands, ${((Date.now() - t0) / 1000).toFixed(0)}s on ${pool.size} threads.\n`;
  console.log(tail);
  appendFileSync(report, tail);
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
