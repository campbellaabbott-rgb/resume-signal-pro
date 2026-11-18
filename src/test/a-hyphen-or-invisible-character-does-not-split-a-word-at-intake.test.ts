// @vitest-environment node
//
// Node, not jsdom: the handler half bundles parse-docx with esbuild, which
// refuses jsdom's TextEncoder (helpers/edge-harness.ts).
/**
 * A HYPHEN OR AN INVISIBLE CHARACTER DOES NOT SPLIT A WORD AT INTAKE
 * (S14X-280, C-S14-129).
 *
 * Word writes a non-breaking hyphen (Ctrl+Shift+-) and an optional hyphen
 * (Ctrl+-) as their own elements, which mammoth turns into U+2011 and U+00AD;
 * PDFs carry U+2010/U+2011, soft hyphens, zero-width spaces and joiners, and
 * NFKC turns U+2011 into U+2010 rather than "-". The scanner's keyword match
 * then missed "co-founded", "Kubernetes" and "Python" written that way, and a
 * word a line break split after its hyphen ("manage-" / "ment") was two
 * words.
 *
 * normalizeIntakeText (supabase/functions/_shared/text-validation.ts) makes
 * those hyphens "-", drops the invisible marks, and joins "letter-" at a
 * line end to a lowercase word on the next line, keeping the hyphen (the
 * scanner treats a hyphen as optional). parse-docx applies it before its
 * length check, parse-pdf to the whole text, and the page's .txt reader to
 * what it decodes.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import JSZipNpm from "jszip";
import * as tv from "../../supabase/functions/_shared/text-validation";
import { hyphensDocx, HYPHENS, type ZipClass } from "../../supabase/functions/parse-docx/docx-fixtures";
import { parserHarness, type ParserHarness } from "./helpers/parser-handlers";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const normalize = (tv as unknown as { normalizeIntakeText?: (s: string) => string }).normalizeIntakeText;

describe("normalizeIntakeText", () => {
  it("exists beside looksGarbled", () => {
    expect(typeof normalize).toBe("function");
  });

  it("makes the dash forms '-', drops invisible marks, and joins a word split after its hyphen", () => {
    expect(normalize!("Kuber\u00ADnetes CI\u2011CD Py\u200Bthon manage-\nment")).toBe("Kubernetes CI-CD Python manage-ment");
    expect(normalize!("cross-\nfunctional teams")).toBe("cross-functional teams");
    expect(normalize!("start\u2010up\u2060 \uFEFFowner\u2012led")).toBe("start-up owner-led");
  });

  it("leaves a line that ends in a dash before a heading, a date or a bullet as two lines", () => {
    const kept = "Senior Engineer -\nLed a team\n2019-\n2020\nSelf-\nMotivated\nskills -\nleadership";
    expect(normalize!(kept)).toBe(kept);
  });

  it("leaves an ordinary résumé exactly as it was", () => {
    const plain = "Jane Doe\njane@example.com | +1 (415) 555-0134\n\nEXPERIENCE\n• Cut costs 18% — in 2023–2024\n";
    expect(normalize!(plain)).toBe(plain);
  });
});

// ── parse-docx, run with only its network faked ─────────────────────────────

const Zip = JSZipNpm as unknown as ZipClass;
let docx: ParserHarness;
beforeAll(async () => { docx = await parserHarness("parse-docx"); });

describe("parse-docx, run", () => {
  it("a Word document with non-breaking and optional hyphens answers plain words", async () => {
    const r = await docx.upload("resume.docx", await hyphensDocx(Zip));
    expect(r.status).toBe(200);
    const text = String(r.body.text);
    expect(text).toContain(HYPHENS.cofounded);
    expect(text).toContain(HYPHENS.implemented);
    expect(text).not.toMatch(/[\u00AD\u2010-\u2012]/);
  });
});
