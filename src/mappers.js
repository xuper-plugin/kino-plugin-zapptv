import { str, num, msg, repeatedMsg, repeatedStr } from "./proto.js";

/** ResLiteInfo { resId=1, title=2, posterUrl=3, ..., isSeries=15 (observed; 1 = series, else movie) }. */
export function resLiteInfoToItem(fields) {
  const id = str(fields, 1);
  if (!id) return null;
  return {
    id,
    ref: id,
    title: str(fields, 2, "(sin título)"),
    kind: num(fields, 15) === 1 ? "series" : "movie",
    poster: str(fields, 3) || undefined,
  };
}

/** ResRow { rowId=1, rowName=2, rowType=3, resInfos=6 (repeated ResLiteInfo) } -> a Kino Home row. */
export function resRowToRow(fields, keyPrefix) {
  const items = repeatedMsg(fields, 6).map(resLiteInfoToItem).filter(Boolean);
  if (!items.length) return null;
  return { id: `${keyPrefix}:${num(fields, 1)}`, title: str(fields, 2, ""), items };
}

/** Episode { baseInfo=1 (ResLiteInfo), num=2 }. */
export function episodeToKinoEpisode(fields) {
  const base = msg(fields, 1);
  if (!base) return null;
  return {
    number: num(fields, 2, 1),
    ref: str(base, 1),
    title: str(base, 2) || undefined,
    still: str(base, 3) || undefined,
  };
}

/** ResInfo (ResDetail.baseInfo): the full metadata record, { resId=1, title=2, description=3,
 * category=4, rating=5, releaseYear=6, genres=8 (repeated), posterUrl=11, bgPosterUrl=12,
 * duration=13, totalEpisodes=14, resType=22 }. */
export function resInfoToSeriesInfo(fields) {
  return {
    title: str(fields, 2) || undefined,
    overview: str(fields, 3) || undefined,
    poster: str(fields, 11) || undefined,
    backdrop: str(fields, 12) || undefined,
    genres: repeatedStr(fields, 8).slice(0, 5),
    year: str(fields, 6) || undefined,
    rating: num(fields, 5) || undefined,
    runtimeMinutes: num(fields, 13) || undefined,
  };
}

/** Playback.Stream { url=1, format=2, quality=3, label=4, isLogin=5, vipFlag=6, language=8 }. */
export function streamToKinoStream(fields) {
  const url = str(fields, 1);
  if (!url) return null;
  return {
    url,
    quality: str(fields, 3) || str(fields, 4) || undefined,
    lang: str(fields, 8) || undefined,
  };
}

/** Playback.Subtitle { language=1, label=2, url=4 } (best-effort: field numbers are less certain than Stream's). */
export function subtitleToKinoSubtitle(fields) {
  const url = str(fields, 4);
  if (!url) return null;
  return { lang: str(fields, 1, "und"), url, format: url.endsWith(".srt") ? "srt" : "vtt" };
}
