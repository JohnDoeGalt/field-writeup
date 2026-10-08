import { SECTIONS, PART_COLUMNS, PART_RECEIPT, PHOTO_SLOTS, SIGNATURES, allFields, newJob, clientName } from './schema.js';
import { validateJob, computed, normalizeVin, vinProblem, unitContext, jobContext, woKey, lengthHint } from './validate.js';
import * as store from './store.js';
import { selectForExport } from './package.js';
import { $app, h, mount, toast, ask, pad, localDateTime, hooks } from './ui.js';
import { isStandalone, isIOS, browserOk, installGuide, renderInstallGate } from './install.js';
import { shrinkPhoto, setupSigPad, openBigPad } from './media.js';
import { lookupAddress, ATTRIBUTION } from './geo.js';
import { FORMATTERS, KEY_CHARS, formatMoney, formatMoneyOnLeave, caretAfter, countKeyChars } from './format.js';
import { exportPackage, removeExported, exportBackup, restoreBackup } from './transfer.js';
import { renderOffice, renderOfficeJob } from './office.js';


// ---------- routing ----------
window.addEventListener('hashchange', route);
async function route() {
  try {
    await showRoute();
  } catch (e) {
    console.error(e);
    mount(h('main', {},
      h('p', { class: 'note', text: 'Oops. Something went wrong on this screen. Your saved jobs are safe.' }),
      h('a', { class: 'btn primary big', href: '#/', text: 'Go to my jobs' })));
  }
}

async function showRoute() {
  closeEditor();
  const [, view, id, jobId] = location.hash.split('/');
  // The office computer needs no tech setup and no phone install guide.
  if (view === 'office') return id === 'job' && jobId ? renderOfficeJob(decodeURIComponent(jobId)) : renderOffice();
  if (isIOS() && !isStandalone() && !browserOk()) return renderInstallGate();
  const settings = await store.getSettings();
  if (!settings.techName && view !== 'settings') { location.hash = '#/settings'; return; }
  if (view === 'job' && id) return renderEditor(id, settings);
  if (view === 'settings') return renderSettings(settings);
  return renderHome(settings);
}

// B-09: finished write-ups that sat unsent for 12+ hours get a loud reminder with one tap to send.
const UNSENT_AFTER_MS = 12 * 3600e3;
function unsentBanner(settings, jobs) {
  const late = jobs.filter((j) => j.status === 'complete' && Date.now() - Date.parse(j.completed_at || j.updated_at) > UNSENT_AFTER_MS);
  if (!late.length) return null;
  return h('div', { class: 'note unsent', role: 'alert' },
    h('p', {}, h('strong', { text: `⚠️ ${late.length === 1 ? '1 write-up is' : `${late.length} write-ups are`} done but not sent to the office yet.` })),
    h('button', { class: 'btn primary big', type: 'button', text: 'Send now', onclick: () => exportPackage(settings.exportMode === 'since-last' ? 'since-last' : 'everything', settings) }));
}

// The Export button(s) the techs see, per the exportMode setting (FR-15).
function exportButtons(settings, jobs) {
  if (!jobs.length) return [];
  const fresh = selectForExport(jobs, 'since-last').length;
  const all = h('button', { class: 'btn big', onclick: () => exportPackage('everything', settings), text: `📦 Send all my jobs to the office (${jobs.length})` });
  const since = h('button', { class: 'btn big', onclick: () => exportPackage('since-last', settings), text: `📦 Send my new jobs to the office (${fresh})` });
  return { everything: [all], 'since-last': [since], both: [since, all] }[settings.exportMode] || [all];
}

// ---------- home ----------
async function renderHome(settings) {
  const jobs = await store.listJobs();
  const groups = [
    ['draft', 'In progress'],
    ['complete', 'Ready to send'],
    ['sent', 'Sent'],
  ];
  mount(
    h('header', { class: 'top' },
      h('h1', { text: 'Write-ups' }),
      h('span', {},
        h('a', { class: 'btn ghost', href: '#/office', text: 'Office' }),
        h('a', { class: 'btn ghost', href: '#/settings', text: 'Settings' }))),
    h('main', { class: 'home' },
      !isStandalone() && installGuide(true),
      h('button', { class: 'btn primary big', onclick: () => createJob(settings), text: '+ New write-up' }),
      unsentBanner(settings, jobs),
      ...exportButtons(settings, jobs),
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
  const missing = job.status === 'draft' ? validateJob(job, jobContext(job, jobs)).length : 0;
  return h('li', {},
    h('a', { href: `#/job/${job.id}` },
      h('strong', { text: job.nickname || clientName(job) || 'New job' }), // S19: the tech's nickname first
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
    h('main', { class: 'settings' }, settings.techName ? fullSettings() : firstRun()));

  function restoreBtn(text) {
    return h('label', { class: 'btn' }, text,
      h('input', { type: 'file', accept: '.zip,application/zip,.json,application/json', hidden: true, onchange: (e) => restoreBackup(e.target.files[0]) }));
  }
  function saveBtn() {
    return h('button', {
      class: 'btn primary big',
      text: 'Save',
      onclick: async () => {
        if (!s.techName?.trim()) { toast('Enter your name first'); return; }
        await store.saveSettings({ ...s, techName: s.techName.trim() });
        location.hash = '#/';
      },
    });
  }

  // B-31 (S15): the very first screen only asks what a tech needs to start.
  function firstRun() {
    return [
      !isStandalone() && installGuide(true),
      h('p', { class: 'note', text: '👋 Hi! Do this one time. Type your name and the office email. Then tap Save.' }),
      input('techName', 'Your name', { autocomplete: 'name', required: true }),
      input('officeEmail', 'Office email (your jobs go here)', { type: 'email', inputmode: 'email' }),
      saveBtn(),
      h('a', { class: 'btn big', href: '#/office', text: '🖥 At the office computer? Open the Office view' }),
      restoreBtn('New phone? Bring back your backup'),
    ];
  }

  function fullSettings() {
    const version = h('p', { class: 'muted small', text: 'App version: …' });
    caches?.keys().then((keys) => { version.textContent = `App version: ${keys.find((k) => k.startsWith('fw-'))?.slice(3) || 'not installed yet'}`; }).catch(() => {});
    return [
      input('techName', 'Your name', { autocomplete: 'name', required: true }),
      input('officeEmail', 'Office email (your jobs go here)', { type: 'email', inputmode: 'email' }),
      input('woPrefix', 'Letters for work order numbers (you can skip this)', { placeholder: 'e.g. RA' }),
      saveBtn(),
      h('h2', { text: 'Backup' }),
      h('p', { class: 'muted', text: 'Your jobs live only on this phone. Save a backup now and then (email it to yourself).' }),
      h('button', { class: 'btn', onclick: exportBackup, text: 'Save a backup (all jobs)' }),
      restoreBtn('Bring jobs back from a backup…'),
      h('button', { class: 'btn', onclick: removeExported, text: 'Remove jobs already sent' }),
      version,
      officeSettings(),
    ];
  }

  // FR-15 / FR-17: set once by the boss; kept at the bottom, out of the techs' way.
  function officeSettings() {
    return h('details', { class: 'admin' },
        h('summary', { text: 'Office settings (techs can ignore this)' }),
        h('label', { class: 'field' },
          h('span', { class: 'label', text: 'What the send button sends' }),
          h('select', { onchange: async (e) => { s.exportMode = e.target.value; await store.patchSettings({ exportMode: s.exportMode }); toast('Saved'); } },
            [['everything', 'All jobs on the phone (one button)'], ['since-last', 'Only new jobs since last send (one button)'], ['both', 'Show both buttons']]
              .map(([v, t]) => h('option', { value: v, text: t, selected: (settings.exportMode || 'everything') === v })))),
        // FR-17: Nominatim's policy requires the lookup can be switched off.
        h('label', { class: 'check' },
          h('input', {
            type: 'checkbox', checked: settings.gpsLookup !== false,
            onchange: async (e) => { s.gpsLookup = e.target.checked; await store.patchSettings({ gpsLookup: s.gpsLookup }); toast('Saved'); },
          }),
          ' Look up the address from GPS (needs signal; uses OpenStreetMap)'));
  }
}

// ---------- editor ----------
// The open editor's exit. Called before any other screen is drawn, so an old editor can
// never write its stale copy of a job over newer data (A-01).
let leaveEditor = null;
function closeEditor() {
  const leave = leaveEditor;
  leaveEditor = null;
  leave?.();
}

function saveFailed() {
  toast('Could not save! Your phone may be full. Free up some space.');
}

async function renderEditor(id, settings) {
  closeEditor();
  const job = await store.getJob(id);
  if (!job) { location.hash = '#/'; return; }
  const others = (await store.listJobs()).filter((j) => j.id !== id);
  const touched = new Set();
  let attempted = false;
  let saveTimer;
  const locked = job.status !== 'draft';

  // Saving (A-01): only write when something changed, and stop for good once the tech leaves
  // this editor — otherwise this stale copy could overwrite a delete or a later "Sent".
  let dirty = false;
  let closed = false;
  const write = () => store.saveJob(job).catch(saveFailed);
  const save = () => {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { dirty = false; if (!closed) write(); }, 300);
  };
  const flush = async () => {
    clearTimeout(saveTimer);
    if (dirty && !closed) { dirty = false; await write(); }
  };
  const onHide = () => { if (document.hidden) flush(); };
  document.addEventListener('visibilitychange', onHide);
  leaveEditor = () => {
    flush();
    closed = true;
    document.removeEventListener('visibilitychange', onHide);
  };

  const ctx = () => jobContext(job, others);

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
    const odo = $app.querySelector('.odo-confirm');
    if (odo) {
      const { lastUnitMileage } = ctx();
      odo.hidden = job.odo_confirm == null && !(lastUnitMileage != null && /^\d+$/.test(job.values.unit_mileage || '') && +job.values.unit_mileage < lastUnitMileage);
    }
    for (const el of $app.querySelectorAll('[data-linetotal]')) {
      const p = job.parts[+el.dataset.linetotal] || {};
      el.textContent = `Line total: ${p.qty || 0} × $${(+p.price || 0).toFixed(2)} = $${((+p.qty || 0) * (+p.price || 0)).toFixed(2)}`;
    }
    for (const el of $app.querySelectorAll('[data-hint]')) {
      const hint = lengthHint(allFields().find((x) => x.id === el.dataset.hint), job.values[el.dataset.hint]);
      el.textContent = hint.text;
      el.className = `hint ${hint.ok ? 'ok' : ''}`;
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
    clearTimeout(saveTimer);
    dirty = false;
    await write();
    renderEditor(id, settings);
    toast('Write-up complete. Send it to the office.');
  }

  // --- field widgets ---
  function fieldEl(f) {
    const isNA = job.na[f.id] != null;
    const set = (val) => {
      if ((f.id === 'address' || f.id === 'city') && job.address_from_gps && !job.address_confirmed) {
        // The tech is typing the address themselves: that's their answer, no GPS check needed.
        delete job.address_from_gps;
        delete job.address_confirmed;
        $app.querySelector('.gps-confirm')?.remove();
      }
      if (f.id === 'vin' && job.vin_override && val !== job.values.vin) {
        job.vin_override = false; // A-15: a new VIN must pass on its own
        const box = $app.querySelector('.vin-override input');
        if (box) box.checked = false;
      }
      job.values[f.id] = val;
      touched.add(f.id);
      save();
      refresh();
    };
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
        number: { inputmode: 'numeric', type: 'text' },
      }[f.type] || {};
      const fmt = FORMATTERS[f.format]; // FR-16: phone, 1,000s, capitals — shaped as they type
      input = h('input', {
        ...common, type: f.type, value: fmt ? fmt(job.values[f.id] || '').show : (job.values[f.id] || ''), ...extra,
        list: { company_name: 'dl-company', unit_number: 'dl-unit' }[f.id],
        autocapitalize: f.id === 'vin' || f.id === 'plate' ? 'characters' : extra.autocapitalize,
        maxlength: { vin: 17, plate: 10 }[f.kind],
        oninput: (e) => {
          const el = e.target;
          // VIN: capitals, no spaces/dashes, as they type, so the 17-count is honest.
          if (f.kind === 'vin') { const nv = normalizeVin(el.value); if (nv !== el.value) el.value = nv; }
          if (!fmt) { set(el.value); return; }
          const r = fmt(el.value);
          // While deleting, don't put back the "(", ")" or "-" they just removed; tidy on leave.
          if (!e.inputType?.startsWith('delete') && r.show !== el.value) {
            const at = el.selectionStart ?? el.value.length;
            const re = KEY_CHARS[f.format];
            const typed = countKeyChars(el.value.slice(0, at), re);
            const atEnd = at >= el.value.length; // typing at the end (the usual case) stays at the end
            el.value = r.show;
            const pos = atEnd ? r.show.length : caretAfter(r.show, typed, re);
            try { el.setSelectionRange(pos, pos); } catch { /* not focusable */ }
          }
          set(r.store);
        },
        onchange: (e) => onPick(f.id, e.target.value),
      });
      if (fmt) {
        input.addEventListener('blur', () => { input.value = fmt(input.value).show; });
      }
    }

    const helpers = [];
    if (!locked && !isNA) {
      if (f.id === 'wo_number') helpers.push(h('button', { class: 'btn small', type: 'button', text: 'Auto', onclick: () => {
        const d = new Date();
        const initials = (settings.woPrefix || settings.techName.split(/\s+/).map((w) => w[0]).join('')).toUpperCase();
        const base = `${initials}-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
        // B-08: never hand out a number another job on this phone already has.
        const taken = new Set(others.map((j) => woKey(j.values.wo_number)));
        let n = 1;
        while (taken.has(woKey(n === 1 ? base : `${base}-${n}`))) n++;
        input.value = n === 1 ? base : `${base}-${n}`;
        set(input.value);
      } }));
      if (f.type === 'datetime-local') helpers.push(h('button', { class: 'btn small', type: 'button', text: 'Now', onclick: () => { input.value = localDateTime(); set(input.value); } }));
      if (f.id === 'address') helpers.push(h('button', { class: 'btn small', type: 'button', text: '📍 Use my location', onclick: (e) => captureGps(e.target) }));
    }

    // S20: N/A sits right beside its box; the "Why?" box appears underneath when ticked.
    const na = f.na && !locked ? naToggle(f.id, isNA, job.na, () => rerender(), f.id, f.label) : null;
    const wrap = h('div', { class: 'field', 'data-key': f.id },
      h('label', { class: 'label', for: `in-${f.id}`, text: f.label }),
      // N/A goes straight after the box, so on a narrow phone it is the helper buttons that wrap.
      h('div', { class: 'row' }, input, na?.querySelector('.na-check'), ...helpers),
      na?.querySelector('.na-reason'),
      // B-19: live length counter (VIN 12/17, phone 7/10, plate 2–8) so a missed character shows at once.
      lengthHint(f, '') && !locked && !isNA && h('div', { class: 'hint', 'data-hint': f.id, 'aria-live': 'polite' }),
      h('div', { class: 'err', 'aria-live': 'polite' }));
    if (f.id === 'unit_mileage' && !locked && !isNA) {
      // A-05: a lower reading than last time can be confirmed with a reason, never a dead end.
      const confirmed = job.odo_confirm != null;
      wrap.append(h('div', { class: 'odo-confirm', hidden: true },
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: confirmed, onchange: (e) => { if (e.target.checked) job.odo_confirm = ''; else delete job.odo_confirm; save(); rerender(); } }),
          ' The reading is right (odometer replaced, or last time was a mistake)'),
        confirmed && h('input', { class: 'na-reason', placeholder: 'Why? (required)', value: job.odo_confirm, 'aria-label': 'Why is the reading lower?', oninput: (e) => { job.odo_confirm = e.target.value; save(); refresh(); } })));
    }

    if (f.id === 'vin' && !locked) {
      wrap.append(h('label', { class: 'check vin-override', hidden: true },
        h('input', { type: 'checkbox', checked: !!job.vin_override, onchange: (e) => { job.vin_override = e.target.checked; save(); refresh(); } }),
        ' Check digit fails but I double-checked it against the plate (needs VIN plate photo)'));
    }
    if (isNA && locked) wrap.append(h('div', { class: 'muted', text: `N/A: ${job.na[f.id]}` }));
    if (f.id === 'address') { const g = gpsConfirm(); if (g) wrap.append(g); }
    // Photos that prove this field sit right under it (FR-10).
    const photos = PHOTO_SLOTS.filter((s) => s.for === f.id).map(slotWidget);
    return photos.length ? h('div', { class: 'with-photos' }, wrap, ...photos) : wrap;
  }

  function naToggle(key, isNA, bag, after, touchKey = key, label = '') {
    const box = h('div', { class: 'na' },
      h('label', { class: 'check na-check' },
        h('input', {
          type: 'checkbox', checked: isNA, 'aria-label': `${label} not applicable`, // A-26: 18 boxes all said just "N/A"
          onchange: (e) => { if (e.target.checked) bag[key] = ''; else delete bag[key]; touched.add(touchKey); save(); after(); },
        }),
        ' N/A'));
    if (isNA) {
      box.append(h('input', {
        class: 'na-reason', placeholder: 'Why? (required)', value: bag[key], 'aria-label': `Why is ${label} N/A?`,
        oninput: (e) => { bag[key] = e.target.value; save(); refresh(); },
      }));
    }
    return box;
  }

  // Picking a known company/unit fills the rest, so repeat customers are a couple of taps.
  // Writes values into the existing inputs instead of re-rendering: `change` fires as the
  // tech taps the NEXT field, and a rebuild there would wipe what they start typing.
  function setInPlace(k, val) {
    job.values[k] = val;
    const el = $app.querySelector(`#in-${CSS.escape(k)}`);
    if (el) el.value = val;
  }

  function onPick(fieldId, value) {
    const v = value.trim();
    const fillFrom = (src, ids) => {
      let filled = false;
      for (const k of ids) if (!job.values[k] && src.values[k]) { setInPlace(k, src.values[k]); filled = true; }
      if (filled) { save(); refresh(); toast('Filled from a previous job'); }
    };
    if (fieldId === 'company_name') {
      const src = others.find((j) => j.values.company_name?.trim().toLowerCase() === v.toLowerCase());
      if (src) fillFrom(src, ['contact_name', 'phone', 'email']);
    }
    if (fieldId === 'unit_number') {
      // A-05: unit numbers repeat across customers, so only fill from the SAME company.
      const company = job.values.company_name?.trim().toLowerCase();
      const src = company && others.find((j) => j.values.unit_number?.trim().toLowerCase() === v.toLowerCase()
        && j.values.company_name?.trim().toLowerCase() === company);
      if (src) fillFrom(src, ['plate', 'state', 'vin']);
    }
    if (fieldId === 'vin') { setInPlace('vin', normalizeVin(value)); save(); refresh(); }
  }

  // FR-17: save the GPS point and, with signal, fill the nearest address for the tech to confirm.
  function captureGps(btn) {
    if (!navigator.geolocation) { toast('This phone has no GPS. Please type the address.'); return; }
    btn.textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(async (pos) => {
      job.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, at: new Date().toISOString() };
      const found = settings.gpsLookup === false ? null : await lookupAddress(job.gps.lat, job.gps.lng);
      if (closed) { if (await store.getJob(job.id)) await store.saveJob(job).catch(saveFailed); return; } // A-08 rule
      if (found) {
        setInPlace('address', found.address);
        if (found.city) setInPlace('city', found.city);
        job.address_from_gps = { ...found, at: job.gps.at };
        job.address_confirmed = false;
        touched.add('address');
        save();
        rerender();
        $app.querySelector('.gps-confirm')?.scrollIntoView({ block: 'center' });
      } else {
        save();
        btn.textContent = '📍 GPS saved';
        toast(settings.gpsLookup === false ? 'Your location is saved. Please type the address.'
          : !navigator.onLine ? 'No signal. Your location is saved. Please type the address.'
            : 'Could not find the address. Your location is saved. Please type it.');
      }
    }, () => { btn.textContent = '📍 Use my location'; toast('Could not get your location. Please type the address.'); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
  }

  // "Is this the right place?" — shown until the tech confirms or fixes a GPS-filled address.
  function gpsConfirm() {
    const g = job.address_from_gps;
    if (!g || locked) return null;
    if (job.address_confirmed) return h('p', { class: 'hint ok', text: 'Address checked' });
    return h('div', { class: 'gps-confirm note' },
      h('p', {}, h('strong', { text: '📍 Is this the right place?' })),
      h('p', { text: [g.address, g.city].filter(Boolean).join(', ') }),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', text: '✓ Yes, that\'s right', onclick: () => { job.address_confirmed = true; save(); rerender(); } }),
        h('button', {
          class: 'btn', type: 'button', text: '✏ No, I\'ll fix it',
          onclick: () => { delete job.address_from_gps; delete job.address_confirmed; save(); rerender(); $app.querySelector('#in-address')?.focus(); },
        })),
      h('p', { class: 'muted small', text: ATTRIBUTION }));
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
              id: `part-${i}-${c.id}`, disabled: locked,
              value: c.id === 'price' ? formatMoney(p.price ?? '').show : (p[c.id] ?? ''),
              ...(c.type === 'number' ? { inputmode: 'decimal' } : {}),
              oninput: (e) => {
                // FR-16: the price gets its "$" as it's typed; the saved value stays a plain number.
                if (c.id === 'price') {
                  const r = formatMoney(e.target.value);
                  if (!e.inputType?.startsWith('delete') && r.show !== e.target.value) e.target.value = r.show;
                  p.price = r.store;
                } else p[c.id] = e.target.value;
                touched.add(`part-${i}-${c.id}`);
                save();
                refresh();
              },
              // …and tidies to cents when the tech leaves the box ($12.50).
              onblur: c.id === 'price' ? (e) => { const r = formatMoneyOnLeave(e.target.value); e.target.value = r.show; p.price = r.store; save(); refresh(); } : null,
            }),
            h('div', { class: 'err' }))),
          h('p', { class: 'line-total', 'data-linetotal': i, 'aria-live': 'polite' }),
          photoWidget({
            key: `part-${i}-receipt`, label: `Part ${i + 1}: ${PART_RECEIPT.label.toLowerCase()}`,
            list: (p.receipt_photos ||= []), multiple: true, naBag: p, naKey: 'receipt_na',
          })));
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

  // One photo prompt, shown inside the block (or part line) it proves. `list` is the array
  // the photos live in; `naBag[naKey]` holds an N/A reason when one is allowed.
  function photoWidget({ key, label, list, multiple, naBag, naKey }) {
    const isNA = naBag && naBag[naKey] != null;
    const addPhotos = async (files) => {
      for (const file of files) {
        try {
          list.push(await shrinkPhoto(file)); // added one by one: a bad file never loses the good ones (A-21)
        } catch {
          toast('That photo could not be read. Try another one.');
        }
      }
      touched.add(key);
      if (closed) {
        // A-08: the tech left while the photo was processing. Keep the photo, but never
        // redraw this editor over the screen they're on now (or bring back a deleted job).
        if (await store.getJob(job.id)) await store.saveJob(job).catch(saveFailed);
        return;
      }
      save();
      rerender();
    };
    // B-29 (S12): two plain buttons, because phones disagree on what one photo button
    // shows — newer Android pickers have no camera, and a camera-only button can't use
    // photos taken earlier.
    const pick = (source, text) => h('label', { class: 'btn' }, text,
      h('input', {
        type: 'file', accept: 'image/*', hidden: true, 'data-source': source,
        capture: source === 'camera' ? 'environment' : null,
        multiple: source === 'library' && !!multiple,
        'aria-label': `${label}: ${source === 'camera' ? 'take photo' : 'choose from my photos'}`,
        onchange: (e) => addPhotos([...e.target.files]),
      }));
    const wrap = h('div', { class: 'field photo-slot', 'data-key': key },
      h('span', { class: 'label', text: `📷 ${label}` }),
      h('div', { class: 'thumbs' }, list.map((src, i) => h('figure', {},
        h('img', { src, alt: `${label} ${i + 1}` }),
        !locked && h('button', { class: 'btn ghost small', type: 'button', text: 'Remove', onclick: () => { list.splice(i, 1); save(); rerender(); } })))),
      !locked && !isNA && (multiple || list.length === 0) && h('div', { class: 'row' },
        pick('camera', list.length ? '📷 Take another' : '📷 Take photo'),
        pick('library', '🖼 From my photos')),
      h('div', { class: 'err' }));
    if (naBag && !locked && list.length === 0) wrap.append(naToggle(naKey, isNA, naBag, () => rerender(), key, label));
    return wrap;
  }

  function slotWidget(s) {
    job.photos[s.id] ||= [];
    return photoWidget({
      key: `photo-${s.id}`, label: s.label, list: job.photos[s.id], multiple: s.multiple,
      naBag: s.na === false ? null : job.photo_na, naKey: s.id,
    });
  }

  function signaturesSection() {
    return h('div', { class: 'sigs' }, SIGNATURES.map((s) => {
      const key = `sig-${s.id}`;
      const canvas = h('canvas', { class: 'sigpad', width: 600, height: 180, tabindex: 0, 'aria-label': `${s.label} pad` });
      const wrap = h('div', { class: 'field', 'data-key': key },
        h('span', { class: 'label', text: s.label }),
        canvas,
        !locked && h('div', { class: 'row' },
          // FR-18: sign big, sideways, without the tiny box.
          h('button', {
            class: 'btn small', type: 'button', text: '⤢ Enlarge',
            onclick: () => openBigPad({
              label: s.label,
              onSave: (dataUrl) => { job.signatures[s.id] = dataUrl; touched.add(key); save(); rerender(); },
              onTooSmall: () => toast('Keep going. Sign a bit bigger.'),
            }),
          }),
          h('button', { class: 'btn ghost small', type: 'button', text: 'Clear', onclick: () => { delete job.signatures[s.id]; save(); rerender(); } })),
        h('div', { class: 'err' }));
      setupSigPad(canvas, job.signatures[s.id], locked,
        (dataUrl) => { job.signatures[s.id] = dataUrl; touched.add(key); save(); refresh(); },
        () => toast('Keep going. Sign a bit bigger.'));
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
        h('a', { class: 'btn ghost', href: '#/', text: '‹ Jobs' }),
        h('h1', { text: job.values.wo_number || 'Write-up' }),
        h('span', { id: 'totals', class: 'muted small' })),
      h('datalist', { id: 'dl-company' }, companies.map((c) => h('option', { value: c }))),
      h('datalist', { id: 'dl-unit' }, units.map((u) => h('option', { value: u }))),
      locked && h('div', { class: 'banner' },
        h('p', { text: job.status === 'sent' ? `Sent ${new Date(job.sent_at).toLocaleString()}` : 'Complete. Send it to the office.' }),
        h('div', { class: 'row' },
          h('button', {
            class: 'btn primary',
            text: '📦 Send my jobs to the office',
            onclick: () => exportPackage(settings.exportMode === 'since-last' ? 'since-last' : 'everything', settings),
          }),
          h('button', {
            class: 'btn ghost',
            text: 'Reopen to edit',
            onclick: async () => {
              // A-22: signatures approved the old version, so changing it means signing again.
              const ok = await ask('Reopen this write-up?', 'The signatures will be cleared. The customer and you must sign again before it is complete.', [
                { label: 'Reopen and clear signatures', value: true, primary: true },
                { label: 'Cancel', value: false },
              ]);
              if (!ok) return;
              job.status = 'draft';
              job.signatures = {};
              job.revision = (job.revision || 1) + 1;
              await write();
              renderEditor(id, settings);
            },
          }))),
      h('main', { class: 'editor' },
        // S19: a name the tech picks so the job list says more than "New job". Not checked;
        // it is only a label, so it can still be changed after the job is finished.
        h('div', { class: 'field nickname' },
          h('label', { class: 'label', for: 'in-nickname', text: 'Nickname (just for you)' }),
          h('input', {
            id: 'in-nickname', type: 'text', value: job.nickname || '', placeholder: 'Like "Big Red tow truck"',
            oninput: (e) => { job.nickname = e.target.value.trim() ? e.target.value : undefined; save(); },
          })),
        SECTIONS.map((s) => h('section', { 'data-section': s.id },
          h('h2', {}, s.title, ' ', h('span', { class: 'count' })),
          s.fields ? allF.filter((f) => f.section === s.id).map(fieldEl)
            : s.special === 'parts' ? partsSection()
              : signaturesSection())),
        (job.photos.unassigned || []).length > 0 && h('section', { class: 'note' },
          h('strong', { text: 'Older receipt photos (not matched to a part)' }),
          h('div', { class: 'thumbs' }, job.photos.unassigned.map((src) => h('img', { src, alt: 'Older receipt photo' })))),
        !locked && h('button', {
          class: 'btn ghost danger', type: 'button', text: 'Delete this write-up',
          onclick: async (e) => {
            if (e.target.dataset.armed) {
              closed = true; // nothing from this editor may write the job back (A-01)
              clearTimeout(saveTimer);
              await store.deleteJob(job.id);
              location.hash = '#/';
              return;
            }
            e.target.dataset.armed = '1';
            e.target.textContent = 'Tap again to delete permanently';
          },
        })),
      h('footer', { id: 'bar', class: 'bar' }));
    refresh();
  }

  build();
}



// ---------- boot ----------
hooks.route = route;
hooks.closeEditor = closeEditor;
store.requestPersistence();
const UPDATE_EVERY_MS = 30 * 60 * 1000;

// B-31: when a newer version takes over, say so and offer a one-tap update.
function showUpdateBanner() {
  if (document.querySelector('.update-banner')) return;
  document.body.append(h('div', { class: 'update-banner', role: 'status' },
    h('span', { text: '✨ A new version is ready.' }),
    h('button', { class: 'btn primary small', type: 'button', text: 'Tap to update', onclick: () => { closeEditor(); location.reload(); } })));
}
if ('serviceWorker' in navigator) {
  // The first install isn't an "update"; any version change after that is, even without a reload.
  let hadVersion = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadVersion) showUpdateBanner();
    hadVersion = true;
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    // Look for a new version every time the app opens and whenever it comes back to the
    // screen — don't rely on the browser's own (irregular) checks.
    reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    // …and every 30 minutes while it's on screen, for a tab or phone that's never closed or
    // put to sleep (e.g. the office computer). One small request; never reloads by itself.
    setInterval(() => { if (!document.hidden && navigator.onLine) reg.update().catch(() => {}); }, UPDATE_EVERY_MS);
  }).catch(() => {});
}
route();
