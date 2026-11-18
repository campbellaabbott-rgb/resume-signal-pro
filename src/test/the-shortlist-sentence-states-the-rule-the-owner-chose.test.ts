// @vitest-environment node
/**
 * S14X-073, THE SHORTLIST RETENTION RULE (owner's rule A, 2026-11-15): an
 * employer deletes a candidate or a role, and anything still held four years
 * after it was uploaded is deleted. The Privacy page said the redacted text
 * and the evaluation stay "until they delete the role or their account",
 * while the Shortlist page promised four years and offered no delete.
 *
 * The sentence is a claim about code the shortlist lane builds (the owner's
 * delete, its log and the daily four-year purge), so the second half of this
 * file FAILS until that code is on the branch: the sentence may not reach the
 * page ahead of it.
 *
 * Read from the text the crawler is served (scripts/prerender-legal.mjs).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { legalBodyFromTsx, legalText } from "../../scripts/prerender-legal.mjs";
import { MCP_PRIVACY_ROWS } from "@/config/mcp-privacy";
import EN from "@/i18n/locales/en.json";

const ROOT = resolve(__dirname, "../..");
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const html = legalBodyFromTsx(readFileSync(resolve(ROOT, "src/pages/Privacy.tsx"), "utf8"), { locale: EN, vars: { AI_CACHE_MAX_HOURS: 48, SHARED_ANALYSIS_DAYS: 90, MCP_PRIVACY_ROWS }, esc });
const shortlist = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => legalText(m[1]).replace(/&#39;|&apos;/g, "'")).find((t) => t.startsWith("Shortlist:")) ?? "";

describe("the Shortlist sentence states rule A", () => {
  it("says the employer deletes a candidate or a role, and what is left goes four years after upload", () => {
    expect(shortlist).toMatch(/until they delete the candidate, the role or their account, and delete any still held four years after it was uploaded/);
    expect(shortlist, "the sentence before the owner's rule").not.toMatch(/until they delete the role or their account,/);
    expect(shortlist).toMatch(/record no candidate's sex or race/);
  });
});

describe("the delete and the purge it describes are on the branch with it", () => {
  const DIR = resolve(ROOT, "supabase/migrations");
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const code = (f: string) => readFileSync(resolve(DIR, f), "utf8").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

  it("a migration gives the employer a delete for one candidate", () => {
    expect(files.filter((f) => /FUNCTION public\.shortlist_delete_candidate\s*\(/i.test(code(f))), "the shortlist lane's rule-A file must merge first").not.toEqual([]);
  });

  it("a migration schedules the purge of candidates held four years", () => {
    const purges = files.filter((f) => { const c = code(f); return /cron\.schedule\s*\(/.test(c) && /shortlist/i.test(c) && /4 years|four years|interval\s*'4 year/i.test(c); });
    expect(purges, "the shortlist lane's daily four-year purge must merge first").not.toEqual([]);
  });
});
