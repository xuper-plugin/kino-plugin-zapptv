import { get } from "./api.js";
import { repeatedMsg } from "./proto.js";
import { resLiteInfoToItem, parseSeason } from "./mappers.js";

const PAGE_SIZE = 20;

/** ZappTV returns each season as a separate "<base> Temporada N" result. Collapse them into one series
 * (the lowest season as the entry point, titled with the show's name); episodes() then shows the season
 * selector. Non-series and single-season titles pass through untouched. */
function collapseSeasons(items) {
  const out = [];
  const at = new Map(); // base title (lowercased) -> index in out
  for (const it of items) {
    const p = it.kind === "series" ? parseSeason(it.title) : null;
    if (!p) { out.push(it); continue; }
    const key = p.base.toLowerCase();
    if (at.has(key)) {
      const i = at.get(key);
      if (p.number < out[i]._s) out[i] = { ...it, title: p.base, _s: p.number }; // keep the earliest season
      continue;
    }
    at.set(key, out.length);
    out.push({ ...it, title: p.base, _s: p.number });
  }
  for (const o of out) delete o._s;
  return out;
}

/** The raw ZappTV search (each season still its own "<base> Temporada N" item). episodes() uses this to
 * discover a show's seasons; the public search() collapses them. */
export async function searchRaw(query) {
  const q = typeof query?.q === "string" ? query.q.trim() : "";
  if (!q) return [];
  const index = Number.isFinite(Number(query?.cursor)) ? Number(query.cursor) : 0;
  const path =
    `search?keyword=${encodeURIComponent(q)}&queryType=1&index=${index}&count=${PAGE_SIZE}&category=`;
  const fields = await get(path);
  // SearchResults { keyword=1, page=2, results=3 (repeated ResLiteInfo), category=4 }
  return repeatedMsg(fields, 3).map(resLiteInfoToItem).filter(Boolean);
}

export async function search(query) {
  return collapseSeasons(await searchRaw(query));
}
