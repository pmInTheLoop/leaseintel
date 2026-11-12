// FALLBACK ONLY: use if the Claude connector fails during recording, and say so on camera.
// This is NOT Claude. It sends the hand-written reference extraction of samples/indiranagar-cafe-lease.pdf
// (test/fixtures/samples.js), with one deliberate mistake (5% instead of 15% escalation) for the reviewer to catch,
// to the same MCP endpoint Claude uses, through the official MCP client.
// Usage: node scripts/fallback-demo.mjs https://<your-domain> [mcp-key]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { INDIRANAGAR } from '../test/fixtures/samples.js';

const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const key = process.argv[3] || 'li_demo_volopay_2026';
const client = new Client({ name: 'leaseintel-fallback-demo', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${key}`)));
const payload = { ...INDIRANAGAR.payload, escalation_percent: 5 };
const r = await client.callTool({ name: 'create_lease', arguments: payload });
const text = r.content[0].text;
if (r.isError) { console.error(text); process.exit(1); }
const out = JSON.parse(text);
console.log(`Scripted MCP client (not Claude) created lease ${out.lease_id}: ${out.app_url}`);
console.log('Deliberate mistake to correct in the app: Escalation % is 5; Clause 4.1 says 15.');
await client.close();
