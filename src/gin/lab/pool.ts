import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { type Job, type Tally, addTally, emptyTally, runJob } from './jobs';

/**
 * Every core on the machine, playing cards.
 *
 * One shared queue: jobs from any number of overlapping `run` calls go in,
 * and each worker takes the next one the moment it comes free, so a slow job
 * never leaves the rest of the machine idle. With `threads: 0` everything runs
 * inline, which is what the tests use.
 */
export interface Pool {
  run(jobs: Job[]): Promise<Tally[]>;
  close(): Promise<void>;
  size: number;
}

interface Pending {
  id: number;
  job: Job;
  resolve: (t: Tally) => void;
  reject: (e: Error) => void;
}

// GIN_THREADS caps the worker count, to leave the machine some headroom on long runs.
export function createPool(
  threads = Number(process.env.GIN_THREADS) || Math.max(1, availableParallelism() - 1)
): Pool {
  if (threads === 0) {
    return { size: 0, run: async (jobs) => jobs.map(runJob), close: async () => {} };
  }
  const script = join(process.cwd(), 'src', 'gin', 'lab', 'worker.ts');
  const queue: Pending[] = [];
  const busy = new Map<Worker, Pending>();
  const idle: Worker[] = [];
  let ids = 0;

  const pump = () => {
    while (idle.length && queue.length) {
      const worker = idle.pop()!;
      const item = queue.shift()!;
      busy.set(worker, item);
      worker.postMessage({ id: item.id, job: item.job });
    }
  };

  for (let i = 0; i < threads; i++) {
    const worker = new Worker(script, { execArgv: ['--import', 'tsx'] });
    worker.on('message', (msg: { id: number; tally?: Tally; error?: string }) => {
      const item = busy.get(worker);
      busy.delete(worker);
      idle.push(worker);
      if (item && item.id === msg.id) {
        if (msg.error) item.reject(new Error(msg.error));
        else item.resolve(msg.tally!);
      }
      pump();
    });
    worker.on('error', (e: Error) => {
      const item = busy.get(worker);
      if (item) item.reject(e);
    });
    idle.push(worker);
  }

  return {
    size: threads,
    run(jobs) {
      return Promise.all(
        jobs.map(
          (job) =>
            new Promise<Tally>((resolve, reject) => {
              queue.push({ id: ids++, job, resolve, reject });
              pump();
            })
        )
      );
    },
    async close() {
      await Promise.all([...idle, ...busy.keys()].map((w) => w.terminate()));
    },
  };
}

/** Split `count` paired samples of one pairing into jobs and add them back up. */
export async function measure(
  pool: Pool,
  make: (from: number, count: number) => Job,
  count: number,
  from = 0,
  chunk = 250
): Promise<Tally> {
  const jobs: Job[] = [];
  for (let i = 0; i < count; i += chunk) jobs.push(make(from + i, Math.min(chunk, count - i)));
  const parts = await pool.run(jobs);
  return parts.reduce(addTally, emptyTally());
}
