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
 *
 * THE PATHS BELOW ARE NOT HAND-AUTHORED -- do not tidy them. They come from
 * `boy.svg` / `girl.svg` at the repo root, which are the vectorized artwork
 * Jesse supplied. A previous pass traced these shapes by eye off a flat
 * rendering of that same artwork and the result looked rough, which is the
 * whole reason the real vectors exist. The path data is verbatim, in its
 * native 1784x882 coordinate space, and the ONLY thing this file does is pick
 * a viewBox that crops to one card.
 *
 * That crop: the source board draws each figure inside a 780x780 card whose
 * bottom edge is y=851 (the busts are clipped there) and whose top is y=71.
 * Each viewBox is that square, centred on the figure's own bounding box --
 * boy cx 465.2, girl cx 1326.3. The 780 is not a guess: it puts the boy's
 * brim at 90.9% of the icon's width against the previous icons' 90.8%, so the
 * figures land where the card-corner spacing was already tuned for them.
 *
 * Interior detail has to CUT INTO the figure, never paint on top of it. An
 * earlier pass drew the hat band, suspenders, hair and cape collar in
 * `currentColor` at 0.3 opacity -- but the body underneath is that same color
 * at full opacity, and white-at-30%-over-white is just white. Rasterized at
 * 96px, 3.4x the size these ever ship at, that entire detail layer moved 0.37%
 * of the icon's pixels: it was drawing nothing. Measure, don't eyeball -- see
 * DESIGN.md for the method.
 */
/** Warm ink for interior detail. The artwork's own detail color is a flat
 * #B0AFAF; this is that value reconstructed as ink over the figure, which
 * keeps DESIGN.md's "no bare neutrals" rule and lets the detail sit correctly
 * on all four deck colors. 0.34 over white lands on #B2ABA9. */
const DETAIL = '#1d1009';

export function BoyIcon({ size = 24, className, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="75.2 71 780 780"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M443.347 164.019C392.412 168.785 313.484 189.393 301.256 246.715C299.635 252.118 300.427 291.251 300.878 313.528C300.995 319.328 301.089 323.986 301.112 326.608C275.6 326.121 250.016 326.251 224.437 326.38C203.937 326.484 183.44 326.588 162.985 326.374C147.38 326.211 133.331 326.106 121.493 338.2C113.941 345.864 110.562 353.106 110.527 363.92C110.476 374.257 114.556 384.186 121.861 391.503C133.663 403.369 146.365 403.233 161.709 403.069C162.348 403.062 162.991 403.055 163.639 403.049C191.736 402.786 219.881 402.93 248.026 403.074C279.076 403.232 310.126 403.391 341.112 403.003C341.567 402.999 342.021 402.988 342.476 402.973C334.704 415.12 330.18 422.949 324.748 436.603C311.459 477.169 311.772 511.536 331.527 550.426C349.182 585.327 380.134 611.67 417.42 623.527C456.005 636.034 495.301 632.376 531.316 613.822C565.632 596.219 591.489 565.64 603.137 528.886C614.208 494.254 611.132 470.039 601.104 436.535C596.518 424.747 590.534 413.551 583.28 403.188C607.683 402.734 632.426 402.913 657.162 403.092C679.581 403.255 701.994 403.417 724.141 403.108C728.202 403.051 734.239 403.131 741.007 403.221C756.748 403.429 776.447 403.689 784.453 402.409C791.263 401.59 799.142 396.201 804.006 391.657C819.913 376.529 819.842 352.77 804.215 337.488C792.828 326.352 781.455 326.377 767.568 326.409C765.78 326.413 763.951 326.417 762.074 326.397C754.836 326.321 747.546 326.337 740.267 326.354C736.907 326.361 733.55 326.369 730.201 326.367C695.302 326.223 660.403 326.301 625.505 326.6C625.092 314.418 625.302 302.206 625.513 289.996C625.674 280.641 625.835 271.287 625.716 261.947C625.706 261.163 625.699 260.378 625.693 259.591C625.651 254.501 625.608 249.364 624.606 244.375C608.266 179.526 500.813 158.641 443.347 164.019Z"
      />
      <path
        d="M601.104 436.535L324.748 436.603C311.459 477.169 311.772 511.536 331.527 550.426C349.182 585.327 380.134 611.67 417.42 623.527C456.005 636.034 495.301 632.376 531.316 613.822C565.632 596.219 591.489 565.64 603.137 528.886C614.208 494.254 611.132 470.039 601.104 436.535Z"
      />
      <path
        d="M443.347 164.019C392.412 168.785 313.484 189.393 301.256 246.715C299.635 252.118 300.427 291.251 300.878 313.528C300.995 319.328 301.089 323.986 301.112 326.608C342.603 327.48 386.072 327.223 428.954 326.969C449.968 326.844 470.84 326.72 491.27 326.731L578.849 326.776C582.877 326.777 587.264 326.818 591.799 326.86C603.219 326.965 615.578 327.08 625.505 326.6C625.092 314.418 625.302 302.206 625.513 289.996C625.674 280.641 625.835 271.287 625.716 261.947C625.706 261.163 625.699 260.378 625.693 259.591C625.651 254.501 625.608 249.364 624.606 244.375C608.266 179.526 500.813 158.641 443.347 164.019Z"
      />
      <path fill={DETAIL} opacity="0.34"
        d="M 625.387 294.753 C 618.632 294.414 300.224 296.22 300.25 296.2 C 300.264 293.917 300.427 291.251 300.878 313.528 C 300.995 319.328 301.089 323.986 301.112 326.608 C 342.603 327.48 386.072 327.223 428.954 326.969 C 449.968 326.844 470.84 326.72 491.27 326.731 L 578.849 326.776 C 582.877 326.777 587.264 326.818 591.799 326.86 C 603.219 326.965 615.578 327.08 625.505 326.6 C 625.092 314.418 626.232 294.795 625.387 294.753 Z"
      />
      <path fill={DETAIL} opacity="0.34"
        d="M 387.896 402.762 C 372.188 402.532 354.452 402.272 342.476 402.973 C 334.704 415.12 330.18 422.949 324.748 436.603 L 601.104 436.535 C 596.518 424.747 590.534 413.551 583.28 403.188 C 607.683 402.734 394.853 402.864 387.896 402.762 Z"
      />
      <path
        d="M 249.212 708.778 C 205.566 748.224 188.496 793.433 185.256 850.94 C 190.058 851.613 200.27 851.492 207.781 851.402 C 209.739 851.379 372.216 851.247 376.892 851.287 C 389.268 851.393 429.758 851.447 438.073 851.375 C 440.44 851.355 711.151 851.256 712.776 851.27 C 721.237 851.344 737.607 851.487 740.875 850.781 C 741.017 845.631 739.763 834.374 739.143 828.99 C 734.519 788.867 720.229 755.84 693.652 725.569 C 641.897 666.619 559.284 643.264 483.1 639.536 C 404.397 635.685 309.214 654.549 249.212 708.778 Z"
      />
      <path fill={DETAIL} opacity="0.34"
        d="M 595.647 676.594 C 578.371 667.519 571.409 665.455 552.793 660.966 C 539.79 723.837 524.231 788.053 512.224 850.732 L 557.261 851.049 C 557.261 851.049 583.393 734.641 595.647 676.594 Z"
      />
      <path fill={DETAIL} opacity="0.34"
        d="M 372.261 660.543 C 354.119 665.196 345.745 668.369 329.635 676.859 C 342.227 734.772 355.134 792.615 368.357 850.387 C 368.357 850.387 403.001 850.888 413.053 850.207 C 412.354 843.972 409.338 831.466 407.924 825.097 L 398.021 780.524 L 372.261 660.543 Z"
      />
    </svg>
  );
}

export function GirlIcon({ size = 24, className, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="936.3 71 780 780"
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M1078.91 540.473C1069.46 565.722 1058.05 590.512 1048.86 615.813L1125.4 615.98C1127.62 615.983 1130.25 616.076 1133.12 616.177C1146.59 616.652 1165.46 617.317 1172.94 609.832C1178.45 604.227 1181.52 596.665 1181.47 588.803C1181.32 577.291 1176.47 555.066 1174.45 542.826C1169.53 512.992 1165.45 486.98 1164.58 456.715L1168.36 455.889C1170.16 457.754 1170.19 461.702 1170.22 465.646C1170.23 468.007 1170.25 470.366 1170.65 472.275C1170.67 504.022 1191.98 547.805 1214.64 569.964C1245.46 600.088 1283.02 615.39 1325.96 615.378C1367.72 615.441 1407.81 598.943 1437.42 569.502C1468.5 538.23 1482.16 499.081 1481.95 455.631L1486.17 456.85C1484.95 494.936 1478.57 533.752 1470.5 570.963C1467.56 583.829 1466.8 597.707 1476.47 608.104C1481.24 613.243 1486.82 615.076 1493.75 614.777C1509.89 614.082 1526.78 614.388 1543.71 614.694C1564.08 615.063 1584.5 615.433 1603.71 614.059C1595.1 589.076 1584.51 566.316 1574.19 542.292C1568.92 530.015 1556.07 503.241 1555.02 491.231C1553.69 475.908 1554.13 458.388 1554.55 441.259C1554.81 430.936 1555.06 420.756 1554.92 411.284C1553.57 320.399 1515.8 239.562 1431 198.362C1372.98 170.611 1306.3 167.054 1245.66 188.474C1190.26 207.738 1148.92 244.245 1123.12 296.738C1100.03 343.718 1095.93 393.38 1095.41 444.907C1095.2 450.802 1095.47 456.764 1095.73 462.734C1096.17 472.532 1096.6 482.35 1094.95 491.921C1092.03 508.83 1084.87 524.544 1078.91 540.473Z"
      />
      <path
        d="M1333.86 335.575C1330.15 323.14 1327.45 310.424 1325.8 297.553C1312.17 391.718 1262.63 437.371 1170.86 454.519C1170.85 455.824 1170.86 457.323 1170.87 458.911C1170.9 463.451 1170.93 468.72 1170.65 472.275C1170.67 504.022 1191.98 547.805 1214.64 569.964C1245.46 600.088 1283.02 615.39 1325.96 615.378C1367.72 615.441 1407.81 598.943 1437.42 569.502C1468.5 538.23 1482.16 499.081 1481.95 455.631C1478.24 453.403 1449.61 447.594 1443.03 445.417C1386.92 426.861 1350.94 392.444 1333.86 335.575Z"
      />
      <path fill={DETAIL} opacity="0.34"
        d="M 1164.45 454.11 C 1164.48 454.979 1164.53 455.847 1164.58 456.715 L 1168.36 455.889 C 1170.16 457.754 1312.17 391.718 1325.8 297.553 C 1327.45 310.424 1330.15 323.14 1333.86 335.575 C 1350.94 392.444 1386.92 426.861 1443.03 445.417 C 1449.61 447.594 1478.24 453.403 1481.95 455.631 L 1486.17 456.85 C 1483.7 363.472 1415.24 290.103 1319.86 293.502 C 1276.3 295.054 1237.26 309.091 1207.01 341.32 C 1180.1 369.853 1162.91 414.81 1164.45 454.11 Z"
      />
      <path
        d="M1413.04 602.061C1338.6 629.64 1312.6 628.429 1238.12 602.017C1222.4 619.282 1216.99 633.49 1216.9 656.759C1129.58 682.214 1059.77 756.797 1060.2 850.952C1065.65 851.757 1085.52 851.499 1098.28 851.334C1101.99 851.285 1105.11 851.245 1107.09 851.241L1209.08 851.164L1502.78 851.277L1566.51 851.3C1567.07 851.3 1568.03 851.306 1569.25 851.314C1576.05 851.356 1591.14 851.451 1593.28 850.858C1593.18 824.659 1584.97 790.475 1573.27 767.361C1543.27 708.105 1495.2 676.779 1435.01 655.762C1434.5 633.116 1428.06 618.594 1413.04 602.061Z"
      />
      <path fill={DETAIL} opacity="0.34"
        d="M 1402.27 768.683 C 1374.64 733.645 1343.17 696.964 1326.15 655.697 C 1313.12 688.582 1287.96 719.285 1266.7 747.411 C 1240.71 781.799 1184.147 850.416 1186.127 850.412 L 1290.01 850.217 L 1465.541 850.934 L 1402.27 768.683 Z"
      />
      <path fill={DETAIL} opacity="0.34"
        d="M1434.48 660.921C1420.3 658.915 1384.23 652.906 1371.58 652.878C1377.59 658.701 1426.85 707.781 1428.34 708.25C1428.62 707.231 1429.21 705.27 1429.31 704.32C1431.55 690.112 1432.94 675.264 1434.48 660.921Z"
      />
      <path fill={DETAIL} opacity="0.34"
        d="M1280.53 652.671L1272.43 653.356C1256.43 655.147 1232.32 659.66 1217.57 660.383C1218.11 667.457 1221.91 702.92 1224.29 707.71L1225.32 707.622C1243.54 689.119 1261.94 670.801 1280.53 652.671Z"
      />
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
