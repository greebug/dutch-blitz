import { GameAction, GameState, PlayerState, BotDifficulty } from './types';
import { canPlayOnDutchPile, canPlayOnPostPile, canStartNewDutchPile } from './rules';

function getTopCard(pile: PlayerState['blitzPile']) {
  return pile.length > 0 ? pile[0] : null;
}

export function getBotAction(state: GameState, botId: string): GameAction | null {
  const bot = state.players.find(p => p.id === botId);
  if (!bot || state.phase !== 'playing') return null;

  const blitzTop = getTopCard(bot.blitzPile);
  const woodTop = bot.woodActive.length > 0 ? bot.woodActive[bot.woodActive.length - 1] : null;
  const postTops = bot.postPiles.map(p => getTopCard(p));

  // Priority 1: play blitz top to center
  if (blitzTop) {
    const pile = state.centerPiles.find(p => canPlayOnDutchPile(blitzTop, p));
    if (pile) return { type: 'PLAY_TO_CENTER', playerId: botId, source: { kind: 'blitz' }, pileId: pile.id };
    if (canStartNewDutchPile(blitzTop)) {
      return { type: 'PLAY_TO_CENTER', playerId: botId, source: { kind: 'blitz' }, pileId: null };
    }
  }

  // Priority 2: play post tops to center
  for (let i = 0; i < 3; i++) {
    const card = postTops[i];
    if (!card) continue;
    const pile = state.centerPiles.find(p => canPlayOnDutchPile(card, p));
    if (pile) return { type: 'PLAY_TO_CENTER', playerId: botId, source: { kind: 'post', index: i as 0|1|2 }, pileId: pile.id };
    if (canStartNewDutchPile(card)) {
      return { type: 'PLAY_TO_CENTER', playerId: botId, source: { kind: 'post', index: i as 0|1|2 }, pileId: null };
    }
  }

  // Priority 3: play wood active top to center
  if (woodTop) {
    const pile = state.centerPiles.find(p => canPlayOnDutchPile(woodTop, p));
    if (pile) return { type: 'PLAY_TO_CENTER', playerId: botId, source: { kind: 'wood' }, pileId: pile.id };
    if (canStartNewDutchPile(woodTop)) {
      return { type: 'PLAY_TO_CENTER', playerId: botId, source: { kind: 'wood' }, pileId: null };
    }
  }

  // Priority 4: move blitz top to a post pile to uncover next blitz card
  if (blitzTop) {
    for (let i = 0; i < 3; i++) {
      if (canPlayOnPostPile(blitzTop, postTops[i])) {
        return { type: 'PLAY_TO_POST', playerId: botId, source: { kind: 'blitz' }, postIndex: i as 0|1|2 };
      }
    }
  }

  // Priority 5: play wood top to post pile
  if (woodTop) {
    for (let i = 0; i < 3; i++) {
      if (canPlayOnPostPile(woodTop, postTops[i])) {
        return { type: 'PLAY_TO_POST', playerId: botId, source: { kind: 'wood' }, postIndex: i as 0|1|2 };
      }
    }
  }

  // Priority 6: rearrange post piles
  for (let from = 0; from < 3; from++) {
    const card = postTops[from];
    if (!card) continue;
    for (let to = 0; to < 3; to++) {
      if (from === to) continue;
      if (canPlayOnPostPile(card, postTops[to])) {
        return { type: 'PLAY_TO_POST', playerId: botId, source: { kind: 'post', index: from as 0|1|2 }, postIndex: to as 0|1|2 };
      }
    }
  }

  // Priority 7: draw from wood pile
  if (bot.woodPile.length > 0 || bot.woodDiscard.length > 0 || bot.woodActive.length > 0) {
    return { type: 'DRAW_WOOD', playerId: botId };
  }

  return null;
}

export function getBotInterval(difficulty: BotDifficulty): number {
  switch (difficulty) {
    case 'easy':       return 9000 + Math.random() * 5000;  // 9–14s  (slow learner)
    case 'medium':     return 4500 + Math.random() * 3000;  // 4.5–7.5s (casual)
    case 'hard':       return 1500 + Math.random() * 1000;  // 1.5–2.5s (competitive)
    case 'impossible': return 600  + Math.random() * 400;   // 600ms–1s (very fast)
  }
}
