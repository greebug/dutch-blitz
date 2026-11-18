import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import pg from 'pg';

/**
 * Pull the live site's hand logs down to logs/gin-hands.prod.jsonl.
 *
 * On Railway the container's disk is wiped by every deploy, so the copy that
 * lasts is the `gin_hands` table in Postgres. Run it through the Railway CLI,
 * which hands this script the database's address without it ever being
 * written down or printed:
 *
 *   railway run -p <project id> -s Postgres -e production -- npm run lab:pull
 *
 * Then analyse it like the local log:
 *
 *   npm run lab:logs -- logs/gin-hands.prod.jsonl --review
 */
const url = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('No DATABASE_PUBLIC_URL / DATABASE_URL in the environment. Run this through `railway run`.');
  process.exit(1);
}

// Wrapped: tsx runs this as CommonJS, which has no top-level await.
async function main(): Promise<void> {
  const out = path.join(process.cwd(), 'logs', 'gin-hands.prod.jsonl');
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query<{ record: unknown }>('SELECT record FROM gin_hands ORDER BY id');
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, rows.map((r) => JSON.stringify(r.record)).join('\n') + (rows.length ? '\n' : ''));
    console.log(`${rows.length} hands written to ${path.relative(process.cwd(), out)}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error(message);
  if (/invalid url/i.test(message)) {
    console.error(
      'The database has no public address (public networking is off on the Postgres service).\n' +
        'Export from inside the live server instead -- see src/gin/lab/export-hands.cjs.'
    );
  }
  process.exit(1);
});
