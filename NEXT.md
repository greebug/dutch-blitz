# Open work

State as of `769c5b5` (2026-07-25). Read `DESIGN.md` first for the visual system.

## 0. Single sign-on — PIN auth is gone (2026-07-26)

Accounts are shared across every game on bingbongblitz.com now, and **Guesswhere owns
them** (`../Guesswhere`, see its CLAUDE.md "Single sign-on"). It already had real
accounts — scrypt passwords, optional verified email, password reset — so this game
stopped keeping a second set of credentials rather than growing them.

**How identity arrives here.** Guesswhere's session cookie is scoped to `Path=/`, so it
comes in on the socket.io handshake by itself. `authenticateSocket()` forwards that raw
`Cookie` header to `GET ${GUESSWHERE_ORIGIN}/guesswhere/api/auth/me` and takes the answer
as authoritative. Nothing a client *says* about who it is is trusted anywhere.

Three things worth knowing before touching it:

- **It runs in `io.use()` middleware, not in the `connection` handler.** Middleware
  settles before the client's first event is delivered. Resolving it alongside
  `connection` left a real window — one network round-trip wide — where a `create_room`
  fired immediately on connect was treated as a guest's.
- **`handshake.headers` is frozen at connect time**, so a cookie written after the socket
  opened is invisible to the server. That is why signing in on the client **reconnects the
  socket** (`reauthenticate()` in `useMultiplayer.ts`) instead of emitting an "I signed in
  now" event: one cookie-reading code path covers every case.
- **`auth_state` fires on every connection, including guests' (as `null`).** "Signed out"
  and "haven't heard back yet" have to be distinguishable or the lobby renders a
  signed-out state for a beat on every load, which reads as having been logged out.

**Old records are kept, deliberately not merged.** Legacy PIN rows keep their wins and ELO
and stay on the boards forever, frozen — nothing can log into them any more. A Guesswhere
account gets a *new* row keyed on `gw_user_id`. That is why the migration drops the UNIQUE
on `accounts.name_lower`: it lets a Guesswhere "greebug" coexist with the legacy PIN
"greebug" instead of colliding on insert. **Consequence to expect, not a bug: the ELO
board can show the same display name twice.**

`SSO_CUTOVER` in the leaderboard query is the other half. Rows recorded before it rank
exactly as they did (PIN and guest alike — real history, nobody's records deleted); after
it, a round only ranks if it's attached to an account. Guest rounds are still *written*,
just not ranked.

**One new Railway variable:** `GUESSWHERE_ORIGIN=https://bingbongblitz.com`.

### Still unverified: the Postgres migration

The `ALTER TABLE`s in `initDb()` have **not** been run against a real database — there's no
Postgres, Docker or `psql` on the dev machine. Everything else was verified live: the
cookie resolves to the right user through the middleware, `[auth]` logs before the
connection handler (proving the ordering), and guests and junk cookies fall through
silently. **Watch the first deploy's boot logs**, or run the four statements by hand
against the Railway database first. They're all additive or constraint drops, so they're
safe to re-run.

### Base-path bugs fixed alongside it

`history.replaceState` and hand-built `location.origin` URLs get **no** rewrite from
Vite's `base` — they're just strings. Starting a room rewrote the address bar to
`bingbongblitz.com/?room=XXXX`, the *hub's* landing page, and the invite link copied that
same wrong URL. Both now go through `BASE` (`import.meta.env.BASE_URL`).

## 1. The Arial fallback — DONE (2026-07-25)

`button, input, textarea, select { font: inherit; color: inherit; }` is in
`src/styles/index.css`. Verified in the live DOM: all 19 form controls on the
lobby screen report Karla, and walking every text-bearing element for anything
outside Karla / Alfa Slab One returns zero.

The wordmark contrast went in at the same time — the single mid-orange offset
was close in value to the wood behind it, so the letters read furred. All four
display titles (`.lobby-title`, `.home-title`, `.setup-title`,
`.blitz-popup-title`) are a two-pass print now: a tight `--accent` impression,
then a hard `--wood-deep` offset under it for separation from the ground.

## 2. The rest of `1edb530`, if it's ever wanted

`1edb530` was reverted wholesale because its emoji-to-SVG swap wasn't an
improvement — the gold/silver/bronze medals in particular came out broken. It's
still in history and cherry-pickable piece by piece. What's in there, roughly
best to worst:

- **Top bar spacing** — "Round 1" runs into the first player's score. One
  `&nbsp;` in `GameBoard.tsx`. Uncontroversial.
- **Boy/girl detail** — hat band, suspenders, centre-parted hair, cape collar, a
  proper prayer covering instead of a plain arc. **Measured 2026-07-25 and it
  does not actually render.** Every one of those detail shapes is `currentColor`
  at opacity ~0.3, drawn *on top of* the solid same-color body beneath it — and
  white at 30% over opaque white is still white. Rasterized at 96px (3.4× the
  size it ever ships at), the whole detail layer moves **0.37%** of the icon's
  pixels. The current icons have the same flaw; only outline geometry really
  differs between the two. Refilling those same shapes with ink (`#000` at 0.3)
  so they *cut* into the figure instead of painting over it takes it to
  **8.1%**, and the 15px silhouette contract still holds at 28.1% (floor ~25%;
  current measures 32.2% on the same method, so any redraw here costs a little
  distinctness). All three previewed for Jesse; awaiting his call.
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
