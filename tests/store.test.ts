import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from '../server/store.js';
import { createMatch } from '../server/engine.js';

const paths: string[] = []; const stores: Store[] = [];
afterEach(async () => { for (const s of stores.splice(0)) await s.close(); for (const p of paths.splice(0)) rmSync(p, { recursive: true, force: true }); });
function dbPath() { const p = mkdtempSync(join(tmpdir(), 'cog-store-')); paths.push(p); return join(p, 'test.sqlite'); }
function store(path = dbPath()) { const s = new Store(path); stores.push(s); return s; }
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const provision = (s: Store, id: string, maxRooms = 100) => s.createRoom({ roomId: id, invitationHashes: [hash(`${id}-0`), hash(`${id}-1`)], maxRooms, now: 1000 });

describe('room repository', () => {
  it('scopes_names_snapshots_and_records', async () => {
    const s = store(); const a = await provision(s, 'a'); const b = await provision(s, 'b');
    const m = createMatch('sync', 1000); m.id = 'same-id'; m.phase = 'finished'; m.outcome = { winner: 'together', score: 4, success: true }; m.scores = [4, 4];
    await s.saveRoom(a.id, 0, { names: ['Ada', 'Bea'], setup: true, snapshot: { match: m, proposal: null, leaveVotes: [false, false] } }, 2000);
    m.scores = [1, 1]; m.outcome = { winner: 'none', score: 1, success: false };
    await s.saveRoom(b.id, 0, { names: ['Cal', 'Dee'], setup: true, snapshot: { match: m, proposal: null, leaveVotes: [true, false] } }, 3000);
    expect((await s.getRoom('a'))?.names).toEqual(['Ada', 'Bea']); expect((await s.getRoom('b'))?.names).toEqual(['Cal', 'Dee']);
    expect((await s.getRecords('a'))[0].scores).toEqual([4, 4]); expect((await s.getRecords('b'))[0].scores).toEqual([1, 1]);
    expect(await s.getRoom('missing')).toBeNull(); expect(await s.getRecords('missing')).toEqual([]);
  });
  it('records_finished_match_once_preserving_timestamp', async () => {
    const s = store(); const r = await provision(s, 'a'); const match = createMatch('sync', 1000); match.phase = 'finished'; match.outcome = { winner: 'draw', score: 0, success: true };
    const next = { names: r.names, setup: true, snapshot: { ...r.snapshot, match } };
    await s.saveRoom('a', 0, next, 2000); await s.saveRoom('a', 1, next, 9000);
    expect(await s.getRecords('a')).toHaveLength(1); expect((await s.getRecords('a'))[0].finishedAt).toBe(2000);
  });
  it('rejects_stale_revision_without_partial_write', async () => {
    const s = store(); const a = await provision(s, 'a'); const next = { names: ['Ada', 'Bea'] as [string,string], setup: true, snapshot: a.snapshot };
    await s.saveRoom('a', 0, next, 2000);
    await expect(s.saveRoom('a', 0, { ...next, names: ['Wrong', 'Wrong'] }, 3000)).rejects.toThrow('changed');
    expect((await s.getRoom('a'))?.names).toEqual(['Ada', 'Bea']); expect((await s.getRoom('a'))?.revision).toBe(1);
  });
  it('rolls_back_snapshot_when_result_write_fails', async () => {
    const path = dbPath(); const s = store(path); const a = await provision(s, 'a');
    const raw = new DatabaseSync(path); raw.exec("CREATE TRIGGER fail_record BEFORE INSERT ON room_records BEGIN SELECT RAISE(ABORT, 'disk failed'); END;"); raw.close();
    const match = createMatch('sync', 1000); match.phase = 'finished'; match.outcome = { winner: 'none', score: 0, success: false };
    await expect(s.saveRoom('a', 0, { names: ['Wrong', 'Wrong'], setup: true, snapshot: { ...a.snapshot, match } }, 2000)).rejects.toThrow();
    expect((await s.getRoom('a'))?.revision).toBe(0); expect((await s.getRoom('a'))?.snapshot.match).toBeNull(); expect(await s.getRecords('a')).toEqual([]);
  });
  it('rejects_invalid_or_missing_seats', async () => {
    const path = dbPath(); const s = store(path); await provision(s, 'a'); const raw = new DatabaseSync(path); raw.exec('PRAGMA foreign_keys=ON');
    expect(() => raw.prepare('INSERT INTO room_seats VALUES (?,?,?,?)').run('a', 2, hash('third'), 1)).toThrow();
    expect(() => raw.prepare('INSERT INTO room_sessions VALUES (?,?,?,?,?,?)').run(hash('token'), 'absent', 0, 1, 1000, 2000)).toThrow(); raw.close();
    await expect(s.createRoom({ roomId: 'bad', invitationHashes: [hash('same'), hash('same')], maxRooms: 100, now: 1000 })).rejects.toThrow();
    expect(await s.getRoom('bad')).toBeNull();
  });
  it('enforces_creation_cap_under_competing_connections', async () => {
    const path = dbPath(); const one = store(path); const two = store(path);
    const results = await Promise.allSettled([provision(one, 'a', 1), provision(two, 'b', 1)]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect(await one.listRooms()).toHaveLength(1);
    await one.disableRoom('a', 2000); await provision(two, 'b', 1); expect(await one.listRooms()).toHaveLength(2);
  });
  it.each(['legacy', 'unknown', 'newer'])('refuses %s schema without changing it', async kind => {
    const path = dbPath(); const raw = new DatabaseSync(path);
    raw.exec(kind === 'legacy' ? 'CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT); CREATE TABLE records(id TEXT); CREATE TABLE sessions(token TEXT)' : kind === 'newer' ? 'CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,completed_at INTEGER); INSERT INTO schema_migrations VALUES(999,0)' : 'CREATE TABLE unknown(value TEXT)'); raw.close();
    expect(() => store(path)).toThrow(/schema|migrat/i);
    const check = new DatabaseSync(path); expect(check.prepare("SELECT name FROM sqlite_master WHERE name='rooms'").get()).toBeUndefined(); check.close();
  });
});
