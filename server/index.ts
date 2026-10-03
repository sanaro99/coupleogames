import 'dotenv/config';
import { createApp } from './app.js';
import { limitsFromEnv } from './limits.js';
const app = await createApp({ databasePath: process.env.DATABASE_PATH ?? './data/coupleogames.sqlite', origin: process.env.APP_ORIGIN ?? 'http://localhost:5173', production: process.env.NODE_ENV === 'production', ...limitsFromEnv(process.env), trustedProxyAddresses: process.env.TRUSTED_PROXY_ADDRESSES?.split(',').map(v => v.trim()).filter(Boolean) });
await app.http.listen({ port: Number(process.env.PORT ?? 3001), host: process.env.HOST ?? '127.0.0.1' });
console.log('CoupleOGames is ready. Players can start a game and share a private partner invitation.');
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { if (closing) return; closing = true; await app.close(); process.exit(0); });
