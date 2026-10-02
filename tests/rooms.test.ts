import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../server/store.js';
import { RoomManager } from '../server/rooms.js';
import { provisionRooms } from './support/rooms.js';
import { createMatch } from '../server/engine.js';
import { randomUUID } from 'node:crypto';
const stores: Store[]=[]; afterEach(async()=>{ vi.restoreAllMocks(); for(const s of stores.splice(0)) await s.close(); });
async function fixture() { const store=new Store(':memory:'); stores.push(store); const f=await provisionRooms(store,1000); const events: string[]=[]; const manager=new RoomManager(store,async(id)=>{events.push(id);}); for(let i=0;i<4;i++) await manager.connect(f.access[i],`s${i}`,1000); return {...f,store,manager,events}; }
async function start(f: Awaited<ReturnType<typeof fixture>>, index: number, game: 'sync'|'doodle' = 'sync') { await f.manager.execute(f.access[index],{type:'setup',names:index===0?['Ada','Bea']:['Cal','Dee']},1000); await f.manager.execute(f.access[index],{type:'propose',game},1000); const p=(await f.manager.state(f.access[index],1000)).proposal!; await f.manager.execute(f.access[index],{type:'ready',proposalId:p.id},1000); await f.manager.execute(f.access[index+1],{type:'ready',proposalId:p.id},1000); return (await f.manager.state(f.access[index],1000)).match!; }
describe('room runtimes',()=>{
  it('four_seats_have_independent_readiness_and_matches',async()=>{const f=await fixture(); await start(f,0); const b=await f.manager.state(f.access[2],1000); expect(b.names).toEqual(['','']); expect(b.match).toBeNull(); const a=await f.manager.state(f.access[0],1000); await start(f,2,'doodle'); expect((await f.manager.state(f.access[0],1000)).match?.id).toBe(a.match?.id); });
  it('last_disconnect_pauses_only_own_room',async()=>{const f=await fixture();await start(f,0,'doodle');await start(f,2,'doodle');await f.manager.connect(f.access[1],'tab',2000);await f.manager.disconnect(f.access[1],'s1',2000);expect((await f.manager.state(f.access[0],2000)).match?.paused).toBe(false); const b=await f.manager.state(f.access[2],2000);await f.manager.disconnect(f.access[1],'tab',21000);expect((await f.manager.state(f.access[0],21000)).match?.remainingMs).toBe(40000);expect(await f.manager.state(f.access[2],21000)).toMatchObject({revision:b.revision,match:{paused:false}});});
  it('room_checkpoints_do_not_share_clock',async()=>{const f=await fixture(); await start(f,0,'doodle');await start(f,2,'doodle');const a=(await f.store.getRoom(f.ids[0]))!.revision;await f.manager.tick(6000);expect((await f.store.getRoom(f.ids[0]))!.revision).toBe(a+1);expect((await f.store.getRoom(f.ids[1]))!.savedAt).toBe(6000);await f.manager.disconnect(f.access[1],'s1',6001);await f.manager.tick(61000);expect((await f.manager.state(f.access[0],61000)).match?.phase).toBe('play');expect((await f.manager.state(f.access[2],61000)).match?.phase).toBe('reveal');});
  it('foreign_match_or_proposal_cannot_select_room',async()=>{const f=await fixture();const a=await start(f,0); const b=await start(f,2);const before=await f.manager.state(f.access[2],1000);await expect(f.manager.execute(f.access[0],{type:'action',action:{id:'foreign',matchId:b.id,round:0,phase:'play',type:'answer',text:'wrong'}},1000)).rejects.toThrow();expect(await f.manager.state(f.access[2],1000)).toEqual(before);expect((await f.manager.state(f.access[0],1000)).match?.id).toBe(a.id);});
  it('failed_save_does_not_publish_or_acknowledge',async()=>{const f=await fixture();const m=await start(f,0);const n=f.events.length;vi.spyOn(f.store,'saveRoom').mockRejectedValueOnce(new Error('disk'));await expect(f.manager.execute(f.access[0],{type:'action',action:{id:'a',matchId:m.id,round:0,phase:'play',type:'answer',text:'never-saved'}},1000)).rejects.toThrow();expect(f.events).toHaveLength(n);expect((await f.store.getRoom(f.ids[0]))!.snapshot.match?.answers[0]).toBeNull();});
  it('late_action_persists_only_own_deadline_transition',async()=>{const f=await fixture();const m=await start(f,0,'doodle');await start(f,2);const b=(await f.store.getRoom(f.ids[1]))!.revision;await expect(f.manager.execute(f.access[1],{type:'action',action:{id:'late',matchId:m.id,round:0,phase:'play',type:'guess',text:'late'}},61000)).rejects.toThrow();expect((await f.store.getRoom(f.ids[0]))!.snapshot.match?.phase).toBe('reveal');expect((await f.store.getRoom(f.ids[1]))!.revision).toBe(b);});
  it('recovery_resets_readiness_and_pauses_from_saved_at',async()=>{const store=new Store(':memory:');stores.push(store);const f=await provisionRooms(store,1000);const r=(await store.getRoom(f.ids[0]))!;const match=createMatch('doodle',1000);await store.saveRoom(r.id,0,{...r,snapshot:{match,proposal:{id:randomUUID(),game:'sync',ready:[true,true]},leaveVotes:[true,false]}},21000);const mgr=new RoomManager(store,async()=>{});const state=await mgr.state(f.access[0],999000);expect(state.match).toMatchObject({paused:true,remainingMs:40000,deadline:null});expect(state.proposal?.ready).toEqual([false,false]);expect(state.leaveVotes).toEqual([true,false]);});
  it('conflicting_revision_resynchronizes',async()=>{const f=await fixture();await start(f,0);const r=(await f.store.getRoom(f.ids[0]))!;await f.store.saveRoom(r.id,r.revision,{...r,names:['New','Names']},2000);await expect(f.manager.execute(f.access[0],{type:'leave',matchId:r.snapshot.match!.id},2000)).rejects.toThrow('changed');expect((await f.manager.state(f.access[0],2000)).names).toEqual(['New','Names']);});
  it('offline_eviction_and_shutdown_preserve_state',async()=>{const f=await fixture();await start(f,0,'doodle');await f.manager.disconnect(f.access[0],'s0',2000);await f.manager.disconnect(f.access[1],'s1',2000);await f.manager.connect(f.access[0],'new',9000);expect((await f.manager.state(f.access[0],9000)).match?.remainingMs).toBe(59000);await f.manager.close(10000);expect((await f.store.getRoom(f.ids[0]))!.snapshot.match?.paused).toBe(true);});
  it('a second disconnect after a failed pause preserves time from the durable checkpoint', async () => {
    const f = await fixture();
    await start(f, 0, 'doodle');
    await f.manager.tick(16000);
    const other = await f.store.getRoom(f.ids[1]);
    vi.spyOn(f.store, 'saveRoom').mockRejectedValueOnce(new Error('one failed pause write'));
    await expect(f.manager.disconnect(f.access[1], 's1', 21000)).rejects.toThrow();
    await f.manager.disconnect(f.access[0], 's0', 91000);
    const stored = (await f.store.getRoom(f.ids[0]))!;
    expect(stored.snapshot.match).toMatchObject({ paused: true, deadline: null, remainingMs: 45000 });
    expect(await f.store.getRoom(f.ids[1])).toEqual(other);
    await f.manager.connect(f.access[0], 'back-a', 92000);
    await f.manager.connect(f.access[1], 'back-b', 92000);
    expect((await f.manager.state(f.access[0], 92000)).match).toMatchObject({ paused: false, deadline: 137000 });
  });
});
