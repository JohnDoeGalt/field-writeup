// Packages screen (FR-25, S27): every package this phone sent is kept here, so it can be sent
// again and nothing has to pile up in the phone's Downloads. Any package can be deleted by hand
// at any time; the only automatic deletion is 30 days after a package was last sent.
import * as store from './store.js';
import { expiresAt, isExpired, packagesSize, jobIsExpired, KEEP_DAYS } from './package.js';
import { sendAgain } from './transfer.js';
import { h, mount, ask, plural, toast } from './ui.js';

const size = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${(bytes / 1e6).toFixed(1)} MB`);
const when = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const day = (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
const HOW = { shared: 'Sent', downloaded: 'Saved as a download' };

// The only automatic deletion: packages, and SENT jobs, last sent more than 30 days ago. Runs
// when the app opens and when the Packages screen is drawn. Jobs are checked first, against all
// packages, because a package re-send keeps the jobs in it for another 30 days.
export async function cleanOld(now = new Date()) {
  const pkgs = await store.listPackages();
  const oldJobs = (await store.listJobs()).filter((j) => jobIsExpired(j, pkgs, now));
  for (const j of oldJobs) await store.deleteJob(j.id);
  const oldPkgs = pkgs.filter((p) => isExpired(p, now));
  if (oldPkgs.length) await store.deletePackages(oldPkgs.map((p) => p.id));
  return { jobs: oldJobs.length, packages: oldPkgs.length };
}

// "Packages use 12.4 MB · Write-ups and their photos: 40 MB" — plus the browser's own count for
// this app when it gives one. A job's size is its saved form (photos are most of it).
function storageMeter(pkgs, jobs) {
  const line = h('p', { class: 'muted small', 'data-storage': '' });
  navigator.storage?.estimate?.().then(({ usage, quota }) => {
    if (usage && quota) line.textContent = `Everything this app keeps on the phone: ${size(usage)} of about ${size(quota)} allowed.`;
  }).catch(() => {});
  const jobBytes = jobs.reduce((n, j) => n + JSON.stringify(j).length, 0);
  return h('div', { class: 'note ok meter' },
    h('p', {}, h('strong', { text: `🗂 Packages use ${size(packagesSize(pkgs))}` }), ` (${plural(pkgs.length, 'package')})`),
    h('p', { 'data-jobs-size': '' }, `📋 Write-ups and their photos: ${size(jobBytes)} (${plural(jobs.length, 'write-up')})`),
    line);
}

function row(p, selected, redraw) {
  const last = p.sends[p.sends.length - 1];
  return h('li', { class: 'package', 'data-package': p.id },
    h('div', { class: 'package-top' },
      h('input', {
        type: 'checkbox', 'aria-label': `Select package from ${when(p.created_at)}`, checked: selected.has(p.id),
        onchange: (e) => { if (e.target.checked) selected.add(p.id); else selected.delete(p.id); redraw(); },
      }),
      h('strong', { text: `${when(p.created_at)} · ${p.kind === 'backup' ? 'Backup' : 'Send'}` }),
      h('span', { class: 'muted small', text: size(p.size) })),
    h('p', { class: 'small', text: `${plural(p.jobs.length, 'write-up')}: ${p.jobs.slice(0, 5).map((j) => j.name).join(', ')}${p.jobs.length > 5 ? ` and ${p.jobs.length - 5} more` : ''}` }),
    h('p', { class: 'small', text: last ? `${HOW[last.how] || 'Sent'} ${when(last.at)}${p.sends.length > 1 ? ` (${p.sends.length} times)` : ''}` : 'Not sent yet' }),
    h('p', { class: 'muted small', text: `Deleted automatically on ${day(expiresAt(p))}` }),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', type: 'button', text: '📤 Send again', onclick: () => sendAgain(p.id) }),
      h('button', { class: 'btn small ghost danger-text', type: 'button', text: 'Delete', onclick: () => remove([p]) })));
}

async function remove(list) {
  const ok = await ask(`Delete ${plural(list.length, 'package')}?`,
    'They will be gone from this phone. The write-ups themselves stay.', [
      { label: `Yes, delete ${list.length}`, value: true, danger: true },
      { label: 'No', value: false },
    ]);
  if (!ok) return;
  await store.deletePackages(list.map((p) => p.id));
  toast(`Deleted ${plural(list.length, 'package')}.`);
  renderPackages();
}

export async function renderPackages() {
  await cleanOld();
  const pkgs = await store.listPackages();
  const jobs = await store.listJobs();
  const selected = new Set();
  const list = h('ul', { class: 'packages' });
  const bulk = h('div');
  const redraw = () => {
    list.replaceChildren(...pkgs.map((p) => row(p, selected, redraw)));
    const picked = pkgs.filter((p) => selected.has(p.id));
    bulk.replaceChildren(picked.length ? h('button', { class: 'btn big', type: 'button', text: `Delete selected (${picked.length})`, onclick: () => remove(picked) }) : '');
  };
  mount(
    h('header', { class: 'top' },
      h('a', { class: 'btn ghost', href: '#/', text: '‹ Jobs' }),
      h('h1', { text: 'Packages' }), h('span')),
    h('main', { class: 'packages-screen' },
      storageMeter(pkgs, jobs),
      h('p', { class: 'muted', text: `Every package you send is kept here, so you can send it again. You can delete any package. A package, and a sent write-up, is deleted by itself ${KEEP_DAYS} days after it was last sent.` }),
      pkgs.length === 0 && h('p', { class: 'muted', text: 'No packages yet. They show up here after you send your jobs to the office.' }),
      list,
      bulk));
  redraw();
}
