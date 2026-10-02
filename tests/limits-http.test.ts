import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';
import { provisionRooms } from './support/rooms.js';
import { io } from 'socket.io-client';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });
const origin = 'http://localhost:5173';
async function fixture(trustedProxyAddresses: string[] = []) {
  const store = new Store(':memory:');
  const rooms = await provisionRooms(store);
  const app = await createApp({ databasePath: ':memory:', origin, production: false, trustedProxyAddresses }, { repository: store });
  closers.push(app.close);
  await app.http.listen({ host: '127.0.0.1', port: 0 });
  const address = app.http.server.address();
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  return { app, url, keys: rooms.keys };
}

describe('transport abuse limits', () => {
  it('untrusted forwarded IPs cannot bypass login or API quotas', async () => {
    const { app } = await fixture();
    for (let n = 0; n < 10; n++) {
      const response = await app.http.inject({ method: 'POST', url: '/api/login', headers: { origin, 'x-forwarded-for': `192.0.2.${n+1}` }, payload: { key: 'invalid' } });
      expect(response.statusCode).toBe(401);
    }
    expect((await app.http.inject({ method: 'POST', url: '/api/login', headers: { origin, 'x-forwarded-for': '192.0.2.200' }, payload: { key: 'invalid' } })).statusCode).toBe(429);
    for (let n = 0; n < 109; n++) expect((await app.http.inject({ url: '/api/health', headers: { 'x-forwarded-for': `192.0.2.${n+1}` } })).statusCode).toBe(200);
    expect((await app.http.inject('/api/health')).statusCode).toBe(429);
  });

  it('counts new polling handshakes but not existing transport requests', async () => {
    const { url } = await fixture();
    const handshake = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { origin } });
    expect(handshake.status).toBe(200);
    const sid = JSON.parse((await handshake.text()).slice(1)).sid as string;
    for (let n = 0; n < 35; n++) {
      const response = await fetch(`${url}/socket.io/?EIO=4&transport=polling&sid=${sid}`, { method: 'POST', headers: { origin, 'content-type': 'text/plain' }, body: '6' });
      expect(response.status).toBe(200);
    }
    for (let n = 0; n < 29; n++) expect((await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { origin, 'x-forwarded-for': `192.0.2.${n+1}` } })).status).toBe(200);
    expect((await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { origin, 'x-forwarded-for': '192.0.2.200' } })).status).toBe(403);
  });

  it('a polling-to-WebSocket upgrade consumes only one handshake', async () => {
    const { app, url, keys } = await fixture();
    const login = await app.http.inject({ method: 'POST', url: '/api/login', headers: { origin }, payload: { key: keys[0] } });
    const cookie = (login.headers['set-cookie'] as string).split(';')[0];
    const socket = io(url, { transports: ['polling', 'websocket'], extraHeaders: { origin, cookie }, reconnection: false });
    closers.push(async () => { socket.disconnect(); });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Upgrade timed out')), 3000);
      socket.io.engine.once('upgrade', () => { clearTimeout(timeout); resolve(); });
      socket.once('connect_error', error => { clearTimeout(timeout); reject(error); });
    });
    expect(socket.io.engine.transport.name).toBe('websocket');
    for (let n = 0; n < 29; n++) expect((await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { origin } })).status).toBe(200);
    expect((await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { origin } })).status).toBe(403);
  });

  it('uses only a configured trusted proxy chain for handshake limits', async () => {
    const { url } = await fixture(['127.0.0.1']);
    for (let n = 0; n < 30; n++) expect((await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { origin, 'x-forwarded-for': '198.51.100.1' } })).status).toBe(200);
    expect((await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { origin, 'x-forwarded-for': '192.0.2.200, 198.51.100.1' } })).status).toBe(403);
    expect((await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { origin, 'x-forwarded-for': '198.51.100.2' } })).status).toBe(200);
    expect((await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { origin: 'https://evil.example', 'x-forwarded-for': '198.51.100.3' } })).status).toBe(403);
  });
});
