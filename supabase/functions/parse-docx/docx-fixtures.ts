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

async function pack(Zip: ZipClass, ns: { w: string; rel: string }, body: string, extraNs = ""): Promise<Uint8Array> {
  const zip = new Zip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
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

/** The control: an ordinary transitional document, one line per paragraph. */
export function transitionalDocx(Zip: ZipClass): Promise<Uint8Array> {
  const L = RESUME_LINES;
  return pack(Zip, TRANSITIONAL, [p(r(L.name)), p(r(L.email)), p(r(L.heading)), p(r(L.role)), p(r(L.bullet))].join(""));
}

/** An RTF file renamed to .docx: not a zip at all. */
export const RTF_RENAMED = new TextEncoder().encode(
  "{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times New Roman;}}\\f0\\fs24 Jane Doe\\par jane@example.com\\par Senior Engineer, Acme Corp\\par Led a team of five engineers.\\par}",
);
