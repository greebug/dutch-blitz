// Prints every logged gin hand as one JSON line, oldest first.
//
// Meant to be piped INTO the live server, which can reach Postgres on
// Railway's private network (the database has no public address):
//
//   cmd /c "railway ssh -p <project> -s dutch-blitz -e production -- node < src\gin\lab\export-hands.cjs > logs\gin-hands.prod.jsonl"
//
// Plain JavaScript and ASCII only, so it survives being piped through a shell
// as-is. Uses the server's own DATABASE_URL and the pg it already has.
const { Client } = require('pg');

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('no DATABASE_URL in this container');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT record FROM gin_hands ORDER BY id');
    for (const r of rows) process.stdout.write(JSON.stringify(r.record) + '\n');
    console.error(rows.length + ' hands exported');
  } finally {
    await client.end();
  }
})().catch((e) => {
  console.error('export failed: ' + (e && e.message ? e.message : e));
  process.exit(1);
});
