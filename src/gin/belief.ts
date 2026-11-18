import { type Card, cardId, makeDeck } from './cards';
import { analyzeHand } from './melds';
import { type GinRules, NAPOLETANE_GIN, knockOptions } from './rules';

/**
 * What one player can work out about the other's hand.
 *
 * Gin is a game of imperfect information, and almost all of the skill in it
 * lives in this file rather than in the one that picks a card. Both players see
 * the same public record -- every discard, every upcard taken, and every upcard
 * passed over -- and the whole question is what that record implies about the
 * ten cards you cannot see.
 *
 * The method is a particle filter. A particle is one complete guess at the
 * opponent's hand, drawn from the cards you have not seen; the filter holds a
 * few thousand of them and reweights them every time the opponent does
 * something, by how well each guess explains what they did. Guesses that
 * explain the behaviour survive and multiply; guesses that do not die off.
 * That buys three things a table of per-card probabilities cannot:
 *
 *  - it respects the constraint that the hand has exactly ten cards, so
 *    believing hard in one card necessarily weakens belief in others;
 *  - the evidence compounds properly, since taking the King of roots and then
 *    throwing the King of coins is one story about one hand rather than two
 *    unrelated observations;
 *  - every particle is a complete hand, which is exactly what the rollouts in
 *    `solver.ts` need to play the rest of the game out.
 *
 * What it is NOT is a read on the specific opponent. The behaviour model below
 * is a generic noisy-rational player: it assumes they take cards that improve
 * their hand and throw the card that costs them least, with enough noise that
 * an unusual play is surprising rather than impossible. Nothing here is tuned
 * to the heuristic bot in `bot.ts`, deliberately -- a belief model fitted to
 * one opponent is worth very little against another.
 *
 * Everything reaching this file comes in as `Evidence`, and that type is the
 * information boundary: if a fact is not expressible as one of those cases,
 * the player is not entitled to it. The hidden half of the state never appears
 * in this file's inputs at all.
 */

export interface Particle {
  /** One complete guess at the opponent's hand. */
  hand: Card[];
  weight: number;
}

export interface Belief {
  rules: GinRules;
  /** Our own cards -- the one hand we are entitled to look at. */
  mine: Card[];
  /** The discard pile, oldest first. Only the last of these can be drawn. */
  pile: Card[];
  /**
   * Upcards the opponent passed over, which is evidence as surely as a take
   * is. Kept for explanation; the filter has already priced it in.
   */
  declined: Card[];
  /** Cards we watched them take off the pile and have not seen come back. */
  known: Card[];
  particles: Particle[];
  /** How many cards they are holding: ten, or eleven mid-turn. */
  opponentCount: number;
  /**
   * True between their blind draw and their discard.
   *
   * While it is set, every guess is one card short of their real hand, and
   * deliberately so: the card they drew is unknown, and committing each guess
   * to a random one would throw away the evidence we just gathered. Holding
   * the gap open until they discard lets that discard decide what was in it.
   */
  pending: boolean;
  stockCount: number;
  next: () => number;
}

export type Evidence =
  /** The start of the hand: our ten, and the card turned up between us. */
  | { kind: 'deal'; hand: Card[]; upcard: Card; stock: number }
  /** They drew. `from` is public; which card came off the stock is not. */
  | { kind: 'they-draw'; from: 'stock' | 'discard' }
  | { kind: 'they-discard'; card: Card }
  /** Our own moves, which change the pile and what is left unseen. */
  | { kind: 'we-draw'; card: Card; from: 'stock' | 'discard' }
  | { kind: 'we-discard'; card: Card };

/** How many guesses to carry. More is steadier and slower, linearly. */
export const PARTICLES = 1200;

/**
 * How often a surviving particle is nudged -- one unconstrained card swapped
 * for another from the pool.
 *
 * Resampling alone kills diversity: after a dozen rounds of it the filter is a
 * few hundred copies of the same hand, and is then certain about cards it has
 * no business being certain about. A little movement keeps the cloud honest.
 * Cards we actually watched them pick up are never swapped out, since those
 * are not guesses.
 */
const REJUVENATE = 0.12;

export function newBelief(
  evidence: Extract<Evidence, { kind: 'deal' }>,
  next: () => number,
  rules: GinRules = NAPOLETANE_GIN,
  count = PARTICLES
): Belief {
  const belief: Belief = {
    rules,
    mine: evidence.hand.slice(),
    pile: [evidence.upcard],
    declined: [],
    known: [],
    particles: [],
    pending: false,
    opponentCount: evidence.hand.length,
    stockCount: evidence.stock,
    next,
  };
  const pool = unseen(belief);
  belief.particles = Array.from({ length: count }, () => ({
    hand: pick(pool, guessSize(belief), next),
    weight: 1 / count,
  }));
  return belief;
}

/**
 * Fold one public fact into the belief.
 *
 * Mutates, and returns the same object: a belief is a few thousand hands and
 * copying it on every card played would dominate the cost of using it.
 */
export function observe(belief: Belief, evidence: Evidence): Belief {
  switch (evidence.kind) {
    case 'deal':
      throw new Error('a deal starts a belief rather than updating one');

    case 'we-draw': {
      belief.mine.push(evidence.card);
      if (evidence.from === 'discard') belief.pile.pop();
      else belief.stockCount--;
      // A card in our own hand is in nobody else's. Particles that had it are
      // impossible, and are repaired rather than merely discarded -- throwing
      // them away would quietly shrink the cloud every time we draw.
      repair(belief);
      return belief;
    }

    case 'we-discard': {
      belief.mine = belief.mine.filter((c) => cardId(c) !== cardId(evidence.card));
      belief.pile.push(evidence.card);
      return belief;
    }

    case 'they-draw': {
      const top = belief.pile[belief.pile.length - 1] ?? null;
      belief.opponentCount++;
      if (evidence.from === 'discard') {
        if (!top) return belief;
        // Reweighted BEFORE the card leaves the pile, which is not fussiness:
        // reweighting can resample, resampling can rejuvenate, and rejuvenation
        // deals from whatever is unseen. Pop first and that card is unseen for
        // the length of the call -- so a guess can be dealt the very card it is
        // about to be handed, and ends up holding it twice.
        reweight(belief, (hand) => takeChance(hand, top, belief.rules));
        belief.pile.pop();
        belief.known.push(top);
        for (const particle of belief.particles) {
          if (particle.hand.some((c) => cardId(c) === cardId(top))) continue;
          particle.hand = [...particle.hand, top];
        }
        belief.pending = false;
      } else {
        if (top) {
          belief.declined.push(top);
          // Passing is quieter evidence, and much easier to overlook: a hand
          // that would have loved that card is unlikely to be the hand that
          // let it go.
          reweight(belief, (hand) => 1 - takeChance(hand, top, belief.rules));
        }
        belief.stockCount--;
        // The card they drew stays unknown until they throw something. Giving
        // each guess a random one here would be the worst of both worlds: it
        // commits to a card nobody has any reason to believe in, and it hands
        // back exactly the cards the pass just argued against.
        belief.pending = true;
      }
      return belief;
    }

    case 'they-discard': {
      const thrown = cardId(evidence.card);
      if (belief.pending) {
        settlePending(belief, evidence.card);
      } else {
        // They took the upcard, so we know every card in play for them.
        // Throwing one is the richest evidence in the game, because a player
        // throws what is worth least to them: every guess that would have
        // thrown something else is wrong about what they are holding.
        reweight(belief, (hand) =>
          hand.some((c) => cardId(c) === thrown)
            ? discardChance(hand, evidence.card, belief.rules)
            : 0
        );
        for (const particle of belief.particles) {
          particle.hand = particle.hand.filter((c) => cardId(c) !== thrown);
        }
      }
      belief.known = belief.known.filter((c) => cardId(c) !== thrown);
      belief.opponentCount--;
      belief.pile.push(evidence.card);
      // A guess that cannot have thrown that card is dead, and after a kill
      // like this one the cloud needs rebuilding more than nudging.
      repair(belief);
      return belief;
    }
  }
}

/**
 * Work out what the unknown card was, now that they have thrown something.
 *
 * For any one guess the two stories are mutually exclusive, which is what
 * makes this tractable:
 *
 *  - the guess says they were holding the thrown card, so the card they drew
 *    is still unknown and still theirs. How likely that is depends on whether
 *    the thrown card really was the worst of the eleven.
 *  - the guess says they were not, so they must have drawn that exact card off
 *    the stock and thrown it straight back. That is a much narrower claim --
 *    one specific card out of everything left -- which is why a thrown card is
 *    usually a card they were already holding.
 *
 * Both stories are priced, the guess is reweighted by whichever applies, and
 * in the first case it finally takes a card for the draw it has been owing.
 */
function settlePending(belief: Belief, thrown: Card): void {
  const thrownId = cardId(thrown);
  const pool = unseen(belief).filter((c) => cardId(c) !== thrownId);
  const drawn = new Map<Particle, Card | null>();

  // Normalised, but deliberately NOT resampled: resampling rejuvenates, and
  // the thrown card is not on the pile yet, so a guess could be dealt the card
  // whose absence it is about to be judged on.
  normalise(belief);
  for (const particle of belief.particles) {
    const held = particle.hand.some((c) => cardId(c) === thrownId);
    if (held) {
      // They kept whatever they drew. Which card that was barely matters to
      // the likelihood -- what matters is that the thrown one was the worst of
      // the eleven -- so one sample stands in for the lot.
      const free = pool.filter((c) => !particle.hand.some((h) => cardId(h) === cardId(c)));
      const pick = free.length > 0 ? free[Math.floor(belief.next() * free.length)] : null;
      drawn.set(particle, pick);
      const eleven = pick ? [...particle.hand, pick] : particle.hand;
      particle.weight *= discardChance(eleven, thrown, belief.rules);
    } else {
      // They drew the very card they threw: one chance in however many cards
      // are still out, and then only if it really was worth throwing.
      const odds = pool.length > 0 ? 1 / (pool.length + 1) : 0;
      drawn.set(particle, null);
      particle.weight *= odds * discardChance([...particle.hand, thrown], thrown, belief.rules);
    }
  }

  normalise(belief);

  for (const particle of belief.particles) {
    const pick = drawn.get(particle) ?? null;
    particle.hand = particle.hand.filter((c) => cardId(c) !== thrownId);
    if (pick) particle.hand = [...particle.hand, pick];
  }
  belief.pending = false;
  if (effectiveCount(belief) < belief.particles.length / 2) resample(belief);
}

/**
 * Square the guesses with what we actually know.
 *
 * Our own hand and the pile are ground truth; a guess is only a guess about
 * everything else. This drops any card a guess claims they hold that we can
 * see elsewhere, restores anything we watched them take, and tops the hand
 * back up to the right size -- always from the pool, never by deleting the
 * guess, because deleting guesses shrinks the cloud a little every turn until
 * there is nothing left to be uncertain with.
 *
 * Worth calling wherever our own cards change, and again by anything feeding
 * the filter from outside: a single gap in somebody else's bookkeeping would
 * otherwise leave a card in two places at once, and a sampled world built
 * from it is not a game of gin.
 */
export function reconcile(belief: Belief): void {
  repair(belief);
}

/** Everything we have not seen: it is either in their hand or in the stock. */
export function unseen(belief: Belief): Card[] {
  const gone = new Set<string>();
  for (const card of belief.mine) gone.add(cardId(card));
  for (const card of belief.pile) gone.add(cardId(card));
  return makeDeck().filter((c) => !gone.has(cardId(c)));
}

/**
 * Cards that can never be drawn again, whoever wants them.
 *
 * The reason a player stops chasing: a run needing the 5 of goblets is not a
 * run if the 5 of goblets is lying under three other cards in the pile. Only
 * the top of the pile is live, and the rest is as good as out of the game.
 */
export function buried(belief: Belief): Card[] {
  return belief.pile.slice(0, -1);
}

export function isBuried(belief: Belief, card: Card): boolean {
  const id = cardId(card);
  return belief.pile.slice(0, -1).some((c) => cardId(c) === id);
}

/**
 * The chance they are holding ALL of these cards.
 *
 * The joint question is usually the one worth asking, and it is the one a
 * table of per-card odds cannot answer. Passing over the 5 of swords says
 * almost nothing about whether they hold the 6 -- plenty of hands hold the 6
 * and still have no use for the 5 -- but it says a great deal about whether
 * they hold the 6 AND the 7.
 */
export function holdsAllChance(belief: Belief, cards: readonly Card[]): number {
  const want = cards.map(cardId);
  let total = 0;
  let held = 0;
  for (const particle of belief.particles) {
    total += particle.weight;
    const ids = new Set(particle.hand.map(cardId));
    if (want.every((id) => ids.has(id))) held += particle.weight;
  }
  return total > 0 ? held / total : 0;
}

/** The chance they are holding this card, as the filter currently sees it. */
export function holdsChance(belief: Belief, card: Card): number {
  const id = cardId(card);
  let total = 0;
  let held = 0;
  for (const particle of belief.particles) {
    total += particle.weight;
    if (particle.hand.some((c) => cardId(c) === id)) held += particle.weight;
  }
  return total > 0 ? held / total : 0;
}

/** How many cards a guess should name: one fewer while a draw is owing. */
function guessSize(belief: Belief): number {
  return belief.opponentCount - (belief.pending ? 1 : 0);
}

/**
 * How likely they are to want a card we are thinking of throwing.
 *
 * Not the same question as whether they hold it -- they cannot hold the card
 * in our own hand. This asks how many of the hands they might have would be
 * improved by it, which is exactly the risk in throwing it.
 */
export function wantChance(belief: Belief, card: Card): number {
  let total = 0;
  let wants = 0;
  for (const particle of belief.particles) {
    total += particle.weight;
    if (takeGain(particle.hand, card, belief.rules) > 0) wants += particle.weight;
  }
  return total > 0 ? wants / total : 0;
}

/** A card that would improve our hand, and what has become of it. */
export interface Out {
  card: Card;
  /** Deadwood points it would shed. */
  gain: number;
  /** Lying under the pile: nobody can have it, ever. */
  gone: boolean;
  /** The chance they are sitting on it. */
  theirs: number;
  /** The chance it is still in the stock, which is the only chance we have. */
  live: number;
}

/**
 * Every card that would help this hand, and whether it can still be had.
 *
 * This is the answer to chasing. A hand two cards into a run looks the same
 * whether the card it needs is sitting in the stock or buried under four
 * discards, and the difference is the whole decision: one is a hand worth
 * holding and the other is eight points of deadwood with a story attached.
 */
export function outs(belief: Belief, hand: readonly Card[]): Out[] {
  const pile = new Set(belief.pile.slice(0, -1).map(cardId));
  const held = new Set(hand.map(cardId));
  const found: Out[] = [];
  for (const card of makeDeck()) {
    const id = cardId(card);
    if (held.has(id)) continue;
    const gain = takeGain(hand, card, belief.rules);
    if (gain <= 0) continue;
    const gone = pile.has(id);
    const theirs = gone ? 0 : holdsChance(belief, card);
    found.push({ card, gain, gone, theirs, live: gone ? 0 : 1 - theirs });
  }
  return found.sort((a, b) => b.gain * b.live - a.gain * a.live);
}

/** One guess at their hand, drawn in proportion to how well it fits. */
export function sampleHand(belief: Belief): Card[] {
  const roll = belief.next();
  let seen = 0;
  for (const particle of belief.particles) {
    seen += particle.weight;
    if (roll <= seen) return particle.hand.slice();
  }
  return (belief.particles[belief.particles.length - 1]?.hand ?? []).slice();
}

// --- The behaviour model ----------------------------------------------------
//
// Generic on purpose. A player takes cards that help and throws the card that
// hurts least, with enough slack that an odd play is surprising rather than
// ruled out. Fitting these to a particular opponent would make the filter
// sharper against that opponent and worse against everyone else.

/**
 * What taking this card is actually worth to a hand.
 *
 * Measured by holding it: the deadwood of the ten cards against the deadwood
 * of the eleven. A card that melds pulls its partners out of the deadwood and
 * the number drops, by a lot; a card that fits nothing adds its own points and
 * the number goes up.
 *
 * The obvious alternative -- compare against the best ten you could keep after
 * taking it -- looks right and is useless, because drawing ANY card lets you
 * throw your worst one, so every card in the deck scores well and a take tells
 * you nothing. This asks the question that actually distinguishes hands: does
 * this card do something, or is it just smaller than my rubbish?
 */
export function takeGain(hand: readonly Card[], card: Card, _rules: GinRules): number {
  return analyzeHand(hand).deadwoodPoints - analyzeHand([...hand, card]).deadwoodPoints;
}

/** How likely a hand is to take a given upcard. */
export function takeChance(hand: readonly Card[], card: Card, rules: GinRules): number {
  const gain = takeGain(hand, card, rules);
  return 0.03 + 0.94 / (1 + Math.exp(-(gain - 3.2) / 1.4));
}

/**
 * How likely a hand is to throw a given card, against all the others it could
 * have thrown instead.
 *
 * A softmax rather than a hard minimum: the best discard is usually played,
 * but holding a high card one turn longer to see whether it pairs is an
 * ordinary thing to do, and a model that calls it impossible will conclude
 * something false with total confidence.
 */
export function discardChance(hand: readonly Card[], card: Card, rules: GinRules): number {
  const options = knockOptions(hand, rules);
  if (options.length === 0) return 0;
  const tau = 1.6;
  let total = 0;
  let mine = 0;
  for (const option of options) {
    const weight = Math.exp(-option.deadwoodPoints / tau);
    total += weight;
    if (cardId(option.discard) === cardId(card)) mine = weight;
  }
  return total > 0 ? mine / total : 0;
}

// --- Filter mechanics -------------------------------------------------------

function reweight(belief: Belief, likelihood: (hand: Card[]) => number): void {
  let total = 0;
  for (const particle of belief.particles) {
    particle.weight *= likelihood(particle.hand);
    total += particle.weight;
  }
  if (total <= 0) {
    // Nothing explains what they did -- the model is wrong rather than the
    // opponent. Flatten and carry on; a confidently wrong filter is worse than
    // an ignorant one.
    for (const particle of belief.particles) particle.weight = 1 / belief.particles.length;
    return;
  }
  for (const particle of belief.particles) particle.weight /= total;
  if (effectiveCount(belief) < belief.particles.length / 2) resample(belief);
}

function normalise(belief: Belief): void {
  let total = 0;
  for (const particle of belief.particles) total += particle.weight;
  if (total <= 0) {
    for (const particle of belief.particles) particle.weight = 1 / belief.particles.length;
    return;
  }
  for (const particle of belief.particles) particle.weight /= total;
}

function effectiveCount(belief: Belief): number {
  let sum = 0;
  for (const particle of belief.particles) sum += particle.weight * particle.weight;
  return sum > 0 ? 1 / sum : 0;
}

/**
 * Systematic resampling: one evenly spaced sweep rather than N independent
 * draws, which keeps the sampling noise down at no extra cost.
 */
function resample(belief: Belief): void {
  const count = belief.particles.length;
  if (count === 0) return;
  const step = 1 / count;
  let point = belief.next() * step;
  const out: Particle[] = [];
  let cumulative = 0;
  let i = 0;
  for (const particle of belief.particles) {
    cumulative += particle.weight;
    while (point < cumulative && out.length < count) {
      out.push({ hand: particle.hand.slice(), weight: step });
      point += step;
      i++;
    }
  }
  while (out.length < count) {
    out.push({ hand: belief.particles[belief.particles.length - 1].hand.slice(), weight: step });
  }
  belief.particles = out;
  rejuvenate(belief);
}

function rejuvenate(belief: Belief): void {
  const pool = unseen(belief);
  if (pool.length === 0) return;
  const locked = new Set(belief.known.map(cardId));
  for (const particle of belief.particles) {
    if (belief.next() >= REJUVENATE) continue;
    const movable = particle.hand.map((c, i) => [c, i] as const).filter(([c]) => !locked.has(cardId(c)));
    if (movable.length === 0) continue;
    const [, at] = movable[Math.floor(belief.next() * movable.length)];
    const held = new Set(particle.hand.map(cardId));
    const free = pool.filter((c) => !held.has(cardId(c)));
    if (free.length === 0) continue;
    const swap = free[Math.floor(belief.next() * free.length)];
    particle.hand = particle.hand.map((c, i) => (i === at ? swap : c));
  }
}

/**
 * Put right any guess that has become impossible.
 *
 * Particles go stale in two ways: a card they claim the opponent holds turns
 * up somewhere else, or the hand ends up the wrong size. Both are repaired
 * from the pool rather than deleted, because deleting them shrinks the cloud
 * every single turn until there is nothing left to be uncertain with.
 */
function repair(belief: Belief): void {
  const pool = unseen(belief);
  if (pool.length === 0) return;
  const live = new Set(pool.map(cardId));
  const locked = belief.known.map(cardId);
  for (const particle of belief.particles) {
    let hand = particle.hand.filter((c) => live.has(cardId(c)));
    // Anything we watched them take is theirs until we watch it come back.
    for (const id of locked) {
      if (!hand.some((c) => cardId(c) === id)) {
        const card = pool.find((c) => cardId(c) === id);
        if (card) hand.push(card);
      }
    }
    const size = guessSize(belief);
    if (hand.length > size) {
      const keep = new Set(locked);
      hand = hand
        .slice()
        .sort((a, b) => Number(keep.has(cardId(b))) - Number(keep.has(cardId(a))))
        .slice(0, size);
    }
    while (hand.length < size) {
      const held = new Set(hand.map(cardId));
      const free = pool.filter((c) => !held.has(cardId(c)));
      if (free.length === 0) break;
      hand.push(free[Math.floor(belief.next() * free.length)]);
    }
    particle.hand = hand;
  }
}

function pick(pool: readonly Card[], count: number, next: () => number): Card[] {
  const copy = pool.slice();
  const out: Card[] = [];
  for (let i = 0; i < count && copy.length > 0; i++) {
    out.push(copy.splice(Math.floor(next() * copy.length), 1)[0]);
  }
  return out;
}
