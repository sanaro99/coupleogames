import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { GameAction, RoomState } from '../../shared/types';
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Please try again.'); return result as T;
}
function takeInvite(): string | null {
  const invite=new URLSearchParams(location.hash.slice(1)).get('invite');
  if(invite)history.replaceState(null,'',location.pathname+location.search);return invite;
}
export function useRoom() {
  const [room,setRoom]=useState<RoomState|null>(null);const [loading,setLoading]=useState(true);const [connected,setConnected]=useState(false);const [error,setError]=useState('');
  const [generation,setGeneration]=useState(0);const authVersion=useRef(0);const socket=useRef<Socket|null>(null);const roomRef=useRef(room);roomRef.current=room;
  const boot=useRef<Promise<RoomState|null>|null>(null);const authChain=useRef<Promise<unknown>>(Promise.resolve());const channel=useRef<BroadcastChannel|null>(null);
  const begin=useCallback(()=>{
    const version=++authVersion.current;socket.current?.removeAllListeners();socket.current?.disconnect();socket.current=null;roomRef.current=null;setRoom(null);setConnected(false);setLoading(true);setGeneration(version);return version;
  },[]);
  const refresh=useCallback(async()=>{
    const version=begin();const task=authChain.current.catch(()=>{}).then(async()=>{
      try{const value=await api<RoomState>('session');if(authVersion.current===version)setRoom(value);}
      catch{if(authVersion.current===version)setRoom(null);}
      finally{if(authVersion.current===version)setLoading(false);}
    });authChain.current=task;await task;
  },[begin]);
  const login=useCallback(async(key:string)=>{
    const version=begin();const task=authChain.current.catch(()=>{}).then(async()=>{
      try{const value=await api<RoomState>('login',{key:key.trim()});channel.current?.postMessage({type:'access-changed'});if(authVersion.current===version){setRoom(value);setError('');}}
      catch(e){let previous:RoomState|null=null;try{previous=await api<RoomState>('session');}catch{}if(authVersion.current===version){setRoom(previous);setError((e as Error).message);}}
      finally{if(authVersion.current===version)setLoading(false);}
    });authChain.current=task;await task;
  },[begin]);
  useEffect(()=>{
    let cancelled=false;const version=authVersion.current;
    if(!boot.current){
      const invite=takeInvite();
      boot.current=authChain.current.then(async()=>{
        if(!invite)return api<RoomState>('session');
        try{const value=await api<RoomState>('login',{key:invite});channel.current?.postMessage({type:'access-changed'});return value;}
        catch(e){
          if(authVersion.current===version)setError((e as Error).message);
          try{return await api<RoomState>('session');}catch{return null;}
        }
      });
      authChain.current=boot.current.catch(()=>{});
    }
    boot.current.then(value=>{if(!cancelled && authVersion.current===version)setRoom(value);}).catch(e=>{if(!cancelled && authVersion.current===version && !e.message.includes('invitation'))setError(e.message);}).finally(()=>{if(!cancelled && authVersion.current===version)setLoading(false);});
    return()=>{cancelled=true;};
  },[]);
  useEffect(()=>{
    const change=()=>{const invite=takeInvite();if(invite)void login(invite);};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);
  },[login]);
  useEffect(()=>{
    if(typeof BroadcastChannel==='undefined')return;const c=new BroadcastChannel('coupleogames-access');channel.current=c;c.onmessage=e=>{if(e.data?.type==='access-changed')void refresh();};return()=>{c.close();if(channel.current===c)channel.current=null;};
  },[refresh]);
  const roomId=room?.roomId;const seat=room?.seat;
  useEffect(()=>{
    if(!roomId || seat===undefined)return;
    const version=authVersion.current;const s=io({autoConnect:true,withCredentials:true,transports:['websocket','polling']});socket.current=s;
    const current=()=>authVersion.current===version && socket.current===s;
    s.on('state',(value:RoomState)=>{if(!current() || value.roomId!==roomId || value.seat!==seat)return;setRoom(previous=>previous && previous.roomId===roomId && value.revision>=previous.revision?value:previous);});
    s.on('connect',()=>{if(current())setConnected(true);});
    s.on('disconnect',reason=>{if(!current())return;setConnected(false);if(reason==='io server disconnect')void refresh();});
    s.on('connect_error',e=>{if(!current())return;setConnected(false);if(e.message.includes('invitation'))void refresh();else setError(e.message);});
    return()=>{s.removeAllListeners();s.disconnect();if(socket.current===s){socket.current=null;setConnected(false);}};
  },[roomId,seat,generation,refresh]);
  const send=useCallback(async(event:string,value:unknown={})=>{
    const s=socket.current;const version=authVersion.current;if(!s?.connected){setError('Reconnecting. Try again in a moment.');return false;}setError('');
    return await new Promise<boolean>(resolve=>{s.timeout(6000).emit(event,value,(failure:Error|null,result?:{ok:boolean;error?:string})=>{if(version!==authVersion.current || socket.current!==s){resolve(false);return;}if(failure || !result?.ok){setError(result?.error ?? 'Connection lost. Reconnecting…');resolve(false);}else resolve(true);});});
  },[]);
  const act=useCallback((value:Pick<GameAction,'type'> & Partial<GameAction>)=>{const m=roomRef.current?.match;if(!m)return Promise.resolve(false);return send('action',{...value,id:globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,matchId:m.id,round:m.round,phase:m.phase});},[send]);
  const logout=useCallback(async()=>{
    const version=begin();const task=authChain.current.catch(()=>{}).then(async()=>{try{await api('logout',{});channel.current?.postMessage({type:'access-changed'});}catch(e){if(authVersion.current===version)setError((e as Error).message);}finally{if(authVersion.current===version)setLoading(false);}});authChain.current=task;await task;
  },[begin]);
  return {room,loading,connected,error,setError,send,act,login,logout};
}
export type Act=ReturnType<typeof useRoom>['act'];
