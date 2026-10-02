export interface Limits { maxRooms: number; maxSessionsPerSeat: number; maxSocketsPerSession: number }
export const defaultLimits: Limits = { maxRooms: 100, maxSessionsPerSeat: 5, maxSocketsPerSession: 3 };
export function positiveInteger(value: string | number | undefined, fallback: number): number {
  const n = value === undefined ? fallback : Number(value); if (!Number.isSafeInteger(n) || n < 1) throw new Error('Limits must be positive integers.'); return n;
}
export function limitsFromEnv(env: NodeJS.ProcessEnv): Limits {
  return { maxRooms: positiveInteger(env.MAX_ROOMS, 100), maxSessionsPerSeat: positiveInteger(env.MAX_SESSIONS_PER_SEAT, 5), maxSocketsPerSession: positiveInteger(env.MAX_SOCKETS_PER_SESSION, 3) };
}
export class WindowLimiter {
  private readonly entries = new Map<string, { start: number; count: number }>();
  private lastPrune = -Infinity;
  constructor(private readonly max: number, private readonly windowMs: number, private readonly maxKeys = 10000) {}
  consume(key: string, now: number): boolean {
    if (now - this.lastPrune >= this.windowMs) { for (const [k,v] of this.entries) if (now - v.start >= this.windowMs) this.entries.delete(k); this.lastPrune = now; }
    let v = this.entries.get(key);
    if (v && now - v.start >= this.windowMs) { this.entries.delete(key); v = undefined; }
    if (!v) { if (this.entries.size >= this.maxKeys) return false; v = { start: now, count: 0 }; this.entries.set(key, v); }
    return ++v.count <= this.max;
  }
}
