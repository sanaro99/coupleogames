import { randomUUID } from 'node:crypto';
import type { GameAction, GameId, RoomState, Seat } from '../shared/types.js';
import { applyAction, createMatch, pauseMatch, resumeMatch, tickMatch, viewMatch } from './engine.js';
import { AccessError, RevisionConflict, type AccessContext, type PersistedRoom, type RoomRepository } from './repository.js';
import { sameAccess } from './access.js';

export type RoomCommand = { type: 'setup'; names: [string,string] } | { type: 'propose'; game: GameId } | { type: 'ready'; proposalId: string } | { type: 'action'; action: GameAction } | { type: 'leave'|'lobby'; matchId: string };
/** Only deliberate player-facing validation errors may cross the transport. */
export class RoomCommandError extends Error { readonly statusCode = 409; }
interface Runtime { room: PersistedRoom; connections: [Set<string>,Set<string>]; checkpoint: number; failed: boolean }
type Publisher = (roomId: string, views: [RoomState,RoomState]) => Promise<void>;

export class RoomManager {
  private readonly runtimes = new Map<string,Runtime>();
  private readonly queues = new Map<string,Promise<void>>();
  private closing = false;
  constructor(private readonly repository: RoomRepository, private readonly publish: Publisher) {}
  private queue<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(id) ?? Promise.resolve()).then(operation);
    const tail = result.then(()=>{},()=>{}); this.queues.set(id,tail);
    void tail.then(()=>{ if(this.queues.get(id)===tail) this.queues.delete(id); }); return result;
  }
  private async authorize(access: AccessContext, now: number): Promise<void> {
    const current = await this.repository.resolveSession(access.sessionHash,now);
    if (!current || !sameAccess(current,access)) throw new AccessError();
  }
  private recover(room: PersistedRoom): PersistedRoom {
    if (room.snapshot.match) pauseMatch(room.snapshot.match,room.savedAt);
    if (room.snapshot.proposal) { room.snapshot.proposal.ready=[false,false]; room.snapshot.proposal.id=randomUUID(); }
    return room;
  }
  private async runtime(id: string, now: number): Promise<Runtime> {
    let r = this.runtimes.get(id);
    if (!r || r.failed) {
      const stored = await this.repository.getRoom(id); if (!stored || stored.status!=='active') throw new AccessError();
      const recovered=this.recover(stored);
      if (r) {
        // Reconciliation must be durable and delivered to existing clients before
        // their next command can use a regenerated proposal or resumed deadline.
        r.room=recovered;
        if(this.online(r).every(Boolean) && r.room.snapshot.match) resumeMatch(r.room.snapshot.match,now);
        await this.commit(r,recovered,now);
      }
      else { r={room:recovered,connections:[new Set(),new Set()],checkpoint:now,failed:false}; this.runtimes.set(id,r); }
    }
    return r;
  }
  private online(r: Runtime): [boolean,boolean] { return [r.connections[0].size>0,r.connections[1].size>0]; }
  private async projection(r: Runtime, seat: Seat, now: number): Promise<RoomState> {
    return { roomId:r.room.id, revision:r.room.revision, seat, names:[...r.room.names], setup:r.room.setup, online:this.online(r), proposal:structuredClone(r.room.snapshot.proposal), match:r.room.snapshot.match ? viewMatch(r.room.snapshot.match,seat):null, records:await this.repository.getRecords(r.room.id), leaveVotes:[...r.room.snapshot.leaveVotes], serverTime:now };
  }
  private async commit(r: Runtime, next: PersistedRoom, now: number, broadcast = true): Promise<void> {
    try {
      r.room=await this.repository.saveRoom(r.room.id,r.room.revision,next,now); r.checkpoint=now;
      if(broadcast && !this.closing) await this.publish(r.room.id,[await this.projection(r,0,now),await this.projection(r,1,now)]);
      r.failed=false;
    } catch(error) { r.failed=true; throw error; }
  }
  async state(access: AccessContext, now: number): Promise<RoomState> {
    return this.queue(access.roomId,async()=>{ await this.authorize(access,now); return this.projection(await this.runtime(access.roomId,now),access.seat,now); });
  }
  async connect(access: AccessContext, socketId: string, now: number): Promise<void> {
    if(this.closing) throw new RoomCommandError('The server is closing.');
    return this.queue(access.roomId,async()=>{
      await this.authorize(access,now); const r=await this.runtime(access.roomId,now); r.connections[access.seat].add(socketId);
      const next=structuredClone(r.room); if(next.snapshot.match && this.online(r).every(Boolean)) resumeMatch(next.snapshot.match,now);
      await this.commit(r,next,now);
    });
  }
  async disconnect(access: AccessContext, socketId: string, now: number): Promise<void> {
    if(this.closing) return;
    return this.queue(access.roomId,async()=>{
      let r=this.runtimes.get(access.roomId); if(!r || !r.connections[access.seat].delete(socketId)) return;
      const stored=await this.repository.getRoom(access.roomId);
      if(stored?.status!=='active') { this.runtimes.delete(access.roomId); return; }
      // A prior failed pause cannot leave its running deadline authoritative.
      // Presence above remains real; reload timing from the durable checkpoint.
      if(r.failed) r=await this.runtime(access.roomId,now);
      const next=structuredClone(r.room);
      if(!this.online(r)[access.seat]) { if(next.snapshot.match) pauseMatch(next.snapshot.match,now); if(next.snapshot.proposal) next.snapshot.proposal.ready[access.seat]=false; }
      await this.commit(r,next,now); if(!this.online(r).some(Boolean)) this.runtimes.delete(access.roomId);
    });
  }
  async execute(access: AccessContext, command: RoomCommand, now: number): Promise<{revision:number}> {
    if(this.closing) throw new RoomCommandError('The server is closing.');
    return this.queue(access.roomId,async()=>{
      await this.authorize(access,now); const r=await this.runtime(access.roomId,now); const next=structuredClone(r.room); const snapshot=next.snapshot;
      try {
        switch(command.type) {
          case 'setup': if(next.setup) throw new RoomCommandError('Your names are already saved.'); next.names=command.names; next.setup=true; break;
          case 'propose':
            if(!next.setup) throw new RoomCommandError('Enter your names first.');
            if(snapshot.match && snapshot.match.phase!=='finished') throw new RoomCommandError('Finish this match first.');
            snapshot.match=null; snapshot.leaveVotes=[false,false]; snapshot.proposal={id:randomUUID(),game:command.game,ready:[false,false]}; break;
          case 'ready':
            if(!snapshot.proposal || snapshot.proposal.id!==command.proposalId) throw new RoomCommandError('The chosen game changed. Please get ready for this one.');
            snapshot.proposal.ready[access.seat]=true;
            if(snapshot.proposal.ready.every(Boolean) && this.online(r).every(Boolean)) { snapshot.match=createMatch(snapshot.proposal.game,now); snapshot.proposal=null; } break;
          case 'action':
            if(!snapshot.match) throw new RoomCommandError('Choose a game first.');
            try { applyAction(snapshot.match,access.seat,command.action,now); }
            catch (error) {
              if (error instanceof Error && error.constructor === Error) throw new RoomCommandError(error.message);
              throw error;
            }
            break;
          case 'lobby':
            if(!snapshot.match || snapshot.match.id!==command.matchId) throw new RoomCommandError('That match has changed.');
            if(snapshot.match.phase!=='finished') throw new RoomCommandError('Finish or leave this match together first.');
            snapshot.match=null; snapshot.proposal=null; snapshot.leaveVotes=[false,false]; break;
          case 'leave':
            if(!snapshot.match || snapshot.match.id!==command.matchId) throw new RoomCommandError('That match has changed.');
            if(snapshot.match.phase==='finished') break;
            snapshot.leaveVotes[access.seat]=!snapshot.leaveVotes[access.seat];
            if(snapshot.leaveVotes.every(Boolean)) {snapshot.match=null;snapshot.proposal=null;snapshot.leaveVotes=[false,false];} break;
        }
      } catch(error) {
        if(command.type==='action' && r.room.snapshot.match?.phase==='play' && snapshot.match?.phase==='reveal') await this.commit(r,next,now);
        throw error;
      }
      await this.commit(r,next,now); return {revision:r.room.revision};
    });
  }
  async tick(now: number): Promise<void> {
    if(this.closing) return;
    await Promise.allSettled([...this.runtimes.keys()].map(id=>this.queue(id,async()=>{
      const r=this.runtimes.get(id); if(!r || r.failed || !r.room.snapshot.match || !this.online(r).some(Boolean)) return;
      const stored=await this.repository.getRoom(id); if(stored?.status!=='active') { this.runtimes.delete(id); return; }
      const next=structuredClone(r.room); const changed=tickMatch(next.snapshot.match!,now);
      if(changed) await this.commit(r,next,now);
      else if(next.snapshot.match!.deadline && now-r.checkpoint>=5000) await this.commit(r,next,now,false);
    })));
  }
  async close(now: number): Promise<void> {
    this.closing=true; await Promise.all([...this.queues.values()]);
    for(const r of this.runtimes.values()) {
      const current=await this.repository.getRoom(r.room.id); if(current?.status!=='active') continue;
      const next=structuredClone(r.failed ? this.recover(current):r.room); if(next.snapshot.match) pauseMatch(next.snapshot.match,now);
      if(next.snapshot.proposal) next.snapshot.proposal.ready=[false,false];
      try { await this.commit(r,next,now,false); } catch(error) { if(!(error instanceof RevisionConflict)) throw error; }
    }
    this.runtimes.clear();
  }
}
