import type { RoomState } from './types.js';

export interface SeatInvitations { creatorKey: string; partnerKey: string }
export interface CreatedRoom { room: RoomState; invitations: SeatInvitations }

/** Use only after the full creator credential has authenticated seat zero. */
export function creatorInvitations(key: string): SeatInvitations | null {
  const match = /^cog1\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(key);
  return match ? { creatorKey: key, partnerKey: match[2] } : null;
}

export const invitationLink = (origin: string, key: string): string => `${origin}/#invite=${encodeURIComponent(key)}`;

export function invitationKey(input: string): string {
  const value = input.trim();
  if (!/^https?:\/\//i.test(value)) return value;
  try { return new URLSearchParams(new URL(value).hash.slice(1)).get('invite') ?? ''; }
  catch { return ''; }
}
