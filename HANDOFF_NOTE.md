# Dutch Blitz — Handoff Note for Next Claude Instance

## What This Is

A **mobile-first Dutch Blitz card game** built in React 18 + TypeScript + Vite. It runs entirely in the browser, currently local-vs-bots only. The dev server runs with `npm run dev` (exposed on LAN via `--host` flag). The game is feature-complete for single-player-vs-bots and the next major milestone is **multiplayer with a lobby**.

---

## Current Feature State (as of this handoff)

### What's built and working
- Full Dutch Blitz rules engine (`src/game/engine.ts`, `src/game/rules.ts`)
- 1–3 bot opponents with 4 difficulty levels (easy / medium / hard / impossible)
- Drag-and-drop card play using Pointer Events API with `setPointerCapture` — works on mobile touch
- Post pile stacking with downward-growing sliver animation (oldest card stays fixed, new card appears slightly lower)
- Dutch pile free-placement: human player drops a "1" card and it appears in the nearest grid slot to the drop point; bots fill slots sequentially
- Bot card-play fly animation (card animates from opponent area to Dutch pile)
- Wood deck deal animation (card slides in when 3 new cards are drawn)
- Round end / game end detection, scoring (cards played − 2×blitz remaining), ELO tracking in localStorage
- Pause/resume, sound effects hook (placeholder — `useSounds.ts` is a stub)
- Responsive layout: sidebar opponents (left/right), top opponent, human player strip at bottom
- Rotate-to-landscape hint overlay (currently disabled via CSS comment)

### Layout architecture (important — don't break this)
```
.game-board (flex column, full screen)
  .top-bar         — round #, all scores, target score, pause button
  .play-area       — flex row
    .sidebar        — left bot (OpponentDisplay variant="sidebar")
    .center-column  — top bot (variant="top") + CenterPiles (Dutch oval)
    .sidebar.right  — right bot (variant="sidebar")
  .player-strip    — human player, always at bottom, full width
    .strip-tier1   — [Post1][Post2][Post3] ... [Blitz]  (margin-left:auto on blitz)
    .strip-tier2   — right-aligned: [Wood deck fan] [Active pile]
```

### Responsive breakpoints
- `--card-w: clamp(64px, 18vw, 92px)` — cards scale with viewport
- `@media (max-width: 540px)` — sidebars shrink to 80px
- Sidebar opponent grid: `68px` wide on phone (2-per-row → 2-2-1 layout), `100px` on tablet (3-per-row → 3-2 layout)

### Key data flow
```
App.tsx
  useReducer(gameReducer) → state + dispatch
  → GameBoard (receives state + dispatch)
      → animatedDispatch wraps dispatch to trigger fly animations for bots
      → useGameLoop(state, animatedDispatch, paused) — schedules bot ticks
      → PlayerArea (human player; drag events dispatch actions)
      → CenterPiles (16-slot fixed grid; piles render at pile.slot position)
      → OpponentDisplay ×1-3
```

### Important implementation details

**Dutch pile slot system** (`DutchPile.slot: number`):
- Each `DutchPile` has a `slot` (0–15) that determines its fixed grid position
- Human players: slot is chosen based on nearest empty slot to drop point (`slotIndex` in `PLAY_TO_CENTER` action)
- Bots: engine finds next free slot sequentially
- `CenterPiles.tsx` renders all 16 positions from a fixed `slots[]` array — piles never jump around

**Drag and drop** (`GameBoard.tsx`):
- `getDropTarget(x, y)` uses `document.elementsFromPoint` + `data-*` attributes
- `data-dutch-pile-id` on occupied slots and `"new"` on empty slots
- `data-dutch-slot-index` on empty slots (for nearest-slot detection)
- `data-post-pile-index` on post pile containers
- `data-opp-id` on opponent components (used by fly animation to get source rect)
- `highlightDutchSlotIndex` tracks the specific hovered empty slot (not all-at-once)

**Bot loop** (`useGameLoop.ts`):
- Uses `dispatchRef` pattern — always calls the latest `animatedDispatch` wrapper, not stale closures
- Re-initializes on `state.phase` and `state.roundNumber` changes only

**Post pile rendering** (`PlayerArea.tsx`):
- `SLIVER_PX = 12`, `MAX_SLIVERS = 3`
- Oldest card at top (y=0), newest at bottom; non-top cards clipped to 12px height
- Container height = `calc(var(--card-h) + ${sliversAbove * SLIVER_PX}px)`

---

## Recent Changes Made in This Session

1. **Bot fly animation slowed**: `0.38s → 0.6s` CSS + `450ms → 700ms` timeout
2. **Wood deal animation**: `PlayerArea` watches `woodActive.length`; plays `@keyframes woodDeal` slide-in when cards are drawn
3. **Nearest-slot Dutch placement**: `DutchPile.slot`, `PLAY_TO_CENTER.slotIndex?`, engine assigns slot, CenterPiles uses fixed 16-slot grid, GameBoard detects `data-dutch-slot-index`
4. **Dutch oval min-height glitch fix**: `min-height: 0 → 80px` on `.dutch-oval-container` prevents Safari flex collapse
5. **Wood/Active right-aligned**: `justify-content: flex-end` on `.strip-tier2`
6. **Sidebar opponent 2-2-1 layout**: Replaced two-row sidebar structure with a single `opp-sidebar-grid` flex-wrap container. Order: `[post1, post2, post3, wood, blitz]`. Phone (68px, gap 4px) → 2-2-1. Tablet (100px, gap 2px) → 3-2.

---

## Next Major Milestone: Multiplayer with Lobby

The user wants to add **real-time multiplayer**. Here is the full design discussed:

### Lobby / UX design
- One shared lobby per game room
- Host configures: number of players, bot difficulty fill-ins, target score
- Each joining player picks:
  - **Name** (text input)
  - **Color / symbol** — the 4 Dutch Blitz factions:
    - 🔴 Red Carriage
    - 🔵 Blue Plow  
    - 🟢 Green Pump
    - 🟡 Yellow Pail
  - (These map to the existing `CardColor` type: `red | blue | green | yellow`)
- Host sees a waiting room with connected players listed
- Host clicks "Start Game" when ready
- Game auto-fills empty slots with bots if configured

### Technical architecture needed

**Why WebSockets (not REST/Firebase):**
Dutch Blitz is extremely fast-paced with simultaneous play and race conditions (two players slam cards on the same pile at the same millisecond). You need:
- Persistent WebSocket connections (one per player, stays open during the game)
- **Server-authoritative** model: clients send proposed moves → server validates (first-come-first-served on pile conflicts) → server broadcasts new state to all clients

**Server responsibilities:**
- Room/lobby management (create, join by code, player list)
- Move `gameReducer` logic to server (it's already pure — easy to move)
- WebSocket broadcasting of state diffs or full state snapshots
- Conflict resolution: if two PLAY_TO_CENTER actions arrive for the same pile simultaneously, first one wins, second gets rejected (client re-syncs)
- Bot ticks run on server (move `useGameLoop` logic server-side)

**Client changes needed:**
- Replace `useReducer(gameReducer)` with a WebSocket subscriber
- Add lobby screen: room code entry, name + symbol picker
- Optimistic UI optional (show your own move immediately, reconcile if server rejects)
- Reconnect handling

### Hosting options discussed

**Recommended stack:**
| Component | Service | Cost |
|---|---|---|
| Domain | Porkbun or Cloudflare Registrar | ~$10/yr |
| DNS | Cloudflare (free) | Free |
| Frontend | Cloudflare Pages or Vercel | Free |
| WebSocket backend | **Partykit** (easiest) OR **Railway + Socket.io** | Free–$10/mo |

**Partykit** is the top recommendation — it's purpose-built for real-time multiplayer, uses Durable Objects (each room is a persistent server instance), no cold starts, globally distributed. Ideal for a card game.

**Railway + Socket.io** is the alternative if you prefer a conventional Node.js server you can reason about more easily.

**Domain**: User is considering domain.com but was advised that Porkbun or Cloudflare Registrar are cheaper with better features. The registrar choice doesn't affect hosting — DNS records can point anywhere.

### Suggested implementation order for multiplayer

1. **Create shared game logic package** — extract `src/game/` into a shared module usable by both client and server
2. **Build the WebSocket server** — room management, player registration, game state authority
3. **Add lobby screen** — `LobbyScreen.tsx`: room code, name + symbol picker, waiting room
4. **Wire client WebSocket** — replace `useReducer` with server-synced state
5. **Deploy** — frontend to Cloudflare Pages, backend to Partykit or Railway
6. **Domain** — point DNS to the deployed frontend

---

## File Structure

```
src/
  App.tsx                  — top-level: setup screen → game board
  main.tsx                 — React root mount
  components/
    CenterPiles.tsx         — Dutch pile 16-slot grid, handles drag highlights
    DraggableCard.tsx       — CardDisplay, CardBack, EmptySlot components
    GameBoard.tsx           — main game orchestrator, drag-and-drop, bot animations
    GameOverScreen.tsx      — round/game end stats, ELO display
    OpponentDisplay.tsx     — sidebar (2-2-1 phone, 3-2 tablet) and top (inline) variants
    PlayerArea.tsx          — human player strip, tier1 (posts+blitz) + tier2 (wood+active)
    SetupScreen.tsx         — game configuration before starting
  game/
    types.ts                — Card, DutchPile (with slot:number), PlayerState, GameAction, etc.
    engine.ts               — gameReducer, all action handlers
    rules.ts                — canPlayOnDutchPile, canPlayOnPostPile, canStartNewDutchPile
    deck.ts                 — card dealing / shuffling
    bot.ts                  — getBotAction (priority-based AI), getBotInterval
    stats.ts                — ELO calculation, localStorage persistence
  hooks/
    useGameLoop.ts          — schedules bot ticks per round, uses dispatchRef pattern
    useSounds.ts            — sound effect stubs (to be implemented)
  styles/
    index.css               — all CSS (no CSS modules); uses CSS custom properties for card sizing
```

---

## Running the Project

```bash
npm install
npm run dev        # starts on http://localhost:5173 and LAN IP:5173
npm run build      # production build to /dist
npx tsc --noEmit   # type check (should produce no output)
```

---

## Notes for Next Claude

- TypeScript is strict — run `npx tsc --noEmit` after any changes; it should always be clean
- CSS uses `var(--card-w)` and `var(--card-h)` everywhere — don't hardcode pixel values for card dimensions
- The `animatedDispatch` wrapper in `GameBoard.tsx` must always be passed to `useGameLoop` (not raw `dispatch`) so bot plays trigger fly animations
- `data-*` attributes on DOM elements are the drop-target detection mechanism — be careful not to remove them during refactoring
- The `slot` field on `DutchPile` is required (not optional) — all new piles must have a slot assigned in the engine
- The sidebar opponent uses `data-opp-id={player.id}` for the fly animation source rect — keep this on the outer container
- Sound effects (`useSounds`) are currently stubs returning no-op functions — a good stretch goal to implement
