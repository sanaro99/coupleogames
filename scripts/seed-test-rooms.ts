// Test-only seed. Never accepts an arbitrary database path or environment keys.
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { hashToken } from '../server/access.js';
const path=resolve('test-results/e2e.sqlite');
for(const suffix of ['', '-wal','-shm']) if(existsSync(path+suffix)) unlinkSync(path+suffix);
const store=new Store(path);
for(let room=0;room<8;room++) {
  const keys=room===0?['e2e-first-private-key-123456789','e2e-second-private-key-123456789']:[0,1].map(seat=>`e2e-room-${room}-seat-${seat}-private-key-123456789`);
  await store.createRoom({roomId:randomUUID(),invitationHashes:[hashToken(keys[0]),hashToken(keys[1])],maxRooms:100,now:Date.now()});
}
await store.close();
