// @vitest-environment node
//
// Node, not jsdom: pdfjs-serverless mistakes jsdom for a browser, and the
// handler half bundles the functions with esbuild, which refuses jsdom's
// TextEncoder (helpers/edge-harness.ts).
/**
 * A LINKED EMAIL AND PROFILE KEEP THEIR ADDRESS (S14X-147, M-S14-122).
 *
 * Résumé templates write contact details as links: the visible text says
 * "Email", "LinkedIn" or "GitHub" and the address lives only in the link.
 * parse-pdf read the page's text and never its link annotations, and mammoth's
 * raw text keeps a link's text and drops its target, so a résumé built that
 * way reached the scanner with no email and no profile URL. Both parsers now
 * collect the link targets the text does not already show and append them as
 * one last line, "Links: jo@example.com | https://…": mailto, http and https
 * only, the mailto: prefix dropped, each address once.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import mammoth from "mammoth";
import JSZip from "jszip";
import { linksLine as pdfLinksLine } from "../../supabase/functions/parse-pdf/page-text";
import { linksLine as docxLinksLine, readDocxBody } from "../../supabase/functions/parse-docx/docx-text";
import { LINKS, linksDocx, transitionalDocx, type ZipClass } from "../../supabase/functions/parse-docx/docx-fixtures";
import { deriveContact } from "@/lib/resumeContact";
import { parserHarness, type ParserHarness } from "./helpers/parser-handlers";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const Zip = JSZip as unknown as ZipClass;
const libs = { mammoth: mammoth as never, JSZip: JSZip as never };
const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);

describe("the links line (the same rule in both parsers)", () => {
  for (const [name, linksLine] of [["parse-pdf", pdfLinksLine], ["parse-docx", docxLinksLine]] as const) {
    it(`${name}: keeps mailto/http/https targets the text does not show, once each`, () => {
      const text = "Jo Ellis\nEmail | LinkedIn | Portfolio: jo.example.com/work/\n";
      expect(linksLine([
        "mailto:jo@example.com",
        "https://www.linkedin.com/in/jo-ellis",
        "https://www.linkedin.com/in/jo-ellis/",
        "MAILTO:Jo@Example.com?subject=Hi",
        "https://jo.example.com/work",
        "javascript:alert(1)",
        "file:///C:/cv.pdf",
        "#experience",
      ], text)).toBe("Links: jo@example.com | https://www.linkedin.com/in/jo-ellis");
    });
    it(`${name}: nothing to add is no line`, () => {
      expect(linksLine([], "x")).toBe("");
      expect(linksLine(["mailto:jo@example.com"], "write to jo@example.com")).toBe("");
    });
    it(`${name}: a page of links is capped`, () => {
      const many = Array.from({ length: 40 }, (_, i) => `https://example.com/p/${i}`);
      const line = linksLine(many, "");
      expect(line.split(" | ").length).toBeLessThanOrEqual(10);
      expect(line.length).toBeLessThanOrEqual(1000);
    });
  }
});

describe("a Word document with linked contact details", () => {
  it("ends with the link targets, and the contact reader finds the email", async () => {
    const { body } = await readDocxBody(await linksDocx(Zip), libs);
    const last = lines(body).at(-1);
    expect(last).toBe(`Links: ${LINKS.email} | ${LINKS.linkedin} | ${LINKS.github}`);
    expect(deriveContact(body).email?.value).toBe(LINKS.email);
    // The portfolio link's address is its own text, so it is not repeated.
    expect(body.split(LINKS.portfolio).length).toBe(2);
  });

  it("a document with no links reads as it did", async () => {
    const { body } = await readDocxBody(await transitionalDocx(Zip), libs);
    expect(body).not.toContain("Links:");
  });
});

let pdf: ParserHarness;
beforeAll(async () => { pdf = await parserHarness("parse-pdf"); });

describe("parse-pdf, run", () => {
  it("a Chrome PDF whose email, LinkedIn and GitHub are links answers their addresses", async () => {
    const bytes = new Uint8Array(readFileSync(resolve(__dirname, "../../supabase/functions/parse-pdf/__fixtures__/chrome-en-links.pdf")));
    const r = await pdf.upload("resume.pdf", bytes);
    expect(r.status).toBe(200);
    const text = String(r.body.text);
    expect(deriveContact(text).email?.value).toBe("jordan.ellis@gmail.com");
    expect(text).toContain("https://www.linkedin.com/in/jordanellis-pm");
    expect(text).toContain("https://github.com/jellis");
    expect(text).not.toContain("mailto:");
  });
});
