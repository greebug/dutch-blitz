import { useEffect, useRef, useState } from 'react';

import GinBoard from './GinBoard';
import GinShowdown from './GinShowdown';
import { BURST_MS } from './GinBurst';
import { useGinTable } from './useGinTable';

/** The word gets to finish before the next hand lands on top of it. */
const PUSH_HOLD_MS = BURST_MS + 400;
/**
 * How long the other seat waits before dealing the push itself.
 *
 * One seat deals, or both would ask at once and the server would tell the
 * loser its hand is still going. This is the other seat stepping in when the
 * first one is away, by which time a deal from seat zero has long since
 * arrived and there is nothing left to ask for.
 */
const PUSH_RELIEF_MS = 4000;

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
  const [copied, setCopied] = useState(false);
  // A knock is a discard too, so the hand is over while its last card is still
  // crossing the table. The result panel waits for it to land.
  const [inFlight, setInFlight] = useState(false);

  const { table, view, connection } = t;
  const opponent = table?.seats.find((s) => s.seat !== table.youAre) ?? null;
  const opponentName = opponent?.name ?? 'Opponent';

  // Held in a ref so the push timer below does not restart on every message
  // from the server, which would stop it ever firing.
  const dealHand = useRef(t.dealHand);
  dealHand.current = t.dealHand;

  const pushed = view?.phase === 'over' && view.score?.outcome === 'dead-hand';
  const canDeal = !!table?.canDeal;
  const seat = table?.youAre;
  useEffect(() => {
    if (!pushed || !canDeal) return;
    const wait = seat === 0 ? PUSH_HOLD_MS : PUSH_HOLD_MS + PUSH_RELIEF_MS;
    const timer = setTimeout(() => dealHand.current(), wait);
    return () => clearTimeout(timer);
  }, [pushed, canDeal, seat]);

  if (connection === 'connecting' && !table) {
    return <p className="gin-note">Connecting…</p>;
  }

  // --- No table yet: open one or type a code ---------------------------------
  if (!table) {
    return (
      <div className="gin-lobby">
        {t.error && <p className="gin-banner">{t.error}</p>}
        <div className="gin-lobby__half">
          <h2>Start a table</h2>
          <p>You get a four-letter code to pass to the other player.</p>
          <button type="button" className="gin-btn gin-btn--go" onClick={t.createTable}>
            Open a table
          </button>
        </div>
        <div className="gin-lobby__half">
          <h2>Join a table</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (codeInput.trim()) t.joinTable(codeInput);
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
            <button type="submit" className="gin-btn" disabled={codeInput.trim().length < 4}>
              Join
            </button>
          </form>
        </div>
      </div>
    );
  }

  const waiting = table.seats.length < 2;
  const over = view?.phase === 'over';

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
          {copied ? 'Copied' : 'Copy code'}
        </button>
        <span className="gin-tablescore">
          You <strong>{table.running[table.youAre]}</strong>
          {' · '}
          {opponentName} <strong>{table.running[table.youAre === 0 ? 1 : 0]}</strong>
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
        <p className="gin-note">
          Waiting for a second player. Give them the code <strong>{table.code}</strong>.
        </p>
      )}

      {!waiting && !view && (
        <div className="gin-note">
          <p>
            {opponentName} is here.
            {table.handsPlayed > 0 ? ` ${table.handsPlayed} hand${table.handsPlayed === 1 ? '' : 's'} played.` : ''}
          </p>
          <button
            type="button"
            className="gin-btn gin-btn--go"
            onClick={t.dealHand}
            disabled={!table.canDeal}
          >
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
        />
      )}

      {view && over && view.score && !pushed && !inFlight && (
        <GinShowdown
          view={view}
          opponentLabel={opponentName}
          onNext={t.dealHand}
          nextDisabled={!table.canDeal}
          note={`Hand ${table.handsPlayed}${
            opponent && !opponent.connected ? ` · waiting for ${opponentName}` : ''
          }`}
        />
      )}
    </div>
  );
}
