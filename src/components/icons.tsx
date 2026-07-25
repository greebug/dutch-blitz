import React from 'react';
import { CardColor } from '../game/types';

/**
 * Every icon in the game, drawn rather than typed.
 *
 * These were emoji (🚗 🚜 ⛽ 🪣) standing in for the four Dutch Blitz deck
 * symbols, which had three problems: emoji render as a different picture on
 * every platform, they're the wrong objects (a gas pump is not a cast-iron
 * water pump, a tractor is not a walking plow), and they drag another
 * vendor's illustration style into a game that has a very specific one of its
 * own. Dutch Blitz is Pennsylvania Dutch through and through, so these are cut
 * like folk art: heavy shapes, no thin lines, no detail that dies under 16px.
 *
 * Everything is `currentColor` and square, so one icon works on a card corner,
 * a lobby chip, and a scoreboard row without variants.
 */

/** The canonical deck colors, from the physical game: green pump, red
 * carriage, yellow pail, blue plow. Worth stating once here because the
 * pairing is arbitrary-looking and easy to "fix" wrongly later. */
export const FACTION_LABEL: Record<CardColor, string> = {
  red: 'Carriage',
  blue: 'Plow',
  green: 'Pump',
  yellow: 'Pail',
};

interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

function Svg({ size = 24, children, className, style }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Red deck. An Amish buggy: enclosed box body, tall rear wheel, small front
 * wheel, shaft running out to the horse. */
export function CarriageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 29V19a7 7 0 0 1 7-7h9a7 7 0 0 1 7 7v10z" />
      <path d="M9 29h30v3.5H9z" />
      <path d="M35 17.5l11-4.5 1.4 3.4-11.2 4.6z" />
      <circle cx="16" cy="36" r="6.5" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="35" cy="37.5" r="5" fill="none" stroke="currentColor" strokeWidth="3" />
    </Svg>
  );
}

/** Blue deck. A walking plow, seen from the side: moldboard down at the
 * front, beam running back, two handles for the ploughman. */
export function PlowIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 40.5c1-7.5 6.5-13 14-14.5l5.5 7L11 43H6.5A2.5 2.5 0 0 1 4 40.5z" />
      <g stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" fill="none">
        <path d="M20 27.5 41 10" />
        <path d="M25.5 34 44.5 18.5" />
        <path d="M17.5 23.5 24 30.5" />
      </g>
    </Svg>
  );
}

/** Green deck. A cast-iron hand pump: column, curved spout, long lever, and
 * the block it's bolted to. */
export function PumpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 13h10v25H19z" />
      <path d="M11 38h26v5H11z" />
      <path d="M19 21h-5.5A3.5 3.5 0 0 0 10 24.5V29h5v-3.5h4z" />
      <path d="M28 12.5 43 6.5l1.6 4-15 6.2z" />
      <circle cx="28.5" cy="14.5" r="3.2" />
    </Svg>
  );
}

/** Yellow deck. A tapered farm pail with a swing handle and a hoop band. */
export function PailIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M14 17c0-6 4.5-10.5 10-10.5S34 11 34 17"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M9 16h30v5H9z" />
      <path d="M12.5 22h23l-2.6 18.5a2.5 2.5 0 0 1-2.5 2.2H17.6a2.5 2.5 0 0 1-2.5-2.2z" />
      <path d="M14.2 31h19.6l-.5 3.5H14.7z" opacity="0.28" />
    </Svg>
  );
}

const FACTION_ICONS: Record<CardColor, (p: IconProps) => React.JSX.Element> = {
  red: CarriageIcon,
  blue: PlowIcon,
  green: PumpIcon,
  yellow: PailIcon,
};

export function FactionIcon({ color, ...rest }: IconProps & { color: CardColor }) {
  const Icon = FACTION_ICONS[color];
  return <Icon {...rest} />;
}

/**
 * Boy and girl, which are load-bearing: post piles are built in descending
 * order ALTERNATING boy and girl, so a player reads these on every single
 * move. They replaced generic restroom pictograms, which were legible but
 * said nothing, and told the two apart only by a dress-shaped triangle.
 *
 * These are busts in Plain dress, and the whole design brief is the
 * SILHOUETTE, because at 13px on a small card that is all that survives: the
 * boy is a hard horizontal line (broad flat hat brim), the girl is a rounded
 * arc (bonnet). Those two shapes are not confusable even as a blur, which is
 * the only test that matters here.
 */
export function BoyIcon({ size = 24, className, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {/* shoulders and shirt */}
      <path d="M7 48c0-8.5 7.6-13 17-13s17 4.5 17 13z" />
      {/* collar notch and suspenders -- gone by 15px, character at 28px */}
      <path d="M24 35.5 20 41l-2-4.5zM24 35.5 28 41l2-4.5z" fill="#0000" />
      <path d="M18.6 36.2 21 48h-2.9l-2.2-10.6zM29.4 36.2 27 48h2.9l2.2-10.6z" opacity="0.3" />
      {/* head */}
      <circle cx="24" cy="25.5" r="9" />
      {/* hair fringe under the brim -- a bowl cut, which is the actual Plain
          haircut and reads as a dark band even when the detail is lost */}
      <path d="M15.4 22.5a9 9 0 0 1 17.2 0z" opacity="0.32" />
      {/* flat broad brim: the whole point of the silhouette */}
      <rect x="2.5" y="14" width="43" height="4.6" rx="2.3" />
      {/* crown, with a band where it meets the brim */}
      <path d="M14 14V9.8C14 6.3 18.5 4 24 4s10 2.3 10 5.8V14z" />
      <path d="M13.6 12.2h20.8V14H13.6z" opacity="0.32" />
    </svg>
  );
}

export function GirlIcon({ size = 24, className, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {/* shoulders */}
      <path d="M7 48c0-8.5 7.6-13 17-13s17 4.5 17 13z" />
      {/* cape collar -- the pointed shoulder cape of Plain dress */}
      <path d="M24 36 32.5 48h-17z" opacity="0.3" />
      {/* head */}
      <circle cx="24" cy="25.5" r="9" />
      {/* centre-parted hair, the way it shows at the temples under a covering */}
      <path d="M15.6 22.6a9 9 0 0 1 7-6.4v6.4h-1.9a4.6 4.6 0 0 0-4 3.4zM32.4 22.6a9 9 0 0 0-7-6.4v6.4h1.9a4.6 4.6 0 0 1 4 3.4z" opacity="0.32" />
      {/* prayer covering: a thick dome over and behind the head, open at the
          face. Reads as a curve at any size -- the opposite shape to the
          boy's hard horizontal brim, which is what keeps them apart at 15px. */}
      <path d="M5.5 27a18.5 18.5 0 0 1 37 0v3.2a2.6 2.6 0 0 1-2.6 2.6h-4.6A12 12 0 1 0 12.7 32.8H8.1a2.6 2.6 0 0 1-2.6-2.6z" />
    </svg>
  );
}

/**
 * A hex sign -- the eight-point barn star painted on Pennsylvania Dutch barns
 * for good luck. Pure decoration, used on card backs and as a section marker;
 * it's the single most recognizable piece of the visual tradition this game
 * is named after.
 */
export function BarnStar({ size = 24, className, style }: IconProps) {
  const points: string[] = [];
  for (let i = 0; i < 16; i++) {
    const r = i % 2 === 0 ? 23 : 9.5;
    const a = (Math.PI / 8) * i - Math.PI / 2;
    points.push(`${(24 + r * Math.cos(a)).toFixed(2)},${(24 + r * Math.sin(a)).toFixed(2)}`);
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="24" cy="24" r="23" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <polygon points={points.join(' ')} />
      <circle cx="24" cy="24" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
    </svg>
  );
}

/* ===========================================================================
   UI icons.
   ---------------------------------------------------------------------------
   The deck symbols were done first; these are the rest of the emoji that were
   still scattered through the interface -- trophy, medals, stopwatch, link,
   person, check, pause. Same objection as before: emoji are a different
   picture on every platform (and on some, a full-color cartoon dropped into a
   two-color folk palette), and they don't scale with the type around them.
   =========================================================================== */

export function TrophyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 6h20v11a10 10 0 0 1-20 0z" />
      <path d="M14 9h-5v4a7 7 0 0 0 6 6.9v-4.2A3 3 0 0 1 13 13zM34 9h5v4a7 7 0 0 1-6 6.9v-4.2A3 3 0 0 0 35 13z" />
      <path d="M20 27h8v7h-8z" />
      <path d="M13 39h22v5H13z" />
      <path d="M16 34h16v5H16z" />
    </Svg>
  );
}

/** Ranked disc for 1st/2nd/3rd. The number is drawn by the caller on top, so
 * one shape serves all three places and the color carries the rank. */
export function MedalIcon({ rank, ...rest }: IconProps & { rank: number }) {
  const tone = ['#e8b33c', '#c9c2b4', '#c07a43'][rank - 1] ?? 'currentColor';
  return (
    <Svg {...rest} style={{ ...rest.style, color: tone }}>
      <path d="M15 4h7l-6 15-7-3z" opacity="0.75" />
      <path d="M33 4h-7l6 15 7-3z" opacity="0.75" />
      <circle cx="24" cy="31" r="14" />
      <circle cx="24" cy="31" r="10" fill="none" stroke="#1d1009" strokeWidth="1.5" opacity="0.35" />
    </Svg>
  );
}

export function StopwatchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 3h10v5H19z" />
      <path d="M38.5 13.5l3.5-3.5 3 3-3.6 3.6z" />
      <circle cx="24" cy="28" r="16" fill="none" stroke="currentColor" strokeWidth="4" />
      <path d="M22.5 17h3v12h-3z" />
      <path d="M24 26.5h9v3h-9z" />
    </Svg>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <g fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round">
        <path d="M20 28.5 28 20.5" />
        <path d="M25.5 15.5 30 11a8.5 8.5 0 0 1 12 12l-4.5 4.5" />
        <path d="M23 33.5 18.5 38A8.5 8.5 0 0 1 6.5 26L11 21.5" />
      </g>
    </Svg>
  );
}

export function PersonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="24" cy="17" r="9" />
      <path d="M8 44c0-8.5 7.2-14 16-14s16 5.5 16 14z" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M9 25.5 19 35.5 39 13"
        fill="none"
        stroke="currentColor"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13 9h7.5v30H13zM27.5 9H35v30h-7.5z" />
    </Svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 8.5 39 24 15 39.5z" />
    </Svg>
  );
}

/** Marks the round winner in the score table. A pennant, not a lightning
 * bolt -- the bolt is a UI cliche and reads as "energy", not "won". */
export function PennantIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5h4v38h-4z" />
      <path d="M17 7h24l-6 8 6 8H17z" />
    </Svg>
  );
}

export function PhoneRotateIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6" y="12" width="20" height="30" rx="3" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <rect x="22" y="22" width="30" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="3.5" opacity="0.45" />
      <path d="M30 4a14 14 0 0 1 13 9l-5-1.5-1 3.5 10 3 3-10-3.5-1-1.3 4.4A18 18 0 0 0 30 0z" />
    </Svg>
  );
}
