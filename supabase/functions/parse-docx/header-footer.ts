/**
 * THE TEXT IN A WORD DOCUMENT'S PAGE HEADERS AND FOOTERS.
 *
 * mammoth's extractRawText reads the document body only (register L5-07).
 * Many résumé templates keep the name, email, phone and LinkedIn URL in the
 * page header, so those uploads reached the scanner with no contact details
 * and were told, with "high confidence", that they had none.
 *
 * A .docx is a zip: word/header*.xml and word/footer*.xml hold those parts.
 * This reads their paragraphs as lines; parse-docx puts header lines before
 * the body and footer lines after it, skipping any line the body already has
 * (a first-page and a default header usually repeat each other).
 *
 * Plain TypeScript with no imports, so the Node test suite runs it on real
 * zips built with the npm jszip that mammoth itself uses.
 */

export type ZipEntry = { name: string; async(type: "string"): Promise<string> };
export type ZipLike = { file(pattern: RegExp): ZipEntry[] };

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return ENTITY[k] ?? m;
  });
}

/** The paragraphs of one WordprocessingML part, one line each, empty ones dropped. */
export function linesOfWordXml(xml: string): string[] {
  const out: string[] = [];
  for (const para of xml.split(/<\/w:p>/)) {
    const pieces: string[] = [];
    const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g;
    for (const m of para.matchAll(re)) pieces.push(m[1] !== undefined ? decodeXml(m[1]) : " ");
    const line = pieces.join("").replace(/\s+/g, " ").trim();
    if (line) out.push(line);
  }
  return out;
}

/** Header and footer lines of a .docx, each list de-duplicated in document order. */
export async function headerFooterLines(zip: ZipLike): Promise<{ header: string[]; footer: string[] }> {
  const read = async (re: RegExp) => {
    const seen = new Set<string>();
    const lines: string[] = [];
    const parts = zip.file(re).sort((a, b) => a.name.localeCompare(b.name));
    for (const part of parts) {
      for (const line of linesOfWordXml(await part.async("string"))) {
        if (!seen.has(line)) { seen.add(line); lines.push(line); }
      }
    }
    return lines;
  };
  return { header: await read(/^word\/header\d*\.xml$/), footer: await read(/^word\/footer\d*\.xml$/) };
}

/** The body with the header lines before it and the footer lines after it, minus lines the body already holds. */
export function withHeaderFooter(body: string, parts: { header: string[]; footer: string[] }): string {
  const bodyLines = new Set(body.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean));
  const fresh = (ls: string[]) => ls.filter((l) => !bodyLines.has(l) && !/^page \d+( of \d+)?$/i.test(l));
  const header = fresh(parts.header);
  const footer = fresh(parts.footer);
  return [header.join("\n"), body, footer.join("\n")].filter((s) => s.trim() !== "").join("\n\n");
}

/**
 * RC-S13-036: THE CONTACT DETAILS ARE ONLY IN THE HEADER OR FOOTER. The text
 * the scanner reads has them (withHeaderFooter), but an applicant tracking
 * system that reads the body alone does not, so parse-docx tells the page,
 * which warns. True when the body holds no email and no phone number and the
 * header or footer lines hold one of them.
 */
const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i;
// A phone number: seven or more digits, with the separators people write;
// a span of years ("2019 - 2024") is not one.
const PHONES = /(?:\+|\b)\d[\d ().-]{5,}\d\b/g;
const YEARS = /^\d{4}\s*[-–]\s*\d{4}$/;
const hasContact = (text: string) =>
  EMAIL.test(text) || [...text.matchAll(PHONES)].some(([m]) => m.replace(/\D/g, "").length >= 7 && !YEARS.test(m.trim()));

export function contactOnlyInHeader(body: string, parts: { header: string[]; footer: string[] }): boolean {
  return !hasContact(body) && hasContact([...parts.header, ...parts.footer].join("\n"));
}
