import React from 'react';
import { Card, CardColor } from '../game/types';

function isBoyColor(color: CardColor) {
  return color === 'red' || color === 'blue';
}

// Male bathroom-sign icon
function BoyIcon({ size }: { size: number }) {
  const h = Math.round(size * 1.45);
  return (
    <svg width={size} height={h} viewBox="0 0 40 58" fill="currentColor">
      {/* Head */}
      <circle cx="20" cy="8" r="8" />
      {/* Neck */}
      <rect x="17" y="16" width="6" height="4" />
      {/* Torso */}
      <rect x="13" y="20" width="14" height="13" rx="2" />
      {/* Left arm */}
      <rect x="2" y="21" width="11" height="5" rx="2.5" transform="rotate(-12 7 23)" />
      {/* Right arm */}
      <rect x="27" y="21" width="11" height="5" rx="2.5" transform="rotate(12 33 23)" />
      {/* Left leg */}
      <rect x="13" y="31" width="6" height="19" rx="3" />
      {/* Right leg */}
      <rect x="21" y="31" width="6" height="19" rx="3" />
    </svg>
  );
}

// Female bathroom-sign icon
function GirlIcon({ size }: { size: number }) {
  const h = Math.round(size * 1.45);
  return (
    <svg width={size} height={h} viewBox="0 0 40 58" fill="currentColor">
      {/* Head */}
      <circle cx="20" cy="8" r="8" />
      {/* Bodice */}
      <rect x="16" y="16" width="8" height="6" rx="1" />
      {/* Dress — wide triangle */}
      <polygon points="5,57 35,57 28,20 12,20" />
      {/* Left arm */}
      <rect x="2" y="22" width="10" height="5" rx="2.5" transform="rotate(-12 7 24)" />
      {/* Right arm */}
      <rect x="28" y="22" width="10" height="5" rx="2.5" transform="rotate(12 33 24)" />
    </svg>
  );
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
  const iconSize = isSmall ? 13 : 26;

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
  return <div className="card card-back" style={{ position: 'relative', ...sizeStyle, ...style }} />;
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
