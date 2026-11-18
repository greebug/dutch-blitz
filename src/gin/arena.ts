import { type Card, cardId, cardPoints, rng } from './cards';
import { type BotConfig, botConfig, chooseFrom } from './bot';
import { analyzeHand } from './melds';
import { type GinRules, NAPOLETANE_GIN, isBigGin, knockOptions } from './rules';
import { FAST_SOLVE, type SolveOptions, createSolver, margin } from './solver';
import {
  type GinAction,
  type GinState,
  type GinView,
  type Seat,
  apply,
  canApply,
  deal,
  legalActions,
  viewFor,
} from './game';

/**
 * Strategies playing each other, so that claims about them can be checked.
 *
 * The reason this file exists at all: a card player that looks clever is not
 * evidence of anything, and a card player that beats one opponent is barely
 * more. The test that matters for something claiming to play well is that it
 * beats everything -- a cautious opponent, a reckless one, a greedy one, a
 * bad one -- because a strategy that cleans up against one style and loses to
 * another has found a hole in that style rather than a way to play the game.
 *
 * Every strategy here answers the same question from the same place: a
 * redacted `GinView` plus the public action log. None of them can see the
 * stock or the other hand, whatever they might want to. That is enforced by
 * the shape of `Player` rather than by good intentions.
 *
 * Deal luck is removed by mirroring. Every pairing is played twice from the
 * same seed with the seats swapped, so both strategies play both hands of the
 * same deal, and the shuffle cancels out of the difference.
 */

export interface Player {
  name: string;
  /** The opening position, which both players watched happen. */
  begin?(seat: Seat, hand: readonly Card[], upcard: Card, stock: number): void;
  act(view: GinView, history: readonly GinAction[]): GinAction;
}

export type PlayerFactory = (next: () => number) => Player;

export interface HandResult {
  /** Points to seat 0, negative if seat 1 took them. */
  margin: number;
  outcome: string;
  turns: number;
  /** Moves a strategy offered that were not legal. Should always be zero. */
  fouls: number;
}

/**
 * Play one hand to the end.
 *
 * An illegal move is replaced by a legal one and counted rather than thrown,
 * so that one broken strategy cannot take a whole tournament down with it --
 * but the count is reported, because a strategy producing illegal moves is
 * broken and the results above it are worthless.
 */
export function playHand(
  seed: number,
  makers: [PlayerFactory, PlayerFactory],
  next: () => number,
  rules: GinRules = NAPOLETANE_GIN
): HandResult {
  let state = deal(seed, rules);
  const players: [Player, Player] = [makers[0](next), makers[1](next)];
  const upcard = state.discard[state.discard.length - 1];
  for (const seat of [0, 1] as Seat[]) {
    players[seat].begin?.(seat, state.hands[seat], upcard, state.stock.length);
  }

  let fouls = 0;
  let turns = 0;
  while (state.phase !== 'over' && turns < 400) {
    const seat = state.turn;
    let action = players[seat].act(viewFor(state, seat), state.history);
    if (canApply(state, seat, action) !== null) {
      fouls++;
      action = legalActions(state, seat)[0];
    }
    state = apply(state, seat, action);
    turns++;
  }

  return {
    margin: margin(state, 0),
    outcome: state.score?.outcome ?? 'unfinished',
    turns,
    fouls,
  };
}

// --- The panel --------------------------------------------------------------

/** The existing heuristic, at each of its three settings. */
export function heuristic(level: 'easy' | 'steady' | 'sharp'): PlayerFactory {
  return (next) => {
    const config = botConfig(level, next);
    return {
      name: `heuristic-${level}`,
      act: (view) => fromConfig(view, config),
    };
  };
}

/**
 * Takes anything that melds, throws its dearest loose card, knocks the moment
 * it legally can. The obvious way to play, and a surprisingly hard baseline.
 */
export function greedy(): PlayerFactory {
  return () => ({
    name: 'greedy',
    act(view) {
      if (view.phase === 'draw') return takeIfItMelds(view);
      if (isBigGin(view.hand, view.rules)) return { type: 'big-gin' };
      const options = knockOptions(view.hand, view.rules);
      const legal = options.find((o) => o.legal);
      if (legal) return { type: 'knock', discard: legal.discard };
      return { type: 'discard', card: options[0].discard };
    },
  });
}

/**
 * Never knocks small: holds out for gin or something close to it.
 *
 * Worth having in the panel because it is wrong in an interesting direction.
 * It converts a lot of small wins into undercuts, and a strategy that only
 * beats players who knock early has not learned much.
 */
export function hoarder(threshold = 2): PlayerFactory {
  return () => ({
    name: `hoarder-${threshold}`,
    act(view) {
      if (view.phase === 'draw') return takeIfItMelds(view);
      if (isBigGin(view.hand, view.rules)) return { type: 'big-gin' };
      const options = knockOptions(view.hand, view.rules);
      const best = options[0];
      if (best.legal && best.deadwoodPoints <= threshold) {
        return { type: 'knock', discard: best.discard };
      }
      return { type: 'discard', card: best.discard };
    },
  });
}

/**
 * Takes the upcard every single time, melding or not.
 *
 * The opposite error from the hoarder, and the most readable opponent there
 * is: every card it holds that did not come off the stock is one you watched
 * it take. A player that reads the discard pile should take it apart, which
 * is exactly what the panel is for -- if the solver cannot beat this, nothing
 * it does with the public record is working.
 */
export function magpie(): PlayerFactory {
  return () => ({
    name: 'magpie',
    act(view) {
      if (view.phase === 'draw') {
        if (!view.discardTop) return { type: 'draw', from: 'stock' };
        return { type: 'draw', from: 'discard' };
      }
      if (isBigGin(view.hand, view.rules)) return { type: 'big-gin' };
      const options = knockOptions(view.hand, view.rules);
      const legal = options.find((o) => o.legal);
      if (legal) return { type: 'knock', discard: legal.discard };
      return { type: 'discard', card: options[0].discard };
    },
  });
}

/** Throws at random from its deadwood. The floor any strategy must clear. */
export function careless(): PlayerFactory {
  return (next) => ({
    name: 'careless',
    act(view) {
      if (view.phase === 'draw') {
        if (view.stockCount === 0) return { type: 'draw', from: 'discard' };
        return next() < 0.3 && view.discardTop
          ? { type: 'draw', from: 'discard' }
          : { type: 'draw', from: 'stock' };
      }
      if (isBigGin(view.hand, view.rules)) return { type: 'big-gin' };
      const options = knockOptions(view.hand, view.rules);
      const legal = options.find((o) => o.legal);
      if (legal) return { type: 'knock', discard: legal.discard };
      const loose = analyzeHand(view.hand).deadwood;
      const pool = loose.length > 0 ? loose : view.hand;
      return { type: 'discard', card: pool[Math.floor(next() * pool.length)] };
    },
  });
}

/** The belief-and-rollout player from `solver.ts`. */
export function solverPlayer(
  settings: Omit<SolveOptions, 'next'> = FAST_SOLVE,
  label = 'solver'
): PlayerFactory {
  return (next) => {
    const solver = createSolver({ ...settings, next }, NAPOLETANE_GIN);
    return {
      name: label,
      begin: (_seat, hand, upcard, stock) => solver.begin(hand, upcard, stock),
      act: (view, history) => solver.act(view, history),
    };
  };
}

function fromConfig(view: GinView, config: BotConfig): GinAction {
  return chooseFrom(view.hand, view.discardTop, view.stockCount, view.phase, view.rules, config);
}

function takeIfItMelds(view: GinView): GinAction {
  if (!view.discardTop) return { type: 'draw', from: 'stock' };
  if (view.stockCount === 0) return { type: 'draw', from: 'discard' };
  const melds =
    analyzeHand([...view.hand, view.discardTop]).deadwoodPoints <
    analyzeHand(view.hand).deadwoodPoints;
  return melds ? { type: 'draw', from: 'discard' } : { type: 'draw', from: 'stock' };
}

// --- Measurement ------------------------------------------------------------

export interface Duel {
  a: string;
  b: string;
  hands: number;
  /** Points per hand to A, averaged over both seats. Positive means A is ahead. */
  edge: number;
  /** The spread of that average, so a small edge can be told from no edge. */
  error: number;
  aWins: number;
  bWins: number;
  pushes: number;
  fouls: number;
}

/**
 * Play one pairing, mirrored.
 *
 * Each deal is played twice with the seats swapped, and A's two margins are
 * added. A deal that simply hands one seat a made hand contributes to both
 * strategies equally and drops out of the difference, which is worth roughly
 * an order of magnitude in samples.
 */
export function duel(
  a: PlayerFactory,
  b: PlayerFactory,
  hands: number,
  seed = 1,
  rules: GinRules = NAPOLETANE_GIN
): Duel {
  const next = rng(seed);
  const names: [string, string] = [a(next).name, b(next).name];
  const margins: number[] = [];
  let aWins = 0;
  let bWins = 0;
  let pushes = 0;
  let fouls = 0;

  for (let i = 0; i < hands; i++) {
    const dealSeed = seed * 7919 + i;
    const first = playHand(dealSeed, [a, b], next, rules);
    const second = playHand(dealSeed, [b, a], next, rules);
    // A sat in seat 0 for the first and seat 1 for the second.
    const forA = first.margin - second.margin;
    margins.push(forA / 2);
    fouls += first.fouls + second.fouls;
    for (const hand of [first.margin, -second.margin]) {
      if (hand > 0) aWins++;
      else if (hand < 0) bWins++;
      else pushes++;
    }
  }

  const mean = margins.reduce((sum, m) => sum + m, 0) / Math.max(1, margins.length);
  const variance =
    margins.reduce((sum, m) => sum + (m - mean) * (m - mean), 0) / Math.max(1, margins.length - 1);
  return {
    a: names[0],
    b: names[1],
    hands,
    edge: mean,
    error: Math.sqrt(variance / Math.max(1, margins.length)),
    aWins,
    bWins,
    pushes,
    fouls,
  };
}

export interface Standing {
  name: string;
  /** Mean points per hand across every opponent. */
  edge: number;
  /** The worst single pairing -- the number that matters for robustness. */
  worst: number;
  worstAgainst: string;
}

/**
 * Everyone against everyone, and the line that actually decides it.
 *
 * `edge` is the headline, but `worst` is the test: a strategy with a fat
 * average and one losing pairing has found a weakness in one opponent rather
 * than a way to play, and a strategy that loses to nobody is the one worth
 * believing in.
 */
export function roundRobin(
  entrants: readonly { name: string; make: PlayerFactory }[],
  hands: number,
  seed = 1,
  onDuel?: (result: Duel) => void
): { duels: Duel[]; table: Standing[] } {
  const duels: Duel[] = [];
  const totals = new Map<string, number[]>();
  const worst = new Map<string, { edge: number; against: string }>();

  for (let i = 0; i < entrants.length; i++) {
    for (let k = i + 1; k < entrants.length; k++) {
      const result = duel(entrants[i].make, entrants[k].make, hands, seed + i * 31 + k);
      result.a = entrants[i].name;
      result.b = entrants[k].name;
      duels.push(result);
      onDuel?.(result);
      note(totals, worst, entrants[i].name, result.edge, entrants[k].name);
      note(totals, worst, entrants[k].name, -result.edge, entrants[i].name);
    }
  }

  const table: Standing[] = entrants.map((entrant) => {
    const scores = totals.get(entrant.name) ?? [];
    const low = worst.get(entrant.name) ?? { edge: 0, against: '-' };
    return {
      name: entrant.name,
      edge: scores.reduce((sum, s) => sum + s, 0) / Math.max(1, scores.length),
      worst: low.edge,
      worstAgainst: low.against,
    };
  });
  table.sort((x, y) => y.edge - x.edge);
  return { duels, table };
}

function note(
  totals: Map<string, number[]>,
  worst: Map<string, { edge: number; against: string }>,
  name: string,
  edge: number,
  against: string
): void {
  const list = totals.get(name) ?? [];
  list.push(edge);
  totals.set(name, list);
  const low = worst.get(name);
  if (!low || edge < low.edge) worst.set(name, { edge, against });
}

/** Pretty enough for a terminal, which is where tournaments get read. */
export function formatTable(table: readonly Standing[]): string {
  const width = Math.max(...table.map((row) => row.name.length), 8);
  const lines = [
    `${'strategy'.padEnd(width)}  ${'edge/hand'.padStart(10)}  ${'worst'.padStart(8)}  against`,
    `${'-'.repeat(width)}  ${'-'.repeat(10)}  ${'-'.repeat(8)}  -------`,
  ];
  for (const row of table) {
    lines.push(
      `${row.name.padEnd(width)}  ${row.edge.toFixed(2).padStart(10)}  ${row.worst
        .toFixed(2)
        .padStart(8)}  ${row.worstAgainst}`
    );
  }
  return lines.join('\n');
}

/** Unused by the arena itself; handy when poking at a strategy by hand. */
export function handSummary(state: GinState): string {
  return `${state.score?.outcome ?? 'live'} ${state.hands
    .map((h) => h.map(cardId).join(' '))
    .join(' | ')} (${state.hands.map((h) => cardPoints(h[0] ?? { rank: 1, suit: 'ro' })).join()})`;
}
