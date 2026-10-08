// Export (one package for the whole phone), backup and restore. FR-9, FR-11, FR-15.
import * as store from './store.js';
import { isJobShape, normalizeJob, clientName } from './schema.js';
import { buildPackage, readPackage, selectForExport, mergePlan, packageName, EMAIL_LIMIT } from './package.js';
import { h, toast, ask, download, plural, hooks } from './ui.js';

export const APP_VERSION = '2026.10.07';

// The phone's share sheet (Mail, Dropbox, Files…): true = shared, false = closed, cancelled or
// already open (A-02), null = this device can't share this file (caller saves a download).
// Reason (S26): browsers only open the share sheet straight from a tap, and building the
// package takes a moment — long enough for the first tap to "expire" on an iPhone, which made
// the app fall back to downloading a zip. So the package is built first, and this sheet's own
// "Send it" tap opens the share sheet with nothing in between.
function shareSheet(file, title, text) {
  if (!navigator.canShare?.({ files: [file] })) return Promise.resolve(null); // e.g. Android: no .zip sharing
  return new Promise((resolve) => {
    const done = (v) => { dlg.remove(); resolve(v); };
    const dlg = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Your package is ready' },
      h('p', {}, h('strong', { text: '📦 Your package is ready' })),
      h('p', { text: `${title} · ${(file.size / 1e6).toFixed(1)} MB. Tap Send, then pick Mail or Dropbox.` }),
      h('button', {
        class: 'btn big primary', type: 'button', text: '📤 Send it (Mail, Dropbox…)',
        onclick: () => navigator.share({ files: [file], title, text })
          .then(() => done(true), (e) => done(['AbortError', 'InvalidStateError'].includes(e.name) ? false : null)),
      }),
      h('button', { class: 'btn big', type: 'button', text: 'Cancel', onclick: () => done(false) }));
    document.body.append(dlg);
  });
}

// 'shared' when the share really happened, 'downloaded' when the tech confirms they sent a
// downloaded copy (A-02), otherwise null (cancelled / not sent).
async function shareOrSave(file, title, settings) {
  const to = settings.officeEmail ? `Send to: ${settings.officeEmail}` : 'Send it to the office.';
  const shared = await shareSheet(file, title, `${title}\n${to}`);
  if (shared !== null) return shared ? 'shared' : null;
  download(file);
  return (await ask('Your package is saved', `It is called "${file.name}". Attach it to an email. ${to}`, [
    { label: 'I sent it', value: true, primary: true },
    { label: 'Not yet', value: false },
  ])) === true ? 'downloaded' : null;
}

// FR-25: every package that went out is kept in the app (Packages screen), so it can be sent
// again; deleted by hand, or automatically 30 days after its last send. A cancelled share keeps nothing.
async function keepPackage(file, kind, jobs, how) {
  const at = new Date().toISOString();
  try {
    await store.savePackage({
      id: `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, created_at: at, kind, name: file.name, size: file.size,
      // Reason: plain bytes, not the File itself — Safari's storage refused to keep File objects.
      bytes: new Uint8Array(await file.arrayBuffer()),
      jobs: jobs.map((j) => ({ id: j.id, name: j.nickname || clientName(j) || j.values.wo_number || 'New job' })),
      sends: [{ at, how }],
    });
  } catch (e) {
    console.error(e);
    toast('Sent, but the phone is too full to keep a copy in Packages.');
  }
}

// Packages screen: send a kept package again, exactly as it was made.
export async function sendAgain(id) {
  const pkg = await store.getPackage(id);
  if (!pkg) return;
  const settings = await store.getSettings();
  const file = new File([pkg.bytes], pkg.name, { type: 'application/zip' });
  const how = await shareOrSave(file, pkg.kind === 'backup' ? 'Write-up backup' : `${plural(pkg.jobs.length, 'write-up')} from ${settings.techName}`, settings);
  if (!how) return;
  pkg.sends.push({ at: new Date().toISOString(), how });
  await store.savePackage(pkg);
  toast('Sent again.');
  hooks.route();
}

let exporting = false; // stops a double tap from making two packages (A-02)

export async function exportPackage(mode, settings) {
  if (exporting) return;
  exporting = true;
  hooks.closeEditor(); // save anything still being typed first
  try {
    const all = await store.listJobs();
    const jobs = selectForExport(all, mode);
    if (!jobs.length) {
      toast(all.length ? 'Nothing new to send. Everything was sent already.' : 'No jobs on this phone yet.');
      return;
    }
    const now = new Date();
    const bytes = buildPackage(jobs, { tech: settings.techName, appVersion: APP_VERSION, now });
    const file = new File([bytes], packageName(settings.techName, now), { type: 'application/zip' });
    if (file.size > EMAIL_LIMIT) {
      // FR-26: finished jobs are never deleted, so the only choices are to go ahead or stop.
      const pick = await ask(`This package is ${(file.size / 1e6).toFixed(0)} MB`, 'That is too big for most email. Send it with Dropbox or Files instead.', [
        { label: 'Make it anyway', value: 'go', primary: true },
        { label: 'Cancel', value: null },
      ]);
      if (pick !== 'go') return;
    }
    const sent = await shareOrSave(file, `${plural(jobs.length, 'write-up')} from ${settings.techName}`, settings);
    if (!sent) return;
    await keepPackage(file, 'send', jobs, sent);
    const stamp = now.toISOString();
    for (const j of jobs) {
      j.exported_at = stamp;
      if (j.status === 'complete') { j.status = 'sent'; j.sent_at = stamp; }
      await store.saveJob(j, { touch: false }); // keep updated_at: "since last" compares against it
    }
    await store.patchSettings({ lastExportAt: stamp });
    toast(`Sent! ${plural(jobs.length, 'write-up')} in the package.`);
  } catch (e) {
    console.error(e);
    toast('Could not make the package. Nothing was marked as sent.');
  } finally {
    exporting = false;
    hooks.route();
  }
}

// ---------- backup: the same package, but nothing is marked as sent ----------
export async function exportBackup() {
  const settings = await store.getSettings();
  const jobs = await store.listJobs();
  if (!jobs.length) { toast('No jobs on this phone yet.'); return; }
  const now = new Date();
  const file = new File([buildPackage(jobs, { tech: settings.techName, appVersion: APP_VERSION, now, settings })],
    packageName(`${settings.techName}_backup`, now), { type: 'application/zip' });
  const shared = await shareSheet(file, 'Write-up backup', 'Write-up backup');
  if (shared === false) return; // cancelled: nothing kept
  if (shared === null) download(file);
  await keepPackage(file, 'backup', jobs, shared ? 'shared' : 'downloaded');
}

// Reads a package (.zip) or an old-style backup (.json) → { jobs, settings? }. Plain errors.
export async function readJobsFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) { // "PK" = zip
    const { meta, jobs } = readPackage(bytes);
    return { jobs, settings: meta.settings };
  }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('This is not a Write-Up file.'); }
  if (data?.app !== 'field-writeup' || !Array.isArray(data.jobs)) throw new Error('This is not a Write-Up file.');
  const good = data.jobs.filter(isJobShape);
  if (good.length < data.jobs.length) throw new Error('This backup is damaged.');
  return { jobs: good.map(normalizeJob), settings: data.settings };
}

export async function restoreBackup(file) {
  if (!file) return;
  try {
    const { jobs, settings: saved } = await readJobsFile(file);
    const plan = mergePlan(jobs, new Map((await store.listJobs()).map((j) => [j.id, j])));
    for (const j of plan.save) await store.saveJob(j, { touch: false });
    // A-28: a new phone also gets its settings back, but only into empty boxes.
    if (saved && typeof saved === 'object') {
      const now = await store.getSettings();
      const filled = Object.fromEntries(['techName', 'officeEmail', 'woPrefix', 'exportMode']
        .filter((k) => typeof saved[k] === 'string' && saved[k] && !now[k]).map((k) => [k, saved[k]]));
      if (Object.keys(filled).length) await store.patchSettings(filled);
    }
    const changed = plan.added + plan.updated;
    toast(changed ? `Done! ${plural(changed, 'write-up')} ${changed === 1 ? 'is' : 'are'} back.` : 'Nothing new. These write-ups are already here.');
    location.hash = '#/';
  } catch (e) {
    toast(`${/^This /.test(e.message) ? e.message : 'This is not a Write-Up file.'} Nothing was changed.`);
  }
}
