/**
 * Gin Rummy multiplayer.
 *
 * Lives on its own socket.io NAMESPACE (`/gin`) rather than its own server.
 * socket.io's path is fixed at `/socket.io` and the hub Worker routes exactly
 * that prefix to this origin, so a second Server instance would have to fight
 * the Blitz one for the same path. A namespace shares the transport and keeps
 * the two games' event vocabularies completely separate, which is what we
 * actually wanted.
 *
 * The server is authoritative, and deliberately so. It owns the only copy of
 * `GinState`; a client is sent `viewFor(state, theirSeat)` and nothing else, so
 * the stock's order and the opponent's cards are never in the browser while the
 * hand is live. Clients send *intents* -- "draw from stock", "discard ro4" --
 * which are checked with `canApply` before anything happens. Nothing a client
 * says about whose turn it is, what it holds, or who it is, is trusted.
 */

import { randomUUID } from 'crypto';
import type { Namespace, Server, Socket } from 'socket.io';

import { parseCardId } from '../src/gin/cards';
import { NAPOLETANE_GIN } from '../src/gin/rules';
import {
  type GinAction,
  type GinState,
  type Seat,
  apply,
  canApply,
  deal,
  other,
  viewFor,
} from '../src/gin/game';

/** How long a dropped player keeps their seat. Matches Blitz. */
const RECONNECT_GRACE_MS = 60_000;
/** An untouched table is swept after this. */
const IDLE_TABLE_MS = 2 * 60 * 60 * 1000;

export interface GinSeatInfo {
  seat: Seat;
  name: string;
  connected: boolean;
}

interface GinPlayer {
  playerId: string;
  socketId: string | null;
  seat: Seat;
  name: string;
}

interface GinTable {
  code: string;
  players: GinPlayer[];
  /** Null between hands and before the first deal. */
  state: GinState | null;
  running: [number, number];
  handsPlayed: number;
  touchedAt: number;
}

/** What a client may ask for. Cards travel as ids, never as objects. */
type WireAction =
  | { type: 'draw'; from: 'stock' | 'discard' }
  | { type: 'discard'; card: string }
  | { type: 'knock'; discard: string }
  | { type: 'big-gin' };

export interface GinDeps {
  /** Resolves a handshake cookie to a display name, or null for a guest. */
  resolveName(cookieHeader: string | undefined): Promise<string | null>;
}

export function attachGin(io: Server, deps: GinDeps): Namespace {
  const nsp = io.of('/gin');
  const tables = new Map<string, GinTable>();
  const socketToTable = new Map<string, string>();
  const dropTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // --- plumbing -------------------------------------------------------------

  function generateCode(): string {
    // No I, O, 0 or 1: these get read aloud and typed in by hand.
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return tables.has(code) ? generateCode() : code;
  }

  function seatInfo(table: GinTable): GinSeatInfo[] {
    return table.players
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({ seat: p.seat, name: p.name, connected: p.socketId !== null }));
  }

  /** Lobby-level facts: who is here, the running score, whether a hand is live. */
  function broadcastTable(table: GinTable) {
    table.touchedAt = Date.now();
    for (const p of table.players) {
      if (!p.socketId) continue;
      nsp.to(p.socketId).emit('table_update', {
        code: table.code,
        seats: seatInfo(table),
        youAre: p.seat,
        running: table.running,
        handsPlayed: table.handsPlayed,
        inHand: table.state !== null && table.state.phase !== 'over',
        canDeal: table.players.length === 2 && (table.state === null || table.state.phase === 'over'),
      });
    }
  }

  /**
   * One view per player, each redacted for that seat.
   *
   * Emitted per socket rather than to a room, because the whole point is that
   * the two players receive different objects. A room broadcast here would be
   * the bug: it would hand both hands to both browsers.
   */
  function broadcastViews(table: GinTable) {
    if (!table.state) return;
    for (const p of table.players) {
      if (!p.socketId) continue;
      nsp.to(p.socketId).emit('gin_view', { view: viewFor(table.state, p.seat) });
    }
  }

  function fail(socket: Socket, message: string) {
    socket.emit('gin_error', { message });
  }

  function tableFor(socket: Socket): GinTable | null {
    const code = socketToTable.get(socket.id);
    return code ? tables.get(code) ?? null : null;
  }

  function playerFor(table: GinTable, socket: Socket): GinPlayer | null {
    return table.players.find((p) => p.socketId === socket.id) ?? null;
  }

  // --- scoring --------------------------------------------------------------

  /**
   * Fold a finished hand into the running score.
   *
   * Called exactly where the transition to `over` is observed, so a hand can
   * never be counted twice -- which is the kind of thing that only shows up
   * three hands into a real game.
   */
  function recordHand(table: GinTable, state: GinState) {
    table.handsPlayed += 1;
    const score = state.score;
    if (!score || score.winner === null) return;
    const knocker = state.knocker ?? 0;
    const winner: Seat = score.winner === 'knocker' ? (knocker as Seat) : other(knocker as Seat);
    table.running[winner] += score.points;
  }

  // --- action parsing -------------------------------------------------------

  /** Null for anything malformed. Clients are not trusted to send sane shapes. */
  function parseAction(raw: unknown): GinAction | null {
    if (!raw || typeof raw !== 'object') return null;
    const a = raw as WireAction;
    try {
      switch (a.type) {
        case 'draw':
          return a.from === 'stock' || a.from === 'discard' ? { type: 'draw', from: a.from } : null;
        case 'discard':
          return typeof a.card === 'string' ? { type: 'discard', card: parseCardId(a.card) } : null;
        case 'knock':
          return typeof a.discard === 'string'
            ? { type: 'knock', discard: parseCardId(a.discard) }
            : null;
        case 'big-gin':
          return { type: 'big-gin' };
        default:
          return null;
      }
    } catch {
      // parseCardId throws on junk like "ro99" or "'; DROP TABLE".
      return null;
    }
  }

  // --- leaving --------------------------------------------------------------

  /**
   * Release a seat for good.
   *
   * A live hand is torn down with the player who left. Keeping it would mean
   * the freed seat could be taken by a stranger who would then be dealt into
   * the middle of someone else's hand, holding cards they never drew.
   */
  function releaseSeat(table: GinTable, leaving: GinPlayer) {
    if (leaving.socketId) socketToTable.delete(leaving.socketId);
    if (!table.players.includes(leaving)) return;
    table.players = table.players.filter((p) => p !== leaving);

    if (table.players.length === 0) {
      tables.delete(table.code);
      console.log(`[gin] table ${table.code} closed`);
      return;
    }

    if (table.state && table.state.phase !== 'over') {
      table.state = null;
      for (const p of table.players) {
        if (p.socketId) nsp.to(p.socketId).emit('gin_error', { message: `${leaving.name} left — the hand was abandoned.` });
      }
    }
    broadcastTable(table);
  }

  // --- connection -----------------------------------------------------------

  nsp.on('connection', (socket: Socket) => {
    // Resolved once per connection: `handshake.headers` is frozen at connect
    // time, so a cookie set later is invisible until the client reconnects.
    // Guests are fine; the name is a label, never an authorisation.
    let name = 'Guest';
    const named = deps
      .resolveName(socket.handshake.headers.cookie)
      .then((resolved) => {
        if (resolved) name = resolved;
      })
      .catch(() => {
        /* a failed lookup is a guest, not a locked door */
      });

    socket.on('create_table', async () => {
      await named;
      if (socketToTable.has(socket.id)) return fail(socket, 'You are already at a table.');
      const code = generateCode();
      const player: GinPlayer = { playerId: randomUUID(), socketId: socket.id, seat: 0, name };
      const table: GinTable = {
        code,
        players: [player],
        state: null,
        running: [0, 0],
        handsPlayed: 0,
        touchedAt: Date.now(),
      };
      tables.set(code, table);
      socketToTable.set(socket.id, code);
      socket.emit('table_joined', { code, playerId: player.playerId, seat: 0 });
      broadcastTable(table);
      console.log(`[gin] ${name} opened table ${code}`);
    });

    socket.on('join_table', async ({ code }: { code?: unknown }) => {
      await named;
      if (typeof code !== 'string') return fail(socket, 'Enter a table code.');
      if (socketToTable.has(socket.id)) return fail(socket, 'You are already at a table.');
      const table = tables.get(code.trim().toUpperCase());
      if (!table) return fail(socket, 'No table with that code.');
      if (table.players.length >= 2) return fail(socket, 'That table is full.');

      const taken = new Set(table.players.map((p) => p.seat));
      const seat: Seat = taken.has(0) ? 1 : 0;
      const player: GinPlayer = { playerId: randomUUID(), socketId: socket.id, seat, name };
      table.players.push(player);
      socketToTable.set(socket.id, table.code);
      socket.emit('table_joined', { code: table.code, playerId: player.playerId, seat });
      broadcastTable(table);
      console.log(`[gin] ${name} joined table ${table.code} in seat ${seat}`);
    });

    /**
     * Reclaim a seat after a drop. The playerId is the only thing that proves
     * which seat is yours, so it is checked against the seat's own record
     * rather than taken as a claim.
     */
    socket.on('rejoin_table', async ({ code, playerId }: { code?: unknown; playerId?: unknown }) => {
      await named;
      if (typeof code !== 'string' || typeof playerId !== 'string') return;
      const table = tables.get(code.trim().toUpperCase());
      if (!table) return fail(socket, 'That table is gone.');
      const player = table.players.find((p) => p.playerId === playerId);
      if (!player) return fail(socket, 'Your seat was given up.');

      const timer = dropTimers.get(playerId);
      if (timer) {
        clearTimeout(timer);
        dropTimers.delete(playerId);
      }
      if (player.socketId) socketToTable.delete(player.socketId);
      player.socketId = socket.id;
      player.name = name;
      socketToTable.set(socket.id, table.code);

      socket.emit('table_joined', { code: table.code, playerId, seat: player.seat });
      broadcastTable(table);
      if (table.state) {
        socket.emit('gin_view', { view: viewFor(table.state, player.seat) });
      }
      console.log(`[gin] ${name} reclaimed seat ${player.seat} at ${table.code}`);
    });

    socket.on('deal_hand', () => {
      const table = tableFor(socket);
      if (!table) return fail(socket, 'You are not at a table.');
      if (table.players.length < 2) return fail(socket, 'Waiting for a second player.');
      if (table.state && table.state.phase !== 'over') return fail(socket, 'That hand is still going.');
      // A fresh seed per hand, from the server. A client-supplied seed would
      // let someone deal themselves a hand they had already looked at.
      table.state = deal(Math.floor(Math.random() * 2 ** 30), NAPOLETANE_GIN);
      broadcastTable(table);
      broadcastViews(table);
    });

    socket.on('act', (raw: unknown) => {
      const table = tableFor(socket);
      if (!table) return fail(socket, 'You are not at a table.');
      const player = playerFor(table, socket);
      if (!player) return fail(socket, 'You are not seated.');
      if (!table.state) return fail(socket, 'No hand in progress.');

      const action = parseAction(raw);
      if (!action) return fail(socket, 'That move made no sense.');

      const why = canApply(table.state, player.seat, action);
      if (why) return fail(socket, why);

      const before = table.state.phase;
      table.state = apply(table.state, player.seat, action);
      if (before !== 'over' && table.state.phase === 'over') recordHand(table, table.state);

      broadcastViews(table);
      broadcastTable(table);
    });

    socket.on('leave_table', () => {
      const table = tableFor(socket);
      const player = table ? playerFor(table, socket) : null;
      if (table && player) releaseSeat(table, player);
      socketToTable.delete(socket.id);
      socket.emit('table_left');
    });

    socket.on('disconnect', () => {
      const table = tableFor(socket);
      const player = table ? playerFor(table, socket) : null;
      socketToTable.delete(socket.id);
      if (!table || !player) return;

      // The seat is held, not freed: a locked phone or a tunnel should not cost
      // somebody their hand.
      player.socketId = null;
      broadcastTable(table);

      const { playerId } = player;
      const timer = setTimeout(() => {
        dropTimers.delete(playerId);
        const stillThere = tables.get(table.code);
        const seat = stillThere?.players.find((p) => p.playerId === playerId);
        if (!stillThere || !seat || seat.socketId) return; // they came back
        console.log(`[gin] seat ${seat.seat} at ${stillThere.code} expired`);
        releaseSeat(stillThere, seat);
      }, RECONNECT_GRACE_MS);
      // Unref so a pending grace period cannot hold the process open at
      // shutdown -- the http server is what keeps it alive, not this.
      timer.unref?.();
      dropTimers.set(playerId, timer);
    });
  });

  // Tables outlive the sockets that made them, so something has to sweep the
  // ones nobody came back to.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [code, table] of tables) {
      const empty = table.players.every((p) => p.socketId === null) || table.players.length === 0;
      if (empty && now - table.touchedAt > IDLE_TABLE_MS) {
        tables.delete(code);
        console.log(`[gin] swept idle table ${code}`);
      }
    }
  }, 10 * 60 * 1000);
  sweeper.unref?.();

  return nsp;
}
