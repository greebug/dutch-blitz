import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cardIndex, hand, rng } from '../cards';
import { champion } from './champion';
import { buildEquity, equityAt } from './equity';
import { SEED_PARAMS, expert } from './expert';
import { type Policy, deal, drawStep, holds, play, playSeed, tableFrom, throwStep } from './fast';
import {
  createInference,
  holdsChanceOf,
  theyDraw,
  theyThrow,
  unseenCards,
  weDraw,
  weThrow,
} from './inference';
import { playMatch } from './match';
import { PANEL, makePolicy } from './panel';

const small = { worlds: 12, width: 3, particles: 200, rollout: SEED_PARAMS };

describe('lab: inference', () => {
  /**
   * Play real hands, feed seat 0's filter exactly what seat 0 sees, and check
   * every guess against the truth at every step: never a card we can see,
   * always the cards we watched them take, always ten cards.
   */
  it('keeps every guess consistent with what the seat can see', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const t = deal(seed);
      const a = expert(SEED_PARAMS);
      const b = expert(SEED_PARAMS);
      const inf = createInference(t.seen[0].hand, t.pub.pile[0], t.pub.stockCount, rng(seed), 150);
      for (let turn = 0; turn < 40 && !t.over; turn++) {
        const seat = t.pub.turn;
        const p = seat === 0 ? a : b;
        const top = t.pub.pile[t.pub.pile.length - 1];
        const take = p.draw(t.seen[seat]);
        const got = drawStep(t, take);
        if (seat === 0) weDraw(inf, got, take);
        else theyDraw(inf, take);
        const move = p.throw(t.seen[seat]);
        throwStep(t, move);
        if (t.over) break;
        if (seat === 0) weThrow(inf, move);
        else theyThrow(inf, move);
        void top;
        if (seat === 1) {
          // Our decision point: check the cloud.
          const visible = new Uint8Array(40);
          for (const c of t.seen[0].hand) visible[c] = 1;
          for (const c of t.pub.pile) visible[c] = 1;
          for (let p2 = 0; p2 < inf.count; p2++) {
            let n = 0;
            for (let c = 0; c < 40; c++) {
              const inIt = ((inf.masks[p2 * 4 + ((c / 10) | 0)] >> c % 10) & 1) === 1;
              if (!inIt) continue;
              n++;
              assert.ok(!visible[c], `guess holds ${c}, which is in plain sight`);
            }
            for (let c = 0; c < 40; c++) {
              if (t.pub.taken[1][c]) {
                assert.ok(((inf.masks[p2 * 4 + ((c / 10) | 0)] >> c % 10) & 1) === 1, `lost a known card ${c}`);
              }
            }
            assert.equal(n, 10, 'a guess with the wrong number of cards');
          }
          assert.equal(unseenCards(inf).length, 10 + t.pub.stockCount);
        }
      }
    }
  });

  it('believes in the cards they really hold more than in the ones they do not', () => {
    let held = 0;
    let heldN = 0;
    let not = 0;
    let notN = 0;
    for (let seed = 100; seed < 160; seed++) {
      const t = deal(seed);
      const a = expert(SEED_PARAMS);
      const b = expert(SEED_PARAMS);
      const inf = createInference(t.seen[0].hand, t.pub.pile[0], t.pub.stockCount, rng(seed), 300);
      for (let turn = 0; turn < 16 && !t.over; turn++) {
        const seat = t.pub.turn;
        const p = seat === 0 ? a : b;
        const take = p.draw(t.seen[seat]);
        const got = drawStep(t, take);
        if (seat === 0) weDraw(inf, got, take);
        else theyDraw(inf, take);
        const move = p.throw(t.seen[seat]);
        throwStep(t, move);
        if (t.over) break;
        if (seat === 0) weThrow(inf, move);
        else theyThrow(inf, move);
      }
      if (t.over) continue;
      for (const c of unseenCards(inf)) {
        if (t.pub.taken[1][c]) continue; // known for certain; not a test of inference
        const pr = holdsChanceOf(inf, c);
        if (holds(t.seen[1].masks, c)) {
          held += pr;
          heldN++;
        } else {
          not += pr;
          notN++;
        }
      }
    }
    const inHand = held / heldN;
    const elsewhere = not / notN;
    assert.ok(inHand > elsewhere * 1.08, `held ${inHand.toFixed(3)} vs not ${elsewhere.toFixed(3)}`);
  });
});

describe('lab: the champion', () => {
  it('only ever makes legal moves, from either seat, against the whole panel', () => {
    for (const spec of PANEL.slice(0, 6)) {
      for (let seed = 0; seed < 4; seed++) {
        const c = champion({ ...small, seed });
        const foe = makePolicy(spec, seed);
        playSeed(seed * 31 + 1, [c, foe]);
        playSeed(seed * 31 + 1, [foe, c]);
      }
    }
  });

  /**
   * The no-peeking guarantee. Two deals where seat 0 holds the same ten cards
   * and sees the same upcard, but the opponent's hand and the stock are
   * completely different. Everything seat 0 decides before the first hidden
   * card reaches it must be identical, or the hidden cards are leaking in.
   */
  it('decides the same way when only the hidden cards differ', () => {
    for (let seed = 0; seed < 6; seed++) {
      const base = deal(seed);
      const mine = base.seen[0].hand.slice();
      const up = base.pub.pile[0];
      const rest = Array.from({ length: 40 }, (_, i) => i).filter((c) => c !== up && !mine.includes(c));
      const shuffle = (xs: number[], s: number) => {
        const r = rng(s);
        const out = xs.slice();
        for (let i = out.length - 1; i > 0; i--) {
          const j = Math.floor(r() * (i + 1));
          [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
      };
      const decisions: string[] = [];
      for (const variant of [1, 2]) {
        const r = shuffle(rest, seed * 10 + variant);
        const t = tableFrom(mine, r.slice(0, 10), up, r.slice(10));
        const c = champion({ ...small, seed: 77 });
        c.begin!(t.seen[0]);
        const take = c.draw(t.seen[0]);
        // Only compare the throw when the draw could not reveal anything new.
        decisions.push(String(take));
        if (take) {
          drawStep(t, true);
          decisions.push(String(c.throw(t.seen[0])));
        }
      }
      assert.equal(decisions.length % 2, 0);
      const half = decisions.length / 2;
      assert.deepEqual(decisions.slice(0, half), decisions.slice(half), `seed ${seed}`);
    }
  });
});

describe('lab: matches and equity', () => {
  it('plays matches to the target and names a winner', () => {
    const a: Policy = makePolicy({ kind: 'greedy' });
    const b: Policy = makePolicy({ kind: 'hoarder', threshold: 2 });
    for (let m = 0; m < 50; m++) {
      const r = playMatch([a, b], m);
      assert.ok(Math.max(...r.scores) >= 100);
      assert.equal(r.winner, r.scores[0] >= 100 ? 0 : 1);
    }
  });

  it('builds an equity table that is sane at the edges and symmetric in the middle', () => {
    const margins = new Map<number, number>([
      [0, 0.1],
      [10, 0.3],
      [25, 0.15],
      [-12, 0.35],
      [-30, 0.1],
    ]);
    const e = buildEquity(margins);
    const open = equityAt(e, 0, 0, true);
    const reply = equityAt(e, 0, 0, false);
    // The player who opens the next hand at 0-0 and the one who does not are
    // the two halves of the same match.
    assert.ok(Math.abs(open + reply - 1) < 1e-9, `${open} + ${reply}`);
    assert.ok(equityAt(e, 95, 0, false) > 0.9);
    assert.ok(equityAt(e, 0, 95, true) < 0.1);
    assert.ok(equityAt(e, 50, 40, true) > equityAt(e, 40, 50, true));
  });
});

void play;

describe('lab: the human model', () => {
  const ids = (s: string) => hand(s).map(cardIndex);
  const seat = (mine: string, upcard: string, theirPickups = '') => {
    const t = tableFrom(ids(mine), ids('su1 su2 su3 su4 su5 su6 su7 su8 su9 su10').filter((c) => !ids(mine).includes(c)).slice(0, 10), cardIndex(hand(upcard)[0]), []);
    for (const c of theirPickups ? ids(theirPickups) : []) t.pub.taken[1][c] = 1;
    return t;
  };

  it('takes an upcard that completes a set from loose cards', () => {
    const t = seat('ro5 sw5 go1 go2 ro8 sw9 go10 ro1 sw3 ro3', 'go5');
    assert.equal(makePolicy({ kind: 'human' }).draw(t.seen[0]), true);
  });

  it('leaves an upcard that would poach from a meld it already has', () => {
    // The 5s of roots and swords are each already in a run; a third 5 would
    // have to break one up.
    const t = seat('ro4 ro5 ro6 sw4 sw5 sw6 go1 ro8 go10 sw9', 'go5');
    assert.equal(makePolicy({ kind: 'human' }).draw(t.seen[0]), false);
  });

  it('never throws a card out of a meld, even when it slips', () => {
    const p = makePolicy({ kind: 'human', slip: 1 }, 3);
    for (let i = 0; i < 200; i++) {
      const t = seat('ro4 ro5 ro6 sw7 go7 ro7 go1 sw9 go10 su10', 'go3');
      drawStep(t, false);
      const move = p.throw(t.seen[0]);
      assert.ok(![ids('ro4')[0], ids('ro5')[0], ids('ro6')[0], ids('sw7')[0], ids('go7')[0], ids('ro7')[0]].includes(move % 100), `threw ${move}`);
    }
  });

  it('will not throw next to your pickup unless holding it is expensive', () => {
    // Loose: go10 (8) and sw9 (8) tie; they took the sw10, so sw9 is the
    // nervous throw and the King of goblets goes instead.
    const t = seat('ro1 ro2 ro3 go4 go5 go6 su1 su2 sw9 go10', 'go9', 'sw10');
    drawStep(t, false);
    const move = makePolicy({ kind: 'human', slip: 0 }).throw(t.seen[0]);
    assert.notEqual(move, ids('sw9')[0]);
  });
});
