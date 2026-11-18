import { useEffect } from 'react';

import { MELD_GLOW } from './CardFace';
import { prefersReducedMotion } from './motion';

const LETTER_STEP_MS = 60;
const BITS = 22;

/**
 * "Jesse wins!" -- the end of a match, announced.
 *
 * The same bubble letters as a knock, but in the middle of the screen and
 * staying put until it is dismissed: a match is the thing the whole evening
 * was about, and it should not be missable by glancing away for two seconds.
 * Tap anywhere, Escape, or the button to close; the result underneath still
 * has "New match".
 */
export function GinMatchWin({
  title,
  detail,
  mine,
  onClose,
}: {
  title: string;
  detail: string;
  /** Your win is gold; theirs is a cooler silver. */
  mine: boolean;
  onClose: () => void;
}) {
  const still = prefersReducedMotion();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === 'Enter') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className={`gin-matchwin${mine ? ' is-mine' : ' is-theirs'}${still ? ' is-still' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="gin-matchwin__card">
        {!still && (
          <span className="gin-matchwin__pop" aria-hidden="true">
            {Array.from({ length: BITS }, (_, i) => (
              <span
                key={i}
                className="gin-burst__bit"
                style={{
                  ['--angle' as string]: `${(360 / BITS) * i + (i % 2 ? 5 : -5)}deg`,
                  ['--reach' as string]: `${120 + (i % 4) * 34}px`,
                  ['--bit' as string]: MELD_GLOW[i % MELD_GLOW.length],
                  animationDelay: `${260 + i * 22}ms`,
                }}
              />
            ))}
          </span>
        )}
        <p className="gin-matchwin__word">
          {/* Letters arrive one by one, but a line may only break between words. */}
          {title.split(' ').map((word, w, words) => {
            const offset = words.slice(0, w).join(' ').length + (w ? 1 : 0);
            return (
              <span key={w} className="gin-matchwin__group">
                {[...word].map((ch, i) => (
                  <span
                    key={i}
                    className="gin-matchwin__ch"
                    style={{ animationDelay: `${(offset + i) * LETTER_STEP_MS}ms` }}
                  >
                    {ch}
                  </span>
                ))}
                {w < words.length - 1 ? ' ' : null}
              </span>
            );
          })}
        </p>
        <p className="gin-matchwin__detail">{detail}</p>
        <button type="button" className="gin-btn gin-btn--gold" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
