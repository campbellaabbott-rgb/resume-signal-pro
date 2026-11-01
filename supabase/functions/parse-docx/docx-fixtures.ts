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
 *  - transitional: the ordinary document, as a control.
 */
export type ZipClass = new () => {
  file(name: string, data: string): unknown;
  generateAsync(opts: { type: "uint8array" }): Promise<Uint8Array>;
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

async function pack(
  Zip: ZipClass,
  ns: { w: string; rel: string },
  body: string,
  extraNs = "",
  parts: { numbering?: string; styles?: string } = {},
): Promise<Uint8Array> {
  const zip = new Zip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  const rels: string[] = [];
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
  return zip.generateAsync({ type: "uint8array" });
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
