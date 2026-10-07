// Export (one package for the whole phone), backup and restore. FR-9, FR-11, FR-15.
import * as store from './store.js';
import { isJobShape, normalizeJob } from './schema.js';
import { buildPackage, readPackage, selectForExport, mergePlan, packageName, EMAIL_LIMIT } from './package.js';
import { toast, ask, download, plural, hooks } from './ui.js';

export const APP_VERSION = '2026.10.07';

// The phone's share sheet (Mail, Dropbox, Files…): true = shared, false = closed or already
// open (A-02), null = this device can't share files (caller saves a download instead).
async function tryShare(file, title, text) {
  if (!navigator.canShare?.({ files: [file] })) return null;
  try {
    await navigator.share({ files: [file], title, text });
    return true;
  } catch (e) {
    return ['AbortError', 'InvalidStateError'].includes(e.name) ? false : null;
  }
}

// Returns true only when the share really happened, or the tech confirms they sent a
// downloaded copy (A-02).
async function shareOrSave(file, title, settings) {
  const to = settings.officeEmail ? `Send to: ${settings.officeEmail}` : 'Send it to the office.';
  const shared = await tryShare(file, title, `${title}\n${to}`);
  if (shared !== null) return shared;
  download(file);
  return (await ask('Your package is saved', `It is called "${file.name}". Attach it to an email. ${to}`, [
    { label: 'I sent it', value: true, primary: true },
    { label: 'Not yet', value: false },
  ])) === true;
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
      const pick = await ask(`This package is ${(file.size / 1e6).toFixed(0)} MB`, 'That is too big for most email. Save it to Dropbox or Files instead, or remove jobs that were sent before.', [
        { label: 'Make it anyway', value: 'go', primary: true },
        { label: 'Remove jobs already sent', value: 'clean' },
        { label: 'Cancel', value: null },
      ]);
      if (pick === 'clean') { await removeExported(); return; }
      if (pick !== 'go') return;
    }
    const sent = await shareOrSave(file, `${plural(jobs.length, 'write-up')} from ${settings.techName}`, settings);
    if (!sent) return;
    const stamp = now.toISOString();
    for (const j of jobs) {
      j.exported_at = stamp;
      if (j.status === 'complete') { j.status = 'sent'; j.sent_at = stamp; }
      await store.saveJob(j, { touch: false }); // keep updated_at: "since last" compares against it
    }
    await store.saveSettings({ ...settings, lastExportAt: stamp });
    toast(`Sent! ${plural(jobs.length, 'write-up')} in the package.`);
  } catch (e) {
    console.error(e);
    toast('Could not make the package. Nothing was marked as sent.');
  } finally {
    exporting = false;
    hooks.route();
  }
}

// Frees space: deletes only jobs that are Sent AND unchanged since they went out.
export async function removeExported() {
  const old = (await store.listJobs()).filter((j) => j.status === 'sent' && j.exported_at && j.updated_at <= j.exported_at);
  if (!old.length) { toast('No sent jobs to remove.'); return; }
  const ok = await ask(`Remove ${plural(old.length, 'sent job')}?`, 'They are already in a package you sent. This only clears them from this phone.', [
    { label: `Yes, remove ${old.length}`, value: true, primary: true },
    { label: 'Cancel', value: false },
  ]);
  if (!ok) return;
  for (const j of old) await store.deleteJob(j.id);
  toast(`Removed ${plural(old.length, 'job')}.`);
  hooks.route();
}

// ---------- backup: the same package, but nothing is marked as sent ----------
export async function exportBackup() {
  const settings = await store.getSettings();
  const jobs = await store.listJobs();
  if (!jobs.length) { toast('No jobs on this phone yet.'); return; }
  const now = new Date();
  const file = new File([buildPackage(jobs, { tech: settings.techName, appVersion: APP_VERSION, now, settings })],
    packageName(`${settings.techName}_backup`, now), { type: 'application/zip' });
  if ((await tryShare(file, 'Write-up backup')) === null) download(file);
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
      if (Object.keys(filled).length) await store.saveSettings({ ...now, ...filled });
    }
    const changed = plan.added + plan.updated;
    toast(changed ? `Done! ${plural(changed, 'write-up')} ${changed === 1 ? 'is' : 'are'} back.` : 'Nothing new. These write-ups are already here.');
    location.hash = '#/';
  } catch (e) {
    toast(`${/^This /.test(e.message) ? e.message : 'This is not a Write-Up file.'} Nothing was changed.`);
  }
}
