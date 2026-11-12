// Vercel serverless entry. All routes are rewritten here (see vercel.json).
import { createApp } from '../src/app.js';

const app = createApp();
export default app;
