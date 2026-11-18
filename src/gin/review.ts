import { type Card, cardId } from './cards';
import { type Belief, type Out, outs, wantChance } from './belief';
import { type GinRules, NAPOLETANE_GIN } from './rules';
import { type Scored, type SolveOptions, createSolver, describeAction } from './solver';
import { type GinAction, type GinState, type Seat, apply, deal, viewFor } from './game';

/**
 * Going back over a hand afterwards.
 *
 * The rule that makes this worth anything, and the easy one to get wrong: at
 * every decision, the analysis may use only what that player knew at that
 * moment. It is trivial to write a reviewer that quietly peeks at the finished
 * hand and then tells you the 5 of goblets was coming, and such a reviewer is
 * worse than none -- it teaches a lesson that cannot be acted on, and it makes
 * correct play look like a blunder whenever the cards did not cooperate.
 *
 * So the hand is replayed from the start and the solver is fed the same
 * redacted view the player had, one move at a time. Its belief grows exactly
 * as theirs could have: the discards it watched, the upcards taken, the
 * upcards passed over. What it knows at move twelve is what was knowable at
 * move twelve.
 *
 * A hand is replayable from its seed and its action log alone, which is what
 * makes this cheap enough to run over a whole session later.
 */

export interface Decision {
  /** Where in the hand, counting every draw and throw. */
  at: number;
  seat: Seat;
  phase: 'draw' | 'discard';
  hand: Card[];
  played: GinAction;
  /** What the solver would have done, best first. */
  options: Scored[];
  /** Points given up by the move played, against the best one found. */
  cost: number;
  /** The position in words, from what was knowable at the time. */
  note: string;
}

export interface HandRecord {
  seed: number;
  rules?: GinRules;
  history: readonly GinAction[];
}

/** A finished hand, ready to be reviewed. */
export function record(state: GinState): HandRecord {
  return { seed: state.seed, rules: state.rules, history: state.history.slice() };
}

export function review(
  hand: HandRecord,
  seat: Seat,
  options: SolveOptions,
  /** Skip the obvious: only report moves that cost at least this much. */
  threshold = 0
): Decision[] {
  const rules = hand.rules ?? NAPOLETANE_GIN;
  let state = deal(hand.seed, rules);
  const solver = createSolver(options, rules);
  solver.begin(state.hands[seat], state.discard[state.discard.length - 1], state.stock.length);

  const found: Decision[] = [];
  for (let at = 0; at < hand.history.length && state.phase !== 'over'; at++) {
    const action = hand.history[at];
    if (state.turn === seat) {
      const view = viewFor(state, seat);
      const ranked = solver.rank(view, state.history);
      const belief = solver.belief();
      const best = ranked[0];
      const played = ranked.find((r) => sameAction(r.action, action));
      // A move the solver did not even shortlist is not scored against a
      // number it never computed. It is reported as unrated rather than
      // guessed at, which is the honest thing to do with it.
      const cost = played && best ? Math.max(0, best.ev - played.ev) : 0;
      if (cost >= threshold) {
        found.push({
          at,
          seat,
          phase: view.phase === 'discard' ? 'discard' : 'draw',
          hand: view.hand.slice(),
          played: action,
          options: ranked,
          cost,
          note: belief ? explain(belief, view.hand, action, played === undefined) : '',
        });
      }
    }
    state = apply(state, state.turn, action);
  }
  return found;
}

function sameAction(a: GinAction, b: GinAction): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'draw' && b.type === 'draw') return a.from === b.from;
  if (a.type === 'discard' && b.type === 'discard') return cardId(a.card) === cardId(b.card);
  if (a.type === 'knock' && b.type === 'knock') return cardId(a.discard) === cardId(b.discard);
  return a.type === 'big-gin' && b.type === 'big-gin';
}

/**
 * The position in a sentence or two.
 *
 * Only the two things a player cannot work out for themselves at the table:
 * how dangerous the card they threw was, and whether the cards they are
 * waiting on are still out there to be had.
 */
export function explain(
  belief: Belief,
  hand: readonly Card[],
  action: GinAction,
  unrated = false
): string {
  const parts: string[] = [];

  const thrown =
    action.type === 'discard' ? action.card : action.type === 'knock' ? action.discard : null;
  if (thrown) {
    const want = wantChance(belief, thrown);
    parts.push(
      `the ${cardId(thrown)} helps about ${Math.round(want * 100)}% of the hands they might hold`
    );
  }

  const live = outs(belief, hand).filter((out) => !out.gone);
  const dead = outs(belief, hand).filter((out) => out.gone);
  if (live.length > 0) {
    const top = live.slice(0, 3);
    parts.push(
      `still out there: ${top
        .map((out) => `${cardId(out.card)} (-${out.gain}, ${Math.round(out.live * 100)}% free)`)
        .join(', ')}`
    );
  }
  if (dead.length > 0) {
    parts.push(
      `gone for good: ${dead
        .slice(0, 3)
        .map((out) => `${cardId(out.card)} (-${out.gain})`)
        .join(', ')}`
    );
  }
  if (unrated) parts.push('(the solver did not shortlist this move, so it is unscored)');
  return parts.join('; ');
}

/** The whole review as text, which is how it gets read while it has no screen. */
export function format(decisions: readonly Decision[], name = 'you'): string {
  if (decisions.length === 0) return 'nothing worth second-guessing';
  const lines: string[] = [];
  for (const decision of decisions) {
    const best = decision.options[0];
    const played = describeAction(decision.played);
    const verdict =
      decision.cost <= 0.5
        ? 'fine'
        : decision.cost < 3
          ? `cost ${decision.cost.toFixed(1)}`
          : `COST ${decision.cost.toFixed(1)}`;
    lines.push(
      `move ${String(decision.at).padStart(2)} (${decision.phase}): ${name} ${played} -- ${verdict}`
    );
    if (best && decision.cost > 0.5) {
      lines.push(`    better: ${best.label} (${best.ev >= 0 ? '+' : ''}${best.ev.toFixed(1)})`);
    }
    if (decision.note) lines.push(`    ${decision.note}`);
  }
  const total = decisions.reduce((sum, d) => sum + d.cost, 0);
  lines.push(`total given up: ${total.toFixed(1)} points over ${decisions.length} decisions`);
  return lines.join('\n');
}

/** The worst few moves, for a summary that fits on a card. */
export function worst(decisions: readonly Decision[], count = 3): Decision[] {
  return decisions
    .slice()
    .sort((a, b) => b.cost - a.cost)
    .slice(0, count)
    .filter((d) => d.cost > 0.5);
}

/** Convenience for `outs`, which review callers usually want alongside. */
export type { Out };
