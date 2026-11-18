import { type Card, cardId, cardPoints, shuffled } from './cards';
import {
  type Belief,
  holdsChance,
  newBelief,
  observe,
  reconcile,
  sampleHand,
  unseen,
} from './belief';
import { analyzeHand } from './melds';
import { type GinRules, isBigGin, knockOptions } from './rules';
import {
  type GinAction,
  type GinState,
  type GinView,
  type Seat,
  apply,
  other,
} from './game';

/**
 * What to do, and what it is worth.
 *
 * The belief in `belief.ts` says what the opponent probably holds; this says
 * what to do about it. The method is the one every strong imperfect-
 * information player uses in the end, because nothing cheaper is honest:
 * guess the hidden cards many times, play each guess out, and keep the move
 * that scores best on average.
 *
 * Three things make it affordable and, more importantly, make the comparison
 * between moves trustworthy:
 *
 *  - **One set of worlds for every move.** Each sample draws one opponent hand
 *    and one stock order, and then EVERY candidate move is played against that
 *    same world. Scoring each move against its own private worlds would leave
 *    the difference between two moves buried under the difference between two
 *    shuffles; sharing them cancels the luck out and leaves the decision.
 *  - **A cheap rollout.** Once past the move being judged, both sides play a
 *    fast approximation rather than reasoning properly. A rollout is a
 *    yardstick, not a prediction, and a yardstick that takes ten times as long
 *    buys far less than ten times more samples would.
 *  - **A short list of candidates.** Eleven discards is mostly eight obviously
 *    terrible ones; they are ranked cheaply first and only the plausible few
 *    are rolled out.
 *
 * Note on the name: this is a best response to a belief, not a Nash
 * equilibrium. It plays as well as it can against the opponent model it
 * carries, and that model is deliberately generic -- see `belief.ts`. Against
 * an opponent who knows this program and plays to exploit it, a genuine
 * equilibrium strategy would do better. `arena.ts` is where that difference
 * gets measured rather than asserted.
 */

export interface SolveOptions {
  /** Worlds sampled. Variance falls with the square root of this. */
  samples: number;
  /** How many discards to take seriously. */
  width: number;
  particles: number;
  next: () => number;
}

export const DEFAULT_SOLVE: Omit<SolveOptions, 'next'> = {
  samples: 120,
  width: 5,
  particles: 800,
};

/** A cheaper setting for running thousands of hands rather than one. */
export const FAST_SOLVE: Omit<SolveOptions, 'next'> = {
  samples: 40,
  width: 4,
  particles: 350,
};

export interface Scored {
  action: GinAction;
  /** Points, from our seat's side of the table. Positive is good for us. */
  ev: number;
  /** Spread across the sampled worlds -- how much to trust the number. */
  spread: number;
  label: string;
}

/**
 * Rank every move worth considering.
 *
 * The belief must be current as of this decision and must never have been fed
 * anything the seat could not see; `createSolver` below is the thing that
 * keeps that promise turn by turn.
 */
export function solve(belief: Belief, view: GinView, options: SolveOptions): Scored[] {
  const candidates = shortlist(view, options.width);
  if (candidates.length <= 1) {
    return candidates.map((action) => ({ action, ev: 0, spread: 0, label: describeAction(action) }));
  }

  const totals = candidates.map(() => 0);
  const squares = candidates.map(() => 0);
  let played = 0;

  for (let i = 0; i < options.samples; i++) {
    const theirs = sampleHand(belief);
    const pool = unseen(belief).filter((c) => !theirs.some((t) => cardId(t) === cardId(c)));
    // A world has to be a real game of gin before it is worth playing out:
    // forty distinct cards, in exactly one place each.
    if (!playable(theirs, pool, view)) continue;
    const stock = shuffled(pool, options.next);
    played++;

    for (let k = 0; k < candidates.length; k++) {
      // The same world for every candidate: that is what makes the comparison
      // between them mean anything.
      const start = world(belief, view, theirs, stock);
      let after: GinState;
      try {
        after = apply(start, view.seat, candidates[k]);
      } catch {
        // A move that is not legal in this sampled world (a knock that needs
        // cards the sample does not grant) simply scores nothing here.
        continue;
      }
      const end = rollout(after, options.next);
      const points = margin(end, view.seat);
      totals[k] += points;
      squares[k] += points * points;
    }
  }

  const n = Math.max(1, played);
  return candidates
    .map((action, k) => {
      const mean = totals[k] / n;
      const variance = Math.max(0, squares[k] / n - mean * mean);
      return { action, ev: mean, spread: Math.sqrt(variance / n), label: describeAction(action) };
    })
    .sort((a, b) => b.ev - a.ev);
}

/**
 * The moves worth spending rollouts on.
 *
 * Draws are both always worth looking at -- taking the upcard is half the
 * information game. Discards are not: most of the eleven are plainly worse
 * than the rest, so they are ranked by the deadwood they leave behind and only
 * the best few go through. Knocking and big gin are always included when
 * legal, because the whole question at that moment is whether to take the
 * points now or play on, and that is exactly what the rollouts answer.
 */
function shortlist(view: GinView, width: number): GinAction[] {
  if (view.phase === 'draw') {
    const out: GinAction[] = [];
    if (view.stockCount > 0) out.push({ type: 'draw', from: 'stock' });
    if (view.discardTop) out.push({ type: 'draw', from: 'discard' });
    return out;
  }

  const out: GinAction[] = [];
  if (isBigGin(view.hand, view.rules)) out.push({ type: 'big-gin' });
  const options = knockOptions(view.hand, view.rules);
  const legal = options.find((o) => o.legal);
  if (legal) out.push({ type: 'knock', discard: legal.discard });
  for (const option of options.slice(0, width)) {
    out.push({ type: 'discard', card: option.discard });
  }
  return out;
}

/**
 * Is this sampled world a legal position?
 *
 * Cheap, and worth doing every time. A guess that has drifted produces a table
 * with one card in two hands at once, and a rollout of that is not a game of
 * gin -- it is noise with a score on the end, and noise that leans one way,
 * since a duplicated card tends to make a hand look better than it is.
 */
function playable(theirs: readonly Card[], pool: readonly Card[], view: GinView): boolean {
  if (theirs.length !== 10) return false;
  if (pool.length !== view.stockCount) return false;
  const seen = new Set<string>();
  for (const card of [...theirs, ...pool, ...view.hand]) {
    const id = cardId(card);
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/** One complete, consistent table built from a guess. */
function world(belief: Belief, view: GinView, theirs: Card[], stock: Card[]): GinState {
  const mine = view.hand.slice();
  const hands: [Card[], Card[]] =
    view.seat === 0 ? [mine, theirs.slice()] : [theirs.slice(), mine];
  return {
    rules: view.rules,
    seed: 0,
    stock: stock.slice(),
    discard: belief.pile.slice(),
    hands,
    turn: view.turn,
    phase: view.phase,
    knocker: null,
    score: null,
    reshuffles: 0,
    history: [],
  };
}

/** Points to us, minus points to them. */
export function margin(state: GinState, seat: Seat): number {
  if (!state.score || state.score.winner === null) return 0;
  const knocker = state.knocker ?? 0;
  const winner = state.score.winner === 'knocker' ? knocker : other(knocker);
  return winner === seat ? state.score.points : -state.score.points;
}

// --- The rollout ------------------------------------------------------------

/**
 * Play a sampled world out, quickly and the same way for both sides.
 *
 * Deliberately cruder than `bot.ts`: it takes the upcard only when the card
 * genuinely melds, throws its dearest loose card, and knocks as soon as the
 * rules allow. The point of a rollout is a consistent yardstick -- both sides
 * are measured by the same ruler, so a move that comes out ahead is ahead for
 * a reason to do with the cards rather than with the rollout's taste.
 *
 * It is about four times faster than running the real bot, and four times the
 * samples is worth far more here than a slightly better imaginary opponent.
 */
export function rollout(state: GinState, next: () => number, maxTurns = 200): GinState {
  let current = state;
  for (let i = 0; i < maxTurns && current.phase !== 'over'; i++) {
    current = apply(current, current.turn, rollAction(current, next));
  }
  return current;
}

function rollAction(state: GinState, next: () => number): GinAction {
  const hand = state.hands[state.turn];
  const top = state.discard[state.discard.length - 1] ?? null;

  if (state.phase === 'draw') {
    if (state.stock.length === 0) return { type: 'draw', from: 'discard' };
    if (!top) return { type: 'draw', from: 'stock' };
    const melds = analyzeHand([...hand, top]).deadwoodPoints < analyzeHand(hand).deadwoodPoints;
    // A little noise, so the rollout is not one fixed line of play that a
    // candidate move could happen to be built for.
    if (melds) return { type: 'draw', from: 'discard' };
    return next() < 0.04 ? { type: 'draw', from: 'discard' } : { type: 'draw', from: 'stock' };
  }

  const analysis = analyzeHand(hand);
  if (analysis.deadwood.length === 0) return { type: 'big-gin' };

  // The dearest loose card. Two cheap analyses instead of the eleven a proper
  // knockOptions scan would cost.
  let worst = analysis.deadwood[0];
  for (const card of analysis.deadwood) if (cardPoints(card) > cardPoints(worst)) worst = card;
  const kept = hand.filter((c) => cardId(c) !== cardId(worst));
  const left = analyzeHand(kept).deadwoodPoints;
  if (left <= state.rules.knockMaxDeadwood) return { type: 'knock', discard: worst };
  return { type: 'discard', card: worst };
}

// --- Keeping a belief honest, turn by turn ----------------------------------

export interface Solver {
  /**
   * Start a hand: our ten cards and the card turned up between us.
   *
   * Needed rather than inferred, because the second seat does not get to
   * decide anything until the first has already played, by which time the
   * opening upcard may be in their hand and the view no longer shows it. Both
   * players watched it turn over; the solver should not have to guess.
   */
  begin(hand: readonly Card[], upcard: Card, stock: number): void;
  /** Rank the moves available right now. */
  rank(view: GinView, history: readonly GinAction[]): Scored[];
  /** The best move, which is all a player needs. */
  act(view: GinView, history: readonly GinAction[]): GinAction;
  /** The current read, for anything that wants to explain itself. */
  belief(): Belief | null;
}

/**
 * A solver that follows one hand from the outside.
 *
 * It rebuilds nothing: each call folds in whatever has happened since the last
 * one, which keeps the cost per decision flat instead of growing with the
 * length of the hand. The important part is what it feeds the belief --
 * nothing but the public record and its own cards, converted into `Evidence`
 * one entry at a time. A card we drew blind is recovered by looking at what
 * appeared in our own hand, which is information we are entitled to and nobody
 * else gets.
 */
export function createSolver(options: SolveOptions, rules: GinRules): Solver {
  let belief: Belief | null = null;
  let consumed = 0;
  let mine: Card[] = [];

  function begin(hand: readonly Card[], upcard: Card, stock: number): Belief {
    belief = newBelief(
      { kind: 'deal', hand: hand.slice(), upcard, stock },
      options.next,
      rules,
      options.particles
    );
    mine = belief.mine.slice();
    consumed = 0;
    return belief;
  }

  function catchUp(view: GinView, history: readonly GinAction[]): Belief {
    // Started without being told the opening position: fall back to what is in
    // front of us, which is right for the seat that moves first and merely
    // incomplete for the other.
    const live = belief ?? begin(view.hand, view.discardTop ?? view.hand[0], view.stockCount);

    for (; consumed < history.length; consumed++) {
      const action = history[consumed];
      const seat = seatOf(consumed, history.length, view.seat);
      const top = live.pile[live.pile.length - 1] ?? null;

      if (seat === view.seat) {
        if (action.type === 'draw') {
          // Taking the upcard tells us the card; a blind draw does not, so it
          // is recovered from what turned up in our own hand.
          const card =
            action.from === 'discard'
              ? top
              : view.hand.find((c) => !mine.some((m) => cardId(m) === cardId(c))) ?? null;
          if (card) {
            observe(live, { kind: 'we-draw', card, from: action.from });
            mine.push(card);
          }
        } else if (action.type === 'discard' || action.type === 'knock') {
          const card = action.type === 'discard' ? action.card : action.discard;
          observe(live, { kind: 'we-discard', card });
          mine = mine.filter((c) => cardId(c) !== cardId(card));
        }
      } else {
        if (action.type === 'draw') {
          observe(live, { kind: 'they-draw', from: action.from });
        } else if (action.type === 'discard' || action.type === 'knock') {
          observe(live, {
            kind: 'they-discard',
            card: action.type === 'discard' ? action.card : action.discard,
          });
        }
      }
    }

    // Our own hand is ground truth, and this is the guard against the
    // bookkeeping above drifting out of step with it. Without it, one missed
    // step leaves a guess holding a card that is sitting in our own hand, and
    // every world sampled from that guess is an illegal position.
    live.mine = view.hand.slice();
    mine = view.hand.slice();
    reconcile(live);
    return live;
  }

  return {
    begin,
    rank(view, history) {
      return solve(catchUp(view, history), view, options);
    },
    act(view, history) {
      const ranked = solve(catchUp(view, history), view, options);
      return ranked[0]?.action ?? { type: 'draw', from: 'stock' };
    },
    belief: () => belief,
  };
}

/**
 * Which seat played history entry `at`.
 *
 * A turn is exactly two entries, a draw and a throw, and seats alternate -- so
 * the entry's turn number against the current one says whose it was. Anchoring
 * on the seat that is on move NOW rather than on who dealt means this works
 * from either side of the table without being told which side it is.
 *
 * The exceptions take care of themselves: a knock or a big gin ends the hand,
 * so neither can ever be followed by the entry that would break the pairing.
 */
function seatOf(at: number, length: number, seatNow: Seat): Seat {
  const turn = Math.floor(at / 2);
  const now = Math.floor(length / 2);
  return (now - turn) % 2 === 0 ? seatNow : other(seatNow);
}

export function describeAction(action: GinAction): string {
  switch (action.type) {
    case 'draw':
      return action.from === 'stock' ? 'draw blind' : 'take the upcard';
    case 'discard':
      return `throw the ${cardId(action.card)}`;
    case 'knock':
      return `knock, throwing the ${cardId(action.discard)}`;
    case 'big-gin':
      return 'big gin';
  }
}

/** How likely they are to want a card -- what makes a discard dangerous. */
export function dangerOf(belief: Belief, card: Card): number {
  return holdsChance(belief, card);
}
