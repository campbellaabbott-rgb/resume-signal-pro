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

// The self-audit is the platform's flagship honesty artifact and is syndicated
// to the data-licensing page. On 2026-07-27, once get_audit_result() made it
// readable for the first time, the stored payload showed 14 strata and NO
// workday — 303,098 postings, 52.1% of the corpus — while still publishing
// "98.8% confirmed live" as the board's accuracy. Cause: the per-vendor draw
// used a deep OFFSET that fails on a 303k slice, and discarded the error.
describe("the self-audit cannot silently drop a hiring system", () => {
  const fn = readFileSync(
    resolve(root, "supabase/functions/job-board/index.ts"), "utf8");

  it("draws by keyset, never by deep OFFSET", () => {
    // .range(off, ...) with off scaled to the vendor's row count is the exact
    // shape that failed. The draw must seek on the indexed id instead.
    expect(fn).toMatch(/\.gt\("id", `\$\{v\}:\$\{anchor\.token\}:`\)/);
    expect(fn).not.toMatch(/\.eq\("source", v\)\.order\("id"\)\.range\(off/);
  });

  it("keeps the error from every draw query", () => {
    expect(fn).toMatch(/error: pErr/);
    expect(fn).toMatch(/error: cErr/);
    expect(fn).toMatch(/drawErrors\[v\]/);
  });

  it("publishes coverage alongside the accuracy figure", () => {
    expect(fn).toMatch(/coveredSharePct/);
    expect(fn).toMatch(/missingSources/);
    // Coverage must be part of the stored result, not just logged.
    expect(fn).toMatch(/accuracyPct, corpus, byVendor, coverage, labelAudit/);
  });

  it("logs a dropped stratum at error level", () => {
    expect(fn).toMatch(/audit COVERAGE GAP/);
  });

  it("the page discloses a gap instead of leaving a hole in the table", () => {
    const page = readFileSync(resolve(root, "src/pages/GhostJobIndex.tsx"), "utf8");
    expect(page).toMatch(/missingSources\.length > 0/);
    expect(page).toMatch(/Read this number narrowly/);
  });
});

// A sources line that omits the majority source is false by omission, however
// true each named item is. The board serves 15 ATS platforms; the copy named
// 10, leaving out workday — 303,098 postings, 52.1% of the corpus on
// 2026-07-27 — plus icims, oracle, rippling and pinpoint.
describe("published source lists name every system the board actually serves", () => {
  // Derive the expected set from the edge function rather than restating it,
  // so adding a vendor makes this fail until the public copy names it.
  // normalize.ts is the authority — it holds a normalizer per vendor and is
  // the only file carrying all 15 (sources.ts omits oracle; index.ts has only
  // workday). Read all three so a future move between files cannot shrink the
  // expected set and quietly make this guard vacuous.
  const fnSrc = ["normalize.ts", "sources.ts", "index.ts"]
    .map((f) => readFileSync(resolve(root, "supabase/functions/job-board", f), "utf8"))
    .join("\n");
  const SOURCES = [...new Set([...fnSrc.matchAll(/source:\s*"([a-z]+)"/g)].map((m) => m[1]))];

  // How each source is spelled in prose.
  const DISPLAY: Record<string, string> = {
    workday: "Workday", greenhouse: "Greenhouse", smartrecruiters: "SmartRecruiters",
    ashby: "Ashby", icims: "iCIMS", oracle: "Oracle", lever: "Lever",
    workable: "Workable", bamboohr: "BambooHR", recruitee: "Recruitee",
    teamtailor: "Teamtailor", personio: "Personio", breezy: "Breezy",
    rippling: "Rippling", pinpoint: "Pinpoint",
  };

  it("the source set is non-trivial (guard would be vacuous otherwise)", () => {
    expect(SOURCES.length).toBeGreaterThanOrEqual(15);
  });

  for (const file of locales) {
    it(`${file} jobsPage.sourceNote names all ${SOURCES.length} systems`, () => {
      const note: string = readJson(resolve(localeDir, file)).jobsPage.sourceNote;
      const missing = SOURCES.filter((s) => !note.includes(DISPLAY[s] ?? s));
      expect(missing).toEqual([]);
    });
  }

  it("the entry-level index names them too", () => {
    const page = readFileSync(resolve(root, "src/pages/EntryLevelIndex.tsx"), "utf8");
    const missing = SOURCES.filter((s) => !page.includes(DISPLAY[s] ?? s));
    expect(missing).toEqual([]);
  });
});

describe("freshness and repost claims carry no false absolutes", () => {
  for (const file of locales) {
    const jp = () => readJson(resolve(localeDir, file)).jobsPage;

    // Measured 2026-07-28 over 23,039 feeds: p50 1.6h, p95 3.3h, MAX 60.2h.
    // "A few hours" describes the bulk; "every feed" was the false part.
    it(`${file} does not promise EVERY feed inside a fixed window`, () => {
      expect(jp().sourceNote).not.toMatch(/every feed is re-?verified|all feeds are re-?verified/i);
    });

    // No hardcoded hour count: the real p50/p95 move and are published live.
    it(`${file} hardcodes no freshness hour count`, () => {
      expect(jp().sourceNote).not.toMatch(/\d+\s*(hours?|hrs?)\b/i);
    });

    // "no reposts" sat beside a "Relists roles often (581x)" badge.
    it(`${file} does not claim a bare "no reposts"`, () => {
      expect(jp().subtitle).not.toMatch(/no reposts|sin republicaciones,|geen reposts/i);
    });
  }
});

// The posting panel rendered `last_seen` as "re-checked {ago}" under a tooltip
// reading "when this posting was last re-verified against the company's own
// feed". But index.ts writes `last_seen: startIso` at INSERT ONLY and never
// rewrites it — measured 2026-07-28, two greenhouse rows carry a last_seen 5s
// and 3s BEFORE their own first_seen. It is discovery time wearing a
// re-verification label: the banned first_seen-as-freshness pattern, stated in
// words, and understating the true feed p50 (~83 min) by roughly 100x.
describe("the re-check chip shows real re-verification, not insert time", () => {
  const jobs = readFileSync(resolve(root, "src/pages/Jobs.tsx"), "utf8");
  const fn = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");

  it("the chip renders recheckedAt, never lastSeen", () => {
    expect(jobs).toMatch(/detailJob\.recheckedAt &&/);
    expect(jobs).not.toMatch(/\{detailJob\.lastSeen &&/);
    expect(jobs).not.toMatch(/agoLabel\(detailJob\.lastSeen/);
  });

  it("recheckedAt is sourced from job_board_verifications", () => {
    expect(fn).toMatch(/from\("job_board_verifications"\)[\s\S]{0,120}verified_at/);
    expect(fn).toMatch(/j\.recheckedAt = v;/);
  });

  it("a posting the feed already dropped gets no chip", () => {
    // verified_at says the FEED was read, not that this posting was in it.
    expect(fn).toMatch(/if \(v && !j\.missingSince\) j\.recheckedAt = v;/);
    expect(fn).toMatch(/min_years,last_seen,missing_since/);
  });

  it("a failed lookup leaves the field absent rather than falling back", () => {
    expect(fn).toMatch(/if \(error \|\| !Array\.isArray\(data\)\) return jobs;/);
  });

  it("verify-on-view no longer fires on a missing value", () => {
    // `!job.lastSeen ||` would become true for every posting once the field is
    // gone, hitting the vendor on every panel open for every visitor.
    expect(jobs).not.toMatch(/!job\.lastSeen \|\|/);
    expect(jobs).toMatch(/job\.recheckedAt && Date\.now\(\) - Date\.parse\(job\.recheckedAt\)/);
  });

  it("every list return path attaches it", () => {
    expect((fn.match(/await attachRecheckedAt\(client,/g) || []).length).toBe(3);
  });
});

// The 30-day cap applies only to postings whose COMPANY states a date. 21.8%
// of the board (127,406 rows on 2026-07-28) states none, cannot be judged old,
// and is deliberately kept — which three live strings flatly denied:
//   jobsPage.guaranteeFresh    "Posted in the last 30 days — stale postings auto-dropped"
//   jobsPage.guaranteeFreshTip "Any role whose posting date passes 30 days is..."
//   boardHero.trustFresh       "Nothing older than 30 days — stale listings removed"
// GhostJobIndex has carried the correct sentence all along; the hero and the
// badge never inherited its second half.
describe("the 30-day cap is never stated as covering the whole board", () => {
  const ABSOLUTE = /(nothing|no postings?|no roles?|none)\s+older than 30 days/i;

  for (const file of locales) {
    it(`${file} does not claim the cap covers undated postings`, () => {
      const jp = readJson(resolve(localeDir, file));
      const offenders = [
        ["jobsPage.guaranteeFresh", jp.jobsPage?.guaranteeFresh],
        ["jobsPage.guaranteeFreshTip", jp.jobsPage?.guaranteeFreshTip],
        ["boardHero.trustFresh", jp.boardHero?.trustFresh],
      ]
        .filter(([, v]) => typeof v === "string" && ABSOLUTE.test(v as string))
        .map(([k, v]) => `${k} = ${v}`);
      expect(offenders).toEqual([]);
    });
  }

  it("the hero's inline default is honest too", () => {
    const hero = readFileSync(resolve(root, "src/components/JobBoardHero.tsx"), "utf8");
    expect(hero).not.toMatch(/Nothing older than 30 days/);
    expect(hero).toMatch(/undated ones show no age/);
  });
});

// normalize.ts's Workday header claimed "we never store that as a date" and
// "kept postings are honest-undated (like BambooHR)". The behaviour was
// inverted one day after the header was written and the header never caught
// up — the claim-drift failure mode, on the comment a methodology page or
// llms.txt would be written from.
describe("the Workday date comments describe what the code does", () => {
  const norm = readFileSync(resolve(root, "supabase/functions/job-board/normalize.ts"), "utf8");
  const idx = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");

  it("normalize.ts no longer calls Workday postings undated", () => {
    // Rippling's identical phrase is TRUE (its list states no date at any age)
    // and must survive, so scope the assertion to the Workday block.
    const wd = norm.slice(norm.indexOf("Workday"), norm.indexOf("export interface WorkdayListItem"));
    expect(wd).not.toMatch(/we never store that as a date/);
    expect(wd).toMatch(/CORRECTED 2026-07-28/);
  });

  it("both date paths are documented, not just the list conversion", () => {
    const wd = norm.slice(norm.indexOf("Workday"), norm.indexOf("export interface WorkdayListItem"));
    expect(wd).toMatch(/startDate/);
    expect(wd).toMatch(/30\+ Days Ago/);
  });

  it("index.ts no longer calls the Workday list 'Undated ... like BambooHR'", () => {
    expect(idx).not.toMatch(/Undated, description-less \(list-only\), like BambooHR/);
  });

  it("the CXS startDate precedence still exists to be described", () => {
    expect(idx).toMatch(/postedAt = isoDateOnly\(j\?\.jobPostingInfo\?\.startDate\)/);
  });
});

// missing_since is stamped when a posting fails to appear in a SUCCESSFUL
// fetch of its own company's feed (two-pass confirmed). It is the strongest
// "this is gone" signal the board has — and nothing in the serving path
// filtered it, so the postings the Ghost Job Index exists to name were being
// served as live results. Verified 2026-07-28: rows stamped that same hour
// were still returnable.
describe("postings the employer feed already dropped are not served", () => {
  const fn = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");
  const mig = readFileSync(
    resolve(root, "supabase/migrations/20260728120000_stop_serving_dropped_postings.sql"), "utf8");

  it("the edge function's serving query excludes them", () => {
    expect(fn).toMatch(/\.is\("missing_since", null\)/);
  });

  it("both serving RPCs exclude them too", () => {
    // Each builds ONE shared `filters` string, so the base declaration covers
    // the title tier, the description tier and the capped count alike.
    expect((mig.match(/missing_since IS NULL/g) || []).length).toBe(2);
    expect(mig).toMatch(/filters text := ' AND p\.effective_posted >= \$2 AND p\.missing_since IS NULL'/);
    expect(mig).toMatch(/filters text := ' WHERE p\.effective_posted >= \$1 AND p\.missing_since IS NULL'/);
  });

  it("the observability index is PARTIAL, not a full-table build", () => {
    // A full index here would take the write-blocking SHARE lock for minutes
    // over 581k rows. Partial over the stamped rows only, it is seconds.
    expect(mig).toMatch(/WHERE missing_since IS NOT NULL;/);
    expect(mig).toMatch(/CREATE INDEX IF NOT EXISTS job_board_postings_missing_since_idx/);
  });

  it("the one-shot builder unschedules itself before building", () => {
    // Otherwise a failure thrash-retries a write-blocking operation every minute.
    const body = mig.slice(mig.indexOf("build_missing_since_index_oneshot"));
    expect(body.indexOf("cron.unschedule")).toBeLessThan(body.indexOf("CREATE INDEX"));
  });
});
