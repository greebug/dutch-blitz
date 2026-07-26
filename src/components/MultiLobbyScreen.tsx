import React, { useState, useEffect, useRef } from 'react';
import { CardColor, BotDifficulty } from '../game/types';
import {
  LobbyPlayer, LobbyState, RoomConfig, ChatMessage, AuthInfo, BASE, ACCOUNT_HELP_URL,
} from '../hooks/useMultiplayer';
import { Leaderboard } from './Leaderboard';
import { unlockAudio, startMusic } from '../hooks/useSounds';
import { FactionIcon, FACTION_LABEL, BoyIcon, GirlIcon } from './icons';

// ─── Faction config ───────────────────────────────────────────────────────────

const FACTIONS: { color: CardColor; label: string; bg: string; text: string }[] = [
  { color: 'red',    label: FACTION_LABEL.red,    bg: 'var(--card-red)', text: 'white' },
  { color: 'blue',   label: FACTION_LABEL.blue,   bg: 'var(--card-blue)', text: 'white' },
  { color: 'green',  label: FACTION_LABEL.green,  bg: 'var(--card-green)', text: 'white' },
  { color: 'yellow', label: FACTION_LABEL.yellow, bg: 'var(--card-yellow)', text: 'white' },
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
  authResolved: boolean;
  authPending: boolean;
  onSignIn: (username: string, password: string) => Promise<boolean>;
  onSignUp: (username: string, password: string, email: string) => Promise<boolean>;
  onSignOut: () => void;
  onClearAuthError: () => void;
  onSendMessage: (text: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MultiLobbyScreen({
  phase, lobbyState, myPlayerId, error,
  authInfo, authError, authResolved, authPending,
  initialRoomCode, chatMessages,
  onCreateRoom, onJoinRoom, onChangeFaction, onUpdateConfig, onStartGame, onLeave,
  onClearError, onSignIn, onSignUp, onSignOut, onClearAuthError, onSendMessage,
}: Props) {
  const [name, setName] = useState(() => localStorage.getItem('db-player-name') ?? '');
  const [joinCode, setJoinCode] = useState(initialRoomCode);
  const [targetScore, setTargetScore] = useState(75);
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>('medium');
  const [chatInput, setChatInput] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  // Sign-in modal. Credentials go to Guesswhere, which owns accounts for every
  // game on the domain -- there is no Blitz-specific password.
  const [showSignIn, setShowSignIn] = useState(false);
  const [signUpMode, setSignUpMode] = useState(false);
  const [authUser, setAuthUser] = useState('');
  const [authPass, setAuthPass] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  // Auto-join modal (shown when arriving via invite link)
  const [showAutoJoin, setShowAutoJoin] = useState(() => initialRoomCode.length > 0);
  const [autoJoinName, setAutoJoinName] = useState(() => localStorage.getItem('db-player-name') ?? '');
  // Copy-link feedback
  const [copySuccess, setCopySuccess] = useState(false);
  const chatListRef = useRef<HTMLDivElement>(null);

  // Scroll only the message list — not the whole page
  useEffect(() => {
    const el = chatListRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [chatMessages]);

  // Signing in closes the modal and clears the fields. Driven by authInfo
  // rather than by the submit handler's return, so it also covers arriving
  // already signed in from another game.
  useEffect(() => {
    if (!authInfo) return;
    setShowSignIn(false);
    setAuthUser('');
    setAuthPass('');
    setAuthEmail('');
  }, [authInfo]);

  function openSignIn(signUp: boolean) {
    onClearAuthError();
    setSignUpMode(signUp);
    setShowSignIn(true);
  }

  async function handleAuthSubmit() {
    if (!authUser.trim() || !authPass || authPending) return;
    if (signUpMode) await onSignUp(authUser.trim(), authPass, authEmail);
    else await onSignIn(authUser.trim(), authPass);
  }

  function handleAutoJoinSubmit() {
    const n = authInfo ? authInfo.displayName : autoJoinName.trim();
    if (!n) return;
    unlockAudio(); // pre-warm AudioContext inside this gesture so music works on iOS
    setShowAutoJoin(false);
    if (!authInfo) localStorage.setItem('db-player-name', n);
    onJoinRoom(initialRoomCode, n);
  }

  function handleCopyLink(code: string) {
    // BASE, not a bare '/': in production the game lives at /blitz/, and the
    // domain root is the hub's landing page.
    const url = `${window.location.origin}${BASE}?room=${code}`;
    // Mobile: use native share sheet when available
    if (navigator.share) {
      navigator.share({ title: 'Join my BingBongBlitz game!', url }).catch(() => {});
      return;
    }
    // Desktop: copy to clipboard
    navigator.clipboard?.writeText(url).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2200);
    }).catch(() => {
      // Last resort: browser prompt
      window.prompt('Copy this invite link:', url);
    });
  }

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

  // Signing in no longer gates starting a game: identity already came in on the
  // socket handshake, so by this point you are either signed in or a guest and
  // there is nothing left to wait for. (The server re-derives a signed-in
  // player's name from the account anyway, so the name sent here is only ever
  // used for guests.)
  function handleCreate() {
    if (!canProceed) return;
    unlockAudio(); // pre-warm AudioContext inside this gesture so music works on iOS
    if (!authInfo) localStorage.setItem('db-player-name', displayName);
    onCreateRoom(displayName, { targetScore, botDifficulty });
  }

  function handleJoin() {
    if (!canProceed || !joinCode.trim()) return;
    unlockAudio(); // pre-warm AudioContext inside this gesture so music works on iOS
    if (!authInfo) localStorage.setItem('db-player-name', displayName);
    onJoinRoom(joinCode.trim(), displayName);
  }

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
        <p style={{ margin: '0 0 4px' }}>
          You can also move cards between your own Post piles. A Post pile counts{' '}
          <strong>down</strong> — and every card must <strong>alternate boy and girl</strong>,
          which is what the mark in the card&apos;s corner tells you:
        </p>
        <p
          style={{
            margin: '0 0 4px', display: 'flex', alignItems: 'center',
            gap: 6, flexWrap: 'wrap', fontSize: 13,
          }}
        >
          <BoyIcon size={16} style={{ verticalAlign: '-0.18em' }} />
          <span>boy — Carriage (red) and Plow (blue)</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <GirlIcon size={16} style={{ verticalAlign: '-0.18em' }} />
          <span>girl — Pump (green) and Pail (yellow)</span>
        </p>
        <p style={{ margin: '0 0 12px' }}>
          So an 8 with a boy mark only takes a 7 with a girl mark, and so on. Tap a
          card, then tap the destination to move it.
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

  // ── Profile modal ────────────────────────────────────────────────────────
  function fmtSpeed(v: number | null | undefined) {
    return v != null ? v.toFixed(1) + 's/card' : '—';
  }
  function fmtPct(wins: number, games: number) {
    if (games === 0) return '—';
    return Math.round((wins / games) * 100) + '%';
  }

  const profileModal = showProfile && (
    <div
      onClick={() => setShowProfile(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 999,
        background: 'rgba(0,0,0,0.78)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 16, padding: '24px 20px', maxWidth: 360, width: '100%',
          maxHeight: '82vh', overflowY: 'auto', color: 'rgba(255,255,255,0.88)',
          fontSize: 14, lineHeight: 1.6,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 16, color: '#ffd54f' }}>
          👤 Profile
        </div>

        {authInfo ? (
          <>
            <div style={{ marginBottom: 16, fontSize: 13, color: '#66bb6a' }}>
              ✓ Signed in as <strong>{authInfo.displayName}</strong>
            </div>

            {/* ELO — big hero stat */}
            <div style={{
              background: 'rgba(249,168,37,0.1)', border: '1px solid rgba(249,168,37,0.3)',
              borderRadius: 10, padding: '12px 16px', marginBottom: 14, textAlign: 'center',
            }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 }}>ELO Rating</div>
              <div style={{ fontSize: 32, fontWeight: 900, color: '#ffd54f' }}>{authInfo.stats.elo}</div>
            </div>

            {/* Stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
              {[
                { label: 'Win Rate',     value: fmtPct(authInfo.stats.wins, authInfo.stats.gamesPlayed) },
                { label: 'Games Played', value: String(authInfo.stats.gamesPlayed) },
                { label: 'Wins',         value: String(authInfo.stats.wins) },
                { label: 'Rounds',       value: String(authInfo.stats.roundsPlayed) },
              ].map(({ label, value }) => (
                <div key={label} style={{
                  background: 'rgba(255,255,255,0.05)', borderRadius: 8,
                  padding: '10px 12px',
                }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'rgba(255,255,255,0.9)' }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Speed stats */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Speed</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '8px 12px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>Best Round</span>
                  <span style={{ fontWeight: 700, color: '#ffd54f' }}>{fmtSpeed(authInfo.stats.bestRoundSpeed)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '8px 12px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>Lifetime Avg</span>
                  <span style={{ fontWeight: 700, color: '#ffd54f' }}>{fmtSpeed(authInfo.stats.avgGameSpeed)}</span>
                </div>
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 6 }}>
                Lower is faster · rounds with ≥5 cards counted
              </div>
            </div>

            <button
              onClick={() => { setShowProfile(false); onSignOut(); }}
              disabled={authPending}
              style={{
                width: '100%', padding: '9px', marginBottom: 8,
                background: 'rgba(255,255,255,0.07)',
                color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8, cursor: 'pointer', fontSize: 12,
              }}
            >
              Sign Out
            </button>
          </>
        ) : (
          <>
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, marginBottom: 16 }}>
              Sign in to keep your wins, ELO and speed records. One account covers
              every game at bingbongblitz.com.
            </div>

            <button
              onClick={() => { setShowProfile(false); openSignIn(false); }}
              style={{
                width: '100%', padding: '11px', marginBottom: 8,
                background: '#f9a825', color: '#111',
                border: 'none', borderRadius: 10,
                fontWeight: 800, fontSize: 14, cursor: 'pointer',
              }}
            >
              Sign In
            </button>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', textAlign: 'center' }}>
              No account?{' '}
              <button
                onClick={() => { setShowProfile(false); openSignIn(true); }}
                style={{
                  background: 'none', border: 'none', padding: 0, fontSize: 11,
                  color: 'rgba(255,255,255,0.5)', textDecoration: 'underline', cursor: 'pointer',
                }}
              >
                Create one
              </button>
              {' '}— or just play as a guest.
            </div>
          </>
        )}

        <button
          onClick={() => setShowProfile(false)}
          style={{
            width: '100%', padding: '10px', marginTop: 4,
            background: '#f9a825', color: '#111',
            border: 'none', borderRadius: 10,
            fontWeight: 900, fontSize: 14, cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
    </div>
  );

  // ── Sign-in modal ────────────────────────────────────────────────────────
  // Posts to Guesswhere's auth API, same origin. The session cookie it sets is
  // scoped to the whole domain, so signing in here also signs you in at
  // /guesswhere and anywhere else on bingbongblitz.com.
  const signInModal = showSignIn && (
    <div
      onClick={() => setShowSignIn(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 1001,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); handleAuthSubmit(); }}
        style={{
          background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 16, padding: '26px 22px', maxWidth: 340, width: '100%',
          color: 'rgba(255,255,255,0.88)', fontSize: 14, lineHeight: 1.6,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 900, color: '#ffd54f', marginBottom: 4 }}>
          {signUpMode ? 'Create an account' : 'Sign in'}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 18 }}>
          One account for every game at bingbongblitz.com.
        </div>

        {authError && (
          <div style={{ background: 'rgba(239,83,80,0.15)', border: '1px solid rgba(239,83,80,0.4)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: '#ef9a9a' }}>
            {authError}
          </div>
        )}

        <div className="setup-label">Username</div>
        <input
          className="setup-input"
          value={authUser}
          onChange={e => setAuthUser(e.target.value)}
          placeholder="Your username"
          autoComplete="username"
          maxLength={20}
          autoFocus
          style={{ marginBottom: 10 }}
        />

        <div className="setup-label">Password</div>
        <input
          className="setup-input"
          type="password"
          value={authPass}
          onChange={e => setAuthPass(e.target.value)}
          placeholder={signUpMode ? 'At least 8 characters' : 'Your password'}
          autoComplete={signUpMode ? 'new-password' : 'current-password'}
          style={{ marginBottom: signUpMode ? 10 : 18 }}
        />

        {signUpMode && (
          <>
            <div className="setup-label">
              Email{' '}
              <span style={{ fontWeight: 400, opacity: 0.5 }}>
                (optional — the only way to reset a forgotten password)
              </span>
            </div>
            <input
              className="setup-input"
              type="email"
              value={authEmail}
              onChange={e => setAuthEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              style={{ marginBottom: 18 }}
            />
          </>
        )}

        <button
          type="submit"
          disabled={!authUser.trim() || !authPass || authPending}
          style={{
            width: '100%', padding: '12px',
            background: authUser.trim() && authPass && !authPending ? '#f9a825' : 'rgba(255,255,255,0.12)',
            color: authUser.trim() && authPass && !authPending ? '#111' : 'rgba(255,255,255,0.35)',
            border: 'none', borderRadius: 10,
            fontWeight: 900, fontSize: 15, cursor: 'pointer',
            marginBottom: 10,
          }}
        >
          {authPending ? '…' : signUpMode ? 'Create account' : 'Sign in'}
        </button>

        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>
          {signUpMode ? 'Already have one? ' : 'No account yet? '}
          <button
            type="button"
            onClick={() => { onClearAuthError(); setSignUpMode(!signUpMode); }}
            style={{
              background: 'none', border: 'none', padding: 0, fontSize: 12,
              color: 'rgba(255,255,255,0.6)', textDecoration: 'underline', cursor: 'pointer',
            }}
          >
            {signUpMode ? 'Sign in' : 'Create one'}
          </button>
        </div>

        {!signUpMode && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', textAlign: 'center', marginTop: 8 }}>
            {/* Password reset arrives by emailed link, so it stays on Guesswhere's
                own pages rather than being rebuilt here. */}
            <a href={ACCOUNT_HELP_URL} style={{ color: 'rgba(255,255,255,0.4)' }}>
              Forgot your password?
            </a>
          </div>
        )}
      </form>
    </div>
  );

  // ── Auto-join modal (invite link entry) ─────────────────────────────────
  const autoJoinModal = showAutoJoin && initialRoomCode && phase === 'idle' && (
    <div
      onClick={() => setShowAutoJoin(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 16, padding: '28px 22px', maxWidth: 340, width: '100%',
          color: 'rgba(255,255,255,0.88)', fontSize: 14, lineHeight: 1.6,
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 900, color: '#ffd54f', marginBottom: 6 }}>
          🎮 You're invited!
        </div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginBottom: 20 }}>
          Joining room{' '}
          <span style={{ fontWeight: 900, letterSpacing: 3, color: 'rgba(255,255,255,0.9)' }}>
            {initialRoomCode}
          </span>
        </div>

        {authInfo ? (
          /* Already signed in — just confirm */
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: '#66bb6a', marginBottom: 12 }}>
              ✓ Playing as <strong>{authInfo.displayName}</strong>
            </div>
          </div>
        ) : (
          /* Playing as a guest -- just a name. Signing in is offered below
             rather than required: an invite link should never dead-end at a
             login form. */
          <>
            <div className="setup-label">Your Name</div>
            <input
              className="setup-input"
              value={autoJoinName}
              onChange={e => setAutoJoinName(e.target.value)}
              placeholder="Enter your name"
              maxLength={16}
              autoFocus
              style={{ marginBottom: 10 }}
            />
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 20 }}>
              Playing as a guest.{' '}
              <button
                onClick={() => { setShowAutoJoin(false); openSignIn(false); }}
                style={{
                  background: 'none', border: 'none', padding: 0, fontSize: 11,
                  color: 'rgba(255,255,255,0.55)', textDecoration: 'underline', cursor: 'pointer',
                }}
              >
                Sign in
              </button>
              {' '}first to record your stats.
            </div>
          </>
        )}

        <button
          onClick={handleAutoJoinSubmit}
          disabled={!authInfo && !autoJoinName.trim()}
          style={{
            width: '100%', padding: '13px',
            background: (authInfo || autoJoinName.trim()) ? '#f9a825' : 'rgba(255,255,255,0.12)',
            color: (authInfo || autoJoinName.trim()) ? '#111' : 'rgba(255,255,255,0.3)',
            border: 'none', borderRadius: 10,
            fontWeight: 900, fontSize: 16, cursor: 'pointer',
            marginBottom: 10,
          }}
        >
          Join Game ▶
        </button>

        <button
          onClick={() => setShowAutoJoin(false)}
          style={{
            width: '100%', padding: '9px',
            background: 'none',
            color: 'rgba(255,255,255,0.35)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10, cursor: 'pointer', fontSize: 13,
          }}
        >
          Set up my profile first
        </button>
      </div>
    </div>
  );

  // ── Idle phase ───────────────────────────────────────────────────────────
  if (phase === 'idle') {
    return (
      <div className="lobby-screen">
        {rulesModal}
        {profileModal}
        {signInModal}
        {autoJoinModal}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Profile button — left of title */}
          <button
            onClick={() => setShowProfile(true)}
            title="Your profile"
            style={{
              width: 30, height: 30, borderRadius: '50%',
              background: authInfo ? 'rgba(102,187,106,0.25)' : 'rgba(255,255,255,0.10)',
              border: authInfo ? '1px solid rgba(102,187,106,0.5)' : '1px solid rgba(255,255,255,0.22)',
              color: authInfo ? '#66bb6a' : 'rgba(255,255,255,0.65)',
              fontSize: 15, cursor: 'pointer', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            👤
          </button>

          <div
            className="lobby-title"
            style={{ margin: 0, flex: 1, textAlign: 'center', cursor: 'pointer' }}
            onClick={() => { window.location.href = BASE; }}
          >BingBongBlitz</div>

          {/* Rules button — right of title */}
          <button
            onClick={() => setShowRules(true)}
            title="How to play"
            style={{
              width: 30, height: 30, borderRadius: '50%',
              background: 'rgba(255,255,255,0.10)',
              border: '1px solid rgba(255,255,255,0.22)',
              color: 'rgba(255,255,255,0.65)', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', flexShrink: 0,
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
              onClick={onSignOut}
              disabled={authPending}
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

        {/* Guest name, or an invitation to sign in. Rendered only once the
            server has said who you are -- showing the signed-out form first
            and swapping it out a beat later reads as having been logged out. */}
        {authResolved && !authInfo && (
          <div className="lobby-section">
            <div className="setup-label">Your Name</div>
            <input
              className="setup-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Enter your name"
              maxLength={16}
            />
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.35)',
            }}>
              <span>Playing as a guest — wins and records aren&apos;t saved.</span>
              <button
                onClick={() => openSignIn(false)}
                style={{
                  marginLeft: 'auto',
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  borderRadius: 8, padding: '6px 12px',
                  color: 'rgba(255,255,255,0.75)', fontSize: 12, cursor: 'pointer',
                }}
              >
                Sign in
              </button>
            </div>
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
              disabled={!canProceed || !joinCode.trim() || !authResolved}
            >
              Join
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
            disabled={!canProceed || !authResolved}>
            Create Game
          </button>
        </div>

        <Leaderboard />
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="lobby-title" style={{ margin: 0, flex: 1 }}>
            Room: <span className="lobby-room-code">{lobbyState.code}</span>
          </div>
          <button
            onClick={() => handleCopyLink(lobbyState.code)}
            title="Copy invite link"
            style={{
              padding: '7px 14px',
              borderRadius: 20,
              border: copySuccess
                ? '1px solid rgba(102,187,106,0.6)'
                : '1px solid rgba(255,255,255,0.22)',
              background: copySuccess
                ? 'rgba(102,187,106,0.18)'
                : 'rgba(255,255,255,0.10)',
              color: copySuccess ? '#66bb6a' : 'rgba(255,255,255,0.8)',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.2s',
              flexShrink: 0,
            }}
          >
            {copySuccess ? '✓ Copied!' : '🔗 Invite'}
          </button>
        </div>
        <div className="lobby-subtitle">
          Tap <strong>Invite</strong> to share the link — friends go straight to the join screen
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
                  {p.faction ? <FactionIcon color={p.faction} size={20} /> : '?'}
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
                  <FactionIcon color={f.color} size={30} className="faction-symbol" />
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
              <button className="start-btn" onClick={() => { unlockAudio(); startMusic(); onStartGame(); }} disabled={!canStart}>
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
