// @vitest-environment node
//
// Node, not jsdom: the handler half bundles parse-docx with esbuild, which
// refuses jsdom's TextEncoder (helpers/edge-harness.ts).
/**
 * A CONTACT BLOCK ONLY IN THE WORD HEADER IS REPORTED (RC-S13-036, parser half).
 *
 * parse-docx adds the page header's and footer's lines to the body (L5-07), so
 * the scanner finds an email kept in the header. An applicant tracking system
 * that reads the body only does not, and the report could not say so: the
 * answer did not tell the page where the contact details came from. parse-docx
 * now answers contactOnlyInHeader: true when the body itself holds no email or
 * phone and the header or footer lines do; the page (free-scan-page's half)
 * warns from that flag. Absent otherwise, so an older page reads nothing new.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { contactOnlyInHeader } from "../../supabase/functions/parse-docx/header-footer";
import { HEADER_CONTACT, headerContactDocx, transitionalDocx, type ZipClass } from "../../supabase/functions/parse-docx/docx-fixtures";
import { parserHarness, type ParserHarness } from "./helpers/parser-handlers";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const Zip = JSZip as unknown as ZipClass;

describe("contactOnlyInHeader", () => {
  const none = { header: [] as string[], footer: [] as string[] };
  it("is true when only the header or footer has an email or a phone", () => {
    expect(contactOnlyInHeader("EXPERIENCE\nAnalyst", { header: ["Jo Ellis", "jo@example.com"], footer: [] })).toBe(true);
    expect(contactOnlyInHeader("EXPERIENCE\nAnalyst", { header: [], footer: ["+44 20 7946 0958"] })).toBe(true);
  });
  it("is false when the body has one, or nothing has one", () => {
    expect(contactOnlyInHeader("jo@example.com\nEXPERIENCE", { header: ["jo@example.com"], footer: [] })).toBe(false);
    expect(contactOnlyInHeader("Call (415) 555-0134\nEXPERIENCE", { header: ["jo@example.com"], footer: [] })).toBe(false);
    expect(contactOnlyInHeader("EXPERIENCE\nAnalyst 2019-2021", { header: ["Page 1 of 2"], footer: ["2019 - 2024"] })).toBe(false);
    expect(contactOnlyInHeader("EXPERIENCE", none)).toBe(false);
  });
});

let docx: ParserHarness;
beforeAll(async () => { docx = await parserHarness("parse-docx"); });

describe("parse-docx, run", () => {
  it("a résumé whose email and phone are only in the page header says so, and still carries them", async () => {
    const r = await docx.upload("resume.docx", await headerContactDocx(Zip));
    expect(r.status).toBe(200);
    expect(r.body.contactOnlyInHeader).toBe(true);
    expect(String(r.body.text)).toContain(HEADER_CONTACT.email);
  });

  it("a body that has the email too, and an ordinary document, carry no flag", async () => {
    for (const bytes of [await headerContactDocx(Zip, { inBody: true }), await transitionalDocx(Zip)]) {
      const r = await docx.upload("resume.docx", bytes);
      expect(r.status).toBe(200);
      expect("contactOnlyInHeader" in r.body).toBe(false);
    }
  });
});
