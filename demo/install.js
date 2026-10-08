import { h, mount, hooks } from './ui.js';

// ---------- install guide ----------
// An iPhone keeps a Home Screen app's data apart from Safari's, so jobs typed in a Safari
// tab would never show up in the installed app. On iPhone the guide comes first.
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const isIOSSafari = () => isIOS() && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(navigator.userAgent);
let installPrompt = null; // Android/Chrome one-tap install
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (!location.hash.startsWith('#/job')) hooks.route();
});
export const browserOk = () => { try { return sessionStorage.getItem('browserOk') === '1'; } catch { return false; } };

function step(n, text) {
  return h('li', { class: 'step' }, h('span', { class: 'num', text: String(n) }), h('span', { text }));
}

export function installGuide(compact) {
  const ios = isIOS();
  const steps = ios
    ? (isIOSSafari()
      ? [step(1, 'Tap the Share button ⬆️ (a square with an arrow).'), step(2, 'Scroll down. Tap "Add to Home Screen" ➕.'), step(3, 'Tap "Add".'), step(4, 'Go to your Home Screen. Tap the Write-Up icon 📋.')]
      : [step(1, 'This is not Safari. Copy this page link.'), step(2, 'Open Safari 🧭 and paste the link.'), step(3, 'Then follow the steps you see there.')])
    : [step(1, 'Tap the 3 dots ⋮ at the top.'), step(2, 'Tap "Install app" or "Add to Home screen".'), step(3, 'Tap "Install".'), step(4, 'Tap the new Write-Up icon 📋.')];
  return h('section', { class: `install ${compact ? 'compact' : ''}` },
    h('h2', { text: '📲 Put this app on your phone' }),
    installPrompt && h('button', {
      class: 'btn primary big',
      text: 'Install app',
      onclick: async () => { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; hooks.route(); },
    }),
    h('p', { class: 'muted', text: installPrompt ? 'Or do it by hand:' : 'Do this one time:' }),
    h('ol', { class: 'steps' }, steps),
    ios && h('p', { class: 'note', text: 'Always use the app icon. Jobs typed in Safari do not show up in the app.' }));
}

export function renderInstallGate() {
  mount(
    h('header', { class: 'top' }, h('h1', { text: 'Write-Up 📋' })),
    h('main', {},
      installGuide(false),
      h('button', {
        class: 'btn ghost',
        text: 'Skip, use it in the browser',
        onclick: () => { try { sessionStorage.setItem('browserOk', '1'); } catch { /* private mode */ } hooks.route(); },
      })));
}
