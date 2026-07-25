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

## Two traps this codebase hit for real

1. **Form controls do not inherit `font-family`.** Browsers hand `button`,
   `input`, `textarea` and `select` the system UI font regardless of what
   `body` says — which quietly left every button and input in the app rendering
   in **Arial**, one of the exact fonts you're told never to ship. Setting it
   per-class is whack-a-mole; `button, input, textarea, select { font: inherit }`
   in the base layer is the fix. If new text ever looks subtly off-brand, check
   this first.
2. **The hub "← All games" link is `position: fixed` at top-left**, so any
   screen whose content starts at the very top will collide with it on a narrow
   viewport — it landed on the wordmark. Menu screens reserve a 54px top strip.
   Keep that padding if you restructure them.

## Checking icons without being able to see them

There's no screenshot capability in the agent sandbox, but an SVG can be
rasterized in the page and read back as a density grid, which is enough to
catch shape problems:

```js
// serialize the rendered <svg>, draw it to a canvas at N px,
// then map each pixel's alpha through ' .:-=+*#%@'
```

That is how the boy/girl silhouettes were checked at 15px and how a set of
floating, detached marks (the girl's chin ribbons, which read as noise rather
than detail) were caught and removed.
