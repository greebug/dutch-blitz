import React, { useState, useEffect, useRef } from 'react';
import { CardColor, BotDifficulty } from '../game/types';
import { LobbyPlayer, LobbyState, RoomConfig, ChatMessage } from '../hooks/useMultiplayer';

// ─── Faction config ───────────────────────────────────────────────────────────

const FACTIONS: { color: CardColor; label: string; symbol: string; bg: string; text: string }[] = [
  { color: 'red',    label: 'Carriage', symbol: '🚗', bg: '#c62828', text: 'white' },
  { color: 'blue',   label: 'Plow',     symbol: '🚜', bg: '#1565c0', text: 'white' },
  { color: 'green',  label: 'Pump',     symbol: '⛽', bg: '#2e7d32', text: 'white' },
  { color: 'yellow', label: 'Pail',     symbol: '🪣', bg: '#f9a825', text: '#111'  },
];

// Readable text colors for each faction, used in chat
const FACTION_CHAT_COLORS: Record<CardColor, string> = {
  red:    '#ef5350',
  blue:   '#64b5f6',
  green:  '#66bb6a',
  yellow: '#ffd54f',
};
function factionChatColor(faction: CardColor | null): string {
  return faction ? FACTION_CHAT_COLORS[faction] : 'rgba(255,255,255,0.38)';
}

function factionBg(color: CardColor | null) {
  return color ? (FACTIONS.find(f => f.color === color)?.bg ?? '#555') : 'rgba(255,255,255,0.08)';
}
function factionText(color: CardColor | null) {
  return color ? (FACTIONS.find(f => f.color === color)?.text ?? 'white') : 'rgba(255,255,255,0.4)';
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  phase: 'idle' | 'lobby' | 'playing';
  lobbyState: LobbyState | null;
  myPlayerId: string | null;
  error: string | null;
  initialRoomCode: string;
  chatMessages: ChatMessage[];
  onCreateRoom: (name: string, config: RoomConfig) => void;
  onJoinRoom: (code: string, name: string) => void;
  onChangeFaction: (faction: CardColor) => void;
  onUpdateConfig: (cfg: Partial<RoomConfig>) => void;
  onStartGame: () => void;
  onLeave: () => void;
  onClearError: () => void;
  onSendMessage: (text: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MultiLobbyScreen({
  phase, lobbyState, myPlayerId, error,
  initialRoomCode, chatMessages,
  onCreateRoom, onJoinRoom, onChangeFaction, onUpdateConfig, onStartGame, onLeave, onClearError,
  onSendMessage,
}: Props) {
  const [name, setName] = useState(() => localStorage.getItem('db-player-name') ?? '');
  const [joinCode, setJoinCode] = useState(initialRoomCode);
  const [targetScore, setTargetScore] = useState(75);
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>('medium');
  const [chatInput, setChatInput] = useState('');
  const chatListRef = useRef<HTMLDivElement>(null);

  // Scroll only the message list — not the whole page
  useEffect(() => {
    const el = chatListRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [chatMessages]);

  function handleSend() {
    if (!chatInput.trim()) return;
    onSendMessage(chatInput.trim());
    setChatInput('');
  }

  function handleChatKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleSend();
  }

  const canProceed = name.trim().length > 0;

  function saveNameAndProceed() {
    if (!canProceed) return;
    localStorage.setItem('db-player-name', name.trim());
  }

  function handleCreate() {
    if (!canProceed) return;
    saveNameAndProceed();
    onCreateRoom(name.trim(), { targetScore, botDifficulty });
  }

  function handleJoin() {
    if (!canProceed || !joinCode.trim()) return;
    saveNameAndProceed();
    onJoinRoom(joinCode.trim(), name.trim());
  }

  // ── Connecting / idle phase ──────────────────────────────────────────────
  if (phase === 'idle') {
    return (
      <div className="lobby-screen">
        <div className="lobby-title">Dutch Blitz</div>
        <div className="lobby-subtitle">Start now with bots, or share a room code for friends to join</div>

        {error && (
          <div className="lobby-error" onClick={onClearError}>
            {error} <span style={{ opacity: 0.6, fontSize: 11 }}>(tap to dismiss)</span>
          </div>
        )}

        {/* Name */}
        <div className="lobby-section">
          <div className="setup-label">Your Name</div>
          <input
            className="setup-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Enter your name"
            maxLength={16}
          />
        </div>

        {/* Join existing room */}
        <div className="lobby-section">
          <div className="setup-label">Join a Friend's Room</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="setup-input lobby-code-input"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Room code (e.g. DUCK)"
              maxLength={4}
              style={{ textTransform: 'uppercase', letterSpacing: 4, fontSize: 20, flex: 1 }}
            />
            <button
              className="lobby-action-btn"
              onClick={handleJoin}
              disabled={!canProceed || !joinCode.trim()}
            >
              Join
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="lobby-divider"><span>or</span></div>

        {/* Create room options */}
        <div className="lobby-section">
          <div className="setup-label">Start a New Game</div>

          <div style={{ marginBottom: 8 }}>
            <div className="setup-label" style={{ opacity: 0.6 }}>Target Score</div>
            <div className="setup-row">
              {[50, 75, 100, 150].map(s => (
                <button key={s} className={`option-btn ${targetScore === s ? 'selected' : ''}`}
                  onClick={() => setTargetScore(s)}>{s}</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 8 }}>
            <div className="setup-label" style={{ opacity: 0.6 }}>Bot Difficulty</div>
            <div className="setup-row">
              {(['easy', 'medium', 'hard', 'impossible'] as BotDifficulty[]).map(d => (
                <button key={d} className={`option-btn ${botDifficulty === d ? 'selected' : ''}`}
                  onClick={() => setBotDifficulty(d)}>
                  {d[0].toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <button className="start-btn" onClick={handleCreate} disabled={!canProceed}>
            Create Game
          </button>
        </div>
      </div>
    );
  }

  // ── Lobby / waiting room phase ───────────────────────────────────────────
  if (phase === 'lobby' && lobbyState) {
    const me = lobbyState.players.find(p => p.playerId === myPlayerId);
    const isHost = me?.isHost === true;
    const takenFactions = lobbyState.players
      .filter(p => p.playerId !== myPlayerId && p.faction !== null)
      .map(p => p.faction as CardColor);
    const allHaveFactions = lobbyState.players.every(p => p.faction !== null);
    const canStart = lobbyState.players.length >= 1 && allHaveFactions;

    return (
      <div className="lobby-screen">
        <div className="lobby-title">
          Room: <span className="lobby-room-code">{lobbyState.code}</span>
        </div>
        <div className="lobby-subtitle">
          Share this code with friends on the same network
        </div>

        {error && (
          <div className="lobby-error" onClick={onClearError}>{error}</div>
        )}

        {/* Player list */}
        <div className="lobby-section">
          <div className="setup-label">Players ({lobbyState.players.length}/4) · bots fill remaining slots</div>
          <div className="lobby-players">
            {lobbyState.players.map(p => (
              <div key={p.playerId} className="lobby-player-row">
                <div
                  className="lobby-player-faction"
                  style={{ background: factionBg(p.faction), color: factionText(p.faction) }}
                >
                  {p.faction ? (FACTIONS.find(f => f.color === p.faction)?.symbol ?? '?') : '?'}
                </div>
                <span className="lobby-player-name">{p.name}</span>
                <span className="lobby-player-tags">
                  {p.isHost && <span className="lobby-tag lobby-tag-host">Host</span>}
                  {p.playerId === myPlayerId && <span className="lobby-tag lobby-tag-you">You</span>}
                  {!p.faction && p.playerId !== myPlayerId && (
                    <span className="lobby-tag" style={{ color: 'rgba(255,255,255,0.35)' }}>choosing…</span>
                  )}
                </span>
              </div>
            ))}
            {/* Empty slots */}
            {Array.from({ length: Math.max(0, 2 - lobbyState.players.length) }).map((_, i) => (
              <div key={`empty-${i}`} className="lobby-player-row lobby-player-empty">
                <div className="lobby-player-faction" style={{ background: 'rgba(255,255,255,0.05)' }}>?</div>
                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Waiting for player…</span>
              </div>
            ))}
          </div>
        </div>

        {/* My faction picker */}
        <div className="lobby-section">
          <div className="setup-label">Your Faction</div>
          <div className="faction-grid">
            {FACTIONS.map(f => {
              const taken = takenFactions.includes(f.color);
              const selected = me?.faction === f.color;
              return (
                <button
                  key={f.color}
                  className={`faction-btn ${selected ? 'faction-selected' : ''} ${taken ? 'faction-taken' : ''}`}
                  style={{ '--faction-bg': f.bg, '--faction-text': f.text } as React.CSSProperties}
                  onClick={() => !taken && onChangeFaction(f.color)}
                  disabled={taken}
                >
                  <span className="faction-symbol">{f.symbol}</span>
                  <span className="faction-name">{f.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Host config */}
        {isHost && (
          <div className="lobby-section">
            <div className="setup-label">Game Settings</div>

            <div style={{ marginBottom: 8 }}>
              <div className="setup-label" style={{ opacity: 0.6 }}>Target Score</div>
              <div className="setup-row">
                {[50, 75, 100, 150].map(s => (
                  <button key={s}
                    className={`option-btn ${lobbyState.config.targetScore === s ? 'selected' : ''}`}
                    onClick={() => onUpdateConfig({ targetScore: s })}>{s}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 8 }}>
              <div className="setup-label" style={{ opacity: 0.6 }}>Bot Difficulty</div>
              <div className="setup-row">
                {(['easy', 'medium', 'hard', 'impossible'] as BotDifficulty[]).map(d => (
                  <button key={d}
                    className={`option-btn ${lobbyState.config.botDifficulty === d ? 'selected' : ''}`}
                    onClick={() => onUpdateConfig({ botDifficulty: d })}>
                    {d[0].toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Chat */}
        <div className="lobby-chat">
          <div className="lobby-chat-title">Chat</div>
          <div className="chat-messages" ref={chatListRef}>
            {chatMessages.length === 0 ? (
              <div className="chat-empty">Say hi 👋</div>
            ) : (
              chatMessages.map((msg, i) => (
                <div key={i} className="chat-message">
                  <span
                    className="chat-msg-name"
                    style={{ color: factionChatColor(msg.faction) }}
                  >
                    {msg.name}:
                  </span>
                  <span className="chat-msg-text">{msg.text}</span>
                </div>
              ))
            )}
          </div>
          <div className="chat-input-row">
            <input
              className="chat-input"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={handleChatKey}
              placeholder="Message…"
              maxLength={200}
            />
            <button
              className="chat-send-btn"
              onClick={handleSend}
              disabled={!chatInput.trim()}
            >
              Send
            </button>
          </div>
        </div>

        {/* Start / waiting */}
        {isHost ? (
          <>
            {!allHaveFactions && (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>
                All players must pick a faction to start
              </div>
            )}
            <button
              className="start-btn"
              onClick={onStartGame}
              disabled={!canStart}
            >
              Start Game ▶
            </button>
          </>
        ) : (
          <div className="lobby-waiting">
            <div className="lobby-waiting-dot" />
            Waiting for host to start…
          </div>
        )}

        <button className="back-btn" onClick={onLeave} style={{ marginTop: 12 }}>
          ← Leave Room
        </button>
      </div>
    );
  }

  // Fallback (phase='playing' is handled by App.tsx showing GameBoard)
  return (
    <div className="lobby-screen">
      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 16 }}>Connecting…</div>
    </div>
  );
}
