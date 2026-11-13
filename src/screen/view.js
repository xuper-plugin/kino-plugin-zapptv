// The screen's trees: a pure view of what index.js holds. A tab not in yet draws skeletons shaped
// like what replaces them, so nothing jumps when the rows arrive. Every text is bilingual.
import { TAB_IDS, cardOf, httpsImage } from "./model.js";

const twin = (field, es, en) => ({ [field]: es, [field + "En"]: en });
const POLL_MS = 1500;
const SEARCH_CAP = 60;
const TAB_LABEL = { inicio: twin("label", "Inicio", "Home"), peliculas: twin("label", "Películas", "Movies"), series: twin("label", "Series", "Series") };

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
  // The appBar has NO leading/title: Kino already draws its own close+name bar above every screen,
  // so ours would duplicate it ("X ZappTV" twice). It carries only the tab strip (in `bottom`, where
  // a D-pad can reach it) and, on a TV, the search button as an action (a floating one is hard to
  // reach with a remote); on a phone the search stays a FloatingActionButton.
  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar", divider: false,
      ...(tv ? { actions: [{ type: "IconButton", key: "searchButton", icon: "search", ...twin("labelText", "Buscar", "Search"), onPressed: "openSearch" }] } : {}),
      bottom: tabBar(active),
    },
    ...(tv ? {} : { floatingActionButton: { type: "FloatingActionButton", key: "searchFab", icon: "search", ...twin("labelText", "Buscar", "Search"), onPressed: "openSearch" } }),
    body: { type: "SingleChildScrollView", key: "browse-" + active, children: [...(banner ? [banner] : []), { type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: body }] },
    ...(pending ? { every: { ms: POLL_MS, event: "tick" } } : {}),
  };
}

/** The in-plugin search page: a text box, then skeletons while ZappTV answers, then Kino's grid. */
export function searchView({ query, status, items, device = "phone" }) {
  const tv = device === "tv";
  const fields = [
    { type: "TextField", key: "q", kind: "text", value: query, ...twin("labelText", "Buscar en ZappTV", "Search ZappTV"), maxLength: 100, autofocus: !tv },
    { type: "ElevatedButton", key: "searchGo", ...twin("labelText", "Buscar", "Search"), icon: "search", submit: true },
  ];
  const searchForm = { type: "Form", key: "searchForm", onSubmitted: "search", gap: 8, children: tv ? [{ type: "Row", key: "searchRow", gap: 16, crossAxisAlignment: "center", children: fields }] : fields };
  const body = tv ? [] : [searchForm];
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
      type: "AppBar",
      leading: { type: "IconButton", key: "back", icon: "arrow_back", ...twin("labelText", "Atrás", "Back"), onPressed: "back" },
      ...(tv ? { title: searchForm } : { title: { type: "Text", text: "Buscar", textEn: "Search", style: "h4" } }),
    },
    body: { type: "SingleChildScrollView", key: "search-page", children: [{ type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: body }] },
    ...(status === "loading" ? { every: { ms: 1000, event: "stick" } } : {}),
  };
}
