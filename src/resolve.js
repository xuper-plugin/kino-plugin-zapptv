import { get } from "./api.js";
import { repeatedMsg } from "./proto.js";
import { streamToKinoStream, subtitleToKinoSubtitle } from "./mappers.js";

export async function resolve(ref, _options) {
  const [id, epId] = String(ref).split(":");
  if (!id) throw kino.error("not_found", "referencia de ZappTV inválida");
  const path = `video/playback/v5?id=${encodeURIComponent(id)}&epId=${encodeURIComponent(epId || "")}&resume=false&audioLang=`;
  const fields = await get(path);

  // Playback { streams=6 (repeated Stream), subtitles=2 (repeated Subtitle) }
  const streams = repeatedMsg(fields, 6).map(streamToKinoStream).filter(Boolean);
  if (!streams.length) throw kino.error("not_found", "ZappTV no tiene un stream para este título");
  const subtitles = repeatedMsg(fields, 2).map(subtitleToKinoSubtitle).filter(Boolean);

  const [best, ...rest] = streams;
  return {
    ...best,
    mime: best.url.includes(".m3u8") ? "application/x-mpegURL" : undefined,
    subtitles: subtitles.length ? subtitles : undefined,
    alternatives: rest.length ? rest.map((s) => ({ ...s, mime: s.url.includes(".m3u8") ? "application/x-mpegURL" : undefined })) : undefined,
  };
}
