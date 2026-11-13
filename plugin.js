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
