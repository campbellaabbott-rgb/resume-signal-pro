/**
 * EVERY LANGUAGE'S "READY TO APPLY" IS READY (RC-S12-113).
 *
 * The Game Plan's own prompt cites "Listo para postularte" as a verdict a
 * Spanish reader may be written, and a Hindi model answers the full phrase
 * "आवेदन करने के लिए तैयार". Neither was on the synonym list, so the verdict
 * folded to nothing: the page drew the not-ready card with a blank badge for
 * a buyer the report had called ready.
 *
 * Run against both copies of the shape module (the page's and the
 * generators'), which must stay byte-identical.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalReportEnum as pageCanonical } from "@/lib/career-report-shape";
import { canonicalReportEnum as serverCanonical } from "../../supabase/functions/_shared/career-report-shape";

const READY = [
  "Listo para postularte",
  "Lista para postularte",
  "listo para postularte.",
  "आवेदन करने के लिए तैयार",
];

describe("the Ready to Apply verdict in the languages the generators write", () => {
  for (const said of READY) {
    it(`'${said}' is Ready to Apply on the page and in the generators`, () => {
      expect(pageCanonical("verdict", said)).toBe("Ready to Apply");
      expect(serverCanonical("verdict", said)).toBe("Ready to Apply");
    });
  }

  it("the page's copy and the generators' copy are one file", () => {
    const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
    expect(read("src/lib/career-report-shape.ts")).toBe(read("supabase/functions/_shared/career-report-shape.ts"));
  });
});
