import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import { type Card, RANK_LABELS, SUIT_LABELS, cardId, cardPoints, describe } from '../gin/cards';
import { C } from './deck/DeckDefs';
import { Pip, SUIT_ACCENT, pipLayout } from './deck/suitArt';

/**
 * A Napoletane card face, built the way the printed deck is: the ace carries
 * its own ornament, two through seven are the suit repeated in a traditional
 * arrangement with no number anywhere on the face, and eight, nine and ten are
 * the Fante, Cavallo and Re.
 *
 * The one deliberate departure is the corner index. A real Neapolitan deck has
 * none -- you count the pips -- which is fine for a trick-taking game but
 * costly in Gin, where every turn means scanning ten cards for runs and the
 * rank of a court card is not something to infer from the hat. It is small, in
 * the suit's own colour, and `showIndex` turns it off for the authentic face.
 */
export function CardFace({
  card,
  onClick,
  dimmed,
  showIndex = true,
  title,
  /** In no meld, so it is costing points right now. */
  dead,
}: {
  card: Card;
  onClick?: () => void;
  dimmed?: boolean;
  showIndex?: boolean;
  title?: string;
  dead?: boolean;
}) {
  const Tag = onClick ? 'button' : 'div';
  const accent = SUIT_ACCENT[card.suit];
  const court = card.rank >= 8;

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`gin-card${dimmed ? ' is-dim' : ''}${onClick ? ' is-clickable' : ''}${
        dead ? ' is-dead' : ''
      }`}
      // --court-accent inherits into the <use> instances below, which is how one
      // Fante symbol dresses itself in four different suits.
      style={{ ['--suit' as string]: accent, ['--court-accent' as string]: accent }}
      onClick={onClick}
      title={title ?? `${describe(card)} — ${cardPoints(card)} points`}
      aria-label={describe(card)}
      data-card={cardId(card)}
    >
      <svg viewBox="0 0 100 150" className="gin-card__face" aria-hidden="true">
        <rect x="0" y="0" width="100" height="150" rx="7" fill={C.cream} />
        {/* The thin inner rule every card in the deck carries. */}
        <rect
          x="4.5"
          y="4.5"
          width="91"
          height="141"
          rx="4.5"
          fill="none"
          stroke={accent}
          strokeOpacity="0.38"
          strokeWidth="1.1"
        />

        {card.rank === 1 && <use href={`#ace-${card.suit}`} width="100" height="150" />}

        {card.rank >= 2 && card.rank <= 7 &&
          pipLayout(card.rank, card.suit).map((p, i) => (
            <Pip key={i} suit={card.suit} x={p.x} y={p.y} scale={p.scale} rotate={p.rotate} />
          ))}

        {court && (
          <>
            <use href={`#court-${COURT[card.rank as 8 | 9 | 10]}`} width="100" height="150" />
            {/* The suit emblem the figure displays, placed per rank so it never
                lands on the face or the horse. */}
            <Pip suit={card.suit} {...EMBLEM[card.rank as 8 | 9 | 10]} />
          </>
        )}

        {showIndex && (
          <text x="8.5" y="18" className="gin-card__index" fill={accent}>
            {shortIndex(card.rank)}
          </text>
        )}
      </svg>

      <span className="gin-card__pts">{cardPoints(card)}</span>
    </Tag>
  );
}

const COURT = { 8: 'fante', 9: 'cavallo', 10: 're' } as const;

/**
 * Where the figure's raised hand is, so the emblem sits IN it rather than
 * parked in a corner. Each is kept clear of the top-left index: the nearest
 * reaches y=32 against an index that ends around y=22.
 */
const EMBLEM = {
  8: { x: 73, y: 48, scale: 0.62 },
  9: { x: 27, y: 48, scale: 0.58 },
  10: { x: 74, y: 56, scale: 0.64 },
} as const;

/**
 * One character, because the corner of a small card has room for one. The
 * courts take their Italian initials -- Fante, Cavallo, Re -- which is what the
 * deck itself calls them, and avoids K and R competing for "King".
 */
function shortIndex(rank: Card['rank']): string {
  if (rank === 8) return 'F';
  if (rank === 9) return 'C';
  if (rank === 10) return 'R';
  return String(rank);
}

/**
 * The meld colours.
 *
 * Six, which is more than a ten-card hand can ever need -- three melds is a
 * strong hand and four is most of it -- but they have to stay distinguishable
 * rather than merely different, because the whole point is telling two glows
 * on one card apart. All light and saturated, since they are read against
 * cream cards on dark green felt, and ordered so that neighbouring melds never
 * get neighbouring hues.
 */
export const MELD_GLOW = [
  '#7ad6a0',
  '#79b8ff',
  '#f0b429',
  '#e59ae8',
  '#ff9a76',
  '#6fded2',
] as const;

export function meldGlow(index: number): string {
  return MELD_GLOW[index % MELD_GLOW.length];
}

/**
 * One position in the hand: a card, plus a glow for every meld it belongs to.
 *
 * Melds are shown AROUND the cards rather than by pulling them out into boxes,
 * which is the whole reason this exists. Boxing means choosing a single
 * partition, and a hand does not have one -- hold the Jack, Horse and King of
 * roots with two more Jacks and the Jack of roots is in a run and in a set at
 * the same time. Any layout that groups cards physically has to break one of
 * those to draw the other. Rings do not: a card in two melds simply wears two
 * of them, and the hand itself stays in plain rank order where it can be read.
 *
 * `data-slot` is the handle the motion code measures against, and it sits here
 * rather than on the card because this is the element that actually moves when
 * the hand reorders.
 */
export function CardSlot({
  id,
  rings = [],
  hidden,
  className,
  badge,
  onPointerDown,
  children,
}: {
  id: string;
  /** One colour per meld this card is in. At most two ever arrive. */
  rings?: string[];
  /** Holding its place in the layout, but not yet shown -- a card in flight. */
  hidden?: boolean;
  className?: string;
  /**
   * A note under the card -- the deadwood it would leave if thrown.
   *
   * It lives out here rather than on the card because the card clips to its own
   * rounded corners, and anything overlapping an edge got sliced in half.
   */
  badge?: ReactNode;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  children: ReactNode;
}) {
  return (
    <span
      className={`gin-slot${hidden ? ' is-airborne' : ''}${className ? ` ${className}` : ''}`}
      data-slot={id}
      data-rings={rings.length}
      onPointerDown={onPointerDown}
    >
      {rings.map((colour, i) => (
        <span
          key={i}
          className="gin-ring"
          data-ring={i}
          style={{ ['--ring' as string]: colour }}
          aria-hidden="true"
        />
      ))}
      {children}
      {badge !== undefined && badge !== null && <span className="gin-slot__note">{badge}</span>}
    </span>
  );
}

export function CardBack({ count }: { count: number }) {
  return (
    <div className="gin-stack" aria-label={`${count} cards`}>
      <div className="gin-card gin-card--back" />
      <span className="gin-stack__count">{count}</span>
    </div>
  );
}

export function suitLabel(suit: Card['suit']): string {
  return SUIT_LABELS[suit];
}

export function rankLabel(rank: Card['rank']): string {
  return RANK_LABELS[rank];
}
