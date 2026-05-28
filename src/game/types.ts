export type CardColor = 'red' | 'blue' | 'green' | 'yellow';
export type BotDifficulty = 'easy' | 'medium' | 'hard' | 'impossible';

export interface Card {
  id: string;
  color: CardColor;
  number: number;
  ownerId: string;
}

export interface DutchPile {
  id: string;
  color: CardColor;
  topValue: number;
  slot: number;  // visual grid position (0–15)
}

export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
  faction?: CardColor;   // cosmetic identity chosen in lobby
  // index 0 = top (playable)
  blitzPile: Card[];
  postPiles: [Card[], Card[], Card[]];
  woodPile: Card[];      // face-down; last element = next to draw
  woodActive: Card[];    // face-up revealed; last element = playable
  woodDiscard: Card[];   // passed-over cards
  cardsPlayedToCenter: number;
  roundStartCards: number;
  totalScore: number;
}

export type CardSource =
  | { kind: 'blitz' }
  | { kind: 'post'; index: 0 | 1 | 2 }
  | { kind: 'wood' };

export type GameAction =
  | { type: 'PLAY_TO_CENTER'; playerId: string; source: CardSource; pileId: string | null; slotIndex?: number }
  | { type: 'PLAY_TO_POST'; playerId: string; source: CardSource; postIndex: 0 | 1 | 2 }
  | { type: 'DRAW_WOOD'; playerId: string }
  | { type: 'START_GAME'; config: GameConfig }
  | { type: 'NEXT_ROUND' }
  | { type: 'BACK_TO_SETUP' }
  | { type: 'PAUSE_BOTS' }
  | { type: 'RESUME_BOTS' };

export interface GameConfig {
  humanName: string;
  numBots: number;
  botDifficulty: BotDifficulty;
  targetScore: number;
}

export interface RoundResult {
  roundNumber: number;
  winnerId: string;
  duration: number;
  cardsPlayed: Record<string, number>;
  blitzRemaining: Record<string, number>;
  roundScores: Record<string, number>;
  eloChanges: Record<string, number>;
}

export interface GameState {
  phase: 'setup' | 'playing' | 'roundEnd' | 'gameEnd';
  players: PlayerState[];
  centerPiles: DutchPile[];
  roundNumber: number;
  roundStartTime: number;
  targetScore: number;
  lastRound?: RoundResult;
  gameWinnerId?: string;
}

// Persisted player stats
export interface PlayerStats {
  name: string;
  elo: number;
  gamesPlayed: number;
  wins: number;
  speedHistory: SpeedRecord[];
  bestSpeed: number | null;
  bestSpeedDate: string | null;
  avgSpeed: number | null;
}

export interface SpeedRecord {
  date: string;
  secondsPerPlay: number;
  roundScore: number;
}
