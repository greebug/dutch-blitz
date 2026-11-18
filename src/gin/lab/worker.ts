import { parentPort } from 'node:worker_threads';

import { type Job, runJob } from './jobs';

/** One core's worth of card playing. See pool.ts. */
parentPort!.on('message', (msg: { id: number; job: Job }) => {
  try {
    parentPort!.postMessage({ id: msg.id, tally: runJob(msg.job) });
  } catch (error) {
    parentPort!.postMessage({ id: msg.id, error: String((error as Error)?.stack ?? error) });
  }
});
