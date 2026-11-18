// The User interface reference (docs/plugins/ui.md) against the contract and the kit: its generated tables are up to date,
// every widget and go shape of contract.json has a section, every JSON example is read by the kit's rules with nothing
// dropped, every plugin snippet runs in the kit's sandbox and draws a valid tree, and every link resolves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contract, validateManifest } from "../contract.mjs";
import { createKino } from "../kino-shim.mjs";
import { loadPlugin } from "../sandbox.mjs";
import { checkPanelScreen, checkScreenAnswer, checkScreenTree, fakeScreenContext } from "../screen.mjs";
import { ANCHORS, coverage, goAnchor, propRows, render, UI_TABLES } from "../ui-tables.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = join(HERE, "..", "..", "..", "docs", "plugins");
const PAGE = join(DOCS, "ui.md");
const TEXT = readFileSync(PAGE, "utf8");
const S = contract.manifest.screen;
/** The gallery's manifest: its settings (greeting, density, tips) are the ones the page's bind and config examples name. */
const GALLERY = JSON.parse(readFileSync(join(DOCS, "examples", "screen-gallery", "kino-plugin.json"), "utf8"));
const OPTS = { allowSeries: false, settings: GALLERY.settings };
const quiet = { log() {}, info() {}, warn() {}, error() {} };

/** Every fenced block of [lang] in the page, with the line it starts on. */
function blocks(lang) {
  const out = [];
  const re = new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "g");
  let m;
  while ((m = re.exec(TEXT)) !== null) out.push({ body: m[1], line: TEXT.slice(0, m.index).split("\n").length });
  return out;
}

test("ui.md: the generated tables are up to date (node sdk/ui-tables.mjs docs/plugins/ui.md)", () => {
  assert.equal(render(TEXT), TEXT);
});

test("ui.md: every widget, table part and go shape of contract.json has its section, and every block is there", () => {
  assert.deepEqual(coverage(TEXT), []);
  for (const old of [...S.widgets, ...S.tableParts]) assert.ok(ANCHORS[old], old);
  for (const g of S.goShapes) assert.ok(TEXT.includes(`<a id="${goAnchor(g)}"></a>`), g);
});

test("the coverage check fails for a widget, a go shape or a block the page does not have", () => {
  const more = { ...S, widgets: [...S.widgets, "fancy"], goShapes: [...S.goShapes, "teleport"] };
  const problems = coverage(TEXT, more);
  assert.ok(problems.some((p) => p.includes("fancy")), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("teleport")), problems.join("\n"));
  assert.ok(coverage(TEXT.replace("<!-- ui:limits:start -->", "")).some((p) => p.includes("limits")));
  assert.ok(coverage(TEXT.replace('<a id="card"></a>', "")).some((p) => p.includes("#card")));
  assert.throws(() => propRows("fancy"), /no properties described/);
  assert.throws(() => render("<!-- ui:nothing:start -->\n<!-- ui:nothing:end -->"), /unknown block/);
});

test("every property the contract lists for a widget is in its table, with the per-size column the reader uses", () => {
  for (const old of S.widgets) {
    const names = UI_TABLES[`props:${old}`]().split("\n").slice(2).map((r) => r.split("|")[1].trim().replace(/`/g, ""));
    for (const p of S.layoutProps[old] || []) {
      const canonical = Object.entries(S.aliases.props).find(([, o]) => o === p)?.[0] ?? p;
      assert.ok(names.includes(p) || names.includes(canonical), `${old}.${p}`);
    }
    for (const rule of S.fieldProps[old] || []) assert.ok(names.includes(rule), `${old} rule ${rule}`);
    if (S.inputs.includes(old)) assert.ok(names.includes("key") && names.includes("bind"), old);
  }
  const card = UI_TABLES["props:card"]();
  assert.match(card, /\| `flush` \| boolean \| `false` \| yes \|/);
  assert.match(UI_TABLES["props:td"](), /\| `colSpan` \| 1 to 8 \| `1` \| yes \|/);
  assert.match(UI_TABLES.style(), /\| `flex` \| `weight` \|/);
});

test("every JSON example is read by Kino's rules with nothing dropped", () => {
  const seen = { tree: 0, answer: 0, manifest: 0, panel: 0 };
  for (const { body, line } of blocks("json")) {
    let v;
    try { v = JSON.parse(body); } catch (e) { assert.fail(`ui.md line ${line}: not JSON (${e.message})`); }
    if (typeof v.apiVersion === "number") {
      const m = validateManifest(body);
      assert.equal(m.ok, true, `ui.md line ${line}: ${m.message}`);
      seen.manifest++;
    } else if (v.format === "screen") {
      const r = checkPanelScreen(v, "es", OPTS);
      assert.deepEqual(r.dropped, [], `ui.md line ${line}`);
      assert.ok(r.panel, `ui.md line ${line}`);
      seen.panel++;
    } else if (typeof v.type === "string") {
      for (const lang of ["es", "en"]) {
        const r = checkScreenTree(v, lang, undefined, OPTS);
        assert.deepEqual(r.dropped, [], `ui.md line ${line} (${lang})`);
        assert.ok(r.tree, `ui.md line ${line}`);
      }
      seen.tree++;
    } else {
      const r = checkScreenAnswer(v, "es", OPTS);
      assert.deepEqual(r.dropped, [], `ui.md line ${line}`);
      seen.answer++;
    }
  }
  assert.ok(seen.tree >= 50 && seen.answer >= 10 && seen.manifest === 1 && seen.panel === 1, JSON.stringify(seen));
});

test("every plugin snippet runs in the kit's sandbox and draws a valid tree on a phone and a TV", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kino-ui-"));
  try {
    const snippets = blocks("js").filter((b) => /export async function (screen|panel)\b/.test(b.body));
    assert.ok(snippets.length >= 40, String(snippets.length));
    let i = 0;
    for (const { body, line } of snippets) {
      const file = join(dir, `snippet${i++}.js`);
      writeFileSync(file, body);
      const { kino } = createKino({ ...GALLERY, capabilities: ["screen"] }, { lang: "es-CO" });
      const { plugin } = await loadPlugin(file, kino, { console: quiet });
      if (typeof plugin.screen === "function") {
        for (const device of ["phone", "tv"]) {
          const ctx = fakeScreenContext({ device });
          const r = checkScreenTree(await plugin.screen(ctx), "es", undefined, OPTS);
          assert.deepEqual(r.dropped, [], `ui.md line ${line} (${device})`);
          assert.ok(r.tree, `ui.md line ${line}`);
        }
      }
      if (typeof plugin.panel === "function") {
        const r = checkPanelScreen(await plugin.panel({ features: ["screen"], state: {}, size: { widthClass: "compact" } }), "es", OPTS);
        assert.deepEqual(r.dropped, [], `ui.md line ${line}`);
      }
      if (typeof plugin.screenEvent === "function") {
        // The reserved open event answers something Kino can read (null or a valid answer).
        const a = await plugin.screenEvent({ name: "open", state: { inputs: {}, ui: {} }, route: { name: "main", params: {} }, device: "phone", lang: "es" });
        assert.deepEqual(checkScreenAnswer(a, "es", OPTS).dropped, [], `ui.md line ${line}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** GitHub's heading anchor: lower case, punctuation removed, spaces as hyphens. */
const slug = (h) => h.trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, "").replace(/ /g, "-");

test("every link in ui.md resolves: in-page anchors, files, and the guide's headings", () => {
  const anchors = new Set([...TEXT.matchAll(/<a id="([^"]+)"><\/a>/g)].map((m) => m[1]));
  const readme = readFileSync(join(DOCS, "README.md"), "utf8");
  const readmeAnchors = new Set([...readme.matchAll(/^#+ (.+)$/gm)].map((m) => slug(m[1])));
  const bad = [];
  for (const [, target] of TEXT.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^https?:/.test(target)) continue;
    const [file, hash] = target.split("#");
    if (file === "") { if (!anchors.has(hash)) bad.push(target); continue; }
    if (!existsSync(join(DOCS, file))) { bad.push(target); continue; }
    if (hash && file === "README.md" && !readmeAnchors.has(hash)) bad.push(target);
  }
  assert.deepEqual(bad, []);
});

/** Words that must stay out of the docs, spelled here so this file does not carry them either. */
const BANNED = new RegExp(["xu" + "per", "kino " + "coins"].join("|"), "i");

test("ui.md and the gallery carry no hidden characters and no names that must stay out", () => {
  const files = [PAGE, join(DOCS, "ui-img", "README.md"), ...["plugin.js", "README.md", "README.es.md", "kino-plugin.json", "screenshot-map.json"].map((f) => join(DOCS, "examples", "screen-gallery", f))];
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    assert.doesNotMatch(s, /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/, f);
    assert.doesNotMatch(s, /\u00C3.|\u00C2.|\u00E2\u20AC/, f);
    assert.doesNotMatch(s, BANNED, f); // the words that must stay out of public docs
  }
});
