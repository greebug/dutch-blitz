import { type FormEvent, useEffect, useRef, useState } from 'react';

import type { HandForAnalysis } from '../gin/lab/analysis';
import GinAnalysis from './GinAnalysis';
import GinBoard from './GinBoard';
import GinShowdown from './GinShowdown';
import { BURST_MS } from './GinBurst';
import { savedName, useGinTable } from './useGinTable';

/** The word gets to finish before the next hand lands on top of it. */
const PUSH_HOLD_MS = BURST_MS + 400;
/**
 * How long the other seat waits before dealing the push itself.
 *
 * One seat deals, or both would ask at once and the server would tell the
 * loser its hand is still going. This is the other seat stepping in when the
 * first one is away, by which time a deal from the host has long since
 * arrived and there is nothing left to ask for.
 */
const PUSH_RELIEF_MS = 4000;

/** What the host can play a match to. Null is no limit at all. */
const TARGETS: (number | null)[] = [50, 100, 150, 200, 250, 500, null];
const targetLabel = (t: number | null) => (t === null ? '∞' : String(t));

/**
 * Two players, one table, server-authoritative.
 *
 * Nothing here decides anything about the game. Every button posts an intent
 * and waits for the server to send a new view back; if the server disagrees --
 * wrong turn, illegal knock, hand already over -- the view simply does not
 * change and the reason appears in the banner. That is deliberately the only
 * feedback path, because a client that predicted the result locally would have
 * to be trusted about it.
 */
export default function GinOnline() {
  const t = useGinTable();
  const [codeInput, setCodeInput] = useState('');
  const [name, setName] = useState(savedName);
  const [target, setTarget] = useState<number | null>(100);
  const [copied, setCopied] = useState(false);
  // A knock is a discard too, so the hand is over while its last card is still
  // crossing the table. The result waits for it to land.
  const [inFlight, setInFlight] = useState(false);
  const [review, setReview] = useState<HandForAnalysis | null>(null);

  const { table, view, connection, replay } = t;
  const me = table?.seats.find((s) => s.seat === table.youAre) ?? null;
  const opponent = table?.seats.find((s) => s.seat !== table.youAre) ?? null;
  const opponentName = opponent?.name ?? 'Opponent';

  // Held in a ref so the push timer below does not restart on every message
  // from the server, which would stop it ever firing.
  const dealHand = useRef(t.dealHand);
  dealHand.current = t.dealHand;

  const pushed = view?.phase === 'over' && view.score?.outcome === 'dead-hand';
  const canDeal = !!table?.canDeal;
  const host = !!table?.host;
  useEffect(() => {
    if (!pushed || !canDeal || table?.matchWinner != null) return;
    const wait = host ? PUSH_HOLD_MS : PUSH_HOLD_MS + PUSH_RELIEF_MS;
    const timer = setTimeout(() => dealHand.current(), wait);
    return () => clearTimeout(timer);
  }, [pushed, canDeal, host, table?.matchWinner]);

  // A review belongs to the hand it was asked about.
  useEffect(() => setReview(null), [replay]);

  if (connection === 'connecting' && !table) {
    return <p className="gin-note">Connecting…</p>;
  }

  // --- No table yet: who you are, then open one or type a code ---------------
  if (!table) {
    const guest = t.account === null;
    const ready = !guest || name.trim().length > 0;
    const playAs = t.account ?? name.trim();
    return (
      <div className="gin-lobby">
        {t.error && <p className="gin-banner">{t.error}</p>}

        <Identity
          account={t.account}
          name={name}
          onName={setName}
          pending={t.authPending}
          onSignIn={t.signIn}
          onSignOut={t.signOut}
        />

        <div className="gin-lobby__half">
          <h2>Start a table</h2>
          <p>You get a four-letter code to pass to the other player.</p>
          <TargetPicker value={target} onChange={setTarget} />
          <button
            type="button"
            className="gin-btn gin-btn--go"
            onClick={() => t.createTable(playAs, target)}
            disabled={!ready}
          >
            Open a table
          </button>
        </div>
        <div className="gin-lobby__half">
          <h2>Join a table</h2>
          <p>The host picks what the match is played to.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (ready && codeInput.trim()) t.joinTable(codeInput, playAs);
            }}
          >
            <input
              className="gin-codeinput"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="CODE"
              aria-label="Table code"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="gin-btn" disabled={!ready || codeInput.trim().length < 4}>
              Join
            </button>
          </form>
        </div>
      </div>
    );
  }

  const waiting = table.seats.length < 2;
  const over = view?.phase === 'over';
  const decided = table.matchWinner !== null;
  const theirs = table.youAre === 0 ? 1 : 0;
  const tally = `${me?.name ?? 'You'} ${table.running[table.youAre]} · ${opponentName} ${table.running[theirs]}`;
  // Before a match starts, or once it is decided, the host may move the line.
  const canRetarget = host && !table.inHand && (table.handsPlayed === 0 || decided);
  /** The result has the screen: the board steps aside for it. */
  const showing = !!view && over && !!view.score && !pushed && !inFlight;

  return (
    <div className="gin-online">
      <div className="gin-tablebar">
        <span className="gin-tablecode">
          Table <strong>{table.code}</strong>
        </span>
        <button
          type="button"
          className="gin-btn gin-btn--quiet"
          onClick={() => {
            navigator.clipboard?.writeText(table.code).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => setCopied(false)
            );
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <span className="gin-tablescore">
          <span className="gin-tablescore__me">{me?.name ?? 'You'}</span> <strong>{table.running[table.youAre]}</strong>
          {opponent && (
            <>
              {' · '}
              {opponentName} <strong>{table.running[theirs]}</strong>
            </>
          )}
          <span className="gin-tablescore__to"> to {targetLabel(table.target)}</span>
        </span>
        <button type="button" className="gin-btn gin-btn--quiet" onClick={t.leaveTable}>
          Leave
        </button>
      </div>

      {connection !== 'online' && (
        <p className="gin-banner">
          {connection === 'offline' ? 'Disconnected — trying to get back…' : 'Reconnecting…'}
        </p>
      )}
      {t.error && <p className="gin-banner">{t.error}</p>}

      {waiting && (
        <div className="gin-note">
          <p>
            Waiting for a second player. Give them the code <strong>{table.code}</strong>.
          </p>
          {canRetarget && <TargetPicker value={table.target} onChange={t.setTarget} />}
        </div>
      )}

      {!waiting && !view && (
        <div className="gin-note">
          <p>
            {opponentName} is here.
            {table.handsPlayed > 0 ? ` ${table.handsPlayed} hand${table.handsPlayed === 1 ? '' : 's'} played.` : ''}
            {!canRetarget && table.handsPlayed === 0 && ` Playing to ${targetLabel(table.target)}.`}
          </p>
          {canRetarget && <TargetPicker value={table.target} onChange={t.setTarget} />}
          <button type="button" className="gin-btn gin-btn--go" onClick={t.dealHand} disabled={!table.canDeal}>
            Deal
          </button>
        </div>
      )}

      {view && (
        <GinBoard
          view={view}
          opponentLabel={opponentName}
          opponentNote={
            opponent && !opponent.connected
              ? 'away'
              : !view.yourTurn && view.phase !== 'over'
                ? 'their move'
                : null
          }
          onDrawStock={t.drawStock}
          onTakeDiscard={t.takeDiscard}
          onDiscard={t.discard}
          onKnock={t.knock}
          onBigGin={t.bigGin}
          onBusyChange={setInFlight}
          away={showing}
        />
      )}

      {view && showing && (
        <div className="gin-stage" hidden={!!review}>
          <GinShowdown
            view={view}
            opponentLabel={opponentName}
            onNext={t.dealHand}
            nextDisabled={!table.canDeal}
            nextLabel={decided ? 'New match' : undefined}
            onAnalyze={replay ? () => setReview(replay) : undefined}
            note={
              decided
                ? `${table.matchWinner === table.youAre ? 'You win the match' : `${opponentName} wins the match`}, ${tally}`
                : `Hand ${table.handsPlayed} · ${tally}${
                    opponent && !opponent.connected ? ` · waiting for ${opponentName}` : ''
                  }`
            }
          />
          {decided && canRetarget && (
            <div className="gin-note gin-note--inline">
              <p>Next match to</p>
              <TargetPicker value={table.target} onChange={t.setTarget} />
            </div>
          )}
        </div>
      )}

      {review && <GinAnalysis hand={review} opponentLabel={opponentName} onClose={() => setReview(null)} />}
    </div>
  );
}

function TargetPicker({ value, onChange }: { value: number | null; onChange: (t: number | null) => void }) {
  return (
    <div className="gin-targets" role="radiogroup" aria-label="Play the match to">
      <span className="gin-targets__label">Play to</span>
      {TARGETS.map((x) => (
        <button
          key={targetLabel(x)}
          type="button"
          role="radio"
          aria-checked={value === x}
          className={`gin-target${value === x ? ' is-on' : ''}`}
          onClick={() => onChange(x)}
          title={x === null ? 'No limit: play until somebody leaves' : `First to ${x} points`}
        >
          {targetLabel(x)}
        </button>
      ))}
    </div>
  );
}

/**
 * Who you are at the table. Signed in, it is your account and there is nothing
 * to type; as a guest it is a name box, the way the Blitz lobby does it, with
 * signing in one tap away rather than in the way.
 */
function Identity({
  account,
  name,
  onName,
  pending,
  onSignIn,
  onSignOut,
}: {
  account: string | null | undefined;
  name: string;
  onName: (n: string) => void;
  pending: boolean;
  onSignIn: (u: string, p: string) => Promise<string | null>;
  onSignOut: () => Promise<string | null>;
}) {
  const [signingIn, setSigningIn] = useState(false);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState<string | null>(null);

  if (account === undefined) {
    return <div className="gin-who gin-who--quiet">Checking who you are…</div>;
  }

  if (account) {
    return (
      <div className="gin-who">
        <span>
          Playing as <strong>{account}</strong>
        </span>
        <button type="button" className="gin-linkbtn" onClick={() => void onSignOut()} disabled={pending}>
          Sign out
        </button>
      </div>
    );
  }

  if (signingIn) {
    const submit = async (e: FormEvent) => {
      e.preventDefault();
      if (!user.trim() || !pass) return;
      setErr(null);
      const problem = await onSignIn(user.trim(), pass);
      if (problem) setErr(problem);
      else {
        setSigningIn(false);
        setPass('');
      }
    };
    return (
      <form className="gin-who gin-who--form" onSubmit={submit}>
        <span className="gin-who__lead">One account for every game at bingbongblitz.com.</span>
        {err && <span className="gin-who__err">{err}</span>}
        <input
          className="gin-field-input"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="Username"
          autoComplete="username"
          maxLength={20}
          autoFocus
        />
        <input
          className="gin-field-input"
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
        />
        <button type="submit" className="gin-btn gin-btn--go" disabled={pending || !user.trim() || !pass}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" className="gin-linkbtn" onClick={() => setSigningIn(false)}>
          Cancel
        </button>
        <a className="gin-linkbtn" href="/guesswhere">
          No account? Make one
        </a>
      </form>
    );
  }

  return (
    <div className="gin-who">
      <label className="gin-who__name">
        Your name
        <input
          className="gin-field-input"
          value={name}
          onChange={(e) => onName(e.target.value.slice(0, 16))}
          placeholder="Enter your name"
          maxLength={16}
          autoComplete="nickname"
        />
      </label>
      <span className="gin-who__aside">
        Playing as a guest.{' '}
        <button type="button" className="gin-linkbtn" onClick={() => setSigningIn(true)}>
          Sign in
        </button>{' '}
        to use your account name.
      </span>
    </div>
  );
}
