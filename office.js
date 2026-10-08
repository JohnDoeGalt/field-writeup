// Office view (FR-12…FR-14): drop packages from the techs' phones, see every job in one
// sheet, open a job's report with each photo beside the box it proves, print, export CSV.
// Runs in the same app on the office computer; everything stays on that computer.
import * as store from './store.js';
import { SECTIONS, PHOTO_SLOTS, SIGNATURES, allFields } from './schema.js';
import { computed } from './validate.js';
import { buildCsv, money } from './report.js';
import { mergePlan } from './package.js';
import { readJobsFile } from './transfer.js';
import { h, mount, plural, download } from './ui.js';
import { FORMATTERS } from './format.js';

const STATUS = { draft: 'In progress', complete: 'Complete', sent: 'Sent' };
const photoCount = (j) => Object.values(j.photos).reduce((n, a) => n + a.length, 0)
  + (j.no_parts ? 0 : j.parts.reduce((n, p) => n + (p.receipt_photos || []).length, 0));

// Sheet columns: [key, heading, value for display/sort, numeric?]
const COLS = [
  ['date', 'Date', (j) => j.values.date || ''],
  ['wo', 'WO #', (j) => j.values.wo_number || ''],
  ['company', 'Company', (j) => j.values.company_name || ''],
  ['unit', 'Unit', (j) => j.values.unit_number || ''],
  ['tech', 'Tech', (j) => j.values.tech_name || ''],
  ['status', 'Status', (j) => STATUS[j.status] || j.status],
  ['hours', 'Hours', (j) => computed(j).hours ?? '', true],
  ['miles', 'Miles', (j) => computed(j).miles ?? '', true],
  ['parts', 'Parts $', (j) => computed(j).partsTotal, true],
  ['photos', 'Photos', photoCount, true],
];

// Sort + search survive opening a job and coming back (B-15).
const view = { sort: 'date', dir: -1, q: '', result: null };
try { Object.assign(view, JSON.parse(sessionStorage.getItem('officeView') || '{}'), { result: null }); } catch { /* private mode */ }
const remember = () => { try { sessionStorage.setItem('officeView', JSON.stringify({ sort: view.sort, dir: view.dir, q: view.q })); } catch { /* ignore */ } };

// Dropping a file anywhere must never make the browser open it instead (that would leave the app).
let dropWired = false;
function wireDrop() {
  if (dropWired) return;
  dropWired = true;
  document.addEventListener('dragover', (e) => { if (location.hash.startsWith('#/office')) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!location.hash.startsWith('#/office')) return;
    e.preventDefault();
    document.querySelector('.dropzone')?.classList.remove('over');
    if (e.dataTransfer?.files?.length) importFiles([...e.dataTransfer.files]);
  });
}

async function importFiles(files) {
  const existing = new Map((await store.officeList()).map((j) => [j.id, j]));
  const r = { added: 0, updated: 0, skipped: 0, bad: [] };
  for (const file of files) {
    try {
      const plan = mergePlan((await readJobsFile(file)).jobs, existing);
      await store.officeSaveMany(plan.save.map((j) => ({ ...j, imported_from: file.name })));
      for (const j of plan.save) existing.set(j.id, j);
      r.added += plan.added; r.updated += plan.updated; r.skipped += plan.skipped;
    } catch (e) {
      r.bad.push(`${file.name}: ${/^This /.test(e.message) ? e.message : 'This is not a Write-Up file.'} Nothing from it was added.`);
    }
  }
  view.result = r;
  renderOffice();
}

function resultPanel(r) {
  if (!r) return null;
  return h('div', { class: `${r.bad.length ? 'note' : 'banner'} no-print`, role: 'status' },
    h('p', { text: `${r.added} new, ${r.updated} updated, ${r.skipped} already here.` }),
    r.bad.map((b) => h('p', { class: 'err', text: b })));
}

export async function renderOffice() {
  wireDrop();
  const jobs = await store.officeList();
  const tbody = h('tbody');
  const count = h('p', { class: 'muted small' });

  const drawRows = () => {
    const q = view.q.trim().toLowerCase();
    const col = COLS.find((c) => c[0] === view.sort) || COLS[0];
    const shown = jobs
      .filter((j) => !q || [...Object.values(j.values), ...Object.values(j.na), ...j.parts.flatMap((p) => [p.part_number, p.description, p.supplier])]
        .join(' ').toLowerCase().includes(q))
      .sort((a, b) => {
        const x = col[2](a);
        const y = col[2](b);
        return (col[3] ? (+x || 0) - (+y || 0) : String(x).localeCompare(String(y), undefined, { numeric: true })) * view.dir;
      });
    tbody.replaceChildren(...shown.map((j) => h('tr', {
      tabindex: 0,
      onclick: () => { location.hash = `#/office/job/${encodeURIComponent(j.id)}`; },
      onkeydown: (e) => { if (e.key === 'Enter') location.hash = `#/office/job/${encodeURIComponent(j.id)}`; },
    }, COLS.map(([key, , get]) => h('td', { 'data-col': key, text: key === 'parts' ? money(get(j)) : String(get(j)) })))));
    count.textContent = q ? `Showing ${shown.length} of ${plural(jobs.length, 'job')}` : plural(jobs.length, 'job');
  };

  const head = h('tr', {}, COLS.map(([key, label]) => h('th', { 'aria-sort': view.sort === key ? (view.dir > 0 ? 'ascending' : 'descending') : 'none' },
    h('button', {
      class: 'th-sort', type: 'button',
      text: `${label}${view.sort === key ? (view.dir > 0 ? ' ▲' : ' ▼') : ''}`,
      onclick: () => { view.dir = view.sort === key ? -view.dir : 1; view.sort = key; remember(); renderOffice(); },
    }))));

  mount(
    h('header', { class: 'top no-print' },
      h('a', { class: 'btn ghost', href: '#/', text: '‹ Phone screen' }),
      h('h1', { text: 'Office' }), h('span')),
    h('main', { class: 'office' },
      h('section', {
        class: 'dropzone no-print',
        ondragenter: (e) => e.currentTarget.classList.add('over'),
        ondragleave: (e) => e.currentTarget.classList.remove('over'),
      },
      h('h2', { text: '📦 Drop job packages here' }),
      h('p', { class: 'muted', text: 'Drag the .zip files your techs sent onto this box. You can drop many at once. Jobs you already have are skipped.' }),
      h('label', { class: 'btn primary' }, 'Or pick files…',
        h('input', { type: 'file', multiple: true, accept: '.zip,application/zip,.json,application/json', hidden: true, onchange: (e) => importFiles([...e.target.files]) }))),
      resultPanel(view.result),
      jobs.length === 0
        ? h('p', { class: 'muted', text: 'No jobs yet. Ask your techs to tap "Send my jobs to the office", then drop the file here.' })
        : [
          h('div', { class: 'toolbar no-print' },
            h('input', {
              type: 'search', placeholder: 'Search jobs…', 'aria-label': 'Search jobs', value: view.q,
              oninput: (e) => { view.q = e.target.value; remember(); drawRows(); },
            }),
            h('button', { class: 'btn', type: 'button', text: '🖨 Print sheet', onclick: () => window.print() }),
            h('button', {
              class: 'btn', type: 'button', text: 'Download spreadsheet (CSV)',
              onclick: () => download(new File([buildCsv(jobs)], `WriteUps_office_${new Date().toISOString().slice(0, 10)}.csv`, { type: 'text/csv' })),
            })),
          count,
          h('div', { class: 'table-wrap' }, h('table', { class: 'sheet-table' }, h('thead', {}, head), tbody)),
        ]));
  drawRows();
}

// ---------- one job's report (B-16) ----------
function lightbox(src, label) {
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-label': label, onclick: close },
    h('img', { src, alt: label }), h('p', { text: `${label} · click to close` }));
  document.addEventListener('keydown', onKey);
  document.body.append(box);
}

const thumbs = (label, list) => list.map((src, i) => h('figure', { class: 'rphoto' },
  h('img', { src, alt: `${label}${list.length > 1 ? ` ${i + 1}` : ''}`, onclick: () => lightbox(src, label) }),
  h('figcaption', { text: `📷 ${label}${list.length > 1 ? ` ${i + 1}` : ''}` })));

// FR-16: the report shows phones and miles the same way the phone did (older jobs included).
const shown = (f, v) => (FORMATTERS[f.format] && v ? FORMATTERS[f.format](v).show : String(v ?? ''));

function fieldBlock(job, f) {
  const na = job.na[f.id];
  const slots = PHOTO_SLOTS.filter((s) => s.for === f.id);
  return h('div', { class: 'rfield' },
    h('div', { class: 'rlabel', text: f.label }),
    na != null ? h('div', { class: 'rvalue na', text: `N/A: ${na}` }) : h('div', { class: 'rvalue', text: shown(f, job.values[f.id]) || '—' }),
    f.id === 'vin' && job.vin_override && h('div', { class: 'muted small', text: 'Check digit overridden by the tech (see VIN plate photo).' }),
    slots.map((s) => (job.photo_na[s.id] != null
      ? h('div', { class: 'muted small', text: `📷 ${s.label}: N/A (${job.photo_na[s.id]})` })
      : h('div', { class: 'rphotos' }, thumbs(s.label, job.photos[s.id] || [])))));
}

function partsBlock(job) {
  if (job.no_parts) return h('p', { text: 'No parts used.' });
  return h('div', { class: 'table-wrap' }, h('table', { class: 'parts-table' },
    h('thead', {}, h('tr', {}, ['Qty', 'Part #', 'Description', 'Supplier', 'Cost/price', 'Line total', 'Receipt'].map((t) => h('th', { text: t })))),
    h('tbody', {}, job.parts.map((p, i) => h('tr', {},
      h('td', { text: p.qty ?? '' }), h('td', { text: p.part_number ?? '' }), h('td', { text: p.description ?? '' }),
      h('td', { text: p.supplier ?? '' }), h('td', { text: money(p.price) }), h('td', { text: money((+p.qty || 0) * (+p.price || 0)) }),
      h('td', {}, p.receipt_na != null ? h('span', { class: 'muted small', text: `N/A: ${p.receipt_na}` })
        : h('div', { class: 'rphotos' }, thumbs(`Part ${i + 1} receipt`, p.receipt_photos || []))))))));
}

// B-25: copy one line to paste into Invoice Simple (it has no import; S10).
async function copyText(text, btn) {
  btn.textContent = await navigator.clipboard.writeText(text).then(() => 'Copied ✓', () => 'Copy failed');
  setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
}
const copyBtn = (text) => h('button', { class: 'btn small copy no-print', type: 'button', text: 'Copy', 'aria-label': `Copy: ${text}`, onclick: (e) => copyText(text, e.currentTarget) });
const line = (label, text) => h('li', {}, h('strong', { text: label }), ' ', h('span', { class: 'copy-text', text }), ' ', copyBtn(text));

// B-07: the invoice, laid out in the order it's typed into Invoice Simple. No rates invented (Q3/Q4).
function invoiceBlock(job) {
  const c = computed(job);
  const v = job.values;
  const items = [
    `Labor: ${c.hours ?? '?'} h  (${(v.start_time || '').replace('T', ' ')} → ${(v.end_time || '').replace('T', ' ')})`,
    ...(job.no_parts ? [] : job.parts.map((p) => `Part: ${p.qty} × ${p.description}${p.part_number ? ` (${p.part_number})` : ''} @ ${money(p.price)} = ${money((+p.qty || 0) * (+p.price || 0))}`)),
    `Service truck: ${c.miles ?? '?'} mi`,
  ];
  const client = `${v.company_name || '—'}${v.contact_name ? ` (attn ${v.contact_name})` : ''}${v.phone ? ` · ${v.phone}` : ''}${v.email ? ` · ${v.email}` : ''}`;
  const notes = `Unit ${v.unit_number || '—'} · Plate ${v.plate || job.na.plate || '—'} · VIN ${v.vin || '—'} · Mileage ${shown({ format: 'thousands' }, v.unit_mileage) || '—'}`;
  return h('section', { class: 'invoice' },
    h('h2', { text: 'Invoice Simple entry' }),
    h('p', { class: 'muted small no-print', text: 'Click Copy, then paste into Invoice Simple.' }),
    h('ol', {},
      line('Client:', client),
      line('Invoice #:', v.wo_number || '—'),
      h('li', {}, h('strong', { text: 'Line items:' }), h('ul', {}, items.map((t) => h('li', {}, h('span', { class: 'copy-text', text: t }), ' ', copyBtn(t))))),
      line('Parts subtotal:', money(c.partsTotal)),
      line('Notes for the invoice:', notes)));
}

export async function renderOfficeJob(id) {
  const job = await store.officeGet(id);
  if (!job) { location.hash = '#/office'; return; }
  const v = job.values;
  const fields = allFields();
  mount(
    h('header', { class: 'top no-print' },
      h('a', { class: 'btn ghost', href: '#/office', text: '‹ All jobs' }),
      h('h1', { text: v.wo_number || 'Job' }),
      h('button', { class: 'btn ghost', type: 'button', text: '🖨 Print this job', onclick: () => window.print() })),
    h('main', { class: 'report' },
      h('div', { class: 'rhead' },
        h('h1', { text: `Service write-up · ${v.wo_number || ''}` }),
        h('p', { text: `${v.company_name || ''} · ${v.date || ''} · Tech: ${v.tech_name || ''} · ${STATUS[job.status] || job.status}` }),
        job.revision > 1 && h('p', { class: 'note', text: `Revision ${job.revision}: the tech reopened and changed this job. It replaces any earlier copy.` }),
        job.odo_confirm && h('p', { class: 'note', text: `Odometer is lower than last time; the tech confirmed it: "${job.odo_confirm}".` }),
        job.imported_from && h('p', { class: 'muted small', text: `From package ${job.imported_from}` })),
      invoiceBlock(job),
      SECTIONS.map((s) => h('section', { class: 'rsection' },
        h('h2', { text: s.title }),
        s.fields ? h('div', { class: 'rgrid' }, fields.filter((f) => f.section === s.id).map((f) => fieldBlock(job, f)))
          : s.special === 'parts' ? partsBlock(job)
            : h('div', { class: 'rphotos' }, SIGNATURES.map((g) => (job.signatures[g.id]
              ? h('figure', { class: 'rsig' }, h('img', { src: job.signatures[g.id], alt: g.label }), h('figcaption', { text: g.label }))
              : h('p', { class: 'muted', text: `${g.label}: missing` })))))),
      (job.photos.unassigned || []).length > 0 && h('section', { class: 'rsection' },
        h('h2', { text: 'Older receipts (not matched to a part)' }),
        h('div', { class: 'rphotos' }, thumbs('Older receipt', job.photos.unassigned))),
      job.address_from_gps && h('p', { class: 'muted small', text: `Address filled from GPS and ${job.address_confirmed ? 'confirmed' : 'NOT confirmed'} by the tech.` }),
      // The pin is saved on every tap, even where there's no address (roadside, middle of nowhere).
      job.gps && h('p', { class: 'small' },
        `📍 GPS pin: ${job.gps.lat.toFixed(5)}, ${job.gps.lng.toFixed(5)} (±${Math.round(job.gps.acc)} m) `,
        h('a', { href: `https://www.google.com/maps?q=${job.gps.lat},${job.gps.lng}`, target: '_blank', rel: 'noopener', class: 'no-print', text: 'Open in Maps' }))));
}
