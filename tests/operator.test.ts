import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { runOperator, writeInvitationFile } from '../server/operator.js';
import { Store } from '../server/store.js';
const paths: string[] = [];
afterEach(() => { for (const p of paths.splice(0)) rmSync(p, { recursive: true, force: true }); });
function fixture() { const path = mkdtempSync(join(tmpdir(), 'cog-operator-')); paths.push(path); const logs: string[] = []; return { path, databasePath: join(path, 'db.sqlite'), origin: 'http://localhost:5173', stdout: (s: string) => logs.push(s), stderr: (s: string) => logs.push(s), logs }; }
describe('private operator commands', () => {
  it('operator_never_exposes_secrets_or_overwrites_output', async () => {
    const f = fixture(); const file = join(f.path, 'invitations.html'); expect(await runOperator(['create','--output',file], f)).toBe(0);
    const body = readFileSync(file, 'utf8'); const tokens = [...body.matchAll(/#invite=([a-zA-Z0-9_-]+)/g)].map(m => m[1]); expect(tokens).toHaveLength(2); expect(tokens[0]).not.toBe(tokens[1]);
    for (const token of tokens) expect(f.logs.join(' ')).not.toContain(token);
    const db = new DatabaseSync(f.databasePath); const seats = db.prepare('SELECT invitation_hash FROM room_seats').all(); expect(seats).toHaveLength(2); for (const token of tokens) expect(JSON.stringify(seats)).not.toContain(token); db.close();
    expect(await runOperator(['create','--output',file], f)).toBe(1); expect(readFileSync(file,'utf8')).toBe(body);
    const s = new Store(f.databasePath); expect(await s.listRooms()).toHaveLength(1); await s.close();
  });
  it('output failure or database cap creates no room or leftover credential file', async () => {
    const f = fixture(); const directory = join(f.path,'directory'); mkdirSync(directory);
    expect(await runOperator(['create','--output',directory], f)).toBe(1); const file=join(f.path,'one.html'); expect(await runOperator(['create','--output',file], { ...f, maxRooms: 1 })).toBe(0);
    const refused=join(f.path,'two.html'); expect(await runOperator(['create','--output',refused], { ...f, maxRooms: 1 })).toBe(1); expect(existsSync(refused)).toBe(false);
    const s = new Store(f.databasePath); expect(await s.listRooms()).toHaveLength(1); await s.close();
  });
  it('rotate and disable preserve the room and reject a third seat', async () => {
    const f=fixture(); await runOperator(['create','--output',join(f.path,'one.html')], f); const s=new Store(f.databasePath); const room=(await s.listRooms())[0]; await s.close();
    expect(await runOperator(['rotate','--room',room.id,'--seat','2','--output',join(f.path,'bad.html')],f)).toBe(1); expect(existsSync(join(f.path,'bad.html'))).toBe(false);
    expect(await runOperator(['rotate','--room',room.id,'--seat','0','--output',join(f.path,'fresh.html')],f)).toBe(0); expect([...readFileSync(join(f.path,'fresh.html'),'utf8').matchAll(/#invite=/g)]).toHaveLength(1);
    expect(await runOperator(['disable','--room',room.id],f)).toBe(0); const check=new Store(f.databasePath); expect((await check.getRoom(room.id))?.status).toBe('disabled'); await check.close();
  });
  it('rejects output inside static directories', () => { expect(() => writeInvitationFile(join(process.cwd(),'public','should-not-exist.html'),'x')).toThrow('static'); });
});
