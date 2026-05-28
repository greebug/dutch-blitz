import React from 'react';
import { DutchPile } from '../game/types';

interface Props {
  piles: DutchPile[];
  highlightPileId: string | null;
  showNewPileTarget: boolean;
  highlightDutchSlotIndex: number | null;
}

const COLOR_BG: Record<string, string> = {
  red: '#c62828', blue: '#1565c0', green: '#2e7d32', yellow: '#f9a825',
};
const COLOR_TEXT: Record<string, string> = {
  red: 'white', blue: 'white', green: 'white', yellow: '#111',
};

const TOTAL_SLOTS = 16;

export function CenterPiles({ piles, highlightPileId, showNewPileTarget, highlightDutchSlotIndex }: Props) {
  // Build a fixed 16-slot array; each pile occupies its slot index
  const slots: (DutchPile | null)[] = Array(TOTAL_SLOTS).fill(null);
  for (const pile of piles) {
    if (pile.slot >= 0 && pile.slot < TOTAL_SLOTS) {
      slots[pile.slot] = pile;
    }
  }

  return (
    <div className="dutch-oval-container">
      <div className="dutch-oval-label">Dutch Pile</div>
      <div className="dutch-oval-grid">
        {slots.map((pile, slotIdx) => {
          if (pile) {
            const isHighlighted = highlightPileId === pile.id;
            return (
              // key includes topValue — remounts on each card played, triggering cardPop
              <div
                key={`${pile.id}-${pile.topValue}`}
                className={`dutch-slot occupied ${isHighlighted ? 'dutch-slot-highlight' : ''}`}
                style={{
                  background: COLOR_BG[pile.color],
                  color: COLOR_TEXT[pile.color],
                  borderColor: isHighlighted ? 'white' : 'rgba(255,255,255,0.25)',
                }}
                data-dutch-pile-id={pile.id}
              >
                <span className="dutch-slot-number">{pile.topValue}</span>
              </div>
            );
          } else {
            // Empty slot — glows green when holding a 1; bright white if this specific slot is hovered
            const isSlotHighlighted = showNewPileTarget && highlightDutchSlotIndex === slotIdx;
            const isAvailable = showNewPileTarget && !isSlotHighlighted;
            return (
              <div
                key={`empty-${slotIdx}`}
                className={`dutch-slot ${
                  isSlotHighlighted ? 'dutch-slot-highlight'
                  : isAvailable    ? 'dutch-slot-new-target'
                  : ''
                }`}
                data-dutch-pile-id={showNewPileTarget ? 'new' : undefined}
                data-dutch-slot-index={showNewPileTarget ? String(slotIdx) : undefined}
              />
            );
          }
        })}
      </div>
    </div>
  );
}
