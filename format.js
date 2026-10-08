// As-you-type formatting (FR-16). Pure functions: each takes what's in the box and returns
// { show, store }: what the box displays and what gets saved.
const onlyDigits = (s) => String(s ?? '').replace(/\D/g, '');

// (253) 555-0142 · +1 (253) 555-0142 · (253) 555-0142 ext 204. Builds up while typing.
export function formatPhone(text) {
  const raw = String(text ?? '');
  const ext = /(?:x|ext\.?|extension)\s*(\d*)\s*$/i.exec(raw);
  let d = onlyDigits(ext ? raw.slice(0, ext.index) : raw);
  let extDigits = ext ? ext[1] : '';
  let prefix = '';
  if (d[0] === '1') { prefix = '+1 '; d = d.slice(1); }
  if (d.length > 10) { extDigits = d.slice(10) + extDigits; d = d.slice(0, 10); } // typed straight on
  let show = '';
  if (d.length > 0) show = `(${d.slice(0, 3)}`;
  if (d.length > 3) show += `) ${d.slice(3, 6)}`;
  if (d.length > 6) show += `-${d.slice(6)}`;
  if (d.length === 0 && prefix) show = '';
  show = prefix + show;
  if (ext || extDigits) show += ` ext ${extDigits}`;
  return { show: show.trimEnd() === '+1' ? '+1' : show, store: show };
}

// 612,455 on screen, "612455" saved (math, history and the CSV use plain digits).
export function formatThousands(text) {
  const d = onlyDigits(text).replace(/^0+(?=\d)/, '');
  return { show: d.replace(/\B(?=(\d{3})+(?!\d))/g, ','), store: d };
}

export const formatUpper = (text) => {
  const v = String(text ?? '').toUpperCase();
  return { show: v, store: v };
};

// Money: "$" appears as they type ("$12.5"); saved as the plain number ("12.5") for math.
export function formatMoney(text) {
  let v = String(text ?? '').replace(/[^\d.]/g, '');
  const dot = v.indexOf('.');
  if (dot !== -1) v = `${v.slice(0, dot + 1)}${v.slice(dot + 1).replace(/\./g, '').slice(0, 2)}`; // one dot, 2 decimals
  return { show: v ? `$${v}` : '', store: v };
}

// …and tidied to cents when the tech leaves the box: "$12.50".
export function formatMoneyOnLeave(text) {
  const { store } = formatMoney(text);
  if (!/^\d+(\.\d{0,2})?$/.test(store)) return { show: store ? `$${store}` : '', store };
  const v = (+store).toFixed(2);
  return { show: `$${v}`, store: v };
}

export const FORMATTERS = { phone: formatPhone, thousands: formatThousands, upper: formatUpper, money: formatMoney };

// Where should the cursor go after re-formatting a mid-string edit? After the same number of
// "real" characters that were before it. For phones and miles only digits are real — the
// letters in "ext" are decoration (counting them put new digits inside the word).
export const KEY_CHARS = { phone: /\d/, thousands: /\d/, money: /[\d.]/, upper: /[A-Za-z0-9]/ };
export function caretAfter(formatted, countBefore, re = /[A-Za-z0-9]/) {
  if (countBefore <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (re.test(formatted[i]) && ++seen === countBefore) return i + 1;
  }
  return formatted.length;
}
export const countKeyChars = (s, re = /[A-Za-z0-9]/) => [...String(s)].filter((c) => re.test(c)).length;
