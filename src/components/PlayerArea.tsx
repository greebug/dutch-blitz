import React, { useEffect, useRef, useState } from 'react';
import { CardColor, PlayerState, CardSource } from '../game/types';
import { CardDisplay, CardBack, EmptySlot } from './DraggableCard';

const SLIVER_PX = 12;
const MAX_SLIVERS = 3;
const CORNER_R = 9; // matches --radius on .card

// Solid card colors — used to fill sliver strip backgrounds so they bleed
// behind the card above and cover its transparent rounded-corner gaps.
const CARD_BG: Record<CardColor, string> = {
  red:    '#c62828',
  blue:   '#1565c0',
  green:  '#43a047',
  yellow: '#b07b00',
};

// ── Feature flag ──────────────────────────────────────────────────────────────
// Set to true to re-enable the 3-card deal sequence animation.
const WOOD_DEAL_ANIMATION = false;

interface Props {
  player: PlayerState;
  onDragStart: (e: React.PointerEvent, source: CardSource) => void;
  onDrawWood: () => void;
  dragSource: CardSource | null;
  highlightPostIndex: number | null;
  // When set, the top card of this source is hidden immediately after a local
  // dispatch while we wait for the server to confirm — eliminates snap-back.
  pendingPlay?: { source: CardSource; cardId: string } | null;
}

export function PlayerArea({ player, onDragStart, onDrawWood, dragSource, highlightPostIndex, pendingPlay }: Props) {
  // Deal animation: step 0 = idle, 1–2 = card N flashing face-up
  const [dealStep, setDealStep] = useState(0);
  const prevWoodLenRef = useRef(player.woodActive.length);
  // Track the top card's ID so we can detect a full 3→3 replacement (new cards drawn
  // when active pile was already full — count stays 3 but content changes entirely).
  const prevTopCardIdRef = useRef<string | null>(
    player.woodActive.length > 0 ? player.woodActive[player.woodActive.length - 1].id : null
  );
  const dealTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const curr  = player.woodActive.length;
    const prev  = prevWoodLenRef.current;
    const currTopId = curr > 0 ? player.woodActive[curr - 1].id : null;
    const prevTopId = prevTopCardIdRef.current;

    prevWoodLenRef.current  = curr;
    prevTopCardIdRef.current = currTopId;

    if (!WOOD_DEAL_ANIMATION || curr === 0) return;
    if (curr < prev) return; // card was played — never animate

    // Animate when: count increased (drew to empty/partial pile)
    // OR count stayed same but top card changed (drew with full pile: discard 3, draw 3 new)
    const isDraw = curr > prev || (curr === prev && currTopId !== prevTopId);
    if (!isDraw) return;

    dealTimers.current.forEach(clearTimeout);
    dealTimers.current = [];

    const steps = Math.min(curr, 3);
    setDealStep(1);
    if (steps >= 2) dealTimers.current.push(setTimeout(() => setDealStep(2), 120));
    // Step 0 = normal render — top card stays visible as the final state
    dealTimers.current.push(setTimeout(() => setDealStep(0), 240));

    return () => { dealTimers.current.forEach(clearTimeout); };
  // Depend on the array object (not just .length) so 3→3 replacements are detected
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.woodActive]);

  const blitzTop = player.blitzPile[0] ?? null;
  const woodTop = player.woodActive.length > 0
    ? player.woodActive[player.woodActive.length - 1]
    : null;
  const isBlitzDragging = dragSource?.kind === 'blitz';
  const totalWoodRemaining = player.woodPile.length + player.woodDiscard.length;
  const deckCount = player.woodPile.length; // cards currently in the face-down deck

  // During deal animation: reveal woodActive cards from bottom (index 0) to top.
  // dealStep 1 → woodActive[0], dealStep 2 → woodActive[1]; step 0 = normal.
  const dealCard = WOOD_DEAL_ANIMATION && dealStep > 0
    ? (player.woodActive[Math.min(dealStep - 1, player.woodActive.length - 1)] ?? null)
    : null;

  // Optimistic-hide flags: top card of each source is rendered opacity-0 immediately
  // after dispatch so there's no snap-back while waiting for server confirmation.
  const pendingIsBlitz = !!(pendingPlay?.source.kind === 'blitz' && pendingPlay.cardId === blitzTop?.id);
  const pendingIsWood  = !!(pendingPlay?.source.kind === 'wood'  && pendingPlay.cardId === woodTop?.id);

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

                      if (!isTop) {
                        // Coloured strip — extends CORNER_R px behind the card above so
                        // it shows through that card's transparent rounded-corner gaps.
                        return (
                          <div
                            key={card.id}
                            style={{
                              position: 'absolute',
                              top: yOffset,
                              left: 0,
                              width: 'var(--card-w)',
                              height: `${SLIVER_PX + CORNER_R}px`,
                              background: CARD_BG[card.color],
                              borderRadius: `${CORNER_R}px ${CORNER_R}px 0 0`,
                              zIndex: renderIdx + 1,
                              pointerEvents: 'none',
                            }}
                          />
                        );
                      }

                      const pendingIsThisPost = (() => {
                        if (!pendingPlay) return false;
                        const src = pendingPlay.source;
                        return src.kind === 'post' && src.index === pileIdx && pendingPlay.cardId === pile[0]?.id;
                      })();
                      return (
                        <div
                          key={card.id}
                          style={{
                            position: 'absolute',
                            top: yOffset,
                            left: 0,
                            width: 'var(--card-w)',
                            height: 'var(--card-h)',
                            zIndex: renderIdx + 1,
                          }}
                          data-post-pile-index={String(pileIdx)}
                        >
                          <CardDisplay
                            card={card}
                            dragging={isPostDragging}
                            style={pendingIsThisPost ? { opacity: 0 } : undefined}
                            onPointerDown={e => onDragStart(e, { kind: 'post', index: pileIdx as 0|1|2 })}
                            className={isHighlighted ? 'drop-target-highlight' : ''}
                            data-post-pile-index={String(pileIdx)}
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
                  style={{ position: 'absolute', top: 0, left: 0, opacity: pendingIsBlitz ? 0 : undefined }}
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
                {/* Fan depth shows current face-down deck depth */}
                {deckCount > 2 && (
                  <CardBack style={{ position: 'absolute', top: 0, left: 0, opacity: 0.45 }} />
                )}
                {deckCount > 1 && (
                  <CardBack style={{ position: 'absolute', top: 0, left: 8, opacity: 0.7 }} />
                )}
                {/* Faded when deck empty but discard can still be flipped */}
                <CardBack style={{ position: 'absolute', top: 0, left: 16, opacity: deckCount > 0 ? 1 : 0.4 }} />
                {/* Badge shows face-down deck count → decreases by exactly 3 on each draw */}
                <div className="blitz-count-badge" style={{ top: -8, right: 0 }}>{deckCount}</div>
              </>
            ) : (
              <EmptySlot style={{ position: 'absolute', top: 0, left: 0, width: 'var(--card-w)', height: 'var(--card-h)', borderRadius: 9 }} label="—" />
            )}
          </div>
        </div>

        {/* Wood active pile */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <span className="section-label">Active</span>
          <div style={{ position: 'relative', width: 'var(--card-w)', height: 'var(--card-h)' }}>
            {dealCard ? (
              // Deal animation: flash each drawn card face-up before the final top card
              // dealStep 1 → bottom card (woodActive[0]), badge shows 1
              // dealStep 2 → middle card (woodActive[1]), badge shows 2
              // dealStep 0 → normal render (top card), badge shows actual length
              <>
                <CardDisplay card={dealCard} style={{ position: 'absolute', top: 0, left: 0 }} />
                <div className="pile-count-badge">{dealStep}</div>
              </>
            ) : woodTop ? (
              <>
                {player.woodActive.length > 1 && (
                  <CardBack style={{ position: 'absolute', top: -3, left: 3, opacity: 0.4 }} />
                )}
                <CardDisplay
                  card={woodTop}
                  dragging={dragSource?.kind === 'wood'}
                  style={{ position: 'absolute', top: 0, left: 0, opacity: pendingIsWood ? 0 : undefined }}
                  onPointerDown={e => onDragStart(e, { kind: 'wood' })}
                />
                <div className="pile-count-badge">{player.woodActive.length}</div>
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
