/**
 * The bingbongblitz.com rosette: four hearts around a hub, the same motif the
 * landing page is built from. Drawn in `currentColor`, so it takes on whatever
 * table it is sitting at.
 */
const HEART =
  'M0,0 C-9,-11 -24,-19 -24,-33 C-24,-44 -14,-49 -7,-44 C-4,-42 -1,-38 0,-35 C1,-38 4,-42 7,-44 C14,-49 24,-44 24,-33 C24,-19 9,-11 0,0 Z';

export function HubMark() {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <circle cx="100" cy="100" r="88" fill="none" stroke="currentColor" strokeWidth="10" opacity="0.55" />
      {[0, 90, 180, 270].map((r) => (
        <path
          key={r}
          d={HEART}
          fill="currentColor"
          opacity={r % 180 === 0 ? 1 : 0.7}
          transform={`translate(100,100) rotate(${r}) translate(0,-14) scale(0.9)`}
        />
      ))}
      <circle cx="100" cy="100" r="13" fill="#152b22" />
    </svg>
  );
}
