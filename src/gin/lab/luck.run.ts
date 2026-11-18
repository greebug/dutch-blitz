import { readFileSync } from 'node:fs';

import { cardFromIndex } from '../cards';
import { analyzeHand } from '../melds';
import { HARD_PARTICLES } from '../opponents';
import { champion } from './champion';
import { type Policy, deal, play } from './fast';
import { flag, positional, saved } from './registry';

/**
 * How lucky was a match? Duplicate replay.
 *
 *   npx tsx src/gin/lab/luck.run.ts [file] [--match ID] [--repeats n]
 *
 * Every hand of the match is dealt again from its seed -- the same two hands,
 * the same upcard, the same stock in the same order -- and played out by two
 * EQUAL players, the champion against itself, with the person's seat kept.
 * Whatever those two score is what the cards were worth to that seat: neither
 * side outplayed the other, so the margin is the deal and the draws and
 * nothing else. Several repeats with different search seeds smooth out the
 * champion's own randomness.
 *
 *   luck  = what equal players scored from the person's seat
 *   play  = what actually happened minus the luck
 *
 * So a hand you won by 30 with cards worth +25 to your seat was mostly luck;
 * one you lost by 5 with cards worth -20 was well played. Over a match the two
 * columns say whether the result came from the deck or from the table.
 *
 * Caveat: the stock is fixed, so different play means different cards drawn
 * -- equal players do not see exactly the draws the real players saw. That is
 * the point (it is what the deck offered either seat), but it is a sample of
 * one deck per hand, so single hands are noisy and totals are what to read.
 */
const args = process.argv.slice(2);
const file = positional(args, [])[0] ?? 'logs/gin-hands.jsonl';
const repeats = flag(args, '--repeats', 8);
const at = args.indexOf('--match');

const records = readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((r) => r.level !== 'human');
if (!records.length) throw new Error(`no solo hands in ${file}`);
const matchId: string = at >= 0 ? args[at + 1] : records[records.length - 1].matchId;
const hands = records.filter((r) => r.matchId === matchId).sort((a, b) => a.hand - b.hand);
if (!hands.length) throw new Error(`no hands for match ${matchId}`);

const params = saved('release');
const equal = (seed: number): Policy =>
  champion({ worlds: 160, width: 4, particles: HARD_PARTICLES, rollout: params, equity: null, confidence: 1.5, seed });

const dealtDeadwood = (cards: number[]) => analyzeHand(cards.map(cardFromIndex)).deadwoodPoints;
const sign = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`.padStart(6);

console.log(`Match ${matchId}: ${hands.length} hands, ${hands[0].level}${hands[0].player ? `, ${hands[0].player}` : ''}`);
console.log('hand  opens  dealt dw (you/bot)  actual   luck   play');
let sumActual = 0;
let sumLuck = 0;
let dwYou = 0;
let dwBot = 0;
const t0 = Date.now();
for (const r of hands) {
  const you = r.humanSeat as 0 | 1;
  const bot = you === 0 ? 1 : 0;
  const t = deal(r.seed);
  const dYou = dealtDeadwood(t.seen[you].hand);
  const dBot = dealtDeadwood(t.seen[bot].hand);
  let luck = 0;
  for (let k = 0; k < repeats; k++) {
    const g = deal(r.seed);
    const pair: [Policy, Policy] = [equal(r.seed * 7 + k * 2), equal(r.seed * 7 + k * 2 + 1)];
    pair[0].begin?.(g.seen[0]);
    pair[1].begin?.(g.seen[1]);
    play(g, pair);
    luck += you === 0 ? g.margin : -g.margin;
  }
  luck /= repeats;
  const actual = r.margin as number;
  sumActual += actual;
  sumLuck += luck;
  dwYou += dYou;
  dwBot += dBot;
  console.log(
    `${String(r.hand).padStart(4)}  ${you === 0 ? 'you' : 'bot'}    ${String(dYou).padStart(5)} / ${String(dBot).padEnd(9)}${sign(actual)} ${sign(luck)} ${sign(actual - luck)}`
  );
}
const n = hands.length;
console.log('');
console.log(`Points, your side:   actual ${sign(sumActual)}   luck ${sign(sumLuck)}   play ${sign(sumActual - sumLuck)}`);
console.log(`Dealt deadwood, average: you ${(dwYou / n).toFixed(1)}, bot ${(dwBot / n).toFixed(1)}`);
console.log(`(${repeats} equal-player replays per hand, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
