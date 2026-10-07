import { SECTIONS, PART_COLUMNS, PHOTO_SLOTS, SIGNATURES, allFields, newJob } from './schema.js';
import { validateJob, computed, normalizeVin, vinProblem } from './validate.js';
import * as store from './store.js';
import { buildPdf, buildCsv, fileBase } from './report.js';

const $app = document.getElementById('app');

// Tiny DOM helper. Text always goes through textContent, so typed data can't inject HTML.
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(kid));
  return el;
}

// Top-level render. Drops `cond && node` placeholders that h() would otherwise never see.
const mount = (...nodes) => $app.replaceChildren(...nodes.flat().filter((n) => n != null && n !== false));

// Validation context from job history: highest odometer previously recorded for this unit.
function unitContext(job, jobs) {
  const unit = job.values.unit_number?.trim();
  if (!unit) return {};
  const prior = jobs.filter((j) => j.id !== job.id && j.values.unit_number?.trim() === unit && /^\d+$/.test(j.values.unit_mileage || ''))
    .map((j) => +j.values.unit_mileage);
  return { lastUnitMileage: prior.length ? Math.max(...prior) : null };
}

const pad = (n) => String(n).padStart(2, '0');
const localDateTime = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status', text: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

// ---------- install guide ----------
// An iPhone keeps a Home Screen app's data apart from Safari's, so jobs typed in a Safari
// tab would never show up in the installed app. On iPhone the guide comes first.
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const isIOSSafari = () => isIOS() && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(navigator.userAgent);
let installPrompt = null; // Android/Chrome one-tap install
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (!location.hash.startsWith('#/job')) route();
});
const browserOk = () => { try { return sessionStorage.getItem('browserOk') === '1'; } catch { return false; } };

function step(n, text) {
  return h('li', { class: 'step' }, h('span', { class: 'num', text: String(n) }), h('span', { text }));
}

function installGuide(compact) {
  const ios = isIOS();
  const steps = ios
    ? (isIOSSafari()
      ? [step(1, 'Tap the Share button ⬆️ (a square with an arrow).'), step(2, 'Scroll down. Tap "Add to Home Screen" ➕.'), step(3, 'Tap "Add".'), step(4, 'Go to your Home Screen. Tap the Write-Up icon 📋.')]
      : [step(1, 'This is not Safari. Copy this page link.'), step(2, 'Open Safari 🧭 and paste the link.'), step(3, 'Then follow the steps you see there.')])
    : [step(1, 'Tap the 3 dots ⋮ at the top.'), step(2, 'Tap "Install app" or "Add to Home screen".'), step(3, 'Tap "Install".'), step(4, 'Tap the new Write-Up icon 📋.')];
  return h('section', { class: `install ${compact ? 'compact' : ''}` },
    h('h2', { text: '📲 Put this app on your phone' }),
    installPrompt && h('button', {
      class: 'btn primary big',
      text: 'Install app',
      onclick: async () => { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; route(); },
    }),
    h('p', { class: 'muted', text: installPrompt ? 'Or do it by hand:' : 'Do this one time:' }),
    h('ol', { class: 'steps' }, steps),
    ios && h('p', { class: 'note', text: 'Always use the app icon. Jobs typed in Safari do not show up in the app.' }));
}

function renderInstallGate() {
  mount(
    h('header', { class: 'top' }, h('h1', { text: 'Write-Up 📋' })),
    h('main', {},
      installGuide(false),
      h('button', {
        class: 'btn ghost',
        text: 'Skip, use it in the browser',
        onclick: () => { try { sessionStorage.setItem('browserOk', '1'); } catch { /* private mode */ } route(); },
      })));
}

// ---------- routing ----------
window.addEventListener('hashchange', route);
async function route() {
  if (isIOS() && !isStandalone() && !browserOk()) return renderInstallGate();
  const settings = await store.getSettings();
  const [, view, id] = location.hash.split('/');
  if (!settings.techName && view !== 'settings') { location.hash = '#/settings'; return; }
  if (view === 'job' && id) return renderEditor(id, settings);
  if (view === 'settings') return renderSettings(settings);
  return renderHome(settings);
}

// ---------- home ----------
async function renderHome(settings) {
  const jobs = await store.listJobs();
  const groups = [
    ['draft', 'In progress'],
    ['complete', 'Ready to send'],
    ['sent', 'Sent'],
  ];
  const unsent = jobs.filter((j) => j.status === 'complete');
  mount(
    h('header', { class: 'top' },
      h('h1', { text: 'Write-ups' }),
      h('a', { class: 'btn ghost', href: '#/settings', text: 'Settings' })),
    h('main', { class: 'home' },
      !isStandalone() && installGuide(true),
      h('button', { class: 'btn primary big', onclick: () => createJob(settings), text: '+ New write-up' }),
      unsent.length > 1 && h('button', { class: 'btn big', onclick: () => sendJobs(unsent, settings), text: `Send all ${unsent.length} ready to the office` }),
      jobs.length === 0 && h('p', { class: 'muted', text: 'No write-ups yet. Everything you enter is saved on this phone, no signal needed.' }),
      ...groups.map(([status, title]) => {
        const list = jobs.filter((j) => j.status === status);
        if (!list.length) return null;
        return h('section', {},
          h('h2', { text: `${title} (${list.length})` }),
          h('ul', { class: 'jobs' }, list.map((j) => jobRow(j, jobs))));
      })));
}

function jobRow(job, jobs) {
  const v = job.values;
  const missing = job.status === 'draft' ? validateJob(job, unitContext(job, jobs)).length : 0;
  return h('li', {},
    h('a', { href: `#/job/${job.id}` },
      h('strong', { text: v.company_name || 'New job' }),
      h('span', { text: [v.wo_number, v.unit_number && `Unit ${v.unit_number}`, v.date].filter(Boolean).join(' · ') }),
      job.status === 'draft' && h('span', { class: 'badge warn', text: `${missing} missing` }),
      job.status === 'complete' && h('span', { class: 'badge ok', text: 'Complete, not sent' }),
      job.status === 'sent' && h('span', { class: 'badge', text: `Sent ${new Date(job.sent_at).toLocaleDateString()}` })));
}

async function createJob(settings) {
  const job = newJob(settings);
  await store.saveJob(job);
  location.hash = `#/job/${job.id}`;
}

// ---------- settings ----------
function renderSettings(settings) {
  const s = { ...settings };
  const input = (key, label, props = {}) => h('label', { class: 'field' },
    h('span', { class: 'label', text: label }),
    h('input', { value: s[key] || '', oninput: (e) => { s[key] = e.target.value; }, ...props }));
  mount(
    h('header', { class: 'top' },
      settings.techName ? h('a', { class: 'btn ghost', href: '#/', text: '‹ Back' }) : h('span'),
      h('h1', { text: 'Settings' }), h('span')),
    h('main', { class: 'settings' },
      !settings.techName && !isStandalone() && installGuide(true),
      !settings.techName && h('p', { class: 'note', text: '👋 Hi! Do this one time. Type your name and the office email. Then tap Save.' }),
      input('techName', 'Your name', { autocomplete: 'name', required: true }),
      input('officeEmail', 'Office email (your jobs go here)', { type: 'email', inputmode: 'email' }),
      input('woPrefix', 'Letters for work order numbers (you can skip this)', { placeholder: 'e.g. RA' }),
      h('button', {
        class: 'btn primary big',
        text: 'Save',
        onclick: async () => {
          if (!s.techName?.trim()) { toast('Enter your name first'); return; }
          await store.saveSettings({ ...s, techName: s.techName.trim() });
          location.hash = '#/';
        },
      }),
      h('h2', { text: 'Backup' }),
      h('p', { class: 'muted', text: 'Write-ups live only on this phone. Export a backup now and then (e.g. email it to yourself).' }),
      h('button', { class: 'btn', onclick: exportBackup, text: 'Export backup (all data)' }),
      h('button', { class: 'btn', onclick: exportCsvAll, text: 'Export spreadsheet (CSV, all jobs)' }),
      h('label', { class: 'btn' }, 'Restore from backup…',
        h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: (e) => restoreBackup(e.target.files[0]) }))));
}

// ---------- editor ----------
async function renderEditor(id, settings) {
  const job = await store.getJob(id);
  if (!job) { location.hash = '#/'; return; }
  const others = (await store.listJobs()).filter((j) => j.id !== id);
  const touched = new Set();
  let attempted = false;
  let saveTimer;
  const locked = job.status !== 'draft';

  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.saveJob(job), 300); };
  const flush = () => { clearTimeout(saveTimer); return store.saveJob(job); };
  document.onvisibilitychange = () => { if (document.hidden) flush(); };

  const ctx = () => unitContext(job, others);

  // Re-show error text and the bottom bar without rebuilding inputs (keeps focus/keyboard).
  function refresh() {
    const probs = validateJob(job, ctx());
    const byKey = new Map(probs.map((p) => [p.key, p]));
    for (const el of $app.querySelectorAll('[data-key]')) {
      const p = byKey.get(el.dataset.key);
      const show = p && (attempted || touched.has(el.dataset.key));
      el.classList.toggle('invalid', !!show);
      const msg = el.querySelector(':scope > .err');
      if (msg) msg.textContent = show ? p.message : '';
      el.classList.toggle('done', !p);
    }
    for (const sec of $app.querySelectorAll('section[data-section]')) {
      const n = probs.filter((p) => p.section === sec.dataset.section).length;
      const badge = sec.querySelector('.count');
      badge.textContent = n ? `${n} to do` : '✓';
      badge.className = `count ${n ? 'warn' : 'ok'}`;
    }
    const override = $app.querySelector('.vin-override');
    if (override) {
      override.hidden = !job.vin_override && !vinProblem(job.values.vin || '')?.startsWith('VIN check digit');
    }
    const c = computed(job);
    $app.querySelector('#totals').textContent = [
      c.hours != null && `${c.hours} h`, c.miles != null && `${c.miles} mi`, `parts $${c.partsTotal.toFixed(2)}`,
    ].filter(Boolean).join(' · ');
    if (!locked) renderBar(probs);
    return probs;
  }

  // One persistent button, updated in place. Replacing it would break taps: blurring a
  // field on touchstart re-renders the bar, and the tap's click then hits a detached node.
  function renderBar(probs) {
    const bar = $app.querySelector('#bar');
    let btn = bar.querySelector('button');
    if (!btn) {
      btn = h('button', { type: 'button', onclick: complete });
      bar.append(btn);
    }
    btn.className = `btn big ${probs.length ? 'warn' : 'primary'}`;
    btn.textContent = probs.length ? `${probs.length} missing: show me` : '✓ Complete write-up';
  }

  function showMissing(probs) {
    const dlg = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Missing items' },
      h('div', { class: 'sheet-head' }, h('strong', { text: `Can't complete yet: ${probs.length} to fix` }),
        h('button', { class: 'btn ghost', onclick: () => dlg.remove(), text: 'Close' })),
      h('ul', {}, probs.map((p) => h('li', {},
        h('button', {
          class: 'linkish',
          onclick: () => { dlg.remove(); jumpTo(p.key); },
        }, h('strong', { text: p.label }), ` — ${p.message}`)))));
    document.body.append(dlg);
  }

  function jumpTo(key) {
    const el = $app.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.querySelector('input:not([type=checkbox]):not([hidden]), textarea, select, canvas, button')?.focus({ preventScroll: true });
  }

  async function complete() {
    const probs = validateJob(job, ctx());
    if (probs.length) { attempted = true; refresh(); showMissing(probs); return; }
    job.status = 'complete';
    job.completed_at = new Date().toISOString();
    await flush();
    renderEditor(id, settings);
    toast('Write-up complete. Send it to the office.');
  }

  // --- field widgets ---
  function fieldEl(f) {
    const isNA = job.na[f.id] != null;
    const set = (val) => { job.values[f.id] = val; touched.add(f.id); save(); refresh(); };
    let input;
    const common = { id: `in-${f.id}`, disabled: locked || isNA, onblur: () => { touched.add(f.id); refresh(); } };
    if (f.type === 'textarea') {
      input = h('textarea', { ...common, rows: 3, value: job.values[f.id] || '', oninput: (e) => set(e.target.value) });
    } else if (f.type === 'select') {
      input = h('select', { ...common, onchange: (e) => set(e.target.value) },
        h('option', { value: '', text: 'Choose…' }),
        f.options.map((o) => h('option', { value: o, text: o, selected: job.values[f.id] === o })));
    } else {
      const extra = {
        tel: { inputmode: 'tel', autocomplete: 'off' },
        email: { inputmode: 'email', autocapitalize: 'off' },
        number: { inputmode: 'numeric', type: 'text', pattern: '[0-9]*' },
      }[f.type] || {};
      input = h('input', {
        ...common, type: f.type, value: job.values[f.id] || '', ...extra,
        list: { company_name: 'dl-company', unit_number: 'dl-unit' }[f.id],
        autocapitalize: f.id === 'vin' || f.id === 'plate' ? 'characters' : extra.autocapitalize,
        oninput: (e) => set(e.target.value),
        onchange: (e) => onPick(f.id, e.target.value),
      });
    }

    const helpers = [];
    if (!locked && !isNA) {
      if (f.id === 'wo_number') helpers.push(h('button', { class: 'btn small', type: 'button', text: 'Auto', onclick: () => {
        const d = new Date();
        const initials = (settings.woPrefix || settings.techName.split(/\s+/).map((w) => w[0]).join('')).toUpperCase();
        input.value = `${initials}-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
        set(input.value);
      } }));
      if (f.type === 'datetime-local') helpers.push(h('button', { class: 'btn small', type: 'button', text: 'Now', onclick: () => { input.value = localDateTime(); set(input.value); } }));
      if (f.id === 'address') helpers.push(h('button', { class: 'btn small', type: 'button', text: job.gps ? 'GPS ✓ (update)' : 'Save GPS', onclick: (e) => captureGps(e.target) }));
    }

    const wrap = h('div', { class: 'field', 'data-key': f.id },
      h('label', { class: 'label', for: `in-${f.id}`, text: f.label }),
      h('div', { class: 'row' }, input, ...helpers),
      h('div', { class: 'err', 'aria-live': 'polite' }));

    if (f.id === 'vin' && !locked) {
      wrap.append(h('label', { class: 'check vin-override', hidden: true },
        h('input', { type: 'checkbox', checked: !!job.vin_override, onchange: (e) => { job.vin_override = e.target.checked; save(); refresh(); } }),
        ' Check digit fails but I double-checked it against the plate (needs VIN plate photo)'));
    }
    if (f.na && !locked) wrap.append(naToggle(f.id, isNA, job.na, () => rerender()));
    else if (isNA) wrap.append(h('div', { class: 'muted', text: `N/A: ${job.na[f.id]}` }));
    return wrap;
  }

  function naToggle(key, isNA, bag, after) {
    const box = h('div', { class: 'na' },
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: isNA, onchange: (e) => { if (e.target.checked) bag[key] = ''; else delete bag[key]; touched.add(key); save(); after(); } }),
        ' N/A'));
    if (isNA) {
      box.append(h('input', {
        class: 'na-reason', placeholder: 'Why? (required)', value: bag[key],
        oninput: (e) => { bag[key] = e.target.value; save(); refresh(); },
      }));
    }
    return box;
  }

  // Picking a known company/unit fills the rest, so repeat customers are a couple of taps.
  function onPick(fieldId, value) {
    const v = value.trim();
    const fillFrom = (src, ids) => {
      let filled = false;
      for (const k of ids) if (!job.values[k] && src.values[k]) { job.values[k] = src.values[k]; filled = true; }
      if (filled) { save(); rerender(); toast('Filled from a previous job'); }
    };
    if (fieldId === 'company_name') {
      const src = others.find((j) => j.values.company_name?.trim().toLowerCase() === v.toLowerCase());
      if (src) fillFrom(src, ['contact_name', 'phone', 'email']);
    }
    if (fieldId === 'unit_number') {
      const src = others.find((j) => j.values.unit_number?.trim() === v
        && (!job.values.company_name || j.values.company_name === job.values.company_name));
      if (src) fillFrom(src, ['company_name', 'contact_name', 'phone', 'email', 'plate', 'state', 'vin']);
    }
    if (fieldId === 'vin') { job.values.vin = normalizeVin(value); save(); rerender(); }
  }

  function captureGps(btn) {
    if (!navigator.geolocation) { toast('GPS not available on this device'); return; }
    btn.textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition((pos) => {
      job.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, at: new Date().toISOString() };
      save();
      btn.textContent = 'GPS ✓ (update)';
      toast(`Location saved (±${Math.round(pos.coords.accuracy)} m). Still type the address.`);
    }, () => { btn.textContent = 'Save GPS'; toast('Could not get a GPS fix'); }, { enableHighAccuracy: true, timeout: 20000 });
  }

  function partsSection() {
    const box = h('div', { class: 'parts', 'data-key': 'parts' });
    if (!job.no_parts) {
      job.parts.forEach((p, i) => {
        box.append(h('div', { class: 'part' },
          h('div', { class: 'part-head' }, h('strong', { text: `Part ${i + 1}` }),
            !locked && h('button', { class: 'btn ghost small', type: 'button', text: 'Remove', onclick: () => { job.parts.splice(i, 1); save(); rerender(); } })),
          PART_COLUMNS.map((c) => h('div', { class: 'field', 'data-key': `part-${i}-${c.id}` },
            h('label', { class: 'label', for: `part-${i}-${c.id}`, text: c.label }),
            h('input', {
              id: `part-${i}-${c.id}`, value: p[c.id] ?? '', disabled: locked,
              ...(c.type === 'number' ? { inputmode: 'decimal' } : {}),
              oninput: (e) => { p[c.id] = e.target.value; touched.add(`part-${i}-${c.id}`); save(); refresh(); },
            }),
            h('div', { class: 'err' })))));
      });
      if (!locked) box.append(h('button', { class: 'btn', type: 'button', text: '+ Add part', onclick: () => { job.parts.push({}); save(); rerender(); } }));
    }
    if (!locked && job.parts.length === 0) {
      box.append(h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: job.no_parts, onchange: (e) => { job.no_parts = e.target.checked; touched.add('parts'); save(); rerender(); } }),
        ' No parts used on this job'));
    } else if (job.no_parts) {
      box.append(h('p', { class: 'muted', text: 'No parts used.' }));
    }
    box.append(h('div', { class: 'err' }));
    return box;
  }

  function photosSection() {
    const partsUsed = !job.no_parts && job.parts.length > 0;
    return h('div', {}, PHOTO_SLOTS.filter((s) => !s.whenParts || partsUsed).map((s) => {
      const list = job.photos[s.id] || [];
      const isNA = job.photo_na[s.id] != null;
      const key = `photo-${s.id}`;
      const wrap = h('div', { class: 'field photo-slot', 'data-key': key },
        h('span', { class: 'label', text: `Photo: ${s.label}` }),
        h('div', { class: 'thumbs' }, list.map((src, i) => h('figure', {},
          h('img', { src, alt: `${s.label} ${i + 1}` }),
          !locked && h('button', { class: 'btn ghost small', type: 'button', text: 'Remove', onclick: () => { list.splice(i, 1); save(); rerender(); } })))),
        !locked && !isNA && (s.multiple || list.length === 0) && h('label', { class: 'btn' },
          list.length ? '+ Another photo' : '📷 Take photo',
          h('input', {
            type: 'file', accept: 'image/*', capture: 'environment', hidden: true, multiple: !!s.multiple,
            onchange: async (e) => {
              for (const file of e.target.files) list.push(await shrinkPhoto(file));
              job.photos[s.id] = list;
              touched.add(key);
              save();
              rerender();
            },
          })),
        h('div', { class: 'err' }));
      if (s.na !== false && !locked && list.length === 0) wrap.append(naToggle(s.id, isNA, job.photo_na, () => rerender()));
      return wrap;
    }));
  }

  function signaturesSection() {
    return h('div', { class: 'sigs' }, SIGNATURES.map((s) => {
      const key = `sig-${s.id}`;
      const canvas = h('canvas', { class: 'sigpad', width: 600, height: 180, tabindex: 0, 'aria-label': `${s.label} pad` });
      const wrap = h('div', { class: 'field', 'data-key': key },
        h('span', { class: 'label', text: s.label }),
        canvas,
        !locked && h('button', { class: 'btn ghost small', type: 'button', text: 'Clear', onclick: () => { delete job.signatures[s.id]; save(); rerender(); } }),
        h('div', { class: 'err' }));
      setupSigPad(canvas, job.signatures[s.id], locked, (dataUrl) => { job.signatures[s.id] = dataUrl; touched.add(key); save(); refresh(); });
      return wrap;
    }));
  }

  function rerender() {
    const scroll = window.scrollY;
    build();
    window.scrollTo(0, scroll);
  }

  function build() {
    const allF = allFields();
    const companies = [...new Set(others.map((j) => j.values.company_name).filter(Boolean))];
    const units = [...new Set(others.map((j) => j.values.unit_number).filter(Boolean))];
    mount(
      h('header', { class: 'top' },
        h('a', { class: 'btn ghost', href: '#/', onclick: flush, text: '‹ Jobs' }),
        h('h1', { text: job.values.wo_number || 'Write-up' }),
        h('span', { id: 'totals', class: 'muted small' })),
      h('datalist', { id: 'dl-company' }, companies.map((c) => h('option', { value: c }))),
      h('datalist', { id: 'dl-unit' }, units.map((u) => h('option', { value: u }))),
      locked && h('div', { class: 'banner' },
        h('p', { text: job.status === 'sent' ? `Sent ${new Date(job.sent_at).toLocaleString()}` : 'Complete. Send it to the office.' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', text: job.status === 'sent' ? 'Send again' : 'Send to office', onclick: () => sendJobs([job], settings) }),
          h('button', { class: 'btn', text: 'View PDF', onclick: () => viewPdf(job) }),
          h('button', { class: 'btn ghost', text: 'Reopen to edit', onclick: async () => { job.status = 'draft'; await flush(); renderEditor(id, settings); } }))),
      h('main', { class: 'editor' },
        SECTIONS.map((s) => h('section', { 'data-section': s.id },
          h('h2', {}, s.title, ' ', h('span', { class: 'count' })),
          s.fields ? allF.filter((f) => f.section === s.id).map(fieldEl)
            : s.special === 'parts' ? partsSection()
              : s.special === 'photos' ? photosSection()
                : signaturesSection())),
        !locked && h('button', {
          class: 'btn ghost danger', type: 'button', text: 'Delete this write-up',
          onclick: async (e) => {
            if (e.target.dataset.armed) { await store.deleteJob(job.id); location.hash = '#/'; return; }
            e.target.dataset.armed = '1';
            e.target.textContent = 'Tap again to delete permanently';
          },
        })),
      h('footer', { id: 'bar', class: 'bar' }));
    refresh();
  }

  build();
}

// ---------- photos & signatures ----------
async function loadImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Older iOS Safari: fall back to an <img>, which also honours EXIF orientation.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function shrinkPhoto(file, max = 1600) {
  const bmp = await loadImage(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}

function setupSigPad(canvas, existing, locked, onDone) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#111';
  if (existing) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = existing;
  }
  if (locked) return;
  let drawing = false;
  let inked = false;
  const pt = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
  };
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    ctx.beginPath();
    ctx.moveTo(...pt(e));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    ctx.lineTo(...pt(e));
    ctx.stroke();
    inked = true;
  });
  const end = () => {
    if (!drawing) return;
    drawing = false;
    if (inked) onDone(canvas.toDataURL('image/png'));
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

// ---------- sending ----------
async function sendJobs(jobs, settings) {
  const files = jobs.map((j) => new File([buildPdf(j)], `${fileBase(j)}.pdf`, { type: 'application/pdf' }));
  const stamp = new Date().toISOString().slice(0, 10);
  files.push(new File([buildCsv(jobs)], `WriteUps_${settings.techName.replace(/\W+/g, '_')}_${stamp}.csv`, { type: 'text/csv' }));
  const subject = jobs.length === 1
    ? `Write-up ${jobs[0].values.wo_number}: ${jobs[0].values.company_name}`
    : `${jobs.length} write-ups from ${settings.techName} (${stamp})`;
  const text = `${subject}\nSent from the Field Write-Up app by ${settings.techName}.`;

  let sent = false;
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title: subject, text });
      sent = true;
    } catch (e) {
      if (e.name === 'AbortError') return; // tech cancelled the share sheet
    }
  }
  if (!sent) {
    // No file sharing (e.g. desktop): download the files and open a pre-addressed email.
    files.forEach(download);
    location.href = `mailto:${encodeURIComponent(settings.officeEmail || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${text}\n\nAttach the downloaded files: ${files.map((f) => f.name).join(', ')}`)}`;
    sent = true;
  }
  const now = new Date().toISOString();
  for (const j of jobs) { j.status = 'sent'; j.sent_at = now; await store.saveJob(j); }
  toast(jobs.length === 1 ? 'Marked as sent' : `${jobs.length} write-ups marked as sent`);
  route();
}

function download(file) {
  const a = h('a', { href: URL.createObjectURL(file), download: file.name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function viewPdf(job) {
  download(new File([buildPdf(job)], `${fileBase(job)}.pdf`, { type: 'application/pdf' }));
}

// ---------- backup ----------
async function exportBackup() {
  const data = { app: 'field-writeup', version: 1, exported_at: new Date().toISOString(), settings: await store.getSettings(), jobs: await store.listJobs() };
  const file = new File([JSON.stringify(data)], `FieldWriteUp_backup_${data.exported_at.slice(0, 10)}.json`, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Write-up backup' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  download(file);
}

async function exportCsvAll() {
  const jobs = await store.listJobs();
  download(new File([buildCsv(jobs)], `WriteUps_all_${new Date().toISOString().slice(0, 10)}.csv`, { type: 'text/csv' }));
}

async function restoreBackup(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'field-writeup' || !Array.isArray(data.jobs)) throw new Error('not a backup');
    const existing = new Set((await store.listJobs()).map((j) => j.id));
    let added = 0;
    for (const j of data.jobs) if (!existing.has(j.id)) { await store.saveJob(j); added++; }
    toast(`Restored ${added} write-up(s); ${data.jobs.length - added} already on this phone`);
    location.hash = '#/';
  } catch {
    toast('That file is not a Field Write-Up backup');
  }
}

// ---------- boot ----------
store.requestPersistence();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
route();
