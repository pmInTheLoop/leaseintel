// Server-rendered HTML. Plain templates and a little vanilla JS. No frameworks, no AI.
// Design system: dark ink frame for navigation and key figures, warm paper workspace for reading and review.
// Inter for interface, Source Serif 4 only for words quoted from the agreement, JetBrains Mono for references.
import { FIELDS, FIELD_MAP, ENUM_LABEL } from './fields.js';
import { minorDigits } from './money.js';

export const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (n, cur = 'INR') => {
  if (n === null || n === undefined || n === '') return '';
  try {
    const digits = /\.\d*[1-9]/.test(String(n)) ? minorDigits(cur) : 0; // whole amounts without decimals, others with all of them
    return new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: cur, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(n));
  } catch { return `${cur} ${Number(n).toLocaleString('en-US')}`; }
};
const fmtDate = (ymd) => (ymd ? new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const fmtLong = (ymd) => (ymd ? new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
const isDemoName = (n) => /\(demo\)\s*$/i.test(String(n || ''));
const wsName = (n) => String(n || '').replace(/\s*\(demo\)\s*$/i, '');
const wsLabel = (n) => wsName(n) + (isDemoName(n) ? ' · Demo' : '');
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const fmtShort = (ymd) => (ymd ? new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');
const fmtTime = (ts) => (ts ? new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
const actor = (a) => (a === 'claude' ? 'Claude (via MCP)' : a === 'app' ? 'Setup' : a?.startsWith('team:') ? a.slice(5) : a);
const STATUS = { needs_review: ['Needs review', 'warn'], approved: ['Approved', 'ok'], expired: ['Expired', 'mute'], archived: ['Archived', 'mute'] };
const statusBadge = (s) => `<span class="badge b-${STATUS[s]?.[1] || 'mute'}">${STATUS[s]?.[0] || h(s)}</span>`;
const daysBadge = (d) => {
  if (d.state === 'done') return `<span class="badge b-ok">Done</span>`;
  if (d.state === 'missed') return `<span class="badge b-bad">Missed by ${-d.days_left}d</span>`;
  if (d.state === 'past') return `<span class="badge b-mute">Past</span>`;
  if (d.days_left === 0) return `<span class="badge b-bad">Today</span>`;
  return `<span class="badge ${d.days_left <= 30 ? 'b-bad' : d.days_left <= 90 ? 'b-warn' : 'b-mute'}">${d.days_left} ${d.days_left === 1 ? 'day' : 'days'} remaining</span>`;
};
const post = (url, body, extra = '') => `data-post="${url}" data-body='${h(JSON.stringify(body))}' ${extra}`;

// One small icon set: 20px grid, 1.5px stroke, round joins. Used only where it speeds up scanning.
const ICON = {
  check: '<path d="M5 10.5l3.2 3.2L15 7"/>',
  alert: '<path d="M10 3.5l7 12.5H3z"/><path d="M10 8.5v3.5M10 14.2v.3"/>',
  clock: '<circle cx="10" cy="10" r="6.5"/><path d="M10 6.5V10l2.5 1.5"/>',
  quote: '<path d="M4 8.5h4v4H4zM12 8.5h4v4h-4zM5.5 12.5c0 1.5-.7 2.5-2 3M13.5 12.5c0 1.5-.7 2.5-2 3"/>',
  download: '<path d="M10 3.5v9M6.5 9l3.5 3.5L13.5 9M4 15.5h12"/>',
  copy: '<rect x="7" y="7" width="9" height="9" rx="1.5"/><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7"/>',
  arrow: '<path d="M4 10h11M11 6l4 4-4 4"/>',
  back: '<path d="M16 10H5M9 6l-4 4 4 4"/>',
  plus: '<path d="M10 4.5v11M4.5 10h11"/>',
  spark: '<path d="M10 3v4M10 13v4M3 10h4M13 10h4M5.5 5.5l2 2M12.5 12.5l2 2M14.5 5.5l-2 2M7.5 12.5l-2 2"/>',
  doc: '<path d="M6 3.5h5.5L15 7v9.5H6z"/><path d="M11 3.5V7h4M8 10.5h5M8 13h5"/>',
};
const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 20 20" aria-hidden="true" focusable="false">${ICON[name] || ''}</svg>`;

const FONTS = `
@font-face{font-family:Inter;font-style:normal;font-weight:100 900;font-display:swap;src:url(/fonts/inter-latin-wght-normal.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:Inter;font-style:normal;font-weight:100 900;font-display:swap;src:url(/fonts/inter-latin-ext-wght-normal.woff2) format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:'Source Serif 4';font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/source-serif-4-latin-400-normal.woff2) format('woff2')}
@font-face{font-family:'Source Serif 4';font-style:italic;font-weight:400;font-display:swap;src:url(/fonts/source-serif-4-latin-400-italic.woff2) format('woff2')}
@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/jetbrains-mono-latin-400-normal.woff2) format('woff2')}`;

const CSS = `${FONTS}
:root{
--ink-0:#0B0C0E;--ink-1:#141619;--ink-2:#1D2024;--ink-line:rgba(255,255,255,.10);--ink-text:#F2F1EC;--ink-muted:#A3A59F;--ink-accent:#6FD6B4;
--paper:#F7F6F2;--panel:#FFFFFF;--sunk:#F2F1EC;--line:#E6E4DE;--line-2:#D4D1C8;--text:#16181B;--text-2:#494C51;--text-3:#787B7F;
--accent:#1F7A63;--accent-h:#17614F;--accent-soft:#E6F2ED;
--amber:#8F530A;--amber-bg:#FBF0DD;--amber-line:#EBCB93;--red:#B42318;--red-bg:#FCEBEA;--red-line:#F2B8B3;--violet:#5B47B8;--violet-bg:#EFEBFB;
--sans:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;--serif:'Source Serif 4',Georgia,'Times New Roman',serif;--mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
--r-ctl:6px;--r-panel:10px;--r-chip:4px;--float:0 14px 36px rgba(11,12,14,.18),0 2px 6px rgba(11,12,14,.08);--t-fast:120ms;--t-base:180ms}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font:15px/1.6 var(--sans);font-feature-settings:'cv11','ss03';color:var(--text);background:var(--paper);-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration-thickness:1px;text-underline-offset:3px}a:hover{color:var(--accent-h)}
h1,h2,h3{font-weight:600;letter-spacing:-.015em;margin:0}h1{font-size:28px;line-height:1.2}h2{font-size:20px;line-height:1.3}h3{font-size:15px;line-height:1.4}
p{margin:0 0 12px}.muted{color:var(--text-2)}.faint{color:var(--text-3)}.small{font-size:13px;line-height:1.5}.num{font-variant-numeric:tabular-nums}
.label{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3)}
.ic{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex:none}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.wrap{max-width:1200px;margin:0 auto;padding:0 24px}
header.top{background:var(--ink-0);color:var(--ink-text);border-bottom:1px solid var(--ink-line)}
header.top .wrap{display:flex;align-items:center;gap:28px;height:60px}
.logo{display:inline-flex;align-items:center;gap:10px;color:var(--ink-text);text-decoration:none;font-weight:650;font-size:16px;letter-spacing:-.01em}
.logo i{width:10px;height:10px;background:var(--ink-accent);display:inline-block;border-radius:2px}.logo b{font-weight:650}.logo b span{color:var(--ink-muted);font-weight:500}
.logo:hover{color:var(--ink-text)}
nav{display:flex;align-items:center;gap:22px;flex:1;font-size:14px}nav a{color:var(--ink-muted);text-decoration:none;font-weight:500;padding:19px 0;border-bottom:2px solid transparent}
nav a:hover{color:var(--ink-text)}nav a[aria-current=page]{color:var(--ink-text);border-bottom-color:var(--ink-accent)}
.who{margin-left:auto;display:flex;align-items:center;gap:14px;font-size:13px;color:var(--ink-muted)}
.band{background:var(--ink-0);color:var(--ink-text)}.band .wrap{padding-top:28px;padding-bottom:30px}
.band a{color:var(--ink-text)}.band .muted,.band .small{color:var(--ink-muted)}
.crumb{display:inline-flex;align-items:center;gap:6px;color:var(--ink-muted)!important;text-decoration:none;font-size:13px;margin-bottom:14px}.crumb:hover{color:var(--ink-text)!important}.crumb .ic{width:16px;height:16px}
.head{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap}.head .grow{flex:1;min-width:260px}.head .meta{margin-top:6px;font-size:14px}
.chips{display:inline-flex;gap:6px;flex-wrap:wrap;vertical-align:middle;margin-left:10px}
.figs{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin-top:26px;border-top:1px solid var(--ink-line)}
.fig{padding:18px 20px 4px 0}.fig+.fig{padding-left:20px;border-left:1px solid var(--ink-line)}
.fig .k{font-size:12px;color:var(--ink-muted);font-weight:500}.fig .v{font-size:30px;font-weight:600;letter-spacing:-.025em;line-height:1.15;margin-top:6px;font-variant-numeric:tabular-nums;color:var(--ink-text)}
.fig .s{font-size:12.5px;color:var(--ink-muted);margin-top:4px}.fig .s.warn{color:#E7B866}
.counts{display:flex;gap:8px 28px;flex-wrap:wrap;margin-top:18px;font-size:13px;color:var(--ink-muted)}.counts b{color:var(--ink-text);font-weight:600;font-size:15px;margin-right:6px;font-variant-numeric:tabular-nums}
main{padding:28px 0 80px}
.btn,button{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:36px;padding:0 14px;border-radius:var(--r-ctl);border:1px solid var(--line-2);background:var(--panel);color:var(--text);font:inherit;font-size:14px;font-weight:550;letter-spacing:-.005em;cursor:pointer;text-decoration:none;white-space:nowrap;transition:background var(--t-fast),border-color var(--t-fast),color var(--t-fast),transform var(--t-fast)}
.btn:hover,button:hover{border-color:var(--text-3);color:var(--text)}.btn:active,button:active{transform:translateY(1px)}
.btn.primary,button.primary{background:var(--text);border-color:var(--text);color:#fff}.btn.primary:hover,button.primary:hover{background:#2A2D31;border-color:#2A2D31;color:#fff}
.btn.go,button.go{background:var(--accent);border-color:var(--accent);color:#fff}.btn.go:hover,button.go:hover{background:var(--accent-h);border-color:var(--accent-h);color:#fff}
.btn.quiet,button.quiet{background:transparent;border-color:transparent;color:var(--text-2);padding:0 10px}.btn.quiet:hover,button.quiet:hover{background:var(--sunk);color:var(--text)}
.btn.danger,button.danger{color:var(--red);border-color:var(--red-line)}.btn.danger:hover,button.danger:hover{background:var(--red-bg);color:var(--red)}
.btn.sm,button.sm{height:30px;padding:0 10px;font-size:13px}
.band .btn,.band button,header.top .btn,header.top button{background:transparent;border-color:var(--ink-line);color:var(--ink-text)}.band .btn:hover,.band button:hover,header.top .btn:hover,header.top button:hover{border-color:var(--ink-muted);background:var(--ink-1)}
.band .btn.light{background:var(--ink-text);border-color:var(--ink-text);color:var(--ink-0)}.band .btn.light:hover{background:#fff;color:var(--ink-0)}
button:disabled{opacity:.45;cursor:not-allowed;transform:none}button.busy{opacity:.7;cursor:progress}
input,select,textarea{font:inherit;font-size:14px;height:36px;border:1px solid var(--line-2);border-radius:var(--r-ctl);padding:0 10px;width:100%;background:var(--panel);color:var(--text);transition:border-color var(--t-fast),box-shadow var(--t-fast)}
textarea{height:auto;min-height:120px;padding:10px;line-height:1.55}input:hover,select:hover,textarea:hover{border-color:var(--text-3)}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--text);box-shadow:0 0 0 3px rgba(22,24,27,.08)}
label{display:block;font-size:13px;font-weight:550;color:var(--text-2);margin:14px 0 6px}.hint{font-size:12.5px;color:var(--text-3);margin-top:5px}
.row{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.badge{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:var(--r-chip);font-size:12px;font-weight:600;white-space:nowrap;border:1px solid transparent}
.b-ok{background:var(--accent-soft);color:var(--accent)}.b-warn{background:var(--amber-bg);color:var(--amber)}.b-bad{background:var(--red-bg);color:var(--red)}.b-mute{background:var(--sunk);color:var(--text-2)}.b-claude{background:var(--violet-bg);color:var(--violet)}
.band .b-mute{background:var(--ink-2);color:var(--ink-muted)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-panel)}.panel+.panel{margin-top:16px}
.panel-h{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:16px 20px;border-bottom:1px solid var(--line)}.panel-h h2,.panel-h h3{flex:1}
.panel-b{padding:20px}.panel-f{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:14px 20px;border-top:1px solid var(--line);background:var(--panel);border-radius:0 0 var(--r-panel) var(--r-panel)}
.panel table td:first-child,.panel table th:first-child{padding-left:20px}.panel table td:last-child,.panel table th:last-child{padding-right:20px}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);text-align:left;padding:12px 10px;border-bottom:1px solid var(--line)}
td{padding:14px 10px;border-top:1px solid var(--line);vertical-align:top;font-size:14px}tbody tr:first-child td{border-top:0}tbody tr{transition:background var(--t-fast)}tbody tr:hover td{background:#FBFAF7}
td .sub{font-size:13px;color:var(--text-3);margin-top:2px}a.rowlink{color:var(--text);font-weight:600;text-decoration:none}a.rowlink:hover{color:var(--accent)}
.quote{font-family:var(--serif);font-size:15px;line-height:1.55;color:var(--text);background:var(--sunk);border-left:2px solid var(--line-2);border-radius:0;padding:8px 12px;margin-top:8px;white-space:pre-wrap}
.ref{font-family:var(--mono);font-size:11.5px;color:var(--text-3);margin-top:6px;letter-spacing:-.01em}
code{font-family:var(--mono);font-size:12.5px;background:var(--sunk);border:1px solid var(--line);padding:2px 6px;border-radius:4px;word-break:break-all}
.callout{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border:1px solid var(--line);border-left:3px solid var(--text-3);border-radius:0 var(--r-ctl) var(--r-ctl) 0;background:var(--panel);margin:0 0 16px}
.callout.warn{border-color:var(--amber-line);border-left-color:var(--amber);background:#FFFBF4}.callout.warn .ic{color:var(--amber)}
.callout.ok{border-color:#CFE5DC;border-left-color:var(--accent);background:#F7FBF9}.callout.ok .ic{color:var(--accent)}
.callout .ic{margin-top:2px}.callout ul{margin:6px 0 0 18px;padding:0}.callout li{margin:6px 0}
.tabs{position:sticky;top:0;z-index:4;background:var(--paper);border-bottom:1px solid var(--line)}
.tabs .wrap{display:flex;gap:26px;overflow-x:auto;scrollbar-width:none}.tabs a{display:inline-flex;align-items:center;gap:8px;padding:15px 0 13px;color:var(--text-2);text-decoration:none;font-size:14px;font-weight:550;border-bottom:2px solid transparent;white-space:nowrap}
.tabs a:hover{color:var(--text)}.tabs a[aria-selected=true]{color:var(--text);border-bottom-color:var(--text)}.tabs .n{font-size:12px;font-weight:600;color:var(--text-3);font-variant-numeric:tabular-nums}
.tabpanel{animation:fade var(--t-base) ease-out}@keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.split{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:20px;align-items:start}.rail{display:flex;flex-direction:column;gap:16px;position:sticky;top:70px}
.progress{display:flex;align-items:center;gap:12px;font-size:13px;color:var(--text-2)}.bar{flex:1;height:6px;background:var(--sunk);border-radius:3px;overflow:hidden;min-width:120px}.bar i{display:block;height:100%;background:var(--accent);border-radius:3px;transition:width .3s ease-out}
.term{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(250px,1fr);gap:20px;padding:18px 20px;border-top:1px solid var(--line);scroll-margin-top:70px}
.term:first-child{border-top:0}.term.flagged{box-shadow:inset 3px 0 0 var(--amber)}.term.done .t-name .ic{color:var(--accent)}
.t-name{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px}.t-name .ic{width:16px;height:16px;color:var(--line-2)}.t-key{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3)}
.t-edit form{display:flex;gap:6px}.t-edit form input,.t-edit form select{min-width:0}.t-state{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;font-size:12.5px;color:var(--text-3)}
.flag{display:flex;gap:8px;font-size:13px;line-height:1.5;color:#6B3F08;background:var(--amber-bg);border-radius:var(--r-ctl);padding:8px 10px;margin-top:10px}.flag .ic{width:16px;height:16px;color:var(--amber);margin-top:2px}
details.more>summary{list-style:none;cursor:pointer;padding:14px 20px;border-top:1px solid var(--line);font-size:14px;font-weight:550;color:var(--text-2);display:flex;align-items:center;gap:8px}
details.more>summary::-webkit-details-marker{display:none}details.more>summary .ic{width:16px;height:16px;transition:transform var(--t-fast)}details.more[open]>summary .ic{transform:rotate(90deg)}
.sticky-foot{position:sticky;bottom:0;z-index:3;box-shadow:0 -8px 16px -12px rgba(11,12,14,.18)}
.kv{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--line);font-size:14px}.kv:first-child{border-top:0;padding-top:0}.kv span{color:var(--text-2)}.kv b{font-weight:600;text-align:right}
.empty{padding:36px 20px;text-align:center;color:var(--text-2)}.empty h3{margin-bottom:6px;color:var(--text)}
.list-item{display:grid;grid-template-columns:120px minmax(0,1fr) auto;gap:16px;align-items:start;padding:16px 20px;border-top:1px solid var(--line)}.list-item:first-child{border-top:0}
.list-item .when{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}.list-item .when .badge{margin-top:6px}.list-item .why{font-size:13px;color:var(--text-3);margin-top:4px}
.diff td{vertical-align:middle}.old{text-decoration:line-through;color:var(--text-3)}
#toast{position:fixed;right:24px;top:24px;z-index:50;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.toast{display:flex;gap:10px;align-items:center;background:var(--panel);color:var(--text);border:1px solid var(--line);font-weight:550;padding:12px 16px;border-radius:8px;box-shadow:var(--float);font-size:14px;max-width:420px;animation:toastin 220ms ease-out;pointer-events:auto}
.toast .ic{color:var(--accent)}.toast.err{border-color:var(--red-line)}.toast.err .ic{color:var(--red)}@keyframes toastin{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
dialog{border:1px solid var(--line);border-radius:12px;padding:0;width:min(560px,calc(100vw - 32px));box-shadow:var(--float);color:var(--text);background:var(--panel)}
dialog::backdrop{background:rgba(11,12,14,.5)}dialog[open]{animation:toastin 180ms ease-out}.dlg-b{padding:22px 24px}.dlg-b h2{margin-bottom:8px;font-size:18px}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.band :focus-visible,header.top :focus-visible{outline-color:var(--ink-accent)}
.hero{display:grid;grid-template-columns:1.2fr 1fr;gap:48px;align-items:center;padding:28px 0 18px}
.hero h1{font-size:46px;line-height:1.06;letter-spacing:-.035em;margin:16px 0 18px}.hero h1 em{font-style:normal;color:var(--ink-accent)}
.eyebrow{display:inline-block;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-muted);border:1px solid var(--ink-line);border-radius:var(--r-chip);padding:5px 9px}
.lede{font-size:17px;line-height:1.65;color:var(--ink-muted);max-width:600px}
.preview{background:var(--panel);color:var(--text);border-radius:12px;padding:20px;box-shadow:0 30px 60px rgba(0,0,0,.35)}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));border:1px solid var(--line);border-radius:var(--r-panel);background:var(--panel)}
.step{padding:22px 22px 18px}.step+.step{border-left:1px solid var(--line)}.step .n{font-family:var(--mono);font-size:12px;color:var(--text-3)}.step h3{margin:10px 0 6px}
.auth{max-width:420px;margin:48px auto}
.band .sublede{font-size:15px;color:var(--ink-muted);margin:8px 0 0;max-width:640px}
.sect{display:flex;align-items:center;gap:8px;padding:10px 20px;background:var(--sunk);border-top:1px solid var(--line)}.sect .ic{width:16px;height:16px;color:var(--text-3)}
.panel-h+.sect{border-top:0}.list-item.rv{box-shadow:inset 3px 0 0 var(--amber)}.list-item.ready{box-shadow:inset 3px 0 0 var(--accent)}
.why.ok{color:var(--accent)!important;font-weight:550}.note{font-size:12.5px;color:var(--ink-muted);margin:14px 0 0}
.steps-ol{margin:0;padding-left:20px;line-height:1.8}.steps-ol li{margin:4px 0;padding-left:4px}.prompt{display:block;font-style:normal;background:var(--sunk);border:1px solid var(--line);border-radius:var(--r-ctl);padding:8px 12px;margin:6px 0;color:var(--text)}
details.panel>summary{list-style:none}details.panel>summary::-webkit-details-marker{display:none}
.section-h{margin:40px 0 14px}.section-h p{margin:6px 0 0}
.hero .lede+.lede{margin-top:10px}
@media (max-width:980px){.split{grid-template-columns:minmax(0,1fr)}.rail{position:static}.hero{grid-template-columns:1fr;gap:28px}.hero h1{font-size:36px}.step+.step{border-left:0;border-top:1px solid var(--line)}}
@media (max-width:720px){.wrap{padding:0 16px}header.top .wrap{gap:16px}.who span{display:none}nav{gap:16px}.fig{padding:14px 12px 4px 0}.fig+.fig{padding-left:12px}.fig .v{font-size:22px}#toast{left:16px;right:16px;top:16px}.panel-f .btn,.panel-f button{white-space:normal;height:auto;min-height:36px;padding-top:7px;padding-bottom:7px;text-align:center;line-height:1.3}
.figs{grid-template-columns:repeat(2,minmax(0,1fr))}.fig:nth-child(3){border-left:0;padding-left:0}.term{grid-template-columns:1fr;gap:12px;padding:16px}.list-item{grid-template-columns:1fr;gap:8px}
.hide-sm{display:none}.sect{padding:10px 16px}h1{font-size:24px}.hero h1{font-size:32px}.panel-h,.panel-b,.panel-f{padding-left:16px;padding-right:16px}.panel table td:first-child,.panel table th:first-child{padding-left:16px}
.dates tr{display:grid;grid-template-columns:1fr auto}.dates td{border:0;padding:6px 16px}.dates tr+tr{border-top:1px solid var(--line)}.dates td:nth-child(2){grid-column:1/-1;grid-row:2}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
`;

// Client behaviour: every action posts JSON, then reloads in place (same tab, same scroll) and shows a toast.
const JS = `
document.documentElement.classList.add('js');
async function api(method,url,body){const r=await fetch(url,{method,headers:{'Content-Type':'application/json','Accept':'application/json'},body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin'});let d={};try{d=await r.json()}catch(e){}if(!r.ok)throw new Error(d.error||('Request failed ('+r.status+')'));return d}
var ICK='<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10.5l3.2 3.2L15 7"/></svg>';var ICA='<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5l7 12.5H3z"/><path d="M10 8.5v3.5M10 14.2v.3"/></svg>';
function toast(msg,err){var box=document.getElementById('toast');if(!box)return;var t=document.createElement('div');t.className='toast'+(err?' err':'');t.setAttribute('role',err?'alert':'status');t.innerHTML=err?ICA:ICK;var s=document.createElement('span');s.textContent=msg;t.appendChild(s);box.appendChild(t);setTimeout(function(){t.remove()},err?7000:3200)}
function done(d,msg){if(d&&d.redirect){location.href=d.redirect;return}try{sessionStorage.setItem('li:after',JSON.stringify({p:location.pathname,y:window.scrollY,m:msg||'Saved'}))}catch(e){}location.reload()}
function ask(msg,okLabel){var dl=document.getElementById('dlg');if(!dl||!dl.showModal)return Promise.resolve(confirm(msg));dl.querySelector('[data-msg]').textContent=msg;dl.querySelector('[data-ok]').textContent=okLabel||'Continue';dl.showModal();return new Promise(function(res){dl.onclose=function(){res(dl.returnValue==='ok')}})}
function formJson(form){const o={};for(const el of form.elements){if(!el.name||el.type==='submit')continue;let v=el.type==='checkbox'?el.checked:el.value;if(el.dataset.nullEmpty!==undefined&&v==='')v=null;o[el.name]=v}return o}
document.addEventListener('submit',async e=>{const f=e.target;if(!f.dataset.api)return;e.preventDefault();const b=f.querySelector('button[type=submit],button:not([type])');if(b){b.disabled=true;b.classList.add('busy')}try{let body=formJson(f);if(f.dataset.nest){body={[f.dataset.nest]:body};for(const k of (f.dataset.lift||'').split(',').filter(Boolean)){body[k]=body[f.dataset.nest][k];delete body[f.dataset.nest][k]}}const d=await api(f.dataset.method||'POST',f.dataset.api,body);done(d,f.dataset.toast)}catch(err){toast(err.message,true);if(b){b.disabled=false;b.classList.remove('busy')}}});
document.addEventListener('click',async e=>{const el=e.target.closest('[data-post],[data-copy],[data-open]');if(!el)return;e.preventDefault();if(el.dataset.open){const dl=document.getElementById(el.dataset.open);if(dl&&dl.showModal)dl.showModal();return}if(el.dataset.copy){try{await navigator.clipboard.writeText(el.dataset.copy);toast('Copied')}catch(_){prompt('Copy:',el.dataset.copy)}return}if(el.dataset.confirm&&!(await ask(el.dataset.confirm,el.dataset.okLabel)))return;el.disabled=true;el.classList.add('busy');try{const d=await api(el.dataset.method||'POST',el.dataset.post,el.dataset.body?JSON.parse(el.dataset.body):{});done(d,el.dataset.toast)}catch(err){toast(err.message,true);el.disabled=false;el.classList.remove('busy')}});
(function(){var tabs=document.querySelectorAll('[role=tab]');if(tabs.length){var panels=document.querySelectorAll('.tabpanel');function show(id,focusEl){var hit=false;panels.forEach(function(p){var on=p.id==='tab-'+id;p.hidden=!on;if(on)hit=true});if(!hit)return false;tabs.forEach(function(t){t.setAttribute('aria-selected',t.dataset.tab===id?'true':'false')});return true}
var start=(location.hash||'').slice(1);var target=null;if(start.indexOf('t-')===0||start==='amendments'){target=document.getElementById(start);var p=target&&target.closest('.tabpanel');start=p?p.id.slice(4):''}if(!start||!show(start)){show(document.querySelector('[data-default-tab]').dataset.defaultTab)}if(target)setTimeout(function(){target.scrollIntoView({block:'start'})},0);
tabs.forEach(function(t){t.addEventListener('click',function(ev){ev.preventDefault();show(t.dataset.tab);history.replaceState(null,'','#'+t.dataset.tab)})});
document.addEventListener('click',function(ev){var a=ev.target.closest('a[href^="#t-"],a[href="#amendments"]');if(!a)return;var el=document.getElementById(a.getAttribute('href').slice(1));if(!el)return;var p=el.closest('.tabpanel');if(p){ev.preventDefault();show(p.id.slice(4));history.replaceState(null,'','#'+p.id.slice(4));el.scrollIntoView({behavior:'smooth',block:'start'})}})}
try{var a=JSON.parse(sessionStorage.getItem('li:after')||'null');sessionStorage.removeItem('li:after');if(a&&a.p===location.pathname){window.scrollTo(0,a.y||0);toast(a.m)}}catch(e){}})();
`;

const DIALOG = `<dialog id="dlg"><form method="dialog"><div class="dlg-b"><h2>Please confirm</h2><p class="muted" data-msg></p></div><div class="panel-f"><span style="flex:1"></span><button value="cancel" class="quiet">Cancel</button><button value="ok" class="primary" data-ok>Continue</button></div></form></dialog>`;

export function layout(title, body, { user = null, band = '', active = '' } = {}) {
  const cur = (k) => (active === k ? ' aria-current="page"' : '');
  const nav = user
    ? `<nav aria-label="Main"><a href="/app"${cur('portfolio')}>Portfolio</a><a href="/app/settings"${cur('connect')}>Connect<span class="hide-sm"> Claude</span></a></nav>
<div class="who"><span>${h(user.name)} · ${h(wsName(user.workspace_name))}</span><form method="post" action="/logout" style="margin:0"><button class="sm">Log out</button></form></div>`
    : `<nav aria-label="Main"><a class="hide-sm" href="/#how-it-works">How it works</a><a href="/samples"${cur('samples')}>Sample<span class="hide-sm"> leases</span></a><a href="/connect"${cur('connect')}>Connect<span class="hide-sm"> Claude</span></a></nav><div class="who"><a class="btn sm" href="/login">Log in</a></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(title)} · LeaseIntel</title><meta name="description" content="Lease obligations desk for multi-location businesses. Your Claude reads the lease; LeaseIntel keeps every date and rupee live.">
<meta name="theme-color" content="#0B0C0E"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<style>${CSS}</style></head><body>
<header class="top"><div class="wrap"><a class="logo" href="${user ? '/app' : '/'}"><i></i><b>Lease<span>Intel</span></b></a>${nav}</div></header>
${band ? `<section class="band"><div class="wrap">${band}</div></section>` : ''}
${body}
<div id="toast" aria-live="polite"></div>${DIALOG}<script>${JS}</script></body></html>`;
}
const page = (inner) => `<main><div class="wrap">${inner}</div></main>`;

// ---------- public pages ----------
export function landingPage(baseUrl) {
  const band = `<div class="hero"><div>
<span class="eyebrow">Built for multi-location businesses with 10–60 leased locations</span>
<h1>Your leases are full of obligations. <em>Make sure none of them get missed.</em></h1>
<p class="lede">Every location has a lease. Every lease has deadlines, rent escalations, lock-in periods and renewal clauses. Miss one, and it can cost you.</p>
<p class="lede">LeaseIntel turns your lease agreements into verified obligations, actionable deadlines and a live rent schedule, so your finance team always knows what is due, when and where.</p>
<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:26px"><a class="btn light" href="/login">Open interactive demo ${icon('arrow')}</a><a class="btn" href="/connect">Connect Claude</a><a class="btn" href="/samples">Explore sample leases</a></div>
</div>
<div class="preview" aria-label="Example of a verified lease in LeaseIntel">
<div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-weight:600">Indiranagar cafe</div><div class="small faint">Bengaluru · Leave and license</div></div><span class="badge b-ok">Approved</span></div>
<div style="margin-top:16px"><div class="kv"><span>Current monthly rent</span><b class="num">₹2,38,050</b></div><div class="kv"><span>Next renewal deadline</span><b>30 Dec 2026 <span class="badge b-warn" style="margin-left:6px">Decision</span></b></div><div class="kv"><span>Lock-in ended</span><b>30 Jun 2021</b></div><div class="kv"><span>Total rent + CAM + GST</span><b class="num">₹3,16,299</b></div></div>
<div class="label" style="margin-top:16px">Clause extract</div>
<div class="quote" style="margin-top:6px">"...increased by fifteen percent (15%) on the last paid license fee at the end of every thirty-six (36) months..."</div>
<div class="ref">Clause 4.1 · Source verified · Finance approved</div>
</div></div>`;
  return layout('Lease obligations desk', page(`
<div class="section-h" id="how-it-works" style="margin-top:8px;scroll-margin-top:16px"><h2>How it works</h2></div>
<div class="steps">
<div class="step"><span class="n">01</span><h3>Connect your lease</h3><p class="small muted">Share a lease PDF with Claude and ask it to add the lease to LeaseIntel. Every extracted obligation is linked to its original clause.</p></div>
<div class="step"><span class="n">02</span><h3>Review and verify</h3><p class="small muted">Your team checks each extracted term against its clause, corrects anything wrong and approves the lease. Nothing becomes part of your live portfolio without human approval.</p></div>
<div class="step"><span class="n">03</span><h3>Turn clauses into a calendar</h3><p class="small muted">Lock-in periods, exit notices, rent escalations, renewals and expiry dates become actionable deadlines. Rent is calculated into a month-by-month schedule.</p></div>
<div class="step"><span class="n">04</span><h3>Act before deadlines</h3><p class="small muted">Ask Claude what needs attention next month or next quarter. It reads your live portfolio, lists upcoming obligations and exposure across locations, and drafts renewal notices for you to send, with the lease terms behind every answer.</p></div>
</div>
<div class="row" style="margin-top:16px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
<div class="panel panel-b"><h3>A live rent schedule for Finance</h3><p class="small muted" style="margin-top:8px">Know what you owe, which location it belongs to and when rent changes. Export verified monthly rent schedules to CSV for budgeting, reconciliation and financial planning. Direct links to spend platforms such as Volopay are on the roadmap, not built yet.</p></div>
<div class="panel panel-b" style="margin-top:0"><h3>Your AI. Your workflow. Your data.</h3><p class="small muted" style="margin-top:8px">LeaseIntel doesn't run its own AI model or charge you for AI usage. Your Claude reads and interprets the lease. LeaseIntel provides the structured records, verification workflow, calculations and persistent portfolio data.</p></div>
</div>
<p class="small faint" style="margin-top:24px">Connect your workspace using the LeaseIntel MCP endpoint: <code>${h(baseUrl)}/mcp/{workspace-key}</code></p>`), { band });
}

export function authPage({ mode, error = '', demo }) {
  const login = mode === 'login';
  return layout(login ? 'Log in' : 'Create workspace', page(`
<div class="auth panel"><div class="panel-b">
<h1 style="font-size:24px">${login ? 'Log in' : 'Create your company workspace'}</h1>
<p class="small muted" style="margin-top:6px">${login ? 'The demo account is filled in for you.' : 'You get a private workspace and your own Claude link.'}</p>
${error ? `<div class="callout warn" role="alert" style="margin-top:14px">${icon('alert')}<div>${h(error)}</div></div>` : ''}
<form method="post" action="/${mode}">
${login ? '' : '<label for="company">Company name</label><input id="company" name="company" required maxlength="120" placeholder="Kettle and Crumb Cafes"><label for="name">Your name</label><input id="name" name="name" required maxlength="120">'}
<label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="email" value="${login ? h(demo.email) : ''}">
<label for="password">Password</label><input id="password" name="password" type="password" required autocomplete="${login ? 'current-password' : 'new-password'}" minlength="${login ? 1 : 8}" value="${login ? h(demo.password) : ''}">
<button type="submit" class="primary" style="width:100%;margin-top:20px;height:40px">${login ? 'Log in' : 'Create workspace'}</button></form>
</div><div class="panel-f small muted">${login ? `Demo: <code>${h(demo.email)}</code> / <code>${h(demo.password)}</code><span style="flex:1"></span><a href="/signup">Create a workspace</a>` : 'Have an account? <a href="/login">Log in</a>'}</div></div>`));
}

export function connectSteps(mcpUrl) {
  return `<div class="panel"><div class="panel-h"><h2>Connect using Claude</h2><span class="small faint">Web, desktop or mobile</span></div><div class="panel-b"><ol class="steps-ol">
<li>Open Claude and go to <b>Settings → Connectors</b> (on some plans: <b>Customize → Connectors</b>).</li>
<li>Select <b>Add custom connector</b>.</li>
<li>Enter <b>Name:</b> <code>LeaseIntel</code> and <b>URL:</b> your connection URL. <button class="sm quiet" data-copy="${h(mcpUrl)}">${icon('copy')} Copy URL</button></li>
<li>Leave the OAuth fields empty, then click <b>Add</b>.</li>
<li>Open a new chat and turn on <b>LeaseIntel</b> in the tools menu.</li>
<li>Upload a lease PDF and ask Claude:<span class="prompt">"Add this lease to LeaseIntel, extract its key obligations and flag the upcoming deadlines."</span>You can also ask:<span class="prompt">"What needs attention in the next 90 days across my lease portfolio?"</span></li></ol>
<p class="hint" style="margin-top:12px"><b>Note:</b> Claude asks permission the first time it uses each LeaseIntel tool. Allow it to continue. Free Claude plans allow one custom connector.</p></div></div>
<details class="panel"><summary class="panel-h" style="cursor:pointer;border-bottom:0"><h2 style="font-size:16px">Connect using Claude Code</h2><span class="small faint">For developers</span>${icon('plus')}</summary><div class="panel-b" style="padding-top:0"><p class="small muted">Add LeaseIntel as an MCP server with this command:</p><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><code style="flex:1;padding:8px 10px">claude mcp add --transport http leaseintel ${h(mcpUrl)}</code><button class="sm" data-copy="claude mcp add --transport http leaseintel ${h(mcpUrl)}">${icon('copy')} Copy</button></div></div></details>
<div class="panel"><div class="panel-h"><h2 style="font-size:16px">Explore with sample leases</h2><a class="btn sm" href="/samples">${icon('download')} Download sample lease PDFs</a></div><div class="panel-b small muted">Want to see how LeaseIntel works before connecting your own documents? Try one of three fictional lease agreements.</div></div>`;
}
const linkBox = (url, { demo = false } = {}) => `<div class="panel"><div class="panel-h"><h2>Your LeaseIntel connection</h2><span class="small faint">Your workspace's MCP connection URL</span></div><div class="panel-b">
<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><code style="flex:1;font-size:13px;padding:8px 10px">${h(url)}</code><button class="primary" data-copy="${h(url)}">${icon('copy')} Copy connection URL</button></div>
<div class="callout warn" style="margin:16px 0 0">${icon('alert')}<div><b>Security notice:</b> anyone with this URL can access and modify your workspace. Treat it like a password. Do not share it publicly or paste it into untrusted apps.${demo ? '<div class="small muted" style="margin-top:6px">This demo workspace\'s URL is shared on purpose so reviewers can try it. Reset the demo to restore the sample data.</div>' : ''}</div></div>
</div></div>`;
export function connectPublicPage(baseUrl, demoKey) {
  const url = `${baseUrl}/mcp/${demoKey}`;
  const band = `<span class="label" style="color:var(--ink-muted)">Setup</span><h1 style="margin-top:8px">Bring your leases into Claude.</h1><p class="sublede">Connect Claude to LeaseIntel and let it work with your verified lease portfolio. This is the demo workspace's connection URL; every company workspace gets its own private one.</p>`;
  return layout('Connect Claude', page(`${linkBox(url, { demo: true })}${connectSteps(url)}
<div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap"><a class="btn primary" href="/login">Open interactive demo ${icon('arrow')}</a></div>`), { band, active: 'connect' });
}
export function samplesPage(files) {
  const band = `<span class="label" style="color:var(--ink-muted)">Try it</span><h1 style="margin-top:8px">Sample lease PDFs</h1><p class="sublede">Fictional agreements for trying LeaseIntel. Download one, attach it in Claude and ask: "Add this lease to LeaseIntel."</p>`;
  return layout('Sample leases', page(`<div class="panel">${files.map((f) => `<div class="list-item" style="grid-template-columns:auto minmax(0,1fr) auto;align-items:center">${icon('doc')}<div><b>${h(f.title)}</b><div class="sub small faint">${h(f.file)}</div></div><a class="btn" href="/samples/${h(f.file)}">${icon('download')} Download</a></div>`).join('')}</div>`), { band, active: 'samples' });
}

// ---------- portfolio ----------
export function portfolioPage({ user, p }) {
  const totals = Object.entries(p.totals_by_currency);
  const reviews = p.leases.filter((l) => l.status === 'needs_review' || l.pending_amendment_changes);
  const nAct = p.actions.length;
  const band = `<div class="head"><div class="grow"><span class="label" style="color:var(--ink-muted)">${h(wsLabel(user.workspace_name))}</span><h1 style="margin-top:8px">Lease portfolio</h1>
<p class="sublede">Your lease obligations, financial commitments and upcoming deadlines in one place.</p>
<div class="meta muted">${fmtLong(p.today)} · ${nAct ? plural(nAct, 'upcoming action') : 'no upcoming actions'} in the next ${p.days_ahead} days</div></div>
<button data-open="add-lease">${icon('plus')} Add lease</button></div>
<div class="figs">${totals.length ? totals.map(([cur, t]) => `<div class="fig"><div class="k">Monthly rent outflow · ${cur}</div><div class="v">${money(t.monthly_outflow_now, cur)}${t.totals_final ? '' : '*'}</div><div class="s">Across ${plural(t.leases, 'active lease')} · includes charges and tax</div><div class="s">${money(t.remaining_total, cur)} left to pay on current terms</div>${t.totals_final ? '' : '<div class="s warn">* excludes tax the agreement does not state</div>'}</div>`).join('') : '<div class="fig"><div class="k">Monthly rent outflow</div><div class="v">-</div><div class="s">Add a lease to see totals</div></div>'}</div>
<div class="counts"><span><b>${p.counts.locations}</b>${p.counts.locations === 1 ? 'Location' : 'Locations'}</span><span><b>${p.counts.active_leases}</b>Active ${p.counts.active_leases === 1 ? 'lease' : 'leases'}${p.counts.leases !== p.counts.active_leases ? ` (of ${p.counts.leases})` : ''}</span><span><b>${p.counts.needs_review}</b>Pending review</span><span><b>${p.counts.actions_due}</b>Upcoming ${p.counts.actions_due === 1 ? 'action' : 'actions'}</span>${p.counts.pending_amendments ? `<span><b>${p.counts.pending_amendments}</b>Amendment to decide</span>` : ''}</div>
<p class="note">All amounts are based on current lease terms. Each currency is reported separately. Expired and archived leases are excluded.</p>`;
  const reviewRows = reviews.map((l) => {
    const ready = l.status === 'needs_review' && !l.pending_amendment_changes && l.key_terms_to_verify === 0;
    const lines = [];
    if (l.status === 'needs_review') lines.push(l.key_terms_to_verify === 0 ? `<div class="why ok">All ${l.key_terms_total} key terms verified. Ready to approve.</div>` : `<div class="why">${l.key_terms_total - l.key_terms_to_verify} of ${l.key_terms_total} key terms verified</div>`);
    if (l.pending_amendment_changes) lines.push('<div class="why">Amendment waiting for your decision</div>');
    if (l.warnings.length) lines.push(`<div class="why">${plural(l.warnings.length, 'point')} to interpret</div>`);
    return `<div class="list-item ${ready ? 'ready' : 'rv'}"><div class="when"><span class="badge ${ready ? 'b-ok' : 'b-warn'}">${ready ? 'Ready' : l.status === 'needs_review' ? 'Needs review' : 'Amendment'}</span></div><div><a class="rowlink" href="/app/l/${l.id}#review">${h(l.location || l.title)}</a> ${l.created_by === 'claude' ? '<span class="badge b-claude">Added by Claude</span>' : ''}${lines.join('')}</div><a class="btn sm${ready ? ' go' : ''}" href="/app/l/${l.id}#review">${ready ? 'Review and approve' : 'Review lease'} ${icon('arrow')}</a></div>`;
  }).join('');
  const actionRows = p.actions.map((a) => `<div class="list-item"><div class="when">${fmtDate(a.date)}<div>${daysBadge(a)}</div></div>
<div><a class="rowlink" href="/app/l/${a.lease_id}#dates">${h(a.location || a.lease_title)}</a><div style="font-size:14px;margin-top:2px">${h(a.label)}</div>${a.verified_lease ? '' : '<div class="why" style="color:var(--amber)">Based on terms not yet verified</div>'}<div class="why hide-sm">${h(a.detail)}</div></div>
<button class="sm" ${post(`/api/leases/${a.lease_id}/actions`, { action_key: a.action_key, done: true }, 'data-toast="Marked as done"')}>${icon('check')} Mark as done</button></div>`).join('');
  const nItems = reviews.length + nAct;
  const leaseRows = p.leases.map((l) => `<tr>
<td><a class="rowlink" href="/app/l/${l.id}">${h(l.location || l.title)}</a> ${l.created_by === 'claude' ? '<span class="badge b-claude">Added by Claude</span>' : ''}<div class="sub">${h([l.city, l.landlord].filter(Boolean).join(' · '))}</div></td>
<td>${statusBadge(l.status)}</td>
<td class="num">${l.money ? money(l.money.rent_now, l.currency) : '<span class="faint">-</span>'}</td>
<td class="hide-sm">${fmtDate(l.expiry_date)}</td>
<td class="hide-sm">${l.next_action ? `${fmtDate(l.next_action.date)}<div class="sub">${h(l.next_action.label)}</div>` : '<span class="faint">-</span>'}</td></tr>`).join('');
  const addDialog = `<dialog id="add-lease"><form data-api="/api/leases" data-method="POST" data-nest="location" data-lift="${FIELDS.map((f) => f.key).join(',')},title" data-toast="Lease added"><div class="dlg-b">
<h2>Add a lease</h2><p class="small muted">Enter the key terms yourself, no Claude needed. Terms you type count as verified by you. To add a lease from a PDF, ask Claude instead.</p>
<div class="row"><div><label>Location name</label><input name="name" required></div><div><label>City</label><input name="city"></div></div>
<label>Lease title</label><input name="title" placeholder="Optional">
<div class="row"><div><label>Start date</label><input type="date" name="start_date" required></div><div><label>Expiry date (last day)</label><input type="date" name="expiry_date" required></div></div>
<div class="row"><div><label>Monthly rent</label><input name="monthly_rent" inputmode="decimal" required></div><div><label>Currency</label><input name="currency" value="INR" maxlength="3"></div><div><label>Security deposit</label><input name="security_deposit" inputmode="decimal" value="0"></div></div>
<div class="row"><div><label>Lock-in (months)</label><input name="lock_in_months" inputmode="numeric" value="0"></div><div><label>Notice (months)</label><input name="notice_months" inputmode="numeric" value="0"></div><div><label>Escalation %</label><input name="escalation_percent" inputmode="decimal" value="0"></div><div><label>Every (months)</label><input name="escalation_every_months" inputmode="numeric" value="12"></div></div>
</div><div class="panel-f"><span style="flex:1"></span><button type="button" class="quiet" onclick="this.closest('dialog').close()">Cancel</button><button type="submit" class="primary">Add lease</button></div></form></dialog>`;
  return layout('Portfolio', `<main><div class="wrap">
<div class="panel"><div class="panel-h"><h2>Needs your attention</h2><span class="small faint">${nItems ? `${plural(nItems, 'item')} requiring attention` : 'All clear'}</span></div>
${nItems ? `${reviewRows ? `<div class="sect">${icon('alert')}<span class="label">Pending review</span></div>${reviewRows}` : ''}${actionRows ? `<div class="sect">${icon('clock')}<span class="label">Upcoming deadlines</span></div>${actionRows}` : ''}` : '<div class="empty"><h3>Nothing needs your attention right now</h3><p class="small">Leases waiting for review and deadlines in the next 90 days appear here.</p></div>'}</div>
<div class="panel"><div class="panel-h"><h2>Lease register</h2><span class="small faint">${plural(p.leases.length, 'lease')} across ${plural(p.counts.locations, 'location')}</span></div>
${p.leases.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Location</th><th>Status</th><th>Monthly rent</th><th class="hide-sm">Lease expiry</th><th class="hide-sm">Next milestone</th></tr></thead><tbody>${leaseRows}</tbody></table></div>` : `<div class="empty"><h3>Your lease portfolio starts here</h3><p class="small">Add your first lease to start tracking rent, contractual obligations and critical deadlines.</p><button class="primary" data-open="add-lease" style="margin-top:8px">${icon('plus')} Add your first lease</button></div>`}</div>
</div></main>${addDialog}`, { user, band, active: 'portfolio' });
}

// ---------- one lease ----------
function termRow(t, lease, flaggedFields) {
  const ev = t.evidence;
  const input = t.type === 'enum'
    ? `<select name="${t.key}" aria-label="${h(t.label)}">${t.options.map((o) => `<option value="${o}"${o === t.value ? ' selected' : ''}>${h(ENUM_LABEL[o] || o)}</option>`).join('')}</select>`
    : `<input name="${t.key}" aria-label="${h(t.label)}" value="${h(t.value ?? '')}" ${t.type === 'date' ? 'type="date" data-null-empty' : t.type === 'text' || t.type === 'currency' ? '' : `inputmode="${t.type === 'months' || t.integer ? 'numeric' : 'decimal'}" data-null-empty`}>`;
  const empty = t.value === null || t.value === undefined || t.value === '';
  let state;
  if (!ev && !t.required && (empty || t.type === 'enum' || t.type === 'currency')) state = `<span>${t.type === 'currency' ? 'Default' : 'Not in lease'}</span>`;
  else if (ev?.verified) state = `<span class="badge b-ok">${icon('check')}${ev.corrected ? 'Corrected' : 'Verified'}</span><span>${h(ev.verified_by || '')}${ev.verified_at ? ' · ' + fmtTime(ev.verified_at) : ''}</span><button class="quiet sm" ${post(`/api/leases/${lease.id}/verify`, { field: t.key, verified: false }, 'data-toast="Marked unverified"')}>Undo</button>`;
  else state = `<span class="badge b-warn">To verify</span><button class="sm" ${post(`/api/leases/${lease.id}/verify`, { field: t.key, verified: true }, `data-toast="${h(t.label)} verified"`)}>${icon('check')} Verify</button>`;
  const source = ev?.source === 'claude' ? ' · quoted by Claude' : ev?.source === 'amendment' ? ' · from amendment' : '';
  const flagged = flaggedFields.has(t.key) && !ev?.verified;
  return `<div class="term${flagged ? ' flagged' : ''}${ev?.verified ? ' done' : ''}" id="t-${t.key}">
<div><div class="t-name">${icon(ev?.verified ? 'check' : flagged ? 'alert' : 'clock')}${h(t.label)}${t.required ? ' <span class="t-key">Key</span>' : ''}</div>
${ev?.clause_quote ? `<div class="quote">${h(ev.clause_quote)}</div><div class="ref">${h(ev.clause_ref || 'No clause reference given')}${source}</div>` : `<div class="ref">${ev?.clause_ref ? h(ev.clause_ref) : 'No clause quoted'}</div>`}
${ev?.ambiguity ? `<div class="flag">${icon('alert')}<div><b>${ev.verified ? 'Claude flagged (resolved by reviewer):' : 'Claude flagged:'}</b> ${h(ev.ambiguity)}</div></div>` : ''}</div>
<div class="t-edit"><form data-api="/api/leases/${lease.id}" data-method="PATCH" data-toast="${h(t.label)} saved and verified">${input}<button>Save</button></form><div class="t-state">${state}</div></div></div>`;
}

const activityText = (a, cur) => {
  const f = a.field && FIELD_MAP[a.field];
  const show = (v) => (v === null || v === undefined ? 'blank' : f && f.type === 'money' ? money(v, cur) : f && f.type === 'enum' ? (ENUM_LABEL[v] || v) : f && f.type === 'percent' ? `${v}%` : v);
  const label = { 'term.changed': 'Changed', 'term.verified': 'Verified', 'term.unverified': 'Unverified', 'lease.created': 'Created lease', 'lease.approved': 'Approved lease',
    'lease.reopened': 'Sent back for review', 'document.saved': 'Saved document', 'document.edited': 'Edited document', 'document.status': 'Document status',
    'action.done': 'Marked done', 'action.reopened': 'Reopened action', 'amendment.proposed': 'Proposed amendment', 'amendment.rejected': 'Rejected amendment change',
    'evidence.updated': 'Updated evidence', 'lease.renamed': 'Renamed lease', 'notes.updated': 'Updated notes' }[a.action] || a.action;
  let out = `<b>${h(label)}</b> ${h(a.detail)}`;
  if (a.action === 'term.changed' || a.action === 'amendment.rejected' || a.action === 'document.status') out += `<div class="num" style="margin-top:2px">${h(show(a.old_value))} → <b>${h(show(a.new_value))}</b></div>`;
  if (a.reason) out += `<div class="sub">${h(a.reason)}</div>`;
  const src = { claude: 'Claude', person: 'Human', amendment: 'Human, from amendment', app: 'Setup' }[a.source];
  return out + (src && a.action === 'term.changed' ? `<div class="sub">Source: ${src}</div>` : '');
};

export function leasePage({ user, d }) {
  const L = d.lease;
  const cur = L.currency || 'INR';
  const m = d.money;
  const tax = d.tax.name;
  const needsReview = d.status === 'needs_review';
  const required = d.terms.filter((t) => t.required);
  const optional = d.terms.filter((t) => !t.required);
  const verifiedCount = required.length - d.review.missing_required.length;
  const pct = required.length ? Math.round((verifiedCount / required.length) * 100) : 100;
  // One point per term: the engine's warning, with Claude's note on the same term underneath it.
  const noteFor = new Map(d.ambiguities.map((a) => [a.field, a.note]));
  const warned = new Set(d.warnings.map((w) => w.field));
  const flaggedFields = new Set([...warned, ...d.ambiguities.map((a) => a.field)]);
  const flags = [
    ...d.warnings.map((w) => `<li>${h(w.message)}${noteFor.has(w.field) ? `<div class="small faint">Claude's note: ${h(noteFor.get(w.field))}</div>` : ''} <a href="#t-${w.field}">Set it</a></li>`),
    ...d.ambiguities.filter((a) => !warned.has(a.field)).map((a) => `<li><b>${h(a.label)}:</b> ${h(a.note)} <a href="#t-${a.field}">Review</a></li>`),
  ];
  const flagBox = flags.length ? `<div class="callout warn" role="status">${icon('alert')}<div><b>Needs interpretation (${flags.length})</b><ul>${flags.join('')}</ul></div></div>` : '';
  const pendingAm = d.amendments.filter((a) => a.changes.some((c) => c.status === 'pending'));
  const show = (v, key) => { const f = FIELD_MAP[key]; return v === null || v === undefined || v === '' ? 'blank' : f.type === 'money' ? money(v, cur) : f.type === 'enum' ? (ENUM_LABEL[v] || v) : f.type === 'percent' ? `${v}%` : f.type === 'date' ? fmtDate(v) : v; };
  const amendCard = (a) => `<div class="panel" ${a.changes.some((c) => c.status === 'pending') ? 'id="amendments"' : ''}><div class="panel-h"><h3>${h(a.title)}</h3>${a.created_by === 'claude' ? '<span class="badge b-claude">Read by Claude</span>' : ''}${a.changes.some((c) => c.status === 'pending') ? `<button class="go sm" ${post(`/api/amendments/${a.id}/decide`, { decision: 'accept' }, 'data-confirm="Accept every pending change in this amendment? The lease terms and schedule update immediately." data-ok-label="Accept all" data-toast="Amendment accepted"')}>Accept all pending</button><button class="sm" ${post(`/api/amendments/${a.id}/decide`, { decision: 'reject' }, 'data-toast="Amendment rejected"')}>Reject all pending</button>` : ''}</div>
${a.effective_date || a.summary ? `<div class="panel-b" style="padding-bottom:0">${a.effective_date ? `<div class="small faint">Effective ${fmtDate(a.effective_date)}</div>` : ''}${a.summary ? `<p class="small">${h(a.summary)}</p>` : ''}</div>` : ''}
<div style="overflow-x:auto"><table class="diff"><thead><tr><th>Term</th><th>Current</th><th>Proposed</th><th>Amendment text</th><th></th></tr></thead><tbody>${a.changes.map((c) => `<tr><td><b>${h(FIELD_MAP[c.field]?.label || c.field)}</b></td><td class="num ${c.status === 'accepted' ? 'old' : ''}">${h(show(c.old_value, c.field))}</td><td class="num"><b>${h(show(c.new_value, c.field))}</b></td><td style="min-width:240px"><div class="quote" style="margin-top:0">${h(c.clause_quote)}</div><div class="ref">${h(c.clause_ref)}</div></td>
<td>${c.status === 'pending' ? `<div style="display:flex;gap:6px"><button class="go sm" ${post(`/api/amendments/${a.id}/decide`, { decision: 'accept', change_id: c.id }, 'data-toast="Change accepted"')}>Accept</button><button class="sm" ${post(`/api/amendments/${a.id}/decide`, { decision: 'reject', change_id: c.id }, 'data-toast="Change rejected"')}>Reject</button></div>` : `<span class="badge ${c.status === 'accepted' ? 'b-ok' : 'b-mute'}">${h(c.status[0].toUpperCase() + c.status.slice(1))}</span><div class="sub">${h(c.decided_by || '')}</div>`}</td></tr>`).join('')}</tbody></table></div></div>`;
  const LI = d.lock_in;
  const lockKv = LI ? `<div class="kv"><span>Lock-in</span><b>${fmtDate(LI.starts)} to ${fmtDate(LI.last_day)}</b></div><div class="kv"><span>First day outside</span><b>${fmtDate(LI.first_day_after)}</b></div>
${LI.notice_policy === 'may_serve_during_lock_in' ? `<div class="kv"><span>Serve exit notice by</span><b>${fmtDate(LI.last_day_to_serve_notice)}</b></div>` : LI.notice_policy === 'must_wait_until_after_lock_in' ? `<div class="kv"><span>Earliest exit</span><b>${fmtDate(LI.earliest_exit_last_day)}</b></div>` : LI.notice_months ? '<div class="small" style="color:var(--amber);margin-top:8px">Whether notice may be served during lock-in is not set, so no exit deadline is shown.</div>' : ''}` : '<div class="small faint">No lock-in in this lease.</div>';
  const nextDate = d.dates.find((x) => x.state === 'missed' || x.state === 'due_soon' || x.state === 'upcoming');
  const dates = d.dates.map((x) => `<tr><td style="white-space:nowrap;font-weight:600">${fmtDate(x.date)}</td><td><b>${h(x.label)}</b><div class="sub">${h(x.detail)}</div>${x.done_by ? `<div class="sub">Done by ${h(actor(x.done_by))}${x.done_note ? ': ' + h(x.done_note) : ''}</div>` : ''}</td><td>${daysBadge(x)}</td>
<td style="text-align:right">${x.state === 'done' ? `<button class="sm quiet" ${post(`/api/leases/${L.id}/actions`, { action_key: x.action_key, done: false }, 'data-toast="Reopened"')}>Reopen</button>` : x.state === 'past' ? '' : `<button class="sm" ${post(`/api/leases/${L.id}/actions`, { action_key: x.action_key, done: true }, 'data-toast="Marked done"')}>${icon('check')} Mark done</button>`}</td></tr>`).join('');
  const years = d.yearly.map((y) => `<tr><td>Year ${y.year}</td><td>${fmtDate(y.from)}</td><td class="num">${money(y.monthly_rent_from, cur)}${y.monthly_rent_to !== y.monthly_rent_from ? ' → ' + money(y.monthly_rent_to, cur) : ''}</td><td class="num" style="text-align:right">${money(y.total, cur)}${y.tax_unresolved_on ? `<div class="sub" style="color:var(--amber)">+ ${h(tax)} on ${money(y.tax_unresolved_on, cur)} not stated</div>` : ''}</td></tr>`).join('');
  const docs = d.documents.map((x) => `<div class="panel"><div class="panel-h">${icon('doc')}<h3>${h(x.title)}</h3><span class="badge ${x.status === 'sent' ? 'b-ok' : 'b-warn'}">${x.status === 'sent' ? 'Sent' : 'Draft'}</span>${x.created_by === 'claude' ? '<span class="badge b-claude">Drafted by Claude</span>' : ''}</div>
<form data-api="/api/documents/${x.id}" data-method="PATCH" data-toast="Letter saved"><div class="panel-b"><label style="margin-top:0">Title</label><input name="title" value="${h(x.title)}"><label>Text</label><textarea name="body" style="min-height:200px;font-family:var(--serif);font-size:15px">${h(x.body)}</textarea></div>
<div class="panel-f"><button type="submit" class="primary">Save edits</button>${x.status === 'sent' ? `<button type="button" ${post(`/api/documents/${x.id}`, { status: 'draft' }, 'data-method="PATCH" data-toast="Marked as draft"')}>Mark as draft</button>` : `<button type="button" ${post(`/api/documents/${x.id}`, { status: 'sent' }, 'data-method="PATCH" data-toast="Marked as sent"')}>Mark as sent</button>`}<span class="small faint" style="margin-left:auto">${h(actor(x.created_by))} · ${fmtTime(x.updated_at)}</span></div></form></div>`).join('');
  const clauses = d.clauses.map((c) => `<div class="term" style="grid-template-columns:1fr"><div><div class="t-name">${h(c.label)}</div><div class="small muted" style="margin-top:4px">${h(c.summary)}</div>${c.clause_quote ? `<div class="quote">${h(c.clause_quote)}</div>` : ''}<div class="ref">${h(c.clause_ref)}</div></div></div>`).join('');
  const acts = d.activity.map((a) => `<tr><td style="white-space:nowrap" class="faint small">${fmtTime(a.created_at)}</td><td>${a.actor === 'claude' ? '<span class="badge b-claude">Claude</span>' : `<span class="small">${h(actor(a.actor))}</span>`}</td><td>${activityText(a, cur)}</td></tr>`).join('');
  const defaultTab = needsReview || pendingAm.length ? 'review' : 'dates';
  const band = `<a class="crumb" href="/app">${icon('back')} Portfolio</a>
<div class="head"><div class="grow"><h1>${h(L.title)}<span class="chips">${L.created_by === 'claude' ? '<span class="badge b-claude">Added by Claude</span>' : ''}${statusBadge(d.status)}</span></h1>
<div class="meta muted">${h([d.location?.name, d.location?.city, L.landlord_name && 'Landlord: ' + L.landlord_name].filter(Boolean).join(' · '))}</div></div>
${needsReview ? `<a class="btn light" href="#t-${d.review.missing_required[0] || 'start_date'}">Review terms ${icon('arrow')}</a>` : `<a class="btn" href="/app/l/${L.id}/schedule.csv">${icon('download')} Rent schedule CSV</a>`}</div>
${m ? `<div class="figs">
<div class="fig"><div class="k">Rent now (per month)</div><div class="v">${m.in_term ? money(m.rent_now, cur) : '-'}</div><div class="s">${m.not_started ? 'Starts ' + fmtDate(L.start_date) : m.ended ? 'Lease has ended' : `Before charges and ${h(tax)}`}</div></div>
<div class="fig"><div class="k">Monthly outflow (rent + charges + ${h(tax)})</div><div class="v">${m.in_term ? money(m.monthly_outflow_now, cur) + (m.totals_final ? '' : '*') : '-'}</div>${m.totals_final ? '<div class="s">This month</div>' : `<div class="s warn">* excludes ${h(tax)} on charges the agreement does not cover</div>`}</div>
<div class="fig"><div class="k">Next date</div><div class="v">${nextDate ? fmtShort(nextDate.date) : '-'}</div><div class="s">${nextDate ? `${h(nextDate.label)}${nextDate.days_left >= 0 ? ` · ${nextDate.days_left} days` : ''}` : 'Nothing upcoming'}</div></div>
<div class="fig"><div class="k">Left to pay until expiry</div><div class="v">${money(m.remaining_total, cur)}${m.totals_final ? '' : '*'}</div><div class="s">${m.remaining_months} months · ${!LI ? 'no lock-in' : Number(m.committed_until_lock_in_end) > 0 ? money(m.committed_until_lock_in_end, cur) + ' committed in lock-in' : 'lock-in over'}</div></div>
</div>` : '<div class="callout warn" style="margin-top:20px;background:transparent">Add a valid start and expiry date to calculate dates and rent.</div>'}`;
  const tab = (id, label, n = '') => `<a href="#${id}" role="tab" data-tab="${id}" aria-controls="tab-${id}" aria-selected="${id === defaultTab}">${label}${n !== '' ? ` <span class="n">${n}</span>` : ''}</a>`;
  const reviewFoot = needsReview ? `<div class="panel-f sticky-foot"><div class="progress" style="flex:1;min-width:200px"><span>${verifiedCount} of ${required.length} key terms verified</span></div>
<button ${post(`/api/leases/${L.id}/verify-quoted`, {}, 'data-confirm="Mark as verified every key term that has a quoted clause and no flag? Only do this after reading each quote against its value. Flagged terms stay for you to decide one by one." data-ok-label="Verify them" data-toast="Quoted terms verified"')}>Verify all quoted, unflagged terms I have checked</button>
<button class="go" ${post(`/api/leases/${L.id}/approve`, {}, 'data-toast="Lease approved"')}${d.review.missing_required.length ? ` disabled title="Verify every key term first"` : ''}>${icon('check')} Approve lease</button></div>` : '';
  return layout(L.title, `
<div class="tabs" role="tablist" aria-label="Lease sections" data-default-tab="${defaultTab}"><div class="wrap">${tab('review', 'Review', needsReview ? `${verifiedCount}/${required.length}` : '')}${tab('dates', 'Dates', d.dates.length)}${tab('rent', 'Rent')}${tab('documents', 'Documents', d.documents.length + d.amendments.length || '')}${tab('history', 'History')}</div></div>
<main><div class="wrap">
${pendingAm.length ? `<div class="callout warn">${icon('alert')}<div><b>Amendment waiting for your decision.</b> The lease keeps its current terms until you accept each change. <a href="#amendments">Review the changes</a></div></div>` : ''}
${d.status === 'approved' ? `<div class="callout ok">${icon('check')}<div><b>Approved</b> by ${h(L.approved_by)} on ${fmtTime(L.approved_at)}. Dates and rent are based on verified terms.</div></div>` : ''}

<section class="tabpanel" id="tab-review" role="tabpanel" aria-label="Review">
${pendingAm.map(amendCard).join('')}
<div class="split" style="${pendingAm.length ? 'margin-top:16px' : ''}"><div>
${flagBox}
<div class="panel">
<div class="panel-h"><h2>Key terms and evidence</h2>${needsReview ? `<div class="progress" style="flex:0 1 260px"><div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Key terms verified"><i style="width:${pct}%"></i></div><span class="num">${verifiedCount}/${required.length}</span></div>` : '<span class="badge b-ok">All key terms verified</span>'}</div>
<div class="panel-b" style="padding-top:12px;padding-bottom:12px;background:var(--sunk);border-bottom:1px solid var(--line)"><p class="small muted" style="margin:0">Check each value against the clause Claude quoted. Saving a value marks it verified by you. Approval needs every key term verified; terms become key when they matter (for example tax scope once a tax rate is set).</p></div>
${required.map((t) => termRow(t, L, flaggedFields)).join('')}
<details class="more"><summary>${icon('arrow')}Other terms (${optional.length})</summary>${optional.map((t) => termRow(t, L, flaggedFields)).join('')}</details>
${reviewFoot}
</div></div>
<aside class="rail">
<div class="panel"><div class="panel-h"><h3>${icon('clock')} Next date</h3></div><div class="panel-b">${nextDate ? `<div style="font-size:22px;font-weight:600;letter-spacing:-.02em">${fmtDate(nextDate.date)}</div><div class="small muted" style="margin-top:2px">${h(nextDate.label)}</div><div style="margin-top:10px">${daysBadge(nextDate)}</div>${needsReview ? '<div class="hint">Based on terms not yet verified</div>' : ''}` : '<div class="small faint">Nothing upcoming.</div>'}</div></div>
<div class="panel"><div class="panel-h"><h3>Lock-in and exit</h3></div><div class="panel-b">${lockKv}</div></div>
</aside></div>
</section>

<section class="tabpanel" id="tab-dates" role="tabpanel" aria-label="Dates">
<div class="panel"><div class="panel-h"><h2>Critical dates</h2><span class="small faint">Deadlines count back from the last day (conservative)</span></div>
${d.dates.length ? `<div style="overflow-x:auto"><table class="dates"><tbody>${dates}</tbody></table></div>` : '<div class="empty"><h3>No dates yet</h3><p class="small">Add a start and expiry date to calculate them.</p></div>'}</div>
<div class="panel"><div class="panel-h"><h3>Lock-in and exit</h3></div><div class="panel-b" style="max-width:520px">${lockKv}</div></div>
</section>

<section class="tabpanel" id="tab-rent" role="tabpanel" aria-label="Rent">
<div class="panel"><div class="panel-h"><h2>Rent schedule</h2><a class="btn sm" href="/app/l/${L.id}/schedule.csv">${icon('download')} Download monthly schedule (CSV)</a></div>
${years ? `<div style="overflow-x:auto"><table><thead><tr><th>Lease year</th><th>From</th><th>Monthly rent</th><th style="text-align:right">Year total (rent + charges + ${h(tax)})</th></tr></thead><tbody>${years}</tbody></table></div>` : '<div class="empty"><h3>No schedule yet</h3><p class="small">Needs start, expiry and rent.</p></div>'}</div>
</section>

<section class="tabpanel" id="tab-documents" role="tabpanel" aria-label="Documents">
<h2 style="margin:4px 0 12px">Letters and memos</h2>
${docs || '<div class="panel"><div class="empty"><h3>No letters yet</h3><p class="small">Ask Claude: "Draft the renewal notice for this lease and save it to LeaseIntel."</p></div></div>'}
<details class="panel" style="margin-top:16px"><summary class="panel-h" style="cursor:pointer;border-bottom:0"><h3>Write a letter or note</h3>${icon('plus')}</summary><form data-api="/api/leases/${L.id}/documents" data-method="POST" data-toast="Draft saved"><div class="panel-b" style="padding-top:0"><label>Title</label><input name="title" required><label>Text</label><textarea name="body" required></textarea></div><div class="panel-f"><button type="submit" class="primary">Save draft</button></div></form></details>
${d.amendments.filter((a) => !pendingAm.includes(a)).length ? `<h2 style="margin:28px 0 12px">Amendments</h2>${d.amendments.filter((a) => !pendingAm.includes(a)).map(amendCard).join('')}` : ''}
${clauses ? `<h2 style="margin:28px 0 12px">Other clauses</h2><div class="panel">${clauses}</div>` : ''}
<details class="panel" style="margin-top:16px"><summary class="panel-h" style="cursor:pointer;border-bottom:0"><h3>Internal notes and title</h3>${icon('plus')}</summary><form data-api="/api/leases/${L.id}" data-method="PATCH" data-toast="Notes saved"><div class="panel-b" style="padding-top:0"><label>Title</label><input name="title" value="${h(L.title)}"><label>Notes</label><textarea name="notes">${h(L.notes)}</textarea></div><div class="panel-f"><button type="submit" class="primary">Save</button></div></form></details>
</section>

<section class="tabpanel" id="tab-history" role="tabpanel" aria-label="History">
<div class="panel"><div class="panel-h"><h2>Activity</h2><span class="small faint">Append-only history: every change keeps its old and new value, who made it and why.</span></div>
<div style="overflow-x:auto"><table><tbody>${acts}</tbody></table></div></div>
</section>
</div></main>`, { user, band, active: 'portfolio' });
}

export function settingsPage({ user, ws, baseUrl }) {
  const url = `${baseUrl}/mcp/${ws.mcp_key}`;
  const band = `<span class="label" style="color:var(--ink-muted)">${h(wsLabel(ws.name))}</span><h1 style="margin-top:8px">Bring your leases into Claude.</h1>
<p class="sublede">Connect Claude to LeaseIntel and let it work with your verified lease portfolio. Ask about contractual obligations, check upcoming deadlines and rent escalations, and prepare renewal notices, all from your workspace data.</p>`;
  return layout('Connect Claude', page(`${linkBox(url, { demo: ws.is_demo })}${connectSteps(url)}
${ws.is_demo ? `<div class="panel"><div class="panel-h"><h2 style="font-size:16px">Reset demo workspace</h2><button class="danger sm" ${post('/api/settings/reset-demo', {}, 'data-confirm="Reset the demo workspace? This permanently deletes every lease added here and restores the original sample leases." data-ok-label="Reset demo workspace" data-toast="Demo workspace reset"')}>Reset demo workspace</button></div><div class="panel-b small muted">Restore the original sample leases and demo data. This permanently deletes all leases currently added to this demo workspace.</div></div>`
    : `<div class="panel"><div class="panel-h"><h2 style="font-size:16px">Rotate connection URL</h2><button class="danger sm" ${post('/api/settings/rotate-key', {}, 'data-confirm="Create a new connection URL? The old one stops working right away for everyone." data-ok-label="Rotate URL" data-toast="New connection URL created"')}>Rotate URL</button></div><div class="panel-b small muted">Creates a new connection URL. The old one stops working right away, so update it in Claude afterwards.</div></div>`}`), { user, band, active: 'connect' });
}

export function errorPage(status, message, user = null) {
  return layout('Error', page(`<div class="auth panel"><div class="panel-b"><span class="label">${status === 404 ? 'Error 404' : 'Error ' + h(status)}</span><h1 style="margin-top:8px;font-size:24px">${status === 404 ? 'Not found' : 'Something went wrong'}</h1><p class="muted" style="margin-top:8px">${h(message)}</p></div><div class="panel-f"><a class="btn primary" href="${user ? '/app' : '/'}">Go back home</a></div></div>`), { user });
}
