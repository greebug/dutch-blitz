import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Express } from 'express';
import type { Pool } from 'pg';

/**
 * Hand logs from solo games against the computer.
 *
 * Every finished hand is posted here by the client: the deal's seed, the full
 * action list, how long each move took, the level of the opponent, and the
 * match score going in. The seed plus the actions reproduce the hand exactly
 * through the referee, so nothing else needs storing -- see
 * src/gin/lab/logs.run.ts for the replay and the analysis.
 *
 * Stored twice: appended to logs/gin-hands.jsonl next to the server (what the
 * analysis reads), and into Postgres when there is one, since a Railway
 * container's disk does not outlive a deploy.
 */
export const LOG_FILE = path.join(process.cwd(), 'logs', 'gin-hands.jsonl');

const LEVELS = new Set(['easy', 'medium', 'hard']);

/** The shape check. Anything else is dropped with a 400, not stored. */
export function validHand(body: any): string | null {
  if (!body || typeof body !== 'object') return 'not an object';
  if (body.v !== 1) return 'unknown version';
  if (!Number.isInteger(body.seed)) return 'seed';
  if (!LEVELS.has(body.level)) return 'level';
  if (body.humanSeat !== 0 && body.humanSeat !== 1) return 'humanSeat';
  if (!Array.isArray(body.history) || body.history.length > 450) return 'history';
  if (!Array.isArray(body.times) || body.times.length !== body.history.length) return 'times';
  if (typeof body.matchId !== 'string' || body.matchId.length > 64) return 'matchId';
  for (const a of body.history) {
    if (!a || typeof a.type !== 'string') return 'action';
  }
  return null;
}

/**
 * Store one record: the file next to the server, and Postgres when there is
 * one. Shared by the solo endpoint and the two-player table, which logs its
 * own hands server-side since it already holds the whole state.
 */
export async function storeHand(pool: Pool | null, player: string | null, record: object): Promise<void> {
  await mkdir(path.dirname(LOG_FILE), { recursive: true });
  await appendFile(LOG_FILE, JSON.stringify(record) + '\n');
  if (pool) await pool.query(`INSERT INTO gin_hands (player, record) VALUES ($1, $2)`, [player, record]);
}

export async function attachGinLog(
  app: Express,
  pool: Pool | null,
  resolveName: (cookie: string | undefined) => Promise<string | null>
): Promise<void> {
  if (pool) {
    await pool
      .query(
        `CREATE TABLE IF NOT EXISTS gin_hands (
           id          SERIAL PRIMARY KEY,
           received_at TIMESTAMPTZ DEFAULT NOW(),
           player      TEXT,
           record      JSONB NOT NULL
         )`
      )
      .catch((e) => console.error('gin_hands table:', e));
  }

  app.post('/gin/api/hands', async (req, res) => {
    const problem = validHand(req.body);
    if (problem) {
      res.status(400).json({ error: `bad hand record: ${problem}` });
      return;
    }
    const player = await resolveName(req.headers.cookie).catch(() => null);
    const record = { ...req.body, player, receivedAt: new Date().toISOString() };
    try {
      await storeHand(pool, player, record);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message ?? e) });
    }
  });
}
