import { mkdirSync, readFileSync, existsSync, writeFileSync, appendFileSync } from 'node:fs';

import { rng } from '../cards';
import { EXPERT_KEYS, type ExpertParams, PARAM_BOUNDS, SEED_PARAMS, paramsFrom, vectorOf } from './expert';
import { type Job, mean, stderr } from './jobs';
import { PANEL, type Spec, specName } from './panel';
import { createPool, measure } from './pool';
import { flag, positional, resolve, settingsFrom } from './registry';

/**
 * Train the expert's weights by playing.
 *
 *   npx tsx src/gin/lab/tune.run.ts [generations] [--from file.json] [--out name] [--matches]
 *
 * The method is the cross-entropy method: keep a Gaussian over the weights,
 * draw a population from it, play every member against the whole panel, and
 * refit the Gaussian to the best quarter. It needs nothing but a score, copes
 * with noise, and does not care that the score is a sum of card games.
 *
 * Three choices keep it honest:
 *
 *  - **Common deals.** Within a generation every candidate plays exactly the
 *    same deals against exactly the same opponents. The comparison between
 *    two candidates is then about the weights and not about who drew better
 *    cards -- which is the difference between needing thousands of hands per
 *    candidate and needing hundreds of thousands.
 *  - **Fresh deals each generation.** So nothing can be fitted to one set of
 *    shuffles.
 *  - **A robust score.** Half the average edge over the panel, half the
 *    average over the three opponents it does worst against. A candidate that
 *    farms the weak bots while losing to the strong ones scores badly, and the
 *    incumbent -- the current best guess -- is always in the panel, so the
 *    population is chasing something that is itself getting better.
 *
 * `--matches` switches the score to match wins (to 100), which is the only
 * way to train the two weights that read the match score.
 */
const args = process.argv.slice(2);
const generations = Number(positional(args).find((a) => /^\d+$/.test(a)) ?? 40);
// --against a,b: train an exploiter. The score is then the plain average edge
// over just those opponents, with no incumbent and no robustness term: the
// point is to find out how badly they can be beaten, not to play well.
const againstAt = args.indexOf('--against');
const targets: Spec[] | null =
  againstAt >= 0 ? args[againstAt + 1].split(',').map((n) => resolve(n, settingsFrom(args))) : null;
const fromAt = args.indexOf('--from');
const outAt = args.indexOf('--out');
const name = outAt >= 0 ? args[outAt + 1] : 'expert-v1';
const asMatches = args.includes('--matches');

const start: ExpertParams =
  fromAt >= 0 && existsSync(args[fromAt + 1])
    ? { ...SEED_PARAMS, ...JSON.parse(readFileSync(args[fromAt + 1], 'utf8')).params }
    : SEED_PARAMS;

// Which weights move. In hand mode the match weights cannot be measured, so
// they stay put; in match mode everything moves but more gently.
const MATCH_ONLY = new Set<keyof ExpertParams>(['knockClose', 'knockDefend']);
const free = EXPERT_KEYS.map((key) => (asMatches ? true : !MATCH_ONLY.has(key)));

const POP = flag(args, '--pop', 36);
const ELITE = Math.max(3, Math.round(POP / 4));
const DEALS = flag(args, '--deals', asMatches ? 600 : 1500);
const CHUNK = targets?.some((t) => t.kind === 'champion') ? (asMatches ? 2 : 10) : asMatches ? 60 : 250;
const dir = 'src/gin/lab/champions';
mkdirSync(dir, { recursive: true });
const log = `${dir}/${name}.log`;

async function main(): Promise<void> {
  const pool = createPool();
  const next = rng(20261117);
  const span = EXPERT_KEYS.map((key) => PARAM_BOUNDS[key][1] - PARAM_BOUNDS[key][0]);
  let mu = vectorOf(start);
  let sigma = span.map((s, i) => (free[i] ? s * (asMatches ? 0.08 : 0.15) : 0));
  let incumbent = paramsFrom(mu, start);
  let bestEver = { params: incumbent, score: -Infinity, gen: -1 };

  const gauss = () => {
    const u = Math.max(1e-12, next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };

  for (let gen = 0; gen < generations; gen++) {
    const t0 = Date.now();
    const pop: ExpertParams[] = [incumbent];
    while (pop.length < POP) {
      pop.push(paramsFrom(mu.map((m, i) => m + sigma[i] * gauss()), start));
    }
    const opponents: Spec[] = targets ?? [...PANEL, { kind: 'expert', params: incumbent, name: 'incumbent' }];
    const from = gen * 10_000_000;

    // Every candidate against every opponent, on the same deals.
    const scores: number[] = [];
    const detail: number[][] = [];
    const all = await Promise.all(
      pop.map((candidate) => {
        const a: Spec = { kind: 'expert', params: candidate };
        return Promise.all(
        opponents.map((b) =>
          measure(
            pool,
            (f, n): Job => (asMatches ? { kind: 'matches', a, b, from: f, count: n } : { kind: 'hands', a, b, from: f, count: n }),
            DEALS,
            from,
            CHUNK
          )
        )
      );
      })
    );
    for (const tallies of all) {
      const edges = tallies.map(mean);
      const sorted = edges.slice().sort((x, y) => x - y);
      const avg = edges.reduce((s, e) => s + e, 0) / edges.length;
      const worst3 = (sorted[0] + sorted[1] + sorted[Math.min(2, sorted.length - 1)]) / 3;
      scores.push(targets ? avg : 0.5 * avg + 0.5 * worst3);
      detail.push(edges);
    }

    const order = pop.map((_, i) => i).sort((x, y) => scores[y] - scores[x]);
    const elite = order.slice(0, ELITE).map((i) => vectorOf(pop[i]));
    const newMu = mu.map((_, d) => elite.reduce((s, v) => s + v[d], 0) / ELITE);
    const newSigma = sigma.map((_, d) => {
      if (!free[d]) return 0;
      const v = elite.reduce((s, e) => s + (e[d] - newMu[d]) ** 2, 0) / ELITE;
      return Math.max(span[d] * 0.01, Math.sqrt(v));
    });
    mu = mu.map((m, d) => 0.3 * m + 0.7 * newMu[d]);
    sigma = sigma.map((s, d) => (free[d] ? 0.3 * s + 0.7 * newSigma[d] : 0));

    // The new incumbent is the population mean, not the luckiest sample: the
    // mean is the estimate, the luckiest sample is mostly the noise.
    incumbent = paramsFrom(mu, start);
    const top = order[0];
    const headline = scores[0];
    if (scores[top] > bestEver.score) bestEver = { params: pop[top], score: scores[top], gen };

    const worstName = specName(opponents[detail[top].indexOf(Math.min(...detail[top]))]);
    const line = `gen ${gen}: best ${scores[top].toFixed(3)} (worst vs ${worstName} ${Math.min(...detail[top]).toFixed(2)}), incumbent ${headline.toFixed(3)}, ${((Date.now() - t0) / 1000).toFixed(1)}s`;
    console.log(line);
    appendFileSync(log, line + '\n');
    writeFileSync(
      `${dir}/${name}.json`,
      JSON.stringify({ name, gen, mode: asMatches ? 'matches' : 'hands', params: incumbent, sigma: Object.fromEntries(EXPERT_KEYS.map((k, i) => [k, sigma[i]])) }, null, 2)
    );
  }

  // Final word: the incumbent against the panel on deals nobody trained on.
  console.log(`\n${name} on fresh deals:`);
  const a: Spec = { kind: 'expert', params: incumbent, name };
  for (const b of targets ?? PANEL) {
    const t = await measure(
      pool,
      (f, n): Job => (asMatches ? { kind: 'matches', a, b, from: f, count: n } : { kind: 'hands', a, b, from: f, count: n }),
      targets ? DEALS * 4 : asMatches ? 4000 : 20000,
      2_000_000_000,
      CHUNK
    );
    const e = mean(t);
    const s = stderr(t);
    const msg = asMatches
      ? `  vs ${specName(b).padEnd(18)} wins ${(50 + 50 * e).toFixed(1)}% +/- ${(50 * s).toFixed(1)}`
      : `  vs ${specName(b).padEnd(18)} ${e >= 0 ? '+' : ''}${e.toFixed(2)} +/- ${s.toFixed(2)} per hand`;
    console.log(msg);
    appendFileSync(log, msg + '\n');
  }
  console.log(JSON.stringify(incumbent));
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
