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
      {/* shoulders */}
      <path d="M8 48c0-8 7.2-12.5 16-12.5S40 40 40 48z" />
      {/* suspender straps -- invisible at 13px, charm at 26px */}
      <path d="M17.5 37.5 20 48h-3l-2.2-9.6zM30.5 37.5 28 48h3l2.2-9.6z" opacity="0.35" />
      {/* head */}
      <circle cx="24" cy="25" r="9" />
      {/* flat broad brim: the whole point of the silhouette */}
      <rect x="3" y="13.5" width="42" height="5" rx="2.5" />
      {/* crown */}
      <path d="M14 13.5V9.5C14 6 18.5 3.5 24 3.5S34 6 34 9.5v4z" />
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
      {/* shoulders, with a cape collar */}
      <path d="M8 48c0-8 7.2-12.5 16-12.5S40 40 40 48z" />
      <path d="M24 36.5 31 48h-14z" opacity="0.35" />
      {/* head */}
      <circle cx="24" cy="25" r="9" />
      {/* bonnet: a thick dome over and behind the head, open at the face.
          Reads as a curve at any size -- the opposite shape to the boy's brim. */}
      <path d="M6 27a18 18 0 0 1 36 0v3a2.5 2.5 0 0 1-2.5 2.5h-4.2A12 12 0 1 0 12.7 32.5H8.5A2.5 2.5 0 0 1 6 30z" />
      {/* chin ribbon */}
      <path d="M22.5 33.5h3v4.5h-3z" opacity="0.35" />
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
