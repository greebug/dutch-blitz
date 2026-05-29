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
      window.history.replaceState({}, '', `/?room=${code}`);
    });

    socket.on('room_joined', ({ playerId, code }: { playerId: string; code: string }) => {
      myPlayerIdRef.current = playerId;
      setMyPlayerId(playerId);
      sessionRef.current = { code, playerId };
      setRecon(false);
      setError(null);
      setPhase('lobby');
      window.history.replaceState({}, '', `/?room=${code}`);
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
        window.history.replaceState({}, '', '/');
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
      window.history.replaceState({}, '', '/');
    });

    socket.on('auth_ok', ({ displayName, stats }: { displayName: string; stats: AccountStats }) => {
      setAuthInfo({ displayName, stats });
      setAuthError(null);
    });

    socket.on('auth_error', ({ message }: { message: string }) => {
      setAuthError(message);
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

  const authPlay = useCallback((name: string, pin: string) => {
    setAuthError(null);
    socketRef.current?.emit('auth_play', { name: name.trim(), pin: pin.trim() });
  }, []);

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
    initialRoomCode,
    createRoom,
    joinRoom,
    changeFaction,
    updateConfig,
    startGame,
    leaveRoom,
    sendMessage,
    authPlay,
    dispatch,
    clearError: () => setError(null),
    clearAuthError: () => setAuthError(null),
  };
}
