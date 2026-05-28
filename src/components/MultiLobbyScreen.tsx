import React, { useState, useEffect, useRef } from 'react';
import { CardColor, BotDifficulty } from '../game/types';
import { LobbyPlayer, LobbyState, RoomConfig, ChatMessage, AuthInfo } from '../hooks/useMultiplayer';

// ─── Faction config ───────────────────────────────────────────────────────────

const FACTIONS: { color: CardColor; label: string; symbol: string; bg: string; text: string }[] = [
  { color: 'red',    label: 'Carriage', symbol: '🚗', bg: '#c62828', text: 'white' },
  { color: 'blue',   label: 'Plow',     symbol: '🚜', bg: '#1565c0', text: 'white' },
  { color: 'green',  label: 'Pump',     symbol: '⛽', bg: '#2e7d32', text: 'white' },
  { color: 'yellow', label: 'Pail',     symbol: '🪣', bg: '#f9a825', text: '#111'  },
];

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
  authInfo: AuthInfo | null;
  authError: string | null;
  initialRoomCode: string;
  chatMessages: ChatMessage[];
  onCreateRoom: (name: string, config: RoomConfig) => void;
  onJoinRoom: (code: string, name: string) => void;
  onChangeFaction: (faction: CardColor) => void;
  onUpdateConfig: (cfg: Partial<RoomConfig>) => void;
  onStartGame: () => void;
  onLeave: () => void;
  onClearError: () => void;
  onAuthPlay: (name: string, pin: string) => void;
  onClearAuthError: () => void;
  onSendMessage: (text: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MultiLobbyScreen({
  phase, lobbyState, myPlayerId, error,
  authInfo, authError,
  initialRoomCode, chatMessages,
  onCreateRoom, onJoinRoom, onChangeFaction, onUpdateConfig, onStartGame, onLeave,
  onClearError, onAuthPlay, onClearAuthError, onSendMessage,
}: Props) {
  const [name, setName] = useState(() => localStorage.getItem('db-player-name') ?? '');
  const [pin, setPin] = useState('');
  const [joinCode, setJoinCode] = useState(initialRoomCode);
  const [targetScore, setTargetScore] = useState(75);
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>('medium');
  const [chatInput, setChatInput] = useState('');
  const [showRules, setShowRules] = useState(false);
  const chatListRef = useRef<HTMLDivElement>(null);

  // Pending action: fired after auth_ok comes back
  const [pendingCreate, setPendingCreate] = useState(false);
  const [pendingJoin, setPendingJoin] = useState(false);

  // Scroll only the message list — not the whole page
  useEffect(() => {
    const el = chatListRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [chatMessages]);

  // When auth succeeds, fire the pending action
  useEffect(() => {
    if (!authInfo) return;
    if (pendingCreate) {
      setPendingCreate(false);
      localStorage.setItem('db-player-name', authInfo.displayName);
      onCreateRoom(authInfo.displayName, { targetScore, botDifficulty });
    } else if (pendingJoin) {
      setPendingJoin(false);
      localStorage.setItem('db-player-name', authInfo.displayName);
      onJoinRoom(joinCode.trim(), authInfo.displayName);
    }
  }, [authInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear pending if auth fails
  useEffect(() => {
    if (authError) {
      setPendingCreate(false);
      setPendingJoin(false);
    }
  }, [authError]);

  function handleSend() {
    if (!chatInput.trim()) return;
    onSendMessage(chatInput.trim());
    setChatInput('');
  }
  function handleChatKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleSend();
  }

  const displayName = authInfo?.displayName ?? name.trim();
  const canProceed = displayName.length > 0;

  function handleCreate() {
    if (!canProceed) return;
    if (authInfo) {
      onCreateRoom(authInfo.displayName, { targetScore, botDifficulty });
    } else if (pin.trim().length === 4) {
      setPendingCreate(true);
      onAuthPlay(name.trim(), pin.trim());
    } else {
      localStorage.setItem('db-player-name', name.trim());
      onCreateRoom(name.trim(), { targetScore, botDifficulty });
    }
  }

  function handleJoin() {
    if (!canProceed || !joinCode.trim()) return;
    if (authInfo) {
      onJoinRoom(joinCode.trim(), authInfo.displayName);
    } else if (pin.trim().length === 4) {
      setPendingJoin(true);
      onAuthPlay(name.trim(), pin.trim());
    } else {
      localStorage.setItem('db-player-name', name.trim());
      onJoinRoom(joinCode.trim(), name.trim());
    }
  }

  const isAuthenticating = pendingCreate || pendingJoin;

  // ── Rules modal ──────────────────────────────────────────────────────────
  const rulesModal = showRules && (
    <div
      onClick={() => setShowRules(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 999,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#2a1a0a', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 16, padding: '24px 20px', maxWidth: 420, width: '100%',
          maxHeight: '80vh', overflowY: 'auto', color: 'rgba(255,255,255,0.88)',
          fontSize: 14, lineHeight: 1.6,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 14, color: '#ffd54f' }}>
          How to Play BingBongBlitz
        </div>

        <div style={{ fontWeight: 700, color: '#ffd54f', marginBottom: 4 }}>🎯 Goal</div>
        <p style={{ margin: '0 0 12px' }}>
          Be the first player to empty your <strong>Blitz pile</strong> each round.
          First player to reach the target score (e.g. 75) wins the game.
        </p>

        <div style={{ fontWeight: 700, color: '#ffd54f', marginBottom: 4 }}>🃏 Your Cards</div>
        <p style={{ margin: '0 0 4px' }}>Each player has three areas:</p>
        <ul style={{ margin: '0 0 12px', paddingLeft: 18 }}>
          <li><strong>Blitz pile</strong> — 10 cards face-up on the left. Empty this to win the round!</li>
          <li><strong>3 Post piles</strong> — your personal staging area in the middle.</li>
          <li><strong>Wood pile</strong> — flip cards 3 at a time to get new options.</li>
        </ul>

        <div style={{ fontWeight: 700, color: '#ffd54f', marginBottom: 4 }}>▶ Playing Cards</div>
        <p style={{ margin: '0 0 4px' }}>
          Cards go 1→10 in the <strong>center piles</strong> (shared by all players), matched by color.
          You can play from your Blitz pile, Post piles, or the top Wood card onto a center pile.
        </p>
        <p style={{ margin: '0 0 12px' }}>
          You can also move cards between your own Post piles (descending order, any color).
          Tap a card, then tap the destination to move it.
        </p>

        <div style={{ fontWeight: 700, color: '#ffd54f', marginBottom: 4 }}>🪵 Wood Pile</div>
        <p style={{ margin: '0 0 12px' }}>
          Tap the face-down pile to flip 3 cards. The top face-up card is playable.
          When the pile runs out, it automatically reshuffles from discards.
        </p>

        <div style={{ fontWeight: 700, color: '#ffd54f', marginBottom: 4 }}>📊 Scoring</div>
        <ul style={{ margin: '0 0 12px', paddingLeft: 18 }}>
          <li>+1 point per card you played to the center this round</li>
          <li>−2 points per card remaining in your Blitz pile</li>
        </ul>
        <p style={{ margin: '0 0 12px' }}>
          The player who empties their Blitz pile ends the round. Everyone's scores update.
          First to the target score wins!
        </p>

        <div style={{ fontWeight: 700, color: '#ffd54f', marginBottom: 4 }}>👥 Multiplayer</div>
        <p style={{ margin: '0 0 16px' }}>
          Share your room code with friends — up to 4 players total.
          Empty slots are filled with bots. Pick a faction (color) before starting.
          All players go simultaneously — no turns!
        </p>

        <button
          onClick={() => setShowRules(false)}
          style={{
            width: '100%', padding: '12px', background: '#f9a825',
            color: '#111', border: 'none', borderRadius: 10,
            fontWeight: 900, fontSize: 15, cursor: 'pointer',
          }}
        >
          Got it!
        </button>
      </div>
    </div>
  );

  // ── Idle phase ───────────────────────────────────────────────────────────
  if (phase === 'idle') {
    return (
      <div className="lobby-screen">
        {rulesModal}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="lobby-title" style={{ margin: 0 }}>BingBongBlitz</div>
          <button
            onClick={() => setShowRules(true)}
            title="How to play"
            style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'rgba(255,255,255,0.12)',
              border: '1px solid rgba(255,255,255,0.25)',
              color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', flexShrink: 0, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ?
          </button>
        </div>
        <div className="lobby-subtitle">Start solo with bots, or share a room code for friends to join</div>

        {/* Auth stats banner */}
        {authInfo && (
          <div style={{
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10,
            padding: '10px 16px',
            marginBottom: 8,
            fontSize: 13,
            color: 'rgba(255,255,255,0.85)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <span style={{ color: '#66bb6a', fontSize: 16 }}>✓</span>
            <span>
              Signed in as <strong>{authInfo.displayName}</strong>
              {' · '}
              {authInfo.stats.wins}W / {authInfo.stats.gamesPlayed}G
              {authInfo.stats.gamesPlayed > 0 && (
                <span style={{ opacity: 0.6 }}>
                  {' · '}ELO {authInfo.stats.elo}
                </span>
              )}
            </span>
            <button
              onClick={() => { /* sign out just clears locally — refresh page to fully reset */ window.location.reload(); }}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 11 }}
            >
              sign out
            </button>
          </div>
        )}

        {/* Errors */}
        {error && (
          <div className="lobby-error" onClick={onClearError}>
            {error} <span style={{ opacity: 0.6, fontSize: 11 }}>(tap to dismiss)</span>
          </div>
        )}
        {authError && (
          <div className="lobby-error" onClick={onClearAuthError}>
            {authError} <span style={{ opacity: 0.6, fontSize: 11 }}>(tap to dismiss)</span>
          </div>
        )}

        {/* Name + PIN */}
        {!authInfo && (
          <div className="lobby-section">
            <div className="setup-label">Your Name</div>
            <input
              className="setup-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Enter your name"
              maxLength={16}
            />
            <div className="setup-label" style={{ marginTop: 10 }}>
              PIN{' '}
              <span style={{ fontWeight: 400, opacity: 0.5 }}>
                (4 digits, optional — saves your stats across devices)
              </span>
            </div>
            <input
              className="setup-input"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="Leave blank to play as guest"
              maxLength={4}
            />
          </div>
        )}

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
              disabled={!canProceed || !joinCode.trim() || isAuthenticating}
            >
              {isAuthenticating && pendingJoin ? '…' : 'Join'}
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="lobby-divider"><span>or</span></div>

        {/* Create room */}
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

          <button className="start-btn" onClick={handleCreate}
            disabled={!canProceed || isAuthenticating}>
            {isAuthenticating && pendingCreate ? 'Signing in…' : 'Create Game'}
          </button>
        </div>
      </div>
    );
  }

  // ── Lobby phase ──────────────────────────────────────────────────────────
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
          Share this code with friends — anyone can join at <strong>bingbongblitz.com</strong>
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
        <div className="lobby-section">
          {isHost ? (
            <>
              {!allHaveFactions && (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginBottom: 8 }}>
                  All players must pick a faction to start
                </div>
              )}
              <button className="start-btn" onClick={onStartGame} disabled={!canStart}>
                Start Game ▶
              </button>
            </>
          ) : (
            <div className="lobby-waiting">
              <div className="lobby-waiting-dot" />
              Waiting for host to start…
            </div>
          )}
        </div>

        <button className="back-btn" onClick={onLeave} style={{ marginTop: 12 }}>
          ← Leave Room
        </button>
      </div>
    );
  }

  // Fallback
  return (
    <div className="lobby-screen">
      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 16 }}>Connecting…</div>
    </div>
  );
}
