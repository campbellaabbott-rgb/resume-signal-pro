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
): Promise<{ body: string; zip: LoadedZip; messages: unknown[]; softBreaks: number }> {
  let zip: LoadedZip;
  try {
    zip = await libs.JSZip.loadAsync(buffer);
  } catch (e) {
    throw new DamagedDocxError(`not a zip: ${e instanceof Error ? e.message : String(e)}`, "not_a_zip");
  }

  let input = buffer;
  let softBreaks = 0;
  const path = await mainDocumentPath(zip);
  const part = zip.file(path);
  if (part) {
    const lifted = liftChoiceOnlyTextBoxes(await part.async("string"));
    const rewritten = softBreaksAsNewlines(lifted.xml);
    if (rewritten.count > 0 || lifted.count > 0) {
      zip.file(path, rewritten.xml);
      input = await zip.generateAsync({ type: "uint8array" });
      softBreaks = rewritten.count;
    }
  }

  try {
    const result = await libs.mammoth.extractRawText({ buffer: input });
    return { body: result.value, zip, messages: result.messages ?? [], softBreaks };
  } catch (e) {
    throw new DamagedDocxError(`unreadable document: ${e instanceof Error ? e.message : String(e)}`, "unreadable_document");
  }
}
