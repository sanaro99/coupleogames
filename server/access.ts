import { createHash, randomBytes } from 'node:crypto';
import { AccessError, type AccessContext, type RoomRepository } from './repository.js';
export const hashToken = (value: string): string => createHash('sha256').update(value).digest('hex');
export const newToken = (): string => randomBytes(32).toString('base64url');
export const sameAccess = (a: AccessContext, b: AccessContext): boolean => a.roomId === b.roomId && a.seat === b.seat && a.sessionHash === b.sessionHash && a.credentialVersion === b.credentialVersion;
export const SESSION_MS = 30 * 86400000;
export class AccessService {
  constructor(private readonly repository: RoomRepository, private readonly maxSessionsPerSeat = 5) {}
  async login(key: string, previousToken: string | undefined, now: number): Promise<{ token: string; access: AccessContext }> {
    if (!key || key.length > 200) throw new AccessError();
    const token = newToken(); const access = await this.repository.replaceSession({ invitationHash: hashToken(key), tokenHash: hashToken(token), previousTokenHash: previousToken ? hashToken(previousToken) : undefined, now, expires: now + SESSION_MS, maxSessionsPerSeat: this.maxSessionsPerSeat });
    return { token, access };
  }
  async resolve(token: string | undefined, now: number): Promise<AccessContext | null> { return !token || token.length > 200 ? null : this.repository.resolveSession(hashToken(token), now); }
  async logout(token: string | undefined): Promise<void> { if (token && token.length <= 200) await this.repository.deleteSession(hashToken(token)); }
}
