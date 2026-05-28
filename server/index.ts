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
import bcrypt from 'bcryptjs';
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
  console.log('Database ready');
}
initDb().catch(console.error);

interface AccountInfo { id: number; displayName: string; }
const socketToAccount = new Map<string, AccountInfo>();

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
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

const rooms = new Map<string, Room>();
const socketToRoom = new Map<string, string>();

// ─── Leaderboard API ──────────────────────────────────────────────────────────

app.get('/api/leaderboard', async (_req, res) => {
  if (!pool) {
    res.json({ speed: [], avgSpeed: [], wins: [] });
    return;
  }
  try {
    const [speedRes, avgRes, winsRes] = await Promise.all([
      // Tab 1: Best single-round speed (min 5 cards)
      pool.query(`
        SELECT player_name, secs_per_play, cards_played, played_at
        FROM round_records
        WHERE cards_played >= 5
        ORDER BY secs_per_play ASC
        LIMIT 3
      `),
      // Tab 2: Best average game speed (target >= 75)
      pool.query(`
        SELECT player_name,
               SUM(duration_secs) / NULLIF(SUM(cards_played), 0) AS avg_secs,
               SUM(cards_played) AS total_cards
        FROM round_records
        WHERE target_score >= 75 AND cards_played >= 5
        GROUP BY player_name, game_id
        ORDER BY avg_secs ASC
        LIMIT 3
      `),
      // Tab 3: Total wins by PIN account
      pool.query(`
        SELECT display_name, wins, games_played
        FROM accounts
        WHERE wins > 0
        ORDER BY wins DESC
        LIMIT 3
      `),
    ]);
    res.json({ speed: speedRes.rows, avgSpeed: avgRes.rows, wins: winsRes.rows });
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
      saveGameStats(room).catch(console.error);
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

io.on('connection', (socket: Socket) => {
  console.log(`[+] ${socket.id}`);

  // ── Create room ──────────────────────────────────────────────────────────
  socket.on('create_room', ({
    name, config,
  }: { name: string; config: RoomConfig }) => {
    const code = generateCode();
    const playerId = socket.id;

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
    code, name,
  }: { code: string; name: string }) => {
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

    if ('playerId' in action && (action as any).playerId !== socket.id) return;

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

    room.gameState = gameReducer(room.gameState, { type: 'NEXT_ROUND' });
    broadcastState(room);
    if (room.gameState.phase === 'playing') startBots(room);
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

  // ── Auth (login or auto-register with PIN) ───────────────────────────────
  socket.on('auth_play', async ({ name, pin }: { name: string; pin: string }) => {
    const cleanName = name.trim();
    const nameLower = cleanName.toLowerCase();

    if (!pool) {
      socket.emit('auth_ok', {
        displayName: cleanName,
        stats: { wins: 0, gamesPlayed: 0, roundsPlayed: 0, elo: 1200,
                 bestRoundSpeed: null, avgGameSpeed: null },
      });
      return;
    }

    if (!pin || !/^\d{4}$/.test(pin)) {
      socket.emit('auth_error', { message: 'PIN must be exactly 4 digits.' });
      return;
    }

    try {
      const { rows } = await pool.query(
        `SELECT id, display_name, pin_hash, wins, games_played, rounds_played, elo
           FROM accounts WHERE name_lower = $1`,
        [nameLower]
      );

      if (rows.length > 0) {
        const row = rows[0];
        const match = await bcrypt.compare(pin, row.pin_hash);
        if (!match) {
          socket.emit('auth_error', { message: 'Wrong PIN for that name. Try again.' });
          return;
        }
        socketToAccount.set(socket.id, { id: row.id, displayName: row.display_name });

        // Fetch speed stats for this account
        const speedRes = await pool.query(
          `SELECT MIN(secs_per_play)                                       AS best_speed,
                  SUM(duration_secs) / NULLIF(SUM(cards_played), 0)       AS avg_speed
           FROM round_records WHERE account_id = $1 AND cards_played >= 5`,
          [row.id]
        );
        const sr = speedRes.rows[0];

        socket.emit('auth_ok', {
          displayName: row.display_name,
          stats: {
            wins:           row.wins,
            gamesPlayed:    row.games_played,
            roundsPlayed:   row.rounds_played,
            elo:            row.elo,
            bestRoundSpeed: sr?.best_speed  != null ? parseFloat(sr.best_speed)  : null,
            avgGameSpeed:   sr?.avg_speed   != null ? parseFloat(sr.avg_speed)   : null,
          },
        });
      } else {
        const pinHash = await bcrypt.hash(pin, 10);
        const { rows: newRows } = await pool.query(
          `INSERT INTO accounts (name_lower, display_name, pin_hash)
             VALUES ($1, $2, $3) RETURNING id`,
          [nameLower, cleanName, pinHash]
        );
        socketToAccount.set(socket.id, { id: newRows[0].id, displayName: cleanName });
        socket.emit('auth_ok', {
          displayName: cleanName,
          stats: { wins: 0, gamesPlayed: 0, roundsPlayed: 0, elo: 1200,
                   bestRoundSpeed: null, avgGameSpeed: null },
        });
      }
    } catch (e: any) {
      if (e.code === '23505') {
        socket.emit('auth_error', { message: 'That name was just taken — try a slightly different one.' });
      } else {
        console.error('auth_play error:', e);
        socket.emit('auth_error', { message: 'Something went wrong. Please try again.' });
      }
    }
  });

  // ── Leave ─────────────────────────────────────────────────────────────────
  socket.on('leave', () => {
    cleanupSocket(socket.id);
    socket.emit('left_room');
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    cleanupSocket(socket.id);
    console.log(`[-] ${socket.id}`);
  });
});

// ─── Static files (production) ────────────────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3001', 10);
httpServer.listen(PORT, () => {
  console.log(`\n🃏 BingBongBlitz server running on port ${PORT}\n`);
});
