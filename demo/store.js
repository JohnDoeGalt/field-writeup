// On-device storage (IndexedDB). Nothing leaves the phone except files the tech shares.
import { isJobShape, normalizeJob } from './schema.js';
const DB = 'field-writeup-demo'; // DEMO: separate storage
// v2 adds office_jobs: jobs unwrapped from packages on the office computer.
// v3 adds packages: every package this phone sent, kept so it can be sent again (FR-25).
const VERSION = 3;

let dbp;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('jobs')) d.createObjectStore('jobs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('office_jobs')) d.createObjectStore('office_jobs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('packages')) d.createObjectStore('packages', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      // A newer version of the app (another tab) needs to upgrade the database: step aside.
      req.result.onversionchange = () => { req.result.close(); dbp = undefined; };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function run(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    // A transaction can abort without an error event (e.g. storage full); never hang (A-14).
    tx.onabort = () => reject(tx.error || new Error('Save was cancelled'));
  });
}

// Jobs saved by an older version are upgraded as they're read. Records that aren't a job at
// all are skipped (left untouched in storage), so one bad record can't break the app (A-09).
export const getJob = async (id) => {
  const j = await run('jobs', 'readonly', (s) => s.get(id));
  return isJobShape(j) ? normalizeJob(j) : null;
};
export const deleteJob = (id) => run('jobs', 'readwrite', (s) => s.delete(id));
export async function listJobs() {
  const jobs = (await run('jobs', 'readonly', (s) => s.getAll())).filter(isJobShape).map(normalizeJob);
  return jobs.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
// Office computer: jobs unwrapped from packages (FR-12). Kept apart from this browser's own
// phone jobs. Saved exactly as received (no timestamp changes) so re-imports merge cleanly.
export async function officeList() {
  return (await run('office_jobs', 'readonly', (s) => s.getAll())).filter(isJobShape).map(normalizeJob);
}
export const officeGet = async (id) => {
  const j = await run('office_jobs', 'readonly', (s) => s.get(id));
  return isJobShape(j) ? normalizeJob(j) : null;
};
// One transaction for the whole import: all-or-nothing, and far faster in Safari's engine.
export const officeSaveMany = (jobs) => run('office_jobs', 'readwrite', (s) => { jobs.forEach((j) => s.put(j)); });

// touch:false keeps updated_at as-is (bookkeeping like "exported", or restoring a copy), so
// "only new since last package" and duplicate checks compare real edits only.
export function saveJob(job, { touch = true } = {}) {
  if (touch || !job.updated_at) job.updated_at = new Date().toISOString();
  return run('jobs', 'readwrite', (s) => s.put(job));
}

// Packages (FR-25): { id, created_at, kind: 'send'|'backup', name, size, bytes (Uint8Array), jobs: [{id, name}],
// sends: [{ at, how: 'shared'|'downloaded' }] }. Deleted by hand, or 30 days after the last send (isExpired).
export const savePackage = (p) => run('packages', 'readwrite', (s) => s.put(p));
export const getPackage = (id) => run('packages', 'readonly', (s) => s.get(id));
export async function listPackages() {
  return (await run('packages', 'readonly', (s) => s.getAll())).sort((a, b) => b.created_at.localeCompare(a.created_at));
}
export const deletePackages = (ids) => run('packages', 'readwrite', (s) => { ids.forEach((id) => s.delete(id)); });

// exportMode: which Export button(s) the techs see (FR-15): 'everything' | 'since-last' | 'both'.
const DEFAULT_SETTINGS = { techName: '', officeEmail: '', woPrefix: '', exportMode: 'everything', lastExportAt: null };
export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await run('kv', 'readonly', (s) => s.get('settings'))) };
}
export const saveSettings = (v) => run('kv', 'readwrite', (s) => s.put(v, 'settings'));
// Change some settings in ONE transaction (read + write), so a screen that loads right after
// always sees the change, and two switches flipped quickly never overwrite each other.
export const patchSettings = (patch) => run('kv', 'readwrite', (s) => {
  const r = s.get('settings');
  r.onsuccess = () => s.put({ ...DEFAULT_SETTINGS, ...r.result, ...patch }, 'settings');
  return r;
});

// Ask the browser not to evict our data under storage pressure (iOS/Android may otherwise).
export async function requestPersistence() {
  try {
    return navigator.storage?.persist ? await navigator.storage.persist() : false;
  } catch {
    return false;
  }
}
