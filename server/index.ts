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
}

// ─── Server setup ─────────────────────────────────────────────────────────────

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

const rooms = new Map<string, Room>();
const socketToRoom = new Map<string, string>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateCode(): string {
  // Unambiguous characters (no 0/O/1/I)
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

  // Transfer host if the host left
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
    // Check if taken by another player
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

    // Validate all human players have chosen a faction
    const unpicked = room.players.find(p => p.faction === null);
    if (unpicked) {
      socket.emit('room_error', { message: `${unpicked.name} hasn't picked a faction yet.` });
      return;
    }

    // Build player list: human players first, then bots
    const humanPlayers: PlayerState[] = room.players.map(p =>
      dealPlayer(p.playerId, p.name, false, undefined, 0, p.faction!)
    );

    // Bots auto-fill to reach 4 players; names & factions from unused slots
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

    // Build state now but don't broadcast yet — countdown first
    room.gameState = {
      phase: 'playing',
      players: allPlayers,
      centerPiles: [],
      roundNumber: 1,
      roundStartTime: 0,          // set correctly when game actually reveals
      targetScore: room.config.targetScore,
    };
    room.phase = 'playing';       // blocks new joins immediately

    // Countdown 3 → 2 → 1, then reveal
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

    // Security: only the player who owns this action may dispatch it
    if ('playerId' in action && (action as any).playerId !== socket.id) return;

    const prevPhase = room.gameState.phase;
    room.gameState = gameReducer(room.gameState, action);

    // If round just ended, stop bots
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

  // ── Chat message ────────────────────────────────────────────────────────
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
      faction: player.faction,   // null until they pick one
      text: trimmed,
      timestamp: Date.now(),
    });
  });

  // ── Leave / back to lobby ────────────────────────────────────────────────
  socket.on('leave', () => {
    cleanupSocket(socket.id);
    socket.emit('left_room');
  });

  // ── Disconnect ───────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    cleanupSocket(socket.id);
    console.log(`[-] ${socket.id}`);
  });
});

// ─── Static files (production) ────────────────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3001', 10);
httpServer.listen(PORT, () => {
  console.log(`\n🃏 Dutch Blitz game server running on port ${PORT}\n`);
});
