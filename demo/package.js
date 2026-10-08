// The data package (FR-9…FR-12, FR-15): ONE .zip holding every chosen job as a row in
// jobs.json, with each photo/signature as a real image file. Every file reference in a row
// says which job and which field or part line it proves. Format: docs/clients/rainier/PACKAGE_FORMAT.md
// Pure functions (no DOM, no storage) so they run in the browser and under `node --test`.
import { zipSync, unzipSync, strToU8, strFromU8 } from './vendor/fflate.min.js';
import { PHOTO_SLOTS, SIGNATURES, SCHEMA_VERSION, isJobShape, normalizeJob } from './schema.js';

export const FORMAT = 'field-writeup-package';
export const VERSION = 1;
export const EMAIL_LIMIT = 20e6; // bytes; above this, suggest Dropbox

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
// File/folder names: accents become plain letters ("Muñoz" → "Munoz", A-30), the rest → "_".
const safe = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

function dataUrlToBytes(url) {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(url || '');
  if (!m) throw new Error('not a base64 data URL');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1], bytes };
}

function bytesToDataUrl(bytes, mime) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

// Which jobs go into the package. 'everything' = all; 'since-last' = new or changed since
// that job was last exported (a job never exported always counts).
export function selectForExport(jobs, mode) {
  if (mode !== 'since-last') return jobs;
  return jobs.filter((j) => !j.exported_at || j.updated_at > j.exported_at);
}

const README = (meta) => `WRITE-UP PACKAGE
================
From: ${meta.tech || 'unknown'}
Made: ${new Date(meta.exported_at).toLocaleString()}
Jobs: ${meta.job_count}

How to open it:
1. On the office computer, open the Write-Up app link.
2. Tap or click "Office".
3. Drag this file onto the page.

Photos are also in the "photos" folder. Each photo's name says which job and which box it is for.
`;

// `settings` is included only in phone backups, so a new phone gets the name/email back (A-28).
export function buildPackage(jobs, { tech = '', appVersion = '', now = new Date(), settings } = {}) {
  const files = {};
  const put = (path, url) => {
    const { mime, bytes } = dataUrlToBytes(url);
    const file = `${path}.${EXT[mime] || 'bin'}`;
    files[file] = [bytes, { level: 0 }]; // JPEG/PNG are already compressed
    return file;
  };
  const rows = jobs.map((job) => {
    const dir = `${safe(job.values?.wo_number) || 'no-WO'}_${safe(job.id)}`;
    const row = structuredClone({ ...job, photos: {}, signatures: {}, parts: [] });
    for (const s of PHOTO_SLOTS) {
      row.photos[s.id] = (job.photos?.[s.id] || []).map((url, n) => ({
        file: put(`photos/${dir}/${s.id}_${n + 1}`, url), for: s.for, label: s.label,
      }));
    }
    if (job.photos?.unassigned?.length) {
      row.photos.unassigned = job.photos.unassigned.map((url, n) => ({
        file: put(`photos/${dir}/unassigned_receipt_${n + 1}`, url), for: 'parts', label: 'Older receipt (not matched to a part)',
      }));
    }
    row.parts = (job.parts || []).map((p, i) => ({
      ...p,
      receipt_photos: (p.receipt_photos || []).map((url, n) => ({
        file: put(`photos/${dir}/part${i + 1}_receipt_${n + 1}`, url), for: `parts[${i}]`, label: `Part ${i + 1} receipt`,
      })),
    }));
    for (const s of SIGNATURES) {
      if (job.signatures?.[s.id]) row.signatures[s.id] = { file: put(`signatures/${dir}/${s.id}`, job.signatures[s.id]), label: s.label };
    }
    return row;
  });
  const meta = {
    format: FORMAT, version: VERSION, schema: SCHEMA_VERSION, app_version: appVersion,
    exported_at: now.toISOString(), tech, job_count: rows.length,
    ...(settings && { settings: { techName: settings.techName, officeEmail: settings.officeEmail, woPrefix: settings.woPrefix, exportMode: settings.exportMode } }),
  };
  files['jobs.json'] = strToU8(JSON.stringify({ ...meta, jobs: rows }, null, 1));
  files['README.txt'] = strToU8(README(meta));
  return zipSync(files);
}

// Unwraps a package back into jobs (photos as data URLs, ready to store). Throws a plain
// Error on anything that isn't a package this app can read; the caller shows the message.
export function readPackage(bytes) {
  let entries;
  try {
    entries = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  } catch {
    throw new Error('This is not a Write-Up file.');
  }
  if (!entries['jobs.json']) throw new Error('This is not a Write-Up file.');
  let doc;
  try {
    doc = JSON.parse(strFromU8(entries['jobs.json']));
  } catch {
    throw new Error('This package is damaged.');
  }
  if (doc.format !== FORMAT || !Array.isArray(doc.jobs)) throw new Error('This is not a Write-Up file.');
  if (doc.version > VERSION) throw new Error('This package is from a newer app. Reload the app, then try again.');

  const load = (ref) => {
    if (!ref || typeof ref.file !== 'string' || !entries[ref.file]) throw new Error('This package is damaged (a photo is missing).');
    const mime = MIME[ref.file.split('.').pop().toLowerCase()];
    if (!mime) throw new Error('This package is damaged (unknown photo type).');
    return bytesToDataUrl(entries[ref.file], mime);
  };
  const jobs = doc.jobs.map((row) => {
    if (!isJobShape(row)) throw new Error('This package is damaged (a job is unreadable).');
    const job = { ...row, photos: {}, signatures: {} };
    for (const [slot, refs] of Object.entries(row.photos || {})) job.photos[slot] = (Array.isArray(refs) ? refs : []).map(load);
    job.parts = (row.parts || []).map((p) => ({ ...p, receipt_photos: (Array.isArray(p?.receipt_photos) ? p.receipt_photos : []).map(load) }));
    for (const [id, ref] of Object.entries(row.signatures || {})) job.signatures[id] = load(ref);
    return normalizeJob(job);
  });
  return { meta: { ...doc, jobs: undefined }, jobs };
}

// Merge rule shared by phone restore and office import: same job + same or older version →
// skip; newer → replace; unknown → add. Returns what to save plus plain counts.
export function mergePlan(incoming, existingById) {
  const plan = { save: [], added: 0, updated: 0, skipped: 0 };
  for (const job of incoming) {
    const have = existingById.get(job.id);
    if (!have) { plan.save.push(job); plan.added++; } else if ((job.updated_at || '') > (have.updated_at || '')) { plan.save.push(job); plan.updated++; } else plan.skipped++;
  }
  return plan;
}

// FR-25 (S27): a kept package can be deleted by hand at any time; the only automatic deletion
// is 30 days after it was last sent (sending it again restarts the 30 days).
export const KEEP_DAYS = 30;
const lastSent = (pkg) => (pkg.sends?.length ? pkg.sends[pkg.sends.length - 1].at : pkg.created_at);
export const expiresAt = (pkg) => new Date(Date.parse(lastSent(pkg)) + KEEP_DAYS * 864e5);
export const isExpired = (pkg, now = new Date()) => now >= expiresAt(pkg);
export const packagesSize = (pkgs) => pkgs.reduce((n, p) => n + (p.size || 0), 0);

// FR-26 (S28): a SENT job follows the same 30-day timer, counted from its last send — its own
// export or any re-send of a kept package that holds it. Jobs not yet sent never expire.
export function jobLastSent(job, pkgs = []) {
  const times = [job.exported_at, job.sent_at,
    ...pkgs.filter((p) => p.jobs?.some((j) => j.id === job.id)).flatMap((p) => (p.sends || []).map((s) => s.at))];
  return times.filter(Boolean).sort().pop() || null;
}
export function jobExpiresAt(job, pkgs = []) {
  const at = job.status === 'sent' ? jobLastSent(job, pkgs) : null;
  return at ? new Date(Date.parse(at) + KEEP_DAYS * 864e5) : null;
}
export const jobIsExpired = (job, pkgs = [], now = new Date()) => {
  const at = jobExpiresAt(job, pkgs);
  return !!at && now >= at;
};

export function packageName(tech, now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `WriteUps_${safe(tech) || 'tech'}_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.zip`;
}
