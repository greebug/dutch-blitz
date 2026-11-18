import { useState } from 'react';

import { NAPOLETANE_GIN } from '../gin/rules';
import DeckDefs from './deck/DeckDefs';
import GinOnline from './GinOnline';
import GinSolo from './GinSolo';

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
        <div>
          <h1 className="gin-title">Gin Rummy</h1>
          <p className="gin-sub">
            Napoletane deck · knock at {NAPOLETANE_GIN.knockMaxDeadwood}
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
      </header>

      {mode === 'solo' ? <GinSolo /> : <GinOnline />}
    </div>
  );
}
