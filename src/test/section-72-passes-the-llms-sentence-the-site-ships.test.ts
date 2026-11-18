// SECTION 72 PASSES THE llms.txt SENTENCE THE SITE SHIPS.
//
// Section 72 judges llms.txt's report-cache sentence by its exact words. The
// data-pages lane (round A, deployed 2026-11-18) rewrote that sentence to say
// "returns the same full report", because a partial report is not kept; 72
// still looked only for "returns the same report", so the verifier printed
// "llms.txt carries neither sentence" against a file that was right.
//
// This reads the PASS phrases 72 accepts and requires the shipped file
// (public/llms.txt) to carry one of them, and none of the phrases 72 FAILs.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/72-wave3-scan-ai.sh"), "utf8");
const LLMS = readFileSync(resolve(ROOT, "public/llms.txt"), "utf8");

/** Each `"$LLMS72" | grep -qF "<phrase>"; then echo "<VERDICT>` branch, as [phrase, verdict]. */
function branches(): [string, string][] {
  const re = /printf '%s' "\$LLMS72" \| grep -qF "([^"]+)"; then echo "(PASS|FAIL|INFO)/g;
  return [...SECTION.matchAll(re)].map((m) => [m[1], m[2]]);
}

describe("section 72's llms.txt sentence check", () => {
  it("reads at least one PASS phrase and one FAIL phrase (the parse found the block)", () => {
    const b = branches();
    expect(b.filter(([, v]) => v === "PASS").length).toBeGreaterThanOrEqual(1);
    expect(b.filter(([, v]) => v === "FAIL").length).toBeGreaterThanOrEqual(1);
  });

  it("public/llms.txt carries a phrase 72 passes", () => {
    const pass = branches().filter(([, v]) => v === "PASS").map(([p]) => p);
    expect(pass.some((p) => LLMS.includes(p)), `none of ${JSON.stringify(pass)} is in public/llms.txt`).toBe(true);
  });

  it("public/llms.txt carries no phrase 72 fails", () => {
    for (const [p, v] of branches()) if (v === "FAIL") expect(LLMS.includes(p), p).toBe(false);
  });

  it("TEETH: the old sentence alone would not have passed against today's file", () => {
    expect(LLMS.includes("same job posting within 7 days returns the same report")).toBe(false);
    expect(LLMS.includes("same job posting within 7 days returns the same full report")).toBe(true);
  });
});
