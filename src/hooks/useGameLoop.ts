import { useEffect, useRef } from 'react';
import { GameAction, GameState } from '../game/types';
import { getBotAction, getBotInterval } from '../game/bot';

export function useGameLoop(
  state: GameState,
  dispatch: React.Dispatch<GameAction>,
  paused: boolean
) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  useEffect(() => {
    if (state.phase !== 'playing' || paused) return;

    const bots = state.players.filter(p => p.isBot);
    const timers: ReturnType<typeof setTimeout>[] = [];

    function scheduleBotTick(botId: string, difficulty: NonNullable<GameState['players'][0]['botDifficulty']>) {
      const delay = getBotInterval(difficulty);
      const timer = setTimeout(() => {
        const current = stateRef.current;
        if (current.phase !== 'playing') return;

        const action = getBotAction(current, botId);
        if (action) dispatchRef.current(action);

        scheduleBotTick(botId, difficulty);
      }, delay);
      timers.push(timer);
    }

    for (const bot of bots) {
      if (bot.botDifficulty) {
        scheduleBotTick(bot.id, bot.botDifficulty);
      }
    }

    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.roundNumber, paused]);
}
