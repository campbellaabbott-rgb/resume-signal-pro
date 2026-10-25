// @vitest-environment node
/**
 * NO MATCH COPY STATES OR IMPLIES A CHANCE OF BEING HIRED.
 *
 * Every sentence the match list shows lives in _shared/match-tiers.ts; the
 * device modules (src/lib/match/**) and resume-match's own messages add a few
 * more. None may use a word in BANNED_MATCH_WORDS (chances, likely, odds, a
 * percentage beside match or fit, a check nobody made, "jobs you can take",
 * "where you can work"). Comments are stripped before the scan: only what can
 * reach a reader is judged. A positive control proves the list bites.
 *
 * Phase 1 adds the match string shard in nine locales and the LiveMatches
 * defaults to this scan; phase 2 adds the match text in agent-mcp and
 * public-api.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import * as tiers from "../../supabase/functions/_shared/match-tiers";
import { cut, QUOTE_CHARS } from "../../supabase/functions/_shared/licence-rules";
import { SITE_PER_NETWORK_HOUR } from "../../supabase/functions/resume-match/handler";

const ROOT = resolve(__dirname, "../..");

function stringsOf(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringsOf(x, out));
  else if (v && typeof v === "object" && !(v instanceof RegExp) && !(v instanceof Set) && !(v instanceof Map)) Object.values(v).forEach((x) => stringsOf(x, out));
  return out;
}
/** String and template literals in a file's code (comments stripped). */
function literalsOf(rel: string): string[] {
  const code = codeOf(readFileSync(resolve(ROOT, rel), "utf8"));
  const out: string[] = [];
  for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out.filter((s) => /[a-z]{3,}\s+[a-z]{2,}/i.test(s));
}

describe("the ban list bites (positive control)", () => {
  it.each([
    "Your chances are good", "likely to hear back", "odds of an interview", "73% match", "fit 73%", "match score of 81%", "fit {{pct}}%",
    "verified openings", "early applicants get read", "shortlisted candidates", "jobs you can take", "matched to where you can work", "best chance",
  ])("%s", (s) => {
    expect(tiers.bannedIn(s).length).toBeGreaterThan(0);
  });
  it("and spares the honest forms", () => {
    for (const s of ["jobs you could apply for", "where you said you can work", "Keyword overlap: 4 of 9 recognised terms", "Strong match: meets every stated requirement we could read"]) {
      expect(tiers.bannedIn(s), s).toEqual([]);
    }
  });
});

describe("served match copy uses none of them", () => {
  it("every wording constant in _shared/match-tiers.ts", () => {
    const { BANNED_MATCH_WORDS: _b, ...rest } = tiers as Record<string, unknown>;
    const strings = stringsOf(Object.values(rest));
    expect(strings.length).toBeGreaterThan(40);
    const bad = strings.filter((s) => tiers.bannedIn(s).length).map((s) => `${s} -> ${tiers.bannedIn(s)}`);
    expect(bad).toEqual([]);
  });
  it("every string in src/lib/match and resume-match's own messages", () => {
    const files = [
      ...readdirSync(resolve(ROOT, "src/lib/match")).filter((f) => f.endsWith(".ts")).map((f) => `src/lib/match/${f}`),
      "supabase/functions/resume-match/handler.ts",
      "supabase/functions/resume-match/pipeline.ts",
      "supabase/functions/_shared/posting-requirements.ts",
    ];
    const bad: string[] = [];
    for (const f of files) for (const s of literalsOf(f)) if (tiers.bannedIn(s).length) bad.push(`${f}: ${s}`);
    expect(bad).toEqual([]);
  });
});

describe("the sentences the spec fixes, and the numbers they carry", () => {
  it("every card's footer says what the comparison is and that it is not a prediction", () => {
    expect(tiers.FOOTER).toBe("This compares each posting's stated requirements with your résumé and where you said you can work. It is not a prediction of whether you will be hired.");
  });
  it("Strong says 'we could read'; an unread posting says so", () => {
    expect(tiers.TIER_DEFINITION.strong).toMatch(/we could read$/);
    expect(tiers.REQUIREMENTS_NOT_READ).toBe("requirements not read");
  });
  it("the free page is the top 20, quotes are cut near 160 characters, and the 429 names the hourly allowance it enforces", () => {
    expect(tiers.TOP_N).toBe(20);
    expect(QUOTE_CHARS).toBe(160);
    expect(cut("x ".repeat(400)).length).toBeLessThanOrEqual(QUOTE_CHARS);
    expect(SITE_PER_NETWORK_HOUR).toBe(30);
    const handler = codeOf(readFileSync(resolve(ROOT, "supabase/functions/resume-match/handler.ts"), "utf8"));
    expect(handler).toMatch(/This network has made \$\{max\} matches this hour/);
  });
});
