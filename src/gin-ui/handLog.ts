import type { GinAction, GinState, Seat } from '../gin/game';
import type { Level } from '../gin/opponents';

/**
 * Logging solo hands, so real games against the computer can be studied.
 *
 * A hand is fully described by its seed and its actions -- the referee replays
 * it exactly from those -- so that is most of the record. The rest is what a
 * replay cannot recover: which level the person was playing, the match score
 * going in, and how long each move took, which is the closest thing to a read
 * on where they had to think.
 *
 * Posting can fail (the server is not running, the network drops), so a record
 * that does not get through waits in localStorage and goes with the next one.
 */
export interface HandRecord {
  v: 1;
  matchId: string;
  /** Hand number within the match, from 1. Pushes count. */
  hand: number;
  level: Level;
  humanSeat: Seat;
  seed: number;
  target: number;
  /** Match score going into the hand. */
  before: { you: number; bot: number };
  history: GinAction[];
  /** Milliseconds from the deal to each action, one per history entry. */
  times: number[];
  outcome: string;
  /** Points to the human: positive won, negative lost, 0 a push. */
  margin: number;
  /** Illegal moves the computer offered and had replaced. Should be 0. */
  fouls: number;
  finishedAt: string;
}

/** Points to `seat`: positive if they took the hand, negative if the other seat did. */
function margin(state: GinState, seat: Seat): number {
  const score = state.score;
  if (!score || score.winner === null) return 0;
  const knocker = state.knocker ?? 0;
  const winner = score.winner === 'knocker' ? knocker : knocker === 0 ? 1 : 0;
  return winner === seat ? score.points : -score.points;
}

const QUEUE_KEY = 'gin.handlog.queue';
const ENDPOINT = '/gin/api/hands';

export function recordHand(
  state: GinState,
  meta: Omit<HandRecord, 'v' | 'seed' | 'history' | 'outcome' | 'margin' | 'finishedAt'>
): HandRecord {
  return {
    v: 1,
    ...meta,
    seed: state.seed,
    history: state.history.slice(),
    outcome: state.score?.outcome ?? 'unfinished',
    margin: margin(state, meta.humanSeat),
    finishedAt: new Date().toISOString(),
  };
}

function readQueue(): HandRecord[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function writeQueue(queue: HandRecord[]): void {
  try {
    // Bounded: a few hundred hands is weeks of play, and storage is not free.
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-500)));
  } catch {
    /* storage unavailable: the record is lost, the game is not */
  }
}

async function send(record: HandRecord): Promise<boolean> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(record),
    });
    // A 400 means the server rejected the shape; retrying will not help.
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

let flushing = false;

/** Post this hand, and anything left over from before. */
export async function postHand(record: HandRecord): Promise<void> {
  writeQueue([...readQueue(), record]);
  if (flushing) return;
  flushing = true;
  try {
    let queue = readQueue();
    while (queue.length) {
      if (!(await send(queue[0]))) break;
      queue = readQueue().slice(1);
      writeQueue(queue);
    }
  } finally {
    flushing = false;
  }
}

export function newMatchId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
