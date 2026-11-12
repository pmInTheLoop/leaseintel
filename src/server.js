// Local / long-running server entry (Render, Railway, Fly, a VM, or your laptop).
import { createApp } from './app.js';
import { getDb } from './db.js';

const port = Number(process.env.PORT || 3000);
await getDb(); // create tables and seed the demo workspace before taking traffic
createApp().listen(port, () => console.log(`LeaseIntel listening on http://localhost:${port}`));
