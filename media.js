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

export function setupSigPad(canvas, existing, locked, onDone, onTooSmall = () => {}) {
  const ctx = canvas.getContext('2d');
  const scale = canvas.width / 600; // thresholds and line width grow with bigger pads (FR-18)
  const minInk = MIN_INK * scale;
  const minWidth = MIN_WIDTH * scale;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 3 * Math.max(1, scale * 0.7);
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
    last = p;
    ctx.lineTo(...p);
    ctx.stroke();
  });
  const end = () => {
    if (!drawing) return;
    drawing = false;
    // Strokes add up (initials are often several small strokes); the pad only counts as
    // signed once the total is big enough.
    if (existing || (ink >= minInk && maxX - minX >= minWidth)) onDone(canvas.toDataURL('image/png'));
    else if (ink > 0) onTooSmall();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

// FR-18: a full-screen signing area (best sideways). The bar with Cancel / Clear / Done sits
// outside the drawing area, so leaving never draws. Done shrinks the signature to fit the
// normal 600×180 box; Cancel changes nothing. onSave(dataUrl) / onTooSmall() are callbacks.
export function openBigPad({ label, onSave, onTooSmall }) {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };
  const overlay = el('div', 'bigpad');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', `${label}: sign here`);
  const bar = el('div', 'bigpad-bar');
  const button = (text, cls, fn) => {
    const b = el('button', `btn ${cls}`, text);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  };
  const area = el('div', 'bigpad-area');
  let canvas;
  let captured = null;

  const fresh = () => {
    captured = null;
    const r = area.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas = el('canvas');
    canvas.width = Math.max(300, Math.round(r.width * dpr));
    canvas.height = Math.max(120, Math.round(r.height * dpr));
    canvas.setAttribute('aria-label', `${label} signing area`);
    area.replaceChildren(canvas);
    setupSigPad(canvas, null, false, (url) => { captured = url; }, () => { captured = null; onTooSmall(); });
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  // Turning the phone resizes the area: start fresh only if nothing has been signed yet.
  const onResize = () => { if (!captured) fresh(); };
  function close() {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    try { screen.orientation?.unlock?.(); } catch { /* not supported */ }
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    overlay.remove();
  }
  const done = () => {
    if (!captured) { onTooSmall(); return; }
    // Fit the big signature into the normal box, keeping its shape.
    const out = el('canvas');
    out.width = 600;
    out.height = 180;
    const c = out.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, 600, 180);
    const k = Math.min(600 / canvas.width, 180 / canvas.height);
    const w = canvas.width * k;
    const h = canvas.height * k;
    c.drawImage(canvas, (600 - w) / 2, (180 - h) / 2, w, h);
    onSave(out.toDataURL('image/png'));
    close();
  };

  bar.append(button('Cancel', 'ghost', close), el('strong', '', label), button('Clear', '', fresh), button('Done ✓', 'primary', done));
  overlay.append(bar, el('p', 'rotate-hint', '↻ Turn your phone sideways for more room'), area);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  // Sideways where the phone allows it (Android, installed app); iPhones show the hint instead.
  document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  requestAnimationFrame(fresh);
}
