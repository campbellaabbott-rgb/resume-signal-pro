/**
 * SETUP IS ONE STEP, AND THE LIST CAN ACTUALLY BE FINISHED.
 *
 * Two things made setup feel like work, and only one of them was the number of
 * fields:
 *
 *   1. Thirteen questions, most of which the uploaded CV already answered.
 *   2. A checklist that COULD NOT BE COMPLETED. "Name the employers to skip"
 *      counted as done only once blocked_companies had an entry, so anybody with
 *      nobody to exclude saw an unfinished list forever. An unfinishable list is
 *      worse than no list — it says "you are not set up" and never stops.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const checklist = readFileSync(
  resolve(__dirname, "../components/account/AgentSetupChecklist.tsx"), "utf8");
const code = checklist.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("every column the checklist reads is one it selected", () => {
  it("does not judge a step on a column PostgREST was never asked for", () => {
    // THE TRAP, and I walked straight into it writing this feature: PostgREST
    // returns ONLY the named columns. A guard on an unselected one reads
    // `undefined` forever, so the step can never go green no matter what the
    // person does — and nothing errors, so there is nothing to debug.
    //
    // Same root cause as apply-broker's `active` check doing nothing for months.
    const sel = code.match(/\.select\("([^"]+)"\)/);
    expect(sel, "no .select() found — this guard has stopped guarding").not.toBeNull();
    const selected = new Set(sel![1].split(",").map((s) => s.trim()));

    // Every `m?.<column>` the component reads must appear in that list.
    const read = new Set(Array.from(code.matchAll(/\bm\?\.([a-z_]+)/g), (x) => x[1]));
    expect(read.size, "no column reads found — the extractor has drifted").toBeGreaterThan(0);
    for (const col of read) {
      expect(selected.has(col), `"${col}" is read but not selected — it will be undefined forever`).toBe(true);
    }
  });
});

describe("the one required step is the résumé", () => {
  it("the first step turns on the CV alone", () => {
    expect(code).toMatch(/profileReady\s*=\s*!!String\(m\?\.resume_file_url/);
  });

  it("it no longer demands a name and phone the CV already supplies", () => {
    const line = code.slice(code.indexOf("profileReady"), code.indexOf("mandateActive"));
    expect(line).not.toMatch(/full_name/);
    expect(line).not.toMatch(/phone/);
  });
});

describe("an optional step cannot hold the list open", () => {
  it("exclusions are marked optional", () => {
    expect(code).toMatch(/id: "exclusions".*optional: true/s);
  });

  it("completion, the count and the next prompt all ignore optional steps", () => {
    // All three must agree. If completion ignored optional steps but `next`
    // did not, the button would point at a step that never completes.
    expect(code).toMatch(/const required = steps\.filter\(\(s\) => !s\.optional\)/);
    expect(code).toMatch(/required\.every\(\(s\) => s\.done\)/);
    expect(code).toMatch(/doneCount = required\./);
    expect(code).toMatch(/const next = required\.find/);
  });

  it("the count is out of the REQUIRED steps, not every rendered row", () => {
    // "1 of 3" when only two are required reads as unfinished work that does
    // not exist — the exact feeling this change is meant to remove.
    expect(code).toMatch(/total: required\.length/);
    expect(code).not.toMatch(/total: steps\.length/);
  });
});
