// Single source of truth for the Service Write-Up Sheet.
// The form, the completion gate, the PDF and the CSV are all generated from this,
// so a field added here is automatically required, rendered, reported and exported.
//
// Field options:
//   required  – must be filled to complete the job (default true)
//   na        – tech may mark "N/A" instead, but must give a reason (default true)
//   minLen    – minimum trimmed length (free-text fields)
//   kind      – validator key in validate.js (vin, phone, email, int, ...)

const STATES = [
  'WA', 'OR', 'ID', 'MT', 'CA', 'NV', 'UT', 'AZ', 'AK', 'HI', 'WY', 'CO', 'NM', 'ND', 'SD', 'NE',
  'KS', 'OK', 'TX', 'MN', 'IA', 'MO', 'AR', 'LA', 'WI', 'IL', 'MI', 'IN', 'KY', 'TN', 'MS', 'AL',
  'OH', 'WV', 'VA', 'NC', 'SC', 'GA', 'FL', 'PA', 'NY', 'VT', 'NH', 'ME', 'MA', 'RI', 'CT', 'NJ',
  'DE', 'MD', 'DC', 'BC', 'AB', 'Other',
];

export const SECTIONS = [
  {
    id: 'job', title: 'Job',
    fields: [
      // FR-21 (S22, S23): tapped on arrival, so they come first. End time/miles stay below.
      { id: 'start_time', label: 'Start time', type: 'datetime-local', kind: 'startTime' },
      { id: 'truck_start_miles', label: 'Start service truck miles', type: 'number', kind: 'int', format: 'thousands' },
      { id: 'date', label: 'Date', type: 'date' },
      { id: 'tech_name', label: 'Tech name', type: 'text' },
      { id: 'wo_number', label: 'Work order / invoice #', type: 'text', kind: 'wo' },
    ],
  },
  {
    id: 'customer', title: 'Customer / company contact',
    fields: [
      { id: 'company_name', label: 'Company name', type: 'text' },
      { id: 'contact_name', label: 'Contact name', type: 'text' },
      { id: 'phone', label: 'Phone', type: 'tel', kind: 'phone', format: 'phone' },
      { id: 'email', label: 'Email', type: 'email', kind: 'email' },
    ],
  },
  {
    id: 'unit', title: 'Unit / vehicle',
    fields: [
      { id: 'unit_number', label: 'Unit number', type: 'text' },
      { id: 'plate', label: 'License plate number', type: 'text', kind: 'plate', format: 'upper' },
      { id: 'state', label: 'State', type: 'select', options: STATES },
      { id: 'unit_mileage', label: 'Unit mileage (odometer)', type: 'number', kind: 'unitMileage', format: 'thousands' },
      { id: 'vin', label: 'VIN', type: 'text', kind: 'vin' },
    ],
  },
  {
    id: 'work', title: 'Work performed',
    fields: [
      { id: 'complaint', label: 'Complaint', type: 'textarea', minLen: 10 },
      { id: 'diagnostics', label: 'Diagnostics', type: 'textarea', minLen: 10 },
      { id: 'repairs', label: 'Repairs completed', type: 'textarea', minLen: 10 },
      { id: 'test_results', label: 'Test results', type: 'textarea', minLen: 5 },
      { id: 'customer_instructions', label: 'Customer instructions', type: 'textarea', minLen: 5 },
      { id: 'follow_up', label: 'Follow-up needed', type: 'textarea', minLen: 5 },
    ],
  },
  {
    id: 'parts', title: 'Parts used',
    // Rows of PART_COLUMNS, or the explicit "no parts used" switch. Never silently empty.
    special: 'parts',
  },
  {
    id: 'location', title: 'Breakdown / jobsite address',
    fields: [
      { id: 'address', label: 'Address / location', type: 'text', minLen: 4 },
      { id: 'city', label: 'City / area', type: 'text' },
      { id: 'location_notes', label: 'Location notes / gate code / landmark', type: 'textarea', minLen: 3 },
    ],
  },
  {
    id: 'time', title: 'Time and mileage',
    fields: [
      { id: 'end_time', label: 'End time', type: 'datetime-local', kind: 'endTime' },
      { id: 'truck_end_miles', label: 'End service truck miles', type: 'number', kind: 'truckEnd', format: 'thousands' },
    ],
  },
  {
    id: 'signoff', title: 'Sign-off',
    special: 'signatures',
  },
];

export const PART_COLUMNS = [
  { id: 'qty', label: 'Qty', type: 'number' },
  { id: 'part_number', label: 'Part #', type: 'text' },
  { id: 'description', label: 'Description', type: 'text' },
  { id: 'supplier', label: 'Supplier', type: 'text' },
  { id: 'price', label: 'Cost/price each ($)', type: 'number' }, // per item; the line total is shown (A-29)
];

// From the sheet's own tip. Every photo belongs to the field it proves (`for`), so the form
// shows it in that block and the package/report keep the pairing. A new photo requirement
// (e.g. tires) is one line here: { id: 'tires', label: 'Tires', for: '<field id>' }.
export const PHOTO_SLOTS = [
  { id: 'unit', label: 'Unit', for: 'unit_number' },
  { id: 'vin_plate', label: 'VIN / data plate', for: 'vin' },
  { id: 'license_plate', label: 'License plate', for: 'plate' },
  { id: 'completed_work', label: 'Completed work', for: 'repairs', multiple: true },
];

// Each part line carries its own receipt photo(s) (part.receipt_photos), or an N/A reason
// (part.receipt_na), e.g. "From truck stock".
export const PART_RECEIPT = { label: 'Receipt photo' };

export const SCHEMA_VERSION = 2;

// Who the job is for (S20): the company, or — for a private customer (company N/A) — the
// contact's name. Used by the job list, the office sheet and the invoice block.
export const clientName = (job) => (job.na?.company_name != null
  ? (job.values.contact_name || 'Private customer')
  : (job.values.company_name || ''));

// Minimum shape every stored or imported job must have. Anything else is refused or
// skipped, so one bad record can never stop the app from opening (A-09).
export function isJobShape(j) {
  const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  return obj(j) && typeof j.id === 'string' && j.id.length > 0 && obj(j.values)
    && (j.parts === undefined || Array.isArray(j.parts))
    && (j.photos === undefined || obj(j.photos))
    && (j.signatures === undefined || obj(j.signatures))
    && (j.updated_at === undefined || typeof j.updated_at === 'string')
    && ['draft', 'complete', 'sent', undefined].includes(j.status);
}

// Fills in anything an older or hand-made record is missing, so every screen can rely on it.
export function normalizeJob(j) {
  j.na ||= {};
  j.photo_na ||= {};
  j.photos ||= {};
  j.signatures ||= {};
  j.parts ||= [];
  j.status ||= 'draft';
  j.updated_at ||= j.created_at || new Date(0).toISOString();
  j.created_at ||= j.updated_at;
  return migrateJob(j);
}

// Older saved jobs (v1) kept every receipt in one pile. Give them to part lines when the
// counts match; otherwise keep them as unassigned so nothing is lost. Safe to run twice.
export function migrateJob(job) {
  if ((job.schema || 1) >= SCHEMA_VERSION) return job;
  const pile = job.photos?.receipts || [];
  job.parts = (job.parts || []).map((p) => ({ ...p, receipt_photos: p.receipt_photos || [] }));
  if (pile.length && pile.length === job.parts.length) {
    pile.forEach((src, i) => { job.parts[i].receipt_photos = [src]; });
  } else if (pile.length) {
    job.photos.unassigned = pile;
  }
  if (job.photos) delete job.photos.receipts;
  if (job.photo_na) delete job.photo_na.receipts;
  job.schema = SCHEMA_VERSION;
  return job;
}

export const SIGNATURES = [
  { id: 'customer_initials', label: 'Customer initials' },
  { id: 'tech_signature', label: 'Tech signature' },
];

export const allFields = () => SECTIONS.flatMap((s) => (s.fields || []).map((f) => ({
  required: true, na: true, ...f, section: s.id,
})));

export function newJob(settings = {}, now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return {
    id: `job-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
    schema: SCHEMA_VERSION,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    status: 'draft', // draft → complete → sent
    values: { date: today, tech_name: settings.techName || '' },
    na: {}, // fieldId → reason
    parts: [],
    no_parts: false,
    photos: {}, // slotId → [dataURL]
    photo_na: {}, // slotId → reason
    signatures: {}, // id → dataURL
    gps: null,
  };
}
