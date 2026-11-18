import { useCallback, useEffect, useRef, useState } from 'react';

import type { Player } from '../gin/arena';
import type { Card } from '../gin/cards';
import { type GinAction, type GinState, type Seat, apply, canApply, deal, legalActions, viewFor } from '../gin/game';
import { LEVELS, type Level, makeOpponent } from '../gin/opponents';
import GinBoard from './GinBoard';
import GinShowdown from './GinShowdown';
import { BURST_MS } from './GinBurst';
import { newMatchId, postHand, recordHand } from './handLog';

/**
 * The beat between the bot's cards landing and it moving again.
 *
 * Counted from the moment the last card lands rather than from the state
 * change, so draw and discard never run into each other.
 */
const BOT_PAUSE_MS = 420;

/** How long a push sits on screen before the next hand is dealt. */
const PUSH_HOLD_MS = BURST_MS + 400;

/** A match is first to this many points. */
const TARGET = 100;

const LEVEL_KEY = 'gin.solo.level';

function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 30);
}

function savedLevel(): Level {
  try {
    const v = localStorage.getItem(LEVEL_KEY);
    if (v === 'easy' || v === 'medium' || v === 'hard') return v;
  } catch {
    /* no storage */
  }
  return 'hard';
}

interface Match {
  id: string;
  you: number;
  bot: number;
  /** Hands dealt so far in this match, pushes included. */
  hands: number;
}

interface Hand {
  state: GinState;
  /** Which seat the person sits in. The opening seat is always 0, and the
   * opening alternates every deal, so the person alternates seats. */
  you: Seat;
  bot: Player;
  /** Match score when this hand was dealt, for the record. */
  before: { you: number; bot: number };
  level: Level;
}

function dealHand(level: Level, match: Match): Hand {
  const seed = newSeed();
  const state = deal(seed);
  const you: Seat = match.hands % 2 === 0 ? 0 : 1;
  const botSeat: Seat = you === 0 ? 1 : 0;
  const scores: [number, number] = botSeat === 0 ? [match.bot, match.you] : [match.you, match.bot];
  const bot = makeOpponent(level, seed, () => ({ scores, target: TARGET }));
  bot.begin?.(botSeat, state.hands[botSeat], state.discard[state.discard.length - 1], state.stock.length);
  return { state, you, bot, before: { you: match.you, bot: match.bot }, level };
}

/**
 * Solo play against the computer, in matches to 100.
 *
 * The person and the computer alternate who opens each deal, which in the
 * engine means alternating seats: seat 0 always moves first. Everything the
 * screen renders comes from `viewFor(state, you)`, and the computer is handed
 * exactly the same kind of view for its own seat -- it plays through the same
 * keyhole the person does, even though it lives in the same tab.
 *
 * Each finished hand is logged (see handLog.ts) so real games can be studied.
 */
export default function GinSolo() {
  const [level, setLevel] = useState<Level>(savedLevel);
  const [match, setMatch] = useState<Match>(() => ({ id: newMatchId(), you: 0, bot: 0, hands: 1 }));
  const [hand, setHand] = useState<Hand>(() => dealHand(savedLevel(), { id: '', you: 0, bot: 0, hands: 0 }));
  const { state, you } = hand;
  const botSeat: Seat = you === 0 ? 1 : 0;

  const view = viewFor(state, you);
  const over = view.phase === 'over';

  // Move times, for the log: ms from the deal to each history entry.
  const dealtAt = useRef(performance.now());
  const times = useRef<number[]>([]);
  const fouls = useRef(0);
  useEffect(() => {
    dealtAt.current = performance.now();
    times.current = [];
    fouls.current = 0;
  }, [hand.bot]);
  useEffect(() => {
    while (times.current.length < state.history.length) {
      times.current.push(Math.round(performance.now() - dealtAt.current));
    }
  }, [state.history.length]);

  const setState = useCallback(
    (fn: (s: GinState) => GinState) => setHand((h) => {
      const next = fn(h.state);
      return next === h.state ? h : { ...h, state: next };
    }),
    []
  );

  // --- The computer's turn, one action at a time.
  //
  // The action is chosen ONCE, outside any state updater: the stronger
  // opponents keep notes on the hand (what they believe you hold), and React
  // is free to run an updater twice. Asking twice would have them count the
  // same move twice.
  const [inFlight, setInFlight] = useState(false);
  const handRef = useRef(hand);
  handRef.current = hand;
  useEffect(() => {
    if (state.phase === 'over' || state.turn !== botSeat || inFlight) return;
    const timer = setTimeout(() => {
      const h = handRef.current;
      if (h.state !== state) return;
      let action: GinAction = h.bot.act(viewFor(state, botSeat), state.history);
      if (canApply(state, botSeat, action) !== null) {
        fouls.current++;
        action = legalActions(state, botSeat)[0];
      }
      setHand((cur) => (cur.state === state ? { ...cur, state: apply(state, botSeat, action) } : cur));
    }, BOT_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [state, botSeat, inFlight]);

  // --- Scoring and logging, once per finished hand.
  const settled = useRef<GinState | null>(null);
  const [matchOver, setMatchOver] = useState<null | 'you' | 'bot'>(null);
  useEffect(() => {
    if (state.phase !== 'over' || settled.current === state) return;
    settled.current = state;
    const record = recordHand(state, {
      matchId: match.id,
      hand: match.hands,
      level: hand.level,
      humanSeat: you,
      target: TARGET,
      before: hand.before,
      times: times.current.slice(0, state.history.length),
      fouls: fouls.current,
    });
    void postHand(record);
    const you2 = match.you + Math.max(0, record.margin);
    const bot2 = match.bot + Math.max(0, -record.margin);
    setMatch((m) => ({ ...m, you: you2, bot: bot2 }));
    if (you2 >= TARGET || bot2 >= TARGET) setMatchOver(you2 >= TARGET ? 'you' : 'bot');
  }, [state, match, hand, you]);

  const nextHand = useCallback(() => {
    const m = { ...match, hands: match.hands + 1 };
    setMatch(m);
    setHand(dealHand(level, { ...m, hands: m.hands - 1 }));
  }, [match, level]);

  const newMatch = useCallback(
    (lvl: Level = level) => {
      const m: Match = { id: newMatchId(), you: 0, bot: 0, hands: 1 };
      setMatch(m);
      setMatchOver(null);
      setHand(dealHand(lvl, { ...m, hands: 0 }));
    },
    [level]
  );

  // --- A push: no score, no panel, and the next hand on its own.
  const pushed = state.phase === 'over' && state.score?.outcome === 'dead-hand';
  useEffect(() => {
    if (!pushed || matchOver) return;
    const timer = setTimeout(nextHand, PUSH_HOLD_MS);
    return () => clearTimeout(timer);
  }, [pushed, matchOver, nextHand]);

  /**
   * Apply one of the person's moves, unless the board it was aimed at has gone.
   * `apply` throws on an illegal action, and a click can race the state it was
   * drawn from; the move the person meant no longer exists, so it is dropped.
   */
  const act = useCallback(
    (action: GinAction) =>
      setState((current) =>
        current.phase === 'over' || current.turn !== you || canApply(current, you, action) !== null
          ? current
          : apply(current, you, action)
      ),
    [setState, you]
  );

  const changeLevel = (lvl: Level) => {
    setLevel(lvl);
    try {
      localStorage.setItem(LEVEL_KEY, lvl);
    } catch {
      /* no storage */
    }
    // A match is against one opponent; changing it starts a fresh one.
    newMatch(lvl);
  };

  const label = LEVELS.find((l) => l.level === level)!.label;
  const opponentName = level === 'hard' ? 'Champion' : `${label} bot`;
  const tally = `You ${match.you} · ${opponentName} ${match.bot}`;

  return (
    <>
      <div className="gin-tablebar">
        <span className="gin-tablescore">
          You <strong>{match.you}</strong>
          {' · '}
          {opponentName} <strong>{match.bot}</strong>
          <span className="gin-tablescore__to"> to {TARGET}</span>
        </span>
        <label className="gin-level">
          Opponent
          <select value={level} onChange={(e) => changeLevel(e.target.value as Level)}>
            {LEVELS.map((l) => (
              <option key={l.level} value={l.level} title={l.blurb}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <GinBoard
        view={view}
        opponentLabel={opponentName}
        opponentNote={view.turn === botSeat && !over ? 'thinking…' : null}
        onDrawStock={() => act({ type: 'draw', from: 'stock' })}
        onTakeDiscard={() => act({ type: 'draw', from: 'discard' })}
        onDiscard={(card: Card) => act({ type: 'discard', card })}
        onKnock={(card: Card) => act({ type: 'knock', discard: card })}
        onBigGin={() => act({ type: 'big-gin' })}
        onBusyChange={setInFlight}
      />

      {over && view.score && (!pushed || matchOver) && !inFlight && (
        <GinShowdown
          view={view}
          opponentLabel={`The ${opponentName.toLowerCase()}`}
          onNext={matchOver ? () => newMatch() : nextHand}
          nextLabel={matchOver ? 'New match' : undefined}
          note={
            matchOver
              ? `${matchOver === 'you' ? 'You win the match' : `${opponentName} wins the match`}, ${tally}`
              : `Hand ${match.hands} · ${tally}`
          }
        />
      )}
    </>
  );
}
