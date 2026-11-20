import { get } from "./api.js";
import { repeatedMsg, msg, str, num } from "./proto.js";
import { resInfoToSeriesInfo, parseSeason } from "./mappers.js";
import { searchRaw } from "./search.js";

// An episode's `ref` carries both ids resolve() needs: ZappTV's playback call is
// `video/playback/v5?id=<seriesId>&epId=<episodeId>`, but Kino only hands resolve() one opaque
// ref per item — so a series' episode ref is "<seriesId>:<episodeId>"; a movie's ref is just its
// own id (no colon), which resolve() plays with an empty epId.
const episodeRef = (seriesId, episodeId) => `${seriesId}:${episodeId}`;

/** ZappTV keeps each season as its OWN series item ("<base> Temporada N"), with no sibling list in its
 * detail — the only thing that ties them is the shared base title. So we find the other seasons by
 * searching that base title and hand Kino the `seasons` list, which turns the separate items into one
 * series with a season selector. Returns undefined when this title has no "Temporada N" (a lone series). */
async function seasonsFor(seriesId, title) {
  const here = parseSeason(title);
  if (!here) return { seasons: undefined, baseTitle: undefined };
  const base = here.base;
  const byId = new Map();
  try {
    for (const it of await searchRaw({ q: base })) {
      if (it.kind !== "series") continue;
      const p = parseSeason(it.title);
      if (p && p.base.toLowerCase() === base.toLowerCase()) {
        byId.set(String(it.id), { id: String(it.id), ref: String(it.ref), title: `Temporada ${p.number}`, number: p.number });
      }
    }
  } catch (_) { /* search down: still show this season's episodes, just without the selector */ }
  if (!byId.has(seriesId)) byId.set(seriesId, { id: seriesId, ref: seriesId, title: `Temporada ${here.number}`, number: here.number });
  const seasons = [...byId.values()].map((s) => ({ ...s, current: s.id === seriesId })).sort((a, b) => a.number - b.number).slice(0, 50);
  return { seasons: seasons.length > 1 ? seasons : undefined, baseTitle: base };
}

export async function episodes(ref) {
  const seriesId = String(ref).split(":")[0];
  const [episodesFields, detailFields] = await Promise.all([
    get(`video/episodes?id=${encodeURIComponent(seriesId)}`),
    get(`video/detail?id=${encodeURIComponent(seriesId)}`).catch(() => null),
  ]);

  const out = [];
  let n = 1;
  for (const epFields of repeatedMsg(episodesFields, 1)) {
    const base = msg(epFields, 1);
    if (!base) continue;
    const episodeId = str(base, 1);
    if (!episodeId) continue;
    out.push({
      number: num(epFields, 2, n++),
      ref: episodeRef(seriesId, episodeId),
      title: str(base, 2) || undefined,
      still: str(base, 3) || undefined,
    });
  }

  let series = detailFields ? resInfoToSeriesInfo(msg(detailFields, 1) ?? {}) : undefined;
  const { seasons, baseTitle } = await seasonsFor(seriesId, series && series.title);
  if (series && baseTitle) series = { ...series, title: baseTitle }; // show the show's name, not "… Temporada 1"
  return { series, episodes: out, ...(seasons ? { seasons } : {}) };
}
