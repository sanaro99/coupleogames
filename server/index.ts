import 'dotenv/config';
import { createApp } from './app.js';
const app = await createApp({ databasePath: process.env.DATABASE_PATH ?? './data/coupleogames.sqlite', names: [process.env.PARTNER_ONE_NAME ?? '', process.env.PARTNER_TWO_NAME ?? ''], keys: [process.env.PARTNER_ONE_KEY ?? '', process.env.PARTNER_TWO_KEY ?? ''], origin: process.env.APP_ORIGIN ?? 'http://localhost:5173', production: process.env.NODE_ENV === 'production' });
await app.http.listen({ port: Number(process.env.PORT ?? 3001), host: process.env.HOST ?? '127.0.0.1' });
console.log('CoupleOGames is ready. Open your private invitation from data/invitations.html.');
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { if (closing) return; closing = true; await app.close(); process.exit(0); });
