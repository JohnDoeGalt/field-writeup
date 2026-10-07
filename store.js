// On-device storage (IndexedDB). Nothing leaves the phone except files the tech shares.
const DB = 'field-writeup';
const VERSION = 1;

let dbp;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('jobs', { keyPath: 'id' });
      req.result.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
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
  });
}

export const getJob = (id) => run('jobs', 'readonly', (s) => s.get(id));
export const deleteJob = (id) => run('jobs', 'readwrite', (s) => s.delete(id));
export async function listJobs() {
  const jobs = await run('jobs', 'readonly', (s) => s.getAll());
  return jobs.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
export function saveJob(job) {
  job.updated_at = new Date().toISOString();
  return run('jobs', 'readwrite', (s) => s.put(job));
}

export async function getSettings() {
  return (await run('kv', 'readonly', (s) => s.get('settings'))) || { techName: '', officeEmail: '', woPrefix: '' };
}
export const saveSettings = (v) => run('kv', 'readwrite', (s) => s.put(v, 'settings'));

// Ask the browser not to evict our data under storage pressure (iOS/Android may otherwise).
export async function requestPersistence() {
  try {
    return navigator.storage?.persist ? await navigator.storage.persist() : false;
  } catch {
    return false;
  }
}
