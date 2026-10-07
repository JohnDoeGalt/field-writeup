// Pure validation — no DOM, no storage — so it runs in the browser and under `node --test`.
// validateJob() is the poka-yoke gate: an empty result is the ONLY way a job can be completed.
import { SECTIONS, PART_COLUMNS, PHOTO_SLOTS, SIGNATURES, allFields } from './schema.js';

const VIN_MAP = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5,
  P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function normalizeVin(v) {
  return String(v || '').toUpperCase().replace(/[\s-]/g, '');
}

// Returns null when valid, else a message. Format is a hard rule; the check digit (9th
// character, mandatory on North American VINs since 1981) catches almost every typo.
export function vinProblem(raw) {
  const vin = normalizeVin(raw);
  if (vin.length !== 17) return `VIN must be 17 characters (has ${vin.length})`;
  if (/[IOQ]/.test(vin)) return 'VIN never contains I, O or Q — check for 1 / 0';
  if (!/^[A-Z0-9]{17}$/.test(vin)) return 'VIN may only contain letters and numbers';
  const sum = [...vin].reduce((acc, ch, i) => acc + (/\d/.test(ch) ? +ch : VIN_MAP[ch]) * VIN_WEIGHTS[i], 0);
  const check = sum % 11 === 10 ? 'X' : String(sum % 11);
  if (vin[8] !== check) return 'VIN check digit doesn\'t match — re-read the plate, one character is off';
  return null;
}

export const digits = (s) => String(s || '').replace(/\D/g, '');

const isInt = (v) => /^\d+$/.test(String(v).trim());

export function hoursBetween(start, end) {
  const ms = new Date(end) - new Date(start);
  return Number.isFinite(ms) ? Math.round((ms / 36e5) * 100) / 100 : null;
}

export function computed(job) {
  const v = job.values;
  const hours = v.start_time && v.end_time ? hoursBetween(v.start_time, v.end_time) : null;
  const miles = isInt(v.truck_start_miles ?? '') && isInt(v.truck_end_miles ?? '')
    ? +v.truck_end_miles - +v.truck_start_miles : null;
  const partsTotal = job.no_parts ? 0 : job.parts.reduce((t, p) => t + (+p.qty || 0) * (+p.price || 0), 0);
  return { hours, miles, partsTotal: Math.round(partsTotal * 100) / 100 };
}

// ctx.lastUnitMileage: highest odometer previously recorded for this unit (or null).
function fieldProblem(f, value, job, ctx) {
  const v = String(value ?? '').trim();
  if (!v) return 'Required';
  if (f.minLen && v.length < f.minLen) return `Too short — give real detail (min ${f.minLen} characters)`;
  switch (f.kind) {
    case 'vin': {
      // Odd/imported/pre-1981 units can fail the check digit. The override only waives
      // the check digit, and only with a VIN-plate photo to back it up.
      const p = vinProblem(v);
      if (p && p.startsWith('VIN check digit') && job.vin_override) {
        return (job.photos.vin_plate || []).length ? null : 'Override needs a VIN / data plate photo';
      }
      return p;
    }
    case 'phone': {
      const d = digits(v);
      return d.length === 10 || (d.length === 11 && d[0] === '1') ? null : 'Phone needs 10 digits';
    }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? null : 'Not a valid email address';
    case 'plate':
      return /^[A-Z0-9 -]{2,10}$/i.test(v) ? null : 'Plate looks wrong (2–10 letters/numbers)';
    case 'int':
      return isInt(v) ? null : 'Whole number only';
    case 'unitMileage':
      if (!isInt(v)) return 'Whole number only';
      if (ctx.lastUnitMileage != null && +v < ctx.lastUnitMileage) {
        return `Lower than last recorded for this unit (${ctx.lastUnitMileage}) — check the odometer`;
      }
      return null;
    case 'endTime': {
      const h = hoursBetween(job.values.start_time, v);
      if (h == null) return null; // start time problem is reported on its own field
      if (h <= 0) return 'End time must be after start time';
      if (h > 24) return 'Over 24 hours — check the dates';
      return null;
    }
    case 'truckEnd':
      if (!isInt(v)) return 'Whole number only';
      if (isInt(job.values.truck_start_miles ?? '') && +v < +job.values.truck_start_miles) {
        return 'End miles are lower than start miles';
      }
      return null;
    default:
      return null;
  }
}

const NA_MIN = 3;

// Returns [{ key, section, label, message }]. key is the DOM anchor for "jump to".
export function validateJob(job, ctx = {}) {
  const out = [];
  const add = (key, section, label, message) => out.push({ key, section, label, message });

  for (const f of allFields()) {
    if (job.na[f.id] != null) {
      if (!f.na) add(f.id, f.section, f.label, 'Cannot be N/A');
      else if (String(job.na[f.id]).trim().length < NA_MIN) add(f.id, f.section, f.label, 'N/A needs a reason');
      continue;
    }
    const msg = fieldProblem(f, job.values[f.id], job, ctx);
    if (msg) add(f.id, f.section, f.label, msg);
  }

  // Parts: rows, or an explicit "no parts used". Never silently empty.
  if (!job.no_parts && job.parts.length === 0) {
    add('parts', 'parts', 'Parts used', 'Add parts, or tick "No parts used"');
  }
  if (!job.no_parts) {
    job.parts.forEach((p, i) => {
      for (const c of PART_COLUMNS) {
        const v = String(p[c.id] ?? '').trim();
        const label = `Part ${i + 1} ${c.label}`;
        if (!v) add(`part-${i}-${c.id}`, 'parts', label, 'Required');
        else if (c.id === 'qty' && !(+v > 0)) add(`part-${i}-${c.id}`, 'parts', label, 'Must be more than 0');
        else if (c.id === 'price' && !(+v >= 0)) add(`part-${i}-${c.id}`, 'parts', label, 'Not a valid amount');
      }
    });
  }

  const partsUsed = !job.no_parts && job.parts.length > 0;
  for (const s of PHOTO_SLOTS) {
    if (s.whenParts && !partsUsed) continue;
    const reason = job.photo_na[s.id];
    if (reason != null && s.na !== false) {
      if (String(reason).trim().length < NA_MIN) add(`photo-${s.id}`, 'photos', `Photo: ${s.label}`, 'N/A needs a reason');
      continue;
    }
    if (!(job.photos[s.id] || []).length) add(`photo-${s.id}`, 'photos', `Photo: ${s.label}`, 'Photo required');
  }

  for (const s of SIGNATURES) {
    if (!job.signatures[s.id]) add(`sig-${s.id}`, 'signoff', s.label, 'Signature required');
  }

  const order = SECTIONS.map((s) => s.id);
  return out.sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section));
}
