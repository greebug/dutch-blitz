import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cardFromIndex, cardIndex, rng } from '../cards';
import { analyzeHand } from '../melds';
import { greedy, playHand } from '../arena';
import {
  BIG_GIN,
  KNOCK,
  type Policy,
  bestThrow,
  deadwoodOf,
  deadwoodWith,
  masksOf,
  playSeed,
} from './fast';

function randomHand(next: () => number, size: number): number[] {
  const deck = Array.from({ length: 40 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.slice(0, size);
}

/** The arena's greedy player, rebuilt card for card in the fast engine. */
const fastGreedy: Policy = {
  name: 'greedy',
  draw: (seen) => {
    const top = seen.pub.pile[seen.pub.pile.length - 1];
    return deadwoodWith(seen.masks, top) < deadwoodOf(seen.masks);
  },
  throw: (seen) => {
    if (deadwoodOf(seen.masks) === 0) return BIG_GIN;
    const best = bestThrow(seen.hand, seen.masks);
    return best.left <= seen.pub.rules.knockMaxDeadwood ? KNOCK + best.card : best.card;
  },
};

describe('fast engine', () => {
  it('agrees with analyzeHand on deadwood, exactly', () => {
    const next = rng(42);
    for (let i = 0; i < 40000; i++) {
      const cards = randomHand(next, i % 3 === 0 ? 11 : 10);
      const fast = deadwoodOf(masksOf(cards));
      const slow = analyzeHand(cards.map(cardFromIndex)).deadwoodPoints;
      assert.equal(fast, slow, `hand ${cards.join(',')}`);
    }
  });

  it('agrees on hands built to stress sets against runs', () => {
    // Every rank fully present in two suits plus pieces of others: the shapes
    // where a set and a run fight over a card.
    const next = rng(7);
    for (let i = 0; i < 20000; i++) {
      const rank = Math.floor(next() * 8);
      const base = [0, 1, 2, 3].map((s) => s * 10 + rank);
      const extra = randomHand(next, 40).filter((c) => !base.includes(c));
      const cards = [...base, ...extra.filter((c) => Math.abs((c % 10) - rank) <= 2).slice(0, 7)];
      const fast = deadwoodOf(masksOf(cards));
      const slow = analyzeHand(cards.map(cardFromIndex)).deadwoodPoints;
      assert.equal(fast, slow, `hand ${cards.join(',')}`);
    }
  });

  it('plays the same hands as the referee, seed for seed', () => {
    const next = rng(1);
    for (let seed = 0; seed < 1500; seed++) {
      const slow = playHand(seed, [greedy(), greedy()], next);
      const fast = playSeed(seed, [fastGreedy, fastGreedy]);
      assert.equal(fast.margin, slow.margin, `seed ${seed}`);
      assert.equal(fast.outcome, slow.outcome, `seed ${seed}`);
    }
  });

  it('uses the same card numbering as cards.ts', () => {
    for (let i = 0; i < 40; i++) assert.equal(cardIndex(cardFromIndex(i)), i);
  });
});
