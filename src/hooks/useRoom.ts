import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { GameAction, RoomState } from '../../shared/types';
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Please try again.'); return result as T;
}
export function useRoom() {
  const [room, setRoom] = useState<RoomState | null>(null); const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false); const [error, setError] = useState('');
  const socket = useRef<Socket | null>(null); const roomRef = useRef(room); roomRef.current = room;
  const boot = useRef<Promise<RoomState> | null>(null);
  const authVersion = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const version = authVersion.current;
    if (!boot.current) {
      const invite = new URLSearchParams(location.hash.slice(1)).get('invite');
      if (invite) history.replaceState(null, '', location.pathname);
      boot.current = invite ? api<RoomState>('login', { key: invite }) : api<RoomState>('session');
    }
    boot.current.then(value => { if (!cancelled && authVersion.current === version) setRoom(value); }).catch(e => { if (!cancelled && authVersion.current === version && !e.message.includes('invitation')) setError(e.message); }).finally(() => { if (!cancelled && authVersion.current === version) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const change = async () => {
      const invite = new URLSearchParams(location.hash.slice(1)).get('invite'); if (!invite) return;
      history.replaceState(null, '', location.pathname); const version = ++authVersion.current; setLoading(true);
      try { const result = await api<RoomState>('login', { key: invite }); if (version === authVersion.current) { setRoom(result); setError(''); } }
      catch (e) { if (version === authVersion.current) setError((e as Error).message); }
      finally { if (version === authVersion.current) setLoading(false); }
    };
    window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change);
  }, []);
  const seat = room?.seat;
  useEffect(() => {
    if (seat === undefined) return;
    const s = io({ autoConnect: true, withCredentials: true, transports: ['websocket', 'polling'] }); socket.current = s;
    s.on('state', setRoom); s.on('connect', () => setConnected(true));
    s.on('disconnect', reason => { setConnected(false); if (reason === 'io server disconnect') setRoom(null); });
    s.on('connect_error', e => { setConnected(false); if (e.message.includes('private')) { setRoom(null); setError(e.message); } });
    return () => { s.disconnect(); socket.current = null; setConnected(false); };
  }, [seat]);
  const send = useCallback(async (event: string, value: unknown = {}) => {
    if (!socket.current?.connected) { setError('Reconnecting. Try again in a moment.'); return false; }
    setError('');
    return await new Promise<boolean>(resolve => {
      socket.current!.timeout(6000).emit(event, value, (failure: Error | null, result?: { ok: boolean; error?: string }) => {
        if (failure || !result?.ok) { setError(result?.error ?? 'Connection lost. Reconnecting…'); resolve(false); }
        else resolve(true);
      });
    });
  }, []);
  const act = useCallback((value: Pick<GameAction, 'type'> & Partial<GameAction>) => {
    const m = roomRef.current?.match; if (!m) return Promise.resolve(false);
    return send('action', { ...value, id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, matchId: m.id, round: m.round, phase: m.phase });
  }, [send]);
  const login = async (key: string) => { ++authVersion.current; try { setRoom(await api<RoomState>('login', { key: key.trim() })); setError(''); } catch (e) { setError((e as Error).message); } };
  const logout = async () => { await api('logout', {}); setRoom(null); };
  return { room, loading, connected, error, setError, send, act, login, logout };
}
export type Act = ReturnType<typeof useRoom>['act'];
