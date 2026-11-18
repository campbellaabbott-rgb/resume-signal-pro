/**
 * DOCX FIXTURES, BUILT FROM THEIR XML (registers S11-010, S11-033, S11-034).
 *
 * Plain TypeScript that takes the zip class as an argument, so the Node suite
 * (npm jszip) and the Deno tests (the esm.sh jszip parse-docx deploys with)
 * build byte-for-byte the same documents. Each one is a shape real résumés
 * arrive in and the parser once refused or misread:
 *
 *  - softBreaks: a contact block and role headers written with Shift+Enter
 *    (<w:br/>), which the raw-text converter dropped, gluing the lines;
 *  - strict: a Strict Open XML document (Word's "Strict Open XML Document"
 *    save format), whose purl.oclc.org namespaces mammoth 1.6.0 did not know;
 *  - textBoxNoFallback: a text box in mc:AlternateContent with no
 *    mc:Fallback, on which mammoth 1.6.0 threw a TypeError;
 *  - wordBullets: bullets made with Word's bullet button (w:numPr, and the
 *    List Bullet style), whose glyph lives in numbering.xml and which the
 *    raw-text converter dropped (S13-037), beside a numbered list, a
 *    numbered heading, a list with numbering removed (numId 0) and a tracked
 *    change that took a bullet away, none of which is a bullet;
 *  - transitional: the ordinary document, as a control;
 *  - the bug round of 2026-11-08: non-breaking and optional hyphens
 *    (hyphens), a part whose deflated bytes are damaged (damagedPartDocx),
 *    a tracked move (trackedMove), a Choice-only text box holding a drawing
 *    with its own Fallback (nestedTextBox), a document exported as web
 *    content (altChunk), linked contact details (links), bullets defined
 *    through a list style (numStyleLinkBullets), contact details only in the
 *    page header (headerContact), and the shapes each refusal names (empty,
 *    garbled).
 */
export type ZipClass = new () => {
  file(name: string, data: string): unknown;
  generateAsync(opts: { type: "uint8array"; compression?: "STORE" | "DEFLATE" }): Promise<Uint8Array>;
};

const TRANSITIONAL = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  rel: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
};
const STRICT = {
  w: "http://purl.oclc.org/ooxml/wordprocessingml/main",
  rel: "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument",
};

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

type Parts = {
  numbering?: string;
  styles?: string;
  /** More zip entries, path -> content. */
  files?: Record<string, string>;
  /** More relationships of the main document. */
  rels?: string[];
  /** More [Content_Types].xml entries. */
  types?: string;
  /** Deflate every entry (JSZip stores them by default). */
  deflate?: boolean;
};

async function pack(
  Zip: ZipClass,
  ns: { w: string; rel: string },
  body: string,
  extraNs = "",
  parts: Parts = {},
): Promise<Uint8Array> {
  const zip = new Zip();
  zip.file("[Content_Types].xml", parts.types ? CONTENT_TYPES.replace("</Types>", `${parts.types}</Types>`) : CONTENT_TYPES);
  const rels: string[] = [...(parts.rels ?? [])];
  for (const [path, content] of Object.entries(parts.files ?? {})) zip.file(path, content);
  if (parts.numbering) {
    zip.file("word/numbering.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="${ns.w}">${parts.numbering}</w:numbering>`);
    rels.push(`<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`);
  }
  if (parts.styles) {
    zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="${ns.w}">${parts.styles}</w:styles>`);
    rels.push(`<Relationship Id="rIdSty" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);
  }
  if (rels.length) {
    zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`);
  }
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${ns.rel}" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${ns.w}"${extraNs}><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync(parts.deflate ? { type: "uint8array", compression: "DEFLATE" } : { type: "uint8array" });
}

const p = (runs: string) => `<w:p>${runs}</w:p>`;
const r = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const br = `<w:r><w:br/></w:r>`;

export const RESUME_LINES = {
  name: "Jane Doe",
  email: "jane@example.com",
  heading: "EXPERIENCE",
  role: "Senior Engineer, Acme Corp",
  dates: "Jan 2020 - Present",
  bullet: "Led a team of five engineers shipping the billing platform.",
};

/** The contact block and the role header written with soft line breaks. */
export function softBreaksDocx(Zip: ZipClass): Promise<Uint8Array> {
  const L = RESUME_LINES;
  return pack(Zip, TRANSITIONAL, [
    // A soft break in its own run, and one inside a run before more text.
    p(`${r(L.name)}${br}${r(L.email)}`),
    p(`<w:r><w:t>${L.heading}</w:t><w:br/><w:t>${L.role}</w:t><w:br w:type="textWrapping"/><w:t>${L.dates}</w:t></w:r>`),
    p(r(L.bullet)),
  ].join(""));
}

/** The same résumé as a Strict Open XML document. */
export function strictDocx(Zip: ZipClass): Promise<Uint8Array> {
  const L = RESUME_LINES;
  return pack(Zip, STRICT, [p(r(L.name)), p(r(L.email)), p(r(L.heading)), p(r(L.role)), p(r(L.bullet))].join(""));
}

/** A text box in mc:AlternateContent with a Choice and no Fallback. */
export function textBoxNoFallbackDocx(Zip: ZipClass): Promise<Uint8Array> {
  const L = RESUME_LINES;
  const box = `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><a:graphic><a:graphicData><wps:wsp><wps:txbx><w:txbxContent>${p(r(L.email))}</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice></mc:AlternateContent></w:r>`;
  const extraNs = ` xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="wps"`;
  return pack(Zip, TRANSITIONAL, [p(r(L.name)), p(box), p(r(L.heading)), p(r(L.role)), p(r(L.bullet))].join(""), extraNs);
}

export const WORD_BULLETS = {
  bullets: [
    "Built a carrier scorecard that cut late deliveries 18%",
    "Led a team of six planners across three sites",
    "Rolled the scorecard out to 40 carriers in one quarter",
  ],
  styled: "Trained 12 new hires on the slotting plan",
  numbered: ["Reduced overtime 9% in the first year", "Opened the second dock"],
  heading: "EXPERIENCE",
  removed: "Was promoted to team lead after 18 months",
  wasBullet: "Recognised as site employee of the year",
};

const lvl = (ilvl: number, fmt: string, text: string) =>
  `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/></w:lvl>`;
const numPr = (numId: number, ilvl = 0) => `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`;

/** Word's own bullets (numId 1, and the List Bullet style), a numbered list (numId 2) and the shapes that are not bullets. */
export function wordBulletsDocx(Zip: ZipClass): Promise<Uint8Array> {
  const B = WORD_BULLETS;
  const numbering = [
    `<w:abstractNum w:abstractNumId="0">${lvl(0, "bullet", "\uF0B7")}${lvl(1, "bullet", "o")}</w:abstractNum>`,
    `<w:abstractNum w:abstractNumId="1">${lvl(0, "decimal", "%1.")}</w:abstractNum>`,
    `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`,
    `<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>`,
  ].join("");
  const styles = [
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>`,
    `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr>${numPr(1)}</w:pPr></w:style>`,
    `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr>${numPr(2)}</w:pPr></w:style>`,
  ].join("");
  const listed = (pPr: string, text: string) => `<w:p w:rsidR="00A1B2C3"><w:pPr>${pPr}</w:pPr>${r(text)}</w:p>`;
  return pack(Zip, TRANSITIONAL, [
    p(r(RESUME_LINES.name)),
    listed(`<w:pStyle w:val="Heading1"/>`, B.heading),
    p(r(RESUME_LINES.role)),
    ...B.bullets.map((t) => listed(`<w:pStyle w:val="ListParagraph"/>${numPr(1)}`, t)),
    listed(`<w:pStyle w:val="ListBullet"/>`, B.styled),
    listed(`<w:pStyle w:val="ListBullet"/>${numPr(0)}`, B.removed),
    listed(`<w:pPrChange w:id="1" w:author="x" w:date="2024-01-01T00:00:00Z"><w:pPr>${numPr(1)}</w:pPr></w:pPrChange>`, B.wasBullet),
    ...B.numbered.map((t) => listed(numPr(2), t)),
    // an empty list paragraph: no line, so no lone bullet
    `<w:p><w:pPr>${numPr(1)}</w:pPr></w:p>`,
  ].join(""), "", { numbering, styles });
}

/** The control: an ordinary transitional document, one line per paragraph. */
export function transitionalDocx(Zip: ZipClass): Promise<Uint8Array> {
  const L = RESUME_LINES;
  return pack(Zip, TRANSITIONAL, [p(r(L.name)), p(r(L.email)), p(r(L.heading)), p(r(L.role)), p(r(L.bullet))].join(""));
}

/** An RTF file renamed to .docx: not a zip at all. */
export const RTF_RENAMED = new TextEncoder().encode(
  "{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times New Roman;}}\\f0\\fs24 Jane Doe\\par jane@example.com\\par Senior Engineer, Acme Corp\\par Led a team of five engineers.\\par}",
);

// ── the bug round of 2026-11-08 ─────────────────────────────────────────────

const R_NS = ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const BOX_NS = ` xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:v="urn:schemas-microsoft-com:vml" mc:Ignorable="wps"`;
const EXPERIENCE = [p(r("EXPERIENCE")), p(r("Senior Analyst, Northwind Traders\tJan 2019 - Present")), p(r("Built a driver-based forecast that cut forecast error from 9% to 3%."))].join("");

export const HYPHENS = { cofounded: "Co-founded a B2B start-up and led go-to-market for 3 products.", implemented: "Implemented SAP S/4HANA in 9 months." };

/** Word's non-breaking hyphen (w:noBreakHyphen) and optional hyphen (w:softHyphen), which mammoth writes as U+2011 and U+00AD. */
export function hyphensDocx(Zip: ZipClass): Promise<Uint8Array> {
  const nb = `<w:r><w:noBreakHyphen/></w:r>`;
  return pack(Zip, TRANSITIONAL, [
    p(r("Jordan Ellis")), p(r("jordan.ellis@example.com | (415) 555-0134")), p(r("EXPERIENCE")),
    p(`${r("Co")}${nb}${r("founded a B2B start")}${nb}${r("up and led go")}${nb}${r("to")}${nb}${r("market for 3 products.")}`),
    p(`${r("Imple")}<w:r><w:softHyphen/></w:r>${r("mented SAP S/4HANA in 9 months.")}`),
  ].join(""));
}

/** Flip every byte of one entry's stored data (its deflate stream) from a third of the way in. */
function damageEntry(zip: Uint8Array, name: string): Uint8Array {
  const out = new Uint8Array(zip);
  const want = new TextEncoder().encode(name);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i + 30 < out.length; i++) {
    if (dv.getUint32(i, true) !== 0x04034b50) continue;
    const size = dv.getUint32(i + 18, true);
    const nameLen = dv.getUint16(i + 26, true);
    const extraLen = dv.getUint16(i + 28, true);
    const got = out.subarray(i + 30, i + 30 + nameLen);
    if (nameLen !== want.length || !got.every((b, k) => b === want[k])) continue;
    const data = i + 30 + nameLen + extraLen;
    for (let k = Math.floor(size / 3); k < size; k++) out[data + k] ^= 0xff;
    return out;
  }
  throw new Error(`no zip entry ${name}`);
}

/**
 * A document whose main part (or numbering part) has damaged deflate bytes:
 * the zip directory opens, and reading that part fails.
 */
export async function damagedPartDocx(Zip: ZipClass, part: "word/document.xml" | "word/numbering.xml"): Promise<Uint8Array> {
  const B = WORD_BULLETS;
  const numbering = `<w:abstractNum w:abstractNumId="0">${lvl(0, "bullet", "\uF0B7")}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`;
  const body = [p(r(RESUME_LINES.name)), p(r(RESUME_LINES.email)), p(r(B.heading)), p(r(RESUME_LINES.role)),
    ...B.bullets.map((t) => `<w:p><w:pPr>${numPr(1)}</w:pPr>${r(t)}</w:p>`), p(r(RESUME_LINES.bullet.repeat(3)))].join("");
  return damageEntry(await pack(Zip, TRANSITIONAL, body, "", { numbering, deflate: true }), part);
}

export const TRACKED_MOVE = { moved: "Senior Product Manager, Northwind Traders, 2019 to Present", summary: "Product leader with nine years in payments.", bullet: "Led a team of 8 to launch the tax product, growing ARR by $40M." };

/** Word's tracked move: the moved run inside w:moveFrom where it was and w:moveTo where it went, with the move ranges around them. */
export function trackedMoveDocx(Zip: ZipClass): Promise<Uint8Array> {
  const M = TRACKED_MOVE;
  const by = `w:author="Coach" w:date="2024-01-01T00:00:00Z"`;
  return pack(Zip, TRANSITIONAL, [
    p(r("Jordan Ellis")), p(r("jordan.ellis@example.com | (415) 555-0134")),
    `<w:p><w:pPr><w:rPr><w:moveFrom w:id="10" ${by}/></w:rPr></w:pPr><w:moveFromRangeStart w:id="11" ${by} w:name="move1"/><w:moveFrom w:id="12" ${by}>${r(M.moved)}</w:moveFrom><w:moveFromRangeEnd w:id="11"/></w:p>`,
    p(r("SUMMARY")), p(r(M.summary)), p(r("EXPERIENCE")),
    `<w:p><w:moveToRangeStart w:id="13" ${by} w:name="move1"/><w:moveTo w:id="14" ${by}>${r(M.moved)}</w:moveTo><w:moveToRangeEnd w:id="13"/></w:p>`,
    p(r(M.bullet)),
    // A whole paragraph moved, as some editors write it.
    `<w:moveFrom w:id="15" ${by}><w:p>${r("SQL, Figma, Tableau")}</w:p></w:moveFrom>`,
    p(r("SKILLS")),
    `<w:moveTo w:id="16" ${by}><w:p>${r("SQL, Figma, Tableau")}</w:p></w:moveTo>`,
  ].join(""));
}

export const NESTED = { name: "Maria Santos", email: "maria.santos@example.com", phone: "(312) 555-0199" };

const sidebar = (inner: string) =>
  `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><wp:docPr id="1" name="Sidebar"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:txbx><w:txbxContent>` +
  `<w:p><w:r>${inner}</w:r><w:r><w:t xml:space="preserve"> ${NESTED.email}</w:t></w:r></w:p><w:p>${r(NESTED.phone)}</w:p>` +
  `</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice></mc:AlternateContent></w:r>${r(NESTED.name)}</w:p>`;

/** The inner drawings a Choice-only sidebar can hold: an icon with its own Fallback, a Choice-only "@" box, or none. */
export const NESTED_INNER = {
  fallback: `<mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:inline><wp:docPr id="3" name="Icon"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp/></a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice><mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent>`,
  choiceOnly: `<mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:inline><wp:docPr id="3" name="Icon"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:txbx><w:txbxContent><w:p>${r("@")}</w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice></mc:AlternateContent>`,
  none: "",
};

/** The XML of a Choice-only sidebar text box holding the contact block, with the given inner drawing. */
export const nestedTextBoxXml = (inner: keyof typeof NESTED_INNER) => sidebar(NESTED_INNER[inner]);

/** A résumé whose contact block sits in a Choice-only sidebar text box. */
export function nestedTextBoxDocx(Zip: ZipClass, inner: keyof typeof NESTED_INNER): Promise<Uint8Array> {
  return pack(Zip, TRANSITIONAL, sidebar(NESTED_INNER[inner]) + EXPERIENCE, BOX_NS);
}

/** Word's own text box: a Choice and a VML Fallback, both holding the contact block (mammoth reads the Fallback). */
export const WORD_TEXT_BOX_XML =
  `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><wp:docPr id="1" name="TB"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:txbx><w:txbxContent><w:p>${r(NESTED.email)}</w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>` +
  `<mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent><w:p>${r(NESTED.email)}</w:p></w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>${r(NESTED.name)}</w:p>`;

export const ALT_CHUNK = {
  lines: [
    "Jordan Ellis",
    "jordan.ellis@example.com | (415) 555-0134",
    "Experience",
    "Senior Product Manager, Contoso 2019 - Present",
    "Led a team of 8 to launch the tax product, growing ARR by $40M.",
    "Cut checkout latency 35% & raised conversion — café-ready.",
    "Education",
    "B.S. Computer Science, State University",
  ],
};

/** Quoted-printable, as a mail program writes it: =XX for non-ASCII and "=", soft breaks at 76. */
function quotedPrintable(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let line = "";
  const out: string[] = [];
  for (const b of bytes) {
    const piece = b === 0x3d || b > 0x7e || (b < 0x20 && b !== 0x0a) ? `=${b.toString(16).toUpperCase().padStart(2, "0")}` : String.fromCharCode(b);
    if (piece === "\n") { out.push(line); line = ""; continue; }
    if (line.length + piece.length > 75) { out.push(line + "="); line = ""; }
    line += piece;
  }
  out.push(line);
  return out.join("\r\n");
}

/**
 * A document exported as web content (html-docx-js and similar): the body is
 * one w:altChunk naming an MHT part, a MIME message whose HTML is
 * quoted-printable. `unreadable` names a part that is not there.
 */
export function altChunkDocx(Zip: ZipClass, opts: { unreadable?: boolean } = {}): Promise<Uint8Array> {
  const [name, contact, exp, role, bullet, bullet2, edu, degree] = ALT_CHUNK.lines;
  const html = `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>CV</title><style>p { margin: 0 }</style></head><body>\n<h1>${name}</h1><p class="contact">${contact}</p>\n<h2>${exp}</h2><p>${role}</p><ul><li>${bullet}</li><li>${bullet2.replace("&", "&amp;").replace("—", "&mdash;")}</li></ul>\n<h2>${edu}</h2><table><tr><td>${degree}</td></tr></table>\n</body></html>`;
  const mht = `MIME-Version: 1.0\r\nContent-Type: multipart/related;\r\n    type="text/html";\r\n    boundary="----=mhtDocumentPart"\r\n\r\n\r\n------=mhtDocumentPart\r\nContent-Type: text/html;\r\n    charset="utf-8"\r\nContent-Transfer-Encoding: quoted-printable\r\nContent-Location: file:///C:/fake/document.html\r\n\r\n${quotedPrintable(html)}\r\n\r\n------=mhtDocumentPart--\r\n`;
  return pack(Zip, TRANSITIONAL, `<w:altChunk r:id="htmlChunk"/>`, R_NS, {
    files: opts.unreadable ? {} : { "word/afchunk.mht": mht },
    rels: [`<Relationship Id="htmlChunk" Type="${REL}/aFChunk" Target="/word/afchunk.mht"/>`],
    types: `<Default Extension="mht" ContentType="message/rfc822"/>`,
  });
}

export const LINKS = { email: "jordan.ellis@example.com", linkedin: "https://www.linkedin.com/in/jordanellis-pm", github: "https://github.com/jellis", portfolio: "https://jordanellis.example.com/work" };

/**
 * Contact details written as links: two w:hyperlink runs whose targets are
 * external relationships, a HYPERLINK field, and a link whose address is
 * already its own text (not to be repeated).
 */
export function linksDocx(Zip: ZipClass): Promise<Uint8Array> {
  const L = LINKS;
  const field = `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "${L.github}" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r("GitHub")}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  return pack(Zip, TRANSITIONAL, [
    p(r("Jordan Ellis")),
    p(`<w:hyperlink r:id="rIdH1">${r("Email me")}</w:hyperlink>${r(" | ")}<w:hyperlink r:id="rIdH2">${r("LinkedIn")}</w:hyperlink>${r(" | ")}${field}${r(" | (415) 555-0134")}`),
    p(`${r("Portfolio: ")}<w:hyperlink r:id="rIdH3">${r(L.portfolio)}</w:hyperlink>`),
    p(`<w:hyperlink w:anchor="experience">${r("Jump to experience")}</w:hyperlink>`),
    EXPERIENCE,
  ].join(""), R_NS, {
    rels: [
      `<Relationship Id="rIdH1" Type="${REL}/hyperlink" Target="mailto:${L.email}" TargetMode="External"/>`,
      `<Relationship Id="rIdH2" Type="${REL}/hyperlink" Target="${L.linkedin}" TargetMode="External"/>`,
      `<Relationship Id="rIdH3" Type="${REL}/hyperlink" Target="${L.portfolio}" TargetMode="External"/>`,
    ],
  });
}

export const LIST_STYLE_BULLETS = [
  "Cut onboarding time from 14 days to 5",
  "Ran the vendor review for 30 suppliers",
  "Wrote the team's incident playbook",
];

/**
 * Bullets defined through a list style (S13-037's remainder): the
 * paragraphs' numbering (numId 5) points at an abstractNum with no levels of
 * its own, only w:numStyleLink "RBBullets"; the numbering style RBBullets
 * names numId 6, whose abstractNum (w:styleLink "RBBullets") has the bullet
 * level.
 */
export function numStyleLinkBulletsDocx(Zip: ZipClass): Promise<Uint8Array> {
  const numbering = [
    `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:styleLink w:val="RBBullets"/>${lvl(0, "bullet", "\uF0B7")}${lvl(1, "bullet", "o")}</w:abstractNum>`,
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/><w:numStyleLink w:val="RBBullets"/></w:abstractNum>`,
    `<w:num w:numId="6"><w:abstractNumId w:val="0"/></w:num>`,
    `<w:num w:numId="5"><w:abstractNumId w:val="1"/></w:num>`,
  ].join("");
  const styles = [
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>`,
    `<w:style w:type="numbering" w:customStyle="1" w:styleId="RBBullets"><w:name w:val="RB Bullets"/><w:pPr>${numPr(6)}</w:pPr></w:style>`,
  ].join("");
  return pack(Zip, TRANSITIONAL, [
    p(r(RESUME_LINES.name)), p(r(WORD_BULLETS.heading)), p(r(RESUME_LINES.role)),
    ...LIST_STYLE_BULLETS.map((t) => `<w:p><w:pPr>${numPr(5)}</w:pPr>${r(t)}</w:p>`),
  ].join(""), "", { numbering, styles });
}

export const HEADER_CONTACT = { name: "Jordan Ellis", email: "jordan.ellis@example.com", phone: "(415) 555-0134" };

/** Contact details in the page header (and a page-number footer); with `inBody`, the body carries the email too. */
export function headerContactDocx(Zip: ZipClass, opts: { inBody?: boolean } = {}): Promise<Uint8Array> {
  const H = HEADER_CONTACT;
  const W_NS = `xmlns:w="${TRANSITIONAL.w}"`;
  const hdr = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${W_NS}>${p(r(H.name))}<w:p>${r(H.email)}<w:r><w:tab/></w:r>${r(H.phone)}</w:p></w:hdr>`;
  const ftr = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${W_NS}>${p(r("Page 1 of 2"))}</w:ftr>`;
  return pack(Zip, TRANSITIONAL, (opts.inBody ? p(r(`Contact: ${H.email}`)) : "") + EXPERIENCE + p(r(RESUME_LINES.bullet)), "", {
    files: { "word/header1.xml": hdr, "word/footer1.xml": ftr },
    rels: [`<Relationship Id="rIdHd" Type="${REL}/header" Target="header1.xml"/>`, `<Relationship Id="rIdFt" Type="${REL}/footer" Target="footer1.xml"/>`],
  });
}

/** A document with no text at all. */
export function emptyDocx(Zip: ZipClass): Promise<Uint8Array> {
  return pack(Zip, TRANSITIONAL, p(""));
}

/** A document whose text is mostly replacement characters, as a broken embedded font leaves it. */
export function garbledDocx(Zip: ZipClass): Promise<Uint8Array> {
  return pack(Zip, TRANSITIONAL, [p(r("\uFFFD\uFFFD\uFFFD\uFFFD \uFFFD\uFFFDgineer \uFFFDith \uFFFDx\uFFFDerience \uFFFDn \uFFFDo\uFFFDt\uFFFDare")), p(r("\uFFFD\uFFFD\uFFFD \uFFFDroje\uFFFDt \uFFFDana\uFFFDe\uFFFDent \uFFFD\uFFFD\uFFFD \uFFFDeam"))].join(""));
}
