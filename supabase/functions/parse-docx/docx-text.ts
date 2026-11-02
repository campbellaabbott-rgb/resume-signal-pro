/**
 * THE BODY TEXT OF A .DOCX, AS LINES.
 *
 * Plain TypeScript with no imports: mammoth and the zip reader are passed in,
 * so the Node suite runs it with the npm packages and the Deno tests with the
 * exact esm.sh builds parse-docx deploys (./libs.ts).
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
 * reads as an outage.
 */
export type ZipEntry = { name: string; async(type: "string"): Promise<string> };
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
 * One pass with indexOf; a block that has a Fallback is left as it is.
 */
export function liftChoiceOnlyTextBoxes(xml: string): { xml: string; count: number } {
  const OPEN = "<mc:AlternateContent";
  const CLOSE = "</mc:AlternateContent>";
  let out = "";
  let at = 0;
  let count = 0;
  for (;;) {
    const start = xml.indexOf(OPEN, at);
    if (start < 0) return { xml: out + xml.slice(at), count };
    const end = xml.indexOf(CLOSE, start);
    if (end < 0) return { xml: out + xml.slice(at), count };
    const block = xml.slice(start, end + CLOSE.length);
    out += xml.slice(at, start);
    at = end + CLOSE.length;
    if (block.includes("<mc:Fallback") || !block.includes("<w:txbxContent")) { out += block; continue; }
    const lines: string[] = [];
    for (const para of block.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) ?? []) {
      const text = (para.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) ?? []).map((t) => t.replace(/^<w:t(?:\s[^>]*)?>|<\/w:t>$/g, "")).join("");
      if (text.trim()) lines.push(text);
    }
    count++;
    // The block sits inside a run (<w:r>), so run content replaces it: a text
    // element per line, a newline element between them.
    const runs = lines.map((l) => `<w:t xml:space="preserve">${l}</w:t>`).join(NEWLINE_RUN);
    out += lines.length ? `${NEWLINE_RUN}${runs}${NEWLINE_RUN}` : "";
  }
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

/** numbering.xml as numId → ilvl → numFmt, level overrides applied. */
export function readNumberingFormats(xml: string | null): Map<string, Map<string, string>> {
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
  for (const m of xml.matchAll(/<w:abstractNum\b([^>]*)>([\s\S]*?)<\/w:abstractNum>/g)) {
    const id = attr(m[1], "w:abstractNumId");
    if (id !== null) abstract.set(id, levelsOf(m[2]));
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

/** A part the main document's relationships name by type (numbering, styles), else Word's usual path. */
async function relatedPart(zip: LoadedZip, docPath: string, type: string, fallback: string): Promise<string | null> {
  const slash = docPath.lastIndexOf("/");
  const dir = slash >= 0 ? docPath.slice(0, slash + 1) : "";
  const rels = zip.file(`${dir}_rels/${docPath.slice(slash + 1)}.rels`);
  let path = fallback;
  if (rels) {
    const xml = await rels.async("string");
    for (const tag of xml.match(/<Relationship\b[^>]*>/g) ?? []) {
      const t = attr(tag, "Type") ?? "";
      const target = attr(tag, "Target") ?? "";
      if (t.endsWith(`/${type}`) && target) {
        path = target.startsWith("/") ? target.slice(1) : dir + target;
        break;
      }
    }
  }
  const part = zip.file(path);
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

export async function readDocxBody(
  buffer: Uint8Array,
  libs: { mammoth: MammothLike; JSZip: ZipLoader },
): Promise<{ body: string; zip: LoadedZip; messages: unknown[]; softBreaks: number; listBullets: number }> {
  let zip: LoadedZip;
  try {
    zip = await libs.JSZip.loadAsync(buffer);
  } catch (e) {
    throw new DamagedDocxError(`not a zip: ${e instanceof Error ? e.message : String(e)}`, "not_a_zip");
  }

  let input = buffer;
  let softBreaks = 0;
  let listBullets = 0;
  const path = await mainDocumentPath(zip);
  const part = zip.file(path);
  if (part) {
    const lifted = liftChoiceOnlyTextBoxes(await part.async("string"));
    const rewritten = softBreaksAsNewlines(lifted.xml);
    let xml = rewritten.xml;
    if (/<w:numPr\b|<w:pStyle\b/.test(xml)) {
      const numbering = readNumberingFormats(await relatedPart(zip, path, "numbering", "word/numbering.xml"));
      const styles = readStyleNumbering(numbering.size > 0 ? await relatedPart(zip, path, "styles", "word/styles.xml") : null);
      const bulleted = listBulletsAsText(xml, numbering, styles);
      xml = bulleted.xml;
      listBullets = bulleted.count;
    }
    if (rewritten.count > 0 || lifted.count > 0 || listBullets > 0) {
      zip.file(path, xml);
      input = await zip.generateAsync({ type: "uint8array" });
      softBreaks = rewritten.count;
    }
  }

  try {
    const result = await libs.mammoth.extractRawText({ buffer: input });
    return { body: result.value, zip, messages: result.messages ?? [], softBreaks, listBullets };
  } catch (e) {
    throw new DamagedDocxError(`unreadable document: ${e instanceof Error ? e.message : String(e)}`, "unreadable_document");
  }
}
