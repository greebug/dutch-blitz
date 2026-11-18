import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseCardId, cardIndex } from '../cards';
import { type ExpertParams, dangerOf, expert } from './expert';
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

describe('expert: discard danger with a read of the opponent', () => {
  const params = v4.params as ExpertParams;
  // The live position behind the "dead King" review: they took the King and the
  // 3 of goblets, and almost surely hold the goblet Jack and Horse.
  const hand = ['sw4', 'go7', 'sw5', 'ro2', 'go1', 'go5', 'ro4', 'su2', 'sw1', 'su7', 'sw10'];
  const s = seat(hand, 'ro10');
  for (const id of ['sw8', 'su8', 'ro6', 'su10']) s.pub.pile.unshift(idx([id])[0]);
  s.pub.taken[1][idx(['go10'])[0]] = 1;
  s.pub.taken[1][idx(['go3'])[0]] = 1;
  const scratch = new Uint8Array(40);
  const [go7, sw10, ro4] = idx(['go7', 'sw10', 'ro4']);

  it('without a read, is exactly the public-only rule (a zero read changes nothing)', () => {
    const zero = new Float64Array(40);
    for (let c = 0; c < 40; c++) {
      if (!s.hand.includes(c)) continue;
      assert.equal(dangerOf(s, c, params, scratch, zero), dangerOf(s, c, params, scratch));
    }
  });

  it('sees the 7 of goblets finishing a run it reads them as holding', () => {
    const read = new Float64Array(40);
    for (const id of ['go8', 'go9']) read[idx([id])[0]] = 0.93;
    const plain = dangerOf(s, go7, params, scratch);
    const informed = dangerOf(s, go7, params, scratch, read);
    assert.ok(informed > plain + 1, `informed ${informed} vs plain ${plain}`);
    // And a dead card stays harmless whatever the read says.
    assert.equal(dangerOf(s, sw10, params, scratch, read), 0);
    assert.ok(dangerOf(s, ro4, params, scratch, read) >= dangerOf(s, ro4, params, scratch));
  });
});
