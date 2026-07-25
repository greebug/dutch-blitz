import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GameAction, GameState, CardSource, Card, PlayerState } from '../game/types';
import { canPlayOnDutchPile, canPlayOnPostPile, canStartNewDutchPile } from '../game/rules';
import { useGameLoop } from '../hooks/useGameLoop';
import { useSounds, startMusic, stopMusic } from '../hooks/useSounds';
import { OpponentDisplay } from './OpponentRow';
import { CenterPiles } from './CenterPiles';
import { PlayerArea } from './PlayerArea';
import { GameOverScreen } from './GameOverScreen';
import { PauseIcon, PlayIcon, PhoneRotateIcon } from './icons';
import { CardDisplay } from './DraggableCard';

interface DragState {
  card: Card;
  source: CardSource;
  x: number;
  y: number;
}

interface FlyCard {
  id: number;
  card: Card;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

interface Props {
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
  myPlayerId?: string;   // if set → multiplayer mode; bots run server-side
}

function getBotSlots(bots: PlayerState[]): {
  top: PlayerState | null;
  left: PlayerState | null;
  right: PlayerState | null;
} {
  if (bots.length === 0) return { top: null, left: null, right: null };
  if (bots.length === 1) return { top: bots[0], left: null, right: null };
  if (bots.length === 2) return { top: null, left: bots[0], right: bots[1] };
  return { top: bots[1], left: bots[0], right: bots[2] };
}

export function GameBoard({ state, dispatch, myPlayerId }: Props) {
  const [drag, setDrag] = useState<DragState | null>(null);
  // Optimistic-hide: card at this source is hidden immediately after dispatch while
  // awaiting server confirmation — eliminates the visible "snap back" on drops.
  const [pendingPlay, setPendingPlay] = useState<{ source: CardSource; cardId: string } | null>(null);
  const pendingPlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightPileId, setHighlightPileId] = useState<string | null>(null);
  const [highlightPostIndex, setHighlightPostIndex] = useState<number | null>(null);
  const [highlightDutchSlotIndex, setHighlightDutchSlotIndex] = useState<number | null>(null);
  const [showNewPile, setShowNewPile] = useState(false);
  const [dutchFlash, setDutchFlash] = useState(false);
  const [blitzPopup, setBlitzPopup] = useState<string | null>(null);
  const [showFullStats, setShowFullStats] = useState(false);
  const [paused, setPaused] = useState(false);
  const [flyCards, setFlyCards] = useState<FlyCard[]>([]);
  // Tracks whether we already fired DUTCH! optimistically so we don't double-play on server confirm
  const didOptimisticDutch = useRef(false);

  const { playCardSlap, playDraw, playDutch, playError } = useSounds();

  // Bots always run server-side — keep local loop disabled
  useGameLoop(state, dispatch, true);

  // ── Opponent fly animations (state-diff approach) ────────────────────────
  // Compare previous state to detect when any opponent (bot or human) just
  // played a card to center. The local player uses the drag visual instead.
  const prevStateRef = useRef<GameState>(state);
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;

    if (state.phase !== 'playing' || prev.phase !== 'playing') return;

    // Find which center pile just gained a card (new pile or topValue increase)
    const changedPile = state.centerPiles.find(pile => {
      const prevPile = prev.centerPiles.find(p => p.id === pile.id);
      return !prevPile || prevPile.topValue < pile.topValue;
    });
    if (!changedPile) return;

    // Find which opponent lost a visible card (they played it).
    // Skip the local player — their drag animation already handles the visual.
    for (const player of state.players) {
      if (player.id === myPlayerId) continue;
      const prevPlayer = prev.players.find(p => p.id === player.id);
      if (!prevPlayer) continue;

      const currVisible = player.blitzPile.length
        + player.postPiles.reduce((s, p) => s + p.length, 0)
        + player.woodActive.length;
      const prevVisible = prevPlayer.blitzPile.length
        + prevPlayer.postPiles.reduce((s, p) => s + p.length, 0)
        + prevPlayer.woodActive.length;

      if (currVisible < prevVisible) {
        const sourceEl = document.querySelector<HTMLElement>(`[data-opp-id="${player.id}"]`);
        const targetEl = document.querySelector<HTMLElement>(`[data-dutch-pile-id="${changedPile.id}"]`);
        if (sourceEl && targetEl) {
          const from = sourceEl.getBoundingClientRect();
          const to   = targetEl.getBoundingClientRect();
          const flyId = Date.now() + Math.random();
          const flyCard: FlyCard = {
            id: flyId,
            card: { id: 'fly', color: changedPile.color, number: changedPile.topValue, ownerId: player.id },
            fromX: from.left + from.width / 2,
            fromY: from.top  + from.height / 2,
            toX:   to.left   + to.width  / 2,
            toY:   to.top    + to.height / 2,
          };
          setFlyCards(prev => [...prev, flyCard]);
          setTimeout(() => setFlyCards(prev => prev.filter(f => f.id !== flyId)), 700);
        }
        break; // only one bot per action
      }
    }
  }, [state]);

  // Clear optimistic-hide once the server confirms the card left its source.
  // Reference state.players directly (human isn't declared yet at this hook position).
  useEffect(() => {
    if (!pendingPlay) return;
    const me = myPlayerId ? state.players.find(p => p.id === myPlayerId) : state.players.find(p => !p.isBot);
    if (!me) return;
    const { source, cardId } = pendingPlay;
    let currentTopId: string | null = null;
    if (source.kind === 'blitz')     currentTopId = me.blitzPile[0]?.id ?? null;
    else if (source.kind === 'post') currentTopId = me.postPiles[source.index][0]?.id ?? null;
    else /* wood */                  currentTopId = me.woodActive.length > 0 ? me.woodActive[me.woodActive.length - 1].id : null;
    if (currentTopId !== cardId) {
      setPendingPlay(null);
      if (pendingPlayTimer.current) { clearTimeout(pendingPlayTimer.current); pendingPlayTimer.current = null; }
    }
  }, [state, pendingPlay, myPlayerId]);

  // Stop music whenever this component unmounts (e.g. user leaves mid-game)
  useEffect(() => { return () => stopMusic(); }, []);

  useEffect(() => {
    if (state.phase === 'playing' && state.roundNumber === 1) startMusic();
    if (state.phase === 'gameEnd') stopMusic();
  }, [state.phase, state.roundNumber]);

  // Find "me" by myPlayerId; fall back to first non-bot for edge cases
  const human = (
    myPlayerId
      ? state.players.find(p => p.id === myPlayerId)
      : state.players.find(p => !p.isBot)
  ) ?? null;
  // Pause is only meaningful when playing solo (one human vs bots)
  const humanCount = state.players.filter(p => !p.isBot).length;
  const showPause = humanCount <= 1;
  // Show all opponents (bots in solo, bots + other humans in multiplayer)
  const opponents = human
    ? state.players.filter(p => p.id !== human.id)
    : state.players.filter(p => p.isBot);
  const { top: topBot, left: leftBot, right: rightBot } = getBotSlots(opponents);

  const prevPhase = useRef(state.phase);
  useEffect(() => {
    if ((state.phase === 'roundEnd' || state.phase === 'gameEnd') && prevPhase.current === 'playing') {
      // Only trigger sound/flash if we didn't already do it optimistically in handlePointerUp
      if (!didOptimisticDutch.current) {
        playDutch();
        setDutchFlash(true);
        setTimeout(() => setDutchFlash(false), 1200);
      }
      didOptimisticDutch.current = false;
      const blitzer = state.players.find(p => p.blitzPile.length === 0);
      if (blitzer) {
        setBlitzPopup(blitzer.name);
        setShowFullStats(false);
      }
    }
    if (state.phase === 'playing') {
      setBlitzPopup(null);
      setShowFullStats(false);
      setPaused(false);
      didOptimisticDutch.current = false;
    }
    prevPhase.current = state.phase;
  }, [state.phase]);

  // Re-evaluate drop highlights whenever center piles change (bot played a card while user is holding)
  const dragRef = useRef(drag);
  dragRef.current = drag;
  useEffect(() => {
    const d = dragRef.current;
    if (!d || !human) return;
    const { pileId, postIndex, dutchSlotIndex } = getDropTarget(d.x, d.y);
    const valid = isValidDrop(d.card, d.source, pileId, postIndex);
    if (pileId === 'new') {
      setHighlightPileId(null);
      setHighlightDutchSlotIndex(valid ? dutchSlotIndex : null);
    } else {
      setHighlightPileId(pileId && valid ? pileId : null);
      setHighlightDutchSlotIndex(null);
    }
    setHighlightPostIndex(postIndex !== null && valid ? postIndex : null);
  }, [state.centerPiles]);

  function getHumanCard(source: CardSource): Card | null {
    if (!human) return null;
    if (source.kind === 'blitz') return human.blitzPile[0] ?? null;
    if (source.kind === 'post') return human.postPiles[source.index][0] ?? null;
    if (source.kind === 'wood') {
      return human.woodActive.length > 0
        ? human.woodActive[human.woodActive.length - 1]
        : null;
    }
    return null;
  }

  function getDropTarget(x: number, y: number): { pileId: string | null; postIndex: number | null; dutchSlotIndex: number | null } {
    function checkAt(cx: number, cy: number) {
      const elements = document.elementsFromPoint(cx, cy);
      for (const el of elements) {
        const htmlEl = el as HTMLElement;
        const dutchPileId = htmlEl.dataset.dutchPileId;
        if (dutchPileId) {
          const slotStr = htmlEl.dataset.dutchSlotIndex;
          const dutchSlotIndex = slotStr !== undefined ? parseInt(slotStr) : null;
          return { pileId: dutchPileId, postIndex: null, dutchSlotIndex };
        }
        const postIdx = htmlEl.dataset.postPileIndex;
        if (postIdx !== undefined) return { pileId: null, postIndex: parseInt(postIdx), dutchSlotIndex: null };
      }
      return null;
    }

    // Try exact point first, then check a small radius around it
    const exact = checkAt(x, y);
    if (exact) return exact;

    const T = 22; // tolerance in px
    const probes: [number, number][] = [
      [x - T, y], [x + T, y], [x, y - T], [x, y + T],
      [x - T, y - T], [x + T, y - T], [x - T, y + T], [x + T, y + T],
    ];
    for (const [px, py] of probes) {
      const hit = checkAt(px, py);
      if (hit) return hit;
    }

    return { pileId: null, postIndex: null, dutchSlotIndex: null };
  }

  function isValidDrop(card: Card, source: CardSource, pileId: string | null, postIndex: number | null): boolean {
    if (pileId !== null) {
      if (pileId === 'new') return canStartNewDutchPile(card);
      const pile = state.centerPiles.find(p => p.id === pileId);
      return pile ? canPlayOnDutchPile(card, pile) : false;
    }
    if (postIndex !== null) {
      if (source.kind === 'post' && source.index === postIndex) return false;
      const topCard = human?.postPiles[postIndex][0] ?? null;
      return canPlayOnPostPile(card, topCard);
    }
    return false;
  }

  const handleDragStart = useCallback((e: React.PointerEvent, source: CardSource) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const card = getHumanCard(source);
    if (!card || !human) return;
    startMusic(); // gesture fallback for iOS joining players
    setDrag({ card, source, x: e.clientX, y: e.clientY });
    setShowNewPile(canStartNewDutchPile(card));
  }, [state, human]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    setDrag(d => d ? { ...d, x: e.clientX, y: e.clientY } : null);
    const { pileId, postIndex, dutchSlotIndex } = getDropTarget(e.clientX, e.clientY);
    const valid = isValidDrop(drag.card, drag.source, pileId, postIndex);
    if (pileId === 'new') {
      setHighlightPileId(null);
      setHighlightDutchSlotIndex(valid ? dutchSlotIndex : null);
    } else {
      setHighlightPileId(pileId && valid ? pileId : null);
      setHighlightDutchSlotIndex(null);
    }
    setHighlightPostIndex(postIndex !== null && valid ? postIndex : null);
  }, [drag, state]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!drag || !human) return;
    const { pileId, postIndex, dutchSlotIndex } = getDropTarget(e.clientX, e.clientY);
    const valid = isValidDrop(drag.card, drag.source, pileId, postIndex);

    if (valid) {
      if (pileId !== null) {
        dispatch({
          type: 'PLAY_TO_CENTER',
          playerId: human.id,
          source: drag.source,
          pileId: pileId === 'new' ? null : pileId,
          ...(pileId === 'new' && dutchSlotIndex !== null ? { slotIndex: dutchSlotIndex } : {}),
        });
        playCardSlap();
        // Optimistic DUTCH! — fire immediately instead of waiting for server round-trip.
        if (drag.source.kind === 'blitz' && human.blitzPile.length === 1) {
          didOptimisticDutch.current = true;
          playDutch();
          setDutchFlash(true);
          setTimeout(() => setDutchFlash(false), 1200);
        }
      } else if (postIndex !== null) {
        dispatch({ type: 'PLAY_TO_POST', playerId: human.id, source: drag.source, postIndex: postIndex as 0|1|2 });
        playCardSlap();
      }
      // Immediately hide the source card so there's no snap-back while awaiting server.
      // A safety timeout clears it if server is unexpectedly slow.
      if (pendingPlayTimer.current) clearTimeout(pendingPlayTimer.current);
      setPendingPlay({ source: drag.source, cardId: drag.card.id });
      pendingPlayTimer.current = setTimeout(() => setPendingPlay(null), 800);
    } else if (pileId !== null || postIndex !== null) {
      playError();
    }

    setDrag(null);
    setHighlightPileId(null);
    setHighlightPostIndex(null);
    setHighlightDutchSlotIndex(null);
    setShowNewPile(false);
  }, [drag, state, human]);

  function handleDrawWood() {
    if (!human) return;
    startMusic(); // gesture fallback for iOS joining players
    dispatch({ type: 'DRAW_WOOD', playerId: human.id });
    playDraw();
  }

  const roundEndActive = state.phase === 'roundEnd' || state.phase === 'gameEnd';

  return (
    <div
      className="game-board"
      onPointerMove={drag ? handlePointerMove : undefined}
      onPointerUp={drag ? handlePointerUp : undefined}
      onPointerCancel={() => { setDrag(null); setHighlightPileId(null); setHighlightPostIndex(null); setHighlightDutchSlotIndex(null); }}
    >
      {/* Top bar */}
      <div className="top-bar">
        <div className="top-bar-round">Round&nbsp;{state.roundNumber}</div>
        <div className="top-bar-scores">
          {state.players.map(p => (
            <div key={p.id} className="top-bar-score">
              {p.name.split(' ')[0]}: <span>{p.totalScore}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="top-bar-target">→{state.targetScore}</div>
          {state.phase === 'playing' && showPause && (
            <button className="pause-btn" onClick={() => {
              if (paused) {
                setPaused(false);
                dispatch({ type: 'RESUME_BOTS' });
              } else {
                setPaused(true);
                dispatch({ type: 'PAUSE_BOTS' });
              }
            }}>
              {paused ? <PlayIcon size={14} /> : <PauseIcon size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* Play area: left sidebar | center | right sidebar */}
      <div className="play-area">
        {leftBot ? (
          <div className="sidebar">
            <OpponentDisplay player={leftBot} variant="sidebar" />
          </div>
        ) : (
          <div className="sidebar-empty" />
        )}

        <div className="center-column">
          {topBot && <OpponentDisplay player={topBot} variant="top" />}
          <CenterPiles
            piles={state.centerPiles}
            highlightPileId={highlightPileId}
            showNewPileTarget={showNewPile}
            highlightDutchSlotIndex={highlightDutchSlotIndex}
          />
        </div>

        {rightBot ? (
          <div className="sidebar right">
            <OpponentDisplay player={rightBot} variant="sidebar" />
          </div>
        ) : (
          <div className="sidebar-empty" />
        )}
      </div>

      {/* Human player bottom strip */}
      {human && (
        <PlayerArea
          player={human}
          onDragStart={handleDragStart}
          onDrawWood={handleDrawWood}
          dragSource={drag?.source ?? null}
          highlightPostIndex={highlightPostIndex}
          pendingPlay={pendingPlay}
        />
      )}

      {/* Ghost card */}
      {drag && (
        <CardDisplay
          card={drag.card}
          size="ghost"
          className="ghost-card"
          style={{ left: drag.x, top: drag.y }}
        />
      )}

      {/* Bot fly animations */}
      {flyCards.map(fly => (
        <div
          key={fly.id}
          className={`fly-card card-${fly.card.color}`}
          style={{
            left: fly.fromX,
            top: fly.fromY,
            '--fly-dx': `${fly.toX - fly.fromX}px`,
            '--fly-dy': `${fly.toY - fly.fromY}px`,
          } as React.CSSProperties}
        >
          {fly.card.number}
        </div>
      ))}

      {dutchFlash && <div className="dutch-flash">DUTCH!</div>}

      {/* Pause overlay */}
      {paused && (
        <div className="pause-overlay">
          <div className="pause-dialog">
            <div className="pause-title">Paused</div>
            <button className="pause-resume-btn" onClick={() => {
                setPaused(false);
                dispatch({ type: 'RESUME_BOTS' });
              }}>
              ▶ Resume
            </button>
          </div>
        </div>
      )}

      {/* Blitz popup */}
      {roundEndActive && blitzPopup && !showFullStats && (
        <div className="blitz-popup-overlay" onPointerUp={() => setShowFullStats(true)}>
          <div className="blitz-popup">
            <div className="blitz-popup-title">Blitz!</div>
            <div className="blitz-popup-player">Player: {blitzPopup}</div>
            <button
              className="blitz-popup-btn"
              onPointerUp={e => { e.stopPropagation(); setShowFullStats(true); }}
            >
              View Statistics
            </button>
          </div>
        </div>
      )}

      {roundEndActive && showFullStats && (
        <GameOverScreen state={state} dispatch={dispatch} myPlayerId={myPlayerId} />
      )}

      {/* Portrait rotation hint (CSS controls visibility) */}
      <div className="rotate-hint">
        <div className="rotate-hint-icon"><PhoneRotateIcon size={44} /></div>
        <div className="rotate-hint-text">Rotate device to landscape</div>
      </div>
    </div>
  );
}
