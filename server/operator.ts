import { randomUUID } from 'node:crypto';
import { writeInvitationFile, invitationDocument } from './invitations.js';
export { writeInvitationFile, invitationDocument } from './invitations.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Store } from './store.js';
import { hashToken, newToken } from './access.js';
import { limitsFromEnv, positiveInteger } from './limits.js';
import { migrateLegacy } from './migrations.js';
import type { Seat } from '../shared/types.js';

export interface OperatorConfig { databasePath: string; origin: string; maxRooms?: number; legacyNameDefaults?: [string,string]; stdout?: (value: string) => void; stderr?: (value: string) => void }
export async function runOperator(argv: string[], config: OperatorConfig): Promise<number> {
  let store: Store | undefined; let removeOutput: (() => void) | undefined;
  const out = config.stdout ?? console.log; const err = config.stderr ?? console.error;
  try {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: { output: { type: 'string' }, room: { type: 'string' }, seat: { type: 'string' }, backup:{type:'string'},offline:{type:'boolean'} } });
    const command = positionals[0]; if (positionals.length !== 1 || !['create','rotate','disable','list','migrate-legacy'].includes(command)) throw new Error('Invalid command.');
    if(command==='migrate-legacy') {
      if(!values.offline || !values.backup || !values.output)throw new Error('Stop the app and supply --offline, --backup and --output.');
      const result=await migrateLegacy({databasePath:config.databasePath,backupPath:values.backup,outputPath:values.output,legacyNameDefaults:config.legacyNameDefaults??['',''],origin:config.origin,now:Date.now()});out(`Migrated legacy room ${result.roomId}; ${result.recordCount} records preserved; private invitations: ${resolve(values.output)}`);return 0;
    }
    if ((command === 'create' || command === 'rotate') && !values.output) throw new Error('Private output required.');
    if ((command === 'rotate' || command === 'disable') && !values.room) throw new Error('Room required.');
    if (command === 'rotate' && values.seat !== '0' && values.seat !== '1') throw new Error('Only seats 0 and 1.');
    store = new Store(config.databasePath); const now = Date.now();
    if (command === 'create') {
      const id = randomUUID(); const tokens: [string,string] = [newToken(),newToken()];
      removeOutput = writeInvitationFile(values.output!, invitationDocument(config.origin, tokens.map((token, seat) => ({ seat: seat as Seat, token }))));
      await store.createRoom({ roomId: id, invitationHashes: [hashToken(tokens[0]),hashToken(tokens[1])], maxRooms: positiveInteger(config.maxRooms,100), now });
      removeOutput = undefined; out(`Room ${id}; private invitations: ${resolve(values.output!)}`);
    } else if (command === 'rotate') {
      const seat = Number(values.seat) as Seat; const token = newToken();
      removeOutput = writeInvitationFile(values.output!, invitationDocument(config.origin, [{seat,token}]));
      await store.rotateSeat(values.room!,seat,hashToken(token),now); removeOutput = undefined; out(`Rotated room ${values.room} seat ${seat}; private invitation: ${resolve(values.output!)}`);
    } else if (command === 'disable') { await store.disableRoom(values.room!,now); out(`Disabled room ${values.room}; saved data retained.`); }
    else out(JSON.stringify(await store.listRooms(),null,2));
    return 0;
  } catch { removeOutput?.(); err('Room command failed. Check arguments, schema, capacity, and private output permissions. No credentials are printed.'); return 1; }
  finally { await store?.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await import('dotenv/config');
  process.exitCode = await runOperator(process.argv.slice(2), { databasePath: process.env.DATABASE_PATH ?? './data/coupleogames.sqlite', origin: process.env.APP_ORIGIN ?? 'http://localhost:5173', maxRooms: limitsFromEnv(process.env).maxRooms, legacyNameDefaults:[process.env.PARTNER_ONE_NAME??'',process.env.PARTNER_TWO_NAME??''] });
}
