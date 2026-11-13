// What the screen shows, pure data shaping (no network): the catalog.js's tabPage() already
// answers { slides, rows } for one ZappTV block — this file just names the tabs and trims a card
// down to what the tree needs.
export const TAB_IDS = ["inicio", "peliculas", "series"];
export const BLOCK_OF = { inicio: "HomeES", peliculas: "MoviesES", series: "SeriesES" };

const HTTPS = /^https?:\/\//;

/** The card Kino draws: the fields a rail needs and nothing else (the tree stays small). */
export function cardOf(item) {
  const out = { id: item.id, ref: item.ref, title: item.title, kind: item.kind };
  if (item.poster && HTTPS.test(item.poster)) out.poster = item.poster;
  if (item.backdrop && HTTPS.test(item.backdrop)) out.backdrop = item.backdrop;
  return out;
}
