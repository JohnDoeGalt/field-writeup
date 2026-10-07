// CSV export (one row per job), used by the phone's "Spreadsheet of all jobs" and the office
// sheet's "Download spreadsheet". Printing is the browser's own Print of the office report.
import { allFields } from './schema.js';
import { computed } from './validate.js';

export const money = (n) => `$${(+n || 0).toFixed(2)}`;

function displayValue(job, f) {
  if (job.na[f.id] != null) return `N/A: ${job.na[f.id]}`;
  const v = job.values[f.id] ?? '';
  if (f.type === 'datetime-local' && v) return v.replace('T', ' ');
  if (f.id === 'vin' && job.vin_override) return `${v} (check digit overridden; see VIN plate photo)`;
  return String(v);
}

const csvCell = (v) => {
  let s = String(v ?? '');
  // A-06: Excel runs cells that start with = + - @ (or tab/CR) as formulas. A leading
  // apostrophe makes them plain text (OWASP CSV-injection advice).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildCsv(jobs) {
  const fields = allFields();
  const header = ['status', 'completed_at', ...fields.map((f) => f.label), 'Total hours', 'Total truck miles',
    'Parts', 'Parts subtotal', 'Photos', 'GPS'];
  const rows = jobs.map((job) => {
    const c = computed(job);
    const parts = job.no_parts ? 'No parts used'
      : job.parts.map((p) => [`${p.qty ?? '?'}x`, p.part_number, p.description, p.supplier && `(${p.supplier})`, money(p.price)]
        .filter(Boolean).join(' ')).join('; '); // A-24: half-filled lines never print "undefined"
    const photoCount = Object.values(job.photos).reduce((n, a) => n + a.length, 0)
      + (job.no_parts ? 0 : job.parts.reduce((n, p) => n + (p.receipt_photos || []).length, 0)); // A-23
    return [job.status, job.completed_at || '', ...fields.map((f) => displayValue(job, f)),
      c.hours ?? '', c.miles ?? '', parts, c.partsTotal.toFixed(2), photoCount,
      job.gps ? `${job.gps.lat},${job.gps.lng}` : ''];
  });
  // BOM so Excel opens it as UTF-8.
  return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
