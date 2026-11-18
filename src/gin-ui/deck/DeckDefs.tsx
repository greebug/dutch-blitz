/**
 * Every piece of deck artwork, defined once.
 *
 * Rendered as a single hidden <svg> at the app root; cards reference the pieces
 * with <use href="#...">. That matters here rather than being tidiness: a hand
 * plus the piles is a dozen cards on screen, each wanting a suit emblem made of
 * twenty-odd paths. Defining them once and instancing costs a single node per
 * appearance instead of twenty.
 *
 * Court costume is coloured through `var(--court-accent)`, which inherits into
 * a <use> instance, so one Fante symbol serves all four suits and still reads
 * as a family with its own Cavallo and Re.
 *
 * Drawn from a Neapolitan deck: denari as sun-faced coins, coppe as footed
 * chalices, bastoni as the split green-and-red leafed batons the real cards
 * use (not plain clubs), spade as straight blue blades with gold cruciform
 * hilts. Pips live in a 40x40 box; aces and courts fill a 100x150 card.
 */

export const C = {
  gold: '#e3b02a',
  goldLight: '#f6da76',
  goldDeep: '#a8780f',
  red: '#c3342a',
  redLight: '#e05345',
  redDeep: '#8d231c',
  green: '#2f6b3f',
  greenLight: '#55955f',
  greenDeep: '#1d4528',
  blue: '#415490',
  steel: '#9aa6d4',
  steelDeep: '#3d4c84',
  ink: '#241f1a',
  line: '#2b2419',
  cream: '#f8f2e3',
  skin: '#f2d3ac',
  skinShade: '#d6a97c',
};

export default function DeckDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
      <defs>
        <linearGradient id="gGold" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#f8e08f" />
          <stop offset="0.45" stopColor="#e3b02a" />
          <stop offset="1" stopColor="#a8780f" />
        </linearGradient>
        <linearGradient id="gRed" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#e05345" />
          <stop offset="0.55" stopColor="#c3342a" />
          <stop offset="1" stopColor="#8d231c" />
        </linearGradient>
        <linearGradient id="gGreen" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#55955f" />
          <stop offset="0.6" stopColor="#2f6b3f" />
          <stop offset="1" stopColor="#1d4528" />
        </linearGradient>
        <linearGradient id="gSteel" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#c3cbe8" />
          <stop offset="0.42" stopColor="#8a97c9" />
          <stop offset="0.52" stopColor="#5c6aa8" />
          <stop offset="1" stopColor="#3d4c84" />
        </linearGradient>
        <linearGradient id="gCloak" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#e05345" />
          <stop offset="1" stopColor="#8d231c" />
        </linearGradient>
        <linearGradient id="gHorse" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0" stopColor="#e8b887" />
          <stop offset="0.6" stopColor="#c98f55" />
          <stop offset="1" stopColor="#9c6a38" />
        </linearGradient>

        {/* ---------------- Denari: a struck coin with a sun's face ---------- */}
        <symbol id="pip-su" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="19" fill={C.goldDeep} />
          {/* milled edge */}
          {Array.from({ length: 28 }, (_, i) => (
            <rect
              key={i}
              x="19.4"
              y="0.6"
              width="1.2"
              height="3"
              fill={C.goldLight}
              opacity="0.55"
              transform={`rotate(${i * (360 / 28)} 20 20)`}
            />
          ))}
          <circle cx="20" cy="20" r="17" fill="url(#gGold)" stroke={C.line} strokeWidth="1.1" />
          {/* alternating long and short rays, the detail that makes a denaro a
              sun rather than a disc */}
          {Array.from({ length: 16 }, (_, i) => (
            <path
              key={i}
              d={i % 2 ? 'M20 4.6l1.9 4.2h-3.8z' : 'M20 2.6l2.4 6.2h-4.8z'}
              fill={C.goldDeep}
              transform={`rotate(${i * 22.5} 20 20)`}
            />
          ))}
          <circle cx="20" cy="20" r="10.6" fill={C.goldLight} stroke={C.line} strokeWidth="1" />
          <circle cx="20" cy="20" r="9" fill="url(#gGold)" />
          {/* face */}
          <ellipse cx="16.6" cy="18.2" rx="1.5" ry="1.9" fill={C.line} />
          <ellipse cx="23.4" cy="18.2" rx="1.5" ry="1.9" fill={C.line} />
          <path d="M20 19.2l1.5 3.4h-3z" fill={C.goldDeep} />
          <path d="M16.3 24.4q3.7 3 7.4 0" fill="none" stroke={C.line} strokeWidth="1.2" strokeLinecap="round" />
          <path d="M14.4 13.6q5.6-2.6 11.2 0" fill="none" stroke={C.goldDeep} strokeWidth="1" />
        </symbol>

        {/* ---------------- Coppe: a footed, two-handled chalice ------------- */}
        <symbol id="pip-go" viewBox="0 0 40 40">
          <g stroke={C.line} strokeWidth="1.1" strokeLinejoin="round">
            {/* scrolled handles */}
            <path
              d="M11.2 13.8c-4.6 0-7.2 3-7.2 6.4 0 3 2 5.2 4.8 5.2 2 0 3.4-1.3 3.4-3 0-1.5-1-2.5-2.3-2.5-1 0-1.8.6-1.8 1.5"
              fill="none"
              strokeWidth="1.6"
            />
            <path
              d="M28.8 13.8c4.6 0 7.2 3 7.2 6.4 0 3-2 5.2-4.8 5.2-2 0-3.4-1.3-3.4-3 0-1.5 1-2.5 2.3-2.5 1 0 1.8.6 1.8 1.5"
              fill="none"
              strokeWidth="1.6"
            />
            {/* bowl */}
            <path d="M9.6 10.4h20.8l-2 9.4A9 9 0 0120 26a9 9 0 01-8.4-6.2z" fill="url(#gRed)" />
            <path d="M11.3 15.4h17.4l-.7 3.4H12z" fill={C.gold} opacity="0.95" />
            <ellipse cx="20" cy="22" rx="3.1" ry="2.4" fill={C.goldLight} stroke="none" />
            {/* gold rim */}
            <rect x="8.4" y="7.2" width="23.2" height="3.6" rx="1.6" fill="url(#gGold)" />
            {/* stem, knop, foot */}
            <rect x="18.2" y="26" width="3.6" height="4.4" fill="url(#gGold)" />
            <ellipse cx="20" cy="29.4" rx="3.4" ry="1.9" fill={C.goldLight} />
            <path d="M12.4 36.4h15.2l-2.2-4.4H14.6z" fill="url(#gGold)" />
            <rect x="11" y="36" width="18" height="2.4" rx="1.2" fill={C.goldDeep} />
          </g>
        </symbol>

        {/* ---------------- Bastoni: the split green-and-red leafed baton ----- */}
        <symbol id="pip-ro" viewBox="0 0 40 40">
          <g stroke={C.line} strokeWidth="1.1" strokeLinejoin="round">
            {/* A CLUB, not a leaf. The first pass drew these as narrow feathers
                and they read as foliage at any size; the printed bastoni are
                substantial cudgels -- narrow at the grip, swelling towards a
                rounded head -- which is what makes them distinguishable from
                swords across a table. The leaf treatment belongs on top of that
                silhouette, not instead of it. */}
            {/* Roughly one to three, width against height. Fatter than this and
                it stops being a stick: the previous pass swelled to nearly half
                its height and read as a shield or a beetle. */}
            <path
              d="M20 1.8c4.6.4 6.4 4.6 6.2 11.2-.2 7-1.6 14.4-3 23H16.8c-1.4-8.6-2.8-16-3-23C13.6 6.4 15.4 2.2 20 1.8z"
              fill="url(#gGreen)"
            />
            {/* Red half: the lengthwise split the printed bastoni use. */}
            <path d="M20 1.8c4.6.4 6.4 4.6 6.2 11.2-.2 7-1.6 14.4-3 23H20z" fill="url(#gRed)" />
            {/* Cut branch stubs -- the detail that says cudgel rather than leaf. */}
            <path d="M14 12.6l-3.6-2.4 3.8-1zM26 12.6l3.6-2.4-3.8-1z" fill={C.greenDeep} />
            <path d="M14.8 24l-3.4 2.4 3.6 1zM25.2 24l3.4 2.4-3.6 1z" fill={C.redDeep} />
            <path d="M20 3.4v32.4" stroke={C.goldLight} strokeWidth="1.5" fill="none" />
            {[9, 14.5, 20, 25.5, 31].map((y, i) => (
              <g key={y} stroke={C.goldLight} strokeWidth="1.1" fill="none" strokeLinecap="round">
                <path d={`M20 ${y}l${4.4 - i * 0.4} -2.6`} />
                <path d={`M20 ${y}l-${4.4 - i * 0.4} -2.6`} />
              </g>
            ))}
            {/* Bound grip at the foot. */}
            <path d="M16.4 35.4h7.2l-.6 3.2h-6z" fill="url(#gGold)" />
          </g>
        </symbol>

        {/* ---------------- Spade: straight blade, gold cruciform hilt -------- */}
        <symbol id="pip-sw" viewBox="0 0 40 40">
          <g stroke={C.line} strokeWidth="1.1" strokeLinejoin="round">
            <path d="M20 1l4.6 6.6v17.2h-9.2V7.6z" fill="url(#gSteel)" />
            <path d="M20 2.4v22" stroke={C.cream} strokeWidth="1" opacity="0.6" fill="none" />
            {/* guard with quatrefoil ends */}
            {/* Guard, narrowed from 24.8 wide to 17.6. At the old width the
                quatrefoil ends spanned three quarters of the pip box, and that
                single measurement was what capped every spada layout: three
                abreast could not clear each other above scale 1.25. */}
            <rect x="11.2" y="24.8" width="17.6" height="3.8" rx="1.9" fill="url(#gGold)" />
            <circle cx="11.4" cy="26.7" r="2.7" fill={C.goldLight} />
            <circle cx="28.6" cy="26.7" r="2.7" fill={C.goldLight} />
            <circle cx="20" cy="26.7" r="2.2" fill={C.goldDeep} stroke="none" />
            {/* bound grip */}
            <rect x="17.9" y="28.6" width="4.2" height="6.6" fill="url(#gGold)" />
            <path d="M17.9 30.2h4.2M17.9 32.2h4.2M17.9 34.2h4.2" stroke={C.goldDeep} strokeWidth="0.8" />
            <circle cx="20" cy="36.8" r="3.1" fill="url(#gGold)" />
          </g>
        </symbol>

        {/* ================= ACES (full 100x150 card) ======================== */}

        {/* Asso di denari: the double-eagle figure-of-eight from the real card */}
        <symbol id="ace-su" viewBox="0 0 100 150">
          {/* The figure-of-eight is not decoration: Italian decks carried a
              government tax stamp until 1972, and on the Neapolitan pattern it
              went in the LOWER circle of this card. So the lower loop is left
              open and empty -- that blank field is the whole reason the card
              looks like this -- while the upper loop carries the coin that
              names the suit, flanked by the eagle heads.
              Sources: wopc.co.uk/italy/neapolitan-pattern, it.wikipedia.org. */}
          <g stroke={C.line} strokeWidth="1.3" strokeLinejoin="round">
            {/* Eagle heads first, so the loops overlap and anchor them rather
                than leaving them floating free off the sides. */}
            <g>
              <path d="M40 46c-7-2-12-7-13-14 5-1 10 2 13 7z" fill="url(#gRed)" />
              <path d="M28 33c-3-2-5-2-6 0 2 2 4 2 6 0z" fill={C.goldLight} />
              <circle cx="31" cy="37" r="1.3" fill={C.line} stroke="none" />
              <path d="M60 46c7-2 12-7 13-14-5-1-10 2-13 7z" fill="url(#gRed)" />
              <path d="M72 33c3-2 5-2 6 0-2 2-4 2-6 0z" fill={C.goldLight} />
              <circle cx="69" cy="37" r="1.3" fill={C.line} stroke="none" />
            </g>
            {/* upper loop */}
            <circle cx="50" cy="55" r="18" fill="none" stroke="url(#gGold)" strokeWidth="4" />
            {/* lower loop, deliberately empty: this is the stamp field */}
            <circle cx="50" cy="100" r="24" fill="none" stroke="url(#gGold)" strokeWidth="4" />
            <circle cx="50" cy="100" r="19" fill="none" stroke={C.goldDeep} strokeWidth="1" opacity="0.5" />
          </g>
          <g transform="translate(50 55) scale(0.82) translate(-20 -20)">
            <use href="#pip-su" width="40" height="40" />
          </g>
        </symbol>

        {/* Asso di coppe: the lidded ceremonial urn */}
        <symbol id="ace-go" viewBox="0 0 100 150">
          {/* Scaled down from 2.3: the aces were filling their cards edge to
              edge, which made them read as a different, larger object rather
              than as the suit writ large. */}
          <g transform="translate(50 92) scale(1.75) translate(-20 -20)">
            <use href="#pip-go" width="40" height="40" />
          </g>
          <g stroke={C.line} strokeWidth="1.4" strokeLinejoin="round">
            <path d="M30 58h40l-5-9H35z" fill="url(#gGold)" />
            <path d="M37 49c3-9 23-9 26 0z" fill="url(#gRed)" />
            <path d="M40 48c2-6 18-6 20 0z" fill={C.gold} opacity="0.85" />
            <rect x="47" y="36" width="6" height="7" rx="2" fill="url(#gGold)" />
            <circle cx="50" cy="33" r="4" fill={C.goldLight} />
          </g>
        </symbol>

        {/* Asso di bastoni: one great baton through a lion mask */}
        <symbol id="ace-ro" viewBox="0 0 100 150">
          <g transform="translate(50 76) scale(2.5) translate(-20 -20)">
            <use href="#pip-ro" width="40" height="40" />
          </g>
          <g stroke={C.line} strokeWidth="1.6" strokeLinejoin="round">
            {/* A gold boss with a rosette, not a face. Dark eye sockets on a
                gold disc at this size read as a skull, which is a long way from
                the lion mask on the printed card. */}
            <circle cx="50" cy="75" r="13" fill="url(#gGold)" />
            <circle cx="50" cy="75" r="9.5" fill={C.goldLight} stroke={C.line} strokeWidth="1.1" />
            {Array.from({ length: 8 }, (_, i) => (
              <path
                key={i}
                d="M50 66.5l2.6 5.4h-5.2z"
                fill={C.goldDeep}
                transform={`rotate(${i * 45} 50 75)`}
              />
            ))}
            <circle cx="50" cy="75" r="3.6" fill="url(#gRed)" stroke={C.line} strokeWidth="1" />
            <path
              d="M22 108c18 10 38 10 56 0l-5 12c-15 7-31 7-46 0z"
              fill="url(#gRed)"
            />
          </g>
        </symbol>

        {/* Asso di spade: the great blade with its serpentine ribbon */}
        <symbol id="ace-sw" viewBox="0 0 100 150">
          <g transform="translate(50 76) scale(2.5) translate(-20 -20)">
            <use href="#pip-sw" width="40" height="40" />
          </g>
          <path
            d="M26 40c14 8 20-6 32 2s14 16 2 20-24-4-32 6 2 20 16 20 22-8 30-4"
            fill="none"
            stroke="url(#gRed)"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            d="M26 40c14 8 20-6 32 2s14 16 2 20-24-4-32 6 2 20 16 20 22-8 30-4"
            fill="none"
            stroke={C.line}
            strokeWidth="1.1"
            strokeLinecap="round"
            opacity="0.5"
          />
        </symbol>


        {/* ================= COURTS (full 100x150 card) ======================
            Three things these get right that the first pass did not: every
            head is joined to its body by an actual neck (floating heads were
            the most obvious tell), every figure holds its suit emblem in a
            raised hand rather than having it parked in a corner, and the
            plinth takes the suit colour so a court card announces its suit
            before you have read anything else on it. Emblem positions live in
            the EMBLEM table in CardFace and are kept clear of the corner
            index. */}

        {/* Fante: a page on a plinth, holding the suit up in his right hand */}
        <symbol id="court-fante" viewBox="0 0 100 150">
          <g stroke={C.line} strokeWidth="1.4" strokeLinejoin="round">
            {/* suit-coloured plinth */}
            <rect x="24" y="130" width="52" height="8" rx="2" fill="var(--court-accent, #555)" />
            <rect x="21" y="138" width="58" height="4" rx="2" fill="url(#gGold)" />
            {/* legs, mi-parti: one light hose, one in the suit colour */}
            <path d="M41 96h8l-1 34h-9z" fill={C.goldLight} />
            <path d="M51 96h8l2 34h-9z" fill="var(--court-accent, #555)" />
            <path d="M38 126h12v5H38zM51 126h12v5H51z" fill={C.line} opacity="0.8" />
            {/* doublet */}
            <path d="M34 66q16-9 32 0l5 32H29z" fill="var(--court-accent, #555)" />
            <path d="M50 62v36" stroke={C.goldLight} strokeWidth="2.2" fill="none" />
            <path d="M40 72l-2 25M60 72l2 25" stroke={C.goldLight} strokeWidth="1" opacity="0.65" fill="none" />
            {/* left arm hanging; right arm raised, forearm rising to the hand */}
            <path d="M34 68l-9 24 8 3 7-19z" fill="url(#gRed)" />
            <circle cx="28" cy="95" r="4.4" fill={C.skin} />
            <path d="M64 67l10 2-3 9-10-3z" fill="url(#gRed)" />
            <path d="M69 68l6 1-2 10-6-1z" fill="url(#gRed)" />
            <circle cx="73" cy="63" r="4.6" fill={C.skin} />
            {/* NECK: the fix for the floating head */}
            <rect x="45.5" y="52" width="9" height="13" fill={C.skin} />
            <path d="M46 56q4 3 8 0" fill="none" stroke={C.skinShade} strokeWidth="1" />
            <path d="M37 65q13-8 26 0-13 7-26 0z" fill={C.cream} />
            <circle cx="50" cy="42" r="11" fill={C.skin} />
            <path d="M44 45q6 5 12 0" fill="none" stroke={C.skinShade} strokeWidth="1.2" strokeLinecap="round" />
            <ellipse cx="45.6" cy="39.5" rx="1.5" ry="1.9" fill={C.line} />
            <ellipse cx="54.4" cy="39.5" rx="1.5" ry="1.9" fill={C.line} />
            <path d="M39 36q11-12 22 0z" fill="var(--court-accent, #555)" />
            <rect x="37" y="34" width="26" height="4.6" rx="2" fill="url(#gGold)" />
            <path d="M61 33q8-6 11-14-1 10-7 16z" fill="url(#gRed)" />
          </g>
        </symbol>

        {/* Cavallo: rider and horse in profile.
            The horse sits left of centre and smaller than the first pass, with
            the tail dropped behind the hindquarters rather than sweeping out
            level with the barrel. All of that is to buy room on the right: the
            previous head ran into the card edge and had to be drawn too small
            to read as a horse at hand size. */}
        <symbol id="court-cavallo" viewBox="0 0 100 150">
          <g stroke={C.line} strokeWidth="1.4" strokeLinejoin="round">
            <rect x="16" y="131" width="68" height="8" rx="2" fill="var(--court-accent, #555)" />
            <rect x="13" y="139" width="74" height="4" rx="2" fill="url(#gGold)" />

            {/* tail, falling behind the quarters */}
            <path d="M20 84C12 92 9 104 11 122c1 5 3 6 4 2 1-8 3-18 7-26 4-7 7-10 8-12Z" fill="#7a4e28" />
            <path d="M23 88C16 96 13 108 14 120c1-8 3-18 7-25z" fill="#9c6a38" />

            {/* Legs first, so the barrel draws over their tops and they read as
                attached rather than hanging below a gap. */}
            <path d="M26 96h8l-6 35h-8z" fill="#a9763f" />
            <path d="M36 98h8l-4 33h-8z" fill="url(#gHorse)" />
            <path d="M55 98h8l4 33h-8z" fill="#a9763f" />
            <path d="M64 96h8l6 35h-8z" fill="url(#gHorse)" />
            <path d="M20 127h8v5h-8zM32 127h8v5h-8zM59 127h8v5h-8zM70 127h8v5h-8z" fill={C.line} opacity="0.8" />

            {/* barrel and hindquarters */}
            <path d="M21 94c0-11 7-16 17-16h17c8 0 13 5 15 13l2 8c1 6-3 9-9 9H29c-6 0-8-6-8-14z" fill="url(#gHorse)" />

            {/* NECK: broad where it leaves the shoulder, narrowing as it rises.
                An even-width neck reads as a pipe, which is what made the first
                head look stuck on the end of one. */}
            <path d="M70 37C60 46 55 62 53 80L72 92C73 76 72 66 68 56Z" fill="url(#gHorse)" />
            {/* mane down the crest */}
            <path d="M70 37C60 46 55 62 53 80l8 1C63 64 66 49 74 41Z" fill="#7a4e28" />
            <path d="M71 41C64 49 60 62 58 79l3 .5C63 64 66 51 73 44Z" fill="#9c6a38" />

            {/* Ears before the head, for the same reason the legs come before
                the barrel: drawn after it their bases sat above the skull line
                and they floated. Under it, the join cannot come apart. */}
            <path d="M65 43l1-17 8 13zM73 41l6-16 5 15z" fill="url(#gHorse)" />
            {/* HEAD: wide at the cheek, tapering to the muzzle, with a real
                forehead line between the two. */}
            <path d="M71 35Q82 36 88 46L91 52Q91 58 86 58L79 58Q70 58 67 51L66 42Q66 36 71 35Z" fill="url(#gHorse)" />
            {/* muzzle, shaded so the nose reads as the far end of a long face */}
            <path d="M85 46C89 48 90 50 90 53 90 56 88 57 86 57 84 53 84 49 85 46Z" fill="#b07e45" />
            <ellipse cx="88" cy="52" rx="1.5" ry="1.9" fill={C.line} stroke="none" />
            <path d="M85 56q3 .5 5-1" fill="none" stroke={C.line} strokeWidth="1" strokeLinecap="round" />
            {/* cheekbone and eye */}
            <path d="M68 46q3 8 11 11" fill="none" stroke="#9c6a38" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="76" cy="46.5" r="1.9" fill={C.line} stroke="none" />
            <circle cx="75.4" cy="45.9" r="0.6" fill={C.cream} stroke="none" />
            {/* forelock */}
            <path d="M71 33q6-3 9 2-4 6-8 5z" fill="#7a4e28" />
            {/* bridle */}
            <path d="M82 44l3 12M71 52q6 2 11-1" fill="none" stroke={C.gold} strokeWidth="1.5" strokeLinecap="round" />

            {/* caparison */}
            <path d="M29 79h27l-5 21H34z" fill="var(--court-accent, #555)" />
            <path d="M32 92h21l-1 4H33z" fill={C.goldLight} />

            {/* rein, hand to bit */}
            <path d="M62 70Q73 62 82 54" fill="none" stroke={C.line} strokeWidth="1.3" strokeLinecap="round" />

            {/* RIDER. Limbs are outlined strokes rather than polygons: the leg
                used to be a single slab that read as a saddlebag, and a stroked
                path gives a real hip-knee-ankle break with round joints. */}
            <path d="M40 56Q47 52 54 57l3 24H37Z" fill="var(--court-accent, #555)" />
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
              {/* leg: hip, knee, ankle */}
              <path d="M44 77L53 91L53 103" stroke={C.line} strokeWidth="9" />
              <path d="M44 77L53 91L53 103" stroke={C.goldLight} strokeWidth="6.4" />
              {/* far arm, forward to the rein */}
              <path d="M51 60L58 66L62 70" stroke={C.line} strokeWidth="8" />
              <path d="M51 60L58 66L62 70" stroke={C.redDeep} strokeWidth="5.4" />
              {/* near arm, raised back to the emblem */}
              <path d="M42 58L33 64L28 56" stroke={C.line} strokeWidth="9.4" />
              <path d="M42 58L33 64L28 56" stroke={C.red} strokeWidth="6.8" />
            </g>
            <path d="M49 101h6l7 7H49z" fill={C.line} opacity="0.85" />
            <circle cx="63" cy="71" r="4" fill={C.skin} />
            <circle cx="27" cy="55" r="4.4" fill={C.skin} />
            <path d="M47 56v25" stroke="url(#gGold)" strokeWidth="2.2" fill="none" />

            <rect x="43" y="45" width="8" height="13" fill={C.skin} />
            <path d="M37 57q10-7 20 0-10 6-20 0z" fill={C.cream} />
            <circle cx="47" cy="36" r="9.5" fill={C.skin} />
            <ellipse cx="43.6" cy="34" rx="1.3" ry="1.7" fill={C.line} />
            <ellipse cx="50.6" cy="34" rx="1.3" ry="1.7" fill={C.line} />
            <path d="M43 42q4 2 8 0" fill="none" stroke={C.skinShade} strokeWidth="1.1" strokeLinecap="round" />
            <path d="M38 31q9-10 18 0z" fill="var(--court-accent, #555)" />
            <rect x="36" y="29" width="22" height="4" rx="2" fill="url(#gGold)" />
            <path d="M38 28q-7-5-10-12 1 9 6 14z" fill="url(#gRed)" />
          </g>
        </symbol>

        {/* Re: crowned and cloaked, holding the suit in his right hand */}
        <symbol id="court-re" viewBox="0 0 100 150">
          <g stroke={C.line} strokeWidth="1.4" strokeLinejoin="round">
            <rect x="22" y="130" width="56" height="8" rx="2" fill="var(--court-accent, #555)" />
            <rect x="19" y="138" width="62" height="4" rx="2" fill="url(#gGold)" />
            {/* cloak: the broader silhouette that separates king from page */}
            <path d="M30 70q20-12 40 0l10 60H20z" fill="url(#gCloak)" />
            <path d="M30 70q20-12 40 0l3 10q-23-9-46 0z" fill={C.cream} opacity="0.92" />
            <path d="M34 76h2.5v3.2H34zM44 73h2.5v3.2H44zM54 73h2.5v3.2H54zM64 76h2.5v3.2H64z" fill={C.line} opacity="0.7" />
            {/* robe */}
            <path d="M38 68q12-7 24 0l6 62H32z" fill="var(--court-accent, #555)" />
            <path d="M50 64v66" stroke="url(#gGold)" strokeWidth="2.6" fill="none" />
            <path d="M40 104h20l-1 5H41z" fill={C.goldLight} />
            {/* left arm down; right arm raised to the emblem */}
            <path d="M36 70l-11 26 9 4 9-21z" fill={C.goldLight} />
            <circle cx="28" cy="99" r="4.6" fill={C.skin} />
            <path d="M64 70l11 4-4 9-10-4z" fill={C.goldLight} />
            <path d="M70 74l6 2-3 10-6-2z" fill={C.goldLight} />
            <circle cx="74" cy="71" r="4.8" fill={C.skin} />
            {/* NECK */}
            <rect x="45" y="50" width="10" height="14" fill={C.skin} />
            <path d="M38 65q12-7 24 0-12 7-24 0z" fill={C.cream} />
            <circle cx="50" cy="41" r="12" fill={C.skin} />
            {/* hair falling either side of the face, under the crown */}
            <path d="M38.5 36q-4 6-2 13 2-6 2-13zM61.5 36q4 6 2 13-2-6-2-13z" fill={C.cream} />
            <path d="M50 39l-2.5 5h5z" fill={C.skinShade} />
            {/* BEARD. The first pass was one smooth cream panel across the
                lower face, which read as a surgical mask. What makes a beard a
                beard is a broken edge and visible strands, so this one hangs in
                three locks and carries hair lines down its length. */}
            <path d="M38.6 43C38.6 53 41 60 44.5 63 46 65.5 47.5 65 48 62 49 65 51 65 52 62 52.5 65 54 65.5 55.5 63 59 60 61.4 53 61.4 43 60 47 56 49.5 50 49.5 44 49.5 40 47 38.6 43Z" fill={C.cream} />
            <path
              d="M43 48q1 9 4 14M46.5 49q.5 9 1.5 13M50 50v13M53.5 49q-.5 9-1.5 13M57 48q-1 9-4 14"
              fill="none"
              stroke="#c6bba6"
              strokeWidth="0.9"
              strokeLinecap="round"
            />
            {/* moustache, which also gives the mouth somewhere to be */}
            <path d="M50 46c-4-4-9-3-10 2 3 2 7 1 10-2 3 3 7 4 10 2-1-5-6-6-10-2z" fill={C.cream} />
            <ellipse cx="45" cy="38.5" rx="1.6" ry="2" fill={C.line} />
            <ellipse cx="55" cy="38.5" rx="1.6" ry="2" fill={C.line} />
            <path d="M34 32l3-15 5 8 8-11 8 11 5-8 3 15z" fill="url(#gGold)" />
            <circle cx="42" cy="23" r="1.8" fill={C.red} />
            <circle cx="50" cy="19" r="2" fill={C.red} />
            <circle cx="58" cy="23" r="1.8" fill={C.red} />
            <rect x="33" y="31" width="34" height="5.4" rx="2" fill={C.goldDeep} />
          </g>
        </symbol>
      </defs>
    </svg>
  );
}
