import { get } from "./api.js";
import { repeatedMsg, str, num } from "./proto.js";
import { resLiteInfoToItem } from "./mappers.js";

// BlockInfo { blockId=1, blockName=2, blockType=3 (the ref for block/{type}), isDefault=4, style=5 }.
async function listBlocks() {
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
  const rowsField = style === "full_scroll" ? 2 : 1; // the carousel (full_scroll's field 1) is a
  // richer, differently-shaped item (its "field 3" is a synopsis, not a poster URL) — skipped on
  // purpose: resRows alone already cover every title, without that mismatch.
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

const safeId = (s) => String(s).replace(/[^A-Za-z0-9._~-]/g, "_").slice(0, 100) || "row";

const HOME_ROWS_PER_BLOCK = 2;
const HOME_ITEMS_PER_ROW = 20;
const BROWSE_ITEMS_PER_ROW = 300;

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
