import { afterEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { AccessService } from '../server/access.js';
import { WindowLimiter, defaultLimits, limitsFromEnv } from '../server/limits.js';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const stores: Store[] = [];
afterEach(async () => { for (const s of stores.splice(0)) await s.close(); });
async function fixture(cap = 5) {
  const store = new Store(':memory:'); stores.push(store); const ids = [randomUUID(), randomUUID()]; const keys = ['a0'.repeat(20), 'a1'.repeat(20), 'b0'.repeat(20), 'b1'.repeat(20)];
  for (let i = 0; i < 2; i++) await store.createRoom({ roomId: ids[i], invitationHashes: [hash(keys[i*2]), hash(keys[i*2+1])], maxRooms: 100, now: 1000 });
  return { store, ids, keys, access: new AccessService(store, cap) };
}
describe('scoped access', () => {
  it('invitation_selects_room_and_fixed_seat', async () => {
    const f = await fixture();
    for (let i = 0; i < 4; i++) { const s = await f.access.login(f.keys[i], undefined, 1000); expect(s.access.roomId).toBe(f.ids[Math.floor(i/2)]); expect(s.access.seat).toBe(i%2); expect(await f.access.resolve(s.token, 1001)).toEqual(s.access); expect(s.token).toHaveLength(43); expect(s.access.sessionHash).not.toBe(s.token); }
    expect(await f.access.resolve('fake', 1000)).toBeNull(); await expect(f.access.login('fake', undefined, 1000)).rejects.toThrow('invitation');
  });
  it('replacement_revokes_only_previous_session', async () => {
    const f = await fixture(); const old = await f.access.login(f.keys[0], undefined, 1000); const device = await f.access.login(f.keys[0], undefined, 1000);
    const next = await f.access.login(f.keys[2], old.token, 2000);
    expect(await f.access.resolve(old.token, 2000)).toBeNull(); expect(await f.access.resolve(device.token, 2000)).not.toBeNull(); expect((await f.access.resolve(next.token, 2000))?.roomId).toBe(f.ids[1]);
    await f.access.logout(next.token); expect(await f.access.resolve(next.token, 2000)).toBeNull();
  });
  it('failed_login_preserves_previous_session', async () => {
    const f = await fixture(); const s = await f.access.login(f.keys[0], undefined, 1000); await expect(f.access.login('invalid', s.token, 2000)).rejects.toThrow(); expect(await f.access.resolve(s.token, 2000)).not.toBeNull();
  });
  it('rotation_revokes_only_selected_seat', async () => {
    const f = await fixture(); const a = await f.access.login(f.keys[0], undefined, 1000); const b = await f.access.login(f.keys[1], undefined, 1000); const other = await f.access.login(f.keys[2], undefined, 1000);
    await f.store.rotateSeat(f.ids[0], 0, hash('fresh'), 2000);
    expect(await f.access.resolve(a.token, 2000)).toBeNull(); expect(await f.access.resolve(b.token, 2000)).not.toBeNull(); expect(await f.access.resolve(other.token, 2000)).not.toBeNull(); await expect(f.access.login(f.keys[0], undefined, 2000)).rejects.toThrow();
    expect((await f.access.login('fresh', undefined, 2000)).access.credentialVersion).toBe(2);
  });
  it('disable_denies_both_seats_preserving_data', async () => {
    const f = await fixture(); const a = await f.access.login(f.keys[0], undefined, 1000); const b = await f.access.login(f.keys[1], undefined, 1000);
    await f.store.disableRoom(f.ids[0], 2000); expect(await f.access.resolve(a.token, 2000)).toBeNull(); expect(await f.access.resolve(b.token, 2000)).toBeNull(); expect(await f.store.getRoom(f.ids[0])).not.toBeNull(); await expect(f.access.login(f.keys[0], undefined, 2000)).rejects.toThrow();
  });
  it('session_cap_is_atomic_and_replacement_at_capacity_works', async () => {
    const f = await fixture(1); const attempts = await Promise.allSettled([f.access.login(f.keys[0], undefined, 1000), f.access.login(f.keys[0], undefined, 1000)]); expect(attempts.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    const first = (attempts[0] as PromiseFulfilledResult<Awaited<ReturnType<AccessService['login']>>>).value;
    const next = await f.access.login(f.keys[0], first.token, 2000); expect(await f.access.resolve(first.token, 2000)).toBeNull(); expect(await f.access.resolve(next.token, 2000)).not.toBeNull();
    const expiry = 2000 + 30 * 86400000; expect(await f.access.resolve(next.token, expiry)).toBeNull(); await expect(f.access.login(f.keys[0], undefined, expiry)).resolves.toBeDefined();
  });
  it('limiter_expires_and_bounds_keys', () => {
    const l = new WindowLimiter(2, 1000, 2); expect(l.consume('a', 0)).toBe(true); expect(l.consume('a', 1)).toBe(true); expect(l.consume('a', 2)).toBe(false); expect(l.consume('b', 2)).toBe(true); expect(l.consume('c', 3)).toBe(false); expect(l.consume('c', 1000)).toBe(true); expect(l.consume('b', 1002)).toBe(true);
  });
  it('defaults_allow_five_sessions_and_three_sockets_and_refuse_the_sixth_session', async () => {
    expect(limitsFromEnv({})).toEqual(defaultLimits);
    expect(defaultLimits).toEqual({ maxRooms: 100, maxSessionsPerSeat: 5, maxSocketsPerSession: 3 });
    const f = await fixture();
    for (let i = 0; i < 5; i++) await f.access.login(f.keys[0], undefined, 1000);
    await expect(f.access.login(f.keys[0], undefined, 1000)).rejects.toMatchObject({ statusCode: 429 });
    await expect(f.access.login(f.keys[1], undefined, 1000)).resolves.toBeDefined();
    for (const value of ['0', '-1', '1.5', 'NaN', '']) expect(() => limitsFromEnv({ MAX_ROOMS: value })).toThrow();
  });
});
