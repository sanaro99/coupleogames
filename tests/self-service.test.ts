import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';
import { hashToken } from '../server/access.js';
import { creatorInvitations } from '../shared/invitations.js';

const origin = 'http://localhost:5173';
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });
async function app(maxRooms = 100) {
  const repository = new Store(':memory:');
  const value = await createApp({ databasePath: ':memory:', origin, production: false, maxRooms }, { repository });
  closers.push(value.close);
  return { ...value, repository };
}

it('creates a room, authenticates its creator and issues a separate partner seat', async () => {
  const a = await app();
  const created = await a.http.inject({ method: 'POST', url: '/api/rooms', headers: { origin }, payload: {} });
  expect(created.statusCode).toBe(201);
  const { room, invitations } = created.json();
  expect(room.seat).toBe(0);
  expect(room.setup).toBe(false);
  expect(invitations.creatorKey).not.toBe(invitations.partnerKey);
  expect(creatorInvitations(invitations.creatorKey)).toEqual(invitations);
  expect(await a.repository.findInvitation(invitations.creatorKey)).toBeNull();
  expect(await a.repository.findInvitation(invitations.partnerKey)).toBeNull();
  expect(await a.repository.findInvitation(hashToken(invitations.creatorKey))).toMatchObject({roomId:room.roomId,seat:0});
  expect(await a.repository.findInvitation(hashToken(invitations.partnerKey))).toMatchObject({roomId:room.roomId,seat:1});
  const cookie = created.headers['set-cookie'] as string;
  expect(cookie).toContain('HttpOnly');
  const session=await a.http.inject({ url: '/api/session', headers: { cookie } });
  expect(session.json().roomId).toBe(room.roomId);
  expect(session.body).not.toContain(invitations.creatorKey);
  expect(session.body).not.toContain(invitations.partnerKey);
  const recovered=await a.http.inject({url:'/api/invitations',headers:{cookie}});
  expect(recovered.statusCode).toBe(200);
  expect(recovered.json().invitations).toEqual(invitations);
  expect(recovered.headers['cache-control']).toBe('no-store');
  const partner = await a.http.inject({ method: 'POST', url: '/api/login', headers: { origin }, payload: { key: invitations.partnerKey } });
  expect(partner.json()).toMatchObject({ roomId: room.roomId, seat: 1 });
  expect((await a.http.inject({url:'/api/invitations',headers:{cookie:partner.headers['set-cookie'] as string}})).json().invitations).toBeNull();
  expect((await a.http.inject('/api/invitations')).statusCode).toBe(401);
  const forged=`couple_session=cogs1.${'a'.repeat(43)}.${invitations.creatorKey}`;
  expect((await a.http.inject({url:'/api/invitations',headers:{cookie:forged}})).statusCode).toBe(401);
  const creator = await a.http.inject({ method: 'POST', url: '/api/login', headers: { origin }, payload: { key: invitations.creatorKey } });
  expect(creator.json()).toMatchObject({ roomId: room.roomId, seat: 0 });
  const other = await a.http.inject({ method: 'POST', url: '/api/rooms', headers: { origin }, payload: {} });
  expect(other.json().room.roomId).not.toBe(room.roomId);
});

it('releases active room capacity and hides internal errors when creator sign-in fails', async () => {
  const a=await app(1);
  vi.spyOn(a.repository,'replaceSession').mockRejectedValueOnce(new Error('private database detail'));
  const rejected=await a.http.inject({method:'POST',url:'/api/rooms',headers:{origin},payload:{}});
  expect(rejected.statusCode).toBe(500);
  expect(rejected.body).not.toContain('private database detail');
  expect(rejected.json().invitations).toBeUndefined();
  expect(rejected.headers['set-cookie']).toBeUndefined();
  expect((await a.repository.listRooms()).filter(room=>room.status==='active')).toHaveLength(0);
  expect((await a.http.inject({method:'POST',url:'/api/rooms',headers:{origin},payload:{}})).statusCode).toBe(201);
});

it('rejects cross-site creation, forged fields and duplicate creation from an existing seat', async () => {
  const a = await app();
  for (const headers of [{}, { origin: 'https://other.example' }, { origin, 'sec-fetch-site': 'cross-site' }]) {
    expect((await a.http.inject({ method: 'POST', url: '/api/rooms', headers, payload: {} })).statusCode).toBe(403);
  }
  expect((await a.http.inject({ method: 'POST', url: '/api/rooms', headers: { origin }, payload: { seat: 1 } })).statusCode).toBe(400);
  const first = await a.http.inject({ method: 'POST', url: '/api/rooms', headers: { origin }, payload: {} });
  expect(first.statusCode).toBe(201);
  expect((await a.http.inject({ method: 'POST', url: '/api/rooms', headers: { origin, cookie: first.headers['set-cookie'] as string }, payload: {} })).statusCode).toBe(409);
  expect(await a.repository.listRooms()).toHaveLength(1);
});

it('enforces room capacity without issuing credentials for rejected rooms', async () => {
  const a = await app(1);
  expect((await a.http.inject({ method: 'POST', url: '/api/rooms', headers: { origin }, payload: {} })).statusCode).toBe(201);
  const rejected = await a.http.inject({ method: 'POST', url: '/api/rooms', headers: { origin }, payload: {} });
  expect(rejected.statusCode).toBe(429);
  expect(rejected.json().invitations).toBeUndefined();
  expect(await a.repository.listRooms()).toHaveLength(1);
});

it('limits anonymous creation without allowing spoofed forwarded addresses to bypass the limit', async () => {
  const a = await app();
  let response;
  for (let i = 0; i < 6; i++) response = await a.http.inject({ method: 'POST', url: '/api/rooms', headers: { origin, 'x-forwarded-for': `192.0.2.${i + 1}` }, payload: {} });
  expect(response!.statusCode).toBe(429);
  expect(await a.repository.listRooms()).toHaveLength(5);
});

it('bounds creation across distinct clients as well as per-client quotas', async () => {
  const a=await app();
  let response;
  for(let i=0;i<31;i++) response=await a.http.inject({method:'POST',url:'/api/rooms',remoteAddress:`192.0.2.${i+1}`,headers:{origin},payload:{}});
  expect(response!.statusCode).toBe(429);
  expect(await a.repository.listRooms()).toHaveLength(30);
});
