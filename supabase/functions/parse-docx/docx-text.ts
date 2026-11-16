/**
 * THE BODY TEXT OF A .DOCX, AS LINES.
 *
 * Plain TypeScript whose only import is the pure ./alt-chunk.ts: mammoth and
 * the zip reader are passed in, so the Node suite runs it with the npm
 * packages and the Deno tests with the exact esm.sh builds parse-docx deploys
 * (./libs.ts).
 *
 * SOFT LINE BREAKS ARE LINES (register S11-010). mammoth's raw-text converter
 * knows text, tabs and paragraphs only, so a Shift+Enter break (<w:br/>)
 * became nothing and the lines either side of it ran together: "Jane
 * Doejane@example.comEXPERIENCESenior Engineer, Acme Corp". The contact
 * reader then took "doejane@example.comexperiencesenior" as the address and
 * the section reader found no headings. Each break (and carriage return) in
 * the main document part is rewritten to a text run holding a newline before
 * mammoth reads it.
 *
 * WORD'S OWN BULLETS ARE KEPT (register S13-037). A list made with Word's
 * bullet button is a paragraph carrying w:numPr (or a style that does), and
 * the bullet glyph lives in numbering.xml, not in the text; mammoth's raw
 * text drops it. The scanner's tone audit and quantified-bullet count read
 * only lines that open with a bullet glyph, so every DOCX built that way (our
 * own builder's export included) was told "Too passive, 0 active bullets" and
 * "Quantified bullets: 0". Each paragraph whose numbering resolves to a
 * bullet format (numFmt "bullet") now gets a "• " text run before mammoth
 * reads it, as PDF and pasted text keep theirs. A numbered list, a paragraph
 * whose numbering cannot be resolved, numId 0 (numbering removed) and a
 * paragraph with no text get nothing: when unsure, no bullet is claimed.
 *
 * A FILE THAT CANNOT BE READ IS THE FILE'S PROBLEM (register S11-033). A zip
 * the reader refuses (an RTF or a PDF renamed .docx, a truncated download)
 * and a document mammoth cannot walk both throw DamagedDocxError, which
 * parse-docx answers with a 422 naming the file, never a 500 the browser
 * reads as an outage. Every read after the zip opens (the relationships, each
 * part, the rewritten zip) is inside that guard (S14X-124): a part whose
 * deflated bytes are damaged threw a plain Error, which was a 500.
 *
 * The bug round of 2026-11-08 adds, in the same pre-pass: tracked moves read
 * as Word shows them with changes accepted (S14X-125), a text box holding a
 * drawing ended at its own close (S14X-126), a page embedded as w:altChunk
 * read as lines (S14X-281), bullets defined through a list style
 * (RC-S13-037), and the link targets the text does not show (S14X-147).
 */
import { altChunkLines } from "./alt-chunk.ts";

export type ZipEntry = { name: string; async(type: "string"): Promise<string>; async(type: "uint8array"): Promise<Uint8Array> };
export type LoadedZip = {
  file(name: string): ZipEntry | null;
  file(pattern: RegExp): ZipEntry[];
  file(name: string, data: string): unknown;
  generateAsync(opts: { type: "uint8array" }): Promise<Uint8Array>;
};
export type ZipLoader = { loadAsync(data: Uint8Array): Promise<LoadedZip> };
export type MammothLike = {
  extractRawText(input: { buffer: Uint8Array }): Promise<{ value: string; messages?: unknown[] }>;
};

export class DamagedDocxError extends Error {
  constructor(message: string, readonly reason: "not_a_zip" | "unreadable_document") {
    super(message);
    this.name = "DamagedDocxError";
  }
}

const BREAK = /<w:br\b[^>]*?(?:\/>|>\s*<\/w:br>)|<w:cr\b[^>]*?(?:\/>|>\s*<\/w:cr>)/g;
const NEWLINE_RUN = '<w:t xml:space="preserve">\n</w:t>';

/** Every soft line break, page break and carriage return of a WordprocessingML part, as a newline text run. */
export function softBreaksAsNewlines(xml: string): { xml: string; count: number } {
  let count = 0;
  const out = xml.replace(BREAK, () => {
    count++;
    return NEWLINE_RUN;
  });
  return { xml: out, count };
}

/**
 * S12-128: A TEXT BOX WITH NO FALLBACK IS LIFTED INTO THE TEXT. Word writes a
 * modern text box as mc:AlternateContent: the drawing in mc:Choice and an old
 * VML copy in mc:Fallback, which is the copy mammoth reads. A box written with
 * a Choice and no Fallback (some exporters and templates do) was read as
 * nothing, and a contact block placed in one lost its email address. Each such
 * block becomes text runs holding its paragraphs, one per line, where it sat.
 * A block that has a Fallback of its own is left as it is.
 *
 * S14X-126: a block ends at its MATCHING close, nested opens counted, and
 * "has a Fallback" is asked of the outer block with nested blocks cut out. A
 * sidebar box holding an icon (itself an mc:AlternateContent, with or without
 * a Fallback) used to end at the icon's close. A nested block adds only the
 * text it shows: its Choice's, its Fallback dropped.
 */
const AC_OPEN = "<mc:AlternateContent";
const AC_CLOSE = "</mc:AlternateContent>";

/** The index just past the close that matches the open at `start`, or -1. */
function blockEnd(xml: string, start: number): number {
  const re = /<mc:AlternateContent\b|<\/mc:AlternateContent>/g;
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    depth += m[0][1] === "/" ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/** `xml` with each top-level AlternateContent block replaced by what `f` makes of it. */
function mapBlocks(xml: string, f: (block: string) => string): { xml: string; count: number } {
  let out = "";
  let at = 0;
  let count = 0;
  for (;;) {
    const start = xml.indexOf(AC_OPEN, at);
    const end = start < 0 ? -1 : blockEnd(xml, start);
    if (end < 0) return { xml: out + xml.slice(at), count };
    const block = xml.slice(start, end);
    const made = f(block);
    if (made !== block) count++;
    out += xml.slice(at, start) + made;
    at = end;
  }
}

const innerOf = (block: string) => block.slice(block.indexOf(">") + 1, block.length - AC_CLOSE.length);
const textOf = (xml: string) =>
  (xml.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) ?? []).map((t) => t.replace(/^<w:t(?:\s[^>]*)?>|<\/w:t>$/g, "")).join("");

/** The text a nested block shows: its Choice's, nested blocks within it read the same way. */
function shownText(block: string): string {
  const flat = mapBlocks(innerOf(block), (b) => `<w:t>${shownText(b)}</w:t>`).xml;
  return textOf(flat.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, "").replace(/<\/w:p>/g, "<w:t> </w:t>")).trim();
}

export function liftChoiceOnlyTextBoxes(xml: string): { xml: string; count: number } {
  return mapBlocks(xml, (block) => {
    const inner = innerOf(block);
    if (mapBlocks(inner, () => "").xml.includes("<mc:Fallback") || !block.includes("<w:txbxContent")) return block;
    const flat = mapBlocks(inner, (b) => `<w:t>${shownText(b)}</w:t>`).xml;
    const lines: string[] = [];
    for (const para of flat.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) ?? []) {
      const text = textOf(para);
      if (text.trim()) lines.push(text);
    }
    // The block sits inside a run (<w:r>), so run content replaces it: a text
    // element per line, a newline element between them.
    const runs = lines.map((l) => `<w:t xml:space="preserve">${l}</w:t>`).join(NEWLINE_RUN);
    return lines.length ? `${NEWLINE_RUN}${runs}${NEWLINE_RUN}` : "";
  });
}

/**
 * S14X-125: TRACKED MOVES, AS WORD SHOWS THEM WITH CHANGES ACCEPTED. A move's
 * source (w:moveFrom) is dropped, as a deletion is; its destination
 * (w:moveTo) is unwrapped to its runs, as an insertion is. mammoth 1.12.3
 * reads neither, so moved text was lost; 1.13.0 reads moveTo but throws under
 * Deno (docx_test.ts), so the pin stays and this does it. The move range
 * marks (w:moveFromRangeStart and the rest) are left; mammoth ignores them.
 */
const MOVE_FROM = /<w:moveFrom\b(?:[^>]*?\/>|[^>]*>[\s\S]*?<\/w:moveFrom>)/g;
const MOVE_TO = /<w:moveTo\b[^>]*?\/?>|<\/w:moveTo>/g;

export function trackedMovesAccepted(xml: string): { xml: string; count: number } {
  let count = 0;
  const out = xml
    .replace(MOVE_FROM, () => { count++; return ""; })
    .replace(MOVE_TO, (m) => { if (m[1] !== "/") count++; return ""; });
  return { xml: out, count };
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
};
const firstTag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}\\b[^>]*>`).exec(xml);
  return m ? m[0] : null;
};

/** numFmt of a w:lvl body: the first one that is not a w14 "custom" (whose fallback follows it). */
function levelFormat(lvlBody: string): string | null {
  for (const tag of lvlBody.match(/<w:numFmt\b[^>]*>/g) ?? []) {
    const v = attr(tag, "w:val");
    if (v && v !== "custom") return v;
  }
  return null;
}

/**
 * numbering.xml as numId → ilvl → numFmt, level overrides applied.
 *
 * RC-S13-037: a list defined through a list style has an abstractNum with no
 * levels, only w:numStyleLink naming the style. Its levels are those of the
 * numbering the style names (its numPr numId, in styles.xml), else of the
 * abstractNum that names the style in w:styleLink.
 */
export function readNumberingFormats(xml: string | null, stylesXml: string | null = null): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  if (!xml) return out;
  const levelsOf = (body: string): Map<string, string> => {
    const levels = new Map<string, string>();
    for (const m of body.matchAll(/<w:lvl\b([^>]*)>([\s\S]*?)<\/w:lvl>/g)) {
      const ilvl = attr(m[1], "w:ilvl");
      const fmt = levelFormat(m[2]);
      if (ilvl !== null && fmt) levels.set(ilvl, fmt);
    }
    return levels;
  };
  const abstract = new Map<string, Map<string, string>>();
  const styleOwner = new Map<string, string>();
  const linked = new Map<string, string>();
  for (const m of xml.matchAll(/<w:abstractNum\b([^>]*)>([\s\S]*?)<\/w:abstractNum>/g)) {
    const id = attr(m[1], "w:abstractNumId");
    if (id === null) continue;
    const levels = levelsOf(m[2]);
    abstract.set(id, levels);
    const owns = firstTag(m[2], "w:styleLink");
    if (owns) styleOwner.set(attr(owns, "w:val") ?? "", id);
    const link = firstTag(m[2], "w:numStyleLink");
    if (link && levels.size === 0) linked.set(id, attr(link, "w:val") ?? "");
  }
  const nums: Array<[string, string]> = [];
  for (const m of xml.matchAll(/<w:num\b([^>]*)>([\s\S]*?)<\/w:num>/g)) {
    const numId = attr(m[1], "w:numId");
    const absTag = firstTag(m[2], "w:abstractNumId");
    if (numId !== null && absTag) nums.push([numId, attr(absTag, "w:val") ?? ""]);
  }
  if (linked.size > 0) {
    const styleNum = readStyleNumbering(stylesXml);
    for (const [id, style] of linked) {
      const viaNum = styleNum.get(style)?.numId;
      const viaStyle = viaNum ? nums.find(([n]) => n === viaNum)?.[1] : undefined;
      const target = viaStyle && viaStyle !== id ? viaStyle : styleOwner.get(style);
      if (target !== undefined && target !== id) abstract.set(id, abstract.get(target) ?? new Map());
    }
  }
  for (const m of xml.matchAll(/<w:num\b([^>]*)>([\s\S]*?)<\/w:num>/g)) {
    const numId = attr(m[1], "w:numId");
    const absTag = firstTag(m[2], "w:abstractNumId");
    if (numId === null || !absTag) continue;
    const levels = new Map(abstract.get(attr(absTag, "w:val") ?? "") ?? []);
    for (const o of m[2].matchAll(/<w:lvlOverride\b([^>]*)>([\s\S]*?)<\/w:lvlOverride>/g)) {
      const ilvl = attr(o[1], "w:ilvl");
      const fmt = ilvl !== null ? levelsOf(o[2]).get(ilvl) ?? null : null;
      if (ilvl !== null && fmt) levels.set(ilvl, fmt);
    }
    out.set(numId, levels);
  }
  return out;
}

type NumRef = { numId: string | null; ilvl: string | null };

function numPrOf(pPr: string): NumRef | null {
  const m = /<w:numPr\b[^>]*>([\s\S]*?)<\/w:numPr>/.exec(pPr);
  if (!m) return null;
  const numId = firstTag(m[1], "w:numId");
  const ilvl = firstTag(m[1], "w:ilvl");
  return { numId: numId ? attr(numId, "w:val") : null, ilvl: ilvl ? attr(ilvl, "w:val") : null };
}

/** styles.xml as styleId → the numbering its paragraphs carry (basedOn followed). */
export function readStyleNumbering(xml: string | null): Map<string, NumRef> {
  const own = new Map<string, { ref: NumRef | null; basedOn: string | null }>();
  if (xml) {
    for (const m of xml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
      const id = attr(m[1], "w:styleId");
      if (id === null) continue;
      const pPr = /<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/.exec(m[2])?.[1] ?? "";
      const based = firstTag(m[2], "w:basedOn");
      own.set(id, { ref: numPrOf(pPr), basedOn: based ? attr(based, "w:val") : null });
    }
  }
  const out = new Map<string, NumRef>();
  for (const id of own.keys()) {
    let numId: string | null = null;
    let ilvl: string | null = null;
    let at: string | null = id;
    for (let hops = 0; at && hops < 10; hops++) {
      const s = own.get(at);
      if (!s) break;
      if (numId === null && s.ref?.numId != null) numId = s.ref.numId;
      if (ilvl === null && s.ref?.ilvl != null) ilvl = s.ref.ilvl;
      at = s.basedOn;
    }
    if (numId !== null) out.set(id, { numId, ilvl });
  }
  return out;
}

const BULLET_RUN = '<w:r><w:t xml:space="preserve">\u2022 </w:t></w:r>';

/**
 * Every paragraph whose numbering resolves to a bullet format gets a "• "
 * text run as its first run. Its own numPr wins over its style's; numId 0
 * means numbering removed; a tracked change's old numPr is not read.
 */
export function listBulletsAsText(
  xml: string,
  numbering: Map<string, Map<string, string>>,
  styles: Map<string, NumRef>,
): { xml: string; count: number } {
  if (numbering.size === 0) return { xml, count: 0 };
  let count = 0;
  let out = "";
  let at = 0;
  const OPEN = /<w:p(\s[^>]*)?>/g;
  for (let m = OPEN.exec(xml); m; m = OPEN.exec(xml)) {
    let insertAt = m.index + m[0].length;
    let pPr = "";
    const rest = xml.slice(insertAt, insertAt + 20);
    if (/^\s*<w:pPr\b/.test(rest)) {
      // A tracked change holds the old properties in a w:pPr of its own, so
      // the paragraph's close is the first one after the change ends.
      let close = xml.indexOf("</w:pPr>", insertAt);
      const change = xml.indexOf("<w:pPrChange", insertAt);
      if (change >= 0 && change < close) {
        const changeEnd = xml.indexOf("</w:pPrChange>", change);
        if (changeEnd >= 0) close = xml.indexOf("</w:pPr>", changeEnd);
      }
      const selfClose = /^\s*<w:pPr\b[^>]*\/>/.exec(rest);
      if (selfClose) insertAt += selfClose[0].length;
      else if (close >= 0) { pPr = xml.slice(insertAt, close); insertAt = close + "</w:pPr>".length; }
    }
    pPr = pPr.replace(/<w:pPrChange\b[\s\S]*?<\/w:pPrChange>/g, "");
    const direct = numPrOf(pPr);
    const styleTag = firstTag(pPr, "w:pStyle");
    const style = styleTag ? styles.get(attr(styleTag, "w:val") ?? "") ?? null : null;
    const numId = direct?.numId ?? style?.numId ?? null;
    const ilvl = direct?.ilvl ?? style?.ilvl ?? "0";
    if (numId === null || numId === "0") continue;
    if (numbering.get(numId)?.get(ilvl) !== "bullet") continue;
    const end = xml.indexOf("</w:p>", insertAt);
    const own = xml.slice(insertAt, end < 0 ? undefined : end);
    if (!/<w:t(?:\s[^>]*)?>[^<]*\S/.test(own)) continue;
    out += xml.slice(at, insertAt) + BULLET_RUN;
    at = insertAt;
    count++;
  }
  return { xml: out + xml.slice(at), count };
}

type Rel = { id: string; type: string; target: string; external: boolean; path: string };

const XML_ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeXml = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML_ENTITY[e]);
const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A zip path from a part's folder and a relative target ("../media/x" included). */
function joinPath(dir: string, target: string): string {
  const out: string[] = [];
  for (const seg of (target.startsWith("/") ? target.slice(1) : dir + target).split("/")) {
    if (seg === "..") out.pop();
    else if (seg !== "." && seg !== "") out.push(seg);
  }
  return out.join("/");
}

/** The main document's relationships. */
async function readRels(zip: LoadedZip, docPath: string): Promise<Rel[]> {
  const slash = docPath.lastIndexOf("/");
  const dir = slash >= 0 ? docPath.slice(0, slash + 1) : "";
  const rels = zip.file(`${dir}_rels/${docPath.slice(slash + 1)}.rels`);
  if (!rels) return [];
  return ((await rels.async("string")).match(/<Relationship\b[^>]*>/g) ?? []).map((tag) => {
    const target = decodeXml(attr(tag, "Target") ?? "");
    const external = attr(tag, "TargetMode") === "External";
    return { id: attr(tag, "Id") ?? "", type: attr(tag, "Type") ?? "", target, external, path: external ? "" : joinPath(dir, target) };
  });
}

/** A part the main document's relationships name by type (numbering, styles), else Word's usual path. */
async function relatedPart(zip: LoadedZip, rels: Rel[], type: string, fallback: string): Promise<string | null> {
  const rel = rels.find((r) => r.type.endsWith(`/${type}`) && r.target && !r.external);
  const part = zip.file(rel ? rel.path : fallback);
  return part ? part.async("string") : null;
}

/** The main document part the package's relationships name (word/document.xml unless they say otherwise). */
export async function mainDocumentPath(zip: LoadedZip): Promise<string> {
  const rels = zip.file("_rels/.rels");
  if (rels) {
    const xml = await rels.async("string");
    for (const tag of xml.match(/<Relationship\b[^>]*>/g) ?? []) {
      const type = /\bType="([^"]*)"/.exec(tag)?.[1] ?? "";
      const target = /\bTarget="([^"]*)"/.exec(tag)?.[1] ?? "";
      if (/\/officeDocument$/.test(type) && target) return target.replace(/^\//, "");
    }
  }
  return "word/document.xml";
}

/**
 * S14X-281: each w:altChunk (an embedded web page) becomes paragraphs of the
 * page's lines (./alt-chunk.ts). A part that is missing or reads as nothing
 * is counted as unreadable and leaves an empty paragraph.
 */
async function altChunksAsParagraphs(xml: string, rels: Rel[], zip: LoadedZip): Promise<{ xml: string; read: number; unreadable: number }> {
  let read = 0;
  let unreadable = 0;
  if (!xml.includes("<w:altChunk")) return { xml, read, unreadable };
  let out = "";
  let at = 0;
  for (const m of xml.matchAll(/<w:altChunk\b([^>]*?)(?:\/>|>[\s\S]*?<\/w:altChunk>)/g)) {
    const id = attr(m[1], "r:id");
    const rel = rels.find((r) => r.id === id && !r.external && r.type.endsWith("/aFChunk"));
    const part = rel ? zip.file(rel.path) : null;
    let lines: string[] = [];
    if (part) {
      try { lines = altChunkLines(await part.async("uint8array")); } catch { lines = []; }
    }
    if (lines.length) read++; else unreadable++;
    out += xml.slice(at, m.index) + (lines.length
      ? lines.map((l) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(l)}</w:t></w:r></w:p>`).join("")
      : "<w:p/>");
    at = m.index + m[0].length;
  }
  return { xml: out + xml.slice(at), read, unreadable };
}

/**
 * S14X-147: THE LINK TARGETS THE TEXT DOES NOT SHOW. A contact block written
 * as links ("Email | LinkedIn") keeps its addresses only in the links:
 * w:hyperlink relationships to external targets, and HYPERLINK fields.
 */
function linkTargets(xml: string, rels: Rel[]): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<w:hyperlink\b([^>]*)>/g)) {
    const id = attr(m[1], "r:id");
    const rel = id ? rels.find((r) => r.id === id && r.type.endsWith("/hyperlink")) : undefined;
    if (rel) out.push(rel.target);
  }
  const instr = [...xml.matchAll(/<w:instrText\b[^>]*>([^<]*)<\/w:instrText>|\bw:instr="([^"]*)"/g)].map((m) => m[1] ?? m[2]).join("");
  for (const m of decodeXml(instr).matchAll(/HYPERLINK\s+(\\l\s+)?"([^"]+)"/g)) if (!m[1]) out.push(m[2]);
  return out;
}

/**
 * One trailing line, "Links: a | b", of the mailto/http/https targets the
 * text does not already show: mailto: dropped, each address once, at most ten
 * and 1,000 characters. The same rule as parse-pdf's page-text.ts (each
 * module stays free of imports the other runtime cannot load).
 */
export function linksLine(urls: string[], text: string): string {
  const shown = text.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  let length = 7;
  for (const u of urls.map((x) => x.trim())) {
    let item = "";
    if (/^mailto:/i.test(u)) {
      try { item = decodeURIComponent(u.slice(7).split("?")[0]).trim(); } catch { item = ""; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item)) continue;
    } else if (/^https?:\/\/[^\s]+$/i.test(u)) item = u;
    else continue;
    const key = item.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
    if (!key || item.length > 200 || seen.has(key) || shown.includes(key)) continue;
    if (out.length >= 10 || length + item.length + 3 > 1000) break;
    seen.add(key);
    out.push(item);
    length += item.length + 3;
  }
  return out.length ? `Links: ${out.join(" | ")}` : "";
}

export type DocxBody = {
  body: string;
  zip: LoadedZip;
  messages: unknown[];
  softBreaks: number;
  listBullets: number;
  /** Embedded web pages (w:altChunk) read, and those that could not be. */
  altChunks: { read: number; unreadable: number };
};

export async function readDocxBody(
  buffer: Uint8Array,
  libs: { mammoth: MammothLike; JSZip: ZipLoader },
): Promise<DocxBody> {
  let zip: LoadedZip;
  try {
    zip = await libs.JSZip.loadAsync(buffer);
  } catch (e) {
    throw new DamagedDocxError(`not a zip: ${e instanceof Error ? e.message : String(e)}`, "not_a_zip");
  }
  try {
    return await readOpenedDocx(zip, buffer, libs.mammoth);
  } catch (e) {
    if (e instanceof DamagedDocxError) throw e;
    throw new DamagedDocxError(`unreadable document: ${e instanceof Error ? e.message : String(e)}`, "unreadable_document");
  }
}

async function readOpenedDocx(zip: LoadedZip, buffer: Uint8Array, mammoth: MammothLike): Promise<DocxBody> {
  let input = buffer;
  let softBreaks = 0;
  let listBullets = 0;
  const altChunks = { read: 0, unreadable: 0 };
  let links: string[] = [];
  const path = await mainDocumentPath(zip);
  const part = zip.file(path);
  if (part) {
    const rels = await readRels(zip, path);
    const alt = await altChunksAsParagraphs(await part.async("string"), rels, zip);
    altChunks.read = alt.read;
    altChunks.unreadable = alt.unreadable;
    const moves = trackedMovesAccepted(alt.xml);
    const lifted = liftChoiceOnlyTextBoxes(moves.xml);
    const rewritten = softBreaksAsNewlines(lifted.xml);
    let xml = rewritten.xml;
    links = linkTargets(xml, rels);
    if (/<w:numPr\b|<w:pStyle\b/.test(xml)) {
      const numberingXml = await relatedPart(zip, rels, "numbering", "word/numbering.xml");
      const stylesXml = numberingXml ? await relatedPart(zip, rels, "styles", "word/styles.xml") : null;
      const numbering = readNumberingFormats(numberingXml, stylesXml);
      const bulleted = listBulletsAsText(xml, numbering, readStyleNumbering(numbering.size > 0 ? stylesXml : null));
      xml = bulleted.xml;
      listBullets = bulleted.count;
    }
    if (alt.read + alt.unreadable + moves.count + rewritten.count + lifted.count + listBullets > 0) {
      zip.file(path, xml);
      input = await zip.generateAsync({ type: "uint8array" });
      softBreaks = rewritten.count;
    }
  }

  const result = await mammoth.extractRawText({ buffer: input });
  const line = linksLine(links, result.value);
  return {
    body: line ? `${result.value.trimEnd()}\n\n${line}\n` : result.value,
    zip,
    messages: result.messages ?? [],
    softBreaks,
    listBullets,
    altChunks,
  };
}
