import { home, browse, tabPage } from "./catalog.js";
import { search } from "./search.js";
import { episodes } from "./episodes.js";
import { resolve } from "./resolve.js";
import { makeScreen } from "./screen/index.js";

export { home, browse, search, episodes, resolve };

// ---------- the screen (Kino apiVersion 14, offered through the manifest's enhancements."14") ----------
// Below that apiVersion Kino never calls these; the plugin stays fully usable through home/search/
// browse/episodes/resolve alone (Kino's own generic catalog screens).
let screenInstance = null;
const getScreen = () => (screenInstance ??= makeScreen({ kino, tabPage, search }));

export async function screen(ctx) {
  await null;
  return getScreen().view(ctx && typeof ctx === "object" ? ctx : {});
}

export async function screenEvent(ev) {
  await null;
  return getScreen().event(ev && typeof ev === "object" ? ev : {});
}

// ---------- settings (the "status" field) ----------
export async function settingsStatus() {
  await null;
  let base = "";
  try { base = kino.storage.get("lastWorkingBase") || ""; } catch (_) { base = ""; }
  const host = base ? new URL(base).hostname : null;
  return { status: host ? `Conectado a ${host}` : "Sin conexión reciente a ZappTV" };
}
