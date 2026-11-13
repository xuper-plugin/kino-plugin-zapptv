import { get } from "./api.js";
import { repeatedMsg, msg, str, num } from "./proto.js";
import { resInfoToSeriesInfo } from "./mappers.js";

// An episode's `ref` carries both ids resolve() needs: ZappTV's playback call is
// `video/playback/v5?id=<seriesId>&epId=<episodeId>`, but Kino only hands resolve() one opaque
// ref per item — so a series' episode ref is "<seriesId>:<episodeId>"; a movie's ref is just its
// own id (no colon), which resolve() plays with an empty epId.
const episodeRef = (seriesId, episodeId) => `${seriesId}:${episodeId}`;

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

  const series = detailFields ? resInfoToSeriesInfo(msg(detailFields, 1) ?? {}) : undefined;
  return { series, episodes: out };
}
