import { PlayerStats } from './types';

const STATS_KEY = 'dutch-blitz-stats';

const DEFAULT_STATS: PlayerStats = {
  name: '',
  elo: 1200,
  gamesPlayed: 0,
  wins: 0,
  speedHistory: [],
  bestSpeed: null,
  bestSpeedDate: null,
  avgSpeed: null,
};

export function loadStats(name: string): PlayerStats {
  try {
    const raw = localStorage.getItem(`${STATS_KEY}-${name}`);
    if (!raw) return { ...DEFAULT_STATS, name };
    return { ...DEFAULT_STATS, ...JSON.parse(raw), name };
  } catch {
    return { ...DEFAULT_STATS, name };
  }
}

export function saveStats(name: string, stats: PlayerStats): void {
  try {
    localStorage.setItem(`${STATS_KEY}-${name}`, JSON.stringify(stats));
  } catch { /* ignore */ }
}

export function recordRoundSpeed(
  name: string,
  secondsPerPlay: number,
  roundScore: number
): PlayerStats {
  const stats = loadStats(name);
  const record = {
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    secondsPerPlay,
    roundScore,
  };
  const history = [...stats.speedHistory, record];

  const allSpeeds = history.map(h => h.secondsPerPlay);
  const avgSpeed = allSpeeds.reduce((a, b) => a + b, 0) / allSpeeds.length;

  let bestSpeed = stats.bestSpeed;
  let bestSpeedDate = stats.bestSpeedDate;
  if (bestSpeed === null || secondsPerPlay < bestSpeed) {
    bestSpeed = secondsPerPlay;
    bestSpeedDate = record.date;
  }

  const updated: PlayerStats = { ...stats, speedHistory: history, avgSpeed, bestSpeed, bestSpeedDate };
  saveStats(name, updated);
  return updated;
}

export function calculateElo(
  playerElo: number,
  opponentElo: number,
  result: number, // 1 = win, 0.5 = draw, 0 = loss
  gamesPlayed: number
): number {
  const K = gamesPlayed < 30 ? 32 : 16;
  const expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  return Math.round(K * (result - expected));
}
