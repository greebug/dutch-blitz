import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useRef, useState } from 'react';

import { type Card, cardId } from '../gin/cards';

/**
 * Picking a card up and putting it somewhere.
 *
 * Two jobs, because they are the same gesture: moving a card within your own
 * hand, and throwing one onto the discard pile. Which it was is decided by
 * where you let go, not by how you started, so there is nothing to choose
 * beforehand.
 *
 * Built on pointer events rather than HTML5 drag-and-drop, for two reasons that
 * both matter here. Native dragging does not exist on touch screens, and this
 * game is played on a phone; and it insists on its own drag image, which cannot
 * be a real card with its glow rings. Pointer events are one code path for
 * mouse, pen and finger, and the card that follows your hand is the actual
 * card.
 *
 * The hand reorders live, as the pointer crosses each neighbour, rather than
 * showing an insertion marker and rearranging on release. It costs a little
 * more care -- see `SETTLE` -- but it means the drop is never a guess: the
 * card is already where it is going to be.
 */

/** How far the pointer must travel before this is a drag and not a click. */
const SLOP = 6;
/** How long after a drag a click still belongs to it. */
const SWALLOW_MS = 400;
/**
 * How far the pointer must travel after one reorder before another is allowed.
 *
 * Without it a pointer resting exactly on a boundary flips the two cards back
 * and forth every frame, because each reorder moves the boundary under the
 * pointer. Measured along the row, which is the axis the comparison uses.
 */
const SETTLE = 11;
/** Slack around the drop zones, so a near miss still counts. */
const PILE_PAD = 16;
const HAND_PAD_X = 36;
const HAND_PAD_Y = 64;

export type DropZone = 'hand' | 'discard' | null;

export interface DragState {
  card: Card;
  /** Viewport position of the card's top-left corner, right now. */
  left: number;
  top: number;
  /** Measured at pickup, so the flying card matches the one left behind. */
  width: number;
  over: DropZone;
}

export interface HandDrag {
  /** Null unless a card is actually in hand -- a tap never sets this. */
  state: DragState | null;
  /** The card that has been lifted out of the row, if any. */
  heldId: string | null;
  begin: (event: ReactPointerEvent<HTMLElement>, card: Card) => void;
  /**
   * Whether a click arriving now is the tail of a drag rather than a click.
   *
   * A mouse drag is followed by a click, and the card is a button whose click
   * throws it, so letting go of a card you have just rearranged must not throw
   * it. This answers by the clock rather than by a flag waiting to be
   * consumed: a touch drag usually ends in no click at all, and a flag nobody
   * comes to collect sits there armed and swallows the next real tap instead.
   */
  swallowClick: () => boolean;
}

export interface HandDragConfig {
  handRef: RefObject<HTMLElement | null>;
  discardRef: RefObject<HTMLElement | null>;
  /** Card ids, in the order the row is currently showing them. */
  order: readonly string[];
  /** Called as the row rearranges under the pointer, and on cancel. */
  onReorder: (next: string[]) => void;
  /** Called on release over the pile. Omit to make the pile an inert target. */
  onDiscard?: (card: Card) => void;
  /** False while a card is in flight, or when it is not your hand to touch. */
  enabled?: boolean;
}

export function useHandDrag(config: HandDragConfig): HandDrag {
  const [state, setState] = useState<DragState | null>(null);
  const [heldId, setHeldId] = useState<string | null>(null);

  // The window listeners below outlive any one render, so everything they need
  // is read through a ref rather than captured.
  const cfg = useRef(config);
  cfg.current = config;

  /** When the tail of the last drag stops counting as part of it. */
  const swallowUntil = useRef(0);
  const live = useRef<{
    id: string;
    card: Card;
    pointerId: number;
    startX: number;
    startY: number;
    grabX: number;
    grabY: number;
    width: number;
    /** Where along the row the last reorder happened -- see `SETTLE`. */
    lastAt: number;
    startOrder: readonly string[];
    active: boolean;
  } | null>(null);

  /**
   * How to let go of the window, set while a card is held.
   *
   * The listeners are added per drag rather than for the life of the component,
   * so there has to be something that can take them off again from outside the
   * gesture -- an unmount mid-drag would otherwise leave four listeners and a
   * card frozen in the air.
   */
  const detach = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      detach.current?.();
      detach.current = null;
      live.current = null;
    },
    []
  );

  const begin = (event: ReactPointerEvent<HTMLElement>, card: Card) => {
    if (cfg.current.enabled === false) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (live.current) return;
    swallowUntil.current = 0;

    const slot = event.currentTarget.getBoundingClientRect();
    live.current = {
      id: cardId(card),
      card,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      grabX: event.clientX - slot.left,
      grabY: event.clientY - slot.top,
      width: slot.width,
      lastAt: event.clientX,
      startOrder: cfg.current.order.slice(),
      active: false,
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    detach.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
  };

  function stop() {
    detach.current?.();
    detach.current = null;
    live.current = null;
    setState(null);
    setHeldId(null);
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !live.current) return;
    // Put the hand back the way it was before the drag started.
    if (live.current.active) cfg.current.onReorder(live.current.startOrder.slice());
    if (live.current.active) swallowUntil.current = now() + SWALLOW_MS;
    stop();
  }

  function onCancel() {
    if (!live.current) return;
    if (live.current.active) cfg.current.onReorder(live.current.startOrder.slice());
    if (live.current.active) swallowUntil.current = now() + SWALLOW_MS;
    stop();
  }

  function onMove(event: PointerEvent) {
    const held = live.current;
    if (!held || event.pointerId !== held.pointerId) return;

    if (!held.active) {
      const far =
        Math.abs(event.clientX - held.startX) > SLOP ||
        Math.abs(event.clientY - held.startY) > SLOP;
      if (!far) return;
      held.active = true;
      setHeldId(held.id);
    }

    // Stops the gesture turning into a text selection or a page scroll. Safe to
    // call now: the click this would have cancelled is one we do not want.
    if (event.cancelable) event.preventDefault();

    const over = zoneAt(event.clientX, event.clientY, cfg.current);
    setState({
      card: held.card,
      left: event.clientX - held.grabX,
      top: event.clientY - held.grabY,
      width: held.width,
      over,
    });

    if (over === 'hand') reorderUnder(event.clientX, event.clientY, held, cfg.current);
  }

  function onUp(event: PointerEvent) {
    const held = live.current;
    if (!held || event.pointerId !== held.pointerId) return;
    const dropped = held.active;
    const over = dropped ? zoneAt(event.clientX, event.clientY, cfg.current) : null;
    const card = held.card;
    if (dropped) swallowUntil.current = now() + SWALLOW_MS;
    stop();
    // The reorder has already happened, card by card, on the way here. Only the
    // throw is left to do.
    if (over === 'discard') cfg.current.onDiscard?.(card);
  }

  return {
    state,
    heldId,
    begin,
    swallowClick: () => now() < swallowUntil.current,
  };
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function inflated(rect: DOMRect | undefined, x: number, y: number, px: number, py: number) {
  if (!rect) return false;
  return (
    x >= rect.left - px && x <= rect.right + px && y >= rect.top - py && y <= rect.bottom + py
  );
}

/**
 * Which drop zone the pointer is in.
 *
 * The pile wins where the two overlap, since it is the smaller target and the
 * deliberate one -- a card let go over the pile was carried there.
 */
function zoneAt(x: number, y: number, cfg: HandDragConfig): DropZone {
  if (cfg.onDiscard) {
    const pile = cfg.discardRef.current?.getBoundingClientRect();
    if (inflated(pile, x, y, PILE_PAD, PILE_PAD)) return 'discard';
  }
  const hand = cfg.handRef.current?.getBoundingClientRect();
  if (inflated(hand, x, y, HAND_PAD_X, HAND_PAD_Y)) return 'hand';
  return null;
}

/**
 * Slide the held card to wherever the pointer now is in the row.
 *
 * Positions come from `offsetLeft`/`offsetTop` rather than
 * `getBoundingClientRect`, which matters: the neighbours are usually mid-slide
 * from the last reorder, and a bounding rect reports where a card has animated
 * to rather than where it belongs. Layout offsets ignore transforms, so the
 * comparison is against the settled row even while it is still moving.
 */
function reorderUnder(
  x: number,
  y: number,
  held: { id: string; lastAt: number },
  cfg: HandDragConfig
) {
  const root = cfg.handRef.current;
  if (!root) return;
  const slots = Array.from(root.querySelectorAll<HTMLElement>('[data-slot]'));
  if (slots.length === 0) return;

  const parent = slots[0].offsetParent as HTMLElement | null;
  const origin = parent?.getBoundingClientRect() ?? root.getBoundingClientRect();
  const px = x - origin.left;
  const py = y - origin.top;

  let index = 0;
  for (const slot of slots) {
    if (slot.dataset.slot === held.id) continue;
    if (isBefore(slot, px, py)) index++;
  }

  const without = cfg.order.filter((id) => id !== held.id);
  if (without.length === cfg.order.length) return; // not in this row at all
  const next = [...without.slice(0, index), held.id, ...without.slice(index)];
  if (next.join(',') === cfg.order.join(',')) return;
  if (Math.abs(x - held.lastAt) < SETTLE) return;

  held.lastAt = x;
  cfg.onReorder(next);
}

/**
 * Whether this card sits before the pointer in reading order.
 *
 * Row-aware, because ten cards wrap onto two rows on a phone and comparing x
 * alone would file a card dragged to the end of the second row into the middle
 * of the first.
 */
function isBefore(slot: HTMLElement, px: number, py: number): boolean {
  if (py < slot.offsetTop) return false;
  if (py > slot.offsetTop + slot.offsetHeight) return true;
  return slot.offsetLeft + slot.offsetWidth / 2 < px;
}
