import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Player } from '../arena';
import { type GinAction, type Seat, apply, deal, viewFor } from '../game';
import { seated } from './adapter';
import { analyzeAll } from './analysis';
import { SEED_PARAMS, expert } from './expert';
import { makePolicy } from './panel';
import type { Policy } from './fast';

/** A real hand through the referee, returning its log. */
function record(seed: number, policies: [Policy, Policy]): GinAction[] {
  let state = deal(seed);
  const players: [Player, Player] = [seated(policies[0]), seated(policies[1])];
  const up = state.discard[state.discard.length - 1];
  for (const s of [0, 1] as Seat[]) players[s].begin!(s, state.hands[s], up, state.stock.length);
  while (state.phase !== 'over' && state.history.length < 400) {
    const s = state.turn;
    state = apply(state, s, players[s].act(viewFor(state, s), state.history));
  }
  return state.history;
}

const quick = { rollout: SEED_PARAMS, worlds: 40, check: 60, particles: 200 };

describe('hand analysis', () => {
  it('judges every one of the person’s decisions, and only theirs', () => {
    for (const seed of [3, 11]) {
      const history = record(seed, [expert(SEED_PARAMS), expert(SEED_PARAMS)]);
      for (const seat of [0, 1] as Seat[]) {
        const moments = analyzeAll({ seed, humanSeat: seat, history }, quick);
        const theirs = history.filter((_, i) => Math.floor(i / 2) % 2 === seat).length;
        assert.equal(moments.length, theirs, `seed ${seed} seat ${seat}`);
        for (const m of moments) {
          assert.equal(Math.floor(m.index / 2) % 2, seat);
          assert.ok(Number.isFinite(m.cost));
          if (m.verdict === 'best') assert.equal(m.yours.code, m.best.code);
          assert.equal(m.hand.length, m.kind === 'draw' ? 10 : 11);
        }
      }
    }
  });

  it('flags a careless player, with a cost and the reasons it can see', () => {
    let flagged = 0;
    let reasons = 0;
    // Bigger samples than the other tests: an error must clear 2.5 standard errors.
    for (const seed of [5, 8, 13, 21, 34]) {
      const history = record(seed, [makePolicy({ kind: 'careless' }, seed), expert(SEED_PARAMS)]);
      for (const m of analyzeAll({ seed, humanSeat: 0, history }, { ...quick, worlds: 80, check: 200 })) {
        if (m.verdict === 'inaccuracy' || m.verdict === 'mistake' || m.verdict === 'blunder') {
          flagged++;
          assert.ok(m.cost > 0, 'a flagged move costs something');
          assert.notEqual(m.yours.code, m.best.code);
          if (m.why.length) reasons++;
        }
      }
    }
    assert.ok(flagged >= 3, `expected careless play to be flagged, got ${flagged}`);
    assert.ok(reasons >= 1, 'at least some flagged moves come with reasons');
  });

  it('gives the same verdicts every time it is asked about the same hand', () => {
    // Seeded from the deal, so a review a person rereads does not change under
    // them. (That the champion never peeks is lab.test.ts's job.)
    const seed = 21;
    const history = record(seed, [expert(SEED_PARAMS), expert(SEED_PARAMS)]);
    const a = analyzeAll({ seed, humanSeat: 0, history }, quick);
    const b = analyzeAll({ seed, humanSeat: 0, history }, quick);
    assert.deepEqual(
      a.map((m) => [m.verdict, m.best.code, m.cost]),
      b.map((m) => [m.verdict, m.best.code, m.cost])
    );
  });
});
