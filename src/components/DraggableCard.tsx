import React from 'react';
import { Card, CardColor } from '../game/types';
import { BarnStar, BoyIcon, GirlIcon } from './icons';

function isBoyColor(color: CardColor) {
  return color === 'red' || color === 'blue';
}

interface CardDisplayProps {
  card: Card;
  size?: 'normal' | 'small' | 'ghost';
  className?: string;
  style?: React.CSSProperties;
  onPointerDown?: (e: React.PointerEvent, card: Card) => void;
  dragging?: boolean;
  'data-dutch-pile-id'?: string;
  'data-post-pile-index'?: string;
  'data-drop-target'?: string;
}

export function CardDisplay({
  card,
  size = 'normal',
  className = '',
  style,
  onPointerDown,
  dragging,
  ...rest
}: CardDisplayProps) {
  const isSmall = size === 'small';
  const isGhost = size === 'ghost';
  const boy = isBoyColor(card.color);
  // The icons are square now (the old ones were 1:1.45 standing figures), so
  // the small size can go up a little without crowding the corner.
  const iconSize = isSmall ? 15 : 28;

  const sizeStyle: React.CSSProperties = isSmall
    ? { width: 34, height: 48, borderRadius: 6 }
    : {};

  // Ghost cards must not override the CSS position:fixed from .ghost-card class
  const posStyle: React.CSSProperties = isGhost ? {} : { position: 'relative' };

  return (
    <div
      className={`card card-${card.color} ${dragging ? 'dragging' : ''} ${className}`}
      style={{ ...posStyle, overflow: 'hidden', ...sizeStyle, ...style }}
      onPointerDown={onPointerDown ? e => onPointerDown(e, card) : undefined}
      {...rest}
    >
      {/* Top-left: number */}
      <div className="card-corner tl">
        <span className="corner-number">{card.number}</span>
      </div>

      {/* Top-right: boy/girl icon */}
      <div className="card-corner tr">
        {boy ? <BoyIcon size={iconSize} /> : <GirlIcon size={iconSize} />}
      </div>

      {/* Bottom-left: icon rotated 180° */}
      <div className="card-corner bl">
        {boy ? <BoyIcon size={iconSize} /> : <GirlIcon size={iconSize} />}
      </div>

      {/* Bottom-right: number rotated 180° */}
      <div className="card-corner br">
        <span className="corner-number">{card.number}</span>
      </div>
    </div>
  );
}

export function CardBack({
  size = 'normal',
  style,
}: {
  size?: 'normal' | 'small';
  style?: React.CSSProperties;
}) {
  const sizeStyle: React.CSSProperties =
    size === 'small' ? { width: 34, height: 48, borderRadius: 6 } : {};
  return (
    <div className="card card-back" style={{ position: 'relative', ...sizeStyle, ...style }}>
      {/* A barn star, the way a real deck has a design on its back rather than
          a blank rectangle. */}
      <BarnStar size={size === 'small' ? 20 : 38} className="card-back-star" />
    </div>
  );
}

export function EmptySlot({
  style,
  className = '',
  label,
  'data-drop-target': dropTarget,
  'data-post-pile-index': postIdx,
}: {
  style?: React.CSSProperties;
  className?: string;
  label?: string;
  'data-drop-target'?: string;
  'data-post-pile-index'?: string;
}) {
  return (
    <div
      className={`card card-empty ${className}`}
      style={{ position: 'relative', ...style }}
      data-drop-target={dropTarget}
      data-post-pile-index={postIdx}
    >
      {label}
    </div>
  );
}
