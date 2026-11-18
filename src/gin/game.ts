import { type Card, cardId, makeDeck, rng, shuffled } from './cards';
import { analyzeHand, type Meld } from './melds';
import {
  type GinRules,
  type HandScore,
  NAPOLETANE_GIN,
  STOCK_FLOOR,
  deadHand,
  isBigGin,
  knockOptions,
  scoreHand,
} from './rules';

/**
 * One hand of play, as a pure state machine.
 *
 * No I/O, no timers, no sockets. The server will own an instance of this and be
 * the only thing allowed to mutate it; the client will only ever see what
 * `viewFor` hands out. Writing it this way round -- state machine first,
 * transport later -- is deliberate: it means the multiplayer layer is a thin
 * shell over something already tested, and the solver can run thousands of
 * hypothetical hands through the identical code the real game uses.
 *
 * Illegality is reported, never assumed away. `canApply` returns a reason
 * string so a server can reject a malformed or cheating message and say why,
 * and the UI can grey out what isn't available, both from the same function.
 */

export type Seat = 0 | 1;

export function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

export type GinAction =
  | { type: 'draw'; from: 'stock' | 'discard' }
  | { type: 'discard'; card: Card }
  /** Knocking always sheds a card, so the discard is part of the same action. */
  | { type: 'knock'; discard: Card }
  /** All eleven cards meld, so there is nothing to throw. */
  | { type: 'big-gin' };

export type Phase = 'draw' | 'discard' | 'over';

export interface GinState {
  rules: GinRules;
  /** Kept so a finished hand can be replayed from (seed, actions) alone. */
  seed: number;
  stock: Card[];
  /** Last element is the visible top card. */
  discard: Card[];
  hands: [Card[], Card[]];
  turn: Seat;
  phase: Phase;
  knocker: Seat | null;
  score: HandScore | null;
  /** Counted so a reshuffling ruleset cannot cycle forever. */
  reshuffles: number;
  history: GinAction[];
}

export function deal(seed: number, rules: GinRules = NAPOLETANE_GIN): GinState {
  const deck = shuffled(makeDeck(), rng(seed));
  const size = rules.handSize;
  return {
    rules,
    seed,
    hands: [deck.slice(0, size), deck.slice(size, size * 2)],
    // One card turned face up, which is what gives the first player a real
    // decision on move one rather than a blind draw.
    discard: [deck[size * 2]],
    stock: deck.slice(size * 2 + 1),
    turn: 0,
    phase: 'draw',
    knocker: null,
    score: null,
    reshuffles: 0,
    history: [],
  };
}

function handHas(hand: readonly Card[], card: Card): boolean {
  return hand.some((c) => cardId(c) === cardId(card));
}

function withoutCard(hand: readonly Card[], card: Card): Card[] {
  const i = hand.findIndex((c) => cardId(c) === cardId(card));
  const out = hand.slice();
  out.splice(i, 1);
  return out;
}

/** Null when the action is allowed; otherwise why it isn't. */
export function canApply(state: GinState, seat: Seat, action: GinAction): string | null {
  if (state.phase === 'over') return 'the hand is over';
  if (seat !== state.turn) return 'not your turn';

  if (state.phase === 'draw') {
    if (action.type !== 'draw') return `must draw first, not ${action.type}`;
    if (action.from === 'stock' && state.stock.length === 0) return 'the stock is empty';
    if (action.from === 'discard' && state.discard.length === 0) return 'the discard pile is empty';
    return null;
  }

  // phase === 'discard': the player is holding handSize + 1 cards.
  const hand = state.hands[seat];
  switch (action.type) {
    case 'draw':
      return 'already drawn this turn';
    case 'discard':
      if (!handHas(hand, action.card)) return 'that card is not in your hand';
      return null;
    case 'knock': {
      if (!handHas(hand, action.discard)) return 'that card is not in your hand';
      const kept = withoutCard(hand, action.discard);
      const { deadwoodPoints } = analyzeHand(kept);
      if (deadwoodPoints > state.rules.knockMaxDeadwood) {
        return `${deadwoodPoints} deadwood is over the ${state.rules.knockMaxDeadwood} limit`;
      }
      return null;
    }
    case 'big-gin':
      if (!isBigGin(hand, state.rules)) return 'not all of your cards meld';
      return null;
  }
}

/**
 * Advance the hand. Throws on an illegal action -- callers that take untrusted
 * input should ask `canApply` first and handle the reason themselves.
 */
export function apply(state: GinState, seat: Seat, action: GinAction): GinState {
  const reason = canApply(state, seat, action);
  if (reason) throw new Error(`illegal action (${action.type}): ${reason}`);

  const next: GinState = {
    ...state,
    stock: state.stock.slice(),
    discard: state.discard.slice(),
    hands: [state.hands[0].slice(), state.hands[1].slice()],
    history: [...state.history, action],
  };

  if (action.type === 'draw') {
    const card =
      action.from === 'stock' ? next.stock.shift()! : next.discard.pop()!;
    next.hands[seat] = [...next.hands[seat], card];
    next.phase = 'discard';
    return next;
  }

  if (action.type === 'big-gin') {
    // No discard: the whole hand is melded, so all eleven cards score.
    next.score = scoreHand(next.hands[seat], next.hands[other(seat)], next.rules);
    next.knocker = seat;
    next.phase = 'over';
    return next;
  }

  const thrown = action.type === 'knock' ? action.discard : action.card;
  next.hands[seat] = withoutCard(next.hands[seat], thrown);
  next.discard.push(thrown);

  if (action.type === 'knock') {
    next.score = scoreHand(next.hands[seat], next.hands[other(seat)], next.rules);
    next.knocker = seat;
    next.phase = 'over';
    return next;
  }

  next.turn = other(seat);
  next.phase = 'draw';
  return endOfStock(next);
}

/**
 * The stock running down to its floor, which this ruleset reaches often enough
 * to matter: ten cards each plus an upcard leaves only nineteen to draw from.
 *
 * Measured over 3000 simulated hands with blind draws only, about 10% of hands
 * end here, so it is a tail case rather than the norm -- but a frequent enough
 * tail that the two behaviours are a config switch rather than a decision baked
 * into this function.
 */
function endOfStock(state: GinState): GinState {
  if (state.stock.length > STOCK_FLOOR) return state;

  if (state.rules.stockOut === 'dead-hand') {
    return { ...state, phase: 'over', score: deadHand() };
  }

  // Reshuffle: the top card stays face up to keep the pile playable, and
  // everything beneath it becomes the new stock. Derived from the original seed
  // so a replay reproduces it exactly without storing the shuffled order.
  const top = state.discard[state.discard.length - 1];
  const rest = state.discard.slice(0, -1);
  if (rest.length === 0) {
    return { ...state, phase: 'over', score: deadHand() };
  }
  const reshuffles = state.reshuffles + 1;
  return {
    ...state,
    stock: shuffled(rest, rng(state.seed + 7919 * reshuffles)),
    discard: top ? [top] : [],
    reshuffles,
  };
}

// --- What a player is allowed to see -----------------------------------------

export interface GinView {
  seat: Seat;
  rules: GinRules;
  hand: Card[];
  /** Best arrangement of your own hand, so the UI never recomputes it wrongly. */
  melds: Meld[];
  deadwood: Card[];
  deadwoodPoints: number;
  discardTop: Card | null;
  discardCount: number;
  stockCount: number;
  opponentCardCount: number;
  turn: Seat;
  phase: Phase;
  yourTurn: boolean;
  knocker: Seat | null;
  score: HandScore | null;
  /** Only once the hand is over. Null while it is live. */
  opponentHand: Card[] | null;
}

/**
 * The only thing a client is ever given.
 *
 * The stock's ORDER and the opponent's cards never appear here while the hand
 * is live, and that is the whole point: a card game that ships hidden state to
 * the browser is cheatable by anyone who opens devtools, no matter what the UI
 * chooses to draw. Counts go out instead of contents, and the opponent's hand
 * appears only once `phase` is `over` and it is being shown anyway.
 */
export function viewFor(state: GinState, seat: Seat): GinView {
  const hand = state.hands[seat];
  const analysis = analyzeHand(hand);
  const over = state.phase === 'over';
  return {
    seat,
    rules: state.rules,
    hand: hand.slice(),
    melds: analysis.melds,
    deadwood: analysis.deadwood,
    deadwoodPoints: analysis.deadwoodPoints,
    discardTop: state.discard.length ? state.discard[state.discard.length - 1] : null,
    discardCount: state.discard.length,
    stockCount: state.stock.length,
    opponentCardCount: state.hands[other(seat)].length,
    turn: state.turn,
    phase: state.phase,
    yourTurn: !over && state.turn === seat,
    knocker: state.knocker,
    score: state.score,
    opponentHand: over ? state.hands[other(seat)].slice() : null,
  };
}

/** Everything `seat` could legally do right now. Drives both the UI and the bot. */
export function legalActions(state: GinState, seat: Seat): GinAction[] {
  if (state.phase === 'over' || state.turn !== seat) return [];

  if (state.phase === 'draw') {
    const actions: GinAction[] = [];
    if (state.stock.length > 0) actions.push({ type: 'draw', from: 'stock' });
    if (state.discard.length > 0) actions.push({ type: 'draw', from: 'discard' });
    return actions;
  }

  const hand = state.hands[seat];
  const actions: GinAction[] = [];
  if (isBigGin(hand, state.rules)) actions.push({ type: 'big-gin' });
  for (const option of knockOptions(hand, state.rules)) {
    actions.push({ type: 'discard', card: option.discard });
    if (option.legal) actions.push({ type: 'knock', discard: option.discard });
  }
  return actions;
}
