import React, { useState } from 'react';
import { GameAction, BotDifficulty } from '../game/types';
import { loadStats } from '../game/stats';

interface Props {
  dispatch: React.Dispatch<GameAction>;
  onHome: () => void;
}

export function SetupScreen({ dispatch, onHome }: Props) {
  const [name, setName] = useState(() => localStorage.getItem('db-player-name') ?? '');
  const [numBots, setNumBots] = useState(3);
  const [difficulty, setDifficulty] = useState<BotDifficulty>('medium');
  const [targetScore, setTargetScore] = useState(75);

  const stats = loadStats(name);

  function start() {
    if (!name.trim()) return;
    localStorage.setItem('db-player-name', name.trim());
    dispatch({
      type: 'START_GAME',
      config: { humanName: name.trim(), numBots, botDifficulty: difficulty, targetScore },
    });
  }

  return (
    <div className="setup-screen">
      <div className="setup-title">Dutch Blitz</div>
      <div className="setup-subtitle">A fast-paced competitive card game</div>

      <div className="setup-card">
        <div>
          <div className="setup-label">Your Name</div>
          <input
            className="setup-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Enter your name"
            maxLength={16}
          />
          {stats.gamesPlayed > 0 && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
              ELO: {stats.elo} · {stats.gamesPlayed} games · {stats.wins} wins
            </div>
          )}
        </div>

        <div>
          <div className="setup-label">Number of Bots</div>
          <div className="setup-row">
            {[1, 2, 3].map(n => (
              <button key={n} className={`option-btn ${numBots === n ? 'selected' : ''}`} onClick={() => setNumBots(n)}>
                {n} Bot{n > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="setup-label">Bot Difficulty</div>
          <div className="setup-row">
            {(['easy', 'medium', 'hard', 'impossible'] as BotDifficulty[]).map(d => (
              <button key={d} className={`option-btn ${difficulty === d ? 'selected' : ''}`} onClick={() => setDifficulty(d)}>
                {d[0].toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="setup-label">Target Score</div>
          <div className="setup-row">
            {[50, 75, 100, 150].map(s => (
              <button key={s} className={`option-btn ${targetScore === s ? 'selected' : ''}`} onClick={() => setTargetScore(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button className="start-btn" onClick={start} disabled={!name.trim()}>
        Start Game
      </button>

      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>
        Play to {targetScore} points to win · {numBots + 1} players total
      </div>

      <button className="back-btn" onClick={onHome}>← Home</button>
    </div>
  );
}
