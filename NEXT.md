# Open work

State as of `769c5b5` (2026-07-25). Read `DESIGN.md` first for the visual system.

## 1. The Arial fallback — offered, not yet approved

**This is the top item.** Every form control in the app renders in **Arial**, not
Karla. Browsers do not inherit `font-family` into `button`, `input`, `textarea`
or `select` — they get the system UI font regardless of what `body` says. On the
lobby screen alone that's seven elements: Create Game, Join, and all four
leaderboard tabs. Measured in the live DOM, not inferred.

This is almost certainly what Jesse meant by *"a bunch of the other text uses the
'AI' font"*, and Arial is specifically on the list of fonts
[impeccable](https://github.com/pbakaus/impeccable) says never to ship.

The whole fix, in `src/styles/index.css`:

```css
button, input, textarea, select { font: inherit; color: inherit; }
```

Four lines, no layout or gameplay impact. It was in `1edb530` and got reverted
along with everything else in that commit. **Jesse has been told about it and
hasn't said go yet — ask before applying.**

## 2. The rest of `1edb530`, if it's ever wanted

`1edb530` was reverted wholesale because its emoji-to-SVG swap wasn't an
improvement — the gold/silver/bronze medals in particular came out broken. It's
still in history and cherry-pickable piece by piece. What's in there, roughly
best to worst:

- **Top bar spacing** — "Round 1" runs into the first player's score. One
  `&nbsp;` in `GameBoard.tsx`. Uncontroversial.
- **Wordmark contrast** — the offset shadow is mid-orange, close in value to the
  wood behind it, so the letters read furred rather than crisp. The reverted
  version used a two-pass print: tight orange offset, then a hard ink offset
  underneath. Jesse called the logo low-contrast, so this one is probably wanted
  in some form.
- **Boy/girl detail** — hat band, suspenders, centre-parted hair, cape collar, a
  proper prayer covering instead of a plain arc. Jesse asked for more detail and
  this delivered it while keeping the 15px silhouette contract (32% ink
  difference). Reverted only as collateral.
- **Drawn UI icons** — trophy, stopwatch, link, person, check, pause/play,
  pennant. These were fine; the **medals were not**. `MedalIcon` layered an
  absolutely-positioned numeral over a disc with ribbons and it didn't hold
  together at 22px. Anything here needs the medal redrawn from scratch, and
  Jesse is explicitly fine with emoji, so this is low priority.

## 3. Dead code

`src/components/HomeScreen.tsx` and `src/components/SetupScreen.tsx` are not
routed by `App.tsx` any more — it goes straight to the multiplayer lobby. They
still compile and still get restyled by every CSS pass. Either delete them or
decide the solo-vs-bots entry point is coming back.

## Working notes

- **No screenshots.** The agent sandbox composites no frames, so screenshot
  calls time out. Jesse's screenshots are the only ground truth for layout, type
  and color. Ask for them.
- **But icons can be checked**: rasterize the rendered `<svg>` to a canvas at
  N px and map each pixel's alpha through `' .:-=+*#%@'`. The result is legible
  as text and catches shape problems. That's how the girl's chin ribbons were
  caught rendering as detached floating marks. See DESIGN.md.
- **CSS transitions never advance in that sandbox** either — computed styles read
  back at their pre-transition value and look exactly like a cascade bug. Inject
  `* { transition: none !important }` before reading any computed style.
- Source files are **CRLF**. Scripted edits must normalize before matching or
  every multi-line pattern silently misses.
- **Conservatism is the standing instruction here.** The card sizing, animations
  and layout were tuned over many rounds with a previous session and are
  considered proven. Mobile correctness is paramount. Change surface, not
  geometry — and flag it rather than just doing it if something needs to move.
