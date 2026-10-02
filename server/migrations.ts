import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pauseMatch, type Match } from './engine.js';
import { DRAW_WORDS, QUESTIONS, SYNC_PROMPTS } from './content.js';
import { hashToken, newToken } from './access.js';
import { invitationDocument, writeInvitationFile, writePrivateFile } from './invitations.js';
import { emptySnapshot, type Snapshot } from './repository.js';
import type { RecordEntry } from '../shared/types.js';
export const SCHEMA_VERSION = 2;
const currentTables = ['schema_migrations', 'rooms', 'room_seats', 'room_sessions', 'room_records'];
export function schemaTables(db: DatabaseSync): string[] {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => String(r.name));
}
export function createSchema(db: DatabaseSync, now = Date.now(), legacyRoomId: string | null = null): void {
  db.exec(`
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, completed_at INTEGER NOT NULL, legacy_room_id TEXT);
    CREATE TABLE rooms(id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('active','disabled')),
      names_json TEXT NOT NULL, setup_complete INTEGER NOT NULL CHECK(setup_complete IN (0,1)), snapshot_json TEXT NOT NULL,
      saved_at INTEGER NOT NULL, revision INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE room_seats(room_id TEXT NOT NULL REFERENCES rooms(id), seat INTEGER NOT NULL CHECK(seat IN (0,1)),
      invitation_hash TEXT NOT NULL UNIQUE, credential_version INTEGER NOT NULL, PRIMARY KEY(room_id,seat));
    CREATE TABLE room_sessions(token_hash TEXT PRIMARY KEY, room_id TEXT NOT NULL, seat INTEGER NOT NULL CHECK(seat IN (0,1)),
      credential_version INTEGER NOT NULL, created_at INTEGER NOT NULL, expires INTEGER NOT NULL,
      FOREIGN KEY(room_id,seat) REFERENCES room_seats(room_id,seat));
    CREATE INDEX sessions_expiry ON room_sessions(expires);
    CREATE INDEX sessions_seat ON room_sessions(room_id,seat);
    CREATE TABLE room_records(room_id TEXT NOT NULL REFERENCES rooms(id), id TEXT NOT NULL, finished_at INTEGER NOT NULL,
      value TEXT NOT NULL, PRIMARY KEY(room_id,id));
    CREATE INDEX records_room_date ON room_records(room_id,finished_at DESC);
  `);
  db.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(SCHEMA_VERSION, now, legacyRoomId);
}
export function initializeSchema(db: DatabaseSync): void {
  const tables = schemaTables(db);
  if (!tables.length) {
    db.exec('BEGIN IMMEDIATE');
    try { createSchema(db); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    return;
  }
  if (tables.includes('settings') || tables.includes('records') || tables.includes('sessions')) throw new Error('Legacy schema requires offline rooms migrate-legacy with a verified backup.');
  if (!currentTables.every(t => tables.includes(t)) || tables.some(t => !currentTables.includes(t) && !['legacy_settings_v1','legacy_records_v1','legacy_sessions_v1'].includes(t))) throw new Error('Unknown database schema; refusing to change or serve it.');
  const versions = db.prepare('SELECT version FROM schema_migrations').all();
  if (versions.length !== 1 || Number(versions[0].version) !== SCHEMA_VERSION) throw new Error('Unsupported database schema version.');
}

const integer=z.number().int().nonnegative();const seat=z.union([z.literal(0),z.literal(1)]);const boolPair=z.tuple([z.boolean(),z.boolean()]);const scorePair=z.tuple([integer,integer]);
const outcome=z.object({winner:z.union([seat,z.enum(['together','draw','none'])]),score:integer,success:z.boolean()}).strict();
const game=z.enum(['doodle','know','sync','clue']);const nullableText=z.string().max(100).nullable();
const stroke=z.object({color:z.string().regex(/^#[a-f0-9]{6}$/i),width:z.number().min(.002).max(.06),points:z.array(z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1)}).strict()).min(1).max(300)}).strict();
const matchSchema=z.object({
  id:z.string().uuid(),game,phase:z.enum(['play','reveal','finished']),round:integer.max(8),totalRounds:integer,
  scores:scorePair,ready:boolPair,paused:z.boolean(),deadline:integer.nullable(),remainingMs:integer,
  outcome:outcome.nullable(),prompt:z.string(),options:z.array(z.string()).max(4),answers:z.tuple([nullableText,nullableText]),deck:z.array(integer).length(6),
  strokes:z.array(stroke),guesses:z.array(z.string().max(100)).max(20),matched:z.boolean().nullable(),streak:integer,bestStreak:integer,
  words:z.array(z.string()).max(12),keys:z.array(z.enum(['target0','target1','neutral','trap'])).max(12),revealed:z.array(z.boolean()).max(12),clueGiver:seat,cluePhase:z.enum(['clue','guess']),
  clue:nullableText,clueCount:integer.max(3),guessesLeft:integer.max(3),turn:integer.max(8),lives:integer.max(3),found:integer.max(6),actionIds:z.array(z.string()).max(256),
}).strict().superRefine((m,ctx)=>{
  if(m.totalRounds!==(m.game==='clue'?8:6) || (m.game!=='clue' && m.round>5) || m.strokes.reduce((n,s)=>n+s.points.length,0)>15000)ctx.addIssue({code:'custom',message:'Invalid saved match.'});
  if(m.game==='clue' && (m.words.length!==12 || m.keys.length!==12 || m.revealed.length!==12 || ['target0','target1'].some(k=>m.keys.filter(v=>v===k).length!==3) || m.keys.filter(v=>v==='trap').length!==2 || m.keys.filter(v=>v==='neutral').length!==4))ctx.addIssue({code:'custom',message:'Invalid saved board.'});
  const invalid=(message:string)=>ctx.addIssue({code:'custom',message});
  if(m.game!=='clue') {
    const source=m.game==='doodle'?DRAW_WORDS:m.game==='know'?QUESTIONS:SYNC_PROMPTS;
    if(m.deck.some(index=>index>=source.length) || new Set(m.deck).size!==6) invalid('Invalid saved deck.');
  }
  if(m.game==='know') {
    const question=QUESTIONS[m.deck[m.round]];
    if(!question || m.options.length!==question.options.length || m.answers.some(answer=>answer!==null && (!/^[0-9]+$/.test(answer) || Number(answer)>=m.options.length))) invalid('Invalid saved question or answers.');
  }
  if((m.phase==='finished') !== (m.outcome!==null)) invalid('Invalid saved outcome.');
  if(m.deadline!==null && (m.game!=='doodle' || m.phase!=='play' || m.paused)) invalid('Invalid saved deadline.');
  if(m.game==='doodle' && m.remainingMs>60000) invalid('Invalid saved drawing time.');
  if(m.game==='clue' && (m.turn<1 || m.round!==m.turn-1 || new Set(m.words).size!==12 || m.words.some(word=>!word.trim()))) invalid('Invalid saved board progression.');
});
const snapshotSchema=z.object({match:matchSchema.nullable(),proposal:z.object({id:z.string().uuid(),game,ready:boolPair}).strict().nullable(),leaveVotes:boolPair,savedAt:integer.optional()}).strict();
const recordSchema=z.object({id:z.string().uuid(),game,finishedAt:integer,outcome,scores:scorePair,bestStreak:integer}).strict();
function legacyRows(db:DatabaseSync) {
  return {settings:db.prepare('SELECT key,value FROM settings ORDER BY key').all(),records:db.prepare('SELECT id,finished_at,value FROM records ORDER BY id').all(),sessions:db.prepare('SELECT token,seat,expires FROM sessions ORDER BY token').all()};
}
function verifyLegacyLayout(db:DatabaseSync):void {
  const tables=schemaTables(db);
  if(tables.includes('schema_migrations')) {
    const row=db.prepare('SELECT legacy_room_id FROM schema_migrations WHERE version=?').get(SCHEMA_VERSION);
    throw new Error(row?.legacy_room_id?`Already migrated as room ${row.legacy_room_id}.`:'Database schema is already migrated or unsupported.');
  }
  if(tables.length!==3 || !['settings','records','sessions'].every(t=>tables.includes(t)))throw new Error('Unknown or mixed legacy schema.');
  for(const [table,columns] of [['settings',['key','value']],['records',['id','finished_at','value']],['sessions',['token','seat','expires']]] as const){const names=db.prepare(`PRAGMA table_info(${table})`).all().map(r=>String(r.name));if(names.length!==columns.length || columns.some(c=>!names.includes(c)))throw new Error('Unsupported legacy table layout.');}
}
export interface LegacyMigrationInput { databasePath:string; backupPath:string; outputPath:string; legacyNameDefaults:[string,string]; now:number; origin?:string }
/** Caller must stop the app first. The operator CLI requires explicit --offline acknowledgment. */
export async function migrateLegacy(input:LegacyMigrationInput):Promise<{roomId:string;recordCount:number}> {
  if(!existsSync(input.databasePath) || typeof backup!=='function')throw new Error('An existing legacy database and supported Node SQLite backup API are required.');
  const db=new DatabaseSync(input.databasePath);let removeOutput:(()=>void)|undefined;let transaction=false;
  try {
    verifyLegacyLayout(db);const source=legacyRows(db);const settings=new Map(source.settings.map(row=>[String(row.key),JSON.parse(String(row.value))]));
    const defaults=z.tuple([z.string().max(32),z.string().max(32)]).parse(input.legacyNameDefaults);
    const savedNames=settings.get('names');const names=savedNames===undefined?defaults:z.tuple([z.string().min(1).max(32),z.string().min(1).max(32)]).parse(savedNames);
    const snapshot:Snapshot=settings.has('room')?snapshotSchema.parse(settings.get('room')) as Snapshot:emptySnapshot();
    const records:RecordEntry[]=source.records.map(row=>{const record=recordSchema.parse(JSON.parse(String(row.value)));if(record.id!==row.id || record.finishedAt!==Number(row.finished_at))throw new Error('Legacy record identity or timestamp mismatch.');return record;});
    for(const row of source.sessions) {seat.parse(Number(row.seat));integer.parse(Number(row.expires));if(!/^[a-f0-9]{64}$/.test(String(row.token)))throw new Error('Invalid legacy session hash.');}
    const backupPath=resolve(input.backupPath);const removeBackup=writePrivateFile(backupPath,'');
    try {await backup(db,backupPath);}catch(error){removeBackup();throw error;}
    const check=new DatabaseSync(backupPath,{readOnly:true});
    try {if(check.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok' || JSON.stringify(legacyRows(check))!==JSON.stringify(source))throw new Error('Backup verification failed.');}finally{check.close();}
    const roomId=randomUUID();const tokens:[string,string]=[newToken(),newToken()];
    removeOutput=writeInvitationFile(input.outputPath,invitationDocument(input.origin??'http://localhost:5173',tokens.map((token,seat)=>({seat:seat as 0|1,token}))));
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');transaction=true;
    if(JSON.stringify(legacyRows(db))!==JSON.stringify(source))throw new Error('Legacy database changed during backup. Stop the app and retry with a fresh backup path.');
    createSchema(db,input.now,roomId);
    if(snapshot.match) {const checkpoint=snapshot.savedAt ?? (snapshot.match.deadline===null?input.now:snapshot.match.deadline-snapshot.match.remainingMs);pauseMatch(snapshot.match as Match,checkpoint);}
    if(snapshot.proposal){snapshot.proposal.ready=[false,false];snapshot.proposal.id=randomUUID();}
    db.prepare('INSERT INTO rooms VALUES (?,?,?,?,?,?,?,?,?)').run(roomId,'active',JSON.stringify(names),Number(savedNames!==undefined),JSON.stringify(snapshot),input.now,0,input.now,input.now);
    for(const seat of [0,1] as const)db.prepare('INSERT INTO room_seats VALUES (?,?,?,?)').run(roomId,seat,hashToken(tokens[seat]),1);
    for(const record of records)db.prepare('INSERT INTO room_records VALUES (?,?,?,?)').run(roomId,record.id,record.finishedAt,JSON.stringify(record));
    db.exec('ALTER TABLE settings RENAME TO legacy_settings_v1;');db.exec('ALTER TABLE records RENAME TO legacy_records_v1;');db.exec('ALTER TABLE sessions RENAME TO legacy_sessions_v1;');
    if(db.prepare('PRAGMA foreign_key_check').all().length || db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok' || Number(db.prepare('SELECT count(*) AS n FROM room_records WHERE room_id=?').get(roomId)!.n)!==records.length)throw new Error('Imported data verification failed.');
    const imported=db.prepare('SELECT value FROM room_records WHERE room_id=? ORDER BY id').all(roomId).map(r=>JSON.parse(String(r.value)));if(JSON.stringify(imported)!==JSON.stringify(records))throw new Error('Imported record values differ.');
    db.exec('COMMIT');transaction=false;removeOutput=undefined;return {roomId,recordCount:records.length};
  }catch(error){if(transaction)db.exec('ROLLBACK');removeOutput?.();throw error;}finally{db.close();}
}
