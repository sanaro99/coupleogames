import type { Match } from './engine.js';
import type { Proposal, RecordEntry, Seat } from '../shared/types.js';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
export interface Snapshot { match: Match | null; proposal: Proposal | null; leaveVotes: [boolean, boolean]; savedAt?: number }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, finished_at INTEGER NOT NULL, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, seat INTEGER NOT NULL CHECK(seat IN (0,1)), expires INTEGER NOT NULL);');
  }
  setNames(names: [string, string]): void { this.db.prepare("INSERT OR REPLACE INTO settings VALUES ('names', ?)").run(JSON.stringify(names)); }
  getNames(): [string, string] | null { return this.read<[string, string]>('names'); }
  private read<T>(key: string): T | null { const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? JSON.parse(String(row.value)) as T : null; }
  load(): Snapshot | null { return this.read<Snapshot>('room'); }
  save(state: Snapshot, now: number): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("INSERT OR REPLACE INTO settings VALUES ('room', ?)").run(JSON.stringify({ ...state, savedAt: now }));
      const m = state.match;
      if (m?.phase === 'finished' && m.outcome) {
        const record: RecordEntry = { id: m.id, game: m.game, finishedAt: now, outcome: m.outcome, scores: m.scores, bestStreak: m.bestStreak };
        this.db.prepare('INSERT OR IGNORE INTO records VALUES (?, ?, ?)').run(m.id, now, JSON.stringify(record));
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  records(): RecordEntry[] { return this.db.prepare('SELECT value FROM records ORDER BY finished_at DESC').all().map(row => JSON.parse(String(row.value)) as RecordEntry); }
  createSession(seat: Seat): string {
    const now = Date.now(); this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now);
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hash(token), seat, now + 30 * 86400000); return token;
  }
  getSeat(token: string | undefined): Seat | null {
    if (!token || token.length > 200) return null;
    const row = this.db.prepare('SELECT seat FROM sessions WHERE token=? AND expires>?').get(hash(token), Date.now());
    return row ? Number(row.seat) as Seat : null;
  }
  deleteSession(token: string): void { this.db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token)); }
  close(): void { this.db.close(); }
}
