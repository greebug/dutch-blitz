import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { CardColor, BotDifficulty, GameState, GameAction } from '../game/types';

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

export interface LobbyState {
  code: string;
  players: LobbyPlayer[];
  config: RoomConfig;
  hostId: string | null;
}

export interface ChatMessage {
  playerId: string;
  name: string;
  faction: CardColor | null;
  text: string;
  timestamp: number;
}

export interface AccountStats {
  wins: number;
  gamesPlayed: number;
  roundsPlayed: number;
  elo: number;
  bestRoundSpeed: number | null;
  avgGameSpeed:   number | null;
}

export interface AuthInfo {
  displayName: string;
  stats: AccountStats;
}

export type MultiPhase = 'idle' | 'lobby' | 'playing';

/**
 * Where this game is mounted -- '/blitz/' in production (see vite.config's
 * `base`), '/' in dev.
 *
 * Vite rewrites asset URLs for us but does nothing to a path handed to
 * `history.replaceState` or built by hand from `location.origin`; those are
 * just strings. Without the prefix, playing a round rewrote the address bar to
 * bingbongblitz.com/?room=XXXX -- the HUB's landing page -- so a refresh or a
 * shared invite link left the game entirely.
 */
export const BASE = import.meta.env.BASE_URL;

// ─── Accounts ─────────────────────────────────────────────────────────────────

// One account covers every game on bingbongblitz.com, and Guesswhere owns it:
// it holds the users table, the password hashing and the email verification, so
// the other games sign in THROUGH it rather than keeping a second set of
// credentials. Same origin, so these are ordinary same-origin fetches and the
// httpOnly session cookie rides along by itself.
//
// Password reset and email verification stay on Guesswhere's own pages -- they
// arrive by emailed link, so there is nothing to reimplement here.
const AUTH_API = '/guesswhere/api/auth';
export const ACCOUNT_HELP_URL = '/guesswhere';

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

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMultiplayer() {
  const socketRef = useRef<Socket | null>(null);
  const myPlayerIdRef = useRef<string | null>(null);
  // Persists room+playerId across reconnects so we can auto-rejoin
  const sessionRef = useRef<{ code: string; playerId: string } | null>(null);
  const reconnectingRef = useRef(false);

  const [phase, setPhase] = useState<MultiPhase>('idle');
  const [lobbyState, setLobbyState] = useState<LobbyState | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  // "Signed out" vs "haven't heard back yet" -- without this the lobby renders
  // its signed-out state for a moment on every load even for someone who is
  // signed in, which reads as having been logged out.
  const [authResolved, setAuthResolved] = useState(false);
  const [authPending, setAuthPending] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const setRecon = (val: boolean) => {
    reconnectingRef.current = val;
    setReconnecting(val);
  };

  useEffect(() => {
    // Connect to the game server (proxied through Vite on the same host/port)
    // reconnectionAttempts: after ~10 tries (~30 s) give up and show error
    const socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      // On reconnect (session exists) try to reclaim the room slot
      const session = sessionRef.current;
      if (session) socket.emit('rejoin_room', session);
    });

    socket.on('room_created', ({ code, playerId }: { code: string; playerId: string }) => {
      myPlayerIdRef.current = playerId;
      setMyPlayerId(playerId);
      sessionRef.current = { code, playerId };
      setPhase('lobby');
      window.history.replaceState({}, '', `${BASE}?room=${code}`);
    });

    socket.on('room_joined', ({ playerId, code }: { playerId: string; code: string }) => {
      myPlayerIdRef.current = playerId;
      setMyPlayerId(playerId);
      sessionRef.current = { code, playerId };
      setRecon(false);
      setError(null);
      setPhase('lobby');
      window.history.replaceState({}, '', `${BASE}?room=${code}`);
    });

    socket.on('room_error', ({ message }: { message: string }) => {
      setError(message);
      if (reconnectingRef.current) {
        // Rejoin failed (room gone / slot expired) — drop back to idle
        setRecon(false);
        sessionRef.current = null;
        setPhase('idle');
        setLobbyState(null);
        setGameState(null);
        setMessages([]);
        setCountdown(null);
        myPlayerIdRef.current = null;
        setMyPlayerId(null);
        window.history.replaceState({}, '', BASE);
      }
    });

    socket.on('lobby_update', (data: { code: string; players: LobbyPlayer[]; config: RoomConfig; hostId: string | null }) => {
      setLobbyState(prev => ({
        code: data.code ?? prev?.code ?? '',
        players: data.players,
        config: data.config,
        hostId: data.hostId,
      }));
    });

    socket.on('countdown', ({ count }: { count: number }) => {
      setCountdown(count);
    });

    socket.on('game_state', ({ state }: { state: GameState }) => {
      setGameState(state);
      setRecon(false);
      if (state.phase !== 'setup') {
        setPhase('playing');
        setCountdown(null);
      }
    });

    socket.on('chat_update', (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
    });

    socket.on('player_left', ({ name }: { name: string }) => {
      console.log(`${name} left the game`);
    });

    socket.on('left_room', () => {
      sessionRef.current = null; // deliberate leave — no auto-rejoin
      setRecon(false);
      setPhase('idle');
      setLobbyState(null);
      setGameState(null);
      setMessages([]);
      setCountdown(null);
      myPlayerIdRef.current = null;
      setMyPlayerId(null);
      // authInfo intentionally kept — user stays signed in across rooms
      window.history.replaceState({}, '', BASE);
    });

    // Sent on every connection, signed in or not. Identity comes from the
    // session cookie the browser already carries, so there is nothing to
    // submit -- the server resolves the handshake and tells us the answer.
    socket.on('auth_state', (info: AuthInfo | null) => {
      setAuthInfo(info);
      setAuthResolved(true);
    });

    socket.on('disconnect', () => {
      if (sessionRef.current) {
        // We're in a room — show reconnecting UI and let socket.io retry
        setRecon(true);
      } else {
        setError('Connection lost. Please refresh.');
      }
    });

    // All reconnect attempts exhausted (~30 s) — give up
    socket.on('reconnect_failed', () => {
      setRecon(false);
      sessionRef.current = null;
      setError('Connection lost. Please refresh and rejoin.');
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // Read room code from URL on initial load (for link-sharing)
  const initialRoomCode = new URLSearchParams(window.location.search).get('room') ?? '';

  const createRoom = useCallback((name: string, config: RoomConfig) => {
    setError(null);
    socketRef.current?.emit('create_room', { name, config });
  }, []);

  const joinRoom = useCallback((code: string, name: string) => {
    setError(null);
    socketRef.current?.emit('join_room', { code: code.toUpperCase().trim(), name });
  }, []);

  const changeFaction = useCallback((faction: CardColor) => {
    socketRef.current?.emit('change_faction', { faction });
  }, []);

  const updateConfig = useCallback((config: Partial<RoomConfig>) => {
    socketRef.current?.emit('update_config', config);
  }, []);

  const startGame = useCallback(() => {
    socketRef.current?.emit('start_game');
  }, []);

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit('leave');
  }, []);

  const sendMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    socketRef.current?.emit('chat_message', { text: trimmed });
  }, []);

  /**
   * Reconnects the socket so the server sees the cookie that was just set (or
   * cleared).
   *
   * `handshake.headers` is frozen at connect time -- a cookie written after the
   * socket opened is invisible to the server until a NEW handshake. So rather
   * than inventing an "I signed in now" message the server would have to take
   * on trust, signing in simply starts a fresh connection, and the one
   * cookie-reading code path on the server covers every case.
   */
  const reauthenticate = useCallback(() => {
    setAuthResolved(false);
    const socket = socketRef.current;
    if (!socket) return;
    socket.disconnect();
    socket.connect();
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    setAuthError(null);
    setAuthPending(true);
    const err = await authRequest('/login', { username, password });
    setAuthPending(false);
    if (err) { setAuthError(err); return false; }
    reauthenticate();
    return true;
  }, [reauthenticate]);

  const signUp = useCallback(async (username: string, password: string, email: string) => {
    setAuthError(null);
    setAuthPending(true);
    const err = await authRequest('/signup', { username, password, email: email.trim() });
    setAuthPending(false);
    if (err) { setAuthError(err); return false; }
    reauthenticate();
    return true;
  }, [reauthenticate]);

  const signOut = useCallback(async () => {
    setAuthError(null);
    setAuthPending(true);
    await authRequest('/logout', {});
    setAuthPending(false);
    setAuthInfo(null);
    // Signing out ends the session for every game on the domain, so the
    // reconnect is what makes THIS one agree with that.
    reauthenticate();
  }, [reauthenticate]);

  const dispatch = useCallback((action: GameAction) => {
    if (action.type === 'BACK_TO_SETUP') {
      socketRef.current?.emit('leave');
      return;
    }
    if (action.type === 'NEXT_ROUND') {
      socketRef.current?.emit('next_round');
      return;
    }
    if (action.type === 'PAUSE_BOTS') {
      socketRef.current?.emit('pause_game');
      return;
    }
    if (action.type === 'RESUME_BOTS') {
      socketRef.current?.emit('resume_game');
      return;
    }
    socketRef.current?.emit('action', action);
  }, []);

  return {
    phase,
    lobbyState,
    gameState,
    myPlayerId,
    messages,
    countdown,
    error,
    reconnecting,
    authInfo,
    authError,
    authResolved,
    authPending,
    initialRoomCode,
    createRoom,
    joinRoom,
    changeFaction,
    updateConfig,
    startGame,
    leaveRoom,
    sendMessage,
    signIn,
    signUp,
    signOut,
    dispatch,
    clearError: () => setError(null),
    clearAuthError: () => setAuthError(null),
  };
}
