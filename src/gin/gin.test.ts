import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RANKS,
  cardFromIndex,
  cardId,
  cardIndex,
  hand,
  handPoints,
  makeDeck,
  points,
  rng,
  shuffled,
} from './cards';
import { analysisIsConsistent, analyzeHand, extendsMeld } from './melds';
import {
  NAPOLETANE_GIN,
  canKnock,
  isBigGin,
  knockOptions,
  layOff,
  scoreHand,
} from './rules';

// --- The deck -----------------------------------------------------------------

test('deck is 40 unique cards', () => {
  const deck = makeDeck();
  assert.equal(deck.length, 40);
  assert.equal(new Set(deck.map(cardId)).size, 40);
});

test('points: 1-7 score face value, all three face cards score 8', () => {
  assert.deepEqual(
    RANKS.map(points),
    [1, 2, 3, 4, 5, 6, 7, 8, 8, 8]
  );
});

test('rank and points are separate: King outranks Jack but costs the same', () => {
  const [jack, king] = hand('ro8 ro10');
  assert.ok(king.rank > jack.rank, 'King must outrank Jack for runs');
  assert.equal(points(king.rank), points(jack.rank), 'but both cost 8');
});

test('cardIndex round-trips for every card', () => {
  for (const card of makeDeck()) {
    assert.equal(cardId(cardFromIndex(cardIndex(card))), cardId(card));
  }
});

test('shuffling is seeded and reproducible', () => {
  const deck = makeDeck();
  const a = shuffled(deck, rng(12345)).map(cardId);
  const b = shuffled(deck, rng(12345)).map(cardId);
  const c = shuffled(deck, rng(99999)).map(cardId);
  assert.deepEqual(a, b, 'same seed must deal the same hand');
  assert.notDeepEqual(a, c, 'different seeds must differ');
  assert.deepEqual([...a].sort(), deck.map(cardId).sort(), 'must stay a permutation');
});

// --- Melds --------------------------------------------------------------------

test('greedy would fail here: the run beats the set', () => {
  // Set of 5s leaves ro6+ro7 = 13. The run ro5-ro6-ro7 leaves su5+sw5 = 10.
  // Any rule-of-thumb that prefers sets, or prefers whichever it tries first,
  // gets this wrong.
  const a = analyzeHand(hand('ro5 su5 sw5 ro6 ro7'));
  assert.equal(a.deadwoodPoints, 10);
  assert.equal(a.melds.length, 1);
  assert.equal(a.melds[0].kind, 'run');
});

test('runs continue through the face cards', () => {
  assert.equal(analyzeHand(hand('ro7 ro8 ro9')).deadwoodPoints, 0, '7-Jack-Horse is a run');
  assert.equal(analyzeHand(hand('ro8 ro9 ro10')).deadwoodPoints, 0, 'Jack-Horse-King is a run');
});

test('face cards of one rank still form a set', () => {
  const a = analyzeHand(hand('ro8 su8 sw8'));
  assert.equal(a.deadwoodPoints, 0);
  assert.equal(a.melds[0].kind, 'set');
});

test('ace is low: King-1-2 is not a run', () => {
  // 8 + 1 + 2. If the sequence wrapped this would be 0.
  assert.equal(analyzeHand(hand('ro10 ro1 ro2')).deadwoodPoints, 11);
});

test('four-card melds are found', () => {
  assert.equal(analyzeHand(hand('ro1 ro2 ro3 ro4')).deadwoodPoints, 0);
  assert.equal(analyzeHand(hand('ro8 su8 sw8 go8')).deadwoodPoints, 0);
});

test('two cards can never meld', () => {
  assert.equal(analyzeHand(hand('ro1 ro2')).deadwoodPoints, 3);
  assert.equal(analyzeHand(hand('ro8 su8')).deadwoodPoints, 16);
});

test('a full gin hand melds to zero', () => {
  // run ro1-4, run su5-7, set of Jacks.
  const a = analyzeHand(hand('ro1 ro2 ro3 ro4 su5 su6 su7 sw8 go8 ro8'));
  assert.equal(a.deadwoodPoints, 0);
  assert.equal(a.deadwood.length, 0);
  assert.equal(a.melds.length, 3);
});

test('deadwood never exceeds the raw hand value, and the arrangement is consistent', () => {
  const next = rng(4242);
  const deck = makeDeck();
  for (let trial = 0; trial < 400; trial++) {
    const h = shuffled(deck, next).slice(0, 10);
    const a = analyzeHand(h);
    assert.ok(a.deadwoodPoints <= handPoints(h), 'melding cannot cost points');
    assert.ok(a.deadwoodPoints >= 0);
    assert.ok(analysisIsConsistent(h, a), `melds+deadwood must partition ${h.map(cardId).join(' ')}`);
  }
});

test('extendsMeld respects suit, both run ends, and the set cap', () => {
  const run = { kind: 'run' as const, cards: hand('ro3 ro4 ro5') };
  assert.ok(extendsMeld(run, hand('ro2')[0]), 'below the low end');
  assert.ok(extendsMeld(run, hand('ro6')[0]), 'above the high end');
  assert.ok(!extendsMeld(run, hand('su6')[0]), 'wrong suit');
  assert.ok(!extendsMeld(run, hand('ro7')[0]), 'not adjacent');

  const full = { kind: 'set' as const, cards: hand('ro8 su8 sw8 go8') };
  assert.ok(!extendsMeld(full, hand('ro8')[0]), 'a set of four is full');
});

// --- Knocking -----------------------------------------------------------------

const KNOCKABLE_11 = 'ro1 ro2 ro3 su5 sw5 go5 go8 go9 go10 ro7 su1';

test('knockOptions ranks discards by the deadwood they leave', () => {
  const options = knockOptions(hand(KNOCKABLE_11));
  assert.equal(cardId(options[0].discard), 'ro7', 'throw the 7 and keep the 1');
  assert.equal(options[0].deadwoodPoints, 1);
  assert.ok(options[0].legal);
  assert.ok(!options[0].gin);
  assert.ok(canKnock(hand(KNOCKABLE_11)));
});

test('a hand with no melds cannot knock', () => {
  const junk = hand('ro1 su3 sw5 go7 ro9 su10 sw2 go4 ro6 su8 sw10');
  assert.equal(junk.length, 11);
  assert.ok(!canKnock(junk));
  assert.ok(knockOptions(junk).every((o) => !o.legal));
});

test('big gin is eleven melded cards, and ordinary gin is not big gin', () => {
  const big = hand('ro1 ro2 ro3 ro4 su5 su6 su7 sw8 go8 ro8 su8');
  assert.equal(big.length, 11);
  assert.ok(isBigGin(big));

  const ten = hand('ro1 ro2 ro3 ro4 su5 su6 su7 sw8 go8 ro8');
  assert.ok(!isBigGin(ten), 'ten cards is never big gin, however it melds');
});

// --- Laying off ---------------------------------------------------------------

test('layoffs cascade: one card widens a run so the next one fits', () => {
  // ro7 cannot reach a 3-4-5 run. ro6 can, and once it lands the run reaches 6,
  // so ro7 goes too. A single pass that never revisits would leave ro7 behind.
  const melds = [{ kind: 'run' as const, cards: hand('ro3 ro4 ro5') }];
  const result = layOff(hand('ro6 ro7'), melds);
  assert.equal(result.laidOff.length, 2);
  assert.equal(result.remainingPoints, 0);
});

test('layoffs do not touch the original melds', () => {
  const melds = [{ kind: 'run' as const, cards: hand('ro3 ro4 ro5') }];
  layOff(hand('ro6'), melds);
  assert.equal(melds[0].cards.length, 3, 'caller-owned melds must be left alone');
});

test('a card that fits nothing stays as deadwood', () => {
  const melds = [{ kind: 'run' as const, cards: hand('ro3 ro4 ro5') }];
  const result = layOff(hand('su9'), melds);
  assert.equal(result.laidOff.length, 0);
  assert.equal(result.remainingPoints, 8);
});

// --- Scoring ------------------------------------------------------------------

// Knocker keeps ten with 1 point of deadwood; defender holds 6 and nothing it
// can lay off. Hands are disjoint.
const KNOCKER_1 = 'ro1 ro2 ro3 su5 sw5 go5 go8 go9 go10 su1';
const DEFENDER_6 = 'go1 go2 go3 sw7 sw8 sw9 ro4 go4 sw4 su6';

test('an ordinary knock scores the difference', () => {
  const score = scoreHand(hand(KNOCKER_1), hand(DEFENDER_6));
  assert.equal(score.outcome, 'knock');
  assert.equal(score.winner, 'knocker');
  assert.equal(score.knockerDeadwood, 1);
  assert.equal(score.defenderDeadwood, 6);
  assert.equal(score.points, 5);
});

test('the defender undercuts and takes the bonus plus the margin', () => {
  // Knocker sits on 8 -- legal, but the thinnest possible knock.
  const knocker = hand('ro1 ro2 ro3 su5 sw5 go5 go8 go9 go10 ro8');
  const score = scoreHand(knocker, hand(DEFENDER_6));
  assert.equal(score.knockerDeadwood, 8);
  assert.equal(score.defenderDeadwood, 6);
  assert.equal(score.outcome, 'undercut');
  assert.equal(score.winner, 'defender');
  assert.equal(score.points, NAPOLETANE_GIN.undercutBonus + 2);
});

test('a tie goes to the defender by default, and the flag flips it', () => {
  // Both on 6: defender's su6 against a knocker holding a bare su6-equivalent.
  const knocker = hand('ro1 ro2 ro3 su5 sw5 go5 go8 go9 go10 ro6');
  const tied = scoreHand(knocker, hand(DEFENDER_6));
  assert.equal(tied.knockerDeadwood, 6);
  assert.equal(tied.defenderDeadwood, 6);
  assert.equal(tied.outcome, 'undercut');
  assert.equal(tied.points, NAPOLETANE_GIN.undercutBonus, 'bonus with a zero margin');

  const strict = scoreHand(knocker, hand(DEFENDER_6), {
    ...NAPOLETANE_GIN,
    tieGoesToDefender: false,
  });
  assert.equal(strict.outcome, 'knock');
  assert.equal(strict.points, 0);
});

test('gin refuses layoffs, which is what makes it worth chasing', () => {
  const ginHand = hand('ro1 ro2 ro3 ro4 su5 su6 su7 sw8 go8 ro8');
  // ro5 would extend the knocker's ro1-ro4 run if layoffs were allowed.
  const defender = hand('go1 go2 go3 sw3 sw4 sw5 su9 go9 sw9 ro5');

  const score = scoreHand(ginHand, defender);
  assert.equal(score.outcome, 'gin');
  assert.equal(score.knockerDeadwood, 0);
  assert.equal(score.laidOff.length, 0, 'no laying off against gin');
  assert.equal(score.defenderDeadwood, 5);
  assert.equal(score.points, NAPOLETANE_GIN.ginBonus + 5);

  const permissive = scoreHand(ginHand, defender, {
    ...NAPOLETANE_GIN,
    layoffAgainstGin: true,
  });
  assert.equal(permissive.laidOff.length, 1, 'ro5 extends the run');
  assert.equal(permissive.points, NAPOLETANE_GIN.ginBonus, 'defender escapes to zero');
});

test('big gin pays the larger bonus', () => {
  const big = hand('ro1 ro2 ro3 ro4 su5 su6 su7 sw8 go8 ro8 su8');
  const score = scoreHand(big, hand(DEFENDER_6));
  assert.equal(score.outcome, 'big-gin');
  assert.equal(score.winner, 'knocker');
  assert.equal(score.points, NAPOLETANE_GIN.bigGinBonus + 6);
});
