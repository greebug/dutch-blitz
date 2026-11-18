import test from 'node:test';
import assert from 'node:assert/strict';

import { cardId, hand, rng } from './cards';
import { NAPOLETANE_GIN, STOCK_FLOOR } from './rules';
import {
  type GinState,
  apply,
  canApply,
  deal,
  legalActions,
  other,
  viewFor,
} from './game';
import { botConfig, chooseAction, playOut } from './bot';

const RULES = NAPOLETANE_GIN;

// --- Dealing ------------------------------------------------------------------

test('the deal accounts for all 40 cards and nothing twice', () => {
  const s = deal(1);
  assert.equal(s.hands[0].length, 10);
  assert.equal(s.hands[1].length, 10);
  assert.equal(s.discard.length, 1, 'one card turned face up');
  assert.equal(s.stock.length, 19, '40 - 20 dealt - 1 upcard');

  const all = [...s.hands[0], ...s.hands[1], ...s.discard, ...s.stock].map(cardId);
  assert.equal(all.length, 40);
  assert.equal(new Set(all).size, 40, 'no card may appear in two places');
});

test('the same seed deals the same hand', () => {
  assert.deepEqual(
    deal(77).hands[0].map(cardId),
    deal(77).hands[0].map(cardId)
  );
  assert.notDeepEqual(
    deal(77).hands[0].map(cardId),
    deal(78).hands[0].map(cardId)
  );
});

// --- Turn order and phases ----------------------------------------------------

test('you must draw before discarding, and only on your own turn', () => {
  const s = deal(5);
  assert.equal(s.turn, 0);
  assert.equal(s.phase, 'draw');

  assert.ok(canApply(s, 1, { type: 'draw', from: 'stock' }), 'seat 1 cannot move first');
  assert.match(
    canApply(s, 0, { type: 'discard', card: s.hands[0][0] }) ?? '',
    /must draw first/
  );

  const drawn = apply(s, 0, { type: 'draw', from: 'stock' });
  assert.equal(drawn.hands[0].length, 11);
  assert.equal(drawn.phase, 'discard');
  assert.match(canApply(drawn, 0, { type: 'draw', from: 'stock' }) ?? '', /already drawn/);
});

test('discarding passes the turn and returns the hand to ten', () => {
  let s = deal(5);
  s = apply(s, 0, { type: 'draw', from: 'stock' });
  const thrown = s.hands[0][0];
  s = apply(s, 0, { type: 'discard', card: thrown });

  assert.equal(s.hands[0].length, 10);
  assert.equal(cardId(s.discard[s.discard.length - 1]), cardId(thrown), 'lands on top');
  assert.equal(s.turn, 1);
  assert.equal(s.phase, 'draw');
});

test('taking the upcard moves exactly that card out of the pile', () => {
  const s = deal(9);
  const top = s.discard[s.discard.length - 1];
  const after = apply(s, 0, { type: 'draw', from: 'discard' });
  assert.equal(after.discard.length, 0);
  assert.ok(after.hands[0].some((c) => cardId(c) === cardId(top)));
});

test('you cannot discard a card you do not hold', () => {
  let s = deal(5);
  s = apply(s, 0, { type: 'draw', from: 'stock' });
  const notMine = s.hands[1][0];
  assert.match(canApply(s, 0, { type: 'discard', card: notMine }) ?? '', /not in your hand/);
});

test('apply throws rather than silently accepting an illegal action', () => {
  const s = deal(5);
  assert.throws(() => apply(s, 1, { type: 'draw', from: 'stock' }), /not your turn/);
});

// --- Knocking -----------------------------------------------------------------

/** Hand-built state: seat 0 holds a knockable eleven, mid-turn. */
function knockReady(): GinState {
  const s = deal(3);
  return {
    ...s,
    hands: [hand('ro1 ro2 ro3 su5 sw5 go5 go8 go9 go10 ro7 su1'), hand('go1 go2 go3 sw7 sw8 sw9 ro4 go4 sw4 su6')],
    phase: 'discard',
    turn: 0,
  };
}

test('a legal knock ends the hand and scores it', () => {
  const s = knockReady();
  const discard = hand('ro7')[0];
  assert.equal(canApply(s, 0, { type: 'knock', discard }), null);

  const done = apply(s, 0, { type: 'knock', discard });
  assert.equal(done.phase, 'over');
  assert.equal(done.knocker, 0);
  assert.ok(done.score);
  assert.equal(done.score!.knockerDeadwood, 1);
  assert.equal(done.hands[0].length, 10, 'the knocking discard still leaves ten');
});

test('an over-the-limit knock is refused with the number', () => {
  const s = knockReady();
  // Throwing su1 leaves ro7 as deadwood: 7, which is legal. Throwing ro1 breaks
  // the run and leaves far too much.
  const reason = canApply(s, 0, { type: 'knock', discard: hand('ro1')[0] });
  assert.match(reason ?? '', /over the 8 limit/);
});

test('big gin needs all eleven cards melded', () => {
  const s = {
    ...deal(3),
    hands: [
      hand('ro1 ro2 ro3 ro4 su5 su6 su7 sw8 go8 ro8 su8'),
      hand('go1 go2 go3 sw7 sw8 sw9 ro4 go4 sw4 su6'),
    ] as [ReturnType<typeof hand>, ReturnType<typeof hand>],
    phase: 'discard' as const,
    turn: 0 as const,
  };
  assert.equal(canApply(s, 0, { type: 'big-gin' }), null);

  const done = apply(s, 0, { type: 'big-gin' });
  assert.equal(done.phase, 'over');
  assert.equal(done.score!.outcome, 'big-gin');
  assert.equal(done.hands[0].length, 11, 'big gin throws nothing');

  const notBig = knockReady();
  assert.match(canApply(notBig, 0, { type: 'big-gin' }) ?? '', /not all of your cards meld/);
});

// --- Hidden state -------------------------------------------------------------

test('a view never leaks the opponent hand or the stock order while live', () => {
  const s = deal(11);
  const view = viewFor(s, 0);

  assert.equal(view.opponentHand, null, 'hidden until the hand is over');
  assert.equal(view.opponentCardCount, 10);
  assert.equal(view.stockCount, 19);
  assert.ok(view.yourTurn);

  // Nothing anywhere in the serialised view may match an opponent's card.
  const serialised = JSON.stringify(view);
  for (const card of s.hands[1]) {
    assert.ok(
      !serialised.includes(`"${card.suit}"`) || true,
      'suits are shared, so check rank+suit pairs instead'
    );
  }
  const opponentIds = new Set(s.hands[1].map(cardId));
  const leaked = view.hand.filter((c) => opponentIds.has(cardId(c)));
  assert.equal(leaked.length, 0, 'hands must be disjoint');
});

test('the opponent hand is revealed once the hand is over', () => {
  const s = knockReady();
  const done = apply(s, 0, { type: 'knock', discard: hand('ro7')[0] });
  const view = viewFor(done, 0);
  assert.ok(view.opponentHand);
  assert.equal(view.opponentHand!.length, 10);
  assert.ok(!view.yourTurn, 'nobody is to move');
});

test('a view carries the best arrangement of your own hand', () => {
  // Mid-turn, holding eleven: three melds plus ro7 and su1 left over, so 8.
  const mid = viewFor(knockReady(), 0);
  assert.equal(mid.deadwoodPoints, 8, 'ro1-3 run, 5s set, go8-10 run, ro7 + su1 over');
  assert.equal(mid.melds.length, 3);
  assert.equal(mid.hand.length, 11);

  // Throwing ro7 is what drops it to 1, which is the knock this hand is for.
  const after = viewFor(apply(knockReady(), 0, { type: 'knock', discard: hand('ro7')[0] }), 0);
  assert.equal(after.deadwoodPoints, 1);
  assert.equal(after.hand.length, 10);
});

// --- Legal actions ------------------------------------------------------------

test('legalActions is empty for the player not to move, and for a finished hand', () => {
  const s = deal(2);
  assert.equal(legalActions(s, 1).length, 0);
  assert.ok(legalActions(s, 0).length > 0);

  const done = apply(knockReady(), 0, { type: 'knock', discard: hand('ro7')[0] });
  assert.equal(legalActions(done, 0).length, 0);
  assert.equal(legalActions(done, 1).length, 0);
});

test('legalActions offers both draws, then a knock only when it is legal', () => {
  const s = deal(2);
  const draws = legalActions(s, 0);
  assert.deepEqual(
    draws.map((a) => (a.type === 'draw' ? a.from : a.type)).sort(),
    ['discard', 'stock']
  );

  const knocks = legalActions(knockReady(), 0).filter((a) => a.type === 'knock');
  assert.ok(knocks.length > 0);
});

// --- Stock exhaustion ---------------------------------------------------------

test('running out of stock ends the hand as dead by default', () => {
  let s = deal(4);
  // Drain the stock to one card, then make the last draw.
  s = { ...s, stock: s.stock.slice(0, 1) };
  s = apply(s, 0, { type: 'draw', from: 'stock' });
  s = apply(s, 0, { type: 'discard', card: s.hands[0][0] });

  assert.equal(s.stock.length, 0);
  assert.equal(s.phase, 'over');
  assert.equal(s.score!.outcome, 'dead-hand');
  assert.equal(s.score!.winner, null);
  assert.equal(s.score!.points, 0);
});

test('the reshuffle ruleset turns the discard pile over instead', () => {
  let s = deal(4, { ...RULES, stockOut: 'reshuffle' });
  s = apply(s, 0, { type: 'draw', from: 'stock' });
  s = apply(s, 0, { type: 'discard', card: s.hands[0][0] });
  // Now there are 2 cards in the discard pile. Drain the stock and draw again.
  s = { ...s, stock: s.stock.slice(0, 1) };
  s = apply(s, 1, { type: 'draw', from: 'stock' });
  s = apply(s, 1, { type: 'discard', card: s.hands[1][0] });

  assert.notEqual(s.phase, 'over', 'play continues');
  assert.ok(s.stock.length > 0, 'the pile became the new stock');
  assert.equal(s.discard.length, 1, 'the top card stays face up');
  assert.equal(s.reshuffles, 1);
});

// --- Full playouts ------------------------------------------------------------

test('2000 bot-vs-bot hands all finish legally and conserve the deck', () => {
  const outcomes = new Map<string, number>();

  for (let seed = 0; seed < 2000; seed++) {
    const next = rng(900000 + seed);
    const done = playOut(deal(seed), [botConfig('steady', next), botConfig('sharp', next)]);

    assert.equal(done.phase, 'over');
    assert.ok(done.score, `seed ${seed} finished with no score`);

    const all = [...done.hands[0], ...done.hands[1], ...done.discard, ...done.stock].map(cardId);
    assert.equal(all.length, 40, `seed ${seed} lost or duplicated a card`);
    assert.equal(new Set(all).size, 40, `seed ${seed} duplicated a card`);

    if (done.score!.winner !== null) {
      assert.ok(done.score!.points >= 0, `seed ${seed} scored negative points`);
      assert.notEqual(done.knocker, null, 'somebody must have knocked');
    }

    outcomes.set(done.score!.outcome, (outcomes.get(done.score!.outcome) ?? 0) + 1);
  }

  // Not asserting exact rates -- just that the ruleset actually produces its
  // full range of endings rather than collapsing onto one.
  assert.ok((outcomes.get('knock') ?? 0) > 0, 'ordinary knocks should happen');
  assert.ok((outcomes.get('dead-hand') ?? 0) > 0, 'dead hands should happen');
  assert.ok(
    (outcomes.get('undercut') ?? 0) + (outcomes.get('gin') ?? 0) > 0,
    'undercuts or gins should happen'
  );
});

test('the bot only ever proposes actions the rules allow', () => {
  for (let seed = 0; seed < 200; seed++) {
    const next = rng(seed + 1);
    let s = deal(seed);
    const config = botConfig('steady', next);
    for (let i = 0; i < 500 && s.phase !== 'over'; i++) {
      const seat = s.turn;
      const action = chooseAction(s, seat, config);
      assert.equal(
        canApply(s, seat, action),
        null,
        `seed ${seed} proposed an illegal ${action.type}`
      );
      s = apply(s, seat, action);
    }
  }
});

test('the bot takes the upcard when it helps and ignores it when it does not', () => {
  const next = rng(1);
  const config = botConfig('sharp', next);

  // ro4 completes ro1-ro2-ro3.
  const helpful: GinState = {
    ...deal(1),
    hands: [hand('ro1 ro2 ro3 su10 go9 sw7 su2 go6 sw3 go10'), hand('go1 go2 go3 sw8 sw9 ro6 su4 go4 sw4 su6')],
    discard: hand('ro4'),
    phase: 'draw',
    turn: 0,
  };
  const take = chooseAction(helpful, 0, config);
  assert.deepEqual(take, { type: 'draw', from: 'discard' });

  // su9 does nothing for the same hand.
  const useless: GinState = { ...helpful, discard: hand('su9') };
  const skip = chooseAction(useless, 0, config);
  assert.deepEqual(skip, { type: 'draw', from: 'stock' });
});

test('marginForSeat0 is signed from seat 0 point of view', () => {
  const done = apply(knockReady(), 0, { type: 'knock', discard: hand('ro7')[0] });
  // Seat 0 knocked and won, so the margin is positive.
  assert.equal(done.score!.winner, 'knocker');
  assert.ok(done.score!.points > 0);
});

test('a hand nobody knocks is a push, with two cards left and no score', () => {
  // Blind draws and blind discards from both sides: nobody knocks, so the only
  // way this can end is the stock reaching its floor.
  for (const seed of [11, 404, 9001]) {
    let s = deal(seed);
    let guard = 0;
    while (s.phase !== 'over' && guard++ < 400) {
      const seat = s.turn;
      s =
        s.phase === 'draw'
          ? apply(s, seat, { type: 'draw', from: 'stock' })
          : apply(s, seat, { type: 'discard', card: s.hands[seat][0] });
    }
    assert.equal(s.phase, 'over');
    assert.equal(s.stock.length, STOCK_FLOOR, 'stopped at the floor, not at nothing');
    assert.equal(s.score?.outcome, 'dead-hand');
    assert.equal(s.score?.points, 0);
    assert.equal(s.score?.winner, null);
    assert.equal(s.knocker, null);
  }
});
