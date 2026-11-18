import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { type Card, cardId, hand, makeDeck, rng, shuffled } from './cards';
import { type Meld, allMelds, extendsMeld, meldsHolding } from './melds';
import { arrangeBy, meldOrderKeys, reconcileOrder, sortHand } from './order';
import { layOff, scoreHand } from './rules';

const ids = (cards: readonly Card[]) => cards.map(cardId);

describe('sortHand', () => {
  it('leads a rank with the suit that continues the rank below', () => {
    // The case that motivates the whole second rule: the 7 of swords belongs
    // next to the 6 of swords, and the 7 of goblets after it.
    assert.deepEqual(ids(sortHand(hand('sw6 go7 sw7'))), ['sw6', 'sw7', 'go7']);
  });

  it('is ascending by rank, courts included', () => {
    const sorted = sortHand(hand('go10 ro1 su8 sw9 ro7'));
    assert.deepEqual(ids(sorted), ['ro1', 'ro7', 'su8', 'sw9', 'go10']);
  });

  it('carries a pairing on through consecutive ranks', () => {
    // ro5-ro6 pair, then su6-su7 pair: the 6s have to be ordered roots-first
    // to serve the rank below and suns-last to serve the rank above.
    assert.deepEqual(ids(sortHand(hand('su7 ro6 su6 ro5'))), ['ro5', 'ro6', 'su6', 'su7']);
  });

  it('never breaks rank order to chase a pairing', () => {
    // Both suits are doubled, so only one pair can be adjacent. Whichever it
    // picks, the ranks stay in order -- a hand that rearranged itself to show
    // off a run would have to be re-learned every turn.
    const sorted = sortHand(hand('sw6 go6 sw7 go7'));
    assert.deepEqual(
      sorted.map((c) => c.rank),
      [6, 6, 7, 7]
    );
  });

  it('frees the front of a rank the rank below cannot pair with', () => {
    // Nothing pairs with the 3 of goblets, so neither 4 is holding the front
    // of its rank for anything -- which leaves the 4 of roots free to move
    // down beside the 5 of roots.
    assert.deepEqual(ids(sortHand(hand('go3 ro4 su4 ro5'))), ['go3', 'su4', 'ro4', 'ro5']);
  });

  it('does not lose, duplicate or invent cards', () => {
    const deck = shuffled(makeDeck(), rng(99));
    for (let size = 0; size <= 11; size++) {
      const cards = deck.slice(0, size);
      const sorted = sortHand(cards);
      assert.equal(sorted.length, size);
      assert.deepEqual(ids(sorted).slice().sort(), ids(cards).slice().sort());
    }
  });

  it('puts the same cards in the same order however they arrive', () => {
    const cards = hand('sw6 go7 sw7 ro1 su8');
    const shuffledOnce = [cards[3], cards[0], cards[4], cards[2], cards[1]];
    assert.deepEqual(ids(sortHand(cards)), ids(sortHand(shuffledOnce)));
  });
});

describe('allMelds', () => {
  it('reports a card that is in a run and a set as being in both', () => {
    // Jack, Horse and King of roots, plus two more Jacks.
    const melds = allMelds(hand('ro8 ro9 ro10 su8 sw8'));
    assert.equal(melds.length, 2);
    assert.equal(meldsHolding(melds, hand('ro8')[0]).length, 2);
    assert.equal(meldsHolding(melds, hand('ro10')[0]).length, 1);
  });

  it('counts a four-card run once, not as three overlapping windows', () => {
    const melds = allMelds(hand('ro1 ro2 ro3 ro4'));
    assert.equal(melds.length, 1);
    assert.equal(melds[0].kind, 'run');
    assert.equal(melds[0].cards.length, 4);
  });

  it('counts four of a rank as one set', () => {
    const melds = allMelds(hand('ro5 su5 sw5 go5'));
    assert.deepEqual(
      melds.map((m) => [m.kind, m.cards.length]),
      [['set', 4]]
    );
  });

  it('finds nothing in a hand that has nothing', () => {
    assert.deepEqual(allMelds(hand('ro1 su3 sw5 go7 ro9')), []);
  });

  it('separates two runs in one suit when there is a gap between them', () => {
    const melds = allMelds(hand('ro1 ro2 ro3 ro5 ro6 ro7'));
    assert.equal(melds.length, 2);
    for (const meld of melds) assert.equal(meld.cards.length, 3);
  });

  it('never puts a card in more than two melds, over 400 random hands', () => {
    // The ceiling the display relies on: a card wears one ring per meld, and
    // the layout has room for two. Maximal runs in a suit cannot overlap and
    // there is one set per rank, so two should be the hard limit -- but it is
    // an emergent property of the enumeration, not something it enforces.
    for (let seed = 0; seed < 400; seed++) {
      const cards = shuffled(makeDeck(), rng(seed)).slice(0, 11);
      const melds = allMelds(cards);
      for (const card of cards) {
        const holding = meldsHolding(melds, card);
        assert.ok(holding.length <= 2, `${cardId(card)} is in ${holding.length} melds`);
      }
      // And everything reported really is a meld.
      for (const meld of melds) {
        assert.ok(meld.cards.length >= 3);
        if (meld.kind === 'set') {
          assert.equal(new Set(meld.cards.map((c) => c.rank)).size, 1);
        } else {
          assert.equal(new Set(meld.cards.map((c) => c.suit)).size, 1);
          const ranks = meld.cards.map((c) => c.rank).sort((a, b) => a - b);
          for (let i = 1; i < ranks.length; i++) assert.equal(ranks[i], ranks[i - 1] + 1);
        }
      }
    }
  });
});

describe('layoff placements', () => {
  const melds: Meld[] = [
    { kind: 'run', cards: hand('ro3 ro4 ro5') },
    { kind: 'set', cards: hand('su9 sw9 go9') },
  ];

  it('records which meld swallowed each card', () => {
    const result = layOff(hand('ro6 ro2 ro9'), melds);
    assert.equal(result.placements.length, 3);
    assert.equal(result.laidOff.length, 3);

    const target = new Map(result.placements.map((p) => [cardId(p.card), p.meldIndex]));
    assert.equal(target.get('ro9'), 1, 'the fourth 9 joins the set');
    assert.equal(target.get('ro6'), 0);
    assert.equal(target.get('ro2'), 0);
  });

  it('records an order that can actually be replayed', () => {
    // ro3 only fits after ro4 has widened the run, so the sequence is load
    // bearing: replayed in the recorded order every card must fit the meld as
    // it stood at that moment. This is exactly what cannot be recovered by
    // looking at the finished melds.
    const run: Meld[] = [{ kind: 'run', cards: hand('ro5 ro6 ro7') }];
    const result = layOff(hand('ro3 ro4'), run);
    assert.equal(result.placements.length, 2);

    const growing: Meld[] = run.map((m) => ({ kind: m.kind, cards: m.cards.slice() }));
    for (const { card, meldIndex } of result.placements) {
      assert.ok(
        extendsMeld(growing[meldIndex], card),
        `${cardId(card)} does not fit meld ${meldIndex} at the point it was laid off`
      );
      growing[meldIndex].cards.push(card);
    }
  });

  it('leaves placements empty when nothing fits', () => {
    const result = layOff(hand('su1'), melds);
    assert.deepEqual(result.placements, []);
    assert.deepEqual(result.laidOff, []);
  });

  it('carries the knocker melds and the placements out through the score', () => {
    // Knocker keeps ro3-ro4-ro5 and su9-sw9-go9 with a single 1 of suns left
    // over; the defender is holding a 9 that fits the set.
    const knocker = hand('ro3 ro4 ro5 su9 sw9 go9 su1 go1 sw1 ro1');
    const defender = hand('ro9 ro10 su10 sw10 go10 su2 su3 su4 go2 go3');
    const score = scoreHand(knocker, defender);

    assert.ok(score.knockerMelds.length >= 2, 'the knocker melds travel with the score');
    for (const { meldIndex } of score.layoffs) {
      assert.ok(
        meldIndex >= 0 && meldIndex < score.knockerMelds.length,
        'every placement points at a real meld'
      );
    }
    assert.equal(
      score.layoffs.length,
      score.laidOff.length,
      'one placement per laid-off card, so the showdown can animate each one'
    );
  });
});

describe('reconcileOrder', () => {
  it('leaves an arrangement alone while the cards are the same', () => {
    const cards = hand('sw6 go7 sw7 ro1');
    const mine = ['sw7', 'ro1', 'go7', 'sw6'];
    assert.deepEqual(reconcileOrder(mine, cards), mine);
  });

  it('files a drawn card behind the card it would have followed', () => {
    // The player has put the 7 of swords first. The 7 of goblets arrives, and
    // by rule it belongs immediately after the 7 of swords -- which is where it
    // goes, rather than on the end of the row.
    const cards = hand('sw6 go7 sw7 ro1');
    assert.deepEqual(reconcileOrder(['sw7', 'sw6', 'ro1'], cards), [
      'sw7',
      'go7',
      'sw6',
      'ro1',
    ]);
  });

  it('puts a card with nothing below it at the front', () => {
    const cards = hand('sw6 sw7 ro1');
    assert.deepEqual(reconcileOrder(['sw7', 'sw6'], cards), ['ro1', 'sw7', 'sw6']);
  });

  it('keeps two arrivals in rule order relative to each other', () => {
    const cards = hand('go10 ro1 ro2');
    assert.deepEqual(reconcileOrder(['go10'], cards), ['ro1', 'ro2', 'go10']);
  });

  it('drops a card that has been thrown', () => {
    const cards = hand('sw7 ro1');
    assert.deepEqual(reconcileOrder(['sw7', 'sw6', 'ro1'], cards), ['sw7', 'ro1']);
  });

  it('falls back to the rule for a hand nobody has arranged', () => {
    const cards = hand('sw6 go7 sw7');
    assert.deepEqual(reconcileOrder([], cards), ids(sortHand(cards)));
  });

  it('always names exactly the cards it was given', () => {
    const next = rng(5150);
    for (let round = 0; round < 200; round++) {
      const deck = shuffled(makeDeck(), next);
      const cards = deck.slice(0, 1 + Math.floor(next() * 11));
      // An arrangement from some earlier hand: a few of these cards, a few
      // cards that have since gone, in no particular order.
      const stale = shuffled(
        [...cards.slice(0, Math.floor(cards.length / 2)), ...deck.slice(20, 24)],
        next
      ).map(cardId);

      const out = reconcileOrder(stale, cards);
      assert.equal(out.length, cards.length);
      assert.equal(new Set(out).size, out.length, 'no duplicates');
      assert.deepEqual([...out].sort(), ids(cards).sort());
      // And the arrangement still reads as the arrangement: the cards it did
      // name, in the order it named them.
      const keptByHand = stale.filter((id) => ids(cards).includes(id));
      assert.deepEqual(out.filter((id) => keptByHand.includes(id)), keptByHand);
    }
  });
});

describe('arrangeBy', () => {
  it('returns the cards in the given order', () => {
    const cards = hand('sw6 go7 sw7');
    assert.deepEqual(ids(arrangeBy(['go7', 'sw6', 'sw7'], cards)), ['go7', 'sw6', 'sw7']);
  });

  it('ignores an id for a card that is not there', () => {
    const cards = hand('sw6 sw7');
    assert.deepEqual(ids(arrangeBy(['sw6', 'ro1', 'sw7'], cards)), ['sw6', 'sw7']);
  });
});

describe('sortHand, with melds in it', () => {
  it('hinges two melds on the card they share', () => {
    // The case that motivates the whole thing: the Fante of goblets ends a run
    // and begins a set, and sits between them so it touches both.
    assert.deepEqual(ids(sortHand(hand('go6 go7 go8 ro8 sw8'))), [
      'go6',
      'go7',
      'go8',
      'ro8',
      'sw8',
    ]);
  });

  it('reads a run downwards when that is the end its neighbour needs', () => {
    // Run 3-4-5 of roots and three 3s, hinged on the 3 of roots. Laid upwards
    // the shared card would end up at the far side of the run from the set.
    assert.deepEqual(ids(sortHand(hand('ro3 ro4 ro5 su3 go3'))), [
      'ro5',
      'ro4',
      'ro3',
      'su3',
      'go3',
    ]);
  });

  it('puts what you have built before what you are still holding', () => {
    // The run is high and the loose cards are low, so rank order alone would
    // bury the run in the middle of the hand.
    assert.deepEqual(ids(sortHand(hand('sw8 sw9 sw10 ro1 go4'))), [
      'sw8',
      'sw9',
      'sw10',
      'ro1',
      'go4',
    ]);
  });

  it('lays the melds out newest first, so finishing one leaves the rest alone', () => {
    // Three Kings were there first, then the run came together. The run goes
    // on the left, the Kings keep the place they had next to the deadwood,
    // and reading the melds right to left gives the order they were finished.
    const cards = hand('ro10 su10 sw10 go5 go6 go7 ro1');
    const history = ['set:10', 'run:go:0'];
    assert.deepEqual(ids(sortHand(cards, history)), [
      'go5',
      'go6',
      'go7',
      'ro10',
      'su10',
      'sw10',
      'ro1',
    ]);
    // And the other way round, with the same cards.
    assert.deepEqual(ids(sortHand(cards, ['run:go:0', 'set:10'])).slice(0, 3), [
      'ro10',
      'su10',
      'sw10',
    ]);
  });

  it('names a meld in a way that survives it growing', () => {
    const three = meldOrderKeys(hand('go5 go6 go7 ro1'));
    const four = meldOrderKeys(hand('go5 go6 go7 go8 ro1'));
    assert.deepEqual(three, ['run:go:0']);
    assert.deepEqual(four, three, 'a fourth card does not make it a different run');
    assert.deepEqual(meldOrderKeys(hand('ro4 su4 sw4 go4')), ['set:4']);
  });

  it('keeps separate melds separate, lowest first', () => {
    const out = ids(sortHand(hand('ro1 su1 sw1 go5 go6 go7')));
    assert.deepEqual(out, ['ro1', 'su1', 'sw1', 'go5', 'go6', 'go7']);
  });

  it('still orders the deadwood by rank, pairing suits where it can', () => {
    const out = ids(sortHand(hand('ro2 su2 sw2 sw6 go7 sw7')));
    assert.deepEqual(out.slice(0, 3), ['ro2', 'su2', 'sw2']);
    assert.deepEqual(out.slice(3), ['sw6', 'sw7', 'go7']);
  });

  it('gathers every melded card ahead of every loose one', () => {
    const next = rng(4242);
    for (let round = 0; round < 300; round++) {
      const cards = shuffled(makeDeck(), next).slice(0, 10);
      const out = sortHand(cards);
      assert.deepEqual(ids(out).sort(), ids(cards).sort(), 'same cards');

      const melded = new Set<string>();
      for (const meld of allMelds(cards)) for (const c of meld.cards) melded.add(cardId(c));
      const marks = ids(out).map((id) => melded.has(id));
      const lastMelded = marks.lastIndexOf(true);
      const firstLoose = marks.indexOf(false);
      if (lastMelded >= 0 && firstLoose >= 0) {
        assert.ok(lastMelded < firstLoose, 'a loose card got in among the melds');
      }
    }
  });

  it('keeps each meld in one unbroken stretch', () => {
    const next = rng(777);
    for (let round = 0; round < 300; round++) {
      const cards = shuffled(makeDeck(), next).slice(0, 10);
      const out = ids(sortHand(cards));
      for (const meld of allMelds(cards)) {
        const at = meld.cards.map((c) => out.indexOf(cardId(c))).sort((a, b) => a - b);
        const unbroken = at[at.length - 1] - at[0] === at.length - 1;
        // A meld can only be split when a card of it is hinging two OTHER
        // melds elsewhere in the hand, which takes three melds through one
        // card. Anything else is a bug.
        if (!unbroken) {
          const crowded = meld.cards.some(
            (c) => allMelds(cards).filter((m) => m.cards.some((o) => cardId(o) === cardId(c))).length > 1
          );
          assert.ok(crowded, 'meld split for no reason: ' + out.join(' '));
        }
      }
    }
  });
});
