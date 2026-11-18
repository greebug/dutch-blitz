import { readFileSync } from 'node:fs';

import { cardFromIndex, cardIndex, cardId } from '../cards';
import { type GinAction, type Seat, apply, deal, viewFor } from '../game';
import { seated } from './adapter';
import { type ChampionOptions, champion } from './champion';
import { type ExpertParams, SEED_PARAMS, expert } from './expert';
import { BIG_GIN, KNOCK, type Policy, type Table, deadwoodOf } from './fast';
import { saved } from './registry';
import { makePolicy } from './panel';

/**
 * Put one logged decision under the microscope.
 *
 *   npx tsx src/gin/lab/probe.run.ts MATCH HAND TURN [draw|throw] [--worlds n] [--a CODE --b CODE]
 *
 * Replays the hand to the decision with the champion shadowing the person's
 * seat (exactly as the review does), then plays the person's move against the
 * review's choice on a large number of fresh worlds, under several rollout
 * players, and breaks down how those rollouts end. If the verdict flips with
 * the rollout player, it is the rollout player talking, not the position.
 */
const args = process.argv.slice(2);
const [matchId, handNo, turnNo, kindArg] = args;
const flag = (name: string, d: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const N = flag('--worlds', 3000);

const fileAt = args.indexOf('--file');
const records = readFileSync(fileAt >= 0 ? args[fileAt + 1] : 'logs/gin-hands.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const r = records.find((x) => x.matchId === matchId && String(x.hand) === handNo);
if (!r) throw new Error('no such hand');
const seat: Seat = r.humanSeat;
const kind = kindArg ?? 'throw';

function code(a: GinAction): number {
  if (a.type === 'draw') return a.from === 'discard' ? 1 : 0;
  if (a.type === 'discard') return cardIndex(a.card);
  if (a.type === 'knock') return KNOCK + cardIndex(a.discard);
  return BIG_GIN;
}
const say = (c: number) =>
  kind === 'draw' ? (c ? 'take upcard' : 'draw blind') : c === BIG_GIN ? 'big gin' : c >= KNOCK ? `knock ${cardId(cardFromIndex(c - KNOCK))}` : `throw ${cardId(cardFromIndex(c))}`;

// Locate the decision.
let target = -1;
{
  let t = 0;
  for (let i = 0; i < r.history.length; i++) {
    if (Math.floor(i / 2) % 2 !== seat) continue;
    if (r.history[i].type === 'draw') t++;
    if (t === Number(turnNo) && (r.history[i].type === 'draw') === (kind === 'draw')) {
      target = i;
      break;
    }
  }
}
if (target < 0) throw new Error('no such decision');
const mine = code(r.history[target]);

interface Tally {
  n: number;
  sum: number;
  outcome: Map<string, number>;
  turns: number;
  myDw: number;
}
/** Set by a watching opponent: what it did with our discard. */
let lastReply = "";
const byReply = new Map<string, { n: number; sum: number }>();
const blank = (): Tally => ({ n: 0, sum: 0, outcome: new Map(), turns: 0, myDw: 0 });

function run(label: string, rollout: ExpertParams, extra: Partial<ChampionOptions> = {}, a?: number, b?: number, checkN = N) {
  let current: GinAction = r.history[0];
  let best = -1;
  const tallies = [blank(), blank()];
  const diffs: number[][] = [[], []];
  const opts: ChampionOptions = {
    worlds: 6,
    check: 0,
    width: 5,
    // Same read of the opponent as the in-game review.
    particles: flag('--particles', 8000),
    rollout,
    equity: null,
    confidence: 0,
    seed: r.seed,
    readRollouts: !args.includes('--no-read'),
    ...extra,
    actual: {
      draw: () => (current.type === 'draw' ? current.from === 'discard' : null),
      throw: () => (current.type === 'draw' ? null : code(current)),
    },
    consider: () => (current.type === 'draw' ? null : code(current)),
    explain: (info) => {
      if (opts.check) best = info.check ? info.check.moves[0] : info.moves[info.chosen];
    },
    onRollout: (phase, k, t: Table) => {
      if (phase !== 'check') return;
      const tl = tallies[k];
      const m = seat === 0 ? t.margin : -t.margin;
      tl.n++;
      tl.sum += m;
      diffs[k].push(m);
      if (lastReply) {
        const key = `${k ? "yours" : "best "} ${lastReply}`;
        const e = byReply.get(key) ?? { n: 0, sum: 0 };
        e.n++;
        e.sum += m;
        byReply.set(key, e);
        lastReply = "";
      }
      const who = t.knocker === null ? '' : t.knocker === seat ? 'we ' : 'they ';
      const key = `${who}${t.outcome}${t.knocker !== null && m !== 0 ? (m > 0 ? ' (+)' : ' (-)') : ''}`;
      tl.outcome.set(key, (tl.outcome.get(key) ?? 0) + 1);
      tl.turns += t.pub.turns;
      tl.myDw += deadwoodOf(t.seen[seat].masks);
    },
  };
  // A forced pair, if given: make the search consider exactly these.
  const policy = champion(opts);
  const player = seated(policy);
  let state = deal(r.seed);
  player.begin!(seat, state.hands[seat], state.discard[state.discard.length - 1], state.stock.length);
  for (let i = 0; i <= target; i++) {
    const action = r.history[i];
    if (Math.floor(i / 2) % 2 === seat) {
      current = action;
      if (i === target) {
        opts.worlds = 300;
        opts.check = checkN;
        if (a !== undefined && b !== undefined) {
          // Compare two given moves: pretend the person played b, search will include a only if ranked.
        }
      }
      player.act(viewFor(state, seat), r.history.slice(0, i));
    }
    state = apply(state, state.turn, action);
  }
  const [tb, ty] = tallies;
  const n = Math.min(diffs[0].length, diffs[1].length);
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const d = diffs[0][i] - diffs[1][i];
    s += d;
    s2 += d * d;
  }
  const mean = s / n;
  const se = Math.sqrt((s2 / n - mean * mean) / (n - 1));
  console.log(`\n== ${label}: best ${say(best)} vs yours ${say(mine)}: ${mean >= 0 ? '+' : ''}${mean.toFixed(2)} +/- ${se.toFixed(2)} (n=${n})`);
  for (const [name, t] of [
    [`  best  ${say(best)}`, tb],
    [`  yours ${say(mine)}`, ty],
  ] as const) {
    const parts = [...t.outcome.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${((100 * v) / t.n).toFixed(0)}%`);
    console.log(`${name}: mean ${(t.sum / t.n).toFixed(2)}, turns ${(t.turns / t.n).toFixed(1)}, our final dw ${(t.myDw / t.n).toFixed(1)}`);
    console.log(`      ${parts.join(', ')}`);
  }
}

// The position.
{
  let state = deal(r.seed);
  for (let i = 0; i < target; i++) state = apply(state, state.turn, r.history[i]);
  const v = viewFor(state, seat);
  console.log(`${matchId} hand ${handNo}, turn ${turnNo} ${kind}; you ${say(mine)}`);
  console.log(`  hand: ${v.hand.map(cardId).join(' ')}   stock ${v.stockCount}`);
  console.log(`  pile (old->new): ${state.discard.map(cardId).join(' ')}`);
  const them = seat === 0 ? 1 : 0;
  const log: string[] = [];
  for (let i = 0; i < target; i++) {
    const a = r.history[i];
    const who = Math.floor(i / 2) % 2 === them ? 'they' : 'you';
    if (a.type === 'draw') log.push(`${who} ${a.from === 'discard' ? 'TAKE' : 'draw'}`);
    else if (a.type === 'discard') log.push(`${who} throw ${cardId(a.card)}`);
  }
  console.log(`  log: ${log.join(' | ')}`);
  console.log(`  (actual opponent hand, NOT used by anything below: ${state.hands[them].map(cardId).join(' ')})`);
}

if (!args.includes('--only-deep')) {
  run('release rollouts', saved('release'));
  run('expert-v1 rollouts', saved('expert-v1'));
  run('untuned seed rollouts', SEED_PARAMS);
  run('release rollouts, uniform guesses (no inference)', saved('release'), { uniform: true });
}

// The decisive test: play the rest of the hand with the champion itself
// (searching every later decision) in our chair, against the tuned expert.
// A verdict that only exists because the rollout expert plays one of the two
// resulting hands badly will shrink or flip here.
const deep = flag('--deep', 0);
if (deep > 0) {
  let k = 0;
  const v3 = saved('release');
  const t0 = Date.now();
  run(
    `champion-in-our-chair rollouts (${deep} worlds)`,
    v3,
    {
      rollers: () => [
        champion({ worlds: 40, width: 3, particles: 300, rollout: v3, confidence: 1.5, seed: 1000 + k++ }),
        expert(v3, Math.random, 'them'),
      ],
    },
    undefined,
    undefined,
    deep
  );
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

// What does the opponent do with our discard on their very next turn?
if (args.includes('--their-reply')) {
  const v3 = saved('release');
  const replies = new Map<string, number>();
  let cand = 0;
  const wrap = (): Policy => {
    const inner = expert(v3, Math.random, 'them');
    let first = true;
    return {
      name: 'them',
      begin: (s) => {
        first = true;
        inner.begin!(s);
      },
      draw: (s) => {
        const take = inner.draw(s);
        if (first) {
          const top = s.pub.pile[s.pub.pile.length - 1];
          const key = `${take ? 'TAKE' : 'pass'} ${cardId(cardFromIndex(top))}`;
          replies.set(key, (replies.get(key) ?? 0) + 1);
          lastReply = key;
        }
        first = false;
        return take;
      },
      throw: (s) => inner.throw(s),
    };
  };
  run('v3 rollouts, watching their reply', v3, {
    rollers: () => [expert(v3, Math.random, 'me'), wrap()],
  });
  void cand;
  for (const [k, v] of [...byReply.entries()].sort()) if (v.n > 100) console.log(`    ${k}: n ${v.n}, our mean ${(v.sum / v.n).toFixed(2)}`);
  console.log('  their first draw after our throw:', [...replies.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
}

// Same worlds (the champion's RNG is seeded and rollouts never touch it),
// different opponents: does the verdict survive an opponent who does not
// take low cards just to shed high ones?
if (args.includes('--opponents')) {
  const v3 = saved('release');
  const noFirstTake = (): Policy => {
    const inner = expert(v3, Math.random, 'them');
    let first = true;
    return {
      name: 'them',
      begin: (s) => {
        first = true;
        inner.begin!(s);
      },
      draw: (s) => {
        if (first) {
          first = false;
          return false;
        }
        return inner.draw(s);
      },
      throw: (s) => inner.throw(s),
    };
  };
  run('opponent = v3 that never takes our discard on its next turn', v3, { rollers: () => [expert(v3, Math.random, 'me'), noFirstTake()] });
  run('opponent = the human model (takes only to complete a meld)', v3, {
    rollers: () => [expert(v3, Math.random, 'me'), makePolicy({ kind: 'human' }, Math.floor(Math.random() * 1e9))],
  });
}
