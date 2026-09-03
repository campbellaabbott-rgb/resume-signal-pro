import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * USAJOBS IS THE FIRST SINGLE-SOURCE VENDOR ON THE BOARD.
 *
 * Every other adapter is per-employer: one tenant, one company. The federal
 * API is ONE national feed carrying thousands of agencies, which breaks two
 * assumptions the board makes everywhere else, and this file pins both fixes:
 *
 *  1. THE AGENCY IS THE EMPLOYER. Without that, the company facet grows a
 *     single ~15,000-job blob called "USAJOBS" and every company page, filter
 *     and hiring-health stat about federal work becomes meaningless.
 *  2. FEDERAL POSTINGS ARE NEVER AGENT-SENDABLE. Applications run through
 *     USAJOBS accounts and agency assessments; badging them agent-ready would
 *     be the countable-claims promise broken on 15,000 jobs at once.
 *
 * Plus the config-gap rule: a missing API key must NOT throw. Throwing marks
 * the board failed, and the dormancy prune deletes failed boards' postings —
 * so an unset secret would quietly delete every federal job.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const NORM = readFileSync(resolve(ROOT, "supabase/functions/job-board/normalize.ts"), "utf8");
const SRC = readFileSync(resolve(ROOT, "supabase/functions/job-board/sources.ts"), "utf8");

describe("federal postings are honest, attributed, and never agent-ready", () => {
  it("carries exactly one USAJOBS source — it is a single national feed", () => {
    // 2026-09-03: matched `source: "usajobs"` until the compaction respelled
    // the entry as an s(...) call — same parser trap as the other suites.
    const hits = SRC.match(/"usajobs"/g) ?? [];
    expect(hits.length).toBe(1);
    expect(SRC).toMatch(/\| "usajobs";/);
  });

  it("attributes each posting to its AGENCY, never to a 'USAJOBS' blob", () => {
    const fn = /export function normalizeUsajobs\([\s\S]*?\n}/.exec(NORM)?.[0] ?? "";
    expect(fn, "normalizeUsajobs not found").not.toBe("");
    expect(fn).toMatch(/OrganizationName \?\? d\.DepartmentName/);
    // company must come from the agency variable, not the source name.
    expect(fn).toMatch(/company: agency \|\| "U\.S\. Federal Government"/);
    expect(fn).not.toMatch(/company: "USAJOBS"/);
  });

  it("is absent from the agent's sendable vendors", () => {
    // The sendable set is computed from the worker's drivable vendors; usajobs
    // must never appear in it. Search the whole function for a sendable list
    // that names it.
    const sendableMentions = FN.match(/sendable[\s\S]{0,300}usajobs/gi) ?? [];
    expect(sendableMentions.length, "usajobs must not appear near sendable logic").toBe(0);
  });

  it("treats a missing API key as a skip, never as a board failure", () => {
    const branch = FN.slice(FN.indexOf('if (s.source === "usajobs")'));
    const body = branch.slice(0, branch.indexOf('if (s.source === "rippling")'));
    expect(body).toMatch(/if \(!key \|\| !ua\) \{/);
    // Returns empty, does NOT throw — a throw marks the board failed and the
    // dormancy prune would delete every federal posting over a config gap.
    const guard = body.slice(body.indexOf("if (!key || !ua)"), body.indexOf("const PAGE"));
    expect(guard).toMatch(/return \{ jobs: \[\]/);
    expect(guard).not.toMatch(/throw/);
  });

  it("reads the government's own stated dates and structured pay", () => {
    const fn = /export function normalizeUsajobs\([\s\S]*?\n}/.exec(NORM)?.[0] ?? "";
    expect(fn).toMatch(/safeIso\(d\.PublicationStartDate\)/);
    expect(fn).toMatch(/PositionRemuneration/);
    // Salary only when BOTH bounds are real — never a half-range presented whole.
    expect(fn).toMatch(/min > 0 && max > 0/);
  });

  it("keeps the page-1-failure guard every paginated vendor has", () => {
    const branch = FN.slice(FN.indexOf('if (s.source === "usajobs")'));
    const body = branch.slice(0, branch.indexOf('if (s.source === "rippling")'));
    // An empty read against a non-zero advertised total is a refusal, not an
    // empty board — throwing here is correct and protects against the prune.
    expect(body).toMatch(/if \(all\.length === 0 && feedTotal > 0\) throw new Error/);
  });
});
