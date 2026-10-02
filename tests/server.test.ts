import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { createApp, type AppConfig } from '../server/app.js';
import { Store } from '../server/store.js';
import { createMatch } from '../server/engine.js';
import type { RoomState } from '../shared/types.js';
import { provisionRooms } from './support/rooms.js';
const temporary: string[] = []; const closers: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of closers.splice(0)) await close(); for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });
async function config(): Promise<AppConfig & { keys: string[]; roomId: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'coupleogames-')); temporary.push(dir);
  const databasePath=join(dir,'test.sqlite'); const store=new Store(databasePath); const seeded=await provisionRooms(store); await store.close();
  return { databasePath, keys: seeded.keys.slice(0,2), roomId:seeded.ids[0], origin:'http://localhost:5173',production:false };
}
const wait = <T>(socket: Socket, event: string, accepts: (value: T) => boolean = () => true) => new Promise<T>((resolve, reject) => {
  const receive = (value: T) => { if (accepts(value)) { clearTimeout(t); socket.off(event, receive); resolve(value); } };
  const t = setTimeout(() => { socket.off(event, receive); reject(new Error(`Timed out: ${event}`)); }, 3000);
  socket.on(event, receive);
});
describe('private two-seat HTTP boundary', () => {
  it('protects names and records, maps keys to fixed seats, and rejects forged origins', async () => {
    const c = await config(); const app = await createApp(c); closers.push(app.close);
    expect((await app.http.inject('/api/session')).statusCode).toBe(401);
    expect((await app.http.inject({ method: 'POST', url: '/api/login', headers:{origin:c.origin}, payload: { key: 'bad' } })).statusCode).toBe(401);
    expect((await app.http.inject({method:'POST',url:'/api/login',headers:{origin:c.origin},payload:{key:c.keys[0],seat:1}})).statusCode).toBe(400);
    const login = await app.http.inject({ method: 'POST', url: '/api/login', headers:{origin:c.origin}, payload: { key: c.keys[0] } });
    expect(login.json().seat).toBe(0); const cookie = login.headers['set-cookie'] as string;
    const names = await app.http.inject({ method: 'POST', url: '/api/setup', headers: { cookie, origin: 'https://unrelated.example' }, payload: { names: ['Other', 'People'] } });
    expect(names.statusCode).toBe(403);
    const setup = await app.http.inject({ method: 'POST', url: '/api/setup', headers: { cookie,origin:c.origin }, payload: { names: ['Ada', 'Bea'] } });
    expect(setup.statusCode).toBe(200);
    expect((await app.http.inject({ url: '/api/session', headers: { cookie } })).json().names).toEqual(['Ada', 'Bea']);
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict');
    const invitation = await app.http.inject({ url: '/api/invite', headers: { cookie } });
    expect(invitation.body).not.toContain(c.keys[1]); expect(invitation.json().url).toBe('http://localhost:5173/');
    await app.http.inject({ method: 'POST', url: '/api/logout', headers: { cookie,origin:c.origin },payload:{} });
    expect((await app.http.inject({ url: '/api/session', headers: { cookie } })).statusCode).toBe(401);
  });
  it('restores names and paused active play after restart and saves a result once', async () => {
    const c = await config(); const first = new Store(c.databasePath);
    const m = createMatch('doodle', 1000); m.scores = [4, 4]; m.outcome = { winner: 'together', success: true, score: 4 }; m.phase = 'finished';
    const snapshot = { match: m, proposal: null, leaveVotes: [false, false] as [boolean, boolean] };
    await first.saveRoom(c.roomId,0,{names:['Ada','Bea'],setup:true,snapshot},2000); await first.saveRoom(c.roomId,1,{names:['Ada','Bea'],setup:true,snapshot},2001); expect(await first.getRecords(c.roomId)).toHaveLength(1);
    const active = createMatch('doodle', 3000); await first.saveRoom(c.roomId,2,{names:['Ada','Bea'],setup:true,snapshot:{...snapshot,match:active}},3000); await first.close();
    const second = new Store(c.databasePath); expect((await second.getRoom(c.roomId))?.names).toEqual(['Ada', 'Bea']); expect((await second.getRoom(c.roomId))?.snapshot.match?.id).toBe(active.id); await second.close();
    const restarted = await createApp(c); closers.push(restarted.close);
    const login = await restarted.http.inject({ method: 'POST', url: '/api/login', headers:{origin:c.origin}, payload: { key: c.keys[0] } });
    expect(login.json().match.id).toBe(active.id); expect(login.json().match.paused).toBe(true); expect(login.json().match.deadline).toBeNull(); expect(login.json().match.remainingMs).toBe(60000);
  });
  it('authenticates sockets and keeps partner answers private through reconnect', async () => {
    const c = await config(); const app = await createApp(c); closers.push(app.close);
    await app.http.listen({ host: '127.0.0.1', port: 0 }); const address = app.http.server.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    const anonymous = io(url, { transports: ['websocket'], extraHeaders: { origin: c.origin }, reconnection: false });
    expect((await wait<Error>(anonymous, 'connect_error')).message).toContain('private'); anonymous.disconnect();
    const sockets: Socket[] = []; const cookies: string[] = [];
    for (const key of c.keys) {
      const r = await app.http.inject({ method: 'POST', url: '/api/login', headers:{origin:c.origin}, payload: { key } });
      cookies.push(r.headers['set-cookie'] as string);
      const s = io(url, { transports: ['websocket'], extraHeaders: { cookie: r.headers['set-cookie'] as string, origin: c.origin }, reconnection: false });
      await wait<RoomState>(s, 'state'); sockets.push(s);
    }
    closers.unshift(async () => { sockets.forEach(s => s.disconnect()); });
    const emit = (s: Socket, event: string, value: unknown) => new Promise<{ ok: boolean; error?: string }>(r => s.emit(event, value, r));
    await emit(sockets[0], 'setup', { names: ['Ada', 'Bea'] });
    await emit(sockets[0], 'propose', { game: 'doodle' });
    const old = (await app.http.inject({ url: '/api/session', headers: { cookie: cookies[0] } })).json().proposal;
    await emit(sockets[0], 'propose', { game: 'sync' });
    const proposal = (await app.http.inject({ url: '/api/session', headers: { cookie: cookies[0] } })).json().proposal;
    expect((await emit(sockets[0], 'ready', { proposalId: old.id })).ok).toBe(false);
    await emit(sockets[0], 'ready', { proposalId: proposal.id }); const start = wait<RoomState>(sockets[1], 'state', s => s.match !== null); await emit(sockets[1], 'ready', { proposalId: proposal.id }); const state = await start;
    const m = state.match!; expect(m.game).toBe('sync');
    expect((await emit(sockets[0], 'leave', { matchId: 'an-older-match' })).ok).toBe(false);
    const update = wait<RoomState>(sockets[1], 'state', s => s.match?.partnerAnswered === true);
    await emit(sockets[0], 'action', { id: 'private-answer', matchId: m.id, round: 0, phase: 'play', type: 'answer', text: 'secret-snack' });
    expect(JSON.stringify(await update)).not.toContain('secret-snack');
    const reconnect = wait<RoomState>(sockets[0], 'state', s => s.match?.paused === true); sockets[1].disconnect(); expect((await reconnect).match?.paused).toBe(true);
  });
  it('disconnects expired sessions before sending new private state', async () => {
    const c = await config(); const app = await createApp(c); closers.push(app.close); await app.http.listen({ host: '127.0.0.1', port: 0 });
    const address = app.http.server.address(); const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    const first = await app.http.inject({ method: 'POST', url: '/api/login', headers:{origin:c.origin}, payload: { key: c.keys[0] } });
    const s = io(url, { transports: ['websocket'], extraHeaders: { cookie: first.headers['set-cookie'] as string, origin: c.origin }, reconnection: false });
    closers.unshift(async () => { s.disconnect(); }); await wait(s, 'state');
    const future = Date.now() + 31 * 86400000; vi.spyOn(Date, 'now').mockReturnValue(future);
    const disconnected = wait<string>(s, 'disconnect');
    const second = await app.http.inject({ method: 'POST', url: '/api/login', headers:{origin:c.origin}, payload: { key: c.keys[1] } });
    const fresh = io(url, { transports: ['websocket'], extraHeaders: { cookie: second.headers['set-cookie'] as string, origin: c.origin }, reconnection: false });
    closers.unshift(async () => { fresh.disconnect(); });
    expect(await disconnected).toBe('io server disconnect'); expect(s.connected).toBe(false);
  });
});
