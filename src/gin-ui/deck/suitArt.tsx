import type { Rank, Suit } from '../../gin/cards';
import { C } from './DeckDefs';

/**
 * Where the artwork goes. The artwork itself lives in DeckDefs as <symbol>s;
 * this module only places instances of it.
 */

/** Per-suit accent: the corner index, the inner rule, and court costume. */
export const SUIT_ACCENT: Record<Suit, string> = {
  su: C.goldDeep, // suns / denari
  go: C.red, // goblets / coppe
  ro: C.green, // roots / bastoni
  sw: C.steelDeep, // swords / spade
};

/** Round suits stack in grids; long suits stand upright and cross. */
export const IS_LONG_SUIT: Record<Suit, boolean> = {
  su: false,
  go: false,
  ro: true,
  sw: true,
};

export function Pip({ suit, x, y, scale, rotate = 0 }: {
  suit: Suit;
  x: number;
  y: number;
  scale: number;
  rotate?: number;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale}) translate(-20 -20)`}>
      <use href={`#pip-${suit}`} width="40" height="40" />
    </g>
  );
}

export interface Placement {
  x: number;
  y: number;
  scale: number;
  rotate?: number;
}

/**
 * Pip arrangements by rank.
 *
 * Round suits fall into the familiar grids. Long suits are wider objects and
 * need their own arrangements, which live in longLayout below.
 */
export function pipLayout(rank: Rank, suit: Suit): Placement[] {
  if (IS_LONG_SUIT[suit]) return longLayout(rank, suit);

  switch (rank) {
    case 2:
      return [
        { x: 50, y: 48, scale: 1.3 },
        { x: 50, y: 102, scale: 1.3 },
      ];
    case 3:
      return [
        { x: 50, y: 40, scale: 1.08 },
        { x: 33, y: 101, scale: 1.08 },
        { x: 67, y: 101, scale: 1.08 },
      ];
    case 4:
      return [
        { x: 33, y: 48, scale: 1.08 },
        { x: 67, y: 48, scale: 1.08 },
        { x: 33, y: 102, scale: 1.08 },
        { x: 67, y: 102, scale: 1.08 },
      ];
    case 5:
      return [
        { x: 32, y: 44, scale: 0.94 },
        { x: 68, y: 44, scale: 0.94 },
        { x: 50, y: 75, scale: 1.08 },
        { x: 32, y: 106, scale: 0.94 },
        { x: 68, y: 106, scale: 0.94 },
      ];
    case 6:
      return [
        { x: 33, y: 42, scale: 0.9 },
        { x: 67, y: 42, scale: 0.9 },
        { x: 33, y: 75, scale: 0.9 },
        { x: 67, y: 75, scale: 0.9 },
        { x: 33, y: 108, scale: 0.9 },
        { x: 67, y: 108, scale: 0.9 },
      ];
    default:
      return [
        { x: 32, y: 40, scale: 0.82 },
        { x: 68, y: 40, scale: 0.82 },
        { x: 50, y: 58, scale: 0.68 },
        { x: 32, y: 76, scale: 0.82 },
        { x: 68, y: 76, scale: 0.82 },
        { x: 32, y: 112, scale: 0.82 },
        { x: 68, y: 112, scale: 0.82 },
      ];
  }
}

/**
 * Long-suit arrangements, sized per suit.
 *
 * Width is what limits every one of these. A bastone is about 19 units wide in
 * its 40-unit box; a spada, with its cruciform guard, about 23. Sharing one
 * scale across both means sizing everything for the wider of them, which is
 * why the two suits take the same positions at different scales instead.
 *
 * Every arrangement here is chosen to be the largest that still leaves clear
 * air between pips. Three abreast, for instance, caps a spada at about 1.25
 * before the guards touch, which is why the three is a triangle: that gives
 * each pip half the card width and lets it grow instead.
 */
function longLayout(rank: Rank, suit: Suit): Placement[] {
  const wide = suit === 'sw';
  switch (rank) {
    case 2: {
      const s = wide ? 1.62 : 1.9;
      return [
        { x: 30, y: 75, scale: s },
        { x: 70, y: 75, scale: s },
      ];
    }
    case 3: {
      const s = wide ? 1.5 : 1.6;
      return [
        { x: 50, y: 42, scale: s },
        { x: 28, y: 104, scale: s },
        { x: 72, y: 104, scale: s },
      ];
    }
    // Four quadrants. Earlier passes crossed these through a shared centre,
    // which merged the shafts into one dark mass -- you could not count four.
    // The rows sit 56 apart, which is what sets the ceiling on the scale: a
    // pip tilted eight degrees is taller than its upright height.
    case 4: {
      const s = wide ? 1.3 : 1.4;
      return [
        { x: 29, y: 50, scale: s, rotate: -8 },
        { x: 71, y: 50, scale: s, rotate: 8 },
        { x: 29, y: 106, scale: s, rotate: 8 },
        { x: 71, y: 106, scale: s, rotate: -8 },
      ];
    }
    // Four corners pushed right out to the card edges so the fifth can lie
    // across the middle at the same size as the rest, the way the printed
    // card does it, without the two touching.
    case 5: {
      const s = wide ? 1.15 : 1.3;
      return [
        { x: 32, y: 38, scale: s },
        { x: 68, y: 38, scale: s },
        { x: 50, y: 76, scale: s, rotate: 90 },
        { x: 32, y: 114, scale: s },
        { x: 68, y: 114, scale: s },
      ];
    }
    case 6:
      return [
        { x: 30, y: 50, scale: 1.08 },
        { x: 50, y: 50, scale: 1.08 },
        { x: 70, y: 50, scale: 1.08 },
        { x: 30, y: 100, scale: 1.08 },
        { x: 50, y: 100, scale: 1.08 },
        { x: 70, y: 100, scale: 1.08 },
      ];
    default:
      return [
        { x: 30, y: 47, scale: 1 },
        { x: 50, y: 47, scale: 1 },
        { x: 70, y: 47, scale: 1 },
        { x: 30, y: 103, scale: 1 },
        { x: 50, y: 103, scale: 1 },
        { x: 70, y: 103, scale: 1 },
        { x: 50, y: 75, scale: 1, rotate: 90 },
      ];
  }
}
