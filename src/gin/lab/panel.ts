import { rng } from '../cards';
import { type ChampionOptions, champion } from './champion';
import { type ExpertParams, SEED_PARAMS, expert } from './expert';
import {
  BIG_GIN,
  KNOCK,
  POINTS,
  type Policy,
  type Seen,
  bestThrow,
  deadwoodOf,
  deadwoodWith,
  deadwoodWithout,
} from './fast';

/**
 * The opponents, as data.
 *
 * A spec rather than a function so it can cross into a worker thread: the
 * tuner farms games out to every core, and each worker rebuilds the players
 * from these descriptions.
 *
 * The panel is chosen to be wrong in as many different directions as
 * possible, because a strategy is only worth calling strong if it beats all of
 * them. Some are the arena's bots rebuilt for speed; some are shaped like
 * people -- the casual player who takes anything that pairs, the nervous one
 * who never throws near what you picked up, the one who forgets -- since the
 * tournament has humans in it and humans are not noisy versions of a
 * computer, they are differently wrong.
 */
export type Spec =
  | { kind: 'expert'; params: ExpertParams; name?: string }
  | { kind: 'greedy' }
  | { kind: 'heuristic'; level: 'easy' | 'steady' | 'sharp' }
  | { kind: 'hoarder'; threshold: number }
  | { kind: 'magpie' }
  | { kind: 'careless' }
  | { kind: 'casual' }
  | { kind: 'cautious' }
  | { kind: 'gin-hunter' }
  | { kind: 'random' }
  | { kind: 'human'; slip?: number; nerve?: number }
  | { kind: 'champion'; options: ChampionOptions };

export function specName(spec: Spec): string {
  switch (spec.kind) {
    case 'expert':
      return spec.name ?? 'expert';
    case 'champion':
      return spec.options.name ?? 'champion';
    case 'heuristic':
      return `heuristic-${spec.level}`;
    case 'hoarder':
      return `hoarder-${spec.threshold}`;
    default:
      return spec.kind;
  }
}

function top(seen: Seen): number {
  return seen.pub.pile[seen.pub.pile.length - 1];
}

function takeIfItMelds(seen: Seen): boolean {
  return deadwoodWith(seen.masks, top(seen)) < deadwoodOf(seen.masks);
}

function throwOrKnock(seen: Seen, threshold: number): number {
  if (deadwoodOf(seen.masks) === 0) return BIG_GIN;
  const best = bestThrow(seen.hand, seen.masks);
  if (best.left <= seen.pub.rules.knockMaxDeadwood && best.left <= threshold) return KNOCK + best.card;
  return best.card;
}

export function makePolicy(spec: Spec, seed = 1): Policy {
  const next = rng(seed);
  const name = specName(spec);
  switch (spec.kind) {
    case 'expert':
      return expert(spec.params, next, name);

    case 'champion':
      return champion({ ...spec.options, seed: seed * 7 + (spec.options.seed ?? 0) });

    case 'greedy':
      return { name, draw: takeIfItMelds, throw: (s) => throwOrKnock(s, 8) };

    case 'heuristic': {
      const knockAt = spec.level === 'sharp' ? 4 : 8;
      const blunder = spec.level === 'easy' ? 0.35 : spec.level === 'steady' ? 0.1 : 0;
      return {
        name,
        draw: (s) => bestThrow([...s.hand, top(s)], withCard(s, top(s))).left < deadwoodOf(s.masks),
        throw(s) {
          if (deadwoodOf(s.masks) === 0) return BIG_GIN;
          const ranked = s.hand
            .map((c) => ({ c, v: deadwoodWithout(s.masks, c) }))
            .sort((a, b) => a.v - b.v || POINTS[b.c] - POINTS[a.c]);
          const best = ranked[0];
          if (best.v <= knockAt) return KNOCK + best.c;
          if (blunder > 0 && next() < blunder) {
            return ranked[1 + Math.floor(next() * (ranked.length - 1))].c;
          }
          return best.c;
        },
      };
    }

    case 'hoarder':
      return { name, draw: takeIfItMelds, throw: (s) => throwOrKnock(s, spec.threshold) };

    case 'gin-hunter':
      return { name, draw: takeIfItMelds, throw: (s) => throwOrKnock(s, 0) };

    case 'magpie':
      return { name, draw: () => true, throw: (s) => throwOrKnock(s, 8) };

    case 'careless':
      return {
        name,
        draw: () => next() < 0.3,
        throw(s) {
          if (deadwoodOf(s.masks) === 0) return BIG_GIN;
          const best = bestThrow(s.hand, s.masks);
          if (best.left <= 8) return KNOCK + best.card;
          const dw = deadwoodOf(s.masks);
          // A loose card: one whose loss does not raise the deadwood of the rest.
          const loose = s.hand.filter((c) => deadwoodWithout(s.masks, c) < dw);
          const pool = loose.length ? loose : s.hand;
          return pool[Math.floor(next() * pool.length)];
        },
      };

    case 'random':
      return {
        name,
        draw: () => next() < 0.5,
        throw(s) {
          if (deadwoodOf(s.masks) === 0) return BIG_GIN;
          const card = s.hand[Math.floor(next() * s.hand.length)];
          if (deadwoodWithout(s.masks, card) <= 8 && next() < 0.5) return KNOCK + card;
          return card;
        },
      };

    case 'casual': {
      // Takes anything that pairs or connects, the commonest human habit, and
      // knocks the moment it can. Throws its highest card that touches nothing.
      return {
        name,
        draw(s) {
          const t = top(s);
          return s.hand.some((c) => touches(c, t));
        },
        throw(s) {
          if (deadwoodOf(s.masks) === 0) return BIG_GIN;
          const best = bestThrow(s.hand, s.masks);
          if (best.left <= 8) return KNOCK + best.card;
          const lonely = s.hand.filter((c) => !s.hand.some((o) => o !== c && touches(o, c)));
          const pool = lonely.length ? lonely : [best.card];
          return pool.reduce((a, b) => (POINTS[b] > POINTS[a] ? b : a));
        },
      };
    }

    case 'human':
      return humanPolicy(name, next, spec.slip ?? 0.15, spec.nerve ?? 5);

    case 'cautious': {
      // Never throws next to what you picked up, and knocks only when low.
      return {
        name,
        draw: takeIfItMelds,
        throw(s) {
          if (deadwoodOf(s.masks) === 0) return BIG_GIN;
          const ranked = s.hand
            .map((c) => ({ c, v: deadwoodWithout(s.masks, c) }))
            .sort((a, b) => a.v - b.v || POINTS[b.c] - POINTS[a.c]);
          const late = s.pub.stockCount < 9;
          if (ranked[0].v <= (late ? 2 : 4)) return KNOCK + ranked[0].c;
          const them = s.seat === 0 ? 1 : 0;
          const taken = s.pub.taken[them];
          const safe = ranked.find(
            (r) => r.v <= ranked[0].v + 6 && !Array.from({ length: 40 }, (_, k) => k).some((k) => taken[k] && touches(k, r.c))
          );
          return (safe ?? ranked[0]).c;
        },
      };
    }
  }
}

/**
 * Cards that are not part of any meld in the hand's best arrangement: the ones
 * whose loss takes exactly their own points off the deadwood.
 */
function looseCards(s: Seen): number[] {
  const dw = deadwoodOf(s.masks);
  return s.hand.filter((c) => deadwoodWithout(s.masks, c) === dw - POINTS[c]);
}

/**
 * A human player, as described by someone who plays them:
 *
 *  - Takes any upcard that completes a meld with two of their loose cards --
 *    but not one that would have to poach cards already sitting in another
 *    meld. Otherwise draws blind.
 *  - Throws their dearest loose card, and never breaks up a meld to do it.
 *  - Shies away from throwing anything next to a card you picked up (same
 *    rank, or within two in suit), unless holding it costs them `nerve`
 *    points of deadwood or more.
 *  - Slips `slip` of the time, throwing a random loose card instead -- still
 *    never one out of a meld.
 *  - Knocks the moment it is legal; always takes gin.
 */
function humanPolicy(name: string, next: () => number, slip: number, nerve: number): Policy {
  let justTook = -1;
  return {
    name,
    begin() {
      justTook = -1;
    },
    draw(s) {
      const t = top(s);
      justTook = -1;
      const loose = new Uint8Array(40);
      for (const c of looseCards(s)) loose[c] = 1;
      const suit = (t / 10) | 0;
      const r = t % 10;
      let sameRank = 0;
      for (let k = 0; k < 4; k++) if (k !== suit && loose[k * 10 + r]) sameRank++;
      const at = (d: number) => r + d >= 0 && r + d <= 9 && loose[suit * 10 + r + d] === 1;
      const completes = sameRank >= 2 || (at(-2) && at(-1)) || (at(-1) && at(1)) || (at(1) && at(2));
      if (completes) justTook = t;
      return completes;
    },
    throw(s) {
      if (deadwoodOf(s.masks) === 0) return BIG_GIN;
      const best = bestThrow(s.hand, s.masks);
      if (best.left <= s.pub.rules.knockMaxDeadwood) return KNOCK + best.card;
      let loose = looseCards(s).filter((c) => c !== justTook);
      if (loose.length === 0) loose = [best.card];
      if (slip > 0 && next() < slip) return loose[Math.floor(next() * loose.length)];
      const them = s.seat === 0 ? 1 : 0;
      const taken = s.pub.taken[them];
      const near = (c: number) => {
        for (let k = 0; k < 40; k++) if (taken[k] && touches(k, c)) return true;
        return false;
      };
      let pick = loose[0];
      let pickScore = Infinity;
      for (const c of loose) {
        // Deadwood left after throwing it, plus the nerve it takes to throw
        // something next to their pickups.
        const score = deadwoodWithout(s.masks, c) + (near(c) ? nerve : 0);
        if (score < pickScore || (score === pickScore && POINTS[c] > POINTS[pick])) {
          pick = c;
          pickScore = score;
        }
      }
      return pick;
    },
  };
}

/** Same rank, or one or two apart in the same suit. */
function touches(a: number, b: number): boolean {
  if (a === b) return false;
  if (a % 10 === b % 10) return true;
  return ((a / 10) | 0) === ((b / 10) | 0) && Math.abs((a % 10) - (b % 10)) <= 2;
}

function withCard(s: Seen, card: number): Int32Array {
  const m = s.masks.slice();
  m[(card / 10) | 0] |= 1 << card % 10;
  return m;
}

/** The standing panel every candidate has to beat. */
export const PANEL: Spec[] = [
  { kind: 'heuristic', level: 'sharp' },
  { kind: 'heuristic', level: 'steady' },
  { kind: 'greedy' },
  { kind: 'hoarder', threshold: 2 },
  { kind: 'gin-hunter' },
  { kind: 'magpie' },
  { kind: 'careless' },
  { kind: 'casual' },
  { kind: 'cautious' },
  { kind: 'expert', params: SEED_PARAMS, name: 'expert-seed' },
  { kind: 'expert', params: { ...SEED_PARAMS, noise: 0.15 }, name: 'forgetful' },
  { kind: 'human' },
];
