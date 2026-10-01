import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';
let source = existsSync('.env') ? readFileSync('.env', 'utf8') : readFileSync('.env.example', 'utf8');
let env = parse(source);
for (const key of ['PARTNER_ONE_KEY', 'PARTNER_TWO_KEY']) {
  if (!env[key]) { const value = randomBytes(32).toString('base64url'); const pattern = new RegExp(`^${key}=.*$`, 'm'); source = pattern.test(source) ? source.replace(pattern, `${key}=${value}`) : source + `\n${key}=${value}\n`; }
}
writeFileSync('.env', source, { mode: 0o600 }); env = parse(source); mkdirSync('data', { recursive: true });
const origin = env.APP_ORIGIN || 'http://localhost:5173';
writeFileSync('data/invitations.html', `<!doctype html><meta name="viewport" content="width=device-width"><title>Your private invitations</title><style>body{font:18px system-ui;background:#fbf7ee;color:#26302d;max-width:500px;margin:80px auto;padding:24px}a{display:block;padding:20px;margin:20px 0;background:#d5eadf;color:#26302d;border-radius:14px}</style><h1>Your invitations</h1><p>Keep these links private. Open one yourself and send the other to your partner.</p><a href="${new URL('/#invite=' + encodeURIComponent(env.PARTNER_ONE_KEY), origin)}">Open the first seat ↗</a><a href="${new URL('/#invite=' + encodeURIComponent(env.PARTNER_TWO_KEY), origin)}">Open the second seat ↗</a><p>Personal names can be set in .env or entered together on the first visit.</p>`, { mode: 0o600 });
console.log('Private keys saved in ignored .env. Your two invitations are in ignored data/invitations.html.');
