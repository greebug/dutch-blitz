import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createServer, type Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';

import { Server } from 'socket.io';
import { type Socket as ClientSocket, io as ioClient } from 'socket.io-client';

import { attachGin } from './gin';
import type { GinView } from '../src/gin/game';
import { knockOptions } from '../src/gin/rules';

/**
 * End-to-end over a real socket.io server on an ephemeral port.
 *
 * Worth the setup rather than unit-testing the handlers: the two things most
 * likely to be wrong here are that the per-socket views get crossed (both
 * players handed the same hand) and that turn order is enforceable only by the
 * UI. Neither shows up in a test of the pieces -- they are properties of the
 * wiring -- and both are the kind of bug you would discover from a player.
 */

let httpServer: HttpServer;
let io: Server;
let url: string;
const logged: { record: Record<string, unknown>; players: string }[] = [];

before(async () => {
  httpServer = createServer();
  io = new Server(httpServer);
  attachGin(io, {
    async resolveName() {
      return null;
    },
    logHand(record, players) {
      logged.push({ record: record as Record<string, unknown>, players });
    },
  });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

after(async () => {
  // Every client, not just the ones a passing test got round to closing: a
  // socket left open by a failed assertion keeps the event loop alive, and the
  // run hangs instead of reporting the failure.
  for (const c of clients) c.disconnect();
  await io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

const clients: ClientSocket[] = [];

function connect(): Promise<ClientSocket> {
  const socket = ioClient(`${url}/gin`, {
    transports: ['websocket'],
    forceNew: true,
    // Without this a client answers the server shutting down by retrying
    // forever, which is also a hang.
    reconnection: false,
  });
  clients.push(socket);
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

/** Resolves on the next `event`, or rejects after 3s so a hang names itself. */
function next<T = any>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), 3000);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** A seated pair with a hand dealt, which is the starting point for most tests. */
async function seatedPair() {
  const a = await connect();
  const b = await connect();
  const joinedA = next<{ code: string; playerId: string; seat: number }>(a, 'table_joined');
  a.emit('create_table');
  const infoA = await joinedA;

  const joinedB = next<{ code: string; playerId: string; seat: number }>(b, 'table_joined');
  b.emit('join_table', { code: infoA.code });
  const infoB = await joinedB;

  return { a, b, infoA, infoB };
}

async function deal(a: ClientSocket, b: ClientSocket) {
  const viewA = next<{ view: GinView }>(a, 'gin_view');
  const viewB = next<{ view: GinView }>(b, 'gin_view');
  a.emit('deal_hand');
  return { a: (await viewA).view, b: (await viewB).view };
}

describe('gin multiplayer', () => {
  it('seats two players at one table', async () => {
    const { a, b, infoA, infoB } = await seatedPair();
    assert.equal(infoA.code, infoB.code);
    assert.equal(infoA.seat, 0);
    assert.equal(infoB.seat, 1);
    a.disconnect();
    b.disconnect();
  });

  it('refuses a code that does not exist', async () => {
    const a = await connect();
    const err = next<{ message: string }>(a, 'gin_error');
    a.emit('join_table', { code: 'ZZZZ' });
    assert.match((await err).message, /no table/i);
    a.disconnect();
  });

  it('refuses a third player', async () => {
    const { a, b, infoA } = await seatedPair();
    const c = await connect();
    const err = next<{ message: string }>(c, 'gin_error');
    c.emit('join_table', { code: infoA.code });
    assert.match((await err).message, /full/i);
    a.disconnect();
    b.disconnect();
    c.disconnect();
  });

  it('deals each player their own hand and nothing else', async () => {
    const { a, b } = await seatedPair();
    const views = await deal(a, b);

    assert.equal(views.a.hand.length, 10);
    assert.equal(views.b.hand.length, 10);
    assert.equal(views.a.seat, 0);
    assert.equal(views.b.seat, 1);

    // The whole point of viewFor: neither hand appears in the other's view,
    // and the stock is a count, not a list.
    assert.equal(views.a.opponentHand, null);
    assert.equal(views.b.opponentHand, null);
    assert.equal(views.a.opponentCardCount, 10);
    assert.equal(typeof views.a.stockCount, 'number');
    assert.equal(JSON.stringify(views.a).includes('"stock"'), false);

    const aIds = new Set(views.a.hand.map((c) => `${c.suit}${c.rank}`));
    const shared = views.b.hand.filter((c) => aIds.has(`${c.suit}${c.rank}`));
    assert.deepEqual(shared, [], 'the two hands must be disjoint');

    a.disconnect();
    b.disconnect();
  });

  it('enforces turn order on the server, not in the UI', async () => {
    const { a, b } = await seatedPair();
    const views = await deal(a, b);
    assert.equal(views.a.yourTurn, true);
    assert.equal(views.b.yourTurn, false);

    // Seat 1 tries to move first anyway.
    const err = next<{ message: string }>(b, 'gin_error');
    b.emit('act', { type: 'draw', from: 'stock' });
    assert.match((await err).message, /not your turn/i);

    a.disconnect();
    b.disconnect();
  });

  it('rejects a malformed action without touching the hand', async () => {
    const { a, b } = await seatedPair();
    const before = (await deal(a, b)).a;

    const err = next<{ message: string }>(a, 'gin_error');
    a.emit('act', { type: 'discard', card: 'nonsense' });
    assert.match((await err).message, /made no sense/i);

    // And the hand is untouched: a fresh deal request would be refused, so ask
    // the server for the state by making a legal move and checking the count.
    const after = next<{ view: GinView }>(a, 'gin_view');
    a.emit('act', { type: 'draw', from: 'stock' });
    assert.equal((await after).view.hand.length, before.hand.length + 1);

    a.disconnect();
    b.disconnect();
  });

  it('passes the turn after a draw and a discard', async () => {
    const { a, b } = await seatedPair();
    await deal(a, b);

    // Both listeners go on before the emit. A draw updates BOTH views (the
    // opponent's stock count drops), so waiting for b's only afterwards is a
    // race: you can catch the draw's broadcast and read it as the discard's.
    const drawn = next<{ view: GinView }>(a, 'gin_view');
    const drawnB = next<{ view: GinView }>(b, 'gin_view');
    a.emit('act', { type: 'draw', from: 'stock' });
    const held = (await drawn).view;
    await drawnB;
    assert.equal(held.hand.length, 11);
    assert.equal(held.phase, 'discard');

    const thrown = held.hand[0];
    const afterA = next<{ view: GinView }>(a, 'gin_view');
    const afterB = next<{ view: GinView }>(b, 'gin_view');
    a.emit('act', { type: 'discard', card: `${thrown.suit}${thrown.rank}` });

    const seenByA = (await afterA).view;
    const seenByB = (await afterB).view;
    assert.equal(seenByA.hand.length, 10);
    assert.equal(seenByA.yourTurn, false);
    assert.equal(seenByB.yourTurn, true);
    assert.deepEqual(seenByB.discardTop, thrown, 'the thrown card is public');

    a.disconnect();
    b.disconnect();
  });

  it('gives a seat back to whoever holds its playerId', async () => {
    const { a, b, infoA } = await seatedPair();
    const dealt = (await deal(a, b)).a;

    a.disconnect();

    const again = await connect();
    const rejoined = next<{ seat: number }>(again, 'table_joined');
    const restored = next<{ view: GinView }>(again, 'gin_view');
    again.emit('rejoin_table', { code: infoA.code, playerId: infoA.playerId });

    assert.equal((await rejoined).seat, 0);
    assert.deepEqual((await restored).view.hand, dealt.hand, 'same cards, same seat');

    again.disconnect();
    b.disconnect();
  });

  it('will not hand a seat to someone with the wrong playerId', async () => {
    const { a, b, infoA } = await seatedPair();
    const intruder = await connect();
    const err = next<{ message: string }>(intruder, 'gin_error');
    intruder.emit('rejoin_table', { code: infoA.code, playerId: 'not-a-real-id' });
    assert.match((await err).message, /given up|gone/i);

    a.disconnect();
    b.disconnect();
    intruder.disconnect();
  });

  it('names each player what they typed, the same on both screens', async () => {
    const a = await connect();
    const b = await connect();
    const joined = next<{ code: string }>(a, 'table_joined');
    a.emit('create_table', { name: '  Ada\u0007  Lovelace  ' });
    const { code } = await joined;
    const seenByA = next<{ seats: { seat: number; name: string }[] }>(a, 'table_update');
    const seenByB = next<{ seats: { seat: number; name: string }[] }>(b, 'table_update');
    b.emit('join_table', { code, name: 'Ada Lovelace' });
    const [ta, tb] = [await seenByA, await seenByB];
    assert.deepEqual(ta.seats, tb.seats, 'one table, one set of names');
    assert.deepEqual(
      ta.seats.map((s) => s.name),
      ['Ada Lovelace', 'Ada Lovelace 2'],
      'cleaned, and never two of the same'
    );
    a.disconnect();
    b.disconnect();
  });

  it('alternates who opens, keeps each score with its player, and hands over the replay only at the end', async () => {
    const { a, b } = await seatedPair();
    const first = await deal(a, b);
    assert.equal(first.a.yourTurn, true, 'the host opens the first hand');
    assert.equal(first.b.yourTurn, false);

    // Play the hand out on stock draws and first-card throws until it ends.
    const finish = async () => {
      let views = { a: first.a, b: first.b };
      let replay: any = null;
      for (let guard = 0; guard < 200; guard++) {
        const mover = views.a.yourTurn ? a : views.b.yourTurn ? b : null;
        if (!mover) break;
        const view = mover === a ? views.a : views.b;
        const va = next<{ view: GinView; replay?: unknown }>(a, 'gin_view');
        const vb = next<{ view: GinView; replay?: unknown }>(b, 'gin_view');
        if (view.phase === 'draw') mover.emit('act', { type: 'draw', from: 'stock' });
        else mover.emit('act', { type: 'discard', card: `${view.hand[0].suit}${view.hand[0].rank}` });
        const [pa, pb] = [await va, await vb];
        views = { a: pa.view, b: pb.view };
        if (pa.view.phase !== 'over') assert.equal(pa.replay, undefined, 'no seed while the hand is live');
        else replay = { a: pa.replay, b: pb.replay };
      }
      return { views, replay };
    };

    const { views, replay } = await finish();
    assert.equal(views.a.phase, 'over');
    const entry = logged.find((l) => l.record.seed === replay.a.seed);
    assert.ok(entry, 'the finished hand is logged');
    assert.equal(entry!.record.level, 'human');
    assert.deepEqual(entry!.record.players, ['Guest', 'Guest 2'], 'players by engine seat, opener first');
    assert.equal(entry!.players, 'Guest vs Guest 2');
    assert.equal(replay.a.seed, replay.b.seed);
    assert.equal(replay.a.humanSeat, 0);
    assert.equal(replay.b.humanSeat, 1);
    assert.ok(replay.a.history.length > 0);

    const second = await deal(a, b);
    assert.equal(second.b.yourTurn, true, 'the guest opens the second hand');
    assert.equal(second.a.yourTurn, false);
    assert.equal(second.b.seat, 0, 'by sitting in the engine seat that moves first');

    a.disconnect();
    b.disconnect();
  });

  it('lets the host set the target, including no target at all', async () => {
    const a = await connect();
    const joined = next<{ code: string }>(a, 'table_joined');
    const firstInfo = next<{ target: number | null; host: boolean }>(a, 'table_update');
    a.emit('create_table', { target: 250 });
    await joined;
    const info = await firstInfo;
    assert.equal(info.target, 250);
    assert.equal(info.host, true);

    const changed = next<{ target: number | null }>(a, 'table_update');
    a.emit('set_target', { target: null });
    assert.equal((await changed).target, null);

    const bad = next<{ message: string }>(a, 'gin_error');
    a.emit('set_target', { target: 'lots' });
    assert.match((await bad).message, /not a target/i);
    a.disconnect();
  });

  it('ends the match at the target, and the next deal starts a new one', async () => {
    const a = await connect();
    const b = await connect();
    const joined = next<{ code: string }>(a, 'table_joined');
    a.emit('create_table', { target: 10 });
    const { code } = await joined;
    const seated = next(b, 'table_joined');
    b.emit('join_table', { code });
    await seated;

    type Info = { running: [number, number]; matchWinner: number | null; handsPlayed: number };
    // A box, not a bare let: TypeScript cannot see the listener assign it.
    const seen: { info: Info | null } = { info: null };
    a.on('table_update', (i: Info) => (seen.info = i));

    // Knock the moment it is legal, throw the costliest card otherwise.
    for (let hand = 0; hand < 30 && seen.info?.matchWinner == null; hand++) {
      let views = await deal(a, b);
      for (let guard = 0; guard < 200 && views.a.phase !== 'over'; guard++) {
        const mover = views.a.yourTurn ? a : b;
        const view = mover === a ? views.a : views.b;
        const va = next<{ view: GinView }>(a, 'gin_view');
        const vb = next<{ view: GinView }>(b, 'gin_view');
        if (view.phase === 'draw') mover.emit('act', { type: 'draw', from: 'stock' });
        else {
          const knock = knockOptions(view.hand).find((k) => k.legal);
          const id = (c: { suit: string; rank: number }) => `${c.suit}${c.rank}`;
          if (knock) mover.emit('act', { type: 'knock', discard: id(knock.discard) });
          else mover.emit('act', { type: 'discard', card: id(view.deadwood[view.deadwood.length - 1] ?? view.hand[0]) });
        }
        views = { a: (await va).view, b: (await vb).view };
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    const done = seen.info;
    assert.ok(done && done.matchWinner !== null, 'somebody reached 10');
    assert.ok(done!.running[done!.matchWinner!] >= 10);

    const fresh = next<Info>(a, 'table_update');
    a.emit('deal_hand');
    const restarted = await fresh;
    assert.deepEqual(restarted.running, [0, 0], 'a new match starts from nothing');
    assert.equal(restarted.matchWinner, null);
    a.disconnect();
    b.disconnect();
  });

  it('abandons the hand when a player leaves for good', async () => {
    const { a, b } = await seatedPair();
    await deal(a, b);

    const told = next<{ message: string }>(b, 'gin_error');
    const table = next<{ inHand: boolean; seats: unknown[] }>(b, 'table_update');
    a.emit('leave_table');

    assert.match((await told).message, /abandoned/i);
    const info = await table;
    assert.equal(info.inHand, false);
    assert.equal(info.seats.length, 1);

    a.disconnect();
    b.disconnect();
  });
});
