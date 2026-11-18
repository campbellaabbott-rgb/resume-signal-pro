// @vitest-environment node
/**
 * COMPLIANCE.MD DESCRIBES THE SHORTLIST THAT SHIPS (S14X-233).
 *
 * WHAT WAS WRONG. The compliance map sold features the product does not have:
 * an employer-configurable blocklist (no page offers one, and RC-S13-073
 * stopped the function reading it), a demographic-capture table (closed by
 * owner decision D14), a "Retention default 4 years" no migration enforces,
 * and the four-fifths math at a path that no longer exists. The page's "How
 * it works" link went to the seeker scan's methodology page, which never
 * mentions Shortlist, and its jurisdiction line promised retention rules.
 *
 * WHAT HOLDS NOW: each claim below is checked against the code that ships.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { codeOf, sqlCodeOf } from "./helpers/strip-comments";

const ROOT = process.cwd();
const doc = readFileSync(join(ROOT, "COMPLIANCE.md"), "utf8");
const fn = readFileSync(join(ROOT, "supabase/functions/shortlist-evaluate/index.ts"), "utf8");
const page = readFileSync(join(ROOT, "src/pages/Shortlist.tsx"), "utf8");
const MIG = join(ROOT, "supabase/migrations");
const migrations = readdirSync(MIG).filter((f) => f.endsWith(".sql")).map((f) => sqlCodeOf(readFileSync(join(MIG, f), "utf8")));
const purgeScheduled = migrations.some((s) => /cron\.schedule\([\s\S]{0,400}shortlist_/i.test(s));

/** A backticked path in the document, resolved the way the document writes it. */
function resolvePath(p: string): string {
  if (p.startsWith("_shared/")) return join("supabase/functions", p);
  if (!p.includes("/") && /\.test\.tsx?$/.test(p)) return join("src/test", p);
  if (p === "Shortlist.tsx") return "src/pages/Shortlist.tsx";
  return p;
}
function exists(p: string): boolean {
  const rel = resolvePath(p);
  if (!rel.includes("*")) return existsSync(join(ROOT, rel));
  const dir = join(ROOT, dirname(rel));
  const re = new RegExp(`^${basename(rel).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  return existsSync(dir) && readdirSync(dir).some((f) => re.test(f));
}

describe("COMPLIANCE.md sells only what ships", () => {
  it("names no employer blocklist, because the function reads none from a request", () => {
    expect(fn).not.toMatch(/body\.redaction/);
    expect(doc).not.toMatch(/extraBlocklist|allow\/blocklist/i);
  });

  it("describes no demographic capture table", () => {
    expect(doc).not.toMatch(/shortlist_demographics/);
    expect(doc).toMatch(/No demographic data is recorded/);
  });

  it("claims a 4-year retention only when a migration schedules a Shortlist purge", () => {
    if (!purgeScheduled) expect(doc).not.toMatch(/\b(?:4|four) years\b/i);
  });

  it("states the owner's rule A (S14X-073), and the migrations hold the delete and the purge it describes", () => {
    expect(doc).toMatch(/S14X-073, rule A/);
    expect(doc).toMatch(/until the employer deletes the candidate, the role or the account, and anything still held four years after it was uploaded is deleted/);
    expect(purgeScheduled).toBe(true);
    expect(migrations.some((m) => /FUNCTION public\.shortlist_delete_candidate\s*\(/.test(m) && /FUNCTION public\.shortlist_delete_role\s*\(/.test(m))).toBe(true);
    expect(doc).not.toMatch(/no automatic deletion is built yet|open decision \(S14X-073\)/);
  });

  it("cites only paths that exist", () => {
    const cited = [...doc.matchAll(/`([^`\s]+\.(?:ts|tsx|sql|md))`/g)].map((m) => m[1]);
    expect(cited.length).toBeGreaterThan(3);
    expect(cited.filter((p) => !exists(p))).toEqual([]);
  });

  it("states the redaction's languages, its one neutral mark and the limits of its name heuristic", () => {
    expect(doc).toMatch(/German, French, Spanish, Portuguese, Dutch, Chinese and Japanese/);
    expect(doc).toMatch(/one neutral `\[REDACTED\]` mark/);
    expect(doc).toMatch(/pattern-based and can miss/);
  });
});

describe("the page explains Shortlist itself", () => {
  const code = codeOf(page);
  it("has an in-page 'How Shortlist works' and no link to the seeker scan's methodology", () => {
    expect(code).not.toMatch(/to="\/methodology"/);
    expect(code).toMatch(/data-how-shortlist-works/);
  });

  it("promises no retention rule it does not keep", () => {
    expect(code).not.toMatch(/and retention rules/);
    if (!purgeScheduled) expect(code).not.toMatch(/\b(?:4|four) years\b/i);
  });
});
