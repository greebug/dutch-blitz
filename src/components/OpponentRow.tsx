import React from 'react';
import { PlayerState, Card } from '../game/types';
import { CheckIcon } from './icons';

interface Props {
  player: PlayerState;
  variant: 'sidebar' | 'top';
}

function MiniCard({ card, size = 26 }: { card: Card | null; size?: number }) {
  const h = Math.round(size * 1.38);
  if (!card) {
    return (
      <div
        className="opp-mini-card mini-empty"
        style={{ width: size, height: h }}
      />
    );
  }
  return (
    <div
      className={`opp-mini-card card-${card.color}`}
      style={{ width: size, height: h }}
    >
      {card.number}
    </div>
  );
}

export function OpponentDisplay({ player, variant }: Props) {
  const postTops = player.postPiles.map(p => p[0] ?? null);
  const blitzTop = player.blitzPile[0] ?? null;
  const blitzCount = player.blitzPile.length;
  const woodTop = player.woodActive.length > 0
    ? player.woodActive[player.woodActive.length - 1]
    : null;

  if (variant === 'top') {
    return (
      <div className="opp-top-strip" data-opp-id={player.id}>
        <div className="opp-top-name">{player.name}</div>
        {/* Blitz — face-up top card with count badge */}
        <div className="opp-top-blitz">
          {blitzCount > 0 ? (
            <div style={{ position: 'relative' }}>
              <MiniCard card={blitzTop} size={26} />
              <div className="opp-blitz-badge">{blitzCount}</div>
            </div>
          ) : (
            <div className="opp-blitz-empty" style={{ width: 26, height: 36 }}><CheckIcon size={13} /></div>
          )}
        </div>
        {/* Wood active top */}
        <MiniCard card={woodTop} size={26} />
        {/* Post pile tops */}
        <div className="opp-top-posts">
          {postTops.map((card, i) => <MiniCard key={i} card={card} size={26} />)}
        </div>
        <span className="opp-top-score">{player.totalScore} pts</span>
        {player.botDifficulty && (
          <span className="opp-top-diff">{player.botDifficulty}</span>
        )}
      </div>
    );
  }

  // sidebar variant — flat flex-wrap grid:
  //   phone  (68px grid, gap 4px): [post1][post2] / [post3][wood] / [blitz]  = 2-2-1
  //   tablet (100px grid, gap 2px): [post1][post2][post3] / [wood][blitz]    = 3-2
  return (
    <div className="opp-sidebar" data-opp-id={player.id}>
      <div className="opp-sidebar-name">{player.name}</div>
      <div className="opp-sidebar-grid">
        {postTops.map((card, i) => <MiniCard key={i} card={card} size={32} />)}
        <MiniCard card={woodTop} size={32} />
        <div className="opp-sidebar-blitz">
          {blitzCount > 0 ? (
            <>
              <MiniCard card={blitzTop} size={32} />
              <div className="opp-blitz-badge">{blitzCount}</div>
            </>
          ) : (
            <div className="opp-blitz-empty" style={{ width: 32, height: 44 }}><CheckIcon size={16} /></div>
          )}
        </div>
      </div>
      <div className="opp-sidebar-score">{player.totalScore}</div>
      {player.botDifficulty && (
        <div className="opp-sidebar-diff">{player.botDifficulty}</div>
      )}
    </div>
  );
}

// Keep old export name for any remaining references
export { OpponentDisplay as OpponentCard };
