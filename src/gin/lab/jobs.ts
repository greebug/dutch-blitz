import { playSeed } from './fast';
import { MATCH_RULES, type MatchRules, playMatch } from './match';
import { type Spec, makePolicy } from './panel';

/**
 * The units of work a worker thread can do, and how their answers add up.
 *
 * Everything returns sums rather than averages, so results from any number of
 * workers combine by plain addition and the error bars come out right.
 */

export interface Tally {
  /** Paired samples: one per mirrored deal, or one per mirrored pair of matches. */
  n: number;
  sum: number;
  sumsq: number;
  aWins: number;
  bWins: number;
  pushes: number;
  /** Hands played, for match jobs. */
  hands: number;
  /** Margin histogram for the opener, offset by HIST_OFFSET (margins jobs only). */
  hist?: number[];
}

export const HIST_OFFSET = 200;

export function emptyTally(): Tally {
  return { n: 0, sum: 0, sumsq: 0, aWins: 0, bWins: 0, pushes: 0, hands: 0 };
}

export function addTally(into: Tally, more: Tally): Tally {
  into.n += more.n;
  into.sum += more.sum;
  into.sumsq += more.sumsq;
  into.aWins += more.aWins;
  into.bWins += more.bWins;
  into.pushes += more.pushes;
  into.hands += more.hands;
  if (more.hist) {
    if (!into.hist) into.hist = new Array(more.hist.length).fill(0);
    for (let i = 0; i < more.hist.length; i++) into.hist[i] += more.hist[i];
  }
  return into;
}

export function mean(t: Tally): number {
  return t.n ? t.sum / t.n : 0;
}

/** Standard error of the mean. */
export function stderr(t: Tally): number {
  if (t.n < 2) return Infinity;
  const m = t.sum / t.n;
  const variance = Math.max(0, (t.sumsq - t.n * m * m) / (t.n - 1));
  return Math.sqrt(variance / t.n);
}

export type Job =
  | { kind: 'hands'; a: Spec; b: Spec; from: number; count: number }
  | { kind: 'matches'; a: Spec; b: Spec; from: number; count: number; rules?: MatchRules }
  | { kind: 'margins'; a: Spec; b: Spec; from: number; count: number };

/**
 * Mirrored hands: each deal played with A opening and again with B opening.
 * The sample is A's average margin over the two.
 */
function hands(job: Extract<Job, { kind: 'hands' }>): Tally {
  const t = emptyTally();
  const a = makePolicy(job.a, job.from * 2 + 1);
  const b = makePolicy(job.b, job.from * 2 + 2);
  for (let i = job.from; i < job.from + job.count; i++) {
    const seed = (Math.imul(i, 0x2c1b3c6d) + 0x297a2d39) >>> 0;
    const first = playSeed(seed, [a, b]).margin;
    const second = -playSeed(seed, [b, a]).margin;
    const x = (first + second) / 2;
    t.n++;
    t.sum += x;
    t.sumsq += x * x;
    for (const m of [first, second]) {
      if (m > 0) t.aWins++;
      else if (m < 0) t.bWins++;
      else t.pushes++;
    }
    t.hands += 2;
  }
  return t;
}

/**
 * Mirrored matches: match k played with A named first and again with B named
 * first, on the same deals. The sample is A's wins in the pair minus one, so
 * -1, 0 or +1, and the mean is twice A's edge in win rate over 50%.
 */
function matches(job: Extract<Job, { kind: 'matches' }>): Tally {
  const t = emptyTally();
  const a = makePolicy(job.a, job.from * 2 + 1);
  const b = makePolicy(job.b, job.from * 2 + 2);
  const rules = job.rules ?? MATCH_RULES;
  for (let i = job.from; i < job.from + job.count; i++) {
    const one = playMatch([a, b], i, rules);
    const two = playMatch([b, a], i, rules);
    const winsForA = (one.winner === 0 ? 1 : 0) + (two.winner === 1 ? 1 : 0);
    const x = winsForA - 1;
    t.n++;
    t.sum += x;
    t.sumsq += x * x;
    t.aWins += winsForA;
    t.bWins += 2 - winsForA;
    t.hands += one.hands + two.hands;
  }
  return t;
}

/** The opener's margin, hand by hand, both ways round: what equity is built from. */
function margins(job: Extract<Job, { kind: 'margins' }>): Tally {
  const t = emptyTally();
  t.hist = new Array(2 * HIST_OFFSET + 1).fill(0);
  const a = makePolicy(job.a, job.from * 2 + 1);
  const b = makePolicy(job.b, job.from * 2 + 2);
  for (let i = job.from; i < job.from + job.count; i++) {
    const seed = (Math.imul(i, 0x2c1b3c6d) + 0x297a2d39) >>> 0;
    for (const pair of [[a, b], [b, a]] as const) {
      const m = playSeed(seed, pair).margin;
      t.hist[Math.max(0, Math.min(2 * HIST_OFFSET, m + HIST_OFFSET))]++;
      t.n++;
      t.sum += m;
      t.sumsq += m * m;
      t.hands++;
    }
  }
  return t;
}

export function runJob(job: Job): Tally {
  if (job.kind === 'hands') return hands(job);
  if (job.kind === 'margins') return margins(job);
  return matches(job);
}
