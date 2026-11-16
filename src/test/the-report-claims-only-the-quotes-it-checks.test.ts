/**
 * THE REPORT CLAIMS ONLY THE QUOTES IT CHECKS (S14X-269).
 *
 * The landing FAQ, the comparison pages and the free report's PDF summary
 * said every quoted line is verified against the résumé. The scanner checks
 * its rewrites and the bullet each one quotes; the "Triggered by" lines under
 * the interview questions are not checked (free-scan-engine grounds those
 * later). Until then the copy names what is checked.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("no page in this lane claims every quoted line is verified", () => {
  for (const f of ["src/data/tool-landings.ts", "src/data/competitors.ts", "src/components/FreeKeywordResults.tsx"]) {
    it(f, () => {
      const src = read(f);
      expect(src).not.toMatch(/every quoted line/i);
      expect(src).not.toMatch(/Cada cita se verifica/);
    });
  }
  it("the landing FAQ names the rewrites and the lines they quote", () => {
    expect(read("src/data/tool-landings.ts")).toContain("Every rewritten bullet, and the original line it quotes, is checked against your actual document");
  });
});
