import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { RecordEntry, Seat } from '../shared/types.js';
import { initializeSchema } from './migrations.js';
import { AccessError, CapacityError, RevisionConflict, emptySnapshot, type AccessContext, type CreateRoomInput, type InvitationAccess, type PersistedRoom, type RoomRepository, type RoomSummary, type RoomWrite, type SessionInput } from './repository.js';
export type { Snapshot } from './repository.js';
type Row = Record<string, SQLOutputValue>;
const roomFromRow = (r: Row): PersistedRoom => ({ id: String(r.id), status: r.status as PersistedRoom['status'], names: JSON.parse(String(r.names_json)), setup: Boolean(r.setup_complete), snapshot: JSON.parse(String(r.snapshot_json)), savedAt: Number(r.saved_at), revision: Number(r.revision) });
const identity = (r: Row): InvitationAccess => ({ roomId: String(r.room_id), seat: Number(r.seat) as Seat, credentialVersion: Number(r.credential_version) });
export class Store implements RoomRepository {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    try { this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;'); initializeSchema(this.db); this.db.exec('PRAGMA journal_mode=WAL;'); }
    catch (error) { this.db.close(); throw error; }
  }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private readRoom(roomId: string): PersistedRoom | null {
    if (!roomId) throw new Error('Room identity is required.');
    const row = this.db.prepare('SELECT * FROM rooms WHERE id=?').get(roomId); return row ? roomFromRow(row) : null;
  }
  async getRoom(roomId: string): Promise<PersistedRoom | null> { return this.readRoom(roomId); }
  async getRecords(roomId: string): Promise<RecordEntry[]> {
    if (!roomId) throw new Error('Room identity is required.');
    return this.db.prepare('SELECT value FROM room_records WHERE room_id=? ORDER BY finished_at DESC,id').all(roomId).map(r => JSON.parse(String(r.value)) as RecordEntry);
  }
  async createRoom(input: CreateRoomInput): Promise<PersistedRoom> {
    if (!input.roomId || input.invitationHashes.length !== 2 || input.invitationHashes.some(h => !/^[a-f0-9]{64}$/.test(h)) || !Number.isInteger(input.maxRooms) || input.maxRooms < 1) throw new Error('Invalid room provisioning.');
    return this.transaction(() => {
      const count = Number(this.db.prepare("SELECT count(*) AS n FROM rooms WHERE status='active'").get()!.n);
      if (count >= input.maxRooms) throw new CapacityError('Active room capacity reached.');
      this.db.prepare('INSERT INTO rooms VALUES (?,?,?,?,?,?,?,?,?)').run(input.roomId, 'active', '["",""]', 0, JSON.stringify(emptySnapshot()), input.now, 0, input.now, input.now);
      for (const seat of [0, 1] as const) this.db.prepare('INSERT INTO room_seats VALUES (?,?,?,?)').run(input.roomId, seat, input.invitationHashes[seat], 1);
      return this.readRoom(input.roomId)!;
    });
  }
  async saveRoom(roomId: string, expectedRevision: number, next: RoomWrite, now: number): Promise<PersistedRoom> {
    return this.transaction(() => {
      const r = this.readRoom(roomId); if (!r || r.status !== 'active') throw new AccessError();
      if (r.revision !== expectedRevision) throw new RevisionConflict();
      this.db.prepare('UPDATE rooms SET names_json=?,setup_complete=?,snapshot_json=?,saved_at=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(JSON.stringify(next.names), Number(next.setup), JSON.stringify(next.snapshot), now, now, roomId, expectedRevision);
      const m = next.snapshot.match;
      if (m?.phase === 'finished' && m.outcome) {
        const record: RecordEntry = { id: m.id, game: m.game, finishedAt: now, outcome: m.outcome, scores: m.scores, bestStreak: m.bestStreak };
        this.db.prepare('INSERT INTO room_records VALUES (?,?,?,?) ON CONFLICT(room_id,id) DO NOTHING').run(roomId, m.id, now, JSON.stringify(record));
      }
      return this.readRoom(roomId)!;
    });
  }
  private invitation(invitationHash: string): InvitationAccess | null {
    const r = this.db.prepare("SELECT s.room_id,s.seat,s.credential_version FROM room_seats s JOIN rooms r ON r.id=s.room_id WHERE s.invitation_hash=? AND r.status='active'").get(invitationHash);
    return r ? identity(r) : null;
  }
  async findInvitation(invitationHash: string): Promise<InvitationAccess | null> { return this.invitation(invitationHash); }
  async replaceSession(input: SessionInput): Promise<AccessContext> {
    return this.transaction(() => {
      const invitation = this.invitation(input.invitationHash); if (!invitation) throw new AccessError();
      this.db.prepare('DELETE FROM room_sessions WHERE expires<=?').run(input.now);
      if (input.previousTokenHash) this.db.prepare('DELETE FROM room_sessions WHERE token_hash=?').run(input.previousTokenHash);
      const n = Number(this.db.prepare('SELECT count(*) AS n FROM room_sessions WHERE room_id=? AND seat=?').get(invitation.roomId, invitation.seat)!.n);
      if (n >= input.maxSessionsPerSeat) throw new CapacityError('This seat has too many device sessions. Sign out on another device or ask the operator to rotate its invitation.');
      this.db.prepare('INSERT INTO room_sessions VALUES (?,?,?,?,?,?)').run(input.tokenHash, invitation.roomId, invitation.seat, invitation.credentialVersion, input.now, input.expires);
      return { ...invitation, sessionHash: input.tokenHash };
    });
  }
  async resolveSession(tokenHash: string, now: number): Promise<AccessContext | null> {
    const r = this.db.prepare("SELECT s.room_id,s.seat,s.credential_version FROM room_sessions s JOIN room_seats p ON p.room_id=s.room_id AND p.seat=s.seat JOIN rooms r ON r.id=s.room_id WHERE s.token_hash=? AND s.expires>? AND s.credential_version=p.credential_version AND r.status='active'").get(tokenHash, now);
    return r ? { ...identity(r), sessionHash: tokenHash } : null;
  }
  async deleteSession(tokenHash: string): Promise<void> { this.db.prepare('DELETE FROM room_sessions WHERE token_hash=?').run(tokenHash); }
  async rotateSeat(roomId: string, seat: Seat, invitationHash: string, now: number): Promise<void> {
    if (seat !== 0 && seat !== 1) throw new Error('A room has only seats 0 and 1.');
    if (!/^[a-f0-9]{64}$/.test(invitationHash)) throw new Error('Invalid invitation hash.');
    this.transaction(() => {
      if (this.readRoom(roomId)?.status !== 'active') throw new AccessError();
      this.db.prepare('UPDATE room_seats SET invitation_hash=?,credential_version=credential_version+1 WHERE room_id=? AND seat=?').run(invitationHash, roomId, seat);
      this.db.prepare('DELETE FROM room_sessions WHERE room_id=? AND seat=?').run(roomId, seat);
      this.db.prepare('UPDATE rooms SET updated_at=? WHERE id=?').run(now, roomId);
    });
  }
  async disableRoom(roomId: string, now: number): Promise<void> {
    this.transaction(() => {
      if (!this.readRoom(roomId)) throw new AccessError();
      this.db.prepare("UPDATE rooms SET status='disabled',updated_at=? WHERE id=?").run(now, roomId);
      this.db.prepare('DELETE FROM room_sessions WHERE room_id=?').run(roomId);
    });
  }
  async listRooms(): Promise<RoomSummary[]> { return this.db.prepare('SELECT id,status,created_at FROM rooms ORDER BY created_at,id').all().map(r => ({ id: String(r.id), status: r.status as RoomSummary['status'], createdAt: Number(r.created_at) })); }
  async close(): Promise<void> { this.db.close(); }
}
