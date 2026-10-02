import { randomUUID } from 'node:crypto';
import { Store } from '../../server/store.js';
import { AccessService, hashToken } from '../../server/access.js';
export async function provisionRooms(store: Store, now = Date.now()) {
  const ids = [randomUUID(),randomUUID()] as const;
  const keys = ['test-a0-private-key-123456789012345','test-a1-private-key-123456789012345','test-b0-private-key-123456789012345','test-b1-private-key-123456789012345'];
  for (let i=0;i<2;i++) await store.createRoom({ roomId: ids[i], invitationHashes: [hashToken(keys[i*2]),hashToken(keys[i*2+1])],maxRooms:100,now });
  const auth = new AccessService(store); const sessions = await Promise.all(keys.map(key => auth.login(key,undefined,now)));
  return { ids,keys,auth,sessions,access: sessions.map(s => s.access) };
}
