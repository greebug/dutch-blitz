import React, { useEffect, useState } from 'react';
import { GameState, GameAction } from '../game/types';
import { loadStats, recordRoundSpeed } from '../game/stats';

interface Props {
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
  myPlayerId?: string;
}

export function GameOverScreen({ state, dispatch, myPlayerId }: Props) {
  const { lastRound, players, phase, gameWinnerId } = state;
  // In multiplayer myPlayerId identifies "me"; solo falls back to first non-bot
  const human = (myPlayerId ? players.find(p => p.id === myPlayerId) : players.find(p => !p.isBot)) ?? players[0];
  const [humanStats, setHumanStats] = useState(() => loadStats(human.name));

  useEffect(() => {
    if (!lastRound) return;
    const played = lastRound.cardsPlayed[human.id] ?? 0;
    const duration = lastRound.duration;
    const secondsPerPlay = played > 0 ? parseFloat((duration / played).toFixed(1)) : 0;
    const updated = recordRoundSpeed(human.name, secondsPerPlay, lastRound.roundScores[human.id] ?? 0);
    setHumanStats(updated);
  }, [lastRound?.roundNumber]);

  if (!lastRound) return null;

  const isGameOver = phase === 'gameEnd';
  const winnerPlayer = players.find(p => p.id === lastRound.winnerId);

  // Sort players by total score desc
  const ranked = [...players].sort((a, b) => b.totalScore - a.totalScore);

  const humanPlayed = lastRound.cardsPlayed[human.id] ?? 0;
  const secondsPerPlay = humanPlayed > 0
    ? parseFloat((lastRound.duration / humanPlayed).toFixed(1))
    : 0;

  const prevSpeed = humanStats.speedHistory.length > 1
    ? humanStats.speedHistory[humanStats.speedHistory.length - 2]?.secondsPerPlay ?? null
    : null;

  const delta = prevSpeed !== null ? parseFloat((secondsPerPlay - prevSpeed).toFixed(1)) : null;
  const deltaImproved = delta !== null && delta < 0;

  const eloChange = lastRound.eloChanges[human.id];
  const newElo = humanStats.elo;

  return (
    <div className="gameover-screen">
      <div className="gameover-headline">
        {isGameOver
          ? gameWinnerId === human.id ? '🏆 You Win!' : `${winnerPlayer?.name ?? 'Bot'} Wins!`
          : 'Nice play!'}
      </div>
      <div className="gameover-round">
        {isGameOver ? 'Game Over' : `Round ${lastRound.roundNumber} complete!`}
      </div>

      {/* Leaderboard */}
      <table className="score-table">
        <thead>
          <tr>
            <th>#</th>
            <th style={{ textAlign: 'left' }}></th>
            <th>This Round</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((p, i) => {
            const isWinner = p.id === lastRound.winnerId;
            const roundScore = lastRound.roundScores[p.id] ?? 0;
            return (
              <tr key={p.id} className={`score-row ${p.id === human?.id ? 'winner-row' : ''}`}>
                <td className="rank-cell">{i + 1}</td>
                <td className="name-cell">
                  {isWinner && <span style={{ marginRight: 4 }}>⚡</span>}
                  {p.name}
                </td>
                <td className="round-score-cell">
                  <span style={{ color: roundScore >= 0 ? 'inherit' : '#ef9a9a' }}>{roundScore}</span>
                </td>
                <td><span className="total-cell">{p.totalScore}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <button
        className="play-again-btn"
        onClick={() => dispatch({ type: isGameOver ? 'BACK_TO_SETUP' : 'NEXT_ROUND' })}
      >
        {isGameOver ? 'New Game' : 'Next Round'}
      </button>

      {/* Your Statistics */}
      <div className="stats-section">
        <div className="stats-title">Your Statistic:</div>

        <div className="stat-row">
          <span className="stat-icon">⏱</span>
          <span className="stat-label">Speed:</span>
          <div className="stat-value-group">
            <span className="stat-value">{humanPlayed > 0 ? secondsPerPlay : '—'}</span>
            <span className="stat-unit">seconds/play</span>
            {delta !== null && (
              <span className={`stat-delta ${deltaImproved ? '' : 'worse'}`}>
                {deltaImproved ? '↑' : '↓'} {Math.abs(delta)} sec.
              </span>
            )}
          </div>
        </div>

        <div className="stat-row">
          <span className="stat-icon">⏱</span>
          <span className="stat-label">Avg Speed:</span>
          <div className="stat-value-group">
            <span className="stat-value">
              {humanStats.avgSpeed !== null ? humanStats.avgSpeed.toFixed(1) : '—'}
            </span>
            <span className="stat-unit">seconds/play</span>
          </div>
        </div>

        {humanStats.bestSpeed !== null && (
          <div className="stat-row">
            <span className="stat-icon stat-star">★</span>
            <span className="stat-label">Best:</span>
            <div className="stat-value-group">
              <span className="stat-value">{humanStats.bestSpeed}</span>
              <span className="stat-unit">
                ({humanStats.bestSpeedDate}) seconds/play
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ELO */}
      {eloChange !== undefined && isGameOver && (
        <div className="elo-section">
          <div>
            <div className="elo-label">ELO Rating</div>
            <div className="elo-value">{newElo}</div>
          </div>
          <div
            className={`elo-change ${eloChange >= 0 ? 'pos' : 'neg'}`}
          >
            {eloChange >= 0 ? '+' : ''}{eloChange}
          </div>
        </div>
      )}

      <button className="back-btn" onClick={() => dispatch({ type: 'BACK_TO_SETUP' })}>
        Back to Setup
      </button>
    </div>
  );
}
