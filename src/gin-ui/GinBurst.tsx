import { useEffect } from 'react';

import type { HandOutcome } from '../gin/rules';
import { MELD_GLOW } from './CardFace';
import { prefersReducedMotion } from './motion';

/**
 * The word that lands when a hand ends.
 *
 * Purely celebration, and deliberately so: the showdown panel already says who
 * won and by how much, in a form you can read at your own pace. This is the
 * other thing a table gives you, which no amount of correct scoring does -- the
 * moment itself. It bursts, it is gone in two seconds, and nothing waits for
 * it.
 */

const WORDS: Record<HandOutcome, string | null> = {
  'big-gin': 'Big Gin',
  gin: 'Gin',
  // An undercut is still a knock, and the knock is what just physically
  // happened at the table. That it went badly for the knocker is the
  // showdown's news to break, not this.
  undercut: 'Knock',
  knock: 'Knock',
  // Nobody knocked and the stock is down to its last two cards. It is still an
  // ending, and it still deserves to be announced rather than inferred from a
  // board that has quietly stopped responding.
  'dead-hand': 'Push',
};

export function burstWord(outcome: HandOutcome): string | null {
  return WORDS[outcome] ?? null;
}

/** Long enough to read and enjoy, short enough that nobody waits for it. */
const LIFE_MS = 2200;
/** For anything that has to let the word finish before it acts. */
export const BURST_MS = LIFE_MS;
const LIFE_STILL_MS = 1400;

/** Letter-by-letter, so the word arrives rather than appears. */
const LETTER_STEP_MS = 54;
const POPS = 14;

export function GinBurst({
  word,
  tone,
  onDone,
}: {
  word: string;
  /** Whose it is, which is all the side of the screen says. A push is nobody's. */
  tone: 'mine' | 'theirs' | 'nobody';
  onDone: () => void;
}) {
  const still = prefersReducedMotion();

  useEffect(() => {
    const timer = window.setTimeout(onDone, still ? LIFE_STILL_MS : LIFE_MS);
    return () => window.clearTimeout(timer);
  }, [onDone, still]);

  const letters = [...word];

  return (
    <div
      className={`gin-burst is-${tone}${still ? ' is-still' : ''} ${toneClass(word)}`}
      role="status"
    >
      <p className="gin-burst__word">
        {letters.map((ch, i) => (
          <span
            key={i}
            className="gin-burst__ch"
            style={{ animationDelay: `${i * LETTER_STEP_MS}ms` }}
          >
            {ch === ' ' ? ' ' : ch}
          </span>
        ))}
      </p>
      {!still && (
        <span className="gin-burst__pop" aria-hidden="true">
          {Array.from({ length: POPS }, (_, i) => (
            <span
              key={i}
              className="gin-burst__bit"
              style={{
                ['--angle' as string]: `${(360 / POPS) * i + (i % 2 ? 7 : -7)}deg`,
                ['--reach' as string]: `${96 + (i % 3) * 38}px`,
                ['--bit' as string]: MELD_GLOW[i % MELD_GLOW.length],
                animationDelay: `${140 + i * 16}ms`,
              }}
            />
          ))}
        </span>
      )}
    </div>
  );
}

/** Gin is worth a different colour from a knock, and big gin from both. */
function toneClass(word: string): string {
  if (word === 'Big Gin') return 'is-biggin';
  if (word === 'Gin') return 'is-gin';
  if (word === 'Push') return 'is-push';
  return 'is-knock';
}
