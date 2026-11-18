import { useCallback, useEffect, useRef, useState } from 'react';
import { type Socket, io } from 'socket.io-client';

import { type Card, cardId } from '../gin/cards';
import type { GinAction, GinView, Seat } from '../gin/game';

/**
 * The online half of Gin.
 *
 * Connects to the `/gin` NAMESPACE on the Blitz socket.io server -- same
 * transport, same `/socket.io` path the hub Worker already routes, separate
 * event vocabulary. See server/gin.ts for why it is a namespace and not a
 * second server.
 *
 * This hook never owns game state. It holds the last `GinView` the server sent
 * and posts intents back; every rule, every deal and every score lives on the
 * server. That is not caution for its own sake: a client that could compute the
 * next state would have to be given the stock to do it, and then the game is
 * cheatable by anyone who opens devtools.
 */

export interface TableSeat {
  seat: Seat;
  name: string;
  connected: boolean;
}

export interface TableInfo {
  code: string;
  seats: TableSeat[];
  youAre: Seat;
  running: [number, number];
  handsPlayed: number;
  /** First to this many; null is no limit. */
  target: number | null;
  /** The table seat that won the match just finished, if one has. */
  matchWinner: Seat | null;
  /** Whether you are the one who sets the target. */
  host: boolean;
  inHand: boolean;
  canDeal: boolean;
}

/** A finished hand, as the server releases it once nothing in it is secret. */
export interface Replay {
  seed: number;
  /** The engine seat you played this hand from. It alternates with the opener. */
  humanSeat: Seat;
  history: GinAction[];
}

/** Shared with the Blitz lobby: same origin, same person, same name box. */
const NAME_KEY = 'db-player-name';

export function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberName(name: string) {
  try {
    if (name.trim()) localStorage.setItem(NAME_KEY, name.trim());
  } catch {
    /* no storage */
  }
}

// One account covers every game on bingbongblitz.com, and Guesswhere owns it.
// Same origin, so these are plain fetches and the httpOnly cookie rides along.
const AUTH_API = '/guesswhere/api/auth';

async function authRequest(path: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(`${AUTH_API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.error ?? 'Something went wrong. Please try again.';
  } catch {
    return "Couldn't reach the accounts service. Check your connection.";
  }
}

export type Connection = 'connecting' | 'online' | 'offline';

/** Survives a reload, so a refresh mid-hand walks back into the same seat. */
const SESSION_KEY = 'gin.session';

interface Session {
  code: string;
  playerId: string;
}

function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(session: Session | null) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode: the seat simply will not survive a reload */
  }
}

export function useGinTable() {
  const socketRef = useRef<Socket | null>(null);
  const sessionRef = useRef<Session | null>(loadSession());

  const [connection, setConnection] = useState<Connection>('connecting');
  const [table, setTable] = useState<TableInfo | null>(null);
  const [view, setView] = useState<GinView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
  /** Undefined until the server has said; null for a guest. */
  const [account, setAccount] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    // A leading slash is a NAMESPACE, not a URL path: this connects to the
    // current origin and asks for `/gin` on it.
    const socket = io('/gin', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnection('online');
      // Reclaiming happens on every connect, not just the first: this is also
      // the path a dropped-and-restored socket takes back to its seat.
      const session = sessionRef.current;
      if (session) socket.emit('rejoin_table', session);
    });

    socket.on('gin_identity', ({ account: name }: { account: string | null }) => setAccount(name));
    socket.on('disconnect', () => setConnection('offline'));
    socket.io.on('reconnect_attempt', () => setConnection('connecting'));

    socket.on('table_joined', ({ code, playerId }: { code: string; playerId: string }) => {
      sessionRef.current = { code, playerId };
      saveSession(sessionRef.current);
      setError(null);
    });

    socket.on('table_update', (info: TableInfo) => {
      setTable(info);
      // Between hands there is no view to show; without this the previous
      // hand's cards sit on the table looking live.
      if (!info.inHand && !info.canDeal) setView(null);
    });

    socket.on('gin_view', ({ view: next, replay: done }: { view: GinView; replay?: Replay }) => {
      setView(next);
      setReplay(done ?? null);
      setError(null);
    });

    socket.on('table_left', () => {
      sessionRef.current = null;
      saveSession(null);
      setTable(null);
      setView(null);
    });

    socket.on('gin_error', ({ message }: { message: string }) => {
      setError(message);
      // "That table is gone" / "your seat was given up" are answers to a
      // rejoin, and the stale session is what caused them. Drop it so the
      // next reload starts clean rather than failing the same way forever.
      if (/gone|given up|no table/i.test(message)) {
        sessionRef.current = null;
        saveSession(null);
        setTable(null);
        setView(null);
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);

  const emit = useCallback((event: string, payload?: unknown) => {
    socketRef.current?.emit(event, payload);
  }, []);

  /**
   * The server reads who you are from the cookie at handshake time, so a new
   * cookie means a new handshake. The seat survives it: `connect` rejoins.
   */
  const reauthenticate = useCallback(() => {
    setAccount(undefined);
    const socket = socketRef.current;
    if (!socket) return;
    socket.disconnect();
    socket.connect();
  }, []);

  const [authPending, setAuthPending] = useState(false);
  const authed = useCallback(
    async (path: string, body: unknown) => {
      setAuthPending(true);
      const err = await authRequest(path, body);
      setAuthPending(false);
      if (!err) reauthenticate();
      return err;
    },
    [reauthenticate]
  );

  return {
    connection,
    table,
    view,
    replay,
    error,
    account,
    authPending,
    signIn: useCallback(
      (username: string, password: string) => authed('/login', { username, password }),
      [authed]
    ),
    signOut: useCallback(() => authed('/logout', {}), [authed]),
    clearError: useCallback(() => setError(null), []),
    createTable: useCallback(
      (name: string, target: number | null) => {
        rememberName(name);
        emit('create_table', { name, target });
      },
      [emit]
    ),
    joinTable: useCallback(
      (code: string, name: string) => {
        rememberName(name);
        emit('join_table', { code, name });
      },
      [emit]
    ),
    setTarget: useCallback((target: number | null) => emit('set_target', { target }), [emit]),
    leaveTable: useCallback(() => emit('leave_table'), [emit]),
    dealHand: useCallback(() => emit('deal_hand'), [emit]),
    drawStock: useCallback(() => emit('act', { type: 'draw', from: 'stock' }), [emit]),
    takeDiscard: useCallback(() => emit('act', { type: 'draw', from: 'discard' }), [emit]),
    discard: useCallback((card: Card) => emit('act', { type: 'discard', card: cardId(card) }), [emit]),
    knock: useCallback(
      (card: Card) => emit('act', { type: 'knock', discard: cardId(card) }),
      [emit]
    ),
    bigGin: useCallback(() => emit('act', { type: 'big-gin' }), [emit]),
  };
}
