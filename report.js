// PDF (mirrors the paper Service Write-Up Sheet) and CSV export.
// Uses the vendored jsPDF global (vendor/jspdf.umd.min.js) so it works offline.
import { SECTIONS, PART_COLUMNS, PHOTO_SLOTS, SIGNATURES, allFields } from './schema.js';
import { computed } from './validate.js';

const money = (n) => `$${(+n || 0).toFixed(2)}`;

export function displayValue(job, f) {
  if (job.na[f.id] != null) return `N/A: ${job.na[f.id]}`;
  const v = job.values[f.id] ?? '';
  if (f.type === 'datetime-local' && v) return v.replace('T', ' ');
  if (f.id === 'vin' && job.vin_override) return `${v} (check digit overridden; see VIN plate photo)`;
  return String(v);
}

export function fileBase(job) {
  const safe = (s) => String(s || '').replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '');
  return ['WriteUp', safe(job.values.wo_number) || 'no-WO', safe(job.values.company_name), job.values.date]
    .filter(Boolean).join('_');
}

export function buildPdf(job) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  let y = M;

  const ensure = (h) => {
    if (y + h > H - M) { doc.addPage(); y = M; }
  };
  const bar = (title) => {
    ensure(80); // heading + at least one row, so a heading never sits alone at a page foot
    doc.setFillColor(30, 41, 59);
    doc.rect(M, y, W - 2 * M, 18, 'F');
    doc.setTextColor(255);
    doc.setFont('helvetica', 'bold').setFontSize(10);
    doc.text(title.toUpperCase(), M + 6, y + 12.5);
    doc.setTextColor(0);
    y += 26;
  };
  const field = (label, value, x, width) => {
    doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(90);
    doc.text(label.toUpperCase(), x, y);
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(0);
    const lines = doc.splitTextToSize(value || '-', width);
    doc.text(lines, x, y + 12);
    return 12 + lines.length * 12;
  };
  // Lays fields out in `cols` columns, row by row.
  const grid = (items, cols) => {
    const colW = (W - 2 * M) / cols;
    for (let i = 0; i < items.length; i += cols) {
      const row = items.slice(i, i + cols);
      const est = Math.max(...row.map(([, v]) => doc.splitTextToSize(v || '-', colW - 10).length)) * 12 + 18;
      ensure(est);
      const used = row.map(([l, v], j) => field(l, v, M + j * colW, colW - 10));
      y += Math.max(...used) + 8;
    }
  };

  // Header
  doc.setFont('helvetica', 'bold').setFontSize(16);
  doc.text('SERVICE WRITE-UP SHEET', M, y + 6);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(90);
  const stamp = job.status === 'draft' ? 'DRAFT: INCOMPLETE' : `Completed ${new Date(job.completed_at).toLocaleString()}`;
  doc.text(stamp, W - M, y + 6, { align: 'right' });
  doc.setTextColor(0);
  y += 24;

  const fields = allFields();
  for (const s of SECTIONS) {
    if (s.fields) {
      bar(s.title);
      const items = fields.filter((f) => f.section === s.id).map((f) => [f.label, displayValue(job, f)]);
      grid(items, s.id === 'work' || s.id === 'location' ? 1 : 3);
      if (s.id === 'location' && job.gps) {
        grid([['GPS', `${job.gps.lat.toFixed(5)}, ${job.gps.lng.toFixed(5)} (±${Math.round(job.gps.acc)} m)`]], 1);
      }
      if (s.id === 'time') {
        const c = computed(job);
        grid([['Total hours', c.hours != null ? String(c.hours) : '-'], ['Total miles', c.miles != null ? String(c.miles) : '-']], 3);
      }
    } else if (s.special === 'parts') {
      bar(s.title);
      if (job.no_parts) {
        grid([['Parts', 'No parts used']], 1);
      } else {
        const widths = [36, 90, 200, 110, 96];
        const head = () => {
          doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(90);
          let x = M;
          PART_COLUMNS.forEach((c, i) => { doc.text(c.label.toUpperCase(), x, y); x += widths[i]; });
          doc.setTextColor(0);
          y += 12;
        };
        head();
        doc.setFont('helvetica', 'normal').setFontSize(10);
        for (const p of job.parts) {
          const cells = PART_COLUMNS.map((c, i) => doc.splitTextToSize(c.id === 'price' ? money(p.price) : String(p[c.id] ?? ''), widths[i] - 6));
          const h = Math.max(...cells.map((l) => l.length)) * 12 + 4;
          if (y + h > H - M) { doc.addPage(); y = M; head(); doc.setFont('helvetica', 'normal').setFontSize(10); }
          let x = M;
          cells.forEach((l, i) => { doc.text(l, x, y); x += widths[i]; });
          y += h;
        }
        y += 6;
      }
    }
  }

  // Invoice-ready summary: what the office keys into Invoice Simple.
  const c = computed(job);
  bar('Invoice summary (for Invoice Simple)');
  const summary = [
    ['Bill to', `${job.values.company_name || '-'}${job.values.contact_name ? ` / attn ${job.values.contact_name}` : ''}`],
    ['WO / invoice #', job.values.wo_number || '-'],
    ['Labor hours', c.hours != null ? String(c.hours) : '-'],
    ['Service truck miles', c.miles != null ? String(c.miles) : '-'],
    ['Parts subtotal', money(c.partsTotal)],
    ['Unit', [job.values.unit_number, job.values.plate && `plate ${job.values.plate}`, job.values.vin && `VIN ${job.values.vin}`].filter(Boolean).join(' · ') || '-'],
  ];
  grid(summary, 3);

  // Signatures
  bar('Sign-off');
  ensure(80);
  const sigW = (W - 2 * M) / 2 - 10;
  SIGNATURES.forEach((s, i) => {
    const x = M + i * (sigW + 20);
    doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(90);
    doc.text(s.label.toUpperCase(), x, y);
    doc.setTextColor(0);
    if (job.signatures[s.id]) doc.addImage(job.signatures[s.id], 'PNG', x, y + 4, sigW, sigW / 4);
    doc.setDrawColor(150).line(x, y + 6 + sigW / 4, x + sigW, y + 6 + sigW / 4);
  });
  y += sigW / 4 + 20;

  // Photos: N/A notes first, then a 2×2 grid per page, each labelled.
  const naNotes = PHOTO_SLOTS.filter((s) => job.photo_na[s.id] != null).map((s) => `${s.label}: N/A (${job.photo_na[s.id]})`);
  const photos = PHOTO_SLOTS.flatMap((s) => (job.photo_na[s.id] != null ? [] : (job.photos[s.id] || [])
    .map((src, i, a) => ({ label: a.length > 1 ? `${s.label} ${i + 1}` : s.label, src }))));
  if (photos.length || naNotes.length) {
    doc.addPage();
    y = M;
    bar('Photos');
    doc.setFont('helvetica', 'normal').setFontSize(9);
    for (const n of naNotes) { doc.text(n, M, y); y += 14; }
    const gap = 14;
    const cellW = (W - 2 * M - gap) / 2;
    let top = y;
    let cellH = (H - top - M - 2 * gap) / 2 - 14;
    photos.forEach((p, i) => {
      const slot = i % 4;
      if (i > 0 && slot === 0) {
        doc.addPage();
        top = M;
        cellH = (H - top - M - 2 * gap) / 2 - 14;
      }
      const x = M + (slot % 2) * (cellW + gap);
      const cy = top + Math.floor(slot / 2) * (cellH + 14 + gap);
      doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(0).text(p.label, x, cy + 9);
      const props = doc.getImageProperties(p.src);
      const scale = Math.min(cellW / props.width, cellH / props.height);
      doc.addImage(p.src, 'JPEG', x, cy + 14, props.width * scale, props.height * scale);
    });
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(120);
    doc.text(`${job.values.wo_number || ''}  ·  page ${i} of ${pages}`, W - M, H - 20, { align: 'right' });
  }
  return doc.output('blob');
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildCsv(jobs) {
  const fields = allFields();
  const header = ['status', 'completed_at', ...fields.map((f) => f.label), 'Total hours', 'Total truck miles',
    'Parts', 'Parts subtotal', 'Photos', 'GPS'];
  const rows = jobs.map((job) => {
    const c = computed(job);
    const parts = job.no_parts ? 'No parts used'
      : job.parts.map((p) => `${p.qty}x ${p.part_number} ${p.description} (${p.supplier}) ${money(p.price)}`).join('; ');
    const photoCount = Object.values(job.photos).reduce((n, a) => n + a.length, 0);
    return [job.status, job.completed_at || '', ...fields.map((f) => displayValue(job, f)),
      c.hours ?? '', c.miles ?? '', parts, c.partsTotal.toFixed(2), photoCount,
      job.gps ? `${job.gps.lat},${job.gps.lng}` : ''];
  });
  // BOM so Excel opens it as UTF-8.
  return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
