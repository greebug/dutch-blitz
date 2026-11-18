import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rng } from '../cards';
import { greedy, heuristic, playHand } from '../arena';
import { seatedFactory } from './adapter';
import { champion } from './champion';
import { SEED_PARAMS, expert } from './expert';
import { playSeed } from './fast';
import { makePolicy } from './panel';

/**
 * The lab and the real table must be the same game for the same player. Each
 * test plays identical seeds through the fast engine and through the referee
 * (via the adapter) and demands identical results, hand for hand.
 */
describe('adapter: lab players at the real table', () => {
  it('the expert plays the same hands in both engines', () => {
    const sharp = { ...SEED_PARAMS, knockLate: 2, take: 2 };
    for (let seed = 0; seed < 300; seed++) {
      const fast = playSeed(seed, [expert(SEED_PARAMS), expert(sharp)]).margin;
      const slow = playHand(
        seed,
        [seatedFactory(() => expert(SEED_PARAMS)), seatedFactory(() => expert(sharp))],
        rng(1)
      ).margin;
      assert.equal(slow, fast, `seed ${seed}`);
    }
  });

  it('a lab bot matches its arena original card for card', () => {
    // The fast rebuild of the arena's greedy bot, run through the adapter,
    // against the arena's own heuristic: the same games as greedy-vs-heuristic.
    for (let seed = 0; seed < 300; seed++) {
      const original = playHand(seed, [greedy(), heuristic('sharp')], rng(2)).margin;
      const rebuilt = playHand(seed, [seatedFactory(() => makePolicy({ kind: 'greedy' })), heuristic('sharp')], rng(2)).margin;
      assert.equal(rebuilt, original, `seed ${seed}`);
    }
  });

  it('the champion plays the same hands in both engines', () => {
    const options = { worlds: 10, width: 3, particles: 150, rollout: SEED_PARAMS, seed: 5 };
    for (let seed = 0; seed < 25; seed++) {
      const fast = playSeed(seed, [champion(options), expert(SEED_PARAMS)]).margin;
      const slow = playHand(seed, [seatedFactory(() => champion(options)), seatedFactory(() => expert(SEED_PARAMS))], rng(3)).margin;
      assert.equal(slow, fast, `seed ${seed}`);
      const fast2 = playSeed(seed, [expert(SEED_PARAMS), champion(options)]).margin;
      const slow2 = playHand(seed, [seatedFactory(() => expert(SEED_PARAMS)), seatedFactory(() => champion(options))], rng(3)).margin;
      assert.equal(slow2, fast2, `seed ${seed}, second seat`);
    }
  });
});
