// Single source of truth for the Service Write-Up Sheet.
// The form, the completion gate, the PDF and the CSV are all generated from this,
// so a field added here is automatically required, rendered, reported and exported.
//
// Field options:
//   required  – must be filled to complete the job (default true)
//   na        – tech may mark "N/A" instead, but must give a reason (default true)
//   minLen    – minimum trimmed length (free-text fields)
//   kind      – validator key in validate.js (vin, phone, email, int, ...)

export const STATES = [
  'WA', 'OR', 'ID', 'MT', 'CA', 'NV', 'UT', 'AZ', 'AK', 'HI', 'WY', 'CO', 'NM', 'ND', 'SD', 'NE',
  'KS', 'OK', 'TX', 'MN', 'IA', 'MO', 'AR', 'LA', 'WI', 'IL', 'MI', 'IN', 'KY', 'TN', 'MS', 'AL',
  'OH', 'WV', 'VA', 'NC', 'SC', 'GA', 'FL', 'PA', 'NY', 'VT', 'NH', 'ME', 'MA', 'RI', 'CT', 'NJ',
  'DE', 'MD', 'DC', 'BC', 'AB', 'Other',
];

export const SECTIONS = [
  {
    id: 'job', title: 'Job',
    fields: [
      { id: 'date', label: 'Date', type: 'date', na: false },
      { id: 'tech_name', label: 'Tech name', type: 'text', na: false },
      { id: 'wo_number', label: 'Work order / invoice #', type: 'text', na: false },
    ],
  },
  {
    id: 'customer', title: 'Customer / company contact',
    fields: [
      { id: 'company_name', label: 'Company name', type: 'text', na: false },
      { id: 'contact_name', label: 'Contact name', type: 'text' },
      { id: 'phone', label: 'Phone', type: 'tel', kind: 'phone' },
      { id: 'email', label: 'Email', type: 'email', kind: 'email' },
    ],
  },
  {
    id: 'unit', title: 'Unit / vehicle',
    fields: [
      { id: 'unit_number', label: 'Unit number', type: 'text' },
      { id: 'plate', label: 'License plate number', type: 'text', kind: 'plate' },
      { id: 'state', label: 'State', type: 'select', options: STATES },
      { id: 'unit_mileage', label: 'Unit mileage (odometer)', type: 'number', kind: 'unitMileage' },
      { id: 'vin', label: 'VIN', type: 'text', kind: 'vin' },
    ],
  },
  {
    id: 'work', title: 'Work performed',
    fields: [
      { id: 'complaint', label: 'Complaint', type: 'textarea', minLen: 10, na: false },
      { id: 'diagnostics', label: 'Diagnostics', type: 'textarea', minLen: 10 },
      { id: 'repairs', label: 'Repairs completed', type: 'textarea', minLen: 10, na: false },
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
      { id: 'address', label: 'Address / location', type: 'text', minLen: 4, na: false },
      { id: 'city', label: 'City / area', type: 'text' },
      { id: 'location_notes', label: 'Location notes / gate code / landmark', type: 'textarea', minLen: 3 },
    ],
  },
  {
    id: 'time', title: 'Time and mileage',
    fields: [
      { id: 'start_time', label: 'Start time', type: 'datetime-local', na: false },
      { id: 'end_time', label: 'End time', type: 'datetime-local', na: false, kind: 'endTime' },
      { id: 'truck_start_miles', label: 'Start service truck miles', type: 'number', kind: 'int' },
      { id: 'truck_end_miles', label: 'End service truck miles', type: 'number', kind: 'truckEnd' },
    ],
  },
  {
    id: 'photos', title: 'Photos',
    special: 'photos',
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
  { id: 'price', label: 'Cost/price ($)', type: 'number' },
];

// From the sheet's own tip. Receipts are required only when parts were used.
export const PHOTO_SLOTS = [
  { id: 'unit', label: 'Unit', na: false },
  { id: 'vin_plate', label: 'VIN / data plate' },
  { id: 'license_plate', label: 'License plate' },
  { id: 'completed_work', label: 'Completed work', na: false },
  { id: 'receipts', label: 'Parts receipts', multiple: true, whenParts: true },
];

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
