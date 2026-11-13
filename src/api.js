import { headers } from "./device.js";
import { unwrapEnvelope } from "./crypto.js";

// ZappTV's own app ships this exact fallback list (vc/b0.java) because api.myzapptv.com gets
// blocked by some ISPs/countries (confirmed Nov 2026: DNS-hijacked in Colombia, redirecting to a
// gambling regulator's notice page — the other names and the two raw IPs still answer normally).
// We mirror that resilience: remember which base last worked and start there.
const CANDIDATES = [
  "http://api.myzapptv.com/api/v1/",
  "http://api.zapptv.co/api/v1/",
  "http://api.zapptv.fun/api/v1/",
  // The app's own fallback list also has two raw IP literals; Kino's manifest can't declare a
  // bare IP as a host (only named domains), so they're left out here — the two domain fallbacks
  // above already proved to resolve off the blocked IP range.
];
const BASE_STORAGE_KEY = "lastWorkingBase";

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function orderedCandidates() {
  const cached = kino.storage.get(BASE_STORAGE_KEY);
  const i = cached ? CANDIDATES.indexOf(cached) : -1;
  return i <= 0 ? CANDIDATES : [CANDIDATES[i], ...CANDIDATES.filter((_, n) => n !== i)];
}

/** Transport only: reaching `base` at all. Any failure here (refused host after a hijacked
 * redirect, timeout, non-2xx) means THIS base is bad — try the next one, never the caller's problem. */
async function rawFetch(base, path) {
  const res = await kino.fetch(base + path, { method: "GET", headers: headers(), cookies: false });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return base64ToBytes(res.base64());
}

/** GETs `path` (with query string already appended) against ZappTV's API, trying every known
 * base URL in turn when the preferred one is unreachable, and returns the decoded, decrypted
 * fields. Once a base answers at all, a business-level failure (unwrapEnvelope's kino.error, e.g.
 * ZappTV's own "Error del servidor") is real and is never masked by trying another mirror. */
export async function get(path) {
  for (const base of orderedCandidates()) {
    let bytes;
    try {
      bytes = await rawFetch(base, path);
    } catch (_) {
      continue;
    }
    kino.storage.set(BASE_STORAGE_KEY, base, { ttlMs: 6 * 60 * 60 * 1000 });
    return unwrapEnvelope(bytes); // lets a real kino.error (business code) propagate as-is
  }
  throw kino.error("unavailable", "ZappTV no responde en ninguno de sus servidores");
}
