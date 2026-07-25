# Visual system — barn folk art

The look is Pennsylvania Dutch folk art on a painted wooden table, because that
is literally what the game is: Dutch Blitz is a Pennsylvania Dutch game, "a
vonderful goot card game," played on a table. Following a real tradition beats
inventing a look, and it gives every decision an answer that isn't taste.

**`src/styles/index.css`'s `:root` block is the system.** Components use those
tokens; almost nothing sets a raw color.

## Rules

- **Warm, never neutral.** Every overlay is tinted toward the wood or the paper
  (`--paper-NN` / `--ink-NN`), never `rgba(0,0,0,x)` or `rgba(255,255,255,x)`. A
  grey overlay on a warm ground is the fastest way to make wood look like
  plastic. There are no bare neutrals left outside the token block; keep it that
  way.
- **Type**: Alfa Slab One for headings and card numbers (poster slab, reads like
  a county-fair sign), Karla for UI. Neither is a system default, which is the
  point — default type is the loudest signal that nobody chose anything.
- **Depth comes from borders and keylines, not blur or glow.** The double
  keyline on panels (`box-shadow: inset 0 0 0 1px …, inset 0 0 0 4px …`) is the
  routed border of a barn sign. Headings use a hard offset shadow — a second
  impression of the same letters, slightly off-register, like two-pass poster
  printing — never a soft halo.
- **Explicitly avoided**, because they are the house style of every generated
  dark UI and read as such: glassmorphism / `backdrop-filter`, gradient-filled
  buttons, colored glows, cards nested inside cards, overshoot ("bounce")
  easing, and system-default fonts. See <https://github.com/pbakaus/impeccable>.

## What is not up for redesign

**The four deck colors and their symbols are canon**, from the physical game:

| Color  | Symbol   | Gender group |
| ------ | -------- | ------------ |
| green  | Pump     | girl         |
| red    | Carriage | boy          |
| yellow | Pail     | girl         |
| blue   | Plow     | boy          |

The gender pairing is load-bearing, not decoration: post piles are built
descending and **alternating boy/girl**, so a player reads it on every move
(`src/game/rules.ts`).

## Icons — `src/components/icons.tsx`

Everything is drawn there, and nothing is an emoji any more. Emoji were wrong
three ways: they render as a different picture on every platform, they were the
wrong objects (a gas pump is not a cast-iron water pump; a tractor is not a
walking plow), and they drag another vendor's illustration style into a game
with a very specific one of its own.

The boy/girl icons are the ones with a hard constraint. They render at **15px**
on a small card, where the only thing that survives is the silhouette — so the
boy is a hard horizontal line (broad flat hat brim) and the girl is a rounded
arc (bonnet). Two shapes that stay distinct as a blur. That was measured, not
assumed: rasterized at 15px, **33% of the ink differs** between them.

If you redraw them, re-run that test. Anything under ~25% is too similar to tell
apart mid-game.

**The current pair is Jesse's own artwork**, vectorized and committed as `boy.svg`
and `girl.svg` at the repo root. `icons.tsx` uses that path data verbatim in its
native 1784x882 space and only picks a viewBox cropping to one 780x780 card
(`75.2 71 780 780` / `936.3 71 780 780`). Don't hand-tidy those paths, and don't
re-trace the artwork by eye — a pass that did exactly that produced visibly rough
shapes, which is why the vectors exist.

That crop is validated, not guessed: it puts the boy's brim at 90.6% of the icon
box against the previous hand-drawn icons' 90.8%, with the bust flush to the
bottom edge, so the figures land where the card-corner spacing is already tuned.

**Open trade-off, measured:** this pair runs **23.3% at 15px** and 26.8% at 28px,
against the previous pair's 28.1% / 30.5%. So at the 15px small-card size it sits
slightly UNDER the ~25% guideline above. The shapes are still a hard horizontal
brim versus a dome, but the girl's covering now flares down beside the face, which
brings her outline closer to the boy's brim-plus-shoulders mass. Measured across
sizes: 13px 25.8, 15px 23.3, 16px 24.1, 17px 24.8, 18px 27.3, 28px 26.8. If it
ever reads as too similar in play, the one-line lever is `iconSize` in
`DraggableCard.tsx` — 15 -> 18 buys 4 points. That is a change to tuned card
geometry, so it needs Jesse, not a unilateral edit.

**Interior detail must be ink, never a faded `currentColor`.** The figures are
solid `currentColor` (white, on a colored card), so a detail shape drawn in
`currentColor` at 0.3 opacity sits on top of that same color at full opacity and
renders as nothing at all. An earlier version of these icons did exactly that for
the hat band, suspenders, hair and cape collar, and the whole layer moved **0.37%**
of the icon's pixels. The same shapes filled with `DETAIL` (`#1d1009`, so they cut
into the figure) move **8%**. Use `DETAIL`, and measure rather than eyeballing.

### How to measure without a screenshot

The agent sandbox composites no frames, so screenshots time out — but canvas does
not need frames. Serialize the icon's `<svg>` to a `data:image/svg+xml` URL, load
it as an `Image`, `drawImage` it onto a canvas over the card color, and read
`getImageData`. From there:

- **detail visibility** — raster the icon with and without its opacity<1 shapes
  and count pixels that differ.
- **silhouette contract** — raster boy and girl at 15px, threshold each pixel to
  ink/no-ink, and report `differing / (ink in either)`.

Both numbers above came from that, run in the live preview tab.
