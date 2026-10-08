// Nearest street address for a GPS point (FR-17), from OpenStreetMap's Nominatim service.
// Usage policy: https://operations.osmfoundation.org/policies/nominatim/ — max 1 request/s for
// the whole app, only on an explicit tap (never automatic/periodic/autocomplete), the app is
// identified by the browser's Referer, answers are cached, and "© OpenStreetMap contributors"
// is shown. The boss can switch lookups off (Settings), and any failure falls back to typing.
export const ATTRIBUTION = 'Address from © OpenStreetMap contributors';
const URL_BASE = 'https://nominatim.openstreetmap.org/reverse';
const cache = new Map();
let lastCall = 0;

// Pure: Nominatim's answer → { address, city }. Roadside spots often have a road but no number.
export function addressFromNominatim(json) {
  const a = json?.address || {};
  const road = a.road || a.pedestrian || a.footway || a.highway || a.path;
  const street = [a.house_number, road].filter(Boolean).join(' ') || json?.name || String(json?.display_name || '').split(',')[0].trim();
  const city = a.city || a.town || a.village || a.hamlet || a.suburb || a.municipality || a.county || '';
  return street ? { address: street, city } : null;
}

// Returns { address, city } or null (no signal, switched off, timeout, nothing found).
export async function lookupAddress(lat, lng) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (cache.has(key)) return cache.get(key);
  if (!navigator.onLine) return null;
  const wait = 1100 - (Date.now() - lastCall); // never more than 1 request per second
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${URL_BASE}?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lng}`, { signal: ctl.signal });
    if (!res.ok) return null;
    const found = addressFromNominatim(await res.json());
    if (found) cache.set(key, found);
    return found;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
