// @vitest-environment node
/**
 * NEGATED SEARCH PHRASES: THE CORPUS IS A RECORD, AND THE SHIPPED ANSWER IS
 * ORIGIN/MAIN'S ON EVERY CASE (wave 4 descope, 2026-10-25; S12-017 left wave 4).
 *
 * WHAT HAPPENED. Four fix rounds changed how far "not" reaches (S12-017) and
 * how an excluded word strikes a title, and each recheck found inputs where
 * the round was worse than origin/main. The descope first took the title
 * folds out and kept rounds 3 and 4's split. Its recheck found that mix worse
 * than main as well, in ways a case-level score could not see: "clerk not a/p"
 * excluded nothing and searched the excluded titles, "technician not med/surg"
 * struck "Certified Med Tech", and "cashier not part time" or "nurse not night
 * shifts" kept the "Part-Time" and "Night Shift RN" titles main strikes. The
 * owner's rule for a heuristic that keeps failing its recheck is to put main's
 * behaviour back and make the rule its own project, so the whole exclusion
 * path is origin/main's again, byte for byte (the descope test proves the
 * text; this file proves the answers).
 *
 * WHAT THIS FILE CHECKS. On every query of the corpus
 * (fixtures/w4b-fix3-search/negated-phrases.json, 1,191 labelled queries) and
 * of the 75-query self-break set, the shipped splitExclusions gives exactly
 * origin/main's answer, and the shipped titleExcluded strikes exactly the
 * titles origin/main's strikes, over every title the case names plus the
 * titles generated from its label. It does not ask for improvement. The labels
 * stay as the record of what main's rule gets wrong, for the separate search
 * project: main answers 765 of the 1,191 right by its label (the split and the
 * titles both), and 22 of the 75 self-break queries.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { splitExclusions, titleExcluded } from "../../supabase/functions/job-board/search-routing";
import * as ORIGIN_MAIN from "./fixtures/w4b-fix3-search/origin-main-exclusion";

type Out = { positive: string; excluded: string[] };
type Case = {
  id: string; group: string; q: string; expect: Out; alsoAccept?: Out[]; strike?: string[]; keep?: string[]; reason: string;
  ambiguous?: string; source: string; main?: Out; correct: Record<"main" | "fa66a031" | "9af3c783" | "237bf2e8", boolean>;
  gap?: string; gapAnswer?: Out;
};
const FILE = JSON.parse(readFileSync(resolve(__dirname, "fixtures/w4b-fix3-search/negated-phrases.json"), "utf8")) as {
  meta: { measured: Record<string, number> }; cases: Case[];
};
const CASES = FILE.cases;
type SelfBreakCase = Case & { batch: 1 | 2 };
const SELF_BREAK = (JSON.parse(readFileSync(resolve(__dirname, "fixtures/w4b-fix3-search/self-break-round4.json"), "utf8")) as { cases: SelfBreakCase[] }).cases;

// The search lowercases and strips a word's edge punctuation, so two positives that differ only there search the same.
const STRIP = /^[,.;:!?()'‘’-]+|[,.;:!?()'‘’-]+$/g;
const normPos = (s: string) => s.toLowerCase().split(/\s+/).map((t) => t.replace(STRIP, "")).filter((t) => t && t !== "-").join(" ");
const normExc = (e: string) => e.toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();
const sameExc = (a: string[], b: string[]) => {
  const A = new Set(a.map(normExc)), B = new Set(b.map(normExc));
  return A.size === B.size && [...A].every((x) => B.has(x));
};
const tc = (s: string) => s.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
/** The titles a case names: its own lists, plus "E Head" / "Head - E" per labelled phrase and the head with each wanted word. */
function probes(c: Case): { strike: string[]; keep: string[] } {
  const pos = normPos(c.expect.positive).split(" ").filter(Boolean);
  const head = pos[0] ?? "x";
  return {
    strike: [...(c.strike ?? []), ...c.expect.excluded.flatMap((e) => [`${tc(e)} ${tc(head)}`, `${tc(head)} - ${tc(e)}`])],
    keep: [...(c.keep ?? []), tc(head), ...pos.slice(1).filter((t) => /^[a-z]/.test(t) && t !== "or" && t !== "not").map((t) => `${tc(head)} ${tc(t)}`)],
  };
}
/** Where the shipped answer to a case differs from origin/main's, or "" when they are the same, split and titles. */
function differsFromMain(c: Case): string {
  const got = splitExclusions(c.q), want = ORIGIN_MAIN.splitExclusions(c.q);
  if (JSON.stringify(got) !== JSON.stringify(want)) return `split ${JSON.stringify(got)}, origin/main ${JSON.stringify(want)}`;
  const { strike, keep } = probes(c);
  const off = [...strike, ...keep].filter((t) => titleExcluded(t, got.excluded) !== ORIGIN_MAIN.titleExcluded(t, want.excluded));
  return off.length ? `titles struck differently: ${JSON.stringify(off)}` : "";
}
/** Whether an answer is right by the case's label: the split, and every title it names struck or kept as labelled. */
function rightByLabel(c: Case): boolean {
  const got = splitExclusions(c.q);
  if (![c.expect, ...(c.alsoAccept ?? [])].some((a) => normPos(a.positive) === normPos(got.positive) && sameExc(a.excluded, got.excluded))) return false;
  const { strike, keep } = probes(c);
  return strike.every((t) => titleExcluded(t, got.excluded)) && !keep.some((t) => titleExcluded(t, got.excluded));
}

describe("the corpus is what it claims", () => {
  it("holds 1,191 labelled queries, every recheck input among them, the descope recheck's too", () => {
    expect(CASES.length).toBe(1191);
    expect(FILE.meta.measured.cases).toBe(1191);
    const qs = new Set(CASES.map((c) => c.q));
    for (const q of [
      "warehouse not forklift Dallas", "nurse not icu nyc", "barista not part-time Denver", "warehouse not forklift San Jose",
      "nurse not night shift, TX", "nurse not travel er", "nurse not night shift", "nurse not requiring night shifts",
      "producer not news Atlanta", "delivery driver not parts", "nurse not south florida", "nurse not travel or agency",
      "nurse not night shifts", "driver not box trucks", "agent not call centers", "rep not customer service",
      // The recheck of the descope (dsc-*).
      "clerk not a/p", "clerk -a/p", "clerk not -a/p", "accountant not a/r", "accountant not a/r Dallas", "cashier not p/t",
      "nurse not f/t", "nurse not l/d", "rep not a/p or a/r", "technician not med/surg", "nurse not med/surg", "engineer not tcp/ip",
      "cashier not part time", "aide not full time", "worker not night shifts", "nurse not entry level", "cna not per diem",
      "trucker not long haul", "developer not team lead", "rn not new grad", "aide not home health", "technician not help desk",
    ]) expect(qs.has(q), q).toBe(true);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });

  it("each case's stored main answer is origin/main's answer", () => {
    expect(CASES.filter((c) => c.main && JSON.stringify(c.main) !== JSON.stringify(ORIGIN_MAIN.splitExclusions(c.q))).map((c) => c.id)).toEqual([]);
    expect(CASES.filter((c) => c.main).length).toBe(CASES.length);
  });
});

describe("the shipped exclusion answers every corpus query exactly as origin/main does", () => {
  it.each(CASES.map((c) => [c.id, c.q, c] as const))("%s %s", (_id, _q, c) => {
    expect(differsFromMain(c), c.reason).toBe("");
  });
});

describe("the shipped exclusion answers every self-break query exactly as origin/main does", () => {
  it.each(SELF_BREAK.map((c) => [c.id, c.q, c] as const))("%s %s", (_id, _q, c) => {
    expect(differsFromMain(c), c.reason).toBe("");
  });
});

describe("the record of what main's rule gets wrong, for the separate search project", () => {
  it("main, and so the shipped rule, answers 765 of the 1,191 right by label; the stored verdicts agree case by case", () => {
    expect(CASES.filter(rightByLabel).length).toBe(765);
    expect(FILE.meta.measured["origin/main"]).toBe(765);
    expect(CASES.filter((c) => rightByLabel(c) !== c.correct.main).map((c) => c.id)).toEqual([]);
  });

  it("22 of the 75 self-break queries are right by label, as stored", () => {
    expect(SELF_BREAK.length).toBe(75);
    expect(SELF_BREAK.filter(rightByLabel).length).toBe(22);
    expect(SELF_BREAK.filter((c) => rightByLabel(c) !== c.correct.main).map((c) => c.id)).toEqual([]);
  });

  it("the descope recheck's 22 cases are recorded with main's own answers (main is right on one, tcp/ip)", () => {
    const dsc = CASES.filter((c) => c.id.startsWith("dsc-"));
    expect(dsc.length).toBe(22);
    expect(dsc.filter(rightByLabel).map((c) => c.q)).toEqual(["engineer not tcp/ip"]);
  });
});
