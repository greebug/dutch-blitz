/**
 * /compute -- a password-gated, read-only view of what the two training PCs are doing.
 *
 * Nothing here reaches into the PCs. Jesse's PC pushes a sanitised snapshot (job names, progress,
 * CPU/GPU shares, temperatures -- no paths, users, hostnames, command lines or other programs) to
 * POST /compute/api/push with a bearer key, and the server keeps only the latest one in memory.
 * Viewers type the password once; a signed, HttpOnly cookie (path /compute) then lets the page
 * read GET /compute/api/state.
 *
 * Off unless both secrets are set (Railway variables, never in the repo):
 *   COMPUTE_PASSWORD    the viewing password
 *   COMPUTE_PUSH_TOKEN  the key the pusher sends (long, random)
 * Not linked from anywhere; only the exact URL leads here.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express, { type Express, type Request, type Response } from 'express';

const COOKIE = 'compute_session';
const SESSION_DAYS = 30;
const MAX_SNAPSHOT = 512 * 1024;
const FAIL_WINDOW_MS = 15 * 60_000;
const FAILS_PER_IP = 8;
const FAILS_GLOBAL = 60;

let snapshot: { body: unknown; receivedAt: number } | null = null;
const fails = new Map<string, number[]>();
let globalFails: number[] = [];

function same(a: string, b: string): boolean {
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

/** Signing key for session cookies: changes whenever either secret changes, which logs everyone out. */
function key(): Buffer {
  return crypto.createHash('sha256').update(`compute|${process.env.COMPUTE_PASSWORD}|${process.env.COMPUTE_PUSH_TOKEN}`).digest();
}

function sign(expires: number): string {
  const mac = crypto.createHmac('sha256', key()).update(String(expires)).digest('base64url');
  return `${expires}.${mac}`;
}

function validSession(req: Request): boolean {
  const raw = (req.headers.cookie ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return false;
  const [exp, mac] = raw.slice(COOKIE.length + 1).split('.');
  const expires = Number(exp);
  if (!Number.isFinite(expires) || expires < Date.now() || !mac) return false;
  return same(sign(expires), `${exp}.${mac}`);
}

function clientIp(req: Request): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf;
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.socket.remoteAddress ?? '?';
}

function recent(list: number[], now: number): number[] {
  return list.filter((t) => now - t < FAIL_WINDOW_MS);
}

function locked(ip: string, now: number): boolean {
  globalFails = recent(globalFails, now);
  const mine = recent(fails.get(ip) ?? [], now);
  fails.set(ip, mine);
  return mine.length >= FAILS_PER_IP || globalFails.length >= FAILS_GLOBAL;
}

function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
}

const LOGIN = (msg: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Compute</title><style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#1b1f24;--muted:#5d6673;--line:#e3e6ea;--bad:#c62828}
@media (prefers-color-scheme: dark){:root{--bg:#111418;--card:#1a1e24;--ink:#e8ebef;--muted:#98a2ae;--line:#2a3038;--bad:#ff6b6b}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
form{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:22px;width:min(320px,calc(100vw - 32px));display:grid;gap:10px}
h1{font-size:18px;margin:0}input,button{font:inherit;padding:9px 10px;border-radius:7px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
button{cursor:pointer;font-weight:600}.err{color:var(--bad);font-size:13px;min-height:1em}
</style></head><body><form method="post" action="/compute/login"><h1>Compute</h1>
<input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
<button type="submit">Open</button><div class="err">${msg}</div></form></body></html>`;

export function attachCompute(app: Express) {
  const enabled = () => !!(process.env.COMPUTE_PASSWORD && process.env.COMPUTE_PUSH_TOKEN);
  // The same page as the local dashboard (solver/helper/dashboard.py); it notices it is under /compute.
  const page = path.join(process.cwd(), 'solver', 'helper', 'dashboard.html');

  app.post('/compute/api/push', express.json({ limit: MAX_SNAPSHOT }), (req, res) => {
    noStore(res);
    const auth = req.headers.authorization ?? '';
    if (!enabled() || !auth.startsWith('Bearer ') || !same(auth.slice(7), process.env.COMPUTE_PUSH_TOKEN!)) {
      res.status(404).end();
      return;
    }
    if (!req.body || typeof req.body !== 'object') {
      res.status(400).end();
      return;
    }
    snapshot = { body: req.body, receivedAt: Date.now() };
    res.status(204).end();
  });

  app.post('/compute/login', express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
    noStore(res);
    if (!enabled()) { res.status(404).end(); return; }
    const now = Date.now();
    const ip = clientIp(req);
    if (locked(ip, now)) {
      res.status(429).type('html').send(LOGIN('Too many tries. Wait a few minutes.'));
      return;
    }
    const pw = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!same(pw, process.env.COMPUTE_PASSWORD!)) {
      fails.set(ip, [...(fails.get(ip) ?? []), now]);
      globalFails.push(now);
      res.status(401).type('html').send(LOGIN('Wrong password.'));
      return;
    }
    const expires = now + SESSION_DAYS * 86_400_000;
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE}=${sign(expires)}; Path=/compute; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
    res.redirect(303, '/compute/');
  });

  app.get('/compute/api/state', (req, res) => {
    noStore(res);
    if (!enabled() || !validSession(req)) { res.status(401).json({ error: 'sign in' }); return; }
    res.json({ ...(snapshot?.body as object ?? { machines: {} }), receivedAt: snapshot?.receivedAt ?? null, serverNow: Date.now() });
  });

  // One handler for /compute and /compute/: Express 5's non-strict routing matches both against
  // either pattern, so a separate redirect route would redirect /compute/ to itself forever.
  app.get('/compute', (req, res) => {
    if (!req.originalUrl.split('?')[0].endsWith('/')) { res.redirect('/compute/'); return; }
    noStore(res);
    if (!enabled()) { res.status(404).end(); return; }
    if (!validSession(req)) { res.type('html').send(LOGIN('')); return; }
    res.type('html').send(fs.readFileSync(page, 'utf8'));
  });
}
