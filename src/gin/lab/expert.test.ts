import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseCardId, cardIndex } from '../cards';
import { type ExpertParams, expert } from './expert';
import { type Seen, blankPublic, masksOf } from './fast';
import v4 from './champions/expert-v4.json';

const idx = (ids: string[]) => ids.map((id) => cardIndex(parseCardId(id)));

/** Our seat, holding `hand`, with `upcard` on the pile and a full stock. */
function seat(hand: string[], upcard: string): Seen {
  const pub = blankPublic();
  pub.pile.push(idx([upcard])[0]);
  pub.stockCount = 19;
  const cards = idx(hand);
  return { seat: 0, hand: cards, masks: masksOf(cards), pub };
}

describe('expert: taking the upcard', () => {
  // Nine melded cards and a loose King; the 4 of swords melds with nothing.
  const hand = ['ro1', 'ro2', 'ro3', 'su5', 'sw5', 'go5', 'ro7', 'su7', 'sw7', 'go10'];
  const params = v4.params as ExpertParams;

  it('does not take a useless low card just to shed a high one', () => {
    // Taking it and throwing the King looks like -4 deadwood against standing
    // still. Against a blind draw -- which sheds the King too -- it is nothing.
    assert.equal(expert(params).draw(seat(hand, 'sw4')), false);
  });

  it('the old comparison (blind 0) did take it: the bait the search learned to throw', () => {
    assert.equal(expert({ ...params, blind: 0 }).draw(seat(hand, 'sw4')), true);
  });

  it('still takes a card that makes a meld', () => {
    assert.equal(expert(params).draw(seat(hand, 'go7')), true);
  });
});
