import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A PAY-SORTED SEARCH CRASHED THE ENTIRE JOBS PAGE, LIVE, FOR EVERY VISITOR.
 *
 * Measured on production 2026-08-22:
 *   https://resumebooster.work/jobs?q=nurse&sort=salary
 *   -> "Something went wrong. An unexpected error occurred."
 *   -> TypeError: Cannot read properties of undefined (reading 'length')
 *      at Jobs (src/pages/Jobs.tsx)
 * No results, no filters, no page. Every pay-sorted keyword search was a dead
 * screen — on the exact surface the previous release note advertised as fixed.
 *
 * THE MECHANISM, AND WHY EVERY EXISTING CHECK MISSED IT.
 * Jobs.tsx read `data.failedSources.length` with no optional chaining. That was
 * correct as far as TypeScript could tell: the client's response interface
 * declared `failedSources: string[]`, non-optional. But the SALARY exit — added
 * later, to fix salary-sorted relevance — returned a hand-written object literal
 * that simply did not include the field. Two more exits (the routed
 * EMPLOYER/SIMPLE tier and the exact-word tier) had the same hole, and the
 * offset-past-the-end return was missing seven fields.
 *
 * Nothing could catch it:
 *   - `tsc` type-checks the client against a type the client itself declares.
 *     It never sees the server.
 *   - `deno check` type-checks the server, which builds these literals ad hoc
 *     and has no shared type for them.
 *   - Every unit test asserted values, not SHAPE.
 * The runtime boundary between two separately-typed programs is exactly where a
 * type checker stops being evidence, and this repo keeps finding defects there.
 *
 * TWO INDEPENDENT FIXES, because either alone leaves the trap armed:
 *   1. the client field is OPTIONAL, so the compiler demands the guard; and
 *   2. every list exit emits the whole shape, asserted below.
 * A field is only safely non-optional if EVERY exit sends it, and nothing but
 * this file checks that.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const JOBS_RAW = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");

/**
 * Comments stripped before any scan.
 *
 * Not a nicety — writing the literal a guard searches for, inside a comment
 * ABOUT that guard, has now broken a build five times in this repo (a neutered
 * migration naming a parameter, a function name in prose, a function name in a
 * comment, a migration comment quoting the assertions it had to satisfy, and
 * the header of this very file describing the crash it prevents). Prose that
 * documents a rule must never be counted as an instance of it.
 */
const JOBS = JOBS_RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Brace-match every `return json({ ... })` that carries rows — i.e. a list exit. */
function listExits(): Array<{ line: number; block: string }> {
  const out: Array<{ line: number; block: string }> = [];
  for (const m of FN.matchAll(/return json\(\{/g)) {
    const i = m.index!;
    let depth = 0, j = i;
    for (; j < FN.length; j++) {
      if (FN[j] === "{") depth++;
      else if (FN[j] === "}" && --depth === 0) break;
    }
    const block = FN.slice(i, j + 1);
    if (block.includes("jobs:")) out.push({ line: FN.slice(0, i).split("\n").length, block });
  }
  return out;
}

/**
 * The shape the client's response interface promises on every list response.
 * `searchId` and `jobs` are shorthand-spread in places, so both spellings count.
 */
const CORE = [
  "jobs:", "total:", "hasMore:", "nextOffset:", "totalAllCompanies:",
  "companies:", "companiesCount:", "categories:", "failedSources:", "refreshedAt:",
];

describe("every list exit ships the whole shape", () => {
  const exits = listExits();

  it("finds all the list exits", () => {
    // If the matcher rots, every assertion below passes on an empty array —
    // which is the failure mode the whole file is about.
    expect(exits.length, "no list exits found — the brace matcher has rotted").toBeGreaterThanOrEqual(8);
  });

  it("no exit omits a field the client's type declares non-optional", () => {
    const bad = exits
      .map((e) => ({ line: e.line, missing: CORE.filter((k) => !e.block.includes(k)) }))
      .filter((e) => e.missing.length);
    expect(
      bad,
      "these list exits return a short shape:\n" +
        bad.map((b) => `  index.ts:${b.line} missing ${b.missing.map((m) => m.replace(":", "")).join(", ")}`).join("\n") +
        "\nAdd the fields. An exit that omits one is a breaking change no type checker on " +
        "either side of the wire can see — it crashed production on 2026-08-22.",
    ).toEqual([]);
  });

  it("every exit carries searchId, so a click can be attributed", () => {
    for (const e of exits) {
      expect(
        /\bsearchId\b/.test(e.block),
        `index.ts:${e.line} returns rows with no searchId — clicks on this page are unattributable`,
      ).toBe(true);
    }
  });

  it("the client treats the volatile fields as optional", () => {
    // The compiler is the only thing that will keep the guard in place at every
    // future read site. If someone re-declares these non-optional to silence a
    // `?.`, the crash comes straight back.
    expect(JOBS).toMatch(/failedSources\?: string\[\];/);
    expect(JOBS).toMatch(/categories\?: Record<string, number>;/);
    expect(JOBS).toMatch(/data\.failedSources\?\.length \?\? 0/);
  });

  it("no unguarded .length on a response field anywhere in the page", () => {
    // The general form of the crash: `data.<field>.length` where nothing on the
    // line established that <field> is there. A same-line `Array.isArray(...)`
    // or truthiness check IS a guard and is accepted — the defect was the total
    // absence of one, not the particular syntax used.
    const bad: string[] = [];
    JOBS.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(/\bdata\.(\w+)\.length\b/g)) {
        const f = m[1];
        const guarded =
          new RegExp(`Array\\.isArray\\(data\\??\\.${f}\\)`).test(line) ||
          new RegExp(`data\\?\\.${f}\\s*&&`).test(line) ||
          new RegExp(`data\\.${f}\\s*&&`).test(line);
        if (!guarded) bad.push(`Jobs.tsx:${i + 1}  ${m[0]}`);
      }
    });
    expect(
      bad,
      `unguarded reads that throw the moment one exit omits the field:\n  ${bad.join("\n  ")}`,
    ).toEqual([]);
  });
});
