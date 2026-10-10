// @vitest-environment node
//
// Node, not jsdom: pdfjs-serverless mistakes jsdom for a browser (see
// supabase/functions/parse-pdf/pdfjs-contract.test.ts).
/**
 * SHORTLIST REDACTION PASSED LETTER-SPACED, NICKNAMED AND SURNAME-FIRST
 * NAMES, AND EUROPEAN ADDRESSES (review of S8-004 / S8-005, 2026-10-10).
 *
 * The name was the first segment of the first header line, and a run of two
 * spaces or a tab ended a segment. pdf.js reads a letter-spaced ALL-CAPS
 * header ("CARLOS" and "MENDES" set apart) as "CARLOS   MENDES", so the
 * first segment was one word, no name was found, and "Carlos Mendes led…"
 * reached the model with an empty audit. A "(Liz)" or '"Bob"' nickname, a
 * title-case "Doe, Jane" and "Engineer | Jane Doe" were missed the same way.
 * Contact rules knew only US and UK shapes: a 9-digit Spanish mobile, a
 * German, French or Dutch street, and every non-US postcode went through.
 *
 * The PDF case runs a generated file through pdf.js and parse-pdf's own
 * page-text module, then through the redaction Shortlist sends the model.
 */
import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { resolvePDFJS } from "pdfjs-serverless";
import { pageTextFromItems, type PdfTextItem } from "../../supabase/functions/parse-pdf/page-text";
import { redactForScoring } from "../../supabase/functions/_shared/redaction";

const feature = (r: ReturnType<typeof redactForScoring>, f: string) =>
  r.exclusionsApplied.find((e) => e.feature === f)?.count ?? 0;

async function letterSpacedHeaderPdf(): Promise<string> {
  const doc = new jsPDF();
  doc.setFontSize(22);
  doc.text("CARLOS", 15, 20);
  doc.text("MENDES", 60, 20);
  doc.setFontSize(11);
  doc.text("Software Engineer", 15, 30);
  doc.text("Carlos Mendes led a team of five engineers.", 15, 40);
  const data = new Uint8Array(doc.output("arraybuffer"));
  const { getDocument } = await resolvePDFJS();
  const pdf = await getDocument({ data, useSystemFonts: true }).promise;
  const page = await pdf.getPage(1);
  return pageTextFromItems((await page.getTextContent()).items as PdfTextItem[]);
}

describe("a letter-spaced header from a real PDF", () => {
  it("is read as the name, and the name is masked in the body too", async () => {
    const text = await letterSpacedHeaderPdf();
    // What the parser hands Shortlist: the header's two words with a gap.
    expect(text.split("\n")[0]).toMatch(/^CARLOS\s{2,}MENDES$/);
    const r = redactForScoring(text);
    expect(r.redacted).not.toMatch(/carlos|mendes/i);
    expect(r.redacted).toContain("led a team of five engineers.");
    expect(feature(r, "candidate_name")).toBeGreaterThanOrEqual(2);
  });
});

describe("every header shape the review found is masked everywhere", () => {
  const shapes: Array<{ text: string; gone: RegExp }> = [
    { text: "Carlos  Mendes\nEngineer\n\nCarlos Mendes led.", gone: /carlos|mendes/i },
    { text: "MARIA   GONZALEZ\nEngineer\n\nMaria Gonzalez led.", gone: /maria|gonzalez/i },
    { text: "Maria\tGonzalez\nEngineer\n\nMaria Gonzalez led.", gone: /maria|gonzalez/i },
    { text: "Jane  Doe | 555-123-4567\nEngineer\n\nJane Doe led.", gone: /jane|doe|555/i },
    { text: "Elizabeth (Liz) Warren\nEngineer\n\nLiz Warren led. Elizabeth Warren shipped.", gone: /elizabeth|liz|warren/i },
    { text: 'Robert "Bob" Jones\nEngineer\n\nBob Jones led. Robert Jones shipped.', gone: /robert|bob|jones/i },
    { text: "Gonzalez, Maria\nEngineer\n\nMaria Gonzalez led.", gone: /maria|gonzalez/i },
    { text: "Doe, Jane\nEngineer\n\nJane Doe led.", gone: /jane|doe/i },
    { text: "DOE, JANE\nEngineer\n\nJane Doe led.", gone: /jane|doe/i },
    { text: "Senior Software Engineer | Jane Doe\nAcme\n\nJane Doe led.", gone: /jane|doe/i },
  ];
  for (const s of shapes) {
    it(JSON.stringify(s.text.split("\n")[0]), () => {
      const r = redactForScoring(s.text);
      expect(r.redacted).not.toMatch(s.gone);
      expect(feature(r, "candidate_name")).toBeGreaterThan(0);
    });
  }

  it("still ends a name at a column gap, and keeps the title beside it", () => {
    const r = redactForScoring("Jane Doe        Software Engineer\n\nJane led the team.");
    expect(r.redacted).toBe("[CANDIDATE]        Software Engineer\n\n[CANDIDATE] led the team.");
  });

  it("prefers a name on its own line to an employer after a title", () => {
    const r = redactForScoring("Senior Software Engineer | Acme Labs\nJane Doe\n\nJane led. Acme Labs grew.");
    expect(r.redacted).toContain("Acme Labs grew.");
    expect(r.redacted).not.toMatch(/jane|doe/i);
  });

  it("never reads a skills list or a town and region as a surname and a given name", () => {
    for (const text of ["Python, Java, SQL\nBuilt Java services.", "Mumbai, Maharashtra\nBuilt Java services.", "Sydney NSW 2000\nBuilt Java services."]) {
      const r = redactForScoring(text);
      expect(r.redacted, text).toContain("Built Java services.");
      expect(feature(r, "candidate_name"), text).toBe(0);
    }
  });
});

describe("contact details in the site's own locales do not reach the model", () => {
  const lines: Array<{ text: string; gone: RegExp; keep: string; features: string[] }> = [
    { text: "Calle Gran Vía 28, 28013 Madrid | 612 345 678", gone: /Gran|28013|612/, keep: "Madrid", features: ["street_address", "zip_code", "phone"] },
    { text: "Hauptstraße 12, 10115 Berlin", gone: /Haupt|10115/, keep: "Berlin", features: ["street_address", "zip_code"] },
    { text: "12 rue de Rivoli, 75001 Paris", gone: /Rivoli|75001/, keep: "Paris", features: ["street_address", "zip_code"] },
    { text: "Keizersgracht 123, 1015 CJ Amsterdam", gone: /Keizers|1015|CJ/, keep: "Amsterdam", features: ["street_address", "zip_code"] },
    { text: "Flat 4B, MG Road, Bengaluru 560001", gone: /4B|MG Road|560001/, keep: "Bengaluru", features: ["street_address", "zip_code"] },
    { text: "Sydney NSW 2000", gone: /2000/, keep: "Sydney", features: ["zip_code"] },
    { text: "〒150-0002 Tokyo", gone: /150-0002/, keep: "Tokyo", features: ["zip_code"] },
    { text: "GitHub: jdoe-dev", gone: /jdoe/, keep: "GitHub", features: ["profile_url"] },
    { text: "Móvil: 612 345 678 · Tél : 06 12 34 56 78 · Handy: 0151 1234567", gone: /612|06 12|0151/, keep: "Móvil", features: ["phone"] },
  ];
  for (const l of lines) {
    it(l.text, () => {
      const r = redactForScoring(`Jane Doe\n${l.text}\n\nEXPERIENCE\nShipped the billing platform.`);
      expect(r.redacted).not.toMatch(l.gone);
      expect(r.redacted).toContain(l.keep);
      expect(r.redacted).toContain("Shipped the billing platform.");
      for (const f of l.features) expect(feature(r, f), f).toBeGreaterThan(0);
    });
  }

  it("keeps the same shapes below the header, where they are metrics and employers", () => {
    const body = "Managed 15000 Users across 1024 MB caches; ticket 612 345 678; Via Rail 2019; GitHub: Actions pipelines.";
    const r = redactForScoring(`Jane Doe\nEngineer\n\nEXPERIENCE\n${body}`);
    expect(r.redacted).toContain(body);
  });
});
