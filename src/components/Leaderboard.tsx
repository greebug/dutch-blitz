import React, { useEffect, useState } from 'react';

interface SpeedEntry   { player_name: string; secs_per_play: number; cards_played: number; }
interface AvgEntry     { player_name: string; avg_secs: number; total_cards: number; }
interface WinsEntry    { display_name: string; wins: number; games_played: number; }
interface EloEntry     { display_name: string; elo: number; games_played: number; wins: number; }

interface LeaderboardData {
  speed:    SpeedEntry[];
  avgSpeed: AvgEntry[];
  wins:     WinsEntry[];
  elo:      EloEntry[];
}

const MEDALS = ['🥇', '🥈', '🥉'];

function fmt(secs: number) {
  return secs.toFixed(1) + 's/card';
}

export function Leaderboard() {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [tab, setTab] = useState<'speed' | 'avgSpeed' | 'wins' | 'elo'>('speed');

  useEffect(() => {
    fetch('/blitz/api/leaderboard')
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  const containerStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 380,
    background: 'rgba(0,0,0,0.25)',
    borderRadius: 14,
    padding: '14px 16px',
    border: '1px solid rgba(255,255,255,0.08)',
  };

  const tabBarStyle: React.CSSProperties = {
    display: 'flex',
    gap: 4,
    marginBottom: 12,
  };

  function tabBtn(id: 'speed' | 'avgSpeed' | 'wins' | 'elo', label: string) {
    const active = tab === id;
    return (
      <button
        key={id}
        onClick={() => setTab(id)}
        style={{
          flex: 1,
          padding: '6px 4px',
          fontSize: 11,
          fontWeight: active ? 800 : 500,
          borderRadius: 8,
          border: 'none',
          cursor: 'pointer',
          background: active ? 'rgba(249,168,37,0.85)' : 'rgba(255,255,255,0.07)',
          color: active ? '#111' : 'rgba(255,255,255,0.55)',
          transition: 'all 0.15s',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </button>
    );
  }

  function rowStyle(i: number): React.CSSProperties {
    return {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '7px 0',
      borderBottom: i < 2 ? '1px solid rgba(255,255,255,0.06)' : 'none',
    };
  }

  const empty = (
    <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
      No records yet — play some games!
    </div>
  );

  return (
    <div style={containerStyle}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: 'rgba(255,255,255,0.45)', marginBottom: 10, textTransform: 'uppercase' }}>
        🏆 Leaderboard
      </div>

      <div style={tabBarStyle}>
        {tabBtn('speed',    'Best Round')}
        {tabBtn('avgSpeed', 'Avg Speed')}
        {tabBtn('wins',     'Most Wins')}
        {tabBtn('elo',      'ELO')}
      </div>

      {!data && (
        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
          Loading…
        </div>
      )}

      {data && tab === 'speed' && (
        data.speed.length === 0 ? empty :
        data.speed.map((e, i) => (
          <div key={i} style={rowStyle(i)}>
            <span style={{ fontSize: 18, width: 24 }}>{MEDALS[i]}</span>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.88)' }}>
              {e.player_name}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#ffd54f' }}>
              {fmt(Number(e.secs_per_play))}
            </span>
          </div>
        ))
      )}

      {data && tab === 'avgSpeed' && (
        data.avgSpeed.length === 0 ? empty :
        data.avgSpeed.map((e, i) => (
          <div key={i} style={rowStyle(i)}>
            <span style={{ fontSize: 18, width: 24 }}>{MEDALS[i]}</span>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.88)' }}>
              {e.player_name}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#ffd54f' }}>
              {fmt(Number(e.avg_secs))}
            </span>
          </div>
        ))
      )}

      {data && tab === 'wins' && (
        data.wins.length === 0 ? empty :
        data.wins.map((e, i) => (
          <div key={i} style={rowStyle(i)}>
            <span style={{ fontSize: 18, width: 24 }}>{MEDALS[i]}</span>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.88)' }}>
              {e.display_name}
            </span>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
              {e.wins}W / {e.games_played}G
            </span>
          </div>
        ))
      )}

      {tab === 'speed' && data && data.speed.length > 0 && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 8 }}>
          Fastest single round · lower is faster
        </div>
      )}
      {tab === 'avgSpeed' && data && data.avgSpeed.length > 0 && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 8 }}>
          Average over a full game (75+ pt target) · lower is faster
        </div>
      )}
      {data && tab === 'elo' && (
        !data.elo || data.elo.length === 0 ? empty :
        data.elo.map((e, i) => (
          <div key={i} style={rowStyle(i)}>
            <span style={{ fontSize: 18, width: 24 }}>{MEDALS[i] ?? `${i + 1}.`}</span>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.88)' }}>
              {e.display_name}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#ffd54f' }}>
              {e.elo}
            </span>
          </div>
        ))
      )}

      {tab === 'wins' && data && data.wins.length > 0 && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 8 }}>
          Tracked by PIN account · guest wins not counted
        </div>
      )}
      {tab === 'elo' && data && data.elo && data.elo.length > 0 && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 8 }}>
          ELO rating · PIN accounts with ≥3 games
        </div>
      )}
    </div>
  );
}
