import React, { useEffect, useRef, useState } from 'react';
import { PlayerState, CardSource } from '../game/types';
import { CardDisplay, CardBack, EmptySlot } from './DraggableCard';

const SLIVER_PX = 12;
const MAX_SLIVERS = 3;

interface Props {
  player: PlayerState;
  onDragStart: (e: React.PointerEvent, source: CardSource) => void;
  onDrawWood: () => void;
  dragSource: CardSource | null;
  highlightPostIndex: number | null;
}

export function PlayerArea({ player, onDragStart, onDrawWood, dragSource, highlightPostIndex }: Props) {
  // Animate the wood active pile whenever a new set of cards is dealt
  const [isDealing, setIsDealing] = useState(false);
  const prevWoodActiveLenRef = useRef(player.woodActive.length);
  useEffect(() => {
    const prev = prevWoodActiveLenRef.current;
    const curr = player.woodActive.length;
    if (curr > 0 && curr !== prev) {
      setIsDealing(true);
      const t = setTimeout(() => setIsDealing(false), 380);
      prevWoodActiveLenRef.current = curr;
      return () => clearTimeout(t);
    }
    prevWoodActiveLenRef.current = curr;
  }, [player.woodActive.length]);

  const blitzTop = player.blitzPile[0] ?? null;
  const woodTop = player.woodActive.length > 0
    ? player.woodActive[player.woodActive.length - 1]
    : null;
  const isBlitzDragging = dragSource?.kind === 'blitz';
  const totalWoodRemaining = player.woodPile.length + player.woodDiscard.length;

  return (
    <div className="player-strip">

      {/* ── Tier 1: Post piles grow downward, Blitz at far right ── */}
      <div className="strip-tier1">
        <div className="strip-posts">
          {player.postPiles.map((pile, pileIdx) => {
            const isPostDragging = dragSource?.kind === 'post' && dragSource.index === pileIdx;
            const isHighlighted = highlightPostIndex === pileIdx;

            // Oldest card sits at top (y=0); each newer card is SLIVER_PX lower.
            // Top card (playable) is at the bottom of the stack — pile grows downward.
            const sliversAbove = Math.min(pile.length - 1, MAX_SLIVERS);
            const containerH = pile.length === 0
              ? 'var(--card-h)'
              : `calc(var(--card-h) + ${sliversAbove * SLIVER_PX}px)`;

            const cardsToRender = pile.slice(0, sliversAbove + 1).reverse();

            return (
              <div key={pileIdx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <span className="section-label">Post {pileIdx + 1}</span>
                <div
                  style={{ position: 'relative', width: 'var(--card-w)', height: containerH }}
                  data-post-pile-index={String(pileIdx)}
                >
                  {pile.length === 0 ? (
                    <EmptySlot
                      data-post-pile-index={String(pileIdx)}
                      style={{ position: 'absolute', top: 0, width: 'var(--card-w)', height: 'var(--card-h)', borderRadius: 9 }}
                      className={isHighlighted ? 'drop-target-highlight' : ''}
                    />
                  ) : (
                    cardsToRender.map((card, renderIdx) => {
                      const isTop = renderIdx === cardsToRender.length - 1;
                      const yOffset = renderIdx * SLIVER_PX;

                      return (
                        <div
                          key={card.id}
                          style={{
                            position: 'absolute',
                            top: yOffset,
                            left: 0,
                            width: 'var(--card-w)',
                            // Non-top cards clipped to a thin sliver; top card shows fully
                            height: isTop ? 'var(--card-h)' : `${SLIVER_PX}px`,
                            overflow: 'hidden',
                            zIndex: renderIdx + 1,
                          }}
                          data-post-pile-index={String(pileIdx)}
                        >
                          <CardDisplay
                            card={card}
                            dragging={isTop && isPostDragging}
                            onPointerDown={
                              isTop
                                ? e => onDragStart(e, { kind: 'post', index: pileIdx as 0|1|2 })
                                : undefined
                            }
                            className={isTop && isHighlighted ? 'drop-target-highlight' : ''}
                            data-post-pile-index={String(pileIdx)}
                            style={{ pointerEvents: isTop ? undefined : 'none' }}
                          />
                        </div>
                      );
                    })
                  )}
                  {pile.length > MAX_SLIVERS + 1 && (
                    <div className="pile-count-badge" style={{ zIndex: 20 }}>{pile.length}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Blitz pile — margin-left: auto from CSS pushes it to the right */}
        <div className="strip-blitz">
          <span className="section-label">Blitz</span>
          <div style={{ position: 'relative', width: 'var(--card-w)', height: 'var(--card-h)' }}>
            {blitzTop ? (
              <>
                {player.blitzPile.length > 2 && (
                  <CardBack style={{ position: 'absolute', top: -4, left: 4, opacity: 0.3 }} />
                )}
                {player.blitzPile.length > 1 && (
                  <CardBack style={{ position: 'absolute', top: -2, left: 2, opacity: 0.55 }} />
                )}
                <CardDisplay
                  card={blitzTop}
                  dragging={isBlitzDragging}
                  style={{ position: 'absolute', top: 0, left: 0 }}
                  onPointerDown={e => onDragStart(e, { kind: 'blitz' })}
                />
                <div className="blitz-count-badge">{player.blitzPile.length}</div>
              </>
            ) : (
              <div
                style={{
                  width: 'var(--card-w)', height: 'var(--card-h)', borderRadius: 9,
                  border: '2px dashed #66bb6a',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 26, color: '#66bb6a',
                }}
              >
                ✓
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Tier 2: Wood deck fan + Wood active (below both posts and blitz) ── */}
      <div className="strip-tier2">
        {/* Wood draw deck — fan of card backs, tap to draw */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <span className="section-label">Wood</span>
          <div
            style={{ position: 'relative', width: 'calc(var(--card-w) + 16px)', height: 'var(--card-h)', flexShrink: 0, cursor: 'pointer' }}
            onPointerUp={onDrawWood}
          >
            {totalWoodRemaining > 0 ? (
              <>
                {totalWoodRemaining > 2 && (
                  <CardBack style={{ position: 'absolute', top: 0, left: 0, opacity: 0.45 }} />
                )}
                {totalWoodRemaining > 1 && (
                  <CardBack style={{ position: 'absolute', top: 0, left: 8, opacity: 0.7 }} />
                )}
                <CardBack style={{ position: 'absolute', top: 0, left: 16 }} />
                <div className="blitz-count-badge" style={{ top: -8, right: 0 }}>{totalWoodRemaining}</div>
              </>
            ) : (
              <EmptySlot style={{ position: 'absolute', top: 0, left: 0, width: 'var(--card-w)', height: 'var(--card-h)', borderRadius: 9 }} label="—" />
            )}
          </div>
        </div>

        {/* Wood active pile */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <span className="section-label">Active</span>
          <div
            style={{ position: 'relative', width: 'var(--card-w)', height: 'var(--card-h)' }}
            className={isDealing ? 'wood-deal-animate' : ''}
          >
            {woodTop ? (
              <>
                {player.woodActive.length > 1 && (
                  <CardBack style={{ position: 'absolute', top: -3, left: 3, opacity: 0.4 }} />
                )}
                <CardDisplay
                  card={woodTop}
                  dragging={dragSource?.kind === 'wood'}
                  style={{ position: 'absolute', top: 0, left: 0 }}
                  onPointerDown={e => onDragStart(e, { kind: 'wood' })}
                />
                {player.woodActive.length > 1 && (
                  <div className="pile-count-badge">{player.woodActive.length}</div>
                )}
              </>
            ) : (
              <EmptySlot style={{ opacity: 0.3, width: 'var(--card-w)', height: 'var(--card-h)', borderRadius: 9 }} label="—" />
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
