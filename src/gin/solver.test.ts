import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cardId, hand, parseCardId, rng } from './cards';
import { careless, greedy, heuristic, magpie, playHand, solverPlayer } from './arena';
import { botConfig, playOut } from './bot';
import { NAPOLETANE_GIN } from './rules';
import { FAST_SOLVE, createSolver, solve } from './solver';
import { record, review } from './review';
import { newBelief } from './belief';
import { type GinAction, type GinState, apply, deal, viewFor } from './game';

const settings = { ...FAST_SOLVE, samples: 30, particles: 200 };

/** A position to reason about, built by hand. */
function position(mine: string, upcard: string, seed = 4) {
  const next = rng(seed);
  const cards = hand(mine);
  const belief = newBelief(
    { kind: 'deal', hand: cards, upcard: parseCardId(upcard), stock: 19 },
    next,
    NAPOLETANE_GIN,
    settings.particles
  );
  const view = {
    seat: 0 as const,
    rules: NAPOLETANE_GIN,
    hand: cards,
    melds: [],
    deadwood: [],
    deadwoodPoints: 0,
    discardTop: parseCardId(upcard),
    discardCount: 1,
    stockCount: 19,
    opponentCardCount: 10,
    turn: 0 as const,
    phase: 'draw' as const,
    yourTurn: true,
    knocker: null,
    score: null,
    opponentHand: null,
  };
  return { belief, view, next };
}

describe('solver: the moves it picks', () => {
  it('takes a card that completes a run over drawing blind', () => {
    const { belief, view, next } = position('ro8 ro9 su1 su2 sw4 sw5 go6 go7 ro1 su4', 'ro10');
    const ranked = solve(belief, view, { ...settings, next });
    assert.equal(ranked[0].action.type, 'draw');
    assert.equal(
      (ranked[0].action as { from: string }).from,
      'discard',
      `should take the King of roots, ranked: ${ranked.map((r) => r.label).join(' > ')}`
    );
  });

  it('leaves a card that does nothing for it', () => {
    const { belief, view, next } = position('ro8 ro9 su1 su2 sw4 sw5 go6 go7 ro1 su4', 'go10');
    const ranked = solve(belief, view, { ...settings, next });
    assert.equal(
      (ranked[0].action as { from?: string }).from,
      'stock',
      `the King of goblets fits nothing, ranked: ${ranked.map((r) => r.label).join(' > ')}`
    );
  });

  it('plays only legal moves, from either seat, against anybody', () => {
    const next = rng(99);
    for (const foe of [greedy(), magpie(), careless(), heuristic('steady')]) {
      for (let seed = 300; seed < 306; seed++) {
        const a = playHand(seed, [solverPlayer(settings), foe], next);
        const b = playHand(seed, [foe, solverPlayer(settings)], next);
        assert.equal(a.fouls, 0, 'solver offered an illegal move in seat 0');
        assert.equal(b.fouls, 0, 'solver offered an illegal move in seat 1');
        assert.ok(a.turns < 400 && b.turns < 400, 'hand did not finish');
      }
    }
  });
});

describe('review: only what was known at the time', () => {
  /**
   * The guarantee the whole reviewer rests on.
   *
   * Reviewing the first six moves of a hand must give exactly the same verdicts
   * as reviewing the whole hand does for those same six moves. If anything
   * later in the hand were leaking backwards -- the cards that turned up, who
   * won -- the two runs would disagree, because the second one knows how it
   * ended and the first cannot.
   */
  it('judges a move the same whether or not the rest of the hand exists', () => {
    const next = rng(7);
    const finished = playOut(deal(8181), [botConfig('steady', next), botConfig('sharp', next)]);
    const full = record(finished);
    assert.ok(full.history.length > 8, 'need a hand long enough to truncate');

    const truncated = { ...full, history: full.history.slice(0, 6) };
    const whole = review(full, 0, { ...settings, next: rng(1234) });
    const part = review(truncated, 0, { ...settings, next: rng(1234) });

    assert.ok(part.length > 0, 'the truncated hand should still have decisions in it');
    for (let i = 0; i < part.length; i++) {
      assert.equal(part[i].at, whole[i].at);
      assert.deepEqual(
        part[i].options.map((o) => o.label),
        whole[i].options.map((o) => o.label),
        `move ${part[i].at} was ranked differently when the rest of the hand was visible`
      );
      assert.ok(
        Math.abs(part[i].cost - whole[i].cost) < 1e-9,
        `move ${part[i].at} was costed differently: ${part[i].cost} vs ${whole[i].cost}`
      );
    }
  });

  it('never claims a card is gone while it is still live', () => {
    const next = rng(11);
    const finished = playOut(deal(555), [botConfig('easy', next), botConfig('steady', next)]);
    const decisions = review(record(finished), 1, { ...settings, next: rng(5) });
    for (const decision of decisions) {
      const gone = [...decision.note.matchAll(/gone for good: ([^;]+)/g)]
        .flatMap((match) => match[1].split(', '))
        .map((piece) => piece.split(' ')[0]);
      for (const id of gone) {
        assert.ok(
          !decision.hand.some((card) => cardId(card) === id),
          `${id} was called gone while it was in the hand`
        );
      }
    }
  });

  it('keeps a belief that matches what the seat has seen', () => {
    const next = rng(3);
    let state = deal(1234);
    const solver = createSolver({ ...settings, next }, NAPOLETANE_GIN);
    solver.begin(state.hands[0], state.discard[state.discard.length - 1], state.stock.length);
    const foe = greedy()(next);

    for (let i = 0; i < 20 && state.phase !== 'over'; i++) {
      const view = viewFor(state, state.turn);
      if (state.turn === 0) {
        const action = solver.act(view, state.history);
        const belief = solver.belief();
        assert.ok(belief);
        const visible = new Set([...view.hand, ...belief.pile].map(cardId));
        for (const particle of belief.particles) {
          for (const card of particle.hand) {
            assert.ok(!visible.has(cardId(card)), `${cardId(card)} is in plain sight`);
          }
        }
        state = apply(state, state.turn, action);
      } else {
        state = apply(state, state.turn, foe.act(view, state.history));
      }
    }
  });
});

