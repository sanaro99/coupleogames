import type { Match } from './engine.js';
import type { Proposal, RecordEntry, Seat } from '../shared/types.js';
export type RoomId = string;
export interface Snapshot { match: Match | null; proposal: Proposal | null; leaveVotes: [boolean, boolean]; savedAt?: number }
export const emptySnapshot = (): Snapshot => ({ match: null, proposal: null, leaveVotes: [false, false] });
export interface AccessContext { roomId: RoomId; seat: Seat; sessionHash: string; credentialVersion: number }
export interface InvitationAccess { roomId: RoomId; seat: Seat; credentialVersion: number }
export interface RoomWrite { names: [string, string]; setup: boolean; snapshot: Snapshot }
export interface PersistedRoom extends RoomWrite { id: RoomId; status: 'active' | 'disabled'; savedAt: number; revision: number }
export interface CreateRoomInput { roomId: RoomId; invitationHashes: [string, string]; maxRooms: number; now: number }
export interface SessionInput { invitationHash: string; tokenHash: string; previousTokenHash?: string; now: number; expires: number; maxSessionsPerSeat: number }
export interface RoomSummary { id: RoomId; status: 'active' | 'disabled'; createdAt: number }
export class RevisionConflict extends Error { constructor() { super('This room changed. Please reconnect and try again.'); } }
export class AccessError extends Error { readonly statusCode = 401; constructor() { super('Open your private invitation to join.'); } }
export class CapacityError extends Error { readonly statusCode = 429; }
export interface RoomRepository {
  getRoom(roomId: RoomId): Promise<PersistedRoom | null>;
  getRecords(roomId: RoomId): Promise<RecordEntry[]>;
  saveRoom(roomId: RoomId, expectedRevision: number, next: RoomWrite, now: number): Promise<PersistedRoom>;
  createRoom(input: CreateRoomInput): Promise<PersistedRoom>;
  findInvitation(invitationHash: string): Promise<InvitationAccess | null>;
  replaceSession(input: SessionInput): Promise<AccessContext>;
  resolveSession(tokenHash: string, now: number): Promise<AccessContext | null>;
  deleteSession(tokenHash: string): Promise<void>;
  rotateSeat(roomId: RoomId, seat: Seat, invitationHash: string, now: number): Promise<void>;
  disableRoom(roomId: RoomId, now: number): Promise<void>;
  listRooms(): Promise<RoomSummary[]>;
  close(): Promise<void>;
}
