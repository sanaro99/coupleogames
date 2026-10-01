import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import staticFiles from '@fastify/static';
import { Server } from 'socket.io';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { Store, type Snapshot } from './store.js';
import { applyAction, createMatch, pauseMatch, resumeMatch, tickMatch, viewMatch } from './engine.js';
import type { RoomState, Seat, GameAction } from '../shared/types.js';
export interface AppConfig { databasePath: string; names: [string, string]; keys: [string, string]; origin: string; production: boolean }
const gameSchema = z.enum(['doodle', 'know', 'sync', 'clue']);
const namesSchema = z.object({ names: z.tuple([z.string().trim().min(1).max(32), z.string().trim().min(1).max(32)]) }).strict();
const actionSchema = z.object({
  id: z.string().min(1).max(80), matchId: z.string().uuid(), round: z.number().int().min(0).max(8),
  phase: z.enum(['play', 'reveal', 'finished']), type: z.enum(['answer', 'guess', 'stroke', 'clear', 'next', 'clue', 'tile', 'endturn']),
  text: z.string().max(100).optional(), choice: z.number().int().min(0).max(11).optional(), count: z.number().int().min(1).max(3).optional(),
  stroke: z.object({ color: z.string().regex(/^#[a-f0-9]{6}$/i), width: z.number().min(.002).max(.06), points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()).min(1).max(300) }).strict().optional(),
}).strict();
export async function createApp(config: AppConfig) {
  if (config.keys.some(k => k.length < 24) || config.keys[0] === config.keys[1]) throw new Error('Configure two distinct private keys of at least 24 characters. Run npm run setup locally.');
  const origin = new URL(config.origin).origin;
  if (config.production && !origin.startsWith('https://')) throw new Error('Production APP_ORIGIN must use HTTPS.');
  const store = new Store(config.databasePath);
  const http = Fastify({ bodyLimit: 16384, logger: false });
  await http.register(cookie); await http.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await http.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'", config.production ? 'wss:' : 'ws:'], fontSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: config.production ? [] : null } } });
  let room: Snapshot = store.load() ?? { match: null, proposal: null, leaveVotes: [false, false] };
  if (room.match) pauseMatch(room.match, room.savedAt ?? Date.now());
  // Readiness belongs to currently connected people, not an old browser session.
  if (room.proposal) { room.proposal.ready = [false, false]; room.proposal.id = randomUUID(); }
  const connections: [Set<string>, Set<string>] = [new Set(), new Set()];
  const online = (): [boolean, boolean] => [connections[0].size > 0, connections[1].size > 0];
  const state = (seat: Seat): RoomState => ({ seat, names: store.getNames() ?? config.names, setup: store.getNames() !== null, online: online(), proposal: room.proposal, match: room.match ? viewMatch(room.match, seat) : null, records: store.records(), leaveVotes: room.leaveVotes, serverTime: Date.now() });
  const io = new Server(http.server, { maxHttpBufferSize: 16384, cors: { origin, credentials: true }, allowRequest: (req, done) => done(null, req.headers.origin === origin) });
  const publish = () => {
    for (const socket of [...io.sockets.sockets.values()]) {
      if (store.getSeat(socket.data.token) === null) socket.disconnect(true);
    }
    for (const socket of io.sockets.sockets.values()) socket.emit('state', state(socket.data.seat));
  };
  const commit = () => { store.save(room, Date.now()); publish(); };
  http.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api')) {
      reply.header('Cache-Control', 'no-store');
      if (request.method !== 'GET' && request.headers.origin && request.headers.origin !== origin) return reply.code(403).send({ error: 'Open your game page to make changes.' });
    }
  });
  http.setErrorHandler((error, _request, reply) => {
    const code = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    reply.code(error instanceof z.ZodError ? 400 : code).send({ error: error instanceof z.ZodError ? 'Please check the details and try again.' : code < 500 && error instanceof Error ? error.message : 'Something went wrong. Please try again.' });
  });
  http.get('/api/health', async () => ({ ok: true }));
  http.post('/api/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = z.object({ key: z.string().min(1).max(200) }).passthrough().parse(request.body);
    const hash = (s: string) => createHash('sha256').update(s).digest();
    let seat: Seat | null = null; config.keys.forEach((key, index) => { if (timingSafeEqual(hash(key), hash(body.key))) seat = index as Seat; });
    if (seat === null) return reply.code(401).send({ error: 'That private key doesn’t match either seat.' });
    reply.setCookie('couple_session', store.createSession(seat), { path: '/', httpOnly: true, sameSite: 'strict', secure: config.production, maxAge: 30 * 86400 });
    return state(seat);
  });
  http.register(async api => {
    api.addHook('preHandler', async (request, reply) => {
      if (store.getSeat(request.cookies.couple_session) === null) return reply.code(401).send({ error: 'Open your private invitation to join.' });
    });
    api.get('/api/session', async request => state(store.getSeat(request.cookies.couple_session)!));
    // Seat credentials are provisioned by the owner, never disclosed to another seat.
    api.get('/api/invite', async () => ({ url: `${origin}/` }));
    api.post('/api/setup', async (request, reply) => {
      if (store.getNames()) return reply.code(409).send({ error: 'Your names are already saved.' });
      store.setNames(namesSchema.parse(request.body).names); commit(); return { ok: true };
    });
    api.post('/api/logout', async (request, reply) => {
      const token = request.cookies.couple_session!; store.deleteSession(token);
      for (const socket of io.sockets.sockets.values()) if (socket.data.token === token) socket.disconnect(true);
      reply.clearCookie('couple_session', { path: '/' }); return { ok: true };
    });
  });
  io.use((socket, next) => {
    const token = http.parseCookie(socket.handshake.headers.cookie ?? '').couple_session;
    const seat = store.getSeat(token); if (seat === null) return next(new Error('Open your private invitation to join.'));
    socket.data.seat = seat; socket.data.token = token; next();
  });
  io.on('connection', socket => {
    const seat: Seat = socket.data.seat; connections[seat].add(socket.id);
    if (room.match && online().every(Boolean)) resumeMatch(room.match, Date.now()); commit();
    let windowStart = Date.now(); let messages = 0;
    function handle(event: string, mutate: (value: unknown) => void) {
      socket.on(event, (value: unknown, ack?: (result: { ok: boolean; error?: string }) => void) => {
        try {
          if (store.getSeat(socket.data.token) !== seat) { socket.disconnect(true); throw new Error('Your session ended. Open your invitation again.'); }
          if (Date.now() - windowStart > 10000) { windowStart = Date.now(); messages = 0; }
          if (++messages > 180) throw new Error('Too many actions. Wait a moment and try again.');
          mutate(value); commit(); if (typeof ack === 'function') ack({ ok: true });
        } catch (error) {
          // A deadline can expire while validating a late action; persist and reveal it.
          commit(); if (typeof ack === 'function') ack({ ok: false, error: error instanceof z.ZodError ? 'That action is not valid.' : error instanceof Error ? error.message : 'Please try again.' });
        }
      });
    }
    handle('setup', value => { if (store.getNames()) throw new Error('Your names are already saved.'); store.setNames(namesSchema.parse(value).names); });
    handle('propose', value => {
      if (!store.getNames()) throw new Error('Enter your names first.');
      if (room.match && room.match.phase !== 'finished') throw new Error('Finish this match first.');
      const game = z.object({ game: gameSchema }).strict().parse(value).game;
      room.match = null; room.leaveVotes = [false, false]; room.proposal = { id: randomUUID(), game, ready: [false, false] };
    });
    handle('ready', value => {
      if (!room.proposal) throw new Error('Choose a game first.');
      const { proposalId } = z.object({ proposalId: z.string().uuid() }).strict().parse(value);
      if (proposalId !== room.proposal.id) throw new Error('The chosen game changed. Please get ready for this one.');
      room.proposal.ready[seat] = true;
      if (room.proposal.ready.every(Boolean) && online().every(Boolean)) { room.match = createMatch(room.proposal.game, Date.now()); room.proposal = null; }
    });
    handle('action', value => { if (!room.match) throw new Error('Choose a game first.'); applyAction(room.match, seat, actionSchema.parse(value) as GameAction, Date.now()); });
    handle('lobby', value => { const { matchId } = z.object({ matchId: z.string().uuid() }).strict().parse(value); if (!room.match || room.match.id !== matchId) throw new Error('That match has changed.'); if (room.match.phase !== 'finished') throw new Error('Finish or leave this match together first.'); room.match = null; room.proposal = null; room.leaveVotes = [false, false]; });
    handle('leave', value => { const { matchId } = z.object({ matchId: z.string() }).strict().parse(value); if (!room.match || room.match.id !== matchId) throw new Error('That match has changed.'); if (room.match.phase === 'finished') return; room.leaveVotes[seat] = !room.leaveVotes[seat]; if (room.leaveVotes.every(Boolean)) { room.match = null; room.proposal = null; room.leaveVotes = [false, false]; } });
    socket.on('disconnect', () => {
      connections[seat].delete(socket.id);
      if (!online()[seat]) { if (room.match) pauseMatch(room.match, Date.now()); if (room.proposal) room.proposal.ready[seat] = false; }
      commit();
    });
  });
  let checkpoint = Date.now();
  const timer = setInterval(() => {
    if (!room.match) return;
    if (tickMatch(room.match, Date.now())) commit();
    else if (room.match.deadline && Date.now() - checkpoint >= 5000) { store.save(room, Date.now()); checkpoint = Date.now(); }
  }, 250);
  const root = resolve('dist');
  if (existsSync(root)) {
    await http.register(staticFiles, { root });
    http.setNotFoundHandler((request, reply) => request.url.startsWith('/api') ? reply.code(404).send({ error: 'Not found.' }) : reply.sendFile('index.html'));
  }
  await http.ready();
  const close = async () => { clearInterval(timer); await new Promise<void>(r => io.close(() => r())); await http.close(); store.close(); };
  return { http, io, close };
}
