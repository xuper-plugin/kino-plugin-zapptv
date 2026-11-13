import { get } from "./api.js";
import { repeatedMsg, str, num } from "./proto.js";
import { resLiteInfoToItem, resInfoToSlide } from "./mappers.js";

// BlockInfo { blockId=1, blockName=2, blockType=3 (the ref for block/{type}), isDefault=4, style=5 }.
export async function listBlocks() {
  const fields = await get("blocks");
  return repeatedMsg(fields, 1).map((b) => ({
    id: num(b, 1),
    name: str(b, 2),
    type: str(b, 3),
    style: str(b, 5), // "full_scroll" (FullScrollBlock: carousels=1, resRows=2) or "half_scroll" (HalfScrollBlock: resRows=1)
  }));
}

// ResRow { rowId=1, rowName=2, rowType=3, resInfos=6 (repeated ResLiteInfo) }. A block answers up
// to dozens of these, each up to ~100 items — we only read a `limit` slice of each.
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

/** The carousel of a full_scroll block (field 1): richer entries (ResInfo, with a synopsis and a
 * backdrop) used only for the screen's hero slider — plain rows use the lighter ResLiteInfo. */
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

const safeId = (s) => String(s).replace(/[^A-Za-z0-9._~-]/g, "_").slice(0, 100) || "row";

const HOME_ROWS_PER_BLOCK = 2;
const HOME_ITEMS_PER_ROW = 20;
const BROWSE_ITEMS_PER_ROW = 300;
const TAB_ROWS_LIMIT = 10;
const TAB_ITEMS_PER_ROW = 20;
const TAB_SLIDES_LIMIT = 6;

export async function home() {
  const blocks = await listBlocks();
  const out = [];
  for (const b of blocks) {
    if (!b.type) continue;
    let rows;
    try { rows = rowsOf(await get(`block/${encodeURIComponent(b.type)}`), b.style, HOME_ITEMS_PER_ROW); } catch (_) { continue; } // one bad block never fails Home
    rows.slice(0, HOME_ROWS_PER_BLOCK).forEach((r, i) => {
      // KinoRow.id must match ^[A-Za-z0-9._~-]{1,128}$ — the human-readable row name goes in `title` only.
      out.push({ id: `${safeId(b.type)}-${i}`, title: r.name || b.name, items: r.items, ref: b.type });
    });
  }
  return out;
}

export async function browse(ref, _cursor) {
  const blocks = await listBlocks();
  const block = blocks.find((b) => b.type === ref);
  const rows = rowsOf(await get(`block/${encodeURIComponent(ref)}`), block?.style, BROWSE_ITEMS_PER_ROW);
  return { items: rows.flatMap((r) => r.items) }; // one page: ZappTV's block/{type} has no further cursor
}

/** One block as the screen's `screen/model.js` wants it: a handful of hero slides plus its rails,
 * each with a `ref` back to the block so the rail's own "Ver más" reuses browse(). */
export async function tabPage(blockType) {
  const blocks = await listBlocks();
  const block = blocks.find((b) => b.type === blockType);
  const fields = await get(`block/${encodeURIComponent(blockType)}`);
  const rows = rowsOf(fields, block?.style, TAB_ITEMS_PER_ROW).slice(0, TAB_ROWS_LIMIT);
  return {
    slides: slidesOf(fields, block?.style, TAB_SLIDES_LIMIT),
    rows: rows.map((r, i) => ({ id: `${safeId(blockType)}-${i}`, title: r.name, items: r.items, ref: blockType })),
  };
}
