import { get } from "./api.js";
import { repeatedMsg } from "./proto.js";
import { resLiteInfoToItem } from "./mappers.js";

const PAGE_SIZE = 20;

export async function search(query) {
  const q = typeof query?.q === "string" ? query.q.trim() : "";
  if (!q) return [];
  const index = Number.isFinite(Number(query?.cursor)) ? Number(query.cursor) : 0;
  const path =
    `search?keyword=${encodeURIComponent(q)}&queryType=1&index=${index}&count=${PAGE_SIZE}&category=`;
  const fields = await get(path);
  // SearchResults { keyword=1, page=2, results=3 (repeated ResLiteInfo), category=4 }
  return repeatedMsg(fields, 3).map(resLiteInfoToItem).filter(Boolean);
}
