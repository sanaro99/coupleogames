import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createMatch } from '../server/engine.js';
import { migrateLegacy } from '../server/migrations.js';
import { Store } from '../server/store.js';
import { hashToken } from '../server/access.js';
const paths:string[]=[];afterEach(()=>{vi.restoreAllMocks();for(const p of paths.splice(0))rmSync(p,{recursive:true,force:true});});
function fixture(names=true,finished=false) {
  const dir=mkdtempSync(join(tmpdir(),'cog-migrate-'));paths.push(dir);const databasePath=join(dir,'legacy.sqlite');const db=new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE records(id TEXT PRIMARY KEY,finished_at INTEGER NOT NULL,value TEXT NOT NULL); CREATE TABLE sessions(token TEXT PRIMARY KEY,seat INTEGER NOT NULL,expires INTEGER NOT NULL);');
  if(names)db.prepare('INSERT INTO settings VALUES(?,?)').run('names',JSON.stringify(['Ada','Bea']));
  const recordMatch=createMatch('sync',1000);const record={id:recordMatch.id,game:'sync',finishedAt:1234,outcome:{winner:'together',score:4,success:true},scores:[4,4],bestStreak:4};db.prepare('INSERT INTO records VALUES(?,?,?)').run(record.id,1234,JSON.stringify(record));
  const match=finished?{...recordMatch,phase:'finished',outcome:record.outcome,scores:[4,4],bestStreak:4}:createMatch('doodle',1000);
  const proposal={id:crypto.randomUUID(),game:'sync',ready:[true,true]};db.prepare('INSERT INTO settings VALUES(?,?)').run('room',JSON.stringify({match,proposal,leaveVotes:[true,false],savedAt:21000}));db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hashToken('old-cookie'),0,Date.now()+86400000);db.close();
  return {databasePath,backupPath:join(dir,'backup.sqlite'),outputPath:join(dir,'private.html'),legacyNameDefaults:['Default Ada','Default Bea'] as [string,string],now:100000,record,match,proposal};
}
describe('explicit legacy preservation',()=>{
  it('imports exact names history and checkpoint, rejects old access, and archives tables',async()=>{
    const f=fixture();const result=await migrateLegacy(f);const store=new Store(f.databasePath);const room=(await store.getRoom(result.roomId))!;expect(room.names).toEqual(['Ada','Bea']);expect(room.setup).toBe(true);expect(await store.getRecords(result.roomId)).toEqual([f.record]);expect(room.snapshot.match).toMatchObject({id:f.match.id,paused:true,deadline:null,remainingMs:40000});expect(room.snapshot.proposal?.ready).toEqual([false,false]);expect(room.snapshot.proposal?.id).not.toBe(f.proposal.id);expect(room.snapshot.leaveVotes).toEqual([true,false]);expect(await store.resolveSession(hashToken('old-cookie'),f.now)).toBeNull();expect(await store.findInvitation(hashToken('old-site-key'))).toBeNull();await store.close();
    const db=new DatabaseSync(f.databasePath);expect(db.prepare('SELECT count(*) AS n FROM legacy_records_v1').get()!.n).toBe(1);expect(db.prepare('SELECT count(*) AS n FROM legacy_sessions_v1').get()!.n).toBe(1);expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);db.close();expect([...readFileSync(f.outputPath,'utf8').matchAll(/#invite=/g)]).toHaveLength(2);
  });
  it('backup_restores_legacy_values including uncheckpointed WAL-backed writes', async () => {
    const f = fixture();
    // Keep a connection open so its committed WAL is not checkpointed on close.
    const writer = new DatabaseSync(f.databasePath);
    writer.exec('PRAGMA wal_autocheckpoint=0');
    writer.prepare("UPDATE settings SET value=? WHERE key='names'").run(JSON.stringify(['WAL Ada', 'WAL Bea']));
    expect(existsSync(f.databasePath + '-wal')).toBe(true);
    try {
      await migrateLegacy(f);
      const backup = new DatabaseSync(f.backupPath);
      try {
        expect(backup.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok');
        expect(JSON.parse(String(backup.prepare("SELECT value FROM settings WHERE key='names'").get()!.value))).toEqual(['WAL Ada', 'WAL Bea']);
        expect(JSON.parse(String(backup.prepare('SELECT value FROM records').get()!.value))).toEqual(f.record);
      } finally { backup.close(); }
    } finally { writer.close(); }
  });
  it('preserves environment default names with incomplete setup and finished timestamp',async()=>{const f=fixture(false,true);const result=await migrateLegacy(f);const s=new Store(f.databasePath);expect((await s.getRoom(result.roomId))?.names).toEqual(['Default Ada','Default Bea']);expect((await s.getRoom(result.roomId))?.setup).toBe(false);expect(await s.getRecords(result.roomId)).toEqual([f.record]);await s.close();});
  it('migration_rerun_refuses_duplicate_room',async()=>{const f=fixture();const result=await migrateLegacy(f);await expect(migrateLegacy({...f,backupPath:f.backupPath+'-new',outputPath:f.outputPath+'-new'})).rejects.toThrow(/already|migrat/i);expect(existsSync(f.backupPath+'-new')).toBe(false);const s=new Store(f.databasePath);expect((await s.listRooms()).map(r=>r.id)).toEqual([result.roomId]);await s.close();});
  it.each(['corrupt','unknown'])('refuses %s data without any partial migration',async kind=>{const f=fixture();const db=new DatabaseSync(f.databasePath);if(kind==='corrupt')db.prepare("UPDATE settings SET value=? WHERE key='room'").run('{"match":{}}');else db.exec('CREATE TABLE unexpected(value TEXT)');db.close();await expect(migrateLegacy(f)).rejects.toThrow();const check=new DatabaseSync(f.databasePath);expect(check.prepare("SELECT name FROM sqlite_master WHERE name='rooms'").get()).toBeUndefined();check.close();expect(existsSync(f.outputPath)).toBe(false);});
  it('backup_or_output_failure_changes_nothing and never overwrites private files',async()=>{const f=fixture();writeFileSync(f.backupPath,'KEEP');await expect(migrateLegacy(f)).rejects.toThrow();expect(readFileSync(f.backupPath,'utf8')).toBe('KEEP');const other=fixture();writeFileSync(other.outputPath,'PRIVATE');await expect(migrateLegacy(other)).rejects.toThrow();expect(readFileSync(other.outputPath,'utf8')).toBe('PRIVATE');const db=new DatabaseSync(other.databasePath);expect(db.prepare('SELECT count(*) AS n FROM records').get()!.n).toBe(1);db.close();});
  it('transaction_failure_keeps_backup_and_legacy_tables',async()=>{const f=fixture();const exec=DatabaseSync.prototype.exec;vi.spyOn(DatabaseSync.prototype,'exec').mockImplementation(function(this:DatabaseSync,sql:string){if(sql.includes('ALTER TABLE records'))throw new Error('injected transaction failure');return exec.call(this,sql);});await expect(migrateLegacy(f)).rejects.toThrow();vi.restoreAllMocks();expect(existsSync(f.backupPath)).toBe(true);expect(existsSync(f.outputPath)).toBe(false);const db=new DatabaseSync(f.databasePath);expect(db.prepare('SELECT count(*) AS n FROM records').get()!.n).toBe(1);expect(db.prepare("SELECT name FROM sqlite_master WHERE name='rooms'").get()).toBeUndefined();db.close();});
  it('refuses a backup inside a public static directory before migration', async () => {
    const f = fixture();
    const backupPath = resolve('public', `migration-private-backup-${crypto.randomUUID()}.sqlite`);
    paths.push(backupPath);
    await expect(migrateLegacy({ ...f, backupPath })).rejects.toThrow(/static/);
    expect(existsSync(backupPath)).toBe(false);
    expect(existsSync(f.outputPath)).toBe(false);
    const db = new DatabaseSync(f.databasePath);
    expect(db.prepare('SELECT count(*) AS n FROM records').get()!.n).toBe(1);
    db.close();
  });
  it.each(['know', 'sync', 'doodle'] as const)('rejects a complete %s snapshot with an out-of-range deck', async game => {
    const f = fixture();
    const db = new DatabaseSync(f.databasePath);
    const match = createMatch(game, 1000);
    match.deck[1] = 100000;
    const raw = JSON.stringify({ match, proposal: null, leaveVotes: [false, false], savedAt: 2000 });
    db.prepare("UPDATE settings SET value=? WHERE key='room'").run(raw);
    db.close();
    await expect(migrateLegacy(f)).rejects.toThrow();
    expect(existsSync(f.backupPath)).toBe(false);
    expect(existsSync(f.outputPath)).toBe(false);
    const check = new DatabaseSync(f.databasePath);
    try {
      expect(check.prepare("SELECT value FROM settings WHERE key='room'").get()!.value).toBe(raw);
      expect(check.prepare("SELECT name FROM sqlite_master WHERE name='rooms'").get()).toBeUndefined();
    } finally { check.close(); }
  });
  it.each(['missing-options', 'invalid-answer', 'inconsistent-deadline', 'missing-outcome'])('rejects engine-incompatible %s snapshot relationships', async defect => {
    const f = fixture();
    const match = createMatch('know', 1000);
    if (defect === 'missing-options') match.options = [];
    if (defect === 'invalid-answer') match.answers[0] = '100';
    if (defect === 'inconsistent-deadline') match.deadline = 61000;
    if (defect === 'missing-outcome') match.phase = 'finished';
    const db = new DatabaseSync(f.databasePath);
    db.prepare("UPDATE settings SET value=? WHERE key='room'").run(JSON.stringify({ match, proposal: null, leaveVotes: [false, false] }));
    db.close();
    await expect(migrateLegacy(f)).rejects.toThrow();
    expect(existsSync(f.backupPath)).toBe(false);
    expect(existsSync(f.outputPath)).toBe(false);
  });
  it.each(['know', 'clue'] as const)('accepts and preserves an engine-generated %s snapshot', async game => {
    const f = fixture();
    const match = createMatch(game, 1000);
    const db = new DatabaseSync(f.databasePath);
    db.prepare("UPDATE settings SET value=? WHERE key='room'").run(JSON.stringify({ match, proposal: null, leaveVotes: [false, false], savedAt: 2000 }));
    db.close();
    const result = await migrateLegacy(f);
    const store = new Store(f.databasePath);
    try {
      const saved = (await store.getRoom(result.roomId))!.snapshot.match!;
      expect(saved).toMatchObject({ id: match.id, game, paused: true, deck: match.deck, words: match.words, options: match.options });
    } finally { await store.close(); }
  });
});
