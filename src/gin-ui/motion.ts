import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { type Card, cardId } from '../gin/cards';
import type { GinView } from '../gin/game';

/**
 * Cards in motion.
 *
 * The problem this solves is that a turn in Gin is two moves, and the second
 * one only means something if you saw the first. "They drew and threw a 4" and
 * "they took your 4 and threw a King" are completely different pieces of
 * information, and a board that simply re-renders with new numbers gives you
 * neither -- the counts tick, the discard changes, and you are left inferring
 * what happened from arithmetic.
 *
 * So every card that moves is flown from where it was to where it ends up,
 * slowly enough to follow, and one at a time. The queue is the important part:
 * flights never overlap, so a draw always finishes before the discard that
 * follows it, and the two halves of a turn read in the order they happened
 * rather than as one blur.
 */

/** Slow enough to follow across the table without feeling like a cutscene. */
export const FLIGHT_MS = 720;
/**
 * Longer, for the one flight that is genuinely news: the opponent reaching
 * into the discard pile and taking the card you just threw. It is the most
 * informative event in the game and deserves more than a flicker.
 */
export const FLIGHT_TELLING_MS = 1020;
/** Neighbours shuffling along to open a gap for an arriving card. */
export const SLIDE_MS = 360;
/**
 * The same shuffle while a card is being dragged along the row.
 *
 * Much shorter, because during a drag it happens every time the pointer
 * crosses a neighbour rather than once a turn, and a row still finishing its
 * last rearrangement when the next one starts is the thing that makes a hand
 * look like it has come apart.
 */
export const DRAG_SLIDE_MS = 130;

/**
 * Whether to move things at all.
 *
 * Checked in script rather than left to a media query, because every animation
 * here is driven by the Web Animations API and no stylesheet reaches those.
 * Read fresh each time: the setting can change mid-session, and a flight that
 * ignores it locks the board for a second with nothing visibly happening.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export type Anchor =
  | { at: 'stock' }
  | { at: 'discard' }
  | { at: 'opponent' }
  | { at: 'hand'; card: string };

export function anchorKey(a: Anchor): string {
  return a.at === 'hand' ? `hand:${a.card}` : a.at;
}

export interface FlightSpec {
  /** Null means face down -- which is the whole message of a stock draw. */
  card: Card | null;
  from: Anchor;
  to: Anchor;
  ms?: number;
  /**
   * What the destination should show while the flight is in the air.
   *
   * The state has already moved on by the time a card takes off, so the
   * discard pile sits there displaying the card that is still visibly crossing
   * the table towards it. This is the card that was on top before, so the pile
   * looks untouched until the new one actually lands.
   */
  cover?: Card | null;
  /** A line under the piles while it happens, for the flights worth narrating. */
  label?: string;
}

export interface Flight extends FlightSpec {
  id: number;
  ms: number;
}

export interface FlightDeck {
  /** The one in the air. Nothing else moves until it lands. */
  active: Flight | null;
  waiting: number;
  enqueue: (specs: FlightSpec[]) => void;
  landed: (id: number) => void;
  /** Destination anchors whose card has not arrived yet, and what to show meanwhile. */
  pending: Map<string, Card | null>;
  busy: boolean;
}

export function useFlights(): FlightDeck {
  const [queue, setQueue] = useState<Flight[]>([]);
  const nextId = useRef(1);

  const enqueue = useCallback((specs: FlightSpec[]) => {
    if (specs.length === 0) return;
    setQueue((q) => [
      ...q,
      ...specs.map((spec) => ({ ...spec, id: nextId.current++, ms: spec.ms ?? FLIGHT_MS })),
    ]);
  }, []);

  const landed = useCallback((id: number) => {
    setQueue((q) => q.filter((f) => f.id !== id));
  }, []);

  // Every queued destination, not only the active one: a card queued to arrive
  // third must stay out of sight until its own flight plays, or it shows up in
  // the hand well before anything depicts it getting there.
  const pending = useMemo(() => {
    const map = new Map<string, Card | null>();
    for (const f of queue) map.set(anchorKey(f.to), f.cover ?? null);
    return map;
  }, [queue]);

  return {
    active: queue[0] ?? null,
    waiting: Math.max(0, queue.length - 1),
    enqueue,
    landed,
    pending,
    busy: queue.length > 0,
  };
}

/**
 * What moved between two views.
 *
 * Worked out by comparing views rather than read off the actions, which is
 * deliberate: online, the client is never told what the opponent did, only
 * what the table looks like afterwards. Everything worth animating is
 * recoverable from the difference anyway, including the one thing that matters
 * most -- a stock draw leaves the discard pile alone, a discard draw does not.
 */
export function detectFlights(before: GinView, after: GinView): FlightSpec[] {
  // A fresh deal is not a move. Under the dead-hand ruleset the stock only ever
  // shrinks within a hand, so a stock that grew means new cards on the table.
  if (after.stockCount > before.stockCount) return [];

  const beforeIds = new Set(before.hand.map(cardId));
  const afterIds = new Set(after.hand.map(cardId));
  const gained = after.hand.filter((c) => !beforeIds.has(cardId(c)));
  const lost = before.hand.filter((c) => !afterIds.has(cardId(c)));
  const discardDelta = after.discardCount - before.discardCount;
  const opponentDelta = after.opponentCardCount - before.opponentCardCount;

  const out: FlightSpec[] = [];

  // --- Draws first, because that is the order they happened in.
  if (gained.length === 1) {
    const fromDiscard = discardDelta < 0;
    out.push({
      card: gained[0],
      from: fromDiscard ? { at: 'discard' } : { at: 'stock' },
      to: { at: 'hand', card: cardId(gained[0]) },
      label: fromDiscard ? 'you took the discard' : 'you drew from the stock',
    });
  }

  if (opponentDelta > 0) {
    // The pile shrinking with nothing arriving in your own hand is the only way
    // the opponent can have taken the upcard, and `before.discardTop` is still
    // the card they took.
    const fromDiscard = discardDelta < 0 && gained.length === 0;
    out.push({
      card: fromDiscard ? before.discardTop : null,
      from: fromDiscard ? { at: 'discard' } : { at: 'stock' },
      to: { at: 'opponent' },
      ms: fromDiscard ? FLIGHT_TELLING_MS : FLIGHT_MS,
      label: fromDiscard ? 'they took your discard' : 'they drew from the stock',
    });
  }

  // --- Then the throw, from whichever side it came.
  if (discardDelta > 0 && after.discardTop) {
    const mine = lost.length === 1;
    // The card that ends a hand goes down face down, the way it is played at a
    // real table: it is the one discard nobody is allowed to pick up, so
    // showing its face would only invite the question. That it arrived face
    // down IS the announcement -- you know a knock has happened before you know
    // what the knock was.
    const knock = endedByKnock(before, after);
    out.push({
      card: knock ? null : after.discardTop,
      from: mine ? { at: 'hand', card: cardId(lost[0]) } : { at: 'opponent' },
      to: { at: 'discard' },
      cover: before.discardTop,
      label: knock
        ? mine
          ? 'you knocked'
          : 'they knocked'
        : mine
          ? 'you threw it'
          : 'they threw it',
    });
  }

  return out;
}

/**
 * Whether this view change is a hand ending on a knock.
 *
 * Gin and an undercut are knocks too -- all three end with a card going face
 * down on the pile. A dead hand is not: the stock simply ran out after an
 * ordinary discard, so that card lies face up like every one before it. Big gin
 * has no discard at all, so it never reaches here.
 */
export function endedByKnock(before: GinView, after: GinView): boolean {
  if (before.phase === 'over' || after.phase !== 'over') return false;
  const outcome = after.score?.outcome;
  return outcome === 'knock' || outcome === 'gin' || outcome === 'undercut';
}

/** Whether the top of the pile is a knocking card, and so lying face down. */
export function pileIsFaceDown(view: GinView): boolean {
  if (view.phase !== 'over') return false;
  const outcome = view.score?.outcome;
  return outcome === 'knock' || outcome === 'gin' || outcome === 'undercut';
}

export type RectBook = MutableRefObject<Map<string, DOMRect>>;

export function useRectBook(): RectBook {
  return useRef(new Map<string, DOMRect>());
}

/**
 * Keeps a note of where every card is, and slides them when they move.
 *
 * Two jobs in one pass, because they need the same measurement. The slide is
 * what makes a hand open up to receive a card instead of teleporting into a
 * new arrangement; the note is what lets a card that has just been thrown
 * still have somewhere to fly FROM, since by the time anything notices it has
 * gone its element is already out of the DOM. Entries are therefore merged in
 * and never cleared.
 */
export function useHandFlip(
  ref: RefObject<HTMLElement | null>,
  book: RectBook,
  key: string,
  enabled = true,
  ms = SLIDE_MS
) {
  /**
   * Which cards were in the row last time, which is what makes a note usable.
   *
   * Notes are kept by card id and the deck comes round, so the same card is
   * dealt back to you hands later with a note still describing where it sat
   * then. Sliding a newly arrived card from that is bad enough on its own --
   * but the flight bringing it in measures this slot to know where to land, so
   * a card mid-bogus-slide is measured in the wrong place, the flight ends
   * there, and the card snaps across the row afterwards.
   */
  const lastSeen = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const present = new Set<string>();
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-slot]'))) {
      const id = el.dataset.slot;
      if (!id) continue;
      present.add(id);

      /**
       * A slide already running has to be cancelled before this card can be
       * measured, and this is the subtle part of the whole file. A bounding
       * rect taken mid-animation reports where the card has got to, not where
       * it belongs; storing that would corrupt the note of its position, and
       * the note is what a thrown card's flight launches from and what the
       * next slide measures against. Two or three rearrangements into a drag
       * the errors compound and the row comes apart.
       *
       * Where it has got to is still worth knowing, though -- it is where the
       * eye last saw the card, so the replacement slide starts there and the
       * movement stays continuous instead of snapping back.
       */
      const running = el.getAnimations().filter((a) => a.playState === 'running');
      const seen = running.length > 0 ? el.getBoundingClientRect() : null;
      for (const animation of running) animation.cancel();

      const now = el.getBoundingClientRect();
      const was = lastSeen.current.has(id) ? book.current.get(id) : undefined;
      book.current.set(id, now);
      const from = seen ?? was;
      if (!enabled || !from) continue;
      slide(el, from.left - now.left, from.top - now.top, ms);
    }

    // Notes last exactly one change past the card itself, which is what a card
    // that has just been thrown needs: it is out of the row by the time
    // anything notices, and its last position is where its flight to the pile
    // has to start from.
    for (const id of Array.from(book.current.keys())) {
      if (!present.has(id) && !lastSeen.current.has(id)) book.current.delete(id);
    }
    lastSeen.current = present;
  }, [ref, book, key, enabled, ms]);

  // A resize relays the whole row out without changing the hand, which would
  // leave the notes describing the old layout and make the next real move slide
  // from the wrong place. Re-measure rather than animate.
  useEffect(() => {
    function remeasure() {
      const el = ref.current;
      if (!el) return;
      for (const slot of Array.from(el.querySelectorAll<HTMLElement>('[data-slot]'))) {
        if (slot.dataset.slot) book.current.set(slot.dataset.slot, slot.getBoundingClientRect());
      }
    }
    window.addEventListener('resize', remeasure);
    return () => window.removeEventListener('resize', remeasure);
  }, [ref, book]);
}

function slide(el: HTMLElement, dx: number, dy: number, ms = SLIDE_MS) {
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  if (typeof el.animate !== 'function' || prefersReducedMotion()) return;
  el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
    duration: ms,
    easing: 'cubic-bezier(.33,.84,.3,1)',
  });
}

/**
 * Move an element from where it used to be to where it is now, after the fact.
 *
 * The showdown's layoff animation needs this: a card that was in the
 * defender's deadwood gets re-rendered as part of one of the knocker's melds,
 * and the only way to show it travelling is to start it back at the rect it
 * used to occupy and let it catch up. The backwards fill holds it at the old
 * position through the stagger delay, so a row of them sets off in sequence
 * rather than all at once.
 */
export function flyFrom(el: HTMLElement, was: DOMRect, ms: number, delay = 0): void {
  if (typeof el.animate !== 'function' || prefersReducedMotion()) return;
  const now = el.getBoundingClientRect();
  const dx = was.left - now.left;
  const dy = was.top - now.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px)`, offset: 0 },
      { transform: `translate(${dx * 0.42}px, ${dy * 0.42 - 16}px) scale(1.06)`, offset: 0.55 },
      { transform: 'none', offset: 1 },
    ],
    { duration: ms, delay, easing: 'cubic-bezier(.3,.8,.25,1)', fill: 'backwards' }
  );
}

/** Where every `[data-slot]` under `root` is, right now. */
export function readSlots(root: HTMLElement | null): Map<string, DOMRect> {
  const map = new Map<string, DOMRect>();
  if (!root) return map;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-slot]'))) {
    if (el.dataset.slot) map.set(el.dataset.slot, el.getBoundingClientRect());
  }
  return map;
}
