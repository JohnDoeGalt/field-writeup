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
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 3;
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
    if (existing || (ink >= MIN_INK && maxX - minX >= MIN_WIDTH)) onDone(canvas.toDataURL('image/png'));
    else if (ink > 0) onTooSmall();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}
