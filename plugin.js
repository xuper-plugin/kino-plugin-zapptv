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
function resInfoToSlide(fields) {
  const id = str(fields, 1);
  const image = str(fields, 12) || str(fields, 11);
  const text = str(fields, 3);
  if (!id || !image || !text) return null;
  return {
    id,
    ref: id,
    kind: num(fields, 14) > 1 ? "series" : "movie",
    // totalEpisodes > 1 => series
    title: str(fields, 2, "(sin t\xEDtulo)"),
    image,
    text: text.length <= 160 ? text : `${text.slice(0, 159).trimEnd()}\u2026`
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
function slidesOf(fields, style, limit) {
  if (style !== "full_scroll") return [];
  const out = [];
  for (const c of repeatedMsg(fields, 1)) {
    if (out.length >= limit) break;
    const s = resInfoToSlide(c);
    if (s) out.push(s);
  }
  return out;
}
var safeId = (s) => String(s).replace(/[^A-Za-z0-9._~-]/g, "_").slice(0, 100) || "row";
var HOME_BLOCKS_LIMIT = 6;
var HOME_ROWS_PER_BLOCK = 2;
var HOME_ITEMS_PER_ROW = 20;
var BROWSE_ITEMS_PER_ROW = 300;
var TAB_ROWS_LIMIT = 10;
var TAB_ITEMS_PER_ROW = 20;
var TAB_SLIDES_LIMIT = 6;
async function home() {
  const blocks = (await listBlocks()).filter((b) => b.type).slice(0, HOME_BLOCKS_LIMIT);
  const fetched = await Promise.all(blocks.map(async (b) => {
    try {
      return { b, rows: rowsOf(await get(`block/${encodeURIComponent(b.type)}`), b.style, HOME_ITEMS_PER_ROW) };
    } catch (_) {
      return null;
    }
  }));
  const out = [];
  for (const f of fetched) {
    if (!f) continue;
    f.rows.slice(0, HOME_ROWS_PER_BLOCK).forEach((r, i) => {
      out.push({ id: `${safeId(f.b.type)}-${i}`, title: r.name || f.b.name, items: r.items, ref: f.b.type });
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
async function tabPage(blockType) {
  const blocks = await listBlocks();
  const block = blocks.find((b) => b.type === blockType);
  const fields = await get(`block/${encodeURIComponent(blockType)}`);
  const rows = rowsOf(fields, block?.style, TAB_ITEMS_PER_ROW).slice(0, TAB_ROWS_LIMIT);
  return {
    slides: slidesOf(fields, block?.style, TAB_SLIDES_LIMIT),
    rows: rows.map((r, i) => ({ id: `${safeId(blockType)}-${i}`, title: r.name, items: r.items, ref: blockType }))
  };
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

// src/screen/model.js
var TAB_IDS = ["inicio", "peliculas", "series"];
var BLOCK_OF = { inicio: "HomeES", peliculas: "MoviesES", series: "SeriesES" };
var HTTP = /^https?:\/\//;
var httpsImage = (url) => HTTP.test(url) ? `https://images.weserv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ""))}` : void 0;
function cardOf(item) {
  const out = { id: item.id, ref: item.ref, title: item.title, kind: item.kind };
  if (item.poster) {
    const u = httpsImage(item.poster);
    if (u) out.poster = u;
  }
  if (item.backdrop) {
    const u = httpsImage(item.backdrop);
    if (u) out.backdrop = u;
  }
  return out;
}

// src/screen/logo.js
var LOGO_DATA = "data:image/png;base64,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";
var LOGO_ASPECT = "1:1";

// src/screen/view.js
var twin = (field, es, en) => ({ [field]: es, [field + "En"]: en });
var POLL_MS = 1500;
var SEARCH_CAP = 60;
var TAB_LABEL = { inicio: twin("label", "Inicio", "Home"), peliculas: twin("label", "Pel\xEDculas", "Movies"), series: twin("label", "Series", "Series") };
var logo = { type: "Image", key: "logo", url: LOGO_DATA, aspect: LOGO_ASPECT, fit: "contain", h: 24, alt: "ZappTV", altEn: "ZappTV", fallback: { type: "Text", text: "ZappTV", textEn: "ZappTV", style: "h4" } };
var name = { type: "Text", text: "ZappTV", textEn: "ZappTV", style: "h4" };
var brand = { type: "Row", key: "brand", gap: 8, crossAxisAlignment: "center", children: [logo, name] };
var railSkeleton = (n) => ({
  type: "Column",
  key: "skel" + n,
  gap: 8,
  children: [
    { type: "Skeleton", shape: "line", width: 120 },
    { type: "Row", gap: 12, sizes: ["compact"], children: [1, 2, 3].map((i) => ({ type: "Skeleton", shape: "card", key: `sk${n}c${i}`, flex: 1 })) },
    { type: "Row", gap: 12, sizes: ["medium", "expanded"], children: [1, 2, 3, 4, 5, 6].map((i) => ({ type: "Skeleton", shape: "card", key: `sk${n}w${i}`, flex: 1 })) }
  ]
});
var heroSkeleton = () => ({ type: "Skeleton", key: "heroSkeleton", shape: "block", height: { compact: 200, expanded: 320 } });
var slideNode = (s) => ({
  type: "heroCard",
  key: "slide-" + s.id,
  h: { compact: 200, expanded: 240 },
  title: s.title,
  titleEn: s.title,
  text: s.text,
  textEn: s.text,
  image: httpsImage(s.image),
  buttons: [
    {
      type: "ElevatedButton",
      key: "watch-" + s.id,
      ...twin("labelText", "Ver", "Watch"),
      icon: "play",
      onPressed: { go: { play: { ref: s.ref, kind: s.kind, id: s.id, title: s.title } } }
    },
    {
      type: "TextButton",
      key: "info-" + s.id,
      ...twin("labelText", "M\xE1s info", "More info"),
      onPressed: { go: { title: { ref: s.ref, kind: s.kind, id: s.id, title: s.title } } }
    }
  ]
});
var hero = (slides) => slides.length === 1 ? slideNode(slides[0]) : { type: "PageView", key: "hero" + slides.length, autoPlayMs: 6e3, children: slides.map(slideNode) };
var cardNode = (c, size, scope) => ({ type: "titleCard", key: `${scope}-${c.id}`, size, item: cardOf(c) });
var cardRow = (items, key) => ({ type: "SingleChildScrollView", key: key + "-s", direction: "horizontal", children: [{ type: "Row", key: key + "-r", gap: 12, children: items.map((c) => cardNode(c, "medium", key)) }] });
var cardGrid = (items, key) => ({ type: "GridView", key, columns: { compact: 3, expanded: 6 }, children: items.map((c) => cardNode(c, "medium", key)) });
var rail = (r, key) => ({
  type: "Column",
  key,
  gap: 8,
  children: [
    { type: "Row", key: key + "-h", crossAxisAlignment: "center", children: [
      { type: "Text", style: "h4", flex: 1, text: r.title, textEn: r.title },
      ...r.ref ? [{ type: "TextButton", key: key + "-more", ...twin("labelText", "Ver m\xE1s", "See more"), onPressed: { go: { browse: { ref: r.ref, title: r.title } } } }] : []
    ] },
    cardRow(r.items, key)
  ]
});
var tabBar = (active) => ({ type: "TabBar", key: "tabs", divider: false, value: active, onChanged: "tab", tabs: TAB_IDS.map((id) => ({ value: id, ...TAB_LABEL[id] })) });
function browseView({ tab, data, pending, failed, device = "phone" }) {
  const tv = device === "tv";
  const active = TAB_IDS.includes(tab) ? tab : TAB_IDS[0];
  const body = [];
  if (data) {
    if (data.slides.length > 0) body.push(hero(data.slides));
    for (const r of data.rows) body.push(rail(r, "rail-" + String(r.id).replace(/[^A-Za-z0-9_-]/g, "_")));
    if (data.rows.length === 0) body.push({ type: "Text", text: "Sin contenido por ahora.", textEn: "Nothing here yet.", color: "muted" });
  } else if (failed) {
    body.push({
      type: "MaterialBanner",
      key: "loadFailed",
      role: "error",
      text: "ZappTV no respondi\xF3.",
      textEn: "ZappTV didn't answer.",
      action: { label: "Reintentar", labelEn: "Retry", onTap: "retry" }
    });
  } else {
    body.push(heroSkeleton(), railSkeleton(1), railSkeleton(2), railSkeleton(3));
  }
  const isBanner = (n) => !!n && (n.type === "heroCard" || n.key === "heroSkeleton" || n.type === "PageView" && String(n.key).startsWith("hero"));
  const banner = body.length > 0 && isBanner(body[0]) ? body.shift() : null;
  const searchAction = { type: "IconButton", key: "searchButton", icon: "search", ...twin("labelText", "Buscar", "Search"), onPressed: "openSearch" };
  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar",
      mergeWithKinoBar: true,
      dense: true,
      divider: false,
      leading: { type: "IconButton", key: "close", icon: "close", ...twin("labelText", "Cerrar", "Close"), onPressed: { go: { close: true } } },
      title: tv ? { type: "Row", key: "titleRow", gap: 24, crossAxisAlignment: "center", children: [brand, tabBar(active)] } : brand,
      ...tv ? { actions: [searchAction] } : {}
    },
    ...tv ? {} : { floatingActionButton: { type: "FloatingActionButton", key: "searchFab", icon: "search", ...twin("labelText", "Buscar", "Search"), onPressed: "openSearch" } },
    body: { type: "Column", key: "page", children: [
      ...tv ? [] : [{ type: "Column", key: "tabsRow", padding: { compact: 0, expanded: 24 }, children: [tabBar(active)] }],
      { type: "SingleChildScrollView", key: "browse-" + active, flex: 1, children: [...banner ? [banner] : [], { type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: body }] }
    ] },
    ...pending ? { every: { ms: POLL_MS, event: "tick" } } : {}
  };
}
function searchView({ query, status, items, device = "phone" }) {
  const tv = device === "tv";
  const searchForm = () => ({
    type: "Form",
    key: "searchForm",
    onSubmitted: "search",
    gap: 8,
    children: tv ? [{ type: "Row", key: "searchRow", gap: 16, crossAxisAlignment: "center", children: [
      { type: "TextField", key: "q", kind: "text", value: query, ...twin("labelText", "Buscar en ZappTV", "Search ZappTV"), maxLength: 100, autofocus: true, weight: 1 },
      { type: "ElevatedButton", key: "searchGo", ...twin("labelText", "Buscar", "Search"), icon: "search", submit: true }
    ] }] : [
      { type: "TextField", key: "q", kind: "text", value: query, ...twin("labelText", "Buscar en ZappTV", "Search ZappTV"), maxLength: 100, autofocus: true },
      { type: "ElevatedButton", key: "searchGo", ...twin("labelText", "Buscar", "Search"), icon: "search", submit: true }
    ]
  });
  const body = tv ? [] : [searchForm()];
  if (status === "fail") {
    body.push({ type: "MaterialBanner", key: "searchFailed", role: "error", text: "La b\xFAsqueda fall\xF3.", textEn: "Search failed.", action: { label: "Reintentar", labelEn: "Retry", onTap: "sretry" } });
  } else if (status === "done" && items) {
    body.push(items.length === 0 ? { type: "Text", text: "Sin resultados.", textEn: "No results.", color: "muted" } : cardGrid(items.slice(0, SEARCH_CAP), "results"));
  } else if (status !== "idle") {
    body.push({ type: "Skeleton", shape: "block", height: 200, key: "searchSkeleton" });
  }
  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar",
      mergeWithKinoBar: true,
      dense: true,
      divider: false,
      leading: { type: "IconButton", key: "back", icon: "arrow_back", ...twin("labelText", "Atr\xE1s", "Back"), onPressed: "back" },
      ...tv ? { title: searchForm() } : { title: { type: "Text", text: "Buscar", textEn: "Search", style: "h4" } }
    },
    body: { type: "SingleChildScrollView", key: "search-page", children: [{ type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: body }] },
    ...status === "loading" ? { every: { ms: 1e3, event: "stick" } } : {}
  };
}

// src/screen/index.js
var TAB_KEY = "screenTab";
var SNAP_PREFIX = "screenTab1:";
var SNAP_TTL_MS = 24 * 3600 * 1e3;
var SNAP_MAX = 20 * 1024;
function makeScreen({ kino: kino2, tabPage: tabPage2, search: search2 }) {
  const memo = /* @__PURE__ */ new Map();
  const get2 = (k) => {
    try {
      return kino2.storage.get(k);
    } catch (_) {
      return null;
    }
  };
  const set = (k, v, opts) => {
    try {
      kino2.storage.set(k, v, opts);
    } catch (_) {
    }
  };
  const log = (...a) => {
    try {
      kino2.log("[zapptv]", ...a);
    } catch (_) {
    }
  };
  function readSnap(tab) {
    try {
      const o = JSON.parse(get2(SNAP_PREFIX + tab) || "null");
      return o && Date.now() - o.at < SNAP_TTL_MS && o.data && Array.isArray(o.data.rows) ? o.data : null;
    } catch (_) {
      return null;
    }
  }
  function writeSnap(tab, data) {
    for (let per = 10; per >= 3; per -= 2) {
      const slim = { slides: data.slides, rows: data.rows.map((r) => ({ ...r, items: r.items.slice(0, per) })) };
      const text = JSON.stringify({ at: Date.now(), data: slim });
      if (text.length <= SNAP_MAX) {
        set(SNAP_PREFIX + tab, text, { ttlMs: SNAP_TTL_MS });
        return;
      }
    }
  }
  const stored = () => {
    const t = get2(TAB_KEY);
    return TAB_IDS.includes(t) ? t : null;
  };
  const remember = (tab) => set(TAB_KEY, tab);
  function dataOf(tab) {
    if (memo.has(tab)) return memo.get(tab).data;
    const snap = readSnap(tab);
    if (snap) {
      memo.set(tab, { data: snap, whole: false });
      return snap;
    }
    return null;
  }
  async function load(tab) {
    const data = await tabPage2(BLOCK_OF[tab]);
    if (data && data.rows.length) {
      memo.set(tab, { data, whole: true });
      writeSnap(tab, data);
      return true;
    }
    return false;
  }
  function needed(tab, device) {
    const order = [tab, ...TAB_IDS.filter((t) => t !== tab)];
    return order.filter((t, i) => (i === 0 || device !== "tv") && !(memo.get(t) && memo.get(t).whole));
  }
  let found = null;
  function view(ctx) {
    const st = ctx.state && typeof ctx.state === "object" ? ctx.state : {};
    if (ctx.route && ctx.route.name === "search") {
      const query = typeof st.sq === "string" ? st.sq : "";
      const items = found && found.q === query ? found.items : null;
      const status = query === "" ? "idle" : st.sstate === "fail" ? "fail" : items ? "done" : "loading";
      return searchView({ query, status, items, device: ctx.device });
    }
    const tab = TAB_IDS.includes(st.tab) ? st.tab : stored() ?? TAB_IDS[0];
    const data = dataOf(tab);
    const pending = Array.isArray(st.pending) && st.pending.length > 0;
    return browseView({ tab, data, pending, failed: !!(st.failed && st.failed[tab]), device: ctx.device });
  }
  const events = {
    open({ state, device }) {
      const tab = TAB_IDS.includes(state.tab) ? state.tab : stored() ?? TAB_IDS[0];
      for (const t of TAB_IDS) dataOf(t);
      return { state: { tab, pending: needed(tab, device), failed: null } };
    },
    tab({ value, arg, state }) {
      const tab = TAB_IDS.includes(value) ? value : TAB_IDS.includes(arg) ? arg : null;
      if (!tab) return null;
      remember(tab);
      dataOf(tab);
      const failed = { ...state.failed || {} };
      delete failed[tab];
      const pending = [tab, ...Array.isArray(state.pending) ? state.pending.filter((t) => t !== tab) : []];
      return { state: { tab, pending: memo.get(tab) && memo.get(tab).whole ? pending.slice(1) : pending, failed } };
    },
    retry({ state, device }) {
      const tab = TAB_IDS.includes(state.tab) ? state.tab : TAB_IDS[0];
      return { state: { failed: null, pending: [tab, ...needed(tab, device).filter((t) => t !== tab)] } };
    },
    async tick({ state }) {
      const pending = Array.isArray(state.pending) ? state.pending : [];
      if (pending.length === 0) return null;
      const [next, ...rest] = pending;
      const failed = { ...state.failed || {} };
      try {
        const ok = await load(next);
        if (!ok) failed[next] = true;
        else delete failed[next];
      } catch (e) {
        log("tab_fail", e && e.code || "error");
        failed[next] = true;
      }
      return { state: { pending: rest, failed } };
    },
    openSearch() {
      return { route: { push: "search" }, state: { sq: "", sstate: null } };
    },
    search({ value, route }) {
      const q = value && typeof value.q === "string" ? value.q.trim().slice(0, 100) : "";
      if (q === "") return null;
      const state = { sq: q, sstate: "loading" };
      return route && route.name === "search" ? { state } : { route: { push: "search" }, state };
    },
    async stick({ state }) {
      const q = typeof state.sq === "string" ? state.sq : "";
      if (q === "" || state.sstate !== "loading") return null;
      try {
        const out = await search2({ q });
        found = { q, items: (Array.isArray(out) ? out : []).slice(0, 60) };
        return { state: { sstate: "done" } };
      } catch (e) {
        log("search_fail", e && e.code || "error");
        return { state: { sstate: "fail" } };
      }
    },
    sretry({ state }) {
      return typeof state.sq === "string" && state.sq !== "" ? { state: { sstate: "loading" } } : null;
    },
    back() {
      return { route: { pop: true }, state: { sq: null, sstate: null } };
    }
  };
  async function event(ev) {
    const handler = Object.hasOwn(events, ev.name) ? events[ev.name] : null;
    return handler ? await handler({ ...ev, state: ev.state || {} }) ?? null : null;
  }
  return { view, event };
}

// src/plugin.js
var screenInstance = null;
var getScreen = () => screenInstance ?? (screenInstance = makeScreen({ kino, tabPage, search }));
async function screen(ctx) {
  await null;
  return getScreen().view(ctx && typeof ctx === "object" ? ctx : {});
}
async function screenEvent(ev) {
  await null;
  return getScreen().event(ev && typeof ev === "object" ? ev : {});
}
async function settingsStatus() {
  await null;
  let base = "";
  try {
    base = kino.storage.get("lastWorkingBase") || "";
  } catch (_) {
    base = "";
  }
  const host = base ? new URL(base).hostname : null;
  return { status: host ? `Conectado a ${host}` : "Sin conexi\xF3n reciente a ZappTV" };
}
export {
  browse,
  episodes,
  home,
  resolve,
  screen,
  screenEvent,
  search,
  settingsStatus
};
