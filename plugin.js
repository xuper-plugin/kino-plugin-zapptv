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
var LOGO_ASPECT = "banner";

// src/screen/view.js
var twin = (field, es, en) => ({ [field]: es, [field + "En"]: en });
var POLL_MS = 1500;
var SEARCH_CAP = 60;
var TAB_LABEL = { inicio: twin("label", "Inicio", "Home"), peliculas: twin("label", "Pel\xEDculas", "Movies"), series: twin("label", "Series", "Series") };
var brand = { type: "Image", key: "logo", url: LOGO_DATA, aspect: LOGO_ASPECT, fit: "contain", h: 32, alt: "ZappTV", altEn: "ZappTV", fallback: { type: "Text", text: "ZappTV", textEn: "ZappTV", style: "h4" } };
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
