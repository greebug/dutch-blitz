import { cardFromIndex, cardIndex } from '../cards';
import type { Player, PlayerFactory } from '../arena';
import type { GinAction, Seat } from '../game';
import { BIG_GIN, KNOCK, type Policy, type Public, type Seen, blankPublic, masksOf } from './fast';

/**
 * A lab policy, seated at the real table.
 *
 * The referee (`game.ts`) hands a player a redacted `GinView` and the public
 * action log, and nothing else. This rebuilds the lab's `Public` record from
 * exactly those two things -- the pile, the stock count, who took, threw and
 * passed what -- and asks the policy. So the champion plays real games through
 * the same keyhole a human at the table looks through, and anything it does in
 * the lab it does here, decision for decision (`adapter.test.ts` checks).
 *
 * `match` optionally tells it the match score, which the referee's view does
 * not carry; without it the policy plays every hand as if it were the first.
 */
export interface MatchContext {
  scores: [number, number];
  target: number;
}

export function seated(policy: Policy, match?: () => MatchContext): Player {
  let pub: Public = blankPublic();
  let seen: Seen | null = null;
  let consumed = 0;
  let mySeat: Seat = 0;

  function fresh(seat: Seat, hand: readonly number[], upcard: number, stock: number) {
    pub = blankPublic();
    pub.pile.push(upcard);
    pub.stockCount = stock;
    const ctx = match?.();
    if (ctx) {
      pub.scores = [ctx.scores[0], ctx.scores[1]];
      pub.target = ctx.target;
    }
    mySeat = seat;
    seen = { seat, hand: hand.slice(), masks: masksOf(hand), pub };
    consumed = 0;
    policy.begin?.(seen);
  }

  function replay(history: readonly GinAction[]) {
    for (; consumed < history.length; consumed++) advancePublic(pub, history[consumed], consumed);
  }

  return {
    name: policy.name,
    begin(seat, hand, upcard, stock) {
      fresh(seat, hand.map(cardIndex), cardIndex(upcard), stock);
    },
    act(view, history) {
      if (!seen || history.length < consumed) {
        // Never told the hand began: the opening seat can still start cleanly.
        fresh(view.seat, view.hand.map(cardIndex), view.discardTop ? cardIndex(view.discardTop) : 0, view.stockCount);
      }
      replay(history);
      const s = seen!;
      s.hand = view.hand.map(cardIndex);
      s.masks = masksOf(s.hand);
      pub.turn = mySeat;
      if (view.phase === 'draw') {
        if (!view.discardTop) return { type: 'draw', from: 'stock' };
        if (view.stockCount === 0) return { type: 'draw', from: 'discard' };
        return { type: 'draw', from: policy.draw(s) ? 'discard' : 'stock' };
      }
      const move = policy.throw(s);
      if (move === BIG_GIN) return { type: 'big-gin' };
      if (move >= KNOCK) return { type: 'knock', discard: cardFromIndex(move - KNOCK) };
      return { type: 'discard', card: cardFromIndex(move) };
    },
  };
}

/**
 * Fold the `index`-th entry of a hand's public action log into `pub`.
 *
 * Two entries per turn, seat 0 first: the hand ends on a knock, so the pattern
 * never breaks before the end.
 */
export function advancePublic(pub: Public, action: GinAction, index: number): void {
  const seat = (Math.floor(index / 2) % 2) as Seat;
  const top = pub.pile.length ? pub.pile[pub.pile.length - 1] : -1;
  if (action.type === 'draw') {
    if (action.from === 'discard') {
      pub.pile.pop();
      pub.taken[seat][top] = 1;
    } else {
      if (top >= 0) pub.passed[seat][top] = 1;
      pub.stockCount--;
    }
  } else if (action.type === 'discard' || action.type === 'knock') {
    const c = cardIndex(action.type === 'discard' ? action.card : action.discard);
    pub.pile.push(c);
    pub.thrown[seat][c] = 1;
    pub.taken[seat][c] = 0;
    pub.turns++;
    pub.turn = seat === 0 ? 1 : 0;
  }
}

/** For the arena: a fresh seated policy per hand. */
export function seatedFactory(make: () => Policy): PlayerFactory {
  return () => seated(make());
}
