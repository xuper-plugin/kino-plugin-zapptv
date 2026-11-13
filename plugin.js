// src/device.js
var APP_ID = "f5a8c0603d1f4441a24f81bd1e62c0fa";
var CHANNEL = "S002";
var VER_CODE = "1033";
var VER_NAME = "v1.0.33";
function deviceId() {
  const cached = kino.storage.get("deviceId");
  if (cached) return cached;
  const fresh = kino.crypto.randomBytes(8, "hex");
  kino.storage.set("deviceId", fresh);
  return fresh;
}
function headers() {
  return {
    lang: "es",
    serialId: "unknown",
    "Content-Encoding": "gzip",
    // sent by the real app's OkHttp client even on an empty body
    appId: APP_ID,
    uuid: "",
    verCode: VER_CODE,
    verName: VER_NAME,
    osVerCode: "33",
    osVerName: "13",
    hwBrand: "Kino",
    hwModel: "Kino",
    deviceId: deviceId(),
    mac: "unknown",
    wlanMac: "unknown",
    channel: CHANNEL,
    umid: "unknow",
    // exact value sent by the real app (not a typo we can fix)
    token: "",
    uid: ""
  };
}

// src/proto.js
function decodeMessage(buf) {
  const fields = /* @__PURE__ */ Object.create(null);
  let pos = 0;
  while (pos < buf.length) {
    let tag;
    [tag, pos] = readVarint(buf, pos);
    const fieldNum = tag >>> 3;
    const wireType = tag & 7;
    let value;
    if (wireType === 0) {
      [value, pos] = readVarint(buf, pos);
    } else if (wireType === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      value = buf.subarray(pos, pos + len);
      pos += len;
    } else if (wireType === 1) {
      value = buf.subarray(pos, pos + 8);
      pos += 8;
    } else if (wireType === 5) {
      value = buf.subarray(pos, pos + 4);
      pos += 4;
    } else {
      throw new Error(`unsupported wire type ${wireType} at byte ${pos}`);
    }
    (fields[fieldNum] ?? (fields[fieldNum] = [])).push({ wireType, value });
  }
  return fields;
}
function readVarint(buf, pos) {
  let result = 0, shift = 0, b;
  do {
    if (pos >= buf.length) throw new Error("truncated varint");
    b = buf[pos++];
    result += (b & 127) * 2 ** shift;
    shift += 7;
  } while (b & 128);
  return [result, pos];
}
var utf8 = new TextDecoder("utf-8", { fatal: false });
function str(fields, n, fallback = "") {
  const v = fields[n]?.[0];
  return v && v.wireType === 2 ? utf8.decode(v.value) : fallback;
}
function num(fields, n, fallback = 0) {
  const v = fields[n]?.[0];
  return v && v.wireType === 0 ? v.value : fallback;
}
function msg(fields, n) {
  const v = fields[n]?.[0];
  return v && v.wireType === 2 ? decodeMessage(v.value) : null;
}
function repeatedMsg(fields, n) {
  return (fields[n] ?? []).filter((v) => v.wireType === 2).map((v) => decodeMessage(v.value));
}
function repeatedStr(fields, n) {
  return (fields[n] ?? []).filter((v) => v.wireType === 2).map((v) => utf8.decode(v.value));
}

// src/crypto.js
function unwrapEnvelope(bodyBytes) {
  const env = decodeMessage(bodyBytes);
  const code = num(env, 1);
  if (code !== 200) {
    const message = str(env, 2, "");
    throw kino.error("unavailable", message || `ZappTV respondi\xF3 el c\xF3digo ${code}`);
  }
  const dataField = env[3]?.[0];
  if (!dataField) return decodeMessage(new Uint8Array(0));
  const plainB64 = new TextDecoder("utf-8").decode(dataField.value);
  const plainHex = kino.crypto.decrypt("aes-128-ecb", {
    key: kino.secret("aesKey"),
    data: plainB64,
    inputEncoding: "base64",
    // The plaintext is itself binary protobuf, not text: ask for hex back, never utf8 (lossy for
    // non-ASCII bytes — this bit us once already, in the dev capture's own JSON trace log).
    outputEncoding: "hex"
  });
  if (typeof plainHex !== "string") throw kino.error("unavailable", "ZappTV: no se pudo descifrar la respuesta");
  return decodeMessage(hexToBytes(plainHex));
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// src/api.js
var CANDIDATES = [
  "http://api.myzapptv.com/api/v1/",
  "http://api.zapptv.co/api/v1/",
  "http://api.zapptv.fun/api/v1/"
  // The app's own fallback list also has two raw IP literals; Kino's manifest can't declare a
  // bare IP as a host (only named domains), so they're left out here — the two domain fallbacks
  // above already proved to resolve off the blocked IP range.
];
var BASE_STORAGE_KEY = "lastWorkingBase";
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
async function rawFetch(base, path) {
  const res = await kino.fetch(base + path, { method: "GET", headers: headers(), cookies: false });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return base64ToBytes(res.base64());
}
async function get(path) {
  for (const base of orderedCandidates()) {
    let bytes;
    try {
      bytes = await rawFetch(base, path);
    } catch (_) {
      continue;
    }
    kino.storage.set(BASE_STORAGE_KEY, base, { ttlMs: 6 * 60 * 60 * 1e3 });
    return unwrapEnvelope(bytes);
  }
  throw kino.error("unavailable", "ZappTV no responde en ninguno de sus servidores");
}

// src/mappers.js
function resLiteInfoToItem(fields) {
  const id = str(fields, 1);
  if (!id) return null;
  return {
    id,
    ref: id,
    title: str(fields, 2, "(sin t\xEDtulo)"),
    kind: num(fields, 15) === 1 ? "series" : "movie",
    poster: str(fields, 3) || void 0
  };
}
function resInfoToSeriesInfo(fields) {
  return {
    title: str(fields, 2) || void 0,
    overview: str(fields, 3) || void 0,
    poster: str(fields, 11) || void 0,
    backdrop: str(fields, 12) || void 0,
    genres: repeatedStr(fields, 8).slice(0, 5),
    year: str(fields, 6) || void 0,
    rating: num(fields, 5) || void 0,
    runtimeMinutes: num(fields, 13) || void 0
  };
}
function streamToKinoStream(fields) {
  const url = str(fields, 1);
  if (!url) return null;
  return {
    url,
    quality: str(fields, 3) || str(fields, 4) || void 0,
    lang: str(fields, 8) || void 0
  };
}
function subtitleToKinoSubtitle(fields) {
  const url = str(fields, 4);
  if (!url) return null;
  return { lang: str(fields, 1, "und"), url, format: url.endsWith(".srt") ? "srt" : "vtt" };
}

// src/catalog.js
async function listBlocks() {
  const fields = await get("blocks");
  return repeatedMsg(fields, 1).map((b) => ({
    id: num(b, 1),
    name: str(b, 2),
    type: str(b, 3),
    style: str(b, 5)
    // "full_scroll" (FullScrollBlock: carousels=1, resRows=2) or "half_scroll" (HalfScrollBlock: resRows=1)
  }));
}
function rowsOf(fields, style, limit) {
  const rowsField = style === "full_scroll" ? 2 : 1;
  const out = [];
  for (const row of repeatedMsg(fields, rowsField)) {
    const items = [];
    for (const r of repeatedMsg(row, 6)) {
      if (items.length >= limit) break;
      const it = resLiteInfoToItem(r);
      if (it) items.push(it);
    }
    if (items.length) out.push({ name: str(row, 2, ""), items });
  }
  return out;
}
var safeId = (s) => String(s).replace(/[^A-Za-z0-9._~-]/g, "_").slice(0, 100) || "row";
var HOME_ROWS_PER_BLOCK = 2;
var HOME_ITEMS_PER_ROW = 20;
var BROWSE_ITEMS_PER_ROW = 300;
async function home() {
  const blocks = await listBlocks();
  const out = [];
  for (const b of blocks) {
    if (!b.type) continue;
    let rows;
    try {
      rows = rowsOf(await get(`block/${encodeURIComponent(b.type)}`), b.style, HOME_ITEMS_PER_ROW);
    } catch (_) {
      continue;
    }
    rows.slice(0, HOME_ROWS_PER_BLOCK).forEach((r, i) => {
      out.push({ id: `${safeId(b.type)}-${i}`, title: r.name || b.name, items: r.items, ref: b.type });
    });
  }
  return out;
}
async function browse(ref, _cursor) {
  const blocks = await listBlocks();
  const block = blocks.find((b) => b.type === ref);
  const rows = rowsOf(await get(`block/${encodeURIComponent(ref)}`), block?.style, BROWSE_ITEMS_PER_ROW);
  return { items: rows.flatMap((r) => r.items) };
}

// src/search.js
var PAGE_SIZE = 20;
async function search(query) {
  const q = typeof query?.q === "string" ? query.q.trim() : "";
  if (!q) return [];
  const index = Number.isFinite(Number(query?.cursor)) ? Number(query.cursor) : 0;
  const path = `search?keyword=${encodeURIComponent(q)}&queryType=1&index=${index}&count=${PAGE_SIZE}&category=`;
  const fields = await get(path);
  return repeatedMsg(fields, 3).map(resLiteInfoToItem).filter(Boolean);
}

// src/episodes.js
var episodeRef = (seriesId, episodeId) => `${seriesId}:${episodeId}`;
async function episodes(ref) {
  const seriesId = String(ref).split(":")[0];
  const [episodesFields, detailFields] = await Promise.all([
    get(`video/episodes?id=${encodeURIComponent(seriesId)}`),
    get(`video/detail?id=${encodeURIComponent(seriesId)}`).catch(() => null)
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
      title: str(base, 2) || void 0,
      still: str(base, 3) || void 0
    });
  }
  const series = detailFields ? resInfoToSeriesInfo(msg(detailFields, 1) ?? {}) : void 0;
  return { series, episodes: out };
}

// src/resolve.js
async function resolve(ref, _options) {
  const [id, epId] = String(ref).split(":");
  if (!id) throw kino.error("not_found", "referencia de ZappTV inv\xE1lida");
  const path = `video/playback/v5?id=${encodeURIComponent(id)}&epId=${encodeURIComponent(epId || "")}&resume=false&audioLang=`;
  const fields = await get(path);
  const streams = repeatedMsg(fields, 6).map(streamToKinoStream).filter(Boolean);
  if (!streams.length) throw kino.error("not_found", "ZappTV no tiene un stream para este t\xEDtulo");
  const subtitles = repeatedMsg(fields, 2).map(subtitleToKinoSubtitle).filter(Boolean);
  const [best, ...rest] = streams;
  return {
    ...best,
    mime: best.url.includes(".m3u8") ? "application/x-mpegURL" : void 0,
    subtitles: subtitles.length ? subtitles : void 0,
    alternatives: rest.length ? rest.map((s) => ({ ...s, mime: s.url.includes(".m3u8") ? "application/x-mpegURL" : void 0 })) : void 0
  };
}
export {
  browse,
  episodes,
  home,
  resolve,
  search
};
