// @vitest-environment node
/**
 * AN INVISIBLE CHARACTER NEVER TURNS THE PDF INTO A WORD FILE WORD CANNOT OPEN
 * (S14X-034: M-S14-035, M-S14-163, C-S14-045).
 *
 * WHAT WAS WRONG. The PDF's built-in fonts draw only Windows-1252, so the
 * builder saves a Word file instead whenever a résumé holds a character they
 * cannot draw (S12-006). Text pasted from Word, a PDF or a web page carries
 * characters nobody sees: a soft line break (U+000B, Shift+Enter in Word), a
 * zero-width space, a byte-order mark, the "fi" ligature a PDF extracts as
 * one character, a non-breaking hyphen, a minus sign. Each one alone sent the
 * person a Word file instead of the PDF they asked for, and the soft line
 * break went into the Word file raw: XML 1.0 forbids U+000B, so Word refused
 * to open the file at all.
 *
 * WHAT HOLDS NOW. Every résumé string passes through sanitizeExportText
 * before the PDF check and before either file is drawn: a soft break is a
 * line break, the invisible format characters are gone, ligatures and the
 * Unicode hyphens are their ASCII letters. What the fonts really cannot draw
 * (Ł) is still reported, and drawable characters (½, ™, ²) are left alone,
 * which NFKC would not have done (½ becomes 1⁄2, whose slash is undrawable).
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { Packer } from "docx";
import { buildResumeDocxDocument, buildResumePdf, resumePdfUnsupported } from "../lib/resume-builder-export";
import { sanitizeExportText, unsupportedPdfCharacters } from "../lib/pdf-text-support";
import type { BuilderResume } from "../types/resume-builder";

const resume = (bullets: string[], over: Partial<BuilderResume> = {}): BuilderResume => ({
  contact: { fullName: "Jordan Probe", title: "Analyst", email: "jordan@example.com", phone: "", location: "Austin, TX", linkedIn: "", website: "" },
  summary: "Analyst with five years of work on the team.",
  experience: [{ id: "e1", company: "Acme", title: "Analyst", location: "", startDate: "2020", endDate: "2024", bullets }],
  education: [{ id: "d1", school: "State University", degree: "BS", field: "Economics", startDate: "", endDate: "2019", details: "" }],
  skills: ["SQL", "Python"],
  certifications: [],
  ...over,
});

const documentXml = async (r: BuilderResume) => {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(await buildResumeDocxDocument(r)));
  return zip.file("word/document.xml")!.async("string");
};

/** Every character XML 1.0 refuses in a document (the C0 controls but tab, newline and return). */
// eslint-disable-next-line no-control-regex -- the characters XML refuses are what this test looks for
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;

describe("a pasted soft line break (M-S14-035)", () => {
  const SOFT = "Led a team\u000Bof five analysts across two offices.";

  it("no longer blocks the PDF", async () => {
    expect(resumePdfUnsupported(resume([SOFT]))).toEqual([]);
    const pdf = await buildResumePdf(resume([SOFT]));
    expect(pdf.output("arraybuffer").byteLength).toBeGreaterThan(1500);
  });

  it("never reaches the Word file's XML, where it would stop Word opening it", async () => {
    const xml = await documentXml(resume([SOFT, "Form\u000Cfeed and a\u0007bell"]));
    expect(XML_INVALID.test(xml), "document.xml holds a character XML 1.0 forbids").toBe(false);
    expect(xml).toContain("Led a team");
    expect(xml).toContain("of five analysts");
  });
});

describe("invisible format characters, ligatures and Unicode hyphens (M-S14-163, C-S14-045)", () => {
  it("are normalised before the check, so the PDF is drawn", () => {
    const r = resume(["Cut costs\u200B by 12% in the ofﬁce\uFEFF", "Ran e‑commerce and − 2% churn work", "Staﬀ of 4\u202F%"]);
    expect(resumePdfUnsupported(r)).toEqual([]);
  });

  it("each maps to what it showed", () => {
    expect(sanitizeExportText("ofﬁce")).toBe("office");
    expect(sanitizeExportText("ﬀ ﬂ ﬃ ﬄ")).toBe("ff fl ffi ffl");
    expect(sanitizeExportText("e‑commerce ‐ ‒ −5")).toBe("e-commerce - - -5");
    expect(sanitizeExportText("\uFEFFword\u200B\u2060")).toBe("word");
    expect(sanitizeExportText("Ｓａｌｅｓ\u3000２０２４")).toBe("Sales 2024");
    expect(sanitizeExportText("a\u000Bb\u2028c\u2029d")).toBe("a\nb\nc\nd");
  });

  it("an Indic joiner, a CJK résumé's full-width punctuation and right-to-left marks are kept", () => {
    expect(sanitizeExportText("क्\u200Dष")).toBe("क्\u200Dष");
    expect(sanitizeExportText("数据分析（三年）")).toBe("数据分析（三年）");
    expect(sanitizeExportText("مهندس\u200F 2020")).toBe("مهندس\u200F 2020");
  });

  it("is idempotent, and leaves a lone surrogate out of the Word file", () => {
    const once = sanitizeExportText("x\uD800y\u0085z ofﬁce");
    expect(sanitizeExportText(once)).toBe(once);
    expect(once).toBe("xy\nz office");
  });
});

describe("the controls stay as they were", () => {
  it("a letter the fonts really cannot draw is still reported (S12-006)", () => {
    expect(resumePdfUnsupported(resume([], { contact: { ...resume([]).contact, fullName: "Łukasz Wójcik" } }))).toEqual(["Ł"]);
  });

  it("½, ™ and ² stay drawable and unchanged (NFKC would break them)", () => {
    const line = "Cut ½ of the cost of the ACME™ line, 20 m² of floor.";
    expect(sanitizeExportText(line)).toBe(line);
    expect(unsupportedPdfCharacters(sanitizeExportText(line))).toEqual([]);
    expect(resumePdfUnsupported(resume([line]))).toEqual([]);
  });
});
