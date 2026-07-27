import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// /trust and /methodology — the two pages whose entire purpose is to be
// believed — carried the worst claims on the site until 2026-07-27:
//
//   "10,000+ Resumes Analyzed"   while get_scan_totals returned 1,052 (~9.5x),
//                                and while the homepage, using that same RPC,
//                                showed the real number.
//   "Trusted by Job Seekers at Top Companies", over Google / Microsoft /
//                                Amazon / Meta / Apple / Netflix — a hardcoded
//                                array. No migration in this repo defines an
//                                employer field of any kind, so the claim was
//                                not stale, it was unfalsifiable by design.
//   "89% report better interview rates"   — no outcome survey exists.
//   "Average 23-point score improvement"  — no score-delta aggregate exists.
//
// These tests do not check that the numbers are right. They check that no one
// can put a number here by hand at all, which is the only property that
// survives a year of edits by people who were not here today.

const root = resolve(__dirname, "../..");
const localeDir = resolve(root, "src/i18n/locales");
const locales = readdirSync(localeDir).filter((f) => f.endsWith(".json"));

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

function allStrings(o: unknown, path = ""): Array<[string, string]> {
  if (typeof o === "string") return [[path, o]];
  if (Array.isArray(o)) return o.flatMap((v, i) => allStrings(v, `${path}[${i}]`));
  if (o && typeof o === "object") {
    return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
      allStrings(v, path ? `${path}.${k}` : k)
    );
  }
  return [];
}

describe("no hand-written corpus counts in any locale", () => {
  // Any rounded-thousand brag is the exact shape of the claim that was wrong.
  const ROUND_BRAG = /\b\d{1,3}[.,\s]?000\s*\+/;

  for (const file of locales) {
    it(`${file} states no hardcoded 'N,000+' scan count`, () => {
      const offenders = allStrings(readJson(resolve(localeDir, file)))
        .filter(([p]) => /^(trustIndicators|methodologyPage|trustPage|freeResults)\b/.test(p))
        .filter(([, v]) => ROUND_BRAG.test(v))
        .map(([p, v]) => `${p} = ${v}`);
      expect(offenders).toEqual([]);
    });
  }
});

describe("no unsourced efficacy statistics", () => {
  // Removed outright. If either is ever reinstated it must come with a real
  // aggregate behind it, at which point this key list is the thing to revisit.
  const BANNED_KEYS = [
    ["methodologyPage", "validatedByResults", "interviewRates"],
    ["methodologyPage", "validatedByResults", "scoreImprovement"],
  ];

  for (const file of locales) {
    it(`${file} does not reinstate the removed efficacy claims`, () => {
      const d = readJson(resolve(localeDir, file));
      for (const path of BANNED_KEYS) {
        const v = path.reduce<any>((o, k) => o?.[k], d);
        expect(v, `${file}: ${path.join(".")} is back`).toBeUndefined();
      }
    });

    it(`${file} claims no "N% report better ..." outcome rate`, () => {
      const offenders = allStrings(readJson(resolve(localeDir, file)))
        .filter(([, v]) => /\d+\s*%[^.]{0,40}\b(report|reported|see|saw|experience)\b/i.test(v))
        .map(([p, v]) => `${p} = ${v}`);
      expect(offenders).toEqual([]);
    });
  }
});

describe("the trust page names no employer it cannot evidence", () => {
  // The array lived in the lazily-loaded Trust chunk, not the main bundle —
  // a fix "verified" against index-*.js would have looked clean while the wall
  // was still live. Assert against the source instead.
  const src = readFileSync(resolve(root, "src/pages/Trust.tsx"), "utf8");
  // Strip comments: the removal note deliberately records the old names.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  for (const brand of ["Google", "Microsoft", "Amazon", "Meta", "Apple", "Netflix"]) {
    it(`does not hardcode "${brand}"`, () => {
      expect(code).not.toContain(`"${brand}"`);
    });
  }

  it("has no companyLogos array at all", () => {
    expect(code).not.toMatch(/companyLogos/);
  });

  it("binds its scan count to the RPC rather than a literal", () => {
    expect(code).toMatch(/useScanTotals\(\)/);
    // Only corpus-scale literals are banned: a thousands-separated number, or
    // any "N+". `value: "0"` (data breaches) and `value: "30s"` are real,
    // checkable facts about the operator, not counts of a corpus.
    expect(code).not.toMatch(/value:\s*["'](\d{1,3}(,\d{3})+\+?|\d+\+)["']/);
  });
});

// Four more published-number defects, all verified live 2026-07-27 and fixed
// in migration 20260727180000. Each guard pins the SHAPE of the fix, not the
// value, because the values move every day.
describe("windows, denominators and units are never asserted by hand", () => {
  const read = (p: string) => readFileSync(resolve(root, p), "utf8");

  it("/data-api prints the measured log depth, not a requested 90-day window", () => {
    const src = read("src/pages/DataApi.tsx");
    // The payload ships {"closed_90d": 91796, "tracking_days": 12} — the label
    // used the 90 and ignored the 12. Earliest closure is 2026-07-14.
    expect(src).not.toMatch(/closures logged in 90 days/);
    expect(src).toMatch(/observed_days\s*\?\?\s*stats\?\.tracking_days/);
  });

  it("/data-api does not call feed tokens 'companies' without saying so", () => {
    const src = read("src/pages/DataApi.tsx");
    // count(DISTINCT company_token) counts PwC four times. The name-merged
    // count is preferred; the token count may only render as "employer feeds".
    expect(src).toMatch(/total_company_names/);
    expect(src).toMatch(/employer feeds/);
  });

  it("the ghost index reads its audit through an RPC, not a blocked table", () => {
    const src = read("src/pages/GhostJobIndex.tsx");
    // Direct anon reads of job_board_meta return 42501, which silently left
    // the whole self-audit panel unrendered for every visitor.
    expect(src).toMatch(/get_audit_result/);
    expect(src).not.toMatch(/from\("job_board_meta"\)/);
  });

  it("the ghost index never calls its stratified sample 'random'", () => {
    const src = read("src/pages/GhostJobIndex.tsx");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // Ban the CLAIM, not the word — the honest copy has to be able to say
    // "not at random" and "rather than taken at random from the corpus".
    // The sample draws evenly per hiring system, which is the opposite of a
    // corpus-random draw, so only the positive assertion is forbidden.
    expect(code).not.toMatch(/\brandom\s+(listings|postings|sample|draws?)\b/i);
    expect(code).not.toMatch(/\b(sampled?|drew|draws?)\s+[^.]{0,40}?\brandom\b(?!\s*,)/i);
  });

  it("Explore states the denominator behind its remote share", () => {
    const src = read("src/pages/Explore.tsx");
    // 87.3% of postings state no work mode; dividing by all of them turned a
    // ~60% remote segment into ~8% and read as a fact about the employers.
    expect(src).toMatch(/state a work mode/);
    expect(src).toMatch(/s\.remote_pct != null/);
  });

  it("the segments RPC divides remote by disclosed rows only", () => {
    const sql = read("supabase/migrations/20260727180000_published_counts_and_audit_access.sql");
    expect(sql).toMatch(/work_mode IS NOT NULL\)::int AS disclosed_n/);
    expect(sql).toMatch(/sum\(remote_n\) \/ sum\(disclosed_n\)/);
    // A band where nobody disclosed must be null, never 0.
    expect(sql).toMatch(/CASE WHEN sum\(disclosed_n\) > 0/);
  });
});
