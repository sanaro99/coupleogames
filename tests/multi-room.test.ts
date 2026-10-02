import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { io, type Socket } from 'socket.io-client';
import { createApp, type AppConfig } from '../server/app.js';
import { Store } from '../server/store.js';
import { provisionRooms } from './support/rooms.js';
import type { RoomState, GameId } from '../shared/types.js';
import { hashToken } from '../server/access.js';
const cleanups: Array<()=>Promise<void>|void>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const c of cleanups.splice(0).reverse()) await c();});
const delay=(ms=50)=>new Promise<void>(r=>setTimeout(r,ms));
function wait<T>(socket:Socket,event:string,predicate:(v:T)=>boolean=()=>true):Promise<T>{return new Promise((resolve,reject)=>{const t=setTimeout(()=>{socket.off(event,receive);reject(new Error(`Timed out ${event}`));},3000);function receive(v:T){if(predicate(v)){clearTimeout(t);socket.off(event,receive);resolve(v);}}socket.on(event,receive);});}
async function fixture(options: Partial<AppConfig>={}, freezeTime=false) {
  const dir=mkdtempSync(join(tmpdir(),'cog-http-'));cleanups.push(()=>rmSync(dir,{recursive:true,force:true}));const databasePath=join(dir,'db.sqlite'); const seed=new Store(databasePath);const f=await provisionRooms(seed);await seed.close();
  // Hold time still while proving action isolation; deadline progression has its
  // own injected-clock runtime tests and must not create unrelated checkpoints.
  const clock=Date.now();
  const config: AppConfig={databasePath,origin:'http://localhost:5173',production:false,...options};const app=await createApp(config,{now:()=>freezeTime?clock:Date.now()});cleanups.push(app.close);await app.http.listen({host:'127.0.0.1',port:0});const address=app.http.server.address();const url=`http://127.0.0.1:${typeof address==='object'&&address?address.port:0}`;
  const inspector=new Store(databasePath);cleanups.push(()=>inspector.close());
  const cookies:string[]=[];const sockets:Socket[]=[];const events:RoomState[][]=[[],[],[],[]];
  for(let i=0;i<4;i++){const r=await app.http.inject({method:'POST',url:'/api/login',headers:{origin:config.origin},payload:{key:f.keys[i]}});expect(r.statusCode).toBe(200);const cookie=(r.headers['set-cookie'] as string).split(';')[0];cookies.push(cookie);const s=io(url,{transports:['websocket'],extraHeaders:{origin:config.origin,cookie},reconnection:false});s.on('state',v=>events[i].push(v));sockets.push(s);await wait<RoomState>(s,'state');}
  cleanups.push(()=>sockets.forEach(s=>s.disconnect()));await delay();
  const state=async(i:number)=>structuredClone(events[i].at(-1)!);
  const read=async(i:number)=>(await app.http.inject({url:'/api/session',headers:{cookie:cookies[i]}})).json() as RoomState;
  const emit=(i:number,event:string,value:unknown)=>new Promise<{ok:boolean;error?:string;revision?:number}>(r=>sockets[i].timeout(3000).emit(event,value,(err:Error|null,result:any)=>r(err?{ok:false,error:err.message}:result)));
  const isolated=async(i:number,event:string,value:unknown)=>{const other=i<2?2:0;const before=await state(other);const otherId=f.ids[Math.floor(other/2)];const persisted=await inspector.getRoom(otherId);const records=await inspector.getRecords(otherId);const lengths=[events[other].length,events[other+1].length];const partner=i%2===0?i+1:i-1;const revision=events[partner].at(-1)?.revision??-1;const delivery=wait<RoomState>(sockets[partner],'state',v=>v.revision>revision);const result=await emit(i,event,value);expect(result.ok,result.error).toBe(true);const received=await delivery;expect(received.roomId).toBe(f.ids[Math.floor(i/2)]);await delay();expect([events[other].length,events[other+1].length]).toEqual(lengths);expect((await state(other)).revision).toBe(before.revision);expect(await inspector.getRoom(otherId)).toEqual(persisted);expect(await inspector.getRecords(otherId)).toEqual(records);return await state(i);};
  const start=async(i:number,game:GameId)=>{let s=await isolated(i,'propose',{game});await isolated(i,'ready',{proposalId:s.proposal!.id});s=await isolated(i+1,'ready',{proposalId:s.proposal!.id});return s.match!;};
  await isolated(0,'setup',{names:['Ada','Bea']});await isolated(2,'setup',{names:['Cal','Dee']});
  return {...f,app,config,url,cookies,sockets,events,state,read,emit,isolated,start,databasePath};
}
describe('simultaneous private HTTP and socket rooms',()=>{
  it('isolates every room command, secret answer, history, and reconnect',async()=>{
    const f=await fixture({},true);const a=await f.start(0,'sync');await f.start(2,'doodle');
    const act=(i:number,type:string,extra:object={})=>f.state(i).then(s=>f.isolated(i,'action',{id:crypto.randomUUID(),matchId:s.match!.id,round:s.match!.round,phase:s.match!.phase,type,...extra}));
    await act(0,'answer',{text:'a-private-snack'});expect(JSON.stringify(f.events[1])).not.toContain('a-private-snack');expect(JSON.stringify(f.events[2])).not.toContain('a-private-snack');
    await act(1,'answer',{text:'a-private-snack'});
    for(let round=0;round<6;round++){if(round>0){await act(0,'answer',{text:'yes'});await act(1,'answer',{text:'yes'});}await act(0,'next');await act(1,'next');}
    expect((await f.read(0)).records).toHaveLength(1);expect((await f.read(2)).records).toEqual([]);expect((await f.read(0)).records[0].id).toBe(a.id);await f.isolated(0,'lobby',{matchId:a.id});
    await f.start(0,'know');const b=(await f.state(2)).match!;const forged=await f.emit(0,'action',{id:'foreign',matchId:b.id,round:b.round,phase:b.phase,type:'answer',choice:0});expect(forged.ok).toBe(false);
    await act(0,'answer',{choice:0});await act(1,'guess',{choice:0});await f.isolated(0,'leave',{matchId:(await f.state(0)).match!.id});await f.isolated(1,'leave',{matchId:(await f.state(1)).match!.id});
    await f.start(0,'clue');await act(0,'clue',{text:'cozy',count:2});await act(1,'endturn');
    const raw=new Store(f.databasePath);const match=(await raw.getRoom(f.ids[0]))!.snapshot.match!;const tile=match.keys.findIndex(k=>k===`target${match.clueGiver}`);await raw.close();
    await act(1,'clue',{text:'bright',count:2});await act(0,'tile',{choice:tile});
    await act(2,'stroke',{stroke:{color:'#26302d',width:.01,points:[{x:.2,y:.3}]}});await act(2,'clear');await act(3,'guess',{text:'probably-wrong'});
    const before=await f.state(0);const paused=wait<RoomState>(f.sockets[2],'state',s=>s.match?.paused===true);f.sockets[3].disconnect();expect((await paused).roomId).toBe(f.ids[1]);expect((await f.state(0)).revision).toBe(before.revision);
    expect(JSON.stringify(f.events[2])).not.toContain('Ada');expect(JSON.stringify(f.events[0])).not.toContain('Cal');
  },15000);
  it('denies anonymous requests, forged membership, cross-site or missing origins',async()=>{
    const f=await fixture();expect((await f.app.http.inject('/api/session')).statusCode).toBe(401);
    for(const payload of [{key:f.keys[0],roomId:f.ids[1]},{key:f.keys[0],seat:1}])expect((await f.app.http.inject({method:'POST',url:'/api/login',headers:{origin:f.config.origin},payload})).statusCode).toBe(400);
    for(const origin of ['https://evil.example',undefined])expect((await f.app.http.inject({method:'POST',url:'/api/setup',headers:{cookie:f.cookies[0],...(origin?{origin}:{})},payload:{names:['Wrong','People']}})).statusCode).toBe(403);
    const invite=await f.app.http.inject({url:'/api/invite',headers:{cookie:f.cookies[0]}});expect(invite.json().url).toBe(`${f.config.origin}/`);for(const key of f.keys)expect(invite.body).not.toContain(key);
    const unauthorized=io(f.url,{transports:['websocket'],extraHeaders:{origin:f.config.origin},reconnection:false});expect((await wait<Error>(unauthorized,'connect_error')).message).toContain('invitation');unauthorized.disconnect();
    expect((await f.state(0)).names).toEqual(['Ada','Bea']);expect((await f.state(2)).names).toEqual(['Cal','Dee']);
    const a=await f.isolated(0,'propose',{game:'sync'});const b=await f.isolated(2,'propose',{game:'know'});
    const before=f.events.map(events=>events.length);expect((await f.emit(0,'ready',{proposalId:b.proposal!.id})).ok).toBe(false);await delay();expect(f.events.map(events=>events.length)).toEqual(before);expect((await f.read(0)).proposal?.id).toBe(a.proposal!.id);expect((await f.read(2)).proposal?.ready).toEqual([false,false]);
  });
  it('rotation, logout, and disable remove established sockets without disturbing other rooms',async()=>{
    const f=await fixture();const raw=new Store(f.databasePath);const disconnected=wait(f.sockets[0],'disconnect');await raw.rotateSeat(f.ids[0],0,hashToken('fresh'),Date.now());await disconnected;expect(f.sockets[1].connected).toBe(true);expect(f.sockets[2].connected).toBe(true);
    expect((await f.app.http.inject({url:'/api/session',headers:{cookie:f.cookies[0]}})).statusCode).toBe(401);const out=wait(f.sockets[1],'disconnect');await f.app.http.inject({method:'POST',url:'/api/logout',headers:{cookie:f.cookies[1],origin:f.config.origin},payload:{}});await out;
    const b0=wait(f.sockets[2],'disconnect');const b1=wait(f.sockets[3],'disconnect');await raw.disableRoom(f.ids[1],Date.now());await Promise.all([b0,b1]);expect((await raw.getRoom(f.ids[1]))?.names).toEqual(['Cal','Dee']);await raw.close();
  },10000);
  it('caps socket tabs and aggregates the action budget by session',async()=>{
    const f=await fixture({maxSocketsPerSession:2});const tab=io(f.url,{transports:['websocket'],extraHeaders:{origin:f.config.origin,cookie:f.cookies[0]},reconnection:false});cleanups.push(()=>{tab.disconnect();});await wait(tab,'state');
    const extra=io(f.url,{transports:['websocket'],extraHeaders:{origin:f.config.origin,cookie:f.cookies[0]},reconnection:false});cleanups.push(()=>{extra.disconnect();});expect((await wait<Error>(extra,'connect_error')).message).toContain('tabs');
    for(let n=0;n<180;n++){const socket=n%2?tab:f.sockets[0];await new Promise<void>(r=>socket.emit('action',{},()=>r()));}const denied=await f.emit(0,'propose',{game:'sync'});expect(denied.ok).toBe(false);expect(denied.error).toContain('Too many');expect((await f.state(2)).proposal).toBeNull();
  },10000);
  it('failed persistence returns no storage details or success and broadcasts nothing', async () => {
    const f = await fixture();
    const before = await f.read(0);
    const counts = f.events.map(events => events.length);
    vi.spyOn(Store.prototype, 'saveRoom').mockRejectedValueOnce(new Error('private-storage-path-and-customer-data'));
    const result = await f.emit(0, 'propose', { game: 'sync' });
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain('private-storage-path-and-customer-data');
    expect(result.error).toContain('Unable to save');
    await delay();
    expect(f.events.map(events => events.length)).toEqual(counts);
    const inspector = new Store(f.databasePath);
    try { expect((await inspector.getRoom(f.ids[0]))!.revision).toBe(before.revision); }
    finally { await inspector.close(); }
    expect((await f.read(0)).proposal).toEqual(before.proposal);
    // A later successful read reconciles durably; it does not resurrect the
    // rejected proposal, and all subsequent reads keep that same revision.
    expect((await f.read(0)).revision).toBe(before.revision + 1);
  });
  it('a transient ready-save failure resynchronizes existing sockets before retrying', async () => {
    const f = await fixture();
    const proposed = await f.isolated(0, 'propose', { game: 'sync' });
    const oldId = proposed.proposal!.id;
    const counts = f.events.map(events => events.length);
    vi.spyOn(Store.prototype, 'saveRoom').mockRejectedValueOnce(new Error('one failed write'));
    expect((await f.emit(0, 'ready', { proposalId: oldId })).ok).toBe(false);
    await delay();
    expect(f.events.map(events => events.length)).toEqual(counts);
    // The old command is rejected, but reconciliation must reach both connected
    // clients so they can acknowledge the recovered proposal without a reload.
    expect((await f.emit(1, 'ready', { proposalId: oldId })).ok).toBe(false);
    await delay();
    const recovered = (await f.state(0)).proposal!;
    expect(recovered.id).not.toBe(oldId);
    expect((await f.state(1)).proposal).toEqual(recovered);
    expect(recovered.ready).toEqual([false, false]);
    const inspector = new Store(f.databasePath);
    try { expect((await inspector.getRoom(f.ids[0]))!.snapshot.proposal).toEqual(recovered); }
    finally { await inspector.close(); }
    expect(f.events[2].length).toBe(counts[2]);
    expect(f.events[3].length).toBe(counts[3]);
    await f.isolated(0, 'ready', { proposalId: recovered.id });
    await f.isolated(1, 'ready', { proposalId: recovered.id });
    expect((await f.state(0)).match?.game).toBe('sync');
  });
});
