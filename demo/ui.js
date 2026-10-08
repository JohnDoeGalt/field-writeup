// Shared UI helpers. Text always goes through textContent, so typed data can't inject HTML.
export const $app = document.getElementById('app');

// Set by app.js at startup so other modules can re-draw / close the editor without import cycles.
export const hooks = { route: () => {}, closeEditor: () => {} };

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(kid));
  return el;
}

// Top-level render. Drops `cond && node` placeholders that h() would otherwise never see.
export const mount = (...nodes) => $app.replaceChildren(...nodes.flat().filter((n) => n != null && n !== false));

export const pad = (n) => String(n).padStart(2, '0');
export const localDateTime = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status', text: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// A bottom sheet with buttons; resolves to the chosen button's value (null if closed).
export function ask(title, text, buttons) {
  return new Promise((resolve) => {
    const done = (v) => { dlg.remove(); resolve(v); };
    const dlg = h('div', { class: 'sheet', role: 'dialog', 'aria-label': title },
      h('p', {}, h('strong', { text: title })),
      text && h('p', { text }),
      ...buttons.map((b) => h('button', { class: `btn big ${b.danger ? 'danger-solid' : b.primary ? 'primary' : ''}`, type: 'button', text: b.label, onclick: () => done(b.value) })));
    document.body.append(dlg);
  });
}

export function download(file) {
  const a = h('a', { href: URL.createObjectURL(file), download: file.name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
