/**
 * Match equity: the chance of winning the match from a given score.
 *
 * Points are not the objective; matches are. Ten points when you are on 95 is
 * the whole match, and ten points when your opponent is on 95 and about to
 * knock is nearly worthless next to stopping them. A search that scores
 * rollouts in points plays every hand as if it were the first; one that
 * scores them in match equity plays the score.
 *
 * The table is built from the distribution of single-hand results between two
 * evenly matched players (measured by self-play, so the numbers are this
 * game's and not a guess), by working backwards from the finishing line:
 * the chance of winning from (a, b) is the average, over how the next hand
 * can go, of the chance from wherever that hand leaves you. Pushes keep the
 * score and pass the opening on, which ties each state to its mirror image; that
 * pair is solved exactly rather than iterated.
 */
export interface Equity {
  target: number;
  /** [a * target + b] -> chance the player on `a` wins, if they open the next hand. */
  opening: Float64Array;
  /** Same, if the other player opens. */
  replying: Float64Array;
}

/**
 * `margins` maps a margin to the opener (positive: the opener won that many) to
 * its probability. Opening alternates every hand.
 */
export function buildEquity(margins: Map<number, number>, target = 100): Equity {
  const T = target;
  const opening = new Float64Array(T * T);
  const replying = new Float64Array(T * T);
  const entries = [...margins.entries()];
  const push = margins.get(0) ?? 0;
  const get = (table: Float64Array, a: number, b: number) =>
    a >= T ? 1 : b >= T ? 0 : table[a * T + b];

  for (let a = T - 1; a >= 0; a--) {
    for (let b = T - 1; b >= 0; b--) {
      // c1: value of opening, not counting pushes; c0: of replying.
      let c1 = 0;
      let c0 = 0;
      for (const [m, p] of entries) {
        if (m === 0) continue;
        // We open: a margin m is ours if positive. Next hand they open.
        c1 += p * (m > 0 ? get(replying, a + m, b) : get(replying, a, b - m));
        // They open: a margin m is theirs if positive. Next hand we open.
        c0 += p * (m > 0 ? get(opening, a, b + m) : get(opening, a - m, b));
      }
      // x1 = c1 + push * x0 ; x0 = c0 + push * x1
      const x1 = (c1 + push * c0) / (1 - push * push);
      const x0 = c0 + push * x1;
      opening[a * T + b] = x1;
      replying[a * T + b] = x0;
    }
  }
  return { target: T, opening, replying };
}

/** Chance of winning from (mine, theirs), with whoever opens next. */
export function equityAt(e: Equity, mine: number, theirs: number, weOpenNext: boolean): number {
  if (mine >= e.target) return 1;
  if (theirs >= e.target) return 0;
  return (weOpenNext ? e.opening : e.replying)[mine * e.target + theirs];
}

