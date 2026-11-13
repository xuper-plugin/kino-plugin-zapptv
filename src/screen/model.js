// What the screen shows, pure data shaping (no network): the catalog.js's tabPage() already
// answers { slides, rows } for one ZappTV block — this file just names the tabs and trims a card
// down to what the tree needs.
export const TAB_IDS = ["inicio", "peliculas", "series"];
export const BLOCK_OF = { inicio: "HomeES", peliculas: "MoviesES", series: "SeriesES" };

const HTTP = /^https?:\/\//;

// Every image node inside the screen (titleCard's item.poster/backdrop included — same rule as
// heroCard's) is forced https with no insecureHttp exception, and ZappTV serves every image over
// plain http, so it goes through images.weserv.nl, a free, accountless proxy built for exactly
// this (a sizable CDN, not a single box — used at scale by other apps for the same mismatch).
export const httpsImage = (url) => (HTTP.test(url) ? `https://images.weserv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ""))}` : undefined);

/** The card Kino draws: the fields a rail needs and nothing else (the tree stays small). */
export function cardOf(item) {
  const out = { id: item.id, ref: item.ref, title: item.title, kind: item.kind };
  if (item.poster) { const u = httpsImage(item.poster); if (u) out.poster = u; }
  if (item.backdrop) { const u = httpsImage(item.backdrop); if (u) out.backdrop = u; }
  return out;
}
