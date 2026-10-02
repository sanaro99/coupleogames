import { closeSync, existsSync, mkdirSync, openSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { Seat } from '../shared/types.js';
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); };
/** Exclusive, private output; resolve existing parents so symlinks cannot target static roots. */
export function writePrivateFile(path: string, content: string): () => void {
  const target = resolve(path); let parent = dirname(target);
  while (!existsSync(parent)) parent = dirname(parent);
  const canonical = resolve(realpathSync(parent), relative(parent, target));
  for (const dir of ['public','dist']) {
    const root = resolve(dir); const canonicalRoot = existsSync(root) ? realpathSync(root) : root;
    if (inside(root, target) || inside(canonicalRoot, canonical)) throw new Error('Private output must be outside static directories.');
  }
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const fd = openSync(target, 'wx', 0o600);
  try { writeFileSync(fd, content, 'utf8'); } catch (error) { closeSync(fd); rmSync(target, { force: true }); throw error; }
  closeSync(fd); return () => rmSync(target, { force: true });
}
export const writeInvitationFile = writePrivateFile;
const html = (s: string) => s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]!);
export function invitationDocument(origin: string, entries: Array<{ seat: Seat; token: string }>): string {
  const url = new URL(origin); if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid app origin.');
  return `<!doctype html><meta name="viewport" content="width=device-width"><title>Private seat invitations</title><h1>Private invitations</h1><p>Give each link only to its intended partner. Anyone with a link can use that seat.</p>${entries.map(e => `<p><a href="${html(`${url.origin}/#invite=${encodeURIComponent(e.token)}`)}">Seat ${e.seat + 1}</a></p>`).join('')}`;
}
