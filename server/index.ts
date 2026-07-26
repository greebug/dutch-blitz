// Mock browser APIs before any game imports touch them
(global as any).localStorage = {
  _store: {} as Record<string, string>,
  getItem(k: string) { return this._store[k] ?? null; },
  setItem(k: string, v: string) { this._store[k] = v; },
  removeItem(k: string) { delete this._store[k]; },
  clear() { this._store = {}; },
  get length() { return Object.keys(this._store).length; },
  key(i: number) { return Object.keys(this._store)[i] ?? null; },
};

import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import path from 'path';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { gameReducer } from '../src/game/engine';
import { dealPlayer } from '../src/game/deck';
import { getBotAction, getBotInterval } from '../src/game/bot';
import {
  CardColor,
  BotDifficulty,
  GameState,
  GameAction,
  PlayerState,
} from '../src/game/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LobbyPlayer {
  socketId: string;
  playerId: string;
  name: string;
  faction: CardColor | null;
  isHost: boolean;
}

export interface RoomConfig {
  targetScore: number;
  botDifficulty: BotDifficulty;
}

interface Room {
  code: string;
  players: LobbyPlayer[];
  config: RoomConfig;
  gameState: GameState | null;
  phase: 'lobby' | 'playing';
  botTimers: ReturnType<typeof setTimeout>[];
  statsSaved: boolean;
  gameId: string;
  lastSavedRound: number;
  countingDown: boolean;
}

// ─── Database ─────────────────────────────────────────────────────────────────

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

async function initDb() {
  if (!pool) { console.log('No DATABASE_URL — accounts/stats disabled'); return; }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id            SERIAL PRIMARY KEY,
      name_lower    TEXT UNIQUE NOT NULL,
      display_name  TEXT NOT NULL,
      pin_hash      TEXT NOT NULL,
      wins          INTEGER DEFAULT 0,
      games_played  INTEGER DEFAULT 0,
      rounds_played INTEGER DEFAULT 0,
      elo           INTEGER DEFAULT 1200,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS round_records (
      id            SERIAL PRIMARY KEY,
      account_id    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      player_name   TEXT NOT NULL,
      game_id       TEXT NOT NULL,
      round_number  INTEGER NOT NULL,
      cards_played  INTEGER NOT NULL,
      duration_secs FLOAT NOT NULL,
      secs_per_play FLOAT NOT NULL,
      target_score  INTEGER NOT NULL,
      played_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // ── Single sign-on migration ────────────────────────────────────────────
  // Accounts used to be name + 4-digit PIN, local to this game. Identity now
  // comes from a Guesswhere account shared across every game on
  // bingbongblitz.com, and `gw_user_id` is the key.
  //
  // Every statement is additive or a constraint drop, so it is safe to run
  // against the live table on each boot:
  //
  //  - `pin_hash` goes nullable because new rows have no PIN at all. Legacy
  //    rows keep theirs; nothing can log in with it any more.
  //  - `name_lower` STOPS being unique. That is what lets a Guesswhere
  //    "greebug" coexist with the frozen legacy PIN "greebug" instead of
  //    colliding on insert. Deliberate per the migration decision: old records
  //    stay live and untouched, new ones start fresh. Two rows CAN therefore
  //    show the same display name on the ELO board, one legacy and one live.
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS gw_user_id TEXT`);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS accounts_gw_user
       ON accounts (gw_user_id) WHERE gw_user_id IS NOT NULL`
  );
  await pool.query(`ALTER TABLE accounts ALTER COLUMN pin_hash DROP NOT NULL`);

  // The UNIQUE on name_lower is dropped by LOOKING UP its real name rather than
  // assuming Postgres's default `accounts_name_lower_key`. A `DROP CONSTRAINT
  // IF EXISTS` on a guessed name is a silent no-op when the guess is wrong, and
  // the symptom would be a duplicate-key error on someone's first sign-in --
  // long after this ran, with nothing in the logs pointing back here.
  const { rows: nameConstraints } = await pool.query<{ conname: string }>(
    `SELECT c.conname
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.conrelid = 'accounts'::regclass
        AND c.contype  = 'u'
        AND a.attname  = 'name_lower'
        AND array_length(c.conkey, 1) = 1`
  );
  for (const { conname } of nameConstraints) {
    await pool.query(`ALTER TABLE accounts DROP CONSTRAINT "${conname}"`);
    console.log(`Dropped UNIQUE constraint ${conname} on accounts.name_lower`);
  }

  // Blueberry Trio — community-published puzzles.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS trio_puzzles (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      author      TEXT NOT NULL,
      difficulty  INTEGER NOT NULL,
      clues       JSONB NOT NULL,
      solution    JSONB,
      source      TEXT NOT NULL DEFAULT 'set',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('Database ready');
}
initDb().catch(console.error);

interface AccountInfo { id: number; displayName: string; }
const socketToAccount = new Map<string, AccountInfo>();

// ─── Single sign-on ───────────────────────────────────────────────────────────

// Guesswhere owns accounts for every game on bingbongblitz.com. Its session
// cookie is scoped to the whole domain, so it arrives here on the socket.io
// handshake by itself -- we just have to ask Guesswhere who it belongs to.
//
// The cookie is httpOnly and the client never sees its contents, so this is the
// only thing on this server that decides who a player is. Nothing a client
// *says* about its identity is trusted anywhere.
const GUESSWHERE_ORIGIN = process.env.GUESSWHERE_ORIGIN ?? 'https://bingbongblitz.com';

interface GwUser { id: string; username: string; }

/** Resolves a raw Cookie header to a Guesswhere account, or null. Any failure
 * -- unreachable, timed out, no cookie, not signed in -- is a null, which
 * means the player carries on as a guest rather than being locked out. */
async function resolveGwUser(cookieHeader: string | undefined): Promise<GwUser | null> {
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${GUESSWHERE_ORIGIN}/guesswhere/api/auth/me`, {
      headers: { Cookie: cookieHeader },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { user: GwUser | null };
    return data.user ?? null;
  } catch (e) {
    console.error('resolveGwUser error:', e);
    return null;
  }
}

/** The Blitz-side stats row for a Guesswhere account, created on first sight.
 * Legacy PIN rows are never adopted -- they are matched on `name_lower`, this
 * matches on `gw_user_id`, and the two never meet. */
async function accountForGwUser(user: GwUser): Promise<AccountInfo | null> {
  if (!pool) return null;
  const { rows } = await pool.query(
    `INSERT INTO accounts (name_lower, display_name, gw_user_id)
       VALUES ($1, $2, $3)
     ON CONFLICT (gw_user_id) WHERE gw_user_id IS NOT NULL
       DO UPDATE SET display_name = EXCLUDED.display_name,
                     name_lower   = EXCLUDED.name_lower
     RETURNING id, display_name`,
    [user.username.toLowerCase(), user.username, user.id]
  );
  return { id: rows[0].id, displayName: rows[0].display_name };
}

/** Reads the handshake cookie and resolves who is on the other end.
 *
 * Runs once per connection, because `handshake.headers` is frozen at connect
 * time -- a cookie set after the socket opened is invisible here until a new
 * handshake. That is why the client reconnects its socket after signing in
 * rather than emitting some "I signed in now" event: one code path, and the
 * server never has to take the client's word for anything. */
async function authenticateSocket(socket: Socket): Promise<void> {
  const user = await resolveGwUser(socket.handshake.headers.cookie);
  if (!user) return; // guest
  try {
    const account = await accountForGwUser(user);
    if (!account) {
      // Recognised, but there is no stats database to file them under (no
      // DATABASE_URL). Worth its own line: otherwise this is indistinguishable
      // in the logs from a cookie that failed to resolve at all, and the two
      // have completely different causes.
      console.log(`[auth] ${socket.id} = ${user.username} (no stats DB -- unranked)`);
      return;
    }
    socketToAccount.set(socket.id, account);
    console.log(`[auth] ${socket.id} = ${account.displayName}`);
  } catch (e) {
    console.error('authenticateSocket error:', e);
  }
}

// Bot ELO ratings used in ELO calculations
const BOT_ELO: Record<string, number> = { easy: 800, medium: 1200, hard: 1600, impossible: 2200 };

async function saveRoundRecord(room: Room) {
  if (!pool || !room.gameState?.lastRound) return;
  const lr = room.gameState.lastRound;
  if (room.lastSavedRound >= lr.roundNumber) return; // already saved
  room.lastSavedRound = lr.roundNumber;

  for (const player of room.players) {
    const cards = lr.cardsPlayed[player.playerId] ?? 0;
    if (cards < 3 || lr.duration <= 0) continue;
    const secsPerPlay = lr.duration / cards;
    const account = socketToAccount.get(player.socketId);
    try {
      await pool.query(
        `INSERT INTO round_records
           (account_id, player_name, game_id, round_number, cards_played, duration_secs, secs_per_play, target_score)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [account?.id ?? null, player.name, room.gameId, lr.roundNumber,
         cards, lr.duration, secsPerPlay, room.config.targetScore]
      );
    } catch (e) { console.error('saveRoundRecord error:', e); }
  }
}

/** Sends one socket its account's headline stats, or `null` for a guest.
 *
 * The client keys its whole signed-in state off this event, which is why it
 * fires on EVERY connection including guests': "not signed in" and "haven't
 * heard back yet" have to be distinguishable, or the lobby renders a
 * signed-out state for a moment on every load for someone who is signed in. */
async function emitAccountStats(socketId: string, account: AccountInfo | null) {
  if (!pool || !account) {
    io.to(socketId).emit('auth_state', null);
    return;
  }
  const { rows } = await pool.query(
    `SELECT wins, games_played, rounds_played, elo FROM accounts WHERE id = $1`,
    [account.id]
  );
  if (rows.length === 0) {
    io.to(socketId).emit('auth_state', null);
    return;
  }
  const row = rows[0];
  const speedRes = await pool.query(
    `SELECT MIN(secs_per_play)                                 AS best_speed,
            SUM(duration_secs) / NULLIF(SUM(cards_played), 0) AS avg_speed
     FROM round_records WHERE account_id = $1 AND cards_played >= 5`,
    [account.id]
  );
  const sr = speedRes.rows[0];
  io.to(socketId).emit('auth_state', {
    displayName: account.displayName,
    stats: {
      wins:           parseInt(row.wins),
      gamesPlayed:    parseInt(row.games_played),
      roundsPlayed:   parseInt(row.rounds_played),
      elo:            parseInt(row.elo),
      bestRoundSpeed: sr?.best_speed != null ? parseFloat(sr.best_speed) : null,
      avgGameSpeed:   sr?.avg_speed  != null ? parseFloat(sr.avg_speed)  : null,
    },
  });
}

async function refreshPlayerStats(room: Room) {
  if (!pool) return;
  for (const player of room.players) {
    const account = socketToAccount.get(player.socketId);
    if (!account) continue;
    try {
      await emitAccountStats(player.socketId, account);
    } catch (e) { console.error('refreshPlayerStats error:', e); }
  }
}

async function saveGameStats(room: Room) {
  if (!pool || room.statsSaved || !room.gameState || room.gameState.phase !== 'gameEnd') return;
  room.statsSaved = true;

  const gs = room.gameState;
  const ranked = [...gs.players].sort((a, b) => b.totalScore - a.totalScore);

  // Look up current ELO + games_played for all authenticated players in one query
  const authPlayers = room.players
    .map(p => ({ lp: p, account: socketToAccount.get(p.socketId) }))
    .filter((x): x is { lp: LobbyPlayer; account: AccountInfo } => x.account !== undefined);

  const accountIds = authPlayers.map(x => x.account.id);
  const dbRows = accountIds.length > 0
    ? (await pool.query('SELECT id, elo, games_played FROM accounts WHERE id = ANY($1)', [accountIds])).rows
    : [];
  const dbInfo = new Map<number, { elo: number; gamesPlayed: number }>(
    dbRows.map(r => [r.id, { elo: parseInt(r.elo), gamesPlayed: parseInt(r.games_played) }])
  );

  for (const { lp: player, account } of authPlayers) {
    const isWinner = player.playerId === gs.gameWinnerId;
    const rank = ranked.findIndex(p => p.id === player.playerId);
    const result = rank === 0 ? 1 : rank === ranked.length - 1 ? 0 : 0.5;

    // Average opponent ELO
    const opponentElos = gs.players
      .filter(p => p.id !== player.playerId)
      .map(p => {
        if (p.isBot) return BOT_ELO[p.botDifficulty ?? 'medium'] ?? 1200;
        const oppLobby = room.players.find(rp => rp.playerId === p.id);
        if (oppLobby) {
          const oppAccount = socketToAccount.get(oppLobby.socketId);
          if (oppAccount) return dbInfo.get(oppAccount.id)?.elo ?? 1200;
        }
        return 1200;
      });
    const avgOppElo = opponentElos.reduce((a, b) => a + b, 0) / (opponentElos.length || 1);

    const info = dbInfo.get(account.id);
    const currentElo = info?.elo ?? 1200;
    const gamesPlayed = info?.gamesPlayed ?? 0;
    const K = gamesPlayed < 30 ? 32 : 16;
    const expected = 1 / (1 + Math.pow(10, (avgOppElo - currentElo) / 400));
    const eloChange = Math.round(K * (result - expected));

    try {
      await pool.query(
        `UPDATE accounts
           SET games_played  = games_played  + 1,
               wins          = wins          + $1,
               rounds_played = rounds_played + $2,
               elo           = elo           + $3
         WHERE id = $4`,
        [isWinner ? 1 : 0, gs.roundNumber, eloChange, account.id]
      );
    } catch (e) { console.error('saveGameStats error:', e); }
  }
}

// ─── Server setup ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '128kb' })); // for the Trio puzzle API (game uses sockets)
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

// ─── Blueberry Trio: community puzzle API ───────────────────────────────────────
// Open publishing (no auth) — the client validates uniqueness before posting; the
// server does basic shape validation and stores. `source` is 'set' (hand-crafted)
// or 'build' (constraint-generated), used to bucket puzzles in the Play catalog.
app.post('/trio/api/puzzles', async (req, res) => {
  if (!pool) { res.status(503).json({ error: 'database unavailable' }); return; }
  try {
    const { name, author, difficulty, clues, solution, source } = req.body ?? {};
    if (typeof author !== 'string' || !author.trim()) { res.status(400).json({ error: 'author required' }); return; }
    if (!Array.isArray(clues) || clues.length === 0 || clues.length > 81) { res.status(400).json({ error: 'invalid clues' }); return; }
    for (const c of clues) {
      if (typeof c?.r !== 'number' || typeof c?.c !== 'number' || typeof c?.v !== 'number' ||
          c.r < 1 || c.r > 9 || c.c < 1 || c.c > 9 || c.v < 0 || c.v > 8) {
        res.status(400).json({ error: 'invalid clue' }); return;
      }
    }
    const src = source === 'build' ? 'build' : 'set';
    const nm = (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 60) : 'Untitled';
    const diff = Number.isInteger(difficulty) && difficulty >= 1 && difficulty <= 5 ? difficulty : 3;
    const r = await pool.query(
      `INSERT INTO trio_puzzles (name, author, difficulty, clues, solution, source)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
      [nm, author.trim().slice(0, 40), diff, JSON.stringify(clues), solution ? JSON.stringify(solution) : null, src]
    );
    res.json({ id: r.rows[0].id, created_at: r.rows[0].created_at });
  } catch (e: any) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.get('/trio/api/puzzles', async (_req, res) => {
  if (!pool) { res.json([]); return; }
  try {
    const r = await pool.query(
      `SELECT id, name, author, difficulty, clues, solution, source, created_at
       FROM trio_puzzles ORDER BY created_at DESC LIMIT 500`
    );
    res.json(r.rows);
  } catch (e: any) {
    res.status(500).json({ error: String(e.message) });
  }
});

const rooms = new Map<string, Room>();
const socketToRoom = new Map<string, string>();
// Pending cleanup timers — keyed by socket ID that disconnected.
// Gives players 60 s to reconnect before their slot is released.
const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ─── Health / diagnostics ─────────────────────────────────────────────────────

// Deliberately NOT under /blitz: Railway probes this on the origin directly,
// never through the hub Worker, so it stays at the origin root. It is also what
// railway.json's healthcheckPath points at now that / is a redirect rather than
// the app itself.
app.get('/api/health', async (_req, res) => {
  if (!pool) {
    res.json({ db: false, message: 'No DATABASE_URL — stats disabled' });
    return;
  }
  try {
    await pool.query('SELECT 1');
    res.json({ db: true, message: 'Database connected' });
  } catch (e: any) {
    res.json({ db: false, message: String(e.message) });
  }
});

// ─── Leaderboard API ──────────────────────────────────────────────────────────

// When PIN sign-on was retired for shared bingbongblitz.com accounts. Rows
// recorded BEFORE this stand exactly as they were -- PIN-account and guest
// alike, they are the game's real history and nobody's records get deleted.
// After it, a round only ranks if it is attached to an account, which is what
// "make an account to get on the leaderboard, or just play as guest" means in
// SQL. The wins and ELO boards read `accounts` directly and need no cutover:
// legacy rows keep their totals forever, frozen, because nothing can log into
// them any more.
const SSO_CUTOVER = '2026-07-26';
const RANKS_SQL = `(account_id IS NOT NULL OR played_at < '${SSO_CUTOVER}')`;

// Under /blitz because this one IS fetched by the browser, and the browser now
// talks to bingbongblitz.com, where /blitz/* is what routes here.
app.get('/blitz/api/leaderboard', async (_req, res) => {
  if (!pool) {
    res.json({ speed: [], avgSpeed: [], wins: [], elo: [] });
    return;
  }
  try {
    const [speedRes, avgRes, winsRes, eloRes] = await Promise.all([
      // Tab 1: Best single-round speed (min 5 cards)
      pool.query(`
        SELECT player_name, secs_per_play, cards_played, played_at
        FROM round_records
        WHERE cards_played >= 5 AND ${RANKS_SQL}
        ORDER BY secs_per_play ASC
        LIMIT 3
      `),
      // Tab 2: Best average game speed (target >= 75)
      pool.query(`
        SELECT player_name,
               SUM(duration_secs) / NULLIF(SUM(cards_played), 0) AS avg_secs,
               SUM(cards_played) AS total_cards
        FROM round_records
        WHERE target_score >= 75 AND cards_played >= 5 AND ${RANKS_SQL}
        GROUP BY player_name, game_id
        ORDER BY avg_secs ASC
        LIMIT 3
      `),
      // Tab 3: Total wins by account
      pool.query(`
        SELECT display_name, wins, games_played
        FROM accounts
        WHERE wins > 0
        ORDER BY wins DESC
        LIMIT 3
      `),
      // Tab 4: Top ELO ratings (min 3 games to qualify)
      pool.query(`
        SELECT display_name, elo, games_played, wins
        FROM accounts
        WHERE games_played >= 3
        ORDER BY elo DESC
        LIMIT 10
      `),
    ]);
    res.json({ speed: speedRes.rows, avgSpeed: avgRes.rows, wins: winsRes.rows, elo: eloRes.rows });
  } catch (e) {
    console.error('leaderboard error:', e);
    res.json({ speed: [], avgSpeed: [], wins: [] });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateCode() : code;
}

function broadcastLobby(room: Room) {
  io.to(room.code).emit('lobby_update', {
    code: room.code,
    players: room.players,
    config: room.config,
    hostId: room.players.find(p => p.isHost)?.playerId ?? null,
  });
}

function broadcastState(room: Room) {
  if (room.gameState) {
    io.to(room.code).emit('game_state', { state: room.gameState });
    if (room.gameState.phase === 'roundEnd' || room.gameState.phase === 'gameEnd') {
      saveRoundRecord(room).catch(console.error);
    }
    if (room.gameState.phase === 'gameEnd') {
      saveGameStats(room)
        .then(() => refreshPlayerStats(room))
        .catch(console.error);
    }
  }
}

function stopBots(room: Room) {
  room.botTimers.forEach(clearTimeout);
  room.botTimers = [];
}

function startBots(room: Room) {
  stopBots(room);
  if (!room.gameState) return;

  const bots = room.gameState.players.filter(p => p.isBot);

  function scheduleTick(botId: string, difficulty: BotDifficulty) {
    const delay = getBotInterval(difficulty);
    const timer = setTimeout(() => {
      if (!room.gameState || room.gameState.phase !== 'playing') return;
      const action = getBotAction(room.gameState, botId);
      if (action) {
        room.gameState = gameReducer(room.gameState, action);
        broadcastState(room);
      }
      scheduleTick(botId, difficulty);
    }, delay);
    room.botTimers.push(timer);
  }

  for (const bot of bots) {
    if (bot.botDifficulty) scheduleTick(bot.id, bot.botDifficulty);
  }
}

function cleanupSocket(socketId: string) {
  socketToAccount.delete(socketId);
  const code = socketToRoom.get(socketId);
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;

  const leaving = room.players.find(p => p.socketId === socketId);
  room.players = room.players.filter(p => p.socketId !== socketId);
  socketToRoom.delete(socketId);

  if (room.players.length === 0) {
    stopBots(room);
    rooms.delete(code);
    console.log(`Room ${code} deleted (empty)`);
    return;
  }

  if (leaving?.isHost) room.players[0].isHost = true;

  if (room.phase === 'lobby') {
    broadcastLobby(room);
  } else {
    io.to(code).emit('player_left', { name: leaving?.name ?? 'A player' });
  }
}

// ─── Socket handlers ──────────────────────────────────────────────────────────

// Identity is resolved in MIDDLEWARE rather than in the connection handler, so
// it is settled before the client's first event is delivered. Resolving it
// asynchronously alongside `connection` would leave a real window -- one
// network round-trip to Guesswhere wide -- in which a `create_room` fired
// immediately on connect would be treated as a guest's and get the typed name
// instead of the account's.
//
// `next()` is never called with an error: a player whose identity can't be
// established plays as a guest, they don't get refused a connection.
io.use((socket, next) => {
  authenticateSocket(socket).catch(console.error).finally(() => next());
});

io.on('connection', (socket: Socket) => {
  console.log(`[+] ${socket.id}`);

  // Identity came from the handshake cookie in the middleware above; this just
  // tells the client about it. Guests get an explicit null.
  emitAccountStats(socket.id, socketToAccount.get(socket.id) ?? null).catch(console.error);

  /** The name a player actually plays under. A signed-in player's is the
   * account's, taken server-side -- so the name on the scoreboard is always
   * the name the record is filed under, and can't be spoofed by editing the
   * field. Guests get whatever they typed. */
  function nameFor(claimed: string): string {
    return socketToAccount.get(socket.id)?.displayName ?? claimed;
  }

  // ── Create room ──────────────────────────────────────────────────────────
  socket.on('create_room', ({
    name: claimedName, config,
  }: { name: string; config: RoomConfig }) => {
    const code = generateCode();
    const playerId = socket.id;
    const name = nameFor(claimedName);

    const room: Room = {
      code,
      players: [{ socketId: socket.id, playerId, name, faction: null, isHost: true }],
      config: {
        targetScore: config.targetScore ?? 75,
        botDifficulty: config.botDifficulty ?? 'medium',
      },
      gameState: null,
      phase: 'lobby',
      botTimers: [],
      statsSaved: false,
      gameId: randomUUID(),
      lastSavedRound: 0,
      countingDown: false,
    };

    rooms.set(code, room);
    socketToRoom.set(socket.id, code);
    socket.join(code);

    socket.emit('room_created', { code, playerId });
    broadcastLobby(room);
    console.log(`Room ${code} created by ${name}`);
  });

  // ── Join room ────────────────────────────────────────────────────────────
  socket.on('join_room', ({
    code, name: claimedName,
  }: { code: string; name: string }) => {
    const name = nameFor(claimedName);
    const room = rooms.get(code.toUpperCase().trim());

    if (!room) {
      socket.emit('room_error', { message: 'Room not found. Check the code.' });
      return;
    }
    if (room.phase === 'playing') {
      socket.emit('room_error', { message: 'Game already started.' });
      return;
    }
    if (room.players.length >= 4) {
      socket.emit('room_error', { message: 'Room is full (4 players max).' });
      return;
    }

    const playerId = socket.id;
    room.players.push({ socketId: socket.id, playerId, name, faction: null, isHost: false });
    socketToRoom.set(socket.id, code);
    socket.join(code);

    socket.emit('room_joined', { playerId, code: room.code });
    broadcastLobby(room);
    console.log(`${name} joined room ${room.code}`);
  });

  // ── Change faction (lobby only) ──────────────────────────────────────────
  socket.on('change_faction', ({ faction }: { faction: CardColor }) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.phase !== 'lobby') return;
    if (room.players.some(p => p.socketId !== socket.id && p.faction === faction)) {
      socket.emit('room_error', { message: 'That faction is already taken. Pick another.' });
      return;
    }
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;
    player.faction = faction;
    broadcastLobby(room);
  });

  // ── Update config (host only) ────────────────────────────────────────────
  socket.on('update_config', (config: Partial<RoomConfig>) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    if (room.players.find(p => p.socketId === socket.id)?.isHost !== true) return;
    room.config = { ...room.config, ...config };
    broadcastLobby(room);
  });

  // ── Start game (host only) ───────────────────────────────────────────────
  socket.on('start_game', () => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.phase !== 'lobby') return;
    if (room.players.find(p => p.socketId === socket.id)?.isHost !== true) return;

    const unpicked = room.players.find(p => p.faction === null);
    if (unpicked) {
      socket.emit('room_error', { message: `${unpicked.name} hasn't picked a faction yet.` });
      return;
    }

    const humanPlayers: PlayerState[] = room.players.map(p =>
      dealPlayer(p.playerId, p.name, false, undefined, 0, p.faction!)
    );

    const numBots = Math.max(0, 4 - room.players.length);
    const usedFactions = new Set(room.players.map(p => p.faction as CardColor));
    const availFactions: CardColor[] = (['red', 'blue', 'green', 'yellow'] as CardColor[])
      .filter(f => !usedFactions.has(f));
    const factionNames: Record<CardColor, string> = {
      red: 'Carriage', blue: 'Plow', green: 'Pump', yellow: 'Pail',
    };

    const botPlayers: PlayerState[] = [];
    for (let i = 0; i < numBots; i++) {
      const faction = availFactions[i];
      botPlayers.push(
        dealPlayer(`bot-${i}`, factionNames[faction], true, room.config.botDifficulty, 0, faction)
      );
    }

    const allPlayers = [...humanPlayers, ...botPlayers];

    // Reset per-game state
    room.gameId = randomUUID();
    room.lastSavedRound = 0;
    room.statsSaved = false;

    room.gameState = {
      phase: 'playing',
      players: allPlayers,
      centerPiles: [],
      roundNumber: 1,
      roundStartTime: 0,
      targetScore: room.config.targetScore,
    };
    room.phase = 'playing';

    io.to(code).emit('countdown', { count: 3 });
    setTimeout(() => io.to(code).emit('countdown', { count: 2 }), 1000);
    setTimeout(() => io.to(code).emit('countdown', { count: 1 }), 2000);
    setTimeout(() => {
      if (!room.gameState) return;
      room.gameState.roundStartTime = Date.now();
      broadcastState(room);
      startBots(room);
      console.log(`Game started in room ${code} with ${allPlayers.length} players`);
    }, 3000);
  });

  // ── Game action ──────────────────────────────────────────────────────────
  socket.on('action', (action: GameAction) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room?.gameState || room.gameState.phase !== 'playing') return;

    // After a reconnect socket.id changes, so compare against the room's stored
    // playerId (which is stable across reconnects) rather than socket.id directly.
    const actingPlayer = room.players.find(p => p.socketId === socket.id);
    if ('playerId' in action && (action as any).playerId !== actingPlayer?.playerId) return;

    const prevPhase = room.gameState.phase;
    room.gameState = gameReducer(room.gameState, action);

    if (room.gameState.phase !== 'playing' && prevPhase === 'playing') {
      stopBots(room);
    }

    broadcastState(room);
  });

  // ── Next round (any player) ──────────────────────────────────────────────
  socket.on('next_round', () => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room?.gameState) return;
    if (room.gameState.phase !== 'roundEnd' && room.gameState.phase !== 'gameEnd') return;
    if (room.countingDown) return; // debounce — ignore while countdown is already running
    room.countingDown = true;

    io.to(code).emit('countdown', { count: 3 });
    setTimeout(() => io.to(code).emit('countdown', { count: 2 }), 1000);
    setTimeout(() => io.to(code).emit('countdown', { count: 1 }), 2000);
    setTimeout(() => {
      room.countingDown = false;
      if (!room.gameState) return;
      if (room.gameState.phase !== 'roundEnd' && room.gameState.phase !== 'gameEnd') return;
      room.gameState = gameReducer(room.gameState, { type: 'NEXT_ROUND' });
      if (room.gameState.roundStartTime === 0) room.gameState.roundStartTime = Date.now();
      broadcastState(room);
      if (room.gameState.phase === 'playing') startBots(room);
    }, 3000);
  });

  // ── Pause / resume bots ──────────────────────────────────────────────────
  socket.on('pause_game', () => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room?.gameState || room.gameState.phase !== 'playing') return;
    stopBots(room);
  });

  socket.on('resume_game', () => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room?.gameState || room.gameState.phase !== 'playing') return;
    startBots(room);
  });

  // ── Chat message ─────────────────────────────────────────────────────────
  socket.on('chat_message', ({ text }: { text: string }) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    const trimmed = text.trim().slice(0, 200);
    if (!trimmed) return;

    io.to(code).emit('chat_update', {
      playerId: socket.id,
      name: player.name,
      faction: player.faction,
      text: trimmed,
      timestamp: Date.now(),
    });
  });

  // ── Leave ─────────────────────────────────────────────────────────────────
  socket.on('leave', () => {
    cleanupSocket(socket.id);
    socket.emit('left_room');
  });

  // ── Rejoin (after phone lock / brief disconnect) ─────────────────────────
  socket.on('rejoin_room', ({ code, playerId }: { code: string; playerId: string }) => {
    if (!code || !playerId) return; // guard against malformed payload
    const room = rooms.get(code.toUpperCase());
    if (!room) {
      socket.emit('room_error', { message: 'Room no longer exists.' });
      return;
    }
    const player = room.players.find(p => p.playerId === playerId);
    if (!player) {
      socket.emit('room_error', { message: 'Your slot is no longer available.' });
      return;
    }

    // Cancel the pending cleanup for the old socket
    const oldSocketId = player.socketId;
    const timer = disconnectTimers.get(oldSocketId);
    if (timer) { clearTimeout(timer); disconnectTimers.delete(oldSocketId); }

    // Re-map to new socket
    socketToRoom.delete(oldSocketId);
    socketToRoom.set(socket.id, room.code);
    // The account is NOT carried over from the old socket. This connection did
    // its own handshake and the middleware already resolved its cookie, which
    // is the more current answer -- carrying the old entry forward would
    // resurrect an identity someone had just signed out of.
    socketToAccount.delete(oldSocketId);
    player.socketId = socket.id;
    socket.join(room.code);

    // Restore state
    if (room.phase === 'lobby') {
      socket.emit('room_joined', { playerId, code: room.code });
      broadcastLobby(room);
    } else if (room.gameState) {
      socket.emit('room_joined', { playerId, code: room.code });
      socket.emit('game_state', { state: room.gameState });
    }
    console.log(`${player.name} rejoined room ${room.code}`);
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    // Grace period: hold the player slot for 60 s in case they reconnect
    // (phone locked, brief network drop, etc.)
    const timer = setTimeout(() => {
      disconnectTimers.delete(socket.id);
      cleanupSocket(socket.id);
    }, 60_000);
    disconnectTimers.set(socket.id, timer);
    console.log(`[-] ${socket.id} (60 s grace)`);
  });
});

// ─── Static files (production) ────────────────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  // Blueberry Trio — a self-contained, client-side puzzle app served as static
  // files under /trio. It never touches socket.io, the game loop, or Postgres, so
  // it adds no load to the card game beyond serving its (browser-cached) bundle.
  // These routes MUST come before the card game's catch-all below.
  const trioPath = path.join(process.cwd(), 'trio');
  app.use('/trio', express.static(trioPath)); // serves /trio/ + /trio/assets/*
  app.get('/trio', (_req, res) => res.redirect('/trio/')); // bare path -> add slash
  app.get('/trio/{*splat}', (_req, res) => { // SPA fallback for deep paths
    res.sendFile(path.join(trioPath, 'index.html'));
  });

  // Card game: static assets + SPA fallback, both under /blitz to match Vite's
  // `base`. It used to own the origin root and catch every unmatched path; that
  // catch-all is gone deliberately, because bingbongblitz.com now hosts four
  // games and the hub Worker -- not this server -- decides which one a path
  // belongs to. Anything unrouted should 404 here rather than silently render
  // the card game.
  const distPath = path.join(process.cwd(), 'dist');
  app.use('/blitz', express.static(distPath)); // serves /blitz/ + /blitz/assets/*
  app.get('/blitz', (_req, res) => res.redirect('/blitz/')); // bare path -> add slash
  app.get('/blitz/{*splat}', (_req, res) => { // SPA fallback for deep paths
    res.sendFile(path.join(distPath, 'index.html'));
  });

  // The origin's own root. Anyone landing on the bare Railway hostname (or an
  // old bookmark from when the card game lived at the domain root) gets sent to
  // where the game actually is now.
  app.get('/', (_req, res) => res.redirect('/blitz/'));
}

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3001', 10);
httpServer.listen(PORT, () => {
  console.log(`\n🃏 BingBongBlitz server running on port ${PORT}\n`);
});
