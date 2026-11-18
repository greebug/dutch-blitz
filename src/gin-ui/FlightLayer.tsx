import { useEffect, useRef, useState } from 'react';

import { CardFace } from './CardFace';
import { type Anchor, type Flight, prefersReducedMotion } from './motion';

/**
 * The card currently crossing the table.
 *
 * Fixed-positioned above everything and measured in viewport coordinates,
 * which is what lets one card travel between places that know nothing about
 * each other -- the stock pile, a gap in your hand, the back of the opponent's
 * fan. Those live in different parts of the layout and none of them could
 * animate a card into another.
 *
 * Exactly one flight is in the air at a time; `useFlights` holds the rest in a
 * queue. That is not a simplification but the point of the thing: a draw and
 * the discard that follows it are two separate pieces of news, and overlapping
 * them would lose the order they happened in.
 */
export function FlightLayer({
  flight,
  rectOf,
  onLanded,
}: {
  flight: Flight | null;
  rectOf: (a: Anchor) => DOMRect | null;
  onLanded: (id: number) => void;
}) {
  if (!flight) return null;
  // Keyed on the id so each flight gets a fresh component, and with it a fresh
  // pair of measurements taken at the moment it actually sets off.
  return <FlightCard key={flight.id} flight={flight} rectOf={rectOf} onLanded={onLanded} />;
}

function FlightCard({
  flight,
  rectOf,
  onLanded,
}: {
  flight: Flight;
  rectOf: (a: Anchor) => DOMRect | null;
  onLanded: (id: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Read once, on mount. Measuring during the first render rather than in an
  // effect means the card is never painted at the wrong end of its journey.
  const [from] = useState(() => rectOf(flight.from));
  const [to] = useState(() => rectOf(flight.to));

  useEffect(() => {
    const el = ref.current;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onLanded(flight.id);
    };

    // Either end missing, or motion turned off, and the card simply arrives --
    // the board has already updated, so the worst case is a move that appears
    // without its animation.
    if (!el || !from || !to || typeof el.animate !== 'function' || prefersReducedMotion()) {
      finish();
      return;
    }

    const dx = to.left - from.left;
    const dy = to.top - from.top;
    const animation = el.animate(
      [
        { transform: 'translate(0px, 0px) scale(1) rotate(0deg)', offset: 0 },
        {
          // Lifted and turned at the midpoint, so the card reads as travelling
          // over the table rather than sliding along it.
          transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 18}px) scale(1.12) rotate(${
            dx >= 0 ? 4 : -4
          }deg)`,
          offset: 0.52,
        },
        { transform: `translate(${dx}px, ${dy}px) scale(1) rotate(0deg)`, offset: 1 },
      ],
      { duration: flight.ms, easing: 'cubic-bezier(.33,.1,.24,1)', fill: 'forwards' }
    );

    animation.addEventListener('finish', finish);
    // If the animation is interrupted -- a background tab throttling frames, an
    // engine that never fires finish -- the queue still has to drain, or the
    // board stays locked for the rest of the hand.
    const guard = window.setTimeout(finish, flight.ms + 600);
    return () => {
      window.clearTimeout(guard);
      animation.cancel();
    };
  }, [flight.id, flight.ms, from, to, onLanded]);

  if (!from) return null;

  return (
    <div className="gin-flightlayer" aria-hidden="true">
      <div className="gin-flight" ref={ref} style={{ left: from.left, top: from.top }}>
        {flight.card ? (
          <CardFace card={flight.card} />
        ) : (
          <div className="gin-card gin-card--back" />
        )}
      </div>
    </div>
  );
}
