import { useEffect, useRef, useState } from 'react';

import { prefersReducedMotion } from './motion';

/** How long after a hand is scored before the points set off: the result panel has to be up to leave from. */
export const TALLY_DELAY_MS = 1200;
const FLIGHT_MS = 750;
const COUNT_MS = 650;
/** Everything a tally does, start to finish. The match-win popup waits this long. */
export const TALLY_TOTAL_MS = TALLY_DELAY_MS + FLIGHT_MS + COUNT_MS + 150;

/**
 * A running score that SHOWS points arriving.
 *
 * When the total goes up, a "+N" chip leaves the hand's result and flies up to
 * this number, which then counts up and glows. The point is where it takes the
 * eye: after every hand, up to the score, so nobody has to go looking for who
 * is ahead. A total going down (a new match) just resets, quietly.
 */
export function ScoreTally({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const [bumped, setBumped] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const previous = useRef(value);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (value <= from) {
      setShown(value);
      return;
    }
    const gain = value - from;
    const timers: number[] = [];
    let raf = 0;
    let chip: HTMLElement | null = null;

    const count = () => {
      setBumped(true);
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / COUNT_MS);
        setShown(Math.round(from + gain * (1 - (1 - t) ** 3)));
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      timers.push(window.setTimeout(() => setBumped(false), COUNT_MS + 700));
    };

    if (prefersReducedMotion()) {
      count();
    } else {
      timers.push(
        window.setTimeout(() => {
          const to = ref.current?.getBoundingClientRect();
          if (!to) return count();
          // From the result's headline if it is on screen, else the middle.
          const fromEl = document.querySelector('.gin-result h2');
          const src = fromEl?.getBoundingClientRect();
          const sx = src ? src.left + Math.min(src.width / 2, 120) : window.innerWidth / 2;
          const sy = src ? src.top + src.height / 2 : window.innerHeight / 2;
          const tx = to.left + to.width / 2;
          const ty = to.top + to.height / 2;

          chip = document.createElement('span');
          chip.className = 'gin-gain';
          chip.textContent = `+${gain}`;
          chip.style.left = `${tx}px`;
          chip.style.top = `${ty}px`;
          document.body.appendChild(chip);
          const dx = sx - tx;
          const dy = sy - ty;
          const flight = chip.animate(
            [
              { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(0.6)`, opacity: 0 },
              { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(1.25)`, opacity: 1, offset: 0.18 },
              { transform: `translate(-50%, -50%) translate(${dx * 0.35}px, ${dy * 0.35 - 30}px) scale(1.1)`, opacity: 1, offset: 0.6 },
              { transform: 'translate(-50%, -50%) scale(0.7)', opacity: 0.2 },
            ],
            { duration: FLIGHT_MS, easing: 'cubic-bezier(0.45, 0, 0.3, 1)', fill: 'forwards' }
          );
          flight.onfinish = () => {
            chip?.remove();
            chip = null;
            count();
          };
        }, TALLY_DELAY_MS)
      );
    }

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      cancelAnimationFrame(raf);
      chip?.remove();
      setShown(value);
      setBumped(false);
    };
  }, [value]);

  return (
    <strong ref={ref} className={`gin-tally${bumped ? ' is-bumped' : ''}`}>
      {shown}
    </strong>
  );
}
