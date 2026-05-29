import { Card, GameAction, GameConfig, GameState, PlayerState, RoundResult } from './types';
import { dealPlayer } from './deck';
import { canPlayOnDutchPile, canPlayOnPostPile, canStartNewDutchPile } from './rules';
import { calculateElo, loadStats, saveStats } from './stats';

let pileCounter = 0;
function newPileId() { return `pile-${++pileCounter}`; }

function getTopCard(pile: PlayerState['blitzPile']) {
  return pile.length > 0 ? pile[0] : null;
}

function removeTopCard(pile: PlayerState['blitzPile']): PlayerState['blitzPile'] {
  return pile.slice(1);
}

function updatePlayer(state: GameState, playerId: string, update: Partial<PlayerState>): GameState {
  return {
    ...state,
    players: state.players.map(p => p.id === playerId ? { ...p, ...update } : p),
  };
}

function checkRoundEnd(state: GameState): GameState {
  const winner = state.players.find(p => p.blitzPile.length === 0);
  if (!winner) return state;

  const duration = (Date.now() - state.roundStartTime) / 1000;
  const roundScores: Record<string, number> = {};
  const cardsPlayed: Record<string, number> = {};
  const blitzRemaining: Record<string, number> = {};

  for (const p of state.players) {
    const played = p.cardsPlayedToCenter;
    const remaining = p.blitzPile.length;
    roundScores[p.id] = played - remaining * 2;
    cardsPlayed[p.id] = played;
    blitzRemaining[p.id] = remaining;
  }

  const updatedPlayers = state.players.map(p => ({
    ...p,
    totalScore: p.totalScore + roundScores[p.id],
  }));

  const gameWinner = updatedPlayers.find(p => p.totalScore >= state.targetScore);

  // Update ELO
  const humanPlayer = updatedPlayers.find(p => !p.isBot);
  let eloChanges: Record<string, number> = {};
  if (humanPlayer) {
    const stats = loadStats(humanPlayer.name);
    const opponentElos = updatedPlayers
      .filter(p => p.id !== humanPlayer.id)
      .map(p => {
        if (p.isBot) {
          const diffElo: Record<string, number> = { easy: 800, medium: 1200, hard: 1600, impossible: 2200 };
          return diffElo[p.botDifficulty ?? 'medium'];
        }
        return loadStats(p.name).elo;
      });

    const humanScore = updatedPlayers.find(p => p.id === humanPlayer.id)!.totalScore;
    const humanWon = gameWinner?.id === humanPlayer.id;
    const allScores = updatedPlayers.map(p => p.totalScore);
    const rank = allScores.filter(s => s > humanScore).length; // 0-indexed rank (0 = 1st)
    const result = rank === 0 ? 1 : rank < updatedPlayers.length - 1 ? 0.5 : 0;

    const avgOpponentElo = opponentElos.reduce((a, b) => a + b, 0) / opponentElos.length;
    const change = calculateElo(stats.elo, avgOpponentElo, result, stats.gamesPlayed);
    eloChanges[humanPlayer.id] = change;

    if (gameWinner) {
      const newStats = {
        ...stats,
        elo: stats.elo + change,
        gamesPlayed: stats.gamesPlayed + 1,
        wins: stats.wins + (humanWon ? 1 : 0),
      };
      saveStats(humanPlayer.name, newStats);
    }
  }

  const lastRound: RoundResult = {
    roundNumber: state.roundNumber,
    winnerId: winner.id,
    duration,
    cardsPlayed,
    blitzRemaining,
    roundScores,
    eloChanges,
  };

  return {
    ...state,
    players: updatedPlayers,
    phase: gameWinner ? 'gameEnd' : 'roundEnd',
    lastRound,
    gameWinnerId: gameWinner?.id,
  };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'START_GAME': return handleStartGame(action.config);
    case 'PLAY_TO_CENTER': return handlePlayToCenter(state, action);
    case 'PLAY_TO_POST': return handlePlayToPost(state, action);
    case 'DRAW_WOOD': return handleDrawWood(state, action);
    case 'NEXT_ROUND': return handleNextRound(state);
    case 'BACK_TO_SETUP': return { ...state, phase: 'setup' };
    default: return state;
  }
}

function handleStartGame(config: GameConfig): GameState {
  const { humanName, numBots, botDifficulty, targetScore } = config;
  const humanStats = loadStats(humanName);

  const players: PlayerState[] = [
    dealPlayer('human', humanName, false, undefined, 0),
  ];
  const botNames = ['Player 1', 'Player 2', 'Player 3'];
  for (let i = 0; i < numBots; i++) {
    players.push(dealPlayer(`bot-${i}`, botNames[i], true, botDifficulty, 0));
  }

  return {
    phase: 'playing',
    players,
    centerPiles: [],
    roundNumber: 1,
    roundStartTime: Date.now(),
    targetScore,
    lastRound: undefined,
    gameWinnerId: undefined,
  };
}

function handlePlayToCenter(state: GameState, action: Extract<GameAction, { type: 'PLAY_TO_CENTER' }>): GameState {
  if (state.phase !== 'playing') return state;
  const { playerId, source, pileId, slotIndex } = action;
  const player = state.players.find(p => p.id === playerId);
  if (!player) return state;

  let card;
  if (source.kind === 'blitz') {
    card = getTopCard(player.blitzPile);
  } else if (source.kind === 'post') {
    card = getTopCard(player.postPiles[source.index]);
  } else {
    card = player.woodActive.length > 0 ? player.woodActive[player.woodActive.length - 1] : null;
  }
  if (!card) return state;

  // Find or create pile
  let newPiles = [...state.centerPiles];
  let targetPile = pileId ? newPiles.find(p => p.id === pileId) : undefined;

  if (targetPile) {
    if (!canPlayOnDutchPile(card, targetPile)) return state;
    const newTopValue = targetPile.topValue + 1;
    newPiles = newPiles.map(p => {
      if (p.id !== pileId) return p;
      const updated = { ...p, topValue: newTopValue };
      if (newTopValue === 10) {
        // Record who completed this pile (card owner's faction)
        const placer = state.players.find(pl => pl.id === card.ownerId);
        if (placer?.faction) updated.completedByFaction = placer.faction;
      }
      return updated;
    });
  } else {
    // Starting a new pile
    if (!canStartNewDutchPile(card)) return state;
    // Determine which grid slot to place the pile in.
    // Human players pass slotIndex (nearest slot to drop point); bots fill sequentially.
    let slot: number;
    if (slotIndex !== undefined) {
      slot = slotIndex;
    } else {
      const occupiedSlots = new Set(newPiles.map(p => p.slot));
      slot = 0;
      while (occupiedSlots.has(slot)) slot++;
    }
    const newPile = { id: newPileId(), color: card.color, topValue: 1, slot };
    newPiles = [...newPiles, newPile];
  }

  // Remove card from source
  let updatedPlayer = { ...player, cardsPlayedToCenter: player.cardsPlayedToCenter + 1 };
  if (source.kind === 'blitz') {
    updatedPlayer.blitzPile = removeTopCard(player.blitzPile);
  } else if (source.kind === 'post') {
    const newPost = [...player.postPiles] as [Card[], Card[], Card[]];
    newPost[source.index] = removeTopCard(player.postPiles[source.index]);
    updatedPlayer.postPiles = newPost;
  } else {
    updatedPlayer.woodActive = player.woodActive.slice(0, -1);
  }

  let newState = {
    ...state,
    centerPiles: newPiles,
    players: state.players.map(p => p.id === playerId ? updatedPlayer : p),
  };

  return checkRoundEnd(newState);
}

function handlePlayToPost(state: GameState, action: Extract<GameAction, { type: 'PLAY_TO_POST' }>): GameState {
  if (state.phase !== 'playing') return state;
  const { playerId, source, postIndex } = action;
  const player = state.players.find(p => p.id === playerId);
  if (!player) return state;

  let card;
  if (source.kind === 'blitz') {
    card = getTopCard(player.blitzPile);
  } else if (source.kind === 'post') {
    if (source.index === postIndex) return state;
    card = getTopCard(player.postPiles[source.index]);
  } else {
    card = player.woodActive.length > 0 ? player.woodActive[player.woodActive.length - 1] : null;
  }
  if (!card) return state;

  const targetTop = getTopCard(player.postPiles[postIndex]);
  if (!canPlayOnPostPile(card, targetTop)) return state;

  let updatedPlayer = { ...player };
  if (source.kind === 'blitz') {
    updatedPlayer.blitzPile = removeTopCard(player.blitzPile);
  } else if (source.kind === 'post') {
    const newPost = [...player.postPiles] as [Card[], Card[], Card[]];
    newPost[source.index] = removeTopCard(player.postPiles[source.index]);
    updatedPlayer.postPiles = newPost;
  } else {
    updatedPlayer.woodActive = player.woodActive.slice(0, -1);
  }

  const newPost = [...updatedPlayer.postPiles] as [Card[], Card[], Card[]];
  newPost[postIndex] = [card, ...newPost[postIndex]];
  updatedPlayer.postPiles = newPost;

  // checkRoundEnd is needed here: a blitz card moved to a post pile can
  // empty the blitz pile, which should end the round immediately.
  return checkRoundEnd(updatePlayer(state, playerId, updatedPlayer));
}

function handleDrawWood(state: GameState, action: Extract<GameAction, { type: 'DRAW_WOOD' }>): GameState {
  if (state.phase !== 'playing') return state;
  const player = state.players.find(p => p.id === action.playerId);
  if (!player) return state;

  // Current active cards slide into discard first
  let woodPile = [...player.woodPile];
  let woodDiscard = [...player.woodDiscard, ...player.woodActive];

  if (woodPile.length === 0 && woodDiscard.length === 0) return state;

  const drawn: Card[] = [];

  // Phase 1: take up to 3 from current deck (top = last element)
  const fromCurrent = Math.min(3, woodPile.length);
  if (fromCurrent > 0) {
    drawn.push(...woodPile.slice(-fromCurrent));
    woodPile = woodPile.slice(0, -fromCurrent);
  }

  // Phase 2: if still need more and discard exists, flip discard into new deck
  // and take the remainder — this lets a draw span the deck/discard boundary.
  if (drawn.length < 3 && woodDiscard.length > 0) {
    woodPile = [...woodDiscard].reverse();
    woodDiscard = [];
    const stillNeeded = 3 - drawn.length;
    const fromNew = Math.min(stillNeeded, woodPile.length);
    if (fromNew > 0) {
      drawn.push(...woodPile.slice(-fromNew));
      woodPile = woodPile.slice(0, -fromNew);
    }
  }

  return updatePlayer(state, action.playerId, {
    woodPile,
    woodActive: drawn,
    woodDiscard,
  });
}

function handleNextRound(state: GameState): GameState {
  const newPlayers = state.players.map(p =>
    dealPlayer(p.id, p.name, p.isBot, p.botDifficulty, p.totalScore, p.faction)
  );
  return {
    ...state,
    phase: 'playing',
    players: newPlayers,
    centerPiles: [],
    roundNumber: state.roundNumber + 1,
    roundStartTime: Date.now(),
  };
}

export function initialState(): GameState {
  return {
    phase: 'setup',
    players: [],
    centerPiles: [],
    roundNumber: 1,
    roundStartTime: 0,
    targetScore: 75,
  };
}
