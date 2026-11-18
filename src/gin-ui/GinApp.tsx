import { useState } from 'react';

import { NAPOLETANE_GIN } from '../gin/rules';
import DeckDefs from './deck/DeckDefs';
import GinOnline from './GinOnline';
import GinRules from './GinRules';
import GinSolo from './GinSolo';
import { HubMark } from './HubMark';

type Mode = 'solo' | 'online';

/**
 * The shell: the deck definitions, the title, and which of the two modes is on
 * screen.
 *
 * The modes are mounted and unmounted rather than hidden, which matters for the
 * online one: leaving it tears the socket down instead of leaving a table open
 * with somebody sitting at it. Solo keeps no connection and nothing to clean up.
 */
export default function GinApp() {
  const [rulesOpen, setRulesOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(() =>
    new URLSearchParams(location.search).has('online') ? 'online' : 'solo'
  );

  function choose(next: Mode) {
    setMode(next);
    const url = new URL(location.href);
    if (next === 'online') url.searchParams.set('online', '');
    else url.searchParams.delete('online');
    history.replaceState({}, '', url);
  }

  return (
    <div className="gin">
      {/* Every pip, ace and court figure, defined once for the whole screen. */}
      <DeckDefs />

      <header className="gin-top">
        {/* Back to bingbongblitz.com, where the other games are. */}
        <a className="gin-home" href="/" aria-label="All games at bingbongblitz.com" title="All games">
          <HubMark />
        </a>
        <div className="gin-top__title">
          <h1 className="gin-title">Napoletane Gin Rummy</h1>
          <p className="gin-sub">
            Knock at {NAPOLETANE_GIN.knockMaxDeadwood} · first to 100
          </p>
        </div>
        <nav className="gin-modes" aria-label="Game mode">
          <button
            type="button"
            className={`gin-mode${mode === 'solo' ? ' is-on' : ''}`}
            onClick={() => choose('solo')}
          >
            Solo
          </button>
          <button
            type="button"
            className={`gin-mode${mode === 'online' ? ' is-on' : ''}`}
            onClick={() => choose('online')}
          >
            Two players
          </button>
        </nav>
        <button
          type="button"
          className="gin-help"
          onClick={() => setRulesOpen(true)}
          aria-label="How to play"
          title="How to play"
        >
          ?
        </button>
      </header>

      {rulesOpen && <GinRules onClose={() => setRulesOpen(false)} />}

      {mode === 'solo' ? <GinSolo /> : <GinOnline />}
    </div>
  );
}
