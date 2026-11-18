import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type Card, cardId, hand, parseCardId, rng } from './cards';
import { type PlayerFactory, greedy, hoarder, magpie } from './arena';
import { type Seat, apply, deal, viewFor } from './game';
import { NAPOLETANE_GIN } from './rules';
import {
  type Belief,
  holdsAllChance,
  holdsChance,
  isBuried,
  newBelief,
  observe,
  takeGain,
  unseen,
} from './belief';

/** The chance a specific unseen card is in their hand before any evidence. */
function prior(belief: Belief): number {
  return belief.opponentCount / unseen(belief).length;
}

function start(mine: string, upcard: string, seed = 20260101): Belief {
  return newBelief(
    { kind: 'deal', hand: hand(mine), upcard: parseCardId(upcard), stock: 19 },
    rng(seed)
  );
}

describe('belief: what the record implies', () => {
  it('starts out knowing nothing beyond the count', () => {
    const belief = start('ro1 ro2 su3 su4 sw5 sw6 go7 go8 ro9 su1', 'sw10');
    const expected = prior(belief);
    for (const id of ['go10', 'ro10', 'su7', 'sw2']) {
      const p = holdsChance(belief, parseCardId(id));
      assert.ok(
        Math.abs(p - expected) < 0.06,
        `${id} should sit near the prior ${expected.toFixed(2)}, got ${p.toFixed(2)}`
      );
    }
  });

  it('never believes they hold a card it can see somewhere else', () => {
    const belief = start('ro1 ro2 su3 su4 sw5 sw6 go7 go8 ro9 su1', 'sw10');
    observe(belief, { kind: 'they-draw', from: 'stock' });
    observe(belief, { kind: 'they-discard', card: parseCardId('go2') });
    observe(belief, { kind: 'we-draw', card: parseCardId('go2'), from: 'discard' });
    observe(belief, { kind: 'we-discard', card: parseCardId('su1') });

    for (const card of belief.mine) {
      assert.equal(holdsChance(belief, card), 0, `${cardId(card)} is in our own hand`);
    }
    for (const card of belief.pile) {
      assert.equal(holdsChance(belief, card), 0, `${cardId(card)} is on the pile`);
    }
  });

  it('reads a take as a run, not a set', () => {
    // The case that motivates the whole file. They take the King of roots and
    // then throw the King of goblets. A player holding three Kings does not
    // throw one of them, so the take was not about Kings -- it was about
    // roots, and the cards that make it worth taking are the Jack and the
    // Horse of roots.
    const belief = start('ro1 ro2 su3 su4 sw5 sw6 go7 go1 su7 sw2', 'ro10');
    const before = {
      jack: holdsChance(belief, parseCardId('ro8')),
      horse: holdsChance(belief, parseCardId('ro9')),
      king: holdsChance(belief, parseCardId('su10')),
    };

    observe(belief, { kind: 'they-draw', from: 'discard' });
    observe(belief, { kind: 'they-discard', card: parseCardId('go10') });

    const after = {
      jack: holdsChance(belief, parseCardId('ro8')),
      horse: holdsChance(belief, parseCardId('ro9')),
      king: holdsChance(belief, parseCardId('su10')),
    };

    assert.ok(
      after.jack > before.jack * 1.4,
      `Jack of roots should jump: ${before.jack.toFixed(2)} -> ${after.jack.toFixed(2)}`
    );
    assert.ok(
      after.horse > before.horse * 1.4,
      `Horse of roots should jump: ${before.horse.toFixed(2)} -> ${after.horse.toFixed(2)}`
    );
    assert.ok(
      after.king < before.king,
      `another King should fall: ${before.king.toFixed(2)} -> ${after.king.toFixed(2)}`
    );
  });

  it('reads a pass as evidence about combinations, not single cards', () => {
    // We throw the 5 of swords and they draw blind rather than take it.
    // Passing says little about the 6 of swords on its own -- plenty of hands
    // hold the 6 and have no use for the 5 -- but a hand holding the 6 AND the
    // 7 would have taken it, and a hand holding two other 5s certainly would.
    //
    // The drop is real but modest, and that is the honest answer rather than a
    // weak filter: one pass is evidence against every hand that wanted that
    // card, and there are a lot of them -- two other 5s, the 3 and 4, the 4
    // and 6. The suspicion gets spread across all of them.
    const belief = start('ro1 ro2 su3 su4 go7 go1 su7 sw2 sw10 go10', 'ro3');
    const run = () => holdsAllChance(belief, hand('sw6 sw7'));
    const set = () => holdsAllChance(belief, hand('ro5 su5'));
    const before = { run: run(), set: set() };

    observe(belief, { kind: 'we-draw', card: parseCardId('su6'), from: 'stock' });
    observe(belief, { kind: 'we-discard', card: parseCardId('sw5') });
    observe(belief, { kind: 'they-draw', from: 'stock' });

    const after = { run: run(), set: set() };
    assert.ok(
      after.run < before.run * 0.9,
      `6+7 of swords should cool: ${before.run.toFixed(3)} -> ${after.run.toFixed(3)}`
    );
    assert.ok(
      after.set < before.set * 0.9,
      `two other 5s should cool: ${before.set.toFixed(3)} -> ${after.set.toFixed(3)}`
    );
  });

  it('knows a card that has gone under the pile is out of reach', () => {
    const belief = start('ro1 ro2 su3 su4 sw5 sw6 go7 go8 ro9 su1', 'go5');
    assert.equal(isBuried(belief, parseCardId('go5')), false, 'the top is still live');
    observe(belief, { kind: 'they-draw', from: 'stock' });
    observe(belief, { kind: 'they-discard', card: parseCardId('sw2') });
    assert.equal(isBuried(belief, parseCardId('go5')), true, 'and now it is buried');
    assert.equal(isBuried(belief, parseCardId('sw2')), false);
  });

  it('keeps the hand the right size through a long exchange', () => {
    const belief = start('ro1 ro2 su3 su4 sw5 sw6 go7 go8 ro9 su1', 'sw10');
    const script: Card[] = hand('go2 go3 go4 su5 su6 sw7 sw8 ro4');
    for (const card of script) {
      observe(belief, { kind: 'they-draw', from: 'stock' });
      observe(belief, { kind: 'they-discard', card });
      for (const particle of belief.particles) {
        assert.equal(particle.hand.length, 10, 'a guess is always a whole hand');
        assert.equal(
          new Set(particle.hand.map(cardId)).size,
          10,
          'and never holds the same card twice'
        );
      }
    }
    const total = belief.particles.reduce((sum, p) => sum + p.weight, 0);
    assert.ok(Math.abs(total - 1) < 1e-6, 'weights stay normalised');
  });

  it('values a card by what it actually sheds', () => {
    const held = hand('ro8 ro9 su1 su2 sw4 sw5 go6 go7 ro1 su4');
    // Completing the roots run sheds both court cards: 8 points each.
    assert.ok(takeGain(held, parseCardId('ro10'), belief0().rules) >= 16);
    // A card that fits nothing is worth less than nothing: it is two more
    // points of deadwood to carry.
    assert.equal(takeGain(held, parseCardId('go2'), belief0().rules), -2);
  });
});

function belief0(): Belief {
  return start('ro1 ro2 su3 su4 sw5 sw6 go7 go8 ro9 su1', 'sw10');
}

/**
 * Play a hand, keeping a belief for one seat, and show it each position along
 * with the truth it was not allowed to look at.
 *
 * Reported through a callback rather than collected into a list, which is not
 * a style choice: a belief is mutated in place, so a list of them is a list of
 * references to the same object in its final state, and scoring that against
 * truths from earlier in the hand measures nothing but hindsight.
 */
function watch(
  seed: number,
  seat: Seat,
  foe: PlayerFactory,
  mePlay: PlayerFactory,
  look: (belief: Belief, truth: readonly Card[]) => void,
  particles = 150
): void {
  const next = rng(seed * 31 + 7);
  let state = deal(seed, NAPOLETANE_GIN);
  const belief = newBelief(
    {
      kind: 'deal',
      hand: state.hands[seat],
      upcard: state.discard[state.discard.length - 1],
      stock: state.stock.length,
    },
    next,
    NAPOLETANE_GIN,
    particles
  );
  const them = foe(next);
  const us = mePlay(next);

  for (let i = 0; i < 80 && state.phase !== 'over'; i++) {
    const turn = state.turn;
    const view = viewFor(state, turn);
    const action = turn === seat ? us.act(view, state.history) : them.act(view, state.history);
    const before = state.hands[seat].map(cardId);
    const after = apply(state, turn, action);

    if (turn === seat) {
      if (action.type === 'draw') {
        const card = after.hands[seat].find((c) => !before.includes(cardId(c)));
        if (card) observe(belief, { kind: 'we-draw', card, from: action.from });
      } else if (action.type === 'discard') {
        observe(belief, { kind: 'we-discard', card: action.card });
      } else if (action.type === 'knock') {
        observe(belief, { kind: 'we-discard', card: action.discard });
      }
    } else if (action.type === 'draw') {
      observe(belief, { kind: 'they-draw', from: action.from });
    } else if (action.type === 'discard') {
      observe(belief, { kind: 'they-discard', card: action.card });
    } else if (action.type === 'knock') {
      observe(belief, { kind: 'they-discard', card: action.discard });
    }

    state = after;
    if (!belief.pending && state.phase !== 'over') {
      look(belief, state.hands[seat === 0 ? 1 : 0]);
    }
  }
}

describe('belief: measured against the truth', () => {
  it('never contradicts what the seat can see, over whole games', () => {
    for (let seed = 500; seed < 520; seed++) {
      for (const seat of [0, 1] as Seat[]) {
        watch(seed, seat, magpie(), greedy(), (belief) => {
          const visible = new Set([...belief.mine, ...belief.pile].map(cardId));
          const size = belief.opponentCount - (belief.pending ? 1 : 0);
          for (const particle of belief.particles) {
            const ids = particle.hand.map(cardId);
            assert.equal(new Set(ids).size, ids.length, 'a guess held a card twice');
            assert.equal(ids.length, size, 'a guess was the wrong size');
            for (const id of ids) {
              assert.ok(!visible.has(id), `a guess held ${id}, which is in plain sight`);
            }
          }
        });
      }
    }
  });

  it('beats guessing against a readable opponent', () => {
    // The magpie takes every upcard, so most of its hand is on the record. A
    // filter that cannot beat the prior here is not reading anything at all.
    const scores: number[] = [];
    const priors: number[] = [];
    for (let seed = 700; seed < 716; seed++) {
      watch(seed, 0, magpie(), greedy(), (belief, truth) => {
        const pool = unseen(belief);
        if (pool.length === 0) return;
        priors.push(belief.opponentCount / pool.length);
        const held = truth.map((card) => holdsChance(belief, card));
        scores.push(held.reduce((a, b) => a + b, 0) / held.length);
        // And the sharp half of it: a card we watched them take, and have not
        // watched come back, is not a guess at all.
        for (const card of belief.known) {
          assert.ok(
            holdsChance(belief, card) > 0.95,
            `${cardId(card)} was taken off the pile in plain sight`
          );
          assert.ok(truth.some((c) => cardId(c) === cardId(card)), `${cardId(card)} really is theirs`);
        }
      });
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const got = mean(scores);
    const base = mean(priors);
    assert.ok(
      got > base * 1.15,
      `cards they really hold should score well above the ${base.toFixed(
        2
      )} prior, got ${got.toFixed(2)}`
    );
  });

  it('still beats guessing against an opponent who gives little away', () => {
    // The hoarder draws blind almost always and throws its dearest card. Far
    // less to go on, so the edge should be smaller -- but a filter that only
    // works against an obliging opponent is not worth carrying.
    const scores: number[] = [];
    const priors: number[] = [];
    for (let seed = 900; seed < 920; seed++) {
      watch(seed, 1, hoarder(2), greedy(), (belief, truth) => {
        const pool = unseen(belief);
        if (pool.length === 0) return;
        priors.push(belief.opponentCount / pool.length);
        const held = truth.map((card) => holdsChance(belief, card));
        scores.push(held.reduce((a, b) => a + b, 0) / held.length);
      });
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const got = mean(scores);
    const base = mean(priors);
    assert.ok(
      got > base * 1.05,
      `should still read something: prior ${base.toFixed(2)}, got ${got.toFixed(2)}`
    );
  });
});
