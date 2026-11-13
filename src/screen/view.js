// The screen's trees: a pure view of what index.js holds. A tab not in yet draws skeletons shaped
// like what replaces them, so nothing jumps when the rows arrive. Every text is bilingual.
import { TAB_IDS, cardOf, httpsImage } from "./model.js";
import { LOGO_DATA, LOGO_ASPECT } from "./logo.js";

const twin = (field, es, en) => ({ [field]: es, [field + "En"]: en });
const POLL_MS = 1500;
const SEARCH_CAP = 60;
const TAB_LABEL = { inicio: twin("label", "Inicio", "Home"), peliculas: twin("label", "Películas", "Movies"), series: twin("label", "Series", "Series") };

// The brand shown in the merged bar, like UltraHD's "[UHD] Ultra Hd": the plugin's logo next to its
// name. The logo is an inline data: PNG (no network), with the name as its fallback for a Kino that
// cannot draw it.
const logo = { type: "Image", key: "logo", url: LOGO_DATA, aspect: LOGO_ASPECT, fit: "contain", h: 32, alt: "ZappTV", altEn: "ZappTV", fallback: { type: "Text", text: "ZappTV", textEn: "ZappTV", style: "h4" } };
const name = { type: "Text", text: "ZappTV", textEn: "ZappTV", style: "h4" };
const brand = { type: "Row", key: "brand", gap: 8, crossAxisAlignment: "center", children: [logo, name] };

const railSkeleton = (n) => ({
  type: "Column", key: "skel" + n, gap: 8, children: [
    { type: "Skeleton", shape: "line", width: 120 },
    { type: "Row", gap: 12, sizes: ["compact"], children: [1, 2, 3].map((i) => ({ type: "Skeleton", shape: "card", key: `sk${n}c${i}`, flex: 1 })) },
    { type: "Row", gap: 12, sizes: ["medium", "expanded"], children: [1, 2, 3, 4, 5, 6].map((i) => ({ type: "Skeleton", shape: "card", key: `sk${n}w${i}`, flex: 1 })) },
  ],
});
const heroSkeleton = () => ({ type: "Skeleton", key: "heroSkeleton", shape: "block", height: { compact: 200, expanded: 320 } });

const slideNode = (s) => ({
  type: "heroCard", key: "slide-" + s.id, h: { compact: 200, expanded: 240 }, title: s.title, titleEn: s.title, text: s.text, textEn: s.text, image: httpsImage(s.image),
  buttons: [
    { type: "ElevatedButton", key: "watch-" + s.id, ...twin("labelText", "Ver", "Watch"), icon: "play",
      onPressed: { go: { play: { ref: s.ref, kind: s.kind, id: s.id, title: s.title } } } },
    { type: "TextButton", key: "info-" + s.id, ...twin("labelText", "Más info", "More info"),
      onPressed: { go: { title: { ref: s.ref, kind: s.kind, id: s.id, title: s.title } } } },
  ],
});
// The key carries the slide count: Kino's pager keeps it from its first draw, so a count change needs a new key.
const hero = (slides) => (slides.length === 1 ? slideNode(slides[0]) : { type: "PageView", key: "hero" + slides.length, autoPlayMs: 6000, children: slides.map(slideNode) });

const cardNode = (c, size, scope) => ({ type: "titleCard", key: `${scope}-${c.id}`, size, item: cardOf(c) }); // no onTap: opens Kino's own native title page
const cardRow = (items, key) => ({ type: "SingleChildScrollView", key: key + "-s", direction: "horizontal", children: [{ type: "Row", key: key + "-r", gap: 12, children: items.map((c) => cardNode(c, "medium", key)) }] });
const cardGrid = (items, key) => ({ type: "GridView", key, columns: { compact: 3, expanded: 6 }, children: items.map((c) => cardNode(c, "medium", key)) });

const rail = (r, key) => ({
  type: "Column", key, gap: 8, children: [
    { type: "Row", key: key + "-h", crossAxisAlignment: "center", children: [
      { type: "Text", style: "h4", flex: 1, text: r.title, textEn: r.title },
      ...(r.ref ? [{ type: "TextButton", key: key + "-more", ...twin("labelText", "Ver más", "See more"), onPressed: { go: { browse: { ref: r.ref, title: r.title } } } }] : []),
    ] },
    cardRow(r.items, key),
  ],
});

const tabBar = (active) => ({ type: "TabBar", key: "tabs", divider: false, value: active, onChanged: "tab", tabs: TAB_IDS.map((id) => ({ value: id, ...TAB_LABEL[id] })) });

/**
 * `data`: `{ slides, rows }` of the active tab, or null while it is not in. `pending`: some tab is
 * still loading (the timer polls only then). `failed`: the active tab could not load.
 */
export function browseView({ tab, data, pending, failed, device = "phone" }) {
  const tv = device === "tv";
  const active = TAB_IDS.includes(tab) ? tab : TAB_IDS[0];
  const body = [];
  if (data) {
    if (data.slides.length > 0) body.push(hero(data.slides));
    for (const r of data.rows) body.push(rail(r, "rail-" + String(r.id).replace(/[^A-Za-z0-9_-]/g, "_")));
    if (data.rows.length === 0) body.push({ type: "Text", text: "Sin contenido por ahora.", textEn: "Nothing here yet.", color: "muted" });
  } else if (failed) {
    body.push({ type: "MaterialBanner", key: "loadFailed", role: "error", text: "ZappTV no respondió.", textEn: "ZappTV didn't answer.",
      action: { label: "Reintentar", labelEn: "Retry", onTap: "retry" } });
  } else {
    body.push(heroSkeleton(), railSkeleton(1), railSkeleton(2), railSkeleton(3));
  }
  const isBanner = (n) => !!n && (n.type === "heroCard" || n.key === "heroSkeleton" || (n.type === "PageView" && String(n.key).startsWith("hero")));
  const banner = body.length > 0 && isBanner(body[0]) ? body.shift() : null;
  // The "one compact bar" the Kino docs recommend (apiVersion 19, Kino 0.9.81+, like Xuper/Latino):
  // `mergeWithKinoBar` folds the plugin's bar INTO Kino's, so there's a single bar — our `leading`
  // where Close was, our `title` where the plugin's name was — instead of two stacked ones. `dense`
  // makes it a compact row. On a TV the tabs sit beside the name in one D-pad strip and search is a bar
  // action (a remote can't reach a floating one); on a phone the tabs pin under the bar and search floats.
  const searchAction = { type: "IconButton", key: "searchButton", icon: "search", ...twin("labelText", "Buscar", "Search"), onPressed: "openSearch" };
  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar", mergeWithKinoBar: true, dense: true, divider: false,
      leading: { type: "IconButton", key: "close", icon: "close", ...twin("labelText", "Cerrar", "Close"), onPressed: { go: { close: true } } },
      title: tv ? { type: "Row", key: "titleRow", gap: 24, crossAxisAlignment: "center", children: [brand, tabBar(active)] } : brand,
      ...(tv ? { actions: [searchAction] } : {}),
    },
    ...(tv ? {} : { floatingActionButton: { type: "FloatingActionButton", key: "searchFab", icon: "search", ...twin("labelText", "Buscar", "Search"), onPressed: "openSearch" } }),
    body: { type: "Column", key: "page", children: [
      ...(tv ? [] : [{ type: "Column", key: "tabsRow", padding: { compact: 0, expanded: 24 }, children: [tabBar(active)] }]),
      { type: "SingleChildScrollView", key: "browse-" + active, flex: 1, children: [...(banner ? [banner] : []), { type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: body }] },
    ] },
    ...(pending ? { every: { ms: POLL_MS, event: "tick" } } : {}),
  };
}

/** The in-plugin search page, same shape as Xuper's: on a TV the box and its button sit in the merged
 * bar (field on the left with `weight: 1`, button on the right) and the bar carries no title — the
 * screen is known by what it does; elsewhere the box is at the top of the body under a "Buscar" title.
 * Then skeletons while ZappTV answers, then Kino's grid. */
export function searchView({ query, status, items, device = "phone" }) {
  const tv = device === "tv";
  const searchForm = () => ({
    type: "Form", key: "searchForm", onSubmitted: "search", gap: 8, children: tv
      ? [{ type: "Row", key: "searchRow", gap: 16, crossAxisAlignment: "center", children: [
        { type: "TextField", key: "q", kind: "text", value: query, ...twin("labelText", "Buscar en ZappTV", "Search ZappTV"), maxLength: 100, autofocus: true, weight: 1 },
        { type: "ElevatedButton", key: "searchGo", ...twin("labelText", "Buscar", "Search"), icon: "search", submit: true },
      ] }]
      : [
        { type: "TextField", key: "q", kind: "text", value: query, ...twin("labelText", "Buscar en ZappTV", "Search ZappTV"), maxLength: 100, autofocus: true },
        { type: "ElevatedButton", key: "searchGo", ...twin("labelText", "Buscar", "Search"), icon: "search", submit: true },
      ],
  });
  const body = tv ? [] : [searchForm()];
  if (status === "fail") {
    body.push({ type: "MaterialBanner", key: "searchFailed", role: "error", text: "La búsqueda falló.", textEn: "Search failed.", action: { label: "Reintentar", labelEn: "Retry", onTap: "sretry" } });
  } else if (status === "done" && items) {
    body.push(items.length === 0
      ? { type: "Text", text: "Sin resultados.", textEn: "No results.", color: "muted" }
      : cardGrid(items.slice(0, SEARCH_CAP), "results"));
  } else if (status !== "idle") {
    body.push({ type: "Skeleton", shape: "block", height: 200, key: "searchSkeleton" });
  }
  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar", mergeWithKinoBar: true, dense: true, divider: false,
      leading: { type: "IconButton", key: "back", icon: "arrow_back", ...twin("labelText", "Atrás", "Back"), onPressed: "back" },
      ...(tv ? { title: searchForm() } : { title: { type: "Text", text: "Buscar", textEn: "Search", style: "h4" } }),
    },
    body: { type: "SingleChildScrollView", key: "search-page", children: [{ type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: body }] },
    ...(status === "loading" ? { every: { ms: 1000, event: "stick" } } : {}),
  };
}
