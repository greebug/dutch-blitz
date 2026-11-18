import { existsSync, readFileSync } from 'node:fs';

import { cardId, describe as describeCard } from '../cards';
import { type GinAction, type GinState, type Seat, apply, deal } from '../game';
import { type Moment, type Verdict, analyzeAll } from './analysis';
import { flag, positional, saved } from './registry';

/**
 * What the logs of real games say.
 *
 *   npx tsx src/gin/lab/logs.run.ts [file] [--review] [--all] [--worlds n] [--check n] [--level hard]
 *
 * Every hand is first replayed through the referee from its seed and moves; a
 * record that does not reproduce its own result is reported and skipped, so
 * nothing below rests on a corrupt log.
 *
 * `--review` then has the champion shadow the person's seat through each hand
 * -- seeing exactly what they saw, keeping its notes on what really happened
 * -- and at every decision says what it would have done and what the
 * difference was worth, in points per hand as its rollouts measure them.
 */
interface Record {
  matchId: string;
  hand: number;
  level: string;
  humanSeat: Seat;
  seed: number;
  target: number;
  before: { you: number; bot: number };
  history: GinAction[];
  times: number[];
  outcome: string;
  margin: number;
  fouls: number;
  player?: string | null;
}

const args = process.argv.slice(2);
const plain = positional(args, ['--review', '--all']);
const file = plain[0] ?? 'logs/gin-hands.jsonl';
const reviewing = args.includes('--review');
const verbose = args.includes('--all');
const worlds = flag(args, '--worlds', 600);
const check = flag(args, '--check', 1500);
const levelAt = args.indexOf('--level');
const onlyLevel = levelAt >= 0 ? args[levelAt + 1] : null;

function replay(r: Record): GinState | string {
  let state = deal(r.seed);
  for (const action of r.history) {
    try {
      state = apply(state, state.turn, action);
    } catch (e) {
      return String((e as Error).message);
    }
  }
  const knocker = state.knocker ?? 0;
  const s = state.score;
  const m = !s || s.winner === null ? 0 : (s.winner === 'knocker' ? knocker : knocker === 0 ? 1 : 0) === r.humanSeat ? s.points : -s.points;
  if (m !== r.margin) return `replayed margin ${m}, logged ${r.margin}`;
  return state;
}

function main(): void {
  if (!existsSync(file)) {
    console.log(`no log at ${file} yet -- play some hands first`);
    return;
  }
  const records: Record[] = readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((r: Record) => !onlyLevel || r.level === onlyLevel);
  const good: { r: Record; s: GinState }[] = [];
  for (const r of records) {
    const s = replay(r);
    if (typeof s === 'string') console.log(`skipping ${r.matchId} hand ${r.hand}: ${s}`);
    else good.push({ r, s });
  }
  console.log(`${good.length} hands replayed cleanly out of ${records.length}\n`);

  for (const level of ['easy', 'medium', 'hard']) {
    const mine = good.filter((g) => g.r.level === level);
    if (!mine.length) continue;
    const m = mine.map((g) => g.r.margin);
    const mean = m.reduce((a, b) => a + b, 0) / m.length;
    const sd = Math.sqrt(m.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, m.length - 1));
    const se = sd / Math.sqrt(m.length);
    const won = m.filter((x) => x > 0).length;
    const lost = m.filter((x) => x < 0).length;
    // A match is finished when its last hand takes somebody to the target.
    const matches = new Map<string, Record>();
    for (const g of mine) {
      const prev = matches.get(g.r.matchId);
      if (!prev || g.r.hand > prev.hand) matches.set(g.r.matchId, g.r);
    }
    let finished = 0;
    let matchWins = 0;
    for (const last of matches.values()) {
      const you = last.before.you + Math.max(0, last.margin);
      const bot = last.before.bot + Math.max(0, -last.margin);
      if (you >= last.target || bot >= last.target) {
        finished++;
        if (you >= last.target) matchWins++;
      }
    }
    const outcomes = new Map<string, number>();
    for (const g of mine) {
      const knocker = g.s.knocker;
      const who = knocker === null ? '' : knocker === g.r.humanSeat ? 'your ' : 'their ';
      const key = `${who}${g.r.outcome}`;
      outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
    }
    // Think time: gap before each of the person's actions.
    const thinks: number[] = [];
    for (const g of mine) {
      let st = deal(g.r.seed);
      g.r.history.forEach((a, i) => {
        if (st.turn === g.r.humanSeat) thinks.push(g.r.times[i] - (i ? g.r.times[i - 1] : 0));
        st = apply(st, st.turn, a);
      });
    }
    thinks.sort((a, b) => a - b);
    const fouls = mine.reduce((a, g) => a + (g.r.fouls ?? 0), 0);
    console.log(`${level}: ${mine.length} hands, ${matches.size} matches (${finished} finished, you won ${matchWins})`);
    console.log(`  ${mean >= 0 ? '+' : ''}${mean.toFixed(2)} +/- ${se.toFixed(2)} points per hand to you; hands won ${won}, lost ${lost}`);
    console.log(`  ${[...outcomes.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}`);
    if (thinks.length) console.log(`  median think ${(thinks[thinks.length >> 1] / 1000).toFixed(1)}s per move`);
    if (fouls) console.log(`  COMPUTER FOULS: ${fouls}`);
  }

  if (!reviewing) return;
  console.log(`\nreview by the champion (${worlds} worlds per decision, ${check} to price a disagreement)...`);
  const counts = new Map<Verdict, number>();
  let cost = 0;
  const all: { r: Record; m: Moment }[] = [];
  const started = Date.now();
  for (const g of good) {
    for (const m of analyzeAll(g.r, { rollout: saved('release'), worlds, check })) {
      counts.set(m.verdict, (counts.get(m.verdict) ?? 0) + 1);
      if (m.verdict !== 'best' && m.verdict !== 'close' && m.verdict !== 'forced') cost += m.cost;
      all.push({ r: g.r, m });
    }
  }
  const decisions = all.length;
  console.log(`  ${decisions} decisions in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`  ${(['best', 'close', 'inaccuracy', 'mistake', 'blunder', 'forced'] as Verdict[]).map((v) => `${v} ${counts.get(v) ?? 0}`).join(', ')}`);
  console.log(`  estimated cost of the errors: ${(cost / Math.max(1, good.length)).toFixed(2)} points per hand`);
  console.log(`\n  the costliest calls:`);
  const worst = all.filter((x) => x.m.verdict !== 'close' && x.m.verdict !== 'best').sort((a, b) => b.m.cost - a.m.cost);
  for (const { r, m } of worst.slice(0, verbose ? 1000 : 12)) {
    console.log(`  - ${r.matchId} hand ${r.hand}, turn ${m.turn} ${m.kind}: holding ${m.hand.map(cardId).join(' ')}, upcard ${m.upcard ? describeCard(m.upcard) : '-'}`);
    console.log(`      you: ${m.yours.text}; best: ${m.best.text} -- ${m.verdict}, ${m.cost.toFixed(1)} +/- ${m.se.toFixed(1)} points`);
    for (const w of m.why) console.log(`        * ${w}`);
  }
}

main();
