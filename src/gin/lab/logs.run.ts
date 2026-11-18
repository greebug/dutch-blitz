import { existsSync, readFileSync } from 'node:fs';

import { cardId, cardIndex, describe as describeCard } from '../cards';
import { type GinAction, type GinState, type Seat, apply, deal, viewFor } from '../game';
import { seated } from './adapter';
import { champion } from './champion';
import { BIG_GIN, KNOCK } from './fast';
import { flag, positional, saved } from './registry';

/**
 * What the logs of real games say.
 *
 *   npx tsx src/gin/lab/logs.run.ts [file] [--review] [--worlds n] [--level hard]
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
const plain = positional(args, ['--review']);
const file = plain[0] ?? 'logs/gin-hands.jsonl';
const reviewing = args.includes('--review');
const worlds = flag(args, '--worlds', 200);
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

function code(action: GinAction): number | null {
  if (action.type === 'discard') return cardIndex(action.card);
  if (action.type === 'knock') return KNOCK + cardIndex(action.discard);
  if (action.type === 'big-gin') return BIG_GIN;
  return null;
}

function say(moveCode: number): string {
  if (moveCode === BIG_GIN) return 'big gin';
  const knock = moveCode >= KNOCK;
  const c = knock ? moveCode - KNOCK : moveCode;
  const id = cardId({ suit: (['ro', 'su', 'sw', 'go'] as const)[(c / 10) | 0], rank: ((c % 10) + 1) as 1 });
  return knock ? `knock, throwing ${id}` : `throw ${id}`;
}

interface Verdict {
  record: Record;
  at: number;
  hand: string;
  upcard: string;
  mine: string;
  best: string;
  cost: number;
}

function review(r: Record, state0: GinState): { decisions: number; agreed: number; cost: number; verdicts: Verdict[] } {
  let current: GinAction = r.history[0];
  let last: { moves: number[]; values: number[]; chosen: number; kind: string } | null = null;
  const policy = champion({
    worlds,
    width: 5,
    particles: 800,
    rollout: saved('release'),
    equity: null,
    confidence: 0,
    seed: r.seed,
    actual: {
      draw: () => (current.type === 'draw' ? current.from === 'discard' : null),
      throw: () => code(current),
    },
    consider: () => code(current),
    explain: (info) => {
      last = info;
    },
  });
  const player = seated(policy);
  let state = deal(r.seed);
  const seat = r.humanSeat;
  player.begin!(seat, state.hands[seat], state.discard[state.discard.length - 1], state.stock.length);
  let decisions = 0;
  let agreed = 0;
  let cost = 0;
  const verdicts: Verdict[] = [];
  for (let i = 0; i < r.history.length; i++) {
    const action = r.history[i];
    if (state.turn === seat) {
      current = action;
      last = null;
      const view = viewFor(state, seat);
      const theirs = player.act(view, r.history.slice(0, i));
      decisions++;
      const mineCode = action.type === 'draw' ? (action.from === 'discard' ? 1 : 0) : code(action)!;
      const champCode = theirs.type === 'draw' ? (theirs.from === 'discard' ? 1 : 0) : code(theirs)!;
      if (mineCode === champCode) agreed++;
      const l = last as { moves: number[]; values: number[]; kind: string } | null;
      if (l && mineCode !== champCode) {
        const k = l.moves.indexOf(mineCode);
        if (k >= 0) {
          const top = Math.max(...l.values);
          const c = top - l.values[k];
          cost += c;
          const best = l.moves[l.values.indexOf(top)];
          verdicts.push({
            record: r,
            at: i,
            hand: view.hand.map(cardId).join(' '),
            upcard: view.discardTop ? describeCard(view.discardTop) : '-',
            mine: l.kind === 'draw' ? (mineCode ? 'take the upcard' : 'draw blind') : say(mineCode),
            best: l.kind === 'draw' ? (best ? 'take the upcard' : 'draw blind') : say(best),
            cost: c,
          });
        }
      }
    }
    state = apply(state, state.turn, action);
  }
  void state0;
  return { decisions, agreed, cost, verdicts };
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
  console.log(`\nreview by the champion (${worlds} worlds per decision)...`);
  let decisions = 0;
  let agreed = 0;
  let cost = 0;
  const all: Verdict[] = [];
  for (const g of good) {
    const v = review(g.r, g.s);
    decisions += v.decisions;
    agreed += v.agreed;
    cost += v.cost;
    all.push(...v.verdicts);
  }
  console.log(`  agreed with the champion on ${agreed} of ${decisions} decisions (${((100 * agreed) / Math.max(1, decisions)).toFixed(0)}%)`);
  console.log(`  estimated cost of the disagreements: ${(cost / Math.max(1, good.length)).toFixed(2)} points per hand`);
  console.log(`\n  the costliest calls:`);
  for (const v of all.sort((a, b) => b.cost - a.cost).slice(0, 12)) {
    console.log(`  - match ${v.record.matchId} hand ${v.record.hand}, move ${v.at}: holding ${v.hand}, upcard ${v.upcard}`);
    console.log(`      you: ${v.mine}; champion: ${v.best} (about ${v.cost.toFixed(1)} points)`);
  }
}

main();
