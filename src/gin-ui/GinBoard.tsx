import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { type Card, cardId } from '../gin/cards';
import { allMelds } from '../gin/melds';
import { arrangeBy, meldOrderKeys, reconcileOrder, sortHand } from '../gin/order';
import { isBigGin, knockOptions } from '../gin/rules';
import type { GinView } from '../gin/game';
import { CardBack, CardFace, CardSlot, meldGlow } from './CardFace';
import { FlightLayer } from './FlightLayer';
import { GinBurst, burstWord } from './GinBurst';
import { useHandDrag } from './drag';
import {
  type Anchor,
  DRAG_SLIDE_MS,
  SLIDE_MS,
  detectFlights,
  pileIsFaceDown,
  useFlights,
  useHandFlip,
  useRectBook,
} from './motion';

/**
 * The table itself: piles, hand, and the moves available right now.
 *
 * Everything it draws comes out of a single `GinView` and nothing else, which
 * is what lets solo and online share it. Solo builds that view locally from a
 * `GinState` sitting in the same process; online receives the identical object
 * over a socket, already redacted by the server. The board cannot tell the
 * difference, and more to the point it cannot reach past the view to the stock
 * order or the opponent's cards, because in the online case they are not in the
 * browser at all.
 *
 * Legality is derived here from the view rather than from `legalActions`, which
 * needs the full state. The two agree by construction: a draw needs a non-empty
 * pile, and the knock options come from your own hand, which you are holding.
 */
export interface GinBoardProps {
  view: GinView;
  /** Omit a handler to grey out that move -- used while it is not your turn. */
  onDrawStock?: () => void;
  onTakeDiscard?: () => void;
  onDiscard?: (card: Card) => void;
  onKnock?: (discard: Card) => void;
  onBigGin?: () => void;
  opponentLabel: string;
  /** A line under the opponent's cards: "thinking…", "reconnecting…". */
  opponentNote?: string | null;
  /**
   * True while a card is crossing the table.
   *
   * Solo play uses it to hold the bot back: without it the bot's draw is timed
   * from the state change rather than from what the player can see, so its
   * discard sets off while its draw is still in the air and the two halves of
   * its turn arrive as one.
   */
  onBusyChange?: (busy: boolean) => void;
  /** Off screen while the showdown or the review stands in its place. */
  away?: boolean;
}

export default function GinBoard({
  away = false,
  view,
  onDrawStock,
  onTakeDiscard,
  onDiscard,
  onKnock,
  onBigGin,
  opponentLabel,
  opponentNote,
  onBusyChange,
}: GinBoardProps) {
  const over = view.phase === 'over';

  const stockRef = useRef<HTMLDivElement>(null);
  const discardRef = useRef<HTMLDivElement>(null);
  const opponentRef = useRef<HTMLDivElement>(null);
  const handRef = useRef<HTMLDivElement>(null);

  // --- The hand, in reading order with every meld it contains marked ---------

  /**
   * The player's own arrangement, or null while they are happy with the rule.
   *
   * Stored rather than derived, and stored as the arrangement they last set
   * rather than the row on screen: cards arrive and leave underneath it every
   * turn, and `reconcileOrder` is what files each new one by rule without
   * disturbing anything they have placed by hand.
   */
  const [arrangement, setArrangement] = useState<string[] | null>(null);

  /**
   * The melds this hand has produced, oldest first.
   *
   * Kept rather than derived, because the order melds were finished in is not
   * recoverable from the cards: a hand holding a run and a set says nothing
   * about which came together first. Updated here in the render that notices
   * the hand changed rather than in an effect, which matters -- an effect
   * would leave one render ordered by the old record, and the flight bringing
   * the new card in would measure the row mid-rearrangement.
   */
  const handPrint = useMemo(() => view.hand.map(cardId).sort().join(','), [view.hand]);
  const completed = useRef<{ of: string; keys: string[] }>({ of: '', keys: [] });
  if (completed.current.of !== handPrint) {
    const names = meldOrderKeys(view.hand);
    const keys = completed.current.keys.filter((k) => names.includes(k));
    // Several arriving at once -- a hand dealt with melds already in it -- go
    // in highest first, so that the row still reads upwards. One finished
    // later goes on the end, which puts it leftmost and leaves the rest alone.
    for (const name of [...names].reverse()) if (!keys.includes(name)) keys.push(name);
    completed.current = { of: handPrint, keys };
  }

  const order = useMemo(
    () =>
      arrangement
        ? reconcileOrder(arrangement, view.hand, completed.current.keys)
        : sortHand(view.hand, completed.current.keys).map(cardId),
    [arrangement, view.hand]
  );
  const hand = useMemo(() => arrangeBy(order, view.hand), [order, view.hand]);
  const melds = useMemo(() => allMelds(view.hand), [view.hand]);

  /**
   * Which colours each card wears. A card in a run and a set gets both, which
   * is why this is a list per card and not one colour.
   */
  const rings = useMemo(() => {
    const map = new Map<string, string[]>();
    melds.forEach((meld, i) => {
      for (const card of meld.cards) {
        const id = cardId(card);
        const list = map.get(id);
        if (list) list.push(meldGlow(i));
        else map.set(id, [meldGlow(i)]);
      }
    });
    return map;
  }, [melds]);

  /**
   * Cards earning nothing in the engine's best arrangement.
   *
   * Worth marking separately from the glows, because the two can disagree and
   * the disagreement is real rather than a bug. Holding the 5 of roots, suns
   * and swords with the 6 and 7 of roots, the three 5s genuinely are a set and
   * glow as one -- but the cheapest arrangement uses the roots run instead, so
   * the other two 5s are deadwood all the same. Showing only the glows would
   * claim a hand better than it is; showing only the arrangement would hide a
   * set the player may want to build on.
   */
  const dead = useMemo(() => new Set(view.deadwood.map(cardId)), [view.deadwood]);

  // --- Cards in motion -------------------------------------------------------

  const flights = useFlights();
  const book = useRectBook();
  const handKey = useMemo(() => hand.map(cardId).join(','), [hand]);

  /**
   * The word that bursts when a hand ends.
   *
   * Fired on the EDGE into 'over' rather than on the state of being over,
   * which matters online: the same finished view arrives again on every
   * reconnect, and a burst keyed on `phase === 'over'` would go off each time.
   * One transition, one burst.
   */
  const [burst, setBurst] = useState<{
    id: number;
    word: string;
    side: 'mine' | 'theirs' | 'nobody';
  } | null>(null);
  const bursts = useRef(0);

  const previous = useRef<GinView | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = view;
    if (!before) return;
    flights.enqueue(detectFlights(before, view));

    if (view.stockCount > before.stockCount) {
      // A fresh deal. The arrangement has to go with the hand it described --
      // the deck is forty cards and ids come round again, so an arrangement
      // kept across a deal pins whichever cards happen to recur into last
      // hand's positions, and the new hand comes out shuffled.
      setArrangement(null);
    } else {
      // And a card that has been thrown stops being arranged, so that picking
      // it back off the pile files it by rule rather than returning it to a
      // slot it held several turns ago.
      const held = new Set(view.hand.map(cardId));
      setArrangement((a) => (a && a.some((id) => !held.has(id)) ? a.filter((id) => held.has(id)) : a));
    }
    if (before.phase !== 'over' && view.phase === 'over' && view.score) {
      const word = burstWord(view.score.outcome);
      if (word) {
        bursts.current += 1;
        setBurst({
          id: bursts.current,
          word,
          // A push has no knocker, and belongs to neither side of the screen.
          side:
            view.knocker === null ? 'nobody' : view.knocker === view.seat ? 'mine' : 'theirs',
        });
      }
    }
    // `flights.enqueue` is stable; `view` is the real trigger.
  }, [view, flights.enqueue]);

  useEffect(() => {
    onBusyChange?.(flights.busy);
  }, [flights.busy, onBusyChange]);

  const rectOf = useCallback(
    (anchor: Anchor): DOMRect | null => {
      if (anchor.at === 'stock') return stockRef.current?.getBoundingClientRect() ?? null;
      if (anchor.at === 'discard') return discardRef.current?.getBoundingClientRect() ?? null;
      if (anchor.at === 'opponent') return opponentRef.current?.getBoundingClientRect() ?? null;
      const live = handRef.current?.querySelector<HTMLElement>(`[data-slot="${anchor.card}"]`);
      if (live) return live.getBoundingClientRect();
      // Already gone from the DOM -- a card that has just been thrown. The last
      // place it was seen is the only honest place to launch it from.
      return book.current.get(anchor.card) ?? null;
    },
    [book]
  );

  // --- What is available right now -------------------------------------------

  // Nothing is clickable mid-flight. Partly to stop a second move landing
  // before the first has finished being shown, partly because a click on a
  // card that is about to slide somewhere else is a click on the wrong card.
  const settled = !flights.busy;
  const myMove = view.yourTurn && !over && settled;
  const canDrawStock = myMove && view.phase === 'draw' && view.stockCount > 0 && !!onDrawStock;
  const canTakeDiscard = myMove && view.phase === 'draw' && !!view.discardTop && !!onTakeDiscard;
  const throwing = myMove && view.phase === 'discard';

  // What each card would leave behind if thrown -- the number that actually
  // drives the decision, shown on the card rather than left to be worked out.
  const throwTable = useMemo(() => {
    if (!throwing) return null;
    const map = new Map<string, { deadwood: number; legal: boolean }>();
    for (const o of knockOptions(view.hand, view.rules)) {
      map.set(cardId(o.discard), { deadwood: o.deadwoodPoints, legal: o.legal });
    }
    return map;
  }, [throwing, view.hand, view.rules]);

  const bestKnock = useMemo(() => {
    if (!throwing) return null;
    return knockOptions(view.hand, view.rules).find((o) => o.legal) ?? null;
  }, [throwing, view.hand, view.rules]);

  /** The lowest number on the table, so the cheapest throw is visible as one. */
  const bestThrow = useMemo(() => {
    if (!throwTable || throwTable.size === 0) return null;
    return Math.min(...[...throwTable.values()].map((t) => t.deadwood));
  }, [throwTable]);

  const bigGin = throwing && isBigGin(view.hand, view.rules);
  const discardHandler = throwing && onDiscard ? onDiscard : undefined;

  // --- Picking a card up -----------------------------------------------------

  // Rearranging is allowed whenever the hand is yours to hold, turn or no turn:
  // sorting your cards while the other player thinks is half of what a hand is
  // for. Throwing by drag is only offered when a throw is actually legal.
  const drag = useHandDrag({
    handRef,
    discardRef,
    order,
    onReorder: setArrangement,
    onDiscard: discardHandler,
    enabled: !over && settled,
  });

  // Measured after the drag hook, and told about it: a row rearranging under
  // a held card has to settle quickly, where the same movement once a turn
  // wants to be seen.
  useHandFlip(handRef, book, handKey, true, drag.heldId ? DRAG_SLIDE_MS : SLIDE_MS);

  // A pointerup is followed by a click, and the card is a button whose click
  // throws it. Letting go of a card you were only moving must not throw it.
  const throwCard = useCallback(
    (card: Card) => {
      if (drag.swallowClick()) return;
      discardHandler?.(card);
    },
    [drag, discardHandler]
  );

  // The discard pile keeps showing the card underneath while a new one is still
  // visibly on its way, so the pile is never two cards at once.
  const discardHeld = flights.pending.has('discard');
  const discardShown = discardHeld ? flights.pending.get('discard') ?? null : view.discardTop;
  // Once the knocking card has landed, the top of the pile is face down and
  // stays that way -- it is the one discard nobody may take.
  const pileDown = !discardHeld && pileIsFaceDown(view);
  const dropping = drag.state?.over === 'discard';

  return (
    // Hidden rather than unmounted while the showdown or the review has the
    // screen: the board's memory of the last view is what tells the next deal
    // apart from a draw, and a remount would forget it.
    <div className={`gin-board${away ? ' is-away' : ''}`} aria-hidden={away || undefined}>
      {/* The opponent and the two piles share one band. On a phone that is
          what keeps the whole of an eleven-card hand on the screen. */}
      <div className="gin-field">
      <section className="gin-opponent">
        <div ref={opponentRef}>
          <CardBack count={view.opponentCardCount} />
        </div>
        <span className="gin-opponent__label">
          {opponentLabel}
          {opponentNote ? <span className="gin-opponent__note">{opponentNote}</span> : null}
        </span>
      </section>

      <section className="gin-table">
        <div className="gin-pile">
          <button
            type="button"
            className="gin-pilebtn"
            disabled={!canDrawStock}
            onClick={onDrawStock}
          >
            <div ref={stockRef}>
              <CardBack count={view.stockCount} />
            </div>
            <span>Draw</span>
          </button>
          <p className="gin-pile__note">{view.stockCount} left</p>
        </div>

        <div className={`gin-pile${dropping ? ' is-drop' : ''}`}>
          {pileDown ? (
            <div ref={discardRef} className="gin-card gin-card--back" title="the knocking card" />
          ) : discardShown ? (
            <button
              type="button"
              className="gin-pilebtn"
              disabled={!canTakeDiscard}
              onClick={onTakeDiscard}
            >
              <div ref={discardRef}>
                <CardFace card={discardShown} />
              </div>
              <span>Take</span>
            </button>
          ) : (
            <div ref={discardRef} className="gin-card gin-card--empty" />
          )}
          <p className="gin-pile__note">{dropping ? 'Let go to throw' : 'Discard'}</p>
        </div>
      </section>
      </div>

      {/* Said out loud as well as shown, because the flight is the only thing
          that distinguishes a stock draw from a discard draw and a player who
          blinked deserves to be told which it was. */}
      <p className={`gin-flightnote${flights.active?.label ? ' is-on' : ''}`} role="status">
        {flights.active?.label ?? ''}
      </p>

      <section className="gin-handwrap">
        <div className="gin-handmeta">
          <span
            className={`gin-dead${
              view.deadwoodPoints <= view.rules.knockMaxDeadwood ? ' is-ok' : ''
            }`}
          >
            Deadwood <strong>{view.deadwoodPoints}</strong>
          </span>
          {melds.length > 0 && (
            <span
              className="gin-meldcount"
              title="Every set and run in your hand glows, each its own colour. A card in two of them wears both rings. Cards with a red underline are in none, and are what the deadwood number is counting."
            >
              {meldTally(melds)}
            </span>
          )}
          {!over &&
            (arrangement ? (
              // Once a card has been dragged the row is the player's, and
              // stays theirs -- so a set finished three turns later is left
              // wherever its cards happen to be. This is the way back to the
              // automatic arrangement without having to drag it there.
              <button type="button" className="gin-tidy" onClick={() => setArrangement(null)}>
                Re-sort
              </button>
            ) : (
              <span className="gin-arrange">drag a card to move it</span>
            ))}
          {myMove && view.phase === 'draw' && <span className="gin-hint">Draw a card</span>}
          {throwing && <span className="gin-hint">Click a card, or drag it to the pile</span>}
        </div>

        {/* One row, in rank order, melds marked by glow rather than by being
            pulled out of it -- see `CardSlot`. */}
        <div className="gin-hand" ref={handRef}>
          {hand.map((card) => {
            const id = cardId(card);
            const ifThrown = throwTable?.get(id)?.deadwood;
            const held = drag.heldId === id;
            return (
              <CardSlot
                key={id}
                id={id}
                rings={rings.get(id)}
                hidden={held || flights.pending.has(`hand:${id}`)}
                className={`${held ? 'is-held' : ''}${
                  ifThrown !== undefined && ifThrown === bestThrow ? ' is-cheapest' : ''
                }`.trim()}
                badge={ifThrown}
                onPointerDown={(event) => drag.begin(event, card)}
              >
                <CardFace
                  card={card}
                  dead={dead.has(id)}
                  onClick={discardHandler ? () => throwCard(card) : undefined}
                />
              </CardSlot>
            );
          })}
        </div>

        <div className="gin-actions">
          {bigGin && onBigGin && (
            <button type="button" className="gin-btn gin-btn--gold" onClick={onBigGin}>
              Big Gin — all eleven meld
            </button>
          )}
          {bestKnock && onKnock && (
            <button
              type="button"
              className="gin-btn gin-btn--go"
              onClick={() => onKnock(bestKnock.discard)}
            >
              Knock{bestKnock.deadwoodPoints === 0 ? ' — gin!' : ` at ${bestKnock.deadwoodPoints}`}
            </button>
          )}
        </div>
      </section>

      <FlightLayer flight={flights.active} rectOf={rectOf} onLanded={flights.landed} />

      {/* The card in your hand, following it. Fixed to the viewport for the
          same reason a flight is: it has to be able to leave the row. */}
      {drag.state && (
        <div className="gin-draglayer" aria-hidden="true">
          <div
            className={`gin-drag${drag.state.over === 'discard' ? ' is-over' : ''}`}
            style={{
              left: drag.state.left,
              top: drag.state.top,
              ['--card-w' as string]: `${drag.state.width}px`,
            }}
          >
            <CardFace card={drag.state.card} />
          </div>
        </div>
      )}

      {/* Portalled out, because the board steps aside for the showdown the
          moment the hand ends, and the word has to outlive it. */}
      {burst &&
        createPortal(
          <GinBurst key={burst.id} word={burst.word} tone={burst.side} onDone={() => setBurst(null)} />,
          document.body
        )}
    </div>
  );
}

/**
 * "1 set", "2 runs", "1 set · 2 runs".
 *
 * Counted by kind rather than totalled, because "3 melds" is a word the game
 * uses and a player may not, and because which kind they are is the more
 * useful half: a set is finished at four, a run can keep growing at both ends.
 */
function meldTally(melds: readonly { kind: 'set' | 'run' }[]): string {
  const sets = melds.filter((m) => m.kind === 'set').length;
  const runs = melds.length - sets;
  const parts: string[] = [];
  if (sets) parts.push(`${sets} set${sets === 1 ? '' : 's'}`);
  if (runs) parts.push(`${runs} run${runs === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** Shared by both modes so a hand reads the same however it was played. */
export function resultHeadline(
  outcome: string,
  winner: 'knocker' | 'defender' | null,
  knocker: number | null,
  mySeat: number,
  opponentName: string
): string {
  if (winner === null) return 'Dead hand';
  const winnerSeat = winner === 'knocker' ? knocker : knocker === 0 ? 1 : 0;
  const mine = winnerSeat === mySeat;
  const who = mine ? 'You' : opponentName;
  switch (outcome) {
    case 'big-gin':
      return `${who} went big gin`;
    case 'gin':
      return `${who} went gin`;
    case 'undercut':
      return `${who} undercut the knock`;
    default:
      return `${who} ${mine ? 'take' : 'takes'} the hand`;
  }
}
