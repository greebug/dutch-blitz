import { useEffect } from 'react';

import { NAPOLETANE_GIN as R } from '../gin/rules';
import { STOCK_FLOOR } from '../gin/rules';
import { CardFace } from './CardFace';
import type { Card } from '../gin/cards';

const c = (id: string): Card => ({
  suit: id.slice(0, 2) as Card['suit'],
  rank: Number(id.slice(2)) as Card['rank'],
});

function Row({ ids }: { ids: string[] }) {
  return (
    <div className="gin-rules__cards">
      {ids.map((id) => (
        <CardFace key={id} card={c(id)} />
      ))}
    </div>
  );
}

/**
 * The rules, as the engine plays them. Every number here is read from
 * `NAPOLETANE_GIN`, so the page cannot drift from the scoring code.
 */
export default function GinRules({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="gin-modal" role="dialog" aria-modal="true" aria-label="How to play">
      <div className="gin-modal__scrim" onClick={onClose} />
      <div className="gin-modal__panel gin-rules">
        <header className="gin-review__head">
          <h2>How to play</h2>
          <button type="button" className="gin-review__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <section>
          <h3>The deck</h3>
          <p>
            Forty Neapolitan cards in four suits: <strong>roots</strong> (clubs), <strong>suns</strong> (coins),{' '}
            <strong>swords</strong> and <strong>goblets</strong> (cups). Each suit runs 1 to 7, then the{' '}
            <strong>Jack</strong>, <strong>Horse</strong> and <strong>King</strong>.
          </p>
          <Row ids={['go1', 'go2', 'go3', 'go7', 'go8', 'go9', 'go10']} />
          <p>
            Cards are worth their number; the Jack, Horse and King are worth <strong>8</strong> each.
          </p>
        </section>

        <section>
          <h3>A turn</h3>
          <p>
            Each player is dealt {R.handSize}; one card is turned face up to start the discard pile and the rest
            form the stock. On your turn, <strong>draw</strong> one card — the top of the stock, or the face-up
            card — then <strong>discard</strong> one.
          </p>
        </section>

        <section>
          <h3>Melds</h3>
          <p>
            A <strong>set</strong> is three or four cards of the same rank. A <strong>run</strong> is three or more
            in a row in one suit, counting 1–7 then Jack, Horse, King. The 1 is low, and there is no wrapping from
            King back to 1.
          </p>
          <div className="gin-rules__examples">
            <Row ids={['ro5', 'su5', 'sw5']} />
            <Row ids={['sw7', 'sw8', 'sw9', 'sw10']} />
          </div>
          <p>
            Cards in no meld are <strong>deadwood</strong>; the deadwood count is their total. Each card can be in
            only one meld, and the game always counts your best arrangement.
          </p>
        </section>

        <section>
          <h3>Ending a hand</h3>
          <ul>
            <li>
              <strong>Knock</strong> when, after your discard, your deadwood is <strong>{R.knockMaxDeadwood}</strong>{' '}
              or less. Both hands are shown and your opponent may <strong>lay off</strong> their deadwood onto your
              melds. You score the difference between the two deadwood counts.
            </li>
            <li>
              <strong>Undercut</strong>: if their deadwood is equal to or lower than yours
              {R.tieGoesToDefender ? '' : ' (strictly lower)'}, they score the difference plus{' '}
              <strong>{R.undercutBonus}</strong>.
            </li>
            <li>
              <strong>Gin</strong>: knock with no deadwood at all. Scores their deadwood plus{' '}
              <strong>{R.ginBonus}</strong>, and nobody can lay off against it.
            </li>
            <li>
              <strong>Big gin</strong>: all eleven cards meld, so you lay down without discarding. Scores their
              deadwood plus <strong>{R.bigGinBonus}</strong>.
            </li>
            <li>
              <strong>Push</strong>: if the stock is down to its last {STOCK_FLOOR} cards and nobody has knocked,
              the hand is dead and nobody scores.
            </li>
          </ul>
        </section>

        <section>
          <h3>The match</h3>
          <p>
            Hands are played until someone reaches <strong>100</strong>. In a two-player game the host picks the
            target instead (anywhere from 50 to 500, or <strong>∞</strong> to play on with no limit). The opening
            turn alternates every hand, pushes included.
          </p>
        </section>

        <section>
          <h3>Playing the computer</h3>
          <p>
            <strong>Easy</strong> plays like a casual person, <strong>Medium</strong> is a strong tuned player, and{' '}
            <strong>Hard</strong> is the champion, which reads your hand from what you take, throw and pass and
            looks ahead before every move. None of them can see your cards.
          </p>
        </section>

        <section>
          <h3>Analyzing a hand</h3>
          <p>
            After any hand, solo or two-player, <strong>Analyze hand</strong> goes through every decision you made
            and shows what the champion would have done from your seat, seeing only what you could see.
          </p>
        </section>
      </div>
    </div>
  );
}
