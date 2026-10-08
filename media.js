// Photo capture and on-screen signatures.

async function loadImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Older iOS Safari: fall back to an <img>, which also honours EXIF orientation.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function shrinkPhoto(file, max = 1600) {
  const bmp = await loadImage(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}

// A-10: a scroll swipe that starts on the pad is a thin line, not a signature. The pad only
// counts as signed once the ink is long enough AND wide enough.
const MIN_INK = 60; // px of line, in canvas units (pad is 600 wide)
const MIN_WIDTH = 40; // px across

// axis: the direction the signature is written in ('x' normally; 'y' in the upright big pad).
export function setupSigPad(canvas, existing, locked, onDone, onTooSmall = () => {}, axis = 'x') {
  const ctx = canvas.getContext('2d');
  // Thresholds grow with bigger pads (FR-18), measured along the writing direction.
  const scale = (axis === 'y' ? canvas.height : canvas.width) / 600;
  const minInk = MIN_INK * scale;
  const minWidth = MIN_WIDTH * scale;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Reason: the upright big pad is shrunk ~4× to fit the 600×180 box, so its pen is drawn
  // thick enough to still be a ~2.5 px line in the saved signature.
  ctx.lineWidth = axis === 'y' ? 2.5 / Math.min(600 / canvas.height, 180 / canvas.width) : 3 * Math.max(1, scale * 0.7);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#111';
  if (existing) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = existing;
  }
  if (locked) return;
  let drawing = false;
  let last = null;
  let ink = 0; // total since the pad was last cleared
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const pt = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
  };
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    last = pt(e);
    ctx.beginPath();
    ctx.moveTo(...last);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pt(e);
    ink += Math.hypot(p[0] - last[0], p[1] - last[1]);
    minX = Math.min(minX, p[0], last[0]);
    maxX = Math.max(maxX, p[0], last[0]);
    minY = Math.min(minY, p[1], last[1]);
    maxY = Math.max(maxY, p[1], last[1]);
    last = p;
    ctx.lineTo(...p);
    ctx.stroke();
  });
  const end = () => {
    if (!drawing) return;
    drawing = false;
    // Strokes add up (initials are often several small strokes); the pad only counts as
    // signed once the total is big enough.
    const span = axis === 'y' ? maxY - minY : maxX - minX;
    if (existing || (ink >= minInk && span >= minWidth)) onDone(canvas.toDataURL('image/png'));
    else if (ink > 0) onTooSmall();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

// FR-18 / S18: a full-screen signing area that never rotates the phone. The owner keeps
// holding it upright: Cancel · Clear · Done sit at the bottom the right way up; the label runs
// sideways so the signer writes along the long side. Done turns the drawing 90° so it reads
// horizontally and fits it into the normal 600×180 box; Cancel changes nothing.
//
// FR-23 (S25): with `existing`, the pad opens showing that signature and can't be drawn on;
// Clear asks "Clear this signature?" (big red Yes, normal No) and only Yes allows a new one.
export function openBigPad({ label, existing, onSave, onTooSmall, onLockedTouch = () => {} }) {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };
  const overlay = el('div', 'bigpad');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', `${label}: sign here`);
  const button = (text, cls, fn) => {
    const b = el('button', `btn ${cls}`, text);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  };
  const area = el('div', 'bigpad-area');
  const side = el('div', 'bigpad-label'); // reads sideways, along the pad
  let canvas;
  let captured = null;
  let signed = !!existing; // a saved signature stays until Clear → Yes

  // The saved signature is horizontal (600×180); turn it back the way the signer wrote it:
  // a saved point (u, v) sits at (width − v, u) on the pad — the inverse of what Done does.
  const showExisting = () => {
    const img = new Image();
    img.onload = () => {
      const c = canvas.getContext('2d');
      const W = canvas.width;
      const H = canvas.height;
      const k = Math.min(H / 600, W / 180);
      c.save();
      c.translate(W, 0);
      c.rotate(Math.PI / 2);
      c.drawImage(img, (H - 600 * k) / 2, (W - 180 * k) / 2, 600 * k, 180 * k);
      c.restore();
    };
    img.src = existing;
  };

  const fresh = () => {
    captured = null;
    side.textContent = signed ? `${label}: signed ✓ (tap Clear to sign again)` : `${label}: sign here ✍`;
    const r = area.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas = el('canvas');
    canvas.width = Math.max(200, Math.round(r.width * dpr));
    canvas.height = Math.max(300, Math.round(r.height * dpr));
    canvas.setAttribute('aria-label', `${label} signing area`);
    area.replaceChildren(canvas, el('div', 'bigpad-line'));
    // The signer writes top-to-bottom on screen (left-to-right for them), so measure along y.
    setupSigPad(canvas, null, signed, (url) => { captured = url; }, () => { captured = null; onTooSmall(); }, 'y');
    if (signed) {
      showExisting();
      canvas.addEventListener('pointerdown', () => onLockedTouch());
    }
  };

  // "Clear this signature?" in the middle of the pad, upright. Yes is big and red.
  const askClear = () => {
    const box = el('div', 'bigpad-confirm');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-label', 'Clear this signature?');
    const card = el('div', 'bigpad-confirm-card');
    card.append(el('p', 'bigpad-confirm-q', 'Clear this signature?'), el('p', '', 'Then it can be signed again.'));
    card.append(
      button('Yes, clear it', 'big danger-solid', () => { box.remove(); signed = false; fresh(); }),
      button('No', 'big', () => box.remove()),
    );
    box.append(card);
    overlay.append(box);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  const done = () => {
    if (signed) { close(); return; } // nothing changed: the saved signature stays
    if (!captured) { onTooSmall(); return; }
    // Turn it 90° back (a point (x, y) → (y, width − x)) so the signature reads horizontally…
    const turned = el('canvas');
    turned.width = canvas.height;
    turned.height = canvas.width;
    const t = turned.getContext('2d');
    t.translate(0, canvas.width);
    t.rotate(-Math.PI / 2);
    t.drawImage(canvas, 0, 0);
    // …then fit it into the normal box, keeping its shape.
    const out = el('canvas');
    out.width = 600;
    out.height = 180;
    const c = out.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, 600, 180);
    const k = Math.min(600 / turned.width, 180 / turned.height);
    const w = turned.width * k;
    const h = turned.height * k;
    c.drawImage(turned, (600 - w) / 2, (180 - h) / 2, w, h);
    onSave(out.toDataURL('image/png'));
    close();
  };

  const bar = el('div', 'bigpad-bar');
  bar.append(button('Cancel', 'ghost', close), button('Clear', '', () => (signed ? askClear() : fresh())), button('Done ✓', 'primary', done));
  const body = el('div', 'bigpad-body');
  // The signer's "up" is the screen's right edge, so the label sits there, above their writing.
  body.append(area, side);
  overlay.append(body, bar);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(fresh);
}
