/**
 * THE GAP REPORT COUNTS GAPS AGAINST THE RÉSUMÉ MATCHING USES NOW (S13-093).
 *
 * WHAT WAS WRONG. /account's "What to fix next" counted every tracked
 * posting's stored fit_missing, measured against whichever résumé was newest
 * when the job was saved. After pinning another résumé (or scanning a better
 * one) the report still listed the old résumé's gaps, and handed them to the
 * builder with the new text. A posting the résumé fully matched (no missing
 * keywords) was dropped from "of N roles", so each share read too high.
 *
 * WHAT HOLDS NOW (src/lib/gap-report.ts, used by Account.tsx):
 *   - a stored fit counts only when its row was measured against the matching
 *     scan (pinned, else latest); against pasted text, none does;
 *   - the other rows with a posting are measured again (at most 12 a load),
 *     and those measurements are what count for them;
 *   - every measured row is in the denominator, fully matched ones included.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import {
  GAP_FITS_KEY, REMEASURE_PER_LOAD, gapBasisScanId, readGapFits, remeasureKey, resumeFingerprint, rowsToRemeasure, skillGapOf, writeGapFits,
  type GapRow,
} from "@/lib/gap-report";
import { PERSONAL_SESSION_KEYS } from "@/contexts/AuthContext";

const POSTING = "We need Kubernetes, Terraform and Go experience. ".repeat(4);
const row = (id: string, scan: string | null, missing: string[] | null, posting: string | null = POSTING): GapRow => ({
  id, scan_id: scan, fit_pct: missing === null ? null : 50, fit_missing: missing, job_posting: posting,
});
const scans = [{ id: "new", resume_text: "new résumé" }, { id: "old", resume_text: "old résumé" }];

beforeEach(() => sessionStorage.clear());

describe("which résumé's fits count", () => {
  it("the pinned scan if it is still in the history, else the latest; pasted text has none", () => {
    expect(gapBasisScanId({ scanId: null, text: null }, scans)).toBe("new");
    expect(gapBasisScanId({ scanId: "old", text: null }, scans)).toBe("old");
    expect(gapBasisScanId({ scanId: "gone", text: null }, scans)).toBe("new");
    expect(gapBasisScanId({ scanId: "old", text: "pasted" }, scans)).toBeNull();
  });
});

describe("the report", () => {
  // Four postings saved against the OLD résumé, all missing kubernetes; the
  // new résumé has it. Main counted "kubernetes: missing in 4 of 4".
  const rows = [
    row("a", "old", ["kubernetes", "terraform"]),
    row("b", "old", ["kubernetes", "terraform"]),
    row("c", "old", ["kubernetes"]),
    row("d", "old", ["kubernetes"]),
  ];

  it("does not count gaps measured against a résumé matching no longer uses", () => {
    expect(skillGapOf(rows, "new", {})).toBeNull();
    expect(rowsToRemeasure(rows, "new", {}).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("counts the rows measured again against the matching résumé instead, fully matched ones in the denominator", () => {
    const fresh = {
      a: { pct: 80, missing: ["terraform"] },
      b: { pct: 80, missing: ["terraform"] },
      c: { pct: 100, missing: [] },
      d: { pct: 100, missing: [] },
    };
    expect(skillGapOf(rows, "new", fresh)).toEqual({ top: [["terraform", 2]], withFit: 4 });
    expect(rowsToRemeasure(rows, "new", fresh)).toEqual([]);
  });

  it("stored fits measured against the matching scan count as they are, fully matched rows included", () => {
    const current = [row("a", "new", ["sql", "python"]), row("b", "new", ["sql"]), row("c", "new", []), row("d", "new", [])];
    expect(skillGapOf(current, "new", {})).toEqual({ top: [["sql", 2]], withFit: 4 });
  });

  it("a row with no posting to measure, and no current fit, is left out", () => {
    const noPosting = [row("a", "old", ["kubernetes"], null), row("b", "old", ["kubernetes"], "short")];
    expect(rowsToRemeasure(noPosting, "new", {})).toEqual([]);
    expect(skillGapOf([...noPosting, row("c", "new", ["x"]), row("d", "new", ["x"])], "new", {})).toBeNull();
  });

  it("measures at most a bounded number of rows a load", () => {
    const many = Array.from({ length: 40 }, (_, i) => row(`r${i}`, "old", ["k"]));
    expect(rowsToRemeasure(many, "new", {})).toHaveLength(REMEASURE_PER_LOAD);
  });

  it("starts again for a new posting or another version, not for a status change", () => {
    const base = [row("a", "old", ["k"])];
    const key = remeasureKey(base);
    expect(remeasureKey([{ ...base[0], status: "applied" } as GapRow])).toBe(key);
    expect(remeasureKey([{ ...base[0], job_posting: POSTING + " More." }])).not.toBe(key);
    expect(remeasureKey([{ ...base[0], scan_id: "new" }])).not.toBe(key);
  });
});

describe("this tab's measurements", () => {
  it("are kept per résumé, and a different résumé starts again", () => {
    const fp = resumeFingerprint("new résumé");
    writeGapFits(fp, { a: { pct: 80, missing: ["terraform"] } });
    expect(readGapFits(fp)).toEqual({ a: { pct: 80, missing: ["terraform"] } });
    expect(readGapFits(resumeFingerprint("another résumé"))).toEqual({});
  });

  it("are cleared at sign-out with the other personal copies", () => {
    expect(PERSONAL_SESSION_KEYS).toContain(GAP_FITS_KEY);
  });
});

describe("the account page", () => {
  it("builds its report from these rules, and measures stale rows with the matching résumé", () => {
    const code = codeOf(readFileSync(resolve(__dirname, "../pages/Account.tsx"), "utf8"));
    expect(code).toMatch(/skillGapOf\(applications, gapBasis, freshFits\)/);
    expect(code).toMatch(/rowsToRemeasure\(gapRowsRef\.current, gapBasis, fits\)/);
    expect(code).toMatch(/\[session, gapResume, gapBasis, gapRowsKey\]/);
    expect(code).toMatch(/resumeText=\{gapResume\}/);
  });
});
