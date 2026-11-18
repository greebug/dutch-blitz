import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { type Card, RANK_LABELS, SUIT_LABELS, cardId } from '../gin/cards';
import { type Meld, analyzeHand } from '../gin/melds';
import { sortHand } from '../gin/order';
import type { GinView } from '../gin/game';
import { CardFace, CardSlot, meldGlow } from './CardFace';
import { resultHeadline } from './GinBoard';
import { flyFrom, prefersReducedMotion, readSlots } from './motion';

/**
 * The end of a hand, shown rather than summarised.
 *
 * "4 points — knocker on 3, defender on 7, 2 laid off" is a true sentence and
 * a useless one. It is also the only part of Gin where a player is routinely
 * surprised by the score, because laying off happens to their cards without
 * them doing anything: they are holding a 5 of roots as dead weight and it
 * silently evaporates onto the other player's 6-7-8. Nothing about that is
 * visible in a line of arithmetic.
 *
 * So both hands are laid out in their melds, and then the defender's deadwood
 * is seen leaving -- card by card, each one travelling to the meld that
 * absorbed it and arriving in a different colour, so what the knocker actually
 * built stays distinguishable from what the defender handed over.
 */

/** Long enough to take in both hands before anything starts moving. */
const REVEAL_HOLD_MS = 900;
const LAYOFF_MS = 700;
/** Cards go one at a time; a volley of them would be as unreadable as no animation. */
const LAYOFF_STAGGER_MS = 190;

const LAID_RING = '#e0604f';

export interface GinShowdownProps {
  view: GinView;
  opponentLabel: string;
  onNext: () => void;
  nextDisabled?: boolean;
  note?: string;
  /** The button's words. "Next hand" unless the match is over. */
  nextLabel?: string;
}

interface Placed {
  card: Card;
  /** Arrived from the defender's deadwood rather than being dealt into this meld. */
  laid: boolean;
}

export default function GinShowdown({
  view,
  opponentLabel,
  onNext,
  nextDisabled,
  note,
  nextLabel,
}: GinShowdownProps) {
  const score = view.score;
  const rootRef = useRef<HTMLDivElement>(null);

  const knockerSeat = view.knocker;
  const iAmKnocker = knockerSeat !== null && knockerSeat === view.seat;
  const knockerName = iAmKnocker ? 'You' : opponentLabel;
  const defenderName = iAmKnocker ? opponentLabel : 'You';

  const theirHand = view.opponentHand ?? [];
  const knockerHand = iAmKnocker ? view.hand : theirHand;
  const defenderHand = iAmKnocker ? theirHand : view.hand;

  const layoffs = useMemo(() => score?.layoffs ?? [], [score]);
  const laidIds = useMemo(() => new Set(layoffs.map((p) => cardId(p.card))), [layoffs]);

  const knockerDeadwood = useMemo(
    () => (knockerSeat === null ? [] : analyzeHand(knockerHand).deadwood),
    [knockerSeat, knockerHand]
  );
  const defenderAnalysis = useMemo(
    () => (knockerSeat === null ? null : analyzeHand(defenderHand)),
    [knockerSeat, defenderHand]
  );

  // With motion off there is nothing to hold the panel back for: it opens with
  // the layoffs already in place, which is the same information without the
  // journey.
  const [stage, setStage] = useState<'reveal' | 'laid'>(
    layoffs.length > 0 && !prefersReducedMotion() ? 'reveal' : 'laid'
  );

  // Measured in the timeout rather than on mount, so the start positions are
  // where the cards are at the instant they set off. Card faces are SVG and
  // fonts may still be settling a frame or two after this panel appears; a
  // snapshot taken too early sends every card off from slightly the wrong place.
  const snapshot = useRef<Map<string, DOMRect>>(new Map());
  useEffect(() => {
    if (stage !== 'reveal') return;
    const timer = window.setTimeout(() => {
      snapshot.current = readSlots(rootRef.current);
      setStage('laid');
    }, REVEAL_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [stage]);

  useLayoutEffect(() => {
    if (stage !== 'laid') return;
    const root = rootRef.current;
    if (!root || snapshot.current.size === 0) return;
    layoffs.forEach((placement, i) => {
      const id = cardId(placement.card);
      const was = snapshot.current.get(id);
      const el = root.querySelector<HTMLElement>(`[data-slot="${id}"]`);
      if (was && el) flyFrom(el, was, LAYOFF_MS, i * LAYOFF_STAGGER_MS);
    });
  }, [stage, layoffs]);

  // Every hook is above this line: the panel renders three quite different
  // shapes -- no score, a dead hand, a scored hand -- and they cannot be
  // allowed to each call a different number of them.
  if (!score) return null;

  // The knocker's melds come from the score rather than being recomputed, since
  // `layoffs[].meldIndex` points into that exact array.
  const knockerMelds = score.knockerMelds;

  // A dead hand has no knocker and nothing to lay off, so both hands are simply
  // shown as they stood.
  if (knockerSeat === null) {
    return (
      <div className="gin-result" role="status" ref={rootRef}>
        <h2>Push</h2>
        <p className="gin-result__detail">
          The stock is down to its last two cards with nobody knocking. No score.
        </p>
        <div className="gin-showdown">
          <HandSide title="You" hand={view.hand} />
          <HandSide title={opponentLabel} hand={theirHand} />
        </div>
        <Footer onNext={onNext} nextDisabled={nextDisabled} note={note} label={nextLabel} />
      </div>
    );
  }

  const showJoined = stage === 'laid';
  const defenderDeadwood = (defenderAnalysis?.deadwood ?? []).filter(
    (card) => !(showJoined && laidIds.has(cardId(card)))
  );

  const noLayoff = score.outcome === 'gin' || score.outcome === 'big-gin';

  return (
    <div className="gin-result" role="status" ref={rootRef}>
      <h2>{resultHeadline(score.outcome, score.winner, knockerSeat, view.seat, opponentLabel)}</h2>
      <p className="gin-result__detail">
        {score.points} point{score.points === 1 ? '' : 's'} — {knockerName.toLowerCase() === 'you' ? 'you' : knockerName} on{' '}
        {score.knockerDeadwood}, {defenderName.toLowerCase() === 'you' ? 'you' : defenderName} on{' '}
        {score.defenderDeadwood}
        {layoffs.length > 0
          ? `, after ${layoffs.length} card${layoffs.length === 1 ? '' : 's'} laid off`
          : ''}
        .
      </p>

      <div className="gin-showdown">
        <section className="gin-side" data-role="knocker">
          <h3 className="gin-side__title">
            {knockerName}
            <span className="gin-side__tag">
              {score.outcome === 'big-gin'
                ? 'big gin'
                : score.outcome === 'gin'
                  ? 'gin'
                  : `knocked at ${score.knockerDeadwood}`}
            </span>
          </h3>
          <div className="gin-meldrow">
            {knockerMelds.map((meld, i) => (
              <MeldBox
                key={i}
                meld={meld}
                colour={meldGlow(i)}
                joined={layoffs.filter((p) => p.meldIndex === i).map((p) => p.card)}
                showJoined={showJoined}
              />
            ))}
            {knockerDeadwood.length > 0 && (
              <LooseBox label={`${score.knockerDeadwood} deadwood`} cards={knockerDeadwood} />
            )}
          </div>
        </section>

        <section className="gin-side" data-role="defender">
          <h3 className="gin-side__title">
            {defenderName}
            <span className="gin-side__tag">
              {score.defenderDeadwood} deadwood
              {layoffs.length > 0 ? ' after laying off' : ''}
            </span>
          </h3>
          <div className="gin-meldrow">
            {(defenderAnalysis?.melds ?? []).map((meld, i) => (
              <MeldBox key={i} meld={meld} colour={meldGlow(i)} joined={[]} showJoined={false} />
            ))}
            {defenderDeadwood.length > 0 && (
              <LooseBox
                label={layoffs.length > 0 && showJoined ? 'left over' : 'deadwood'}
                cards={defenderDeadwood}
                marked={showJoined ? undefined : laidIds}
              />
            )}
          </div>
        </section>
      </div>

      {layoffs.length > 0 ? (
        <p className="gin-legend">
          <span className="gin-key" style={{ ['--key' as string]: meldGlow(0) }} />
          {knockerName === 'You' ? 'your' : `${knockerName}'s`} own melds
          <span className="gin-key" style={{ ['--key' as string]: LAID_RING }} />
          laid off from {defenderName === 'You' ? 'your' : `${defenderName}'s`} deadwood
        </p>
      ) : noLayoff ? (
        <p className="gin-legend">
          Nothing could be laid off — {score.outcome === 'big-gin' ? 'big gin' : 'gin'} is
          un-layoff-able, which is the whole reason to chase it.
        </p>
      ) : (
        <p className="gin-legend">
          Nothing of {defenderName === 'You' ? 'yours' : `${defenderName}'s`} fitted{' '}
          {knockerName === 'You' ? 'your' : `${knockerName}'s`} melds.
        </p>
      )}

      <Footer onNext={onNext} nextDisabled={nextDisabled} note={note} label={nextLabel} />
    </div>
  );
}

function Footer({
  onNext,
  nextDisabled,
  note,
  label,
}: {
  onNext: () => void;
  nextDisabled?: boolean;
  note?: string;
  label?: string;
}) {
  return (
    <div className="gin-result__foot">
      <button type="button" className="gin-btn gin-btn--go" onClick={onNext} disabled={nextDisabled}>
        {label ?? 'Next hand'}
      </button>
      {note && <p className="gin-result__note">{note}</p>}
    </div>
  );
}

/**
 * One meld, with whatever was laid off onto it.
 *
 * Runs are re-sorted by rank once the arrivals are in, because that is where a
 * laid-off card belongs: lay a 5 onto 6-7-8 and it goes at the front, not on
 * the end. Sets keep their order, having none worth preserving.
 */
function MeldBox({
  meld,
  colour,
  joined,
  showJoined,
}: {
  meld: Meld;
  colour: string;
  joined: Card[];
  showJoined: boolean;
}) {
  const placed: Placed[] = meld.cards.map((card) => ({ card, laid: false }));
  if (showJoined) for (const card of joined) placed.push({ card, laid: true });
  if (meld.kind === 'run') placed.sort((a, b) => a.card.rank - b.card.rank);

  return (
    <div className="gin-meldbox" data-kind={meld.kind}>
      {/* Still named for what the knocker built. The count of arrivals is
          tacked on because otherwise the label quietly stops describing the
          row -- "1-4 goblets" over six cards reads as a mistake. */}
      <span className="gin-meldbox__tag">
        {meldLabel(meld)}
        {showJoined && joined.length > 0 ? ` +${joined.length}` : ''}
      </span>
      <div className="gin-meldbox__cards">
        {placed.map(({ card, laid }) => (
          <CardSlot
            key={cardId(card)}
            id={cardId(card)}
            rings={[laid ? LAID_RING : colour]}
            className={laid ? 'is-laid' : undefined}
          >
            <CardFace card={card} />
          </CardSlot>
        ))}
      </div>
    </div>
  );
}

function LooseBox({
  label,
  cards,
  marked,
}: {
  label: string;
  cards: readonly Card[];
  /** Cards about to leave, ringed so the eye is on them before they move. */
  marked?: Set<string>;
}) {
  return (
    <div className="gin-meldbox" data-kind="dead">
      <span className="gin-meldbox__tag">{label}</span>
      <div className="gin-meldbox__cards">
        {sortHand(cards).map((card) => {
          const id = cardId(card);
          const going = marked?.has(id) ?? false;
          return (
            <CardSlot
              key={id}
              id={id}
              rings={going ? [LAID_RING] : []}
              className={going ? 'is-going' : undefined}
            >
              <CardFace card={card} dead={!going} />
            </CardSlot>
          );
        })}
      </div>
    </div>
  );
}

/** A whole hand in its own best arrangement -- used only for a dead hand. */
function HandSide({ title, hand }: { title: string; hand: readonly Card[] }) {
  const analysis = analyzeHand(hand);
  return (
    <section className="gin-side">
      <h3 className="gin-side__title">
        {title}
        <span className="gin-side__tag">{analysis.deadwoodPoints} deadwood</span>
      </h3>
      <div className="gin-meldrow">
        {analysis.melds.map((meld, i) => (
          <MeldBox key={i} meld={meld} colour={meldGlow(i)} joined={[]} showJoined={false} />
        ))}
        {analysis.deadwood.length > 0 && (
          <LooseBox label="deadwood" cards={analysis.deadwood} />
        )}
      </div>
    </section>
  );
}

function meldLabel(meld: Meld): string {
  if (meld.kind === 'set') return `${RANK_LABELS[meld.cards[0].rank]}s`;
  const sorted = [...meld.cards].sort((a, b) => a.rank - b.rank);
  const low = RANK_LABELS[sorted[0].rank];
  const high = RANK_LABELS[sorted[sorted.length - 1].rank];
  return `${low}–${high} ${SUIT_LABELS[sorted[0].suit]}`;
}
