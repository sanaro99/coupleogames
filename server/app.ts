import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import staticFiles from '@fastify/static';
import { Server } from 'socket.io';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { Store } from './store.js';
import { AccessService, hashToken, invitationsFromSession, newToken, sameAccess, SESSION_MS } from './access.js';
import { AccessError, CapacityError, RevisionConflict, type AccessContext, type RoomRepository } from './repository.js';
import { RoomManager, RoomCommandError, type RoomCommand } from './rooms.js';
import { defaultLimits, positiveInteger, WindowLimiter } from './limits.js';
import type { RoomState } from '../shared/types.js';
export interface AppConfig { databasePath: string; origin: string; production: boolean; maxRooms?: number; maxSessionsPerSeat?: number; maxSocketsPerSession?: number; trustedProxyAddresses?: string[] }
const gameSchema = z.enum(['doodle', 'know', 'sync', 'clue']);
const namesSchema = z.object({ names: z.tuple([z.string().trim().min(1).max(32), z.string().trim().min(1).max(32)]) }).strict();
const actionSchema = z.object({
  id: z.string().min(1).max(80), matchId: z.string().uuid(), round: z.number().int().min(0).max(8),
  phase: z.enum(['play', 'reveal', 'finished']), type: z.enum(['answer', 'guess', 'stroke', 'clear', 'next', 'clue', 'tile', 'endturn']),
  text: z.string().max(100).optional(), choice: z.number().int().min(0).max(11).optional(), count: z.number().int().min(1).max(3).optional(),
  stroke: z.object({ color: z.string().regex(/^#[a-f0-9]{6}$/i), width: z.number().min(.002).max(.06), points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()).min(1).max(300) }).strict().optional(),
}).strict();
const command = (event: string, value: unknown): RoomCommand => {
  if(event==='setup') return {type:'setup',...namesSchema.parse(value)};
  if(event==='propose') return {type:'propose',...z.object({game:gameSchema}).strict().parse(value)};
  if(event==='ready') return {type:'ready',...z.object({proposalId:z.string().uuid()}).strict().parse(value)};
  if(event==='action') return {type:'action',action:actionSchema.parse(value)};
  return {type:event as 'lobby'|'leave',...z.object({matchId:z.string().uuid()}).strict().parse(value)};
};
const normalizeIp = (ip: string) => ip.startsWith('::ffff:') ? ip.slice(7) : ip;
function clientIp(req: IncomingMessage, trusted: string[]): string {
  let ip=normalizeIp(req.socket.remoteAddress ?? 'unknown');
  const forwarded=req.headers['x-forwarded-for'];
  if(typeof forwarded==='string' && trusted.includes(ip)) {
    const chain=forwarded.split(',').map(v=>normalizeIp(v.trim()));
    if(chain.length<=10 && chain.every(v=>isIP(v))) for(const next of chain.reverse()) {if(!trusted.includes(ip)) break;ip=next;}
  }
  return ip;
}
export async function createApp(config: AppConfig, dependencies: { repository?: RoomRepository; now?: ()=>number } = {}) {
  const parsedOrigin=new URL(config.origin); const origin=parsedOrigin.origin;
  if(!['http:','https:'].includes(parsedOrigin.protocol) || parsedOrigin.username || parsedOrigin.password || (config.production && parsedOrigin.protocol!=='https:')) throw new Error('Configure a valid app origin; production requires HTTPS.');
  const trusted=(config.trustedProxyAddresses ?? []).map(normalizeIp);if(trusted.some(ip=>!isIP(ip))) throw new Error('Trusted proxies must be explicit IP addresses.');
  const limits={maxRooms:positiveInteger(config.maxRooms,defaultLimits.maxRooms),maxSessionsPerSeat:positiveInteger(config.maxSessionsPerSeat,defaultLimits.maxSessionsPerSeat),maxSocketsPerSession:positiveInteger(config.maxSocketsPerSession,defaultLimits.maxSocketsPerSession)};
  const now=dependencies.now ?? (()=>Date.now()); const store=dependencies.repository ?? new Store(config.databasePath);
  const auth=new AccessService(store,limits.maxSessionsPerSeat);
  const http=Fastify({bodyLimit:16384,logger:false,trustProxy:trusted.length?trusted:false});
  await http.register(cookie);
  await http.register(helmet,{contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:','blob:'],connectSrc:["'self'",config.production?'wss:':'ws:'],fontSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"],upgradeInsecureRequests:config.production?[]:null}}});
  const httpLimit=new WindowLimiter(120,60000);const loginLimit=new WindowLimiter(10,60000);const handshakeLimit=new WindowLimiter(30,60000);const actionLimit=new WindowLimiter(180,10000);
  const creationLimit=new WindowLimiter(5,3600000);const globalCreationLimit=new WindowLimiter(30,3600000);
  const io=new Server(http.server,{maxHttpBufferSize:16384,cors:{origin,credentials:true},allowRequest:(req,done)=>done(null,req.headers.origin===origin && handshakeLimit.consume(clientIp(req,trusted),now()))});
  const sessionSockets=new Map<string,Set<string>>();
  const roomChannel=(id:string,seat:number)=>`room:${id}:seat:${seat}`;
  const publish=async(id:string,views:[RoomState,RoomState])=>{
    for(const seat of [0,1] as const) for(const socketId of [...(io.of('/').adapter.rooms.get(roomChannel(id,seat)) ?? [])]) {
      const socket=io.sockets.sockets.get(socketId);if(!socket) continue; const access=socket.data.access as AccessContext;
      const current=await store.resolveSession(access.sessionHash,now());
      if(!current || !sameAccess(current,access)) {socket.disconnect(true);continue;}
      if(access.roomId===id && access.seat===seat) socket.emit('state',views[seat]);
    }
  };
  const rooms=new RoomManager(store,publish);
  http.addHook('onRequest',async(request,reply)=>{
    if(!request.url.startsWith('/api')) return;
    reply.header('Cache-Control','no-store');
    if(!httpLimit.consume(request.ip,now()) || (request.url.split('?')[0]==='/api/login' && !loginLimit.consume(request.ip,now()))) return reply.code(429).send({error:'Too many requests. Wait a moment and try again.'});
    if(request.method!=='GET' && (request.headers.origin!==origin || request.headers['sec-fetch-site']==='cross-site')) return reply.code(403).send({error:'Open your game page to make changes.'});
  });
  http.setErrorHandler((error,_request,reply)=>{
    const code=error instanceof z.ZodError?400:error instanceof Error && 'statusCode' in error && typeof error.statusCode==='number'?error.statusCode:500;
    reply.code(code).send({error:error instanceof z.ZodError?'Please check the details and try again.':code<500 && error instanceof Error?error.message:'Something went wrong. Please try again.'});
  });
  const accessFor=async(token:string|undefined)=>{const access=await auth.resolve(token,now());if(!access) throw new AccessError();return access;};
  const disconnectSession=(hash:string)=>{for(const id of [...(sessionSockets.get(hash)??[])])io.sockets.sockets.get(id)?.disconnect(true);};
  http.get('/api/health',async()=>({ok:true}));
  http.post('/api/rooms',async(request,reply)=>{
    z.object({}).strict().parse(request.body);
    if(await auth.resolve(request.cookies.couple_session,now())) throw new RoomCommandError('You already have a game open. Sign out before starting another.');
    if(!creationLimit.consume(request.ip,now()) || !globalCreationLimit.consume('all',now())) throw new CapacityError('Too many games started. Please try again in an hour.');
    const partnerKey=newToken();const creatorKey=`cog1.${newToken()}.${partnerKey}`;const roomId=randomUUID();
    await store.createRoom({roomId,invitationHashes:[hashToken(creatorKey),hashToken(partnerKey)],maxRooms:limits.maxRooms,now:now()});
    try {
      const result=await auth.login(creatorKey,request.cookies.couple_session,now());
      const room=await rooms.state(result.access,now());
      reply.setCookie('couple_session',result.token,{path:'/',httpOnly:true,sameSite:'strict',secure:config.production,maxAge:SESSION_MS/1000});
      return reply.code(201).send({room,invitations:{creatorKey,partnerKey}});
    } catch(error) { await store.disableRoom(roomId,now());throw error; }
  });
  http.post('/api/login',async(request,reply)=>{
    const {key}=z.object({key:z.string().min(1).max(200)}).strict().parse(request.body);
    const previous=request.cookies.couple_session;const previousAccess=await auth.resolve(previous,now());const result=await auth.login(key,previous,now());
    if(previousAccess) disconnectSession(previousAccess.sessionHash);
    reply.setCookie('couple_session',result.token,{path:'/',httpOnly:true,sameSite:'strict',secure:config.production,maxAge:SESSION_MS/1000});
    return rooms.state(result.access,now());
  });
  http.register(async api=>{
    api.addHook('preHandler',async request=>{await accessFor(request.cookies.couple_session);});
    api.get('/api/session',async request=>rooms.state(await accessFor(request.cookies.couple_session),now()));
    api.get('/api/invitations',async request=>{
      const token=request.cookies.couple_session;const access=await accessFor(token);
      return {invitations:access.seat===0?invitationsFromSession(token!):null};
    });
    api.get('/api/invite',async()=>({url:`${origin}/`}));
    api.post('/api/setup',async request=>{await rooms.execute(await accessFor(request.cookies.couple_session),{type:'setup',...namesSchema.parse(request.body)},now());return {ok:true};});
    api.post('/api/logout',async(request,reply)=>{const access=await accessFor(request.cookies.couple_session);await auth.logout(request.cookies.couple_session);disconnectSession(access.sessionHash);reply.clearCookie('couple_session',{path:'/'});return {ok:true};});
  });
  io.use(async(socket,next)=>{
    try {
      const token=http.parseCookie(socket.handshake.headers.cookie ?? '').couple_session;const access=await accessFor(token);let set=sessionSockets.get(access.sessionHash);
      if(set && set.size>=limits.maxSocketsPerSession) throw new CapacityError('Too many open tabs for this session. Close a tab and try again.');
      if(!set){set=new Set();sessionSockets.set(access.sessionHash,set);}set.add(socket.id);socket.data.access=Object.freeze(access);
      const release=()=>{const ids=sessionSockets.get(access.sessionHash);ids?.delete(socket.id);if(!ids?.size)sessionSockets.delete(access.sessionHash);};socket.conn.once('close',release);socket.once('disconnect',release);next();
    } catch(error){next(error instanceof AccessError || error instanceof CapacityError?error:new Error('Unable to connect. Please try again.'));}
  });
  io.on('connection',socket=>{
    const access=socket.data.access as AccessContext;
    const ready=Promise.resolve(socket.join([roomChannel(access.roomId,access.seat),`session:${access.sessionHash}`])).then(()=>rooms.connect(access,socket.id,now()));
    void ready.catch(()=>socket.disconnect(true));
    socket.on('disconnect',()=>{void ready.catch(()=>{}).then(()=>rooms.disconnect(access,socket.id,now())).catch(()=>{});});
    const events=['setup','propose','ready','action','lobby','leave'];
    socket.onAny(event=>{if(!events.includes(event) && !actionLimit.consume(access.sessionHash,now())) socket.disconnect(true);});
    for(const event of events) socket.on(event,async(value:unknown,ack?: (value:{ok:boolean;revision?:number;error?:string})=>void)=>{
      try {
        await ready;const current=await store.resolveSession(access.sessionHash,now());if(!current || !sameAccess(current,access)){socket.disconnect(true);throw new AccessError();}
        if(!actionLimit.consume(access.sessionHash,now())) throw new CapacityError('Too many actions. Wait a moment and try again.');
        const result=await rooms.execute(access,command(event,value),now());if(typeof ack==='function')ack({ok:true,...result});
      } catch(error){if(typeof ack==='function')ack({ok:false,error:error instanceof z.ZodError?'That action is not valid.':error instanceof AccessError || error instanceof CapacityError || error instanceof RevisionConflict || error instanceof RoomCommandError?error.message:'Unable to save that action. Please reconnect and try again.'});}
    });
  });
  let sweepAt=0;let pending:Promise<void>|null=null;let closing=false;
  const timer=setInterval(()=>{
    if(pending || closing)return;
    pending=(async()=>{const time=now();if(time-sweepAt>=1000){sweepAt=time;for(const socket of [...io.sockets.sockets.values()]){const access=socket.data.access as AccessContext;const current=await store.resolveSession(access.sessionHash,time);if(!current || !sameAccess(current,access))socket.disconnect(true);}}await rooms.tick(time);})().catch(()=>{}).finally(()=>{pending=null;});
  },250);
  const root=resolve('dist');if(existsSync(root)){await http.register(staticFiles,{root});http.setNotFoundHandler((request,reply)=>request.url.startsWith('/api')?reply.code(404).send({error:'Not found.'}):reply.sendFile('index.html'));}
  await http.ready();
  const close=async()=>{if(closing)return;closing=true;clearInterval(timer);await pending;try{await rooms.close(now());}finally{await new Promise<void>(r=>io.close(()=>r()));await http.close();await store.close();}};
  return {http,io,close};
}
