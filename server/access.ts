import { createHash, randomBytes } from 'node:crypto';
import { AccessError, type AccessContext, type RoomRepository } from './repository.js';
import { creatorInvitations, type SeatInvitations } from '../shared/invitations.js';
export const hashToken = (value: string): string => createHash('sha256').update(value).digest('hex');
export const newToken = (): string => randomBytes(32).toString('base64url');
export const sameAccess = (a: AccessContext, b: AccessContext): boolean => a.roomId === b.roomId && a.seat === b.seat && a.sessionHash === b.sessionHash && a.credentialVersion === b.credentialVersion;
export const SESSION_MS = 30 * 86400000;
/** Resolve the complete cookie hash and require seat zero before calling this. */
export function invitationsFromSession(token: string): SeatInvitations | null {
  const match=/^cogs1\.[A-Za-z0-9_-]{43}\.(cog1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43})$/.exec(token);
  return match?creatorInvitations(match[1]):null;
}
export class AccessService {
  constructor(private readonly repository: RoomRepository, private readonly maxSessionsPerSeat = 5) {}
  async login(key: string, previousToken: string | undefined, now: number): Promise<{ token: string; access: AccessContext }> {
    if (!key || key.length > 200) throw new AccessError();
    const token = creatorInvitations(key)?`cogs1.${newToken()}.${key}`:newToken(); const access = await this.repository.replaceSession({ invitationHash: hashToken(key), tokenHash: hashToken(token), previousTokenHash: previousToken ? hashToken(previousToken) : undefined, now, expires: now + SESSION_MS, maxSessionsPerSeat: this.maxSessionsPerSeat });
    return { token, access };
  }
  async resolve(token: string | undefined, now: number): Promise<AccessContext | null> { return !token || token.length > 200 ? null : this.repository.resolveSession(hashToken(token), now); }
  async logout(token: string | undefined): Promise<void> { if (token && token.length <= 200) await this.repository.deleteSession(hashToken(token)); }
}
