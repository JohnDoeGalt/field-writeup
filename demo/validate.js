// Pure validation — no DOM, no storage — so it runs in the browser and under `node --test`.
// validateJob() is the poka-yoke gate: an empty result is the ONLY way a job can be completed.
import { SECTIONS, PART_COLUMNS, PART_RECEIPT, PHOTO_SLOTS, SIGNATURES, allFields } from './schema.js';

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

const digits = (s) => String(s || '').replace(/\D/g, '');
// A-18: an extension ("x204", "ext. 204") doesn't count toward the 10 digits.
const phoneDigits = (s) => digits(String(s || '').replace(/\s*(x|ext\.?|extension)\s*\d+\s*$/i, ''));
// 10-digit North American number with a real area code and exchange (not 000-000-0000). A-17.
const isPhone = (s) => {
  let d = phoneDigits(s);
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d);
};
// A-17: "real detail" means words, not dots or "fixed it".
const words = (s) => (String(s).match(/\p{L}{2,}/gu) || []).length;

const isInt = (v) => /^\d+$/.test(String(v).trim());

// Times are wall-clock (what the tech reads off a clock). On the fall-back night the clock
// repeats an hour, so a real 45-minute job can look like -15 min; that day, a gap of up to
// an hour "backwards" is the repeated hour (A-19).
function hoursBetween(start, end) {
  const ms = new Date(end) - new Date(start);
  if (!Number.isFinite(ms)) return null;
  let h = ms / 36e5;
  const day = new Date(start);
  const fallBack = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTimezoneOffset()
    < new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59).getTimezoneOffset();
  if (fallBack && h <= 0 && h > -1) h += 1;
  return Math.round(h * 100) / 100;
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
  // "Real words" is for descriptions of the work, not addresses ("Interstate 5") or gate codes.
  if (f.type === 'textarea' && f.minLen >= 5 && words(v) < (f.minLen >= 10 ? 3 : 2)) return 'Use real words — say what you found or did';
  switch (f.kind) {
    case 'wo':
      return ctx.woUsedBy ? `This WO # is already used on ${ctx.woUsedBy}. Use a new number.` : null;
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
      const n = phoneDigits(v).length;
      if (n !== 10 && !(n === 11 && phoneDigits(v)[0] === '1')) return `Phone needs 10 digits (has ${n})`;
      return isPhone(v) ? null : 'That phone number is not real — check the area code';
    }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? null : 'Not a valid email address';
    case 'plate': {
      // US/Canadian plates are 2–8 characters (spaces and dashes don't count).
      const n = v.replace(/[\s-]/g, '').length;
      if (!/^[A-Z0-9 -]+$/i.test(v)) return 'Plate can only have letters and numbers';
      return n >= 2 && n <= 8 ? null : `Plate has ${n} characters — plates have 2 to 8`;
    }
    case 'int':
      if (!isInt(v)) return 'Whole number only';
      return v.length > MAX_DIGITS ? 'Too many digits — check the number' : null;
    case 'unitMileage':
      if (!isInt(v)) return 'Whole number only';
      if (v.length > MAX_DIGITS) return 'Too many digits — check the odometer';
      // A-05: a lower reading is a warning the tech can confirm with a reason (odometer
      // replaced, earlier typo), never a dead end.
      if (ctx.lastUnitMileage != null && +v < ctx.lastUnitMileage) {
        const why = String(job.odo_confirm ?? '').trim();
        if (job.odo_confirm == null) return `Lower than last time for this unit (${ctx.lastUnitMileage}). Check it, or confirm below.`;
        if (why.length < 3) return 'Say why the reading is lower';
      }
      return null;
    case 'startTime': {
      // A-20: the work happened on the job date (or the night before/after), so a wrong
      // day or year picked in the date wheel can't bill a day of labor.
      const d = job.values.date;
      if (!d || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
      const days = Math.abs(Date.parse(v.slice(0, 10)) - Date.parse(d)) / 864e5;
      return days > 1 ? `Start is on ${v.slice(0, 10)}, but the job date is ${d}. Check the dates.` : null;
    }
    case 'endTime': {
      const h = hoursBetween(job.values.start_time, v);
      if (h == null) return null; // start time problem is reported on its own field
      if (h <= 0) return 'End time must be after start time';
      if (h > 24) return 'Over 24 hours — check the dates';
      return null;
    }
    case 'truckEnd':
      if (!isInt(v)) return 'Whole number only';
      if (v.length > MAX_DIGITS) return 'Too many digits — check the number';
      if (isInt(job.values.truck_start_miles ?? '') && +v < +job.values.truck_start_miles) {
        return 'End miles are lower than start miles';
      }
      return null;
    default:
      return null;
  }
}

const NA_MIN = 3;
// A-17: an N/A reason has to say something; "n/a", "na", "x", "---" don't.
const badReason = (r) => {
  const t = String(r ?? '').trim();
  return t.length < NA_MIN || /^(n\s*\/?\s*a|x+|-+|\.+|\?+)$/i.test(t);
};
const MAX_DIGITS = 7; // odometers and service-truck miles: up to 9,999,999
// A-16: plain numbers only — no "Infinity", "1e9" or "0x10" from a paste.
const QTY = /^\d+(\.\d+)?$/;
const PRICE = /^\d+(\.\d{1,2})?$/;

// Unit history (A-05): the same unit is the same VIN, or the same company + unit number.
// Readings marked N/A don't count. Returns { lastUnitMileage }.
export function unitContext(job, jobs) {
  const unit = job.values.unit_number?.trim().toLowerCase();
  const company = job.values.company_name?.trim().toLowerCase();
  const vin = normalizeVin(job.values.vin);
  const same = (j) => (vin.length === 17 && normalizeVin(j.values.vin) === vin)
    || (unit && company && j.values.unit_number?.trim().toLowerCase() === unit && j.values.company_name?.trim().toLowerCase() === company);
  const prior = jobs.filter((j) => j.id !== job.id && same(j) && j.na?.unit_mileage == null && isInt(j.values.unit_mileage ?? ''))
    .map((j) => +j.values.unit_mileage);
  return { lastUnitMileage: prior.length ? Math.max(...prior) : null };
}

// B-08: a WO / invoice # becomes one invoice, so it must be unique on this phone.
// Case and spaces don't matter ("ra-1 " = "RA-1").
export const woKey = (wo) => String(wo || '').toUpperCase().replace(/\s+/g, '');
export function woContext(job, jobs) {
  const key = woKey(job.values.wo_number);
  const other = key && jobs.find((j) => j.id !== job.id && woKey(j.values.wo_number) === key);
  return { woUsedBy: other ? `${other.values.company_name || 'another job'} (${other.values.date || 'no date'})` : null };
}

// Everything the gate needs from the other jobs on the phone.
export const jobContext = (job, jobs) => ({ ...unitContext(job, jobs), ...woContext(job, jobs) });

// Live length hint shown under a field while typing (B-19). null = no counter for this field.
export function lengthHint(f, value) {
  const v = String(value ?? '');
  if (f.kind === 'vin') { const n = normalizeVin(v).length; return { text: `${n}/17`, ok: n === 17 }; }
  if (f.kind === 'phone') { const n = phoneDigits(v).length; return { text: `${n}/10 digits`, ok: n === 10 || (n === 11 && phoneDigits(v)[0] === '1') }; }
  if (f.kind === 'plate') { const n = v.replace(/[\s-]/g, '').length; return { text: `${n} (2–8)`, ok: n >= 2 && n <= 8 }; }
  return null;
}

// Returns [{ key, section, label, message }]. key is the DOM anchor for "jump to".
export function validateJob(job, ctx = {}) {
  const out = [];
  const add = (key, section, label, message) => out.push({ key, section, label, message });

  for (const f of allFields()) {
    if (job.na[f.id] != null) {
      if (!f.na) add(f.id, f.section, f.label, 'Cannot be N/A');
      else if (badReason(job.na[f.id])) add(f.id, f.section, f.label, 'N/A needs a reason');
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
        else if (c.id === 'qty' && !(QTY.test(v) && +v > 0)) add(`part-${i}-${c.id}`, 'parts', label, 'Type a number more than 0');
        else if (c.id === 'price' && !PRICE.test(v)) add(`part-${i}-${c.id}`, 'parts', label, 'Type a price like 12.50');
      }
      // Each part line proves itself with its own receipt (FR-10).
      const label = `Part ${i + 1}: ${PART_RECEIPT.label.toLowerCase()}`;
      if (p.receipt_na != null) {
        if (badReason(p.receipt_na)) add(`part-${i}-receipt`, 'parts', label, 'N/A needs a reason');
      } else if (!(p.receipt_photos || []).length) {
        add(`part-${i}-receipt`, 'parts', label, 'Photo required (or N/A with a reason)');
      }
    });
  }

  // FR-17: an address the GPS filled in must be confirmed (or retyped) by the tech.
  if (job.address_from_gps && !job.address_confirmed && !out.some((p) => p.key === 'address')) {
    add('address', 'location', 'Address / location', 'Check the GPS address: tap "Yes, that\'s right" or fix it');
  }

  const sectionOf = Object.fromEntries(allFields().map((f) => [f.id, f.section]));
  for (const s of PHOTO_SLOTS) {
    const section = sectionOf[s.for];
    const reason = job.photo_na[s.id];
    if (reason != null && s.na !== false) {
      if (badReason(reason)) add(`photo-${s.id}`, section, `Photo: ${s.label}`, 'N/A needs a reason');
      continue;
    }
    if (!(job.photos[s.id] || []).length) add(`photo-${s.id}`, section, `Photo: ${s.label}`, 'Photo required');
  }

  for (const s of SIGNATURES) {
    if (!job.signatures[s.id]) add(`sig-${s.id}`, 'signoff', s.label, 'Signature required');
  }

  const order = SECTIONS.map((s) => s.id);
  return out.sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section));
}
