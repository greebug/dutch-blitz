import { type Card, cardFromIndex, cardId, cardIndex, parseCardId } from '../cards';
import { type GinAction, type GinState, type Seat, apply, deal, viewFor } from '../game';
import { seated } from './adapter';
import { type Explanation, champion } from './champion';
import { BIG_GIN, KNOCK } from './fast';
import { saved } from './registry';
import { expert } from './expert';
import { makePolicy } from './panel';

/**
 * Judge a first-turn throw from a position typed in by hand -- for a screenshot
 * of a hand whose log is not to hand.
 *
 *   npx tsx src/gin/lab/position.run.ts "ro2 su2 ..." DRAWN UPCARD YOURTHROW [--seat 0|1] [--their-throw ID] [--seeds n] [--rollout NAME]
 *
 * The eleven cards are your hand after drawing; DRAWN is which of them came
 * off the stock (or "up" if you took the upcard, in which case UPCARD is the
 * card you took). Seat 1 means the opponent opened: they drew blind and threw
 * --their-throw (default: a card you cannot see, chosen at random).
 *
 * Only the first turn can be typed in this way, because only there is
 * the whole public record short enough to state. The opponent's hidden cards
 * and the stock are filled in at random; the champion never looks at them.
 */
const args = process.argv.slice(2);
const flag = (name: string, d: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : d;
};
const [handArg, drawnArg, upArg, throwArg] = args;
const seat = Number(flag('--seat', '0')) as Seat;
const seeds = Number(flag('--seeds', '3'));
const rolloutName = flag('--rollout', 'release');
const theirThrowArg = flag('--their-throw', '');
/** 'human': the opponent in the play-outs takes the upcard only to complete a meld. */
const opponent = flag('--opponent', 'expert');

const mine11 = handArg.trim().split(/\s+/).map(parseCardId);
const took = drawnArg === 'up';
const up = parseCardId(upArg);
const drawn = took ? up : parseCardId(drawnArg);
const yourThrow = parseCardId(throwArg);
const id = (c: Card) => cardId(c);
const say = (c: number) => (c === BIG_GIN ? 'big gin' : c >= KNOCK ? `knock ${id(cardFromIndex(c - KNOCK))}` : `throw ${id(cardFromIndex(c))}`);

function build(s: number): { state: GinState; history: GinAction[]; start: { hand: Card[]; up: Card; stock: number } } {
  const ten = mine11.filter((c) => id(c) !== id(drawn));
  if (ten.length !== 10) throw new Error('the drawn card must be one of the eleven');
  const used = new Set([...mine11, up].map(id));
  const rest = deal(s).hands.flat().concat(deal(s).stock, deal(s).discard).filter((c) => !used.has(id(c)));
  // `rest` is the other 28 (or 29) cards in a seeded random order.
  const theirs = rest.slice(0, 10);
  let stock = rest.slice(10);
  const base = deal(1);
  let state: GinState;
  const history: GinAction[] = [];
  let startUp = up;
  if (seat === 0) {
    if (!took) stock = [drawn, ...stock.filter((c) => id(c) !== id(drawn))];
    state = { ...base, seed: s, hands: [ten, theirs], discard: [up], stock, history: [] };
  } else {
    // They opened: blind draw, then a throw. The upcard you were offered is
    // what they threw; the card under it was the original upcard.
    const theirThrow = theirThrowArg ? parseCardId(theirThrowArg) : up;
    const original = stock[0];
    stock = stock.slice(1);
    const theirDraw = stock[0];
    void theirDraw;
    if (!took) stock = [stock[0], drawn, ...stock.slice(1).filter((c) => id(c) !== id(drawn))];
    const theirHand = id(theirThrow) === id(up) ? [...theirs.slice(0, 9), up] : theirs;
    state = { ...base, seed: s, hands: [theirHand, ten], discard: [original], stock, history: [] };
    startUp = original;
    state = apply(state, 0, { type: 'draw', from: 'stock' });
    history.push({ type: 'draw', from: 'stock' });
    state = apply(state, 0, { type: 'discard', card: theirThrow });
    history.push({ type: 'discard', card: theirThrow });
  }
  return { state, history, start: { hand: ten, up: startUp, stock: state.stock.length + (seat === 1 ? 1 : 0) } };
}

const rollout = saved(rolloutName);
for (let s = 1; s <= seeds; s++) {
  const { state: s0, history, start } = build(1000 + s);
  let state = s0;
  let current: GinAction = { type: 'draw', from: took ? 'discard' : 'stock' };
  let last: Explanation | null = null;
  const policy = champion({
    worlds: 600,
    check: 1500,
    width: 5,
    particles: 8000,
    rollout,
    equity: null,
    confidence: 0,
    seed: 77 + s,
    actual: {
      draw: () => (current.type === 'draw' ? current.from === 'discard' : null),
      throw: () => (current.type === 'draw' ? null : cardIndex((current as { card: Card }).card)),
    },
    consider: () => (current.type === 'draw' ? null : cardIndex((current as { card: Card }).card)),
    explain: (info) => (last = info),
    ...(opponent === 'human'
      ? { rollers: () => [expert(rollout, Math.random, 'me'), makePolicy({ kind: 'human' }, Math.floor(Math.random() * 1e9))] as [ReturnType<typeof expert>, ReturnType<typeof expert>] }
      : {}),
  });
  const player = seated(policy);
  // What the seat saw at the deal.
  const dealt = seat === 0 ? state.hands[0] : start.hand;
  player.begin!(seat, dealt, start.up, seat === 0 ? state.stock.length : start.stock);
  // Replay the opponent's opening, if any, then our draw and throw.
  const full: GinAction[] = [...history];
  full.push(current);
  player.act(viewFor(state, seat), full.slice(0, history.length));
  state = apply(state, seat, current);
  current = { type: 'discard', card: yourThrow };
  last = null;
  player.act(viewFor(state, seat), full);
  const info = last as Explanation | null;
  if (s === 1) console.log(`hand: ${viewFor(state, seat).hand.map(id).join(' ')}  stock ${state.stock.length}  you ${say(cardIndex(yourThrow))}`);
  if (!info) {
    console.log(`seed ${s}: no explanation`);
    continue;
  }
  const order = info.moves.map((m, i) => [m, info.values[i]] as const).sort((a, b) => b[1] - a[1]);
  console.log(`seed ${s}: search ${order.map(([m, v]) => `${say(m)} ${v.toFixed(2)}`).join(', ')}`);
  if (info.check) {
    const [b, y] = info.check.samples;
    const n = Math.min(b.length, y.length);
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const d = b[i] - y[i];
      sum += d;
      sq += d * d;
    }
    const mean = sum / n;
    const se = Math.sqrt((sq / n - mean * mean) / (n - 1));
    const avg = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
    const win = (xs: number[]) => xs.filter((x) => x > 0).length / xs.length;
    console.log(
      `   takes ${info.check.takes?.map((x) => (100 * x).toFixed(0) + '%').join(' / ')}; ends best ${JSON.stringify(info.check.ends?.[0], (k, v) => (typeof v === 'number' ? Math.round(v * 100) : v))} yours ${JSON.stringify(info.check.ends?.[1], (k, v) => (typeof v === 'number' ? Math.round(v * 100) : v))}
` +
      `   check: ${say(info.check.moves[0])} ${avg(b).toFixed(2)} (win ${(100 * win(b)).toFixed(0)}%) vs ${say(info.check.moves[1])} ${avg(y).toFixed(2)} (win ${(100 * win(y)).toFixed(0)}%): ${mean.toFixed(2)} +/- ${se.toFixed(2)}`
    );
  }
}
