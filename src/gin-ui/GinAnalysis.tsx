import { useEffect, useMemo, useState } from 'react';

import { type Card, cardId } from '../gin/cards';
import type { HandForAnalysis, Moment, Verdict } from '../gin/lab/analysis';
import { sortHand } from '../gin/order';
import { CardFace } from './CardFace';

const VERDICT: Record<Verdict, { label: string; short: string }> = {
  best: { label: 'Best move', short: '✓' },
  close: { label: 'Close call', short: '≈' },
  inaccuracy: { label: 'Inaccuracy', short: '?!' },
  mistake: { label: 'Mistake', short: '?' },
  blunder: { label: 'Blunder', short: '??' },
  forced: { label: 'Forced', short: '·' },
};

const FLAGGED: Verdict[] = ['inaccuracy', 'mistake', 'blunder'];
const flagged = (m: Moment) => FLAGGED.includes(m.verdict);

const same = (a: Card | null, b: Card) => !!a && a.suit === b.suit && a.rank === b.rank;
const pct = (x: number) => `${Math.round(100 * x)}%`;
const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;

/**
 * Hand review: every decision the person made, judged by the champion from
 * the same chair, stepping through the hand one decision at a time.
 *
 * The work runs in a worker (analysis.worker.ts) and streams in, so the first
 * decisions are readable while the rest are still being played out.
 */
export default function GinAnalysis({
  hand,
  opponentLabel,
  onClose,
}: {
  hand: HandForAnalysis;
  opponentLabel: string;
  onClose: () => void;
}) {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  /** Until the person picks a decision, follow the first flagged one as it arrives. */
  const [chosen, setChosen] = useState(false);

  useEffect(() => {
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    const id = Date.now();
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.id !== id) return;
      if (msg.error) setError(msg.error);
      else if (msg.finished) setFinished(true);
      else {
        setProgress({ done: msg.done, total: msg.total });
        if (msg.moment) setMoments((ms) => [...ms, msg.moment as Moment]);
      }
    };
    worker.postMessage({ id, hand });
    return () => worker.terminate();
  }, [hand]);

  // Land on the first real mistake, once there is one.
  useEffect(() => {
    if (chosen) return;
    const k = moments.findIndex(flagged);
    if (k >= 0) setAt(k);
  }, [moments, chosen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(at + 1);
      else if (e.key === 'ArrowLeft') go(at - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function go(k: number) {
    if (k < 0 || k >= moments.length) return;
    setChosen(true);
    setAt(k);
  }

  const summary = useMemo(() => {
    const judged = moments.filter((m) => m.verdict !== 'forced');
    const agreed = judged.filter((m) => m.verdict === 'best' || m.verdict === 'close').length;
    const cost = moments.filter(flagged).reduce((a, m) => a + m.cost, 0);
    return { judged: judged.length, agreed, cost, flagged: moments.filter(flagged).length };
  }, [moments]);

  const m = moments[at];
  const nextFlag = moments.findIndex((x, i) => i > at && flagged(x));

  // In the board's place rather than over it: the hand is finished, so the
  // table has nothing left to show, and a phone gets the whole screen for the
  // review instead of a dialog to scroll inside.
  return (
    <section className="gin-review" aria-label="Hand review">
      <div className="gin-review__panel">
        <header className="gin-review__head">
          <h2>Hand review</h2>
          <button type="button" className="gin-btn gin-btn--quiet gin-review__back" onClick={onClose}>
            ‹ Result
          </button>
        </header>

        <p className="gin-review__summary">
          {error ? (
            `The analysis failed: ${error}`
          ) : finished ? (
            summary.flagged === 0 ? (
              `Every one of your ${summary.judged} decisions matched the champion or came within the noise. Clean hand.`
            ) : (
              <>
                You matched the champion on <strong>{summary.agreed}</strong> of {summary.judged} decisions.{' '}
                {summary.flagged} {summary.flagged === 1 ? 'was an error' : 'were errors'}, worth about{' '}
                <strong>{summary.cost.toFixed(1)} points</strong> in all.
              </>
            )
          ) : (
            `Playing out every decision… ${progress.done} of ${progress.total || '…'}`
          )}
        </p>
        {!finished && !error && (
          <div className="gin-review__bar" aria-hidden="true">
            <span style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 4}%` }} />
          </div>
        )}

        <ol className="gin-review__timeline" aria-label="Your decisions">
          {moments.map((x, i) => (
            <li key={x.index}>
              <button
                type="button"
                className={`gin-review__dot${i === at ? ' is-on' : ''}`}
                data-verdict={x.verdict}
                onClick={() => go(i)}
                title={`Turn ${x.turn} ${x.kind}: ${VERDICT[x.verdict].label}`}
              >
                {VERDICT[x.verdict].short}
              </button>
            </li>
          ))}
        </ol>

        {m && <Detail m={m} />}
        <p className="gin-review__fine">
          Judged from your chair: the analysis sees only what you saw, never the {opponentLabel.toLowerCase()}'s cards.
          Points are per hand, averaged over hundreds of ways the rest of the hand could go.
        </p>

        <footer className="gin-review__nav">
          <button type="button" className="gin-btn gin-btn--quiet" onClick={() => go(at - 1)} disabled={at <= 0}>
            ‹ Previous
          </button>
          <button
            type="button"
            className="gin-btn gin-btn--quiet"
            onClick={() => go(at + 1)}
            disabled={at >= moments.length - 1}
          >
            Next ›
          </button>
          <button type="button" className="gin-btn gin-btn--gold" onClick={() => go(nextFlag)} disabled={nextFlag < 0}>
            Next error »
          </button>
        </footer>
      </div>
    </section>
  );
}

function Detail({ m }: { m: Moment }) {
  const cards = useMemo(() => sortHand(m.hand), [m.hand]);
  const disagree = m.verdict !== 'best' && m.verdict !== 'forced';
  const yoursCard = m.yours.card;
  const bestCard = m.best.card;
  const isDraw = m.kind === 'draw';

  const mark = (c: Card): string | null => {
    if (isDraw) return null;
    if (same(bestCard, c) && same(yoursCard, c)) return 'both';
    if (same(bestCard, c)) return disagree ? 'best' : 'both';
    if (same(yoursCard, c)) return 'yours';
    return null;
  };

  return (
    <section className="gin-review__detail" data-verdict={m.verdict}>
      <div className="gin-review__title">
        <span>
          Turn {m.turn} · {isDraw ? 'draw' : 'discard'}
          <span className="gin-review__stock"> · {m.stockCount} left in the stock</span>
        </span>
        <span className="gin-review__badge" data-verdict={m.verdict}>
          {VERDICT[m.verdict].label}
          {FLAGGED.includes(m.verdict) && ` · ${m.cost.toFixed(1)} pts`}
        </span>
      </div>

      <div className="gin-review__table">
        {isDraw && (
          <div className="gin-review__upcard">
            <span className="gin-review__tag">Upcard</span>
            <div className={`gin-review__slot${m.best.code === 1 && disagree ? ' is-best' : ''}${m.yours.code === 1 && disagree ? ' is-yours' : ''}`}>
              {m.upcard ? <CardFace card={m.upcard} /> : <span className="gin-review__none">none</span>}
            </div>
          </div>
        )}
        <div className="gin-review__hand">
          <span className="gin-review__tag">Your hand{isDraw ? '' : ' after drawing'}</span>
          <div className="gin-review__cards">
            {cards.map((c) => {
              const k = mark(c);
              return (
                <div key={cardId(c)} className={`gin-review__slot${k ? ` is-${k}` : ''}`}>
                  <CardFace card={c} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <dl className="gin-review__moves">
        <div data-who="yours">
          <dt>You</dt>
          <dd>{m.yours.text}</dd>
        </div>
        {disagree && (
          <div data-who="best">
            <dt>Best</dt>
            <dd>{m.best.text}</dd>
          </div>
        )}
      </dl>

      {m.verdict === 'close' && (
        <p className="gin-review__why-none">
          The champion leans toward “{m.best.text}”, but over {m.worlds} play-outs the two came out within{' '}
          {Math.max(0, m.cost).toFixed(1)} points — too close to call a mistake.
        </p>
      )}

      {m.why.length > 0 && (
        <ul className="gin-review__why">
          {m.why.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {m.odds && FLAGGED.includes(m.verdict) && (
        <p className="gin-review__odds">
          Over {m.worlds} play-outs from here, your move averaged <strong>{signed(m.odds.yours.mean)}</strong> points
          (won the hand {pct(m.odds.yours.win)} of the time); the best move averaged{' '}
          <strong>{signed(m.odds.best.mean)}</strong> (won {pct(m.odds.best.win)}).
        </p>
      )}
    </section>
  );
}
