// Demo layer for the Write-Up app (copied into field-writeup/demo/ by tools/build_demo.py).
// The app itself is the real one; this file only adds:
//   - fake jobs on first open (in a separate database, so real data is never touched),
//   - a "Demo" tab on the right edge with every demo option (skip days, signal, fill, start over),
//   - the Dropbox idea: a completed job uploads by itself, one file per job (simulated).
import * as store from './store.js';
import { hooks, toast } from './ui.js';
import { newJob } from './schema.js';
import { cleanOld } from './packages.js';

const DAY = 864e5;
const KEY = 'fw-demo';
const DB_NAME = 'field-writeup-demo';

// ---------- demo state (this browser only) ----------
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
const S = load() || { offsetDays: 0, signal: true, files: [], seeded: false, tried: [] };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* private mode */ } };

// ---------- the demo clock: "skip ahead" moves what the whole app thinks today is ----------
const RealDate = Date;
class DemoDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + S.offsetDays * DAY); }
  static now() { return RealDate.now() + S.offsetDays * DAY; }
}
globalThis.Date = DemoDate;

// ---------- sending: no real share sheet or downloads from the demo ----------
navigator.canShare = () => true;
navigator.share = async () => demoNote("Demo: your phone's share menu (Mail, Dropbox…) would open here. Counted as sent.");

// ---------- sample data ----------
const pad = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (d, hh, mm) => `${localDay(d)}T${pad(hh)}:${pad(mm)}`;
function picture(label, w = 480, h = 360) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#64748b'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#e2e8f0'; x.font = 'bold 28px system-ui, sans-serif'; x.textAlign = 'center';
  x.fillText(label, w / 2, h / 2);
  x.font = '18px system-ui, sans-serif'; x.fillText('sample photo', w / 2, h / 2 + 32);
  return c.toDataURL('image/jpeg', 0.6);
}
function signature(seed) {
  const c = document.createElement('canvas');
  c.width = 600; c.height = 180;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 180);
  x.strokeStyle = '#111'; x.lineWidth = 3; x.beginPath(); x.moveTo(60, 110);
  for (let i = 1; i <= 14; i++) x.lineTo(60 + i * 34, i % 2 ? 60 + (seed % 20) : 125);
  x.stroke();
  return c.toDataURL('image/png');
}
// A real-looking VIN whose check digit passes the app's VIN check.
function vin(serial) {
  const MAP = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
  const W = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  const base = `1XKYDP9X0LJ${String(serial).padStart(6, '0')}`;
  const sum = [...base].reduce((s, ch, i) => s + (/\d/.test(ch) ? +ch : MAP[ch]) * W[i], 0);
  return base.slice(0, 8) + (sum % 11 === 10 ? 'X' : String(sum % 11)) + base.slice(9);
}
const CUSTOMERS = [
  ['Tacoma Tow & Haul', 'Rita Gomez', 'TT-6'], ["O'Brien Hauling", 'Dan O\'Brien', 'KW-12'],
  ['Night Owl Freight', 'Lee Park', 'NO-3'], ['Puget Sound Rentals', 'Ana Silva', 'TRL-88'],
  ['Cascade Freight Lines', 'Mo Hassan', '4471'], ['Evergreen Logistics', 'Kim Tran', 'EV-209'],
  ['Harbor City Haulers', 'Joe Reyes', 'H-17'], ['Summit Fleet Services', 'Pat Moore', 'SF-88'],
];
let serial = 1000;
// Everything a finished write-up needs, so the completion check passes.
function filled(job, [company, contact, unit], d) {
  const n = serial++;
  Object.assign(job.values, {
    date: localDay(d), tech_name: 'Sam Ortiz', start_time: at(d, 8, 5), truck_start_miles: String(88000 + n),
    wo_number: job.values.wo_number || `RA-2026-0${400 + (n % 600)}`,
    company_name: company, contact_name: contact, phone: '(253) 555-0142', email: `dispatch@${company.replace(/[^A-Za-z]/g, '').toLowerCase()}.example`,
    unit_number: unit, plate: `C${n}K`, state: 'WA', unit_mileage: String(400000 + n * 13), vin: vin(n),
    complaint: 'No start, clicking at the starter after sitting overnight', diagnostics: 'Voltage drop on the main battery cable at the starter',
    repairs: 'Replaced the positive battery cable and cleaned the terminals', test_results: 'Starts every time, 13.9V charging',
    customer_instructions: 'Watch the gauges for a week', follow_up: 'None, job closed',
    address: 'I-5 NB mile 142', city: 'Tacoma', location_notes: 'Shoulder past exit 142',
    end_time: at(d, 10, 40), truck_end_miles: String(88042 + n),
  });
  job.parts = [{ qty: '1', part_number: 'BC-4/0', description: 'Battery cable', supplier: 'NAPA', price: '64.50', receipt_photos: [picture('Receipt')] }];
  job.no_parts = false;
  job.photos = { unit: [picture(`Unit ${unit}`)], vin_plate: [picture('VIN plate')], license_plate: [picture('License plate')], completed_work: [picture('Completed work')] };
  job.signatures = { customer_initials: signature(n), tech_signature: signature(n + 7) };
  job.na = {}; job.photo_na = {};
  return job;
}
const fileName = (j) => `${j.values.wo_number}_${(j.values.company_name || 'job').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}_${(j.completed_at || '').slice(0, 10)}.zip`;

async function seed() {
  const now = new Date();
  const settings = await store.getSettings();
  if (!settings.techName) await store.saveSettings({ ...settings, techName: 'Sam Ortiz', officeEmail: 'office@rainierfleet.example', gpsLookup: false });
  // Two in progress (partly filled), three already sent to Dropbox.
  const draft = (c, wo, fields, hoursAgo) => {
    const d = new Date(now.getTime() - hoursAgo * 36e5);
    const j = newJob({ techName: 'Sam Ortiz' }, d);
    Object.assign(j.values, { wo_number: wo, company_name: c[0], contact_name: c[1], unit_number: c[2], start_time: at(d, d.getHours(), 0) }, fields);
    return j;
  };
  const drafts = [
    draft(CUSTOMERS[0], 'RA-2026-0418', { phone: '(253) 555-0188', plate: 'C40221K', state: 'WA', complaint: 'Air leak at the trailer glad hands, brakes dragging' }, 2),
    draft(CUSTOMERS[1], 'RA-2026-0419', {}, 0.5),
  ];
  for (const j of drafts) await store.saveJob(j);
  for (const [i, days] of [[2, 1], [3, 12], [4, 26]].map(([c, dd]) => [c, dd])) {
    const d = new Date(now.getTime() - days * DAY);
    const j = filled(newJob({ techName: 'Sam Ortiz' }, d), CUSTOMERS[i], d);
    j.values.wo_number = `RA-2026-04${17 - [2, 3, 4].indexOf(i)}`;
    const t = d.toISOString();
    Object.assign(j, { status: 'sent', created_at: t, updated_at: t, completed_at: t, exported_at: t, sent_at: t });
    await store.saveJob(j, { touch: false });
    S.files.push({ name: fileName(j), wo: j.values.wo_number, at: t });
  }
  S.seeded = true;
  save();
}

// ---------- Dropbox (simulated): a completed job uploads by itself ----------
async function upload(id) {
  await new Promise((r) => setTimeout(r, 1200));
  if (!S.signal) return; // stays "Complete, not sent" until there's signal
  const j = await store.getJob(id);
  if (!j || j.status !== 'complete') return;
  hooks.closeEditor();
  const t = new Date().toISOString();
  Object.assign(j, { status: 'sent', sent_at: t, exported_at: t });
  await store.saveJob(j, { touch: false });
  S.files = [{ name: fileName(j), wo: j.values.wo_number, at: t, fresh: true }, ...S.files.map((f) => ({ ...f, fresh: false }))];
  save();
  toast(`☁ Uploaded to Dropbox: ${j.values.wo_number}`);
  hooks.route();
  paint();
}
// Called by the app's "Complete write-up" (patched in the demo copy only).
window.__demoCompleted = (id) => {
  toast(S.signal ? 'Write-up complete. Uploading to Dropbox…' : 'Write-up complete. No signal: it uploads by itself when you have signal.');
  upload(id);
  return true;
};
async function uploadWaiting() {
  for (const j of await store.listJobs()) if (j.status === 'complete') upload(j.id);
}

// ---------- the Demo tab and its panel (the only demo UI on screen) ----------
const css = `
.dm-tab{position:fixed;right:0;top:42%;z-index:40;writing-mode:vertical-rl;background:#5b21b6;color:#fff;border:0;border-radius:10px 0 0 10px;padding:14px 8px;font:700 14px system-ui,sans-serif;letter-spacing:.06em;cursor:pointer;box-shadow:0 4px 14px rgb(0 0 0 / .25)}
.dm-panel{position:fixed;inset:0 0 0 auto;width:min(360px,92vw);z-index:41;background:#faf7ff;color:#1e1433;border-left:3px solid #5b21b6;box-shadow:-8px 0 30px rgb(0 0 0 / .3);overflow-y:auto;padding:16px 16px calc(24px + env(safe-area-inset-bottom,0px));display:grid;gap:14px;align-content:start;font:15px/1.4 system-ui,sans-serif}
.dm-panel h2{margin:0;font-size:18px;display:flex;align-items:center;gap:8px}.dm-panel h2 span{flex:1}
.dm-panel h3{margin:0 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#6b5a8e}
.dm-panel section{background:#fff;border:1px solid #ddd2f5;border-radius:10px;padding:10px 12px}
.dm-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dm-btn{font:600 14px system-ui,sans-serif;border:1.5px solid #c4b5fd;background:#fff;color:#4c1d95;border-radius:8px;padding:8px 12px;min-height:40px;cursor:pointer}
.dm-btn.main{background:#5b21b6;border-color:#5b21b6;color:#fff;width:100%}.dm-btn:disabled{opacity:.45;cursor:not-allowed}
.dm-btn.bad{color:#b91c1c;border-color:#fca5a5}
.dm-x{border:0;background:none;font-size:24px;cursor:pointer;color:#4c1d95;min-width:40px;min-height:40px}
.dm-switch{display:flex;gap:10px;align-items:center;font-weight:600;cursor:pointer}
.dm-switch input{width:22px;height:22px}
.dm-files{display:grid;gap:0;font:12px/1.35 ui-monospace,Consolas,monospace}
.dm-files div{padding:6px 0;border-top:1px solid #eee7fb;overflow-wrap:anywhere}.dm-files div.new{color:#15803d;font-weight:700}
.dm-files small{display:block;font-family:system-ui,sans-serif;color:#6b5a8e}
.dm-tries{margin:0;padding-left:20px;display:grid;gap:6px}
.dm-note{position:fixed;left:50%;transform:translateX(-50%);top:calc(12px + env(safe-area-inset-top,0px));z-index:42;width:min(520px,calc(100% - 32px));background:#5b21b6;color:#fff;border-radius:10px;padding:10px 14px;font:600 14px system-ui,sans-serif;box-shadow:0 6px 20px rgb(0 0 0 / .25)}
.dm-muted{color:#6b5a8e;font-size:13px;margin:0}`;
document.head.append(Object.assign(document.createElement('style'), { textContent: css }));

function demoNote(msg) {
  const n = Object.assign(document.createElement('div'), { className: 'dm-note', textContent: msg });
  n.setAttribute('role', 'status');
  document.body.append(n);
  setTimeout(() => n.remove(), 3600);
}

const tab = Object.assign(document.createElement('button'), { className: 'dm-tab', type: 'button', textContent: '🧪 Demo' });
tab.setAttribute('aria-label', 'Open demo options');
const panel = Object.assign(document.createElement('aside'), { className: 'dm-panel', hidden: true });
panel.setAttribute('aria-label', 'Demo options');
document.body.append(tab, panel);
tab.addEventListener('click', () => { panel.hidden = false; paint(); });

const TRIES = [
  'Open "Tacoma Tow & Haul", tap ✍ Fill (here), then ✓ Complete. It uploads and moves to the Archive.',
  'Turn signal off, finish another job: it waits in "Ready to send". Turn signal back on.',
  'Open the Archive: each sent job shows when it will be deleted from the phone.',
  'Skip 30 days: sent jobs older than 30 days clear from the phone. Dropbox keeps every file.',
  'Open a sent job and delete it by hand.',
];

function currentDraftId() {
  const [, view, id] = location.hash.split('/');
  return view === 'job' && id ? id : null;
}

async function paint() {
  if (panel.hidden) return;
  const id = currentDraftId();
  const j = id ? await store.getJob(id) : null;
  const canFill = !!(j && j.status === 'draft');
  const today = new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  panel.innerHTML = `
    <h2><span>🧪 Demo options</span><button class="dm-x" type="button" data-dm="close" aria-label="Close demo options">×</button></h2>
    <p class="dm-muted">Fake data. Nothing is really sent. Everything else on screen is the real app.</p>
    <section><h3>Fill a write-up</h3>
      <button class="dm-btn main" type="button" data-dm="fill" ${canFill ? '' : 'disabled'}>✍ Fill this write-up with sample answers</button>
      <p class="dm-muted" style="margin-top:6px">${canFill ? 'Fills every box, photo and signature so you can tap ✓ Complete.' : "Open a write-up that's in progress first."}</p></section>
    <section><h3>Signal</h3>
      <label class="dm-switch"><input type="checkbox" data-dm="signal" ${S.signal ? 'checked' : ''}> Phone has signal</label>
      <p class="dm-muted" style="margin-top:6px">Off: finished jobs wait on the phone. On: they upload.</p></section>
    <section><h3>Date · today is ${today}</h3>
      <div class="dm-row"><button class="dm-btn" type="button" data-dm="skip" data-days="1">+1 day</button><button class="dm-btn" type="button" data-dm="skip" data-days="7">+1 week</button><button class="dm-btn" type="button" data-dm="skip" data-days="30">+30 days</button></div></section>
    <section><h3>Office's Dropbox · ${S.files.length} file${S.files.length === 1 ? '' : 's'}</h3>
      <p class="dm-muted">Dropbox › Apps › Write-Up › Sam Ortiz. One file per job. The app never deletes anything here.</p>
      <div class="dm-files">${S.files.map((f) => `<div class="${f.fresh ? 'new' : ''}">${esc(f.name)}<small>${new RealDate(f.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small></div>`).join('') || '<p class="dm-muted">Empty.</p>'}</div></section>
    <section><h3>Try these</h3><ol class="dm-tries">${TRIES.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></section>
    <button class="dm-btn bad" type="button" data-dm="reset">↺ Start the demo over</button>`;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

panel.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-dm]');
  if (!b) return;
  const what = b.dataset.dm;
  if (what === 'close') { panel.hidden = true; return; }
  if (what === 'fill') {
    const id = currentDraftId();
    hooks.closeEditor(); // saves anything typed first
    const j = await store.getJob(id);
    if (!j || j.status !== 'draft') return;
    const match = CUSTOMERS.find((c) => c[0] === j.values.company_name) || CUSTOMERS[5 + (serial % 3)];
    await store.saveJob(filled(j, match, new Date()));
    panel.hidden = true;
    hooks.route();
    demoNote('Filled with sample answers. Scroll down and tap ✓ Complete write-up.');
  }
  if (what === 'skip') {
    S.offsetDays += +b.dataset.days;
    save();
    hooks.closeEditor();
    const gone = await cleanOld();
    hooks.route();
    paint();
    demoNote(`Skipped ${b.dataset.days} day${b.dataset.days === '1' ? '' : 's'} ahead.${gone.jobs ? ` ${gone.jobs} sent job${gone.jobs > 1 ? 's' : ''} cleared from the phone (still in Dropbox).` : ''}`);
  }
  if (what === 'reset') {
    hooks.closeEditor();
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    indexedDB.deleteDatabase(DB_NAME);
    location.href = location.pathname; // fresh start on the job list
  }
});
panel.addEventListener('change', (e) => {
  if (e.target.dataset.dm !== 'signal') return;
  S.signal = e.target.checked;
  save();
  demoNote(S.signal ? '📶 Signal on. Waiting jobs upload now.' : 'Signal off. Finished jobs will wait on the phone.');
  if (S.signal) uploadWaiting();
});
window.addEventListener('hashchange', paint);

// Called by the demo copy of app.js instead of starting the app directly.
export async function boot(route) {
  if (!S.seeded) await seed();
  await cleanOld();
  route();
}
