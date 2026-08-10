import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { isUnfiltered, normalizeFilters } from "../../supabase/functions/job-board/filters.ts";
import { ATS_VENDOR_LIST } from "../config/ats-vendors";

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
    expect(fn).toMatch(/accuracyPct, corpus, byVendor, coverage, deepened, labelAudit/);
  });

  it("the headline sample is the even draw, not the re-drawn total", () => {
    // A vendor that looks low gets re-drawn up to 30 probes. Those probes must
    // not move the headline: the page says the sample was "drawn evenly across
    // hiring systems", which stops being true the moment one vendor carries 30
    // of the probes and the rest carry 6.
    expect(fn).toMatch(/sampled: headlineSampled, probed: sampleIds\.length/);
    expect(fn).toMatch(/await probeAll\(sampleIds, true\)/);
    expect(fn).toMatch(/await probeAll\(extra, false\)/);
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

  // The note now INTERPOLATES {{vendors}} from ats-vendors.ts rather than
  // spelling the platforms out in each locale. Ten hand-kept copies of one fact
  // is what let the inline English default drift to ten platforms and lose
  // Workday; this guard kept the nine LOCALES honest but never saw the default.
  //
  // The claim is unchanged and so is this test's job: whatever a reader ends up
  // seeing must name every system the board serves. So it renders the string
  // the way i18next will — placeholder substituted — and asserts on that. This
  // is strictly stronger than before, because it now also pins ATS_VENDOR_LIST
  // to the normalizers: a vendor added to the edge function but missing from
  // the config fails here, which the old raw-JSON check could not detect.
  const render = (note: string) => note.replace("{{vendors}}", ATS_VENDOR_LIST);

  for (const file of locales) {
    it(`${file} jobsPage.sourceNote names all ${SOURCES.length} systems`, () => {
      const note: string = readJson(resolve(localeDir, file)).jobsPage.sourceNote;
      const missing = SOURCES.filter((s) => !render(note).includes(DISPLAY[s] ?? s));
      expect(missing).toEqual([]);
    });

    it(`${file} interpolates rather than hardcoding the list`, () => {
      const note: string = readJson(resolve(localeDir, file)).jobsPage.sourceNote;
      expect(note, `${file} must use {{vendors}}`).toContain("{{vendors}}");
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

// The posted-date backfill was STARVED, not broken. Its only kick sat in the
// full-pass branch of runRefresh, which requires a completed 120-slice cold
// rotation. Measured 2026-07-28: bamboohr dated = 0 AND rippling dated = 0 for
// 3h09 after the sweep was deliberately re-armed at POSTED_BACKFILL_VERSION 5
// and confirmed deployed — the code was correct and simply unreachable.
//
// This is the SAME starvation the comment above maybeKickMaintenance records
// for desc-sweep and recategorise on 2026-07-25 ("~460k postings still without
// descriptions"). Those two were moved to the slice cadence; the posted
// backfill was left behind.
describe("the posted-date backfill is reachable without a full rotation", () => {
  const fn = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");

  it("runs as a maintenance track, not only at pass end", () => {
    const mk = fn.slice(fn.indexOf("async function maybeKickMaintenance"));
    expect(mk).toMatch(/alive\("posted_backfill"\)/);
    expect(mk).toMatch(/kick\("backfill-posted"/);
  });

  it("maintenance is reachable from the SLICE path", () => {
    // If maybeKickMaintenance itself were only called at pass end, moving the
    // kick into it would change nothing.
    const sliceTail = fn.slice(fn.indexOf("if (chainHop < CHAIN_CAP) chainNextSlice(chainHop);") - 400);
    expect(sliceTail).toMatch(/await maybeKickMaintenance\(client\)/);
  });

  it("still refuses to replay resume state from an older sweep version", () => {
    // The v4 bug: stale {phase,cursor} made the chain query
    // source=bamboohr AND id > 'workday:...' -> 0 rows -> "complete".
    const mk = fn.slice(fn.indexOf("async function maybeKickMaintenance"));
    expect(mk).toMatch(/pbv\.resumeVersion === POSTED_BACKFILL_VERSION/);
  });

  it("does not start a second chain while one is alive", () => {
    const mk = fn.slice(fn.indexOf("async function maybeKickMaintenance"));
    expect(mk).toMatch(/if \(!pb\.alive && postedBackfillDue\(pbv[,)]/);
  });
});

// The exit ledger's whole value is that 'aged_out' means one specific thing:
// a 30-day tenure THIS BOARD WATCHED elapse. A dating sweep that backfills
// 43,687 BambooHR rows would otherwise file ~35,000 learned-after-the-fact
// ages under that label, in a single day — manufacturing ghost-rate evidence
// out of our own late knowledge. The stat hasn't shipped, so this is cheap to
// get right now and expensive to unpick later.
describe("exit ledger keeps learned age separate from observed age", () => {
  const fn = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");

  it("no exit site hardcodes aged_out", () => {
    expect(fn).not.toMatch(/exit_reason:\s*"aged_out"/);
  });

  it("both aged-out sites classify from the row", () => {
    expect(fn.match(/exitReasonFor\(r\.posted_at, r\.first_seen\)/g)?.length).toBe(2);
  });

  it("classifies on posted_at vs first_seen, not on who called it", () => {
    // A flag the dating sweep sets would be forgotten by the next backfill.
    const h = fn.slice(fn.indexOf("function exitReasonFor"), fn.indexOf("function exitReasonFor") + 500);
    expect(h).toMatch(/p < f - BACKDATE_SLACK_MS \? "backdated" : "aged_out"/);
  });

  it("falls back to aged_out when either date is missing", () => {
    const h = fn.slice(fn.indexOf("function exitReasonFor"), fn.indexOf("function exitReasonFor") + 500);
    expect(h).toMatch(/if \(!Number\.isFinite\(p\) \|\| !Number\.isFinite\(f\)\) return "aged_out"/);
  });

  it("the DB constraint admits the new reason", () => {
    const mig = readFileSync(resolve(root, "supabase/migrations/20260728130000_exit_reason_backdated.sql"), "utf8");
    expect(mig).toMatch(/CHECK \(exit_reason IN \('removed', 'aged_out', 'backdated'\)\)/);
  });

  it("nothing published reads the ledger without filtering to aged_out", () => {
    // Guard for later: today no consumer exists. If one appears and reads the
    // raw ledger, it must exclude backdated or the namesake stat goes false.
    const sql = readdirSync(resolve(root, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(resolve(root, "supabase/migrations", f), "utf8"))
      .filter((t) => /FROM public\.job_board_exits/.test(t) && /CREATE (OR REPLACE )?FUNCTION/.test(t));
    for (const t of sql) expect(t).toMatch(/exit_reason\s*=\s*'aged_out'|exit_reason\s*<>\s*'backdated'|exit_reason\s+IN\s*\(/i);
  });
});

// The sweep was one-shot: it stamped {version} on completion and both kicks
// tested version equality, so it could never run again — while BambooHR and
// Rippling keep ingesting undated postings daily. The backlog would regrow and
// the only remedy would be a human bumping a constant.
describe("the posted-date sweep re-arms instead of latching", () => {
  const fn = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");
  // postedBackfillDue moved to _shared/posted-backfill.ts on 2026-08-08 so the
  // rule could be tested by CALLING it rather than by reading it — see
  // posted-date-backfill-rearm.test.ts, which exercises the real function.
  // These two assertions stay as source checks because they guard the
  // fail-safe DIRECTIONS, and a direction is easiest to state where it is
  // written.
  const pbSrc = readFileSync(resolve(root, "supabase/functions/_shared/posted-backfill.ts"), "utf8");

  it("neither kick compares the version directly any more", () => {
    const code = fn.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/pbV?\.version !== POSTED_BACKFILL_VERSION/);
    expect(code.match(/postedBackfillDue\((pbV|pbv)[,)]/g)?.length).toBe(2);
  });

  it("a completed sweep goes due again once the stamp ages out", () => {
    const h = pbSrc.slice(pbSrc.indexOf("export function postedBackfillDue"));
    expect(h).toMatch(/since > POSTED_BACKFILL_REARM_MS/);
  });

  it("an unreadable stamp reads as due, not as done", () => {
    const h = pbSrc.slice(pbSrc.indexOf("export function postedBackfillDue"));
    expect(h).toMatch(/if \(!Number\.isFinite\(swept\)\) return true;/);
  });

  it("re-running stays cheap because the draw is undated-only", () => {
    // If this filter ever goes, a weekly re-arm becomes a full re-scan.
    expect(fn).toMatch(/\.eq\("source", phase\)\s*\n\s*\.is\("posted_at", null\)/);
  });
});

// The sweep sat at bamboohr 0% dated for 2h15m on a confirmed-live deploy and
// there was NO way to tell which of three very different causes it was:
// stamped-complete (so not due), a chain alive but dating nothing, or a kick
// that never fired. job_board_meta is RLS-hidden (42501 for anon), so telling
// them apart needed dashboard SQL — the exact gap embedSweep was added to close.
describe("the posted-date sweep reports its own state", () => {
  const fn = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");
  // Sliced to the END OF THE BLOCK, not to a fixed character count. It was
  // `+ 1200`, and adding the backlog fields pushed `due:` past that window —
  // so the assertion silently stopped seeing its own target. A window that can
  // be outgrown by the code it inspects is a test that quietly retires itself.
  const status = (() => {
    const i = fn.indexOf("postedBackfill: (() => {");
    const j = fn.indexOf("})(),", i);
    return i < 0 || j < 0 ? "" : fn.slice(i, j);
  })();

  it("status publishes the sweep's meta row", () => {
    expect(fn).toMatch(/client\.from\("job_board_meta"\)\.select\("v, updated_at"\)\.eq\("k", "posted_backfill"\)/);
    expect(status).toMatch(/version:/);
    expect(status).toMatch(/sweptAt:/);
    expect(status).toMatch(/ageMin:/);
  });

  it("reports due-ness via the kick's OWN predicate, so it cannot drift", () => {
    // A hand-rolled copy here would eventually disagree with the real kick and
    // report "due: true" on a sweep that never fires — worse than no signal.
    expect(status).toMatch(/due: postedBackfillDue\(v[,)]/);
  });

  it("a completion stamp records what the chain ACHIEVED, not just that it ended", () => {
    // Without cumulative totals, a chain that walked 43,687 rows and dated none
    // is indistinguishable from one that dated thousands.
    expect(fn).toMatch(/version: POSTED_BACKFILL_VERSION, sweptAt: new Date\(\)\.toISOString\(\), datedTotal, scannedTotal/);
  });

  it("totals accumulate across hops rather than resetting each hop", () => {
    expect(fn).toMatch(/const datedTotal = \(typeof body\.datedTotal === "number" \? body\.datedTotal : 0\) \+ dated/);
    expect(fn).toMatch(/chain\(\{ phase, cursor, datedTotal, scannedTotal[,}]/);
  });

  it("a died chain still shows how far it got", () => {
    const hop = fn.slice(fn.indexOf('k: "posted_backfill", v: { ...(typeof pbDone'));
    expect(hop.slice(0, 400)).toMatch(/datedTotal:/);
  });
});

// A guard that readFileSyncs ONE historical migration cannot see a later
// redefinition, and redefinition-by-later-migration is this repo's norm:
// get_date_coverage is defined in six separate migration files. The newest
// definition is what the database runs, so a guard pinned to an older one is
// asserting against dead text and passes regardless of production behaviour.
function latestMigrationDefining(fnName: string): string {
  const dir = resolve(root, "supabase/migrations");
  const hit = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort() // filenames are timestamp-prefixed, so lexical order IS apply order
    .filter((f) => new RegExp(`FUNCTION\\s+public\\.${fnName}\\s*\\(`).test(readFileSync(resolve(dir, f), "utf8")))
    .pop();
  if (!hit) throw new Error(`no migration defines ${fnName}`);
  return readFileSync(resolve(dir, hit), "utf8");
}

describe("Ghost Job Index age stats use the company's date, not our discovery time", () => {
  const sql = latestMigrationDefining("get_ghost_job_index_stats");

  it("median posting age has no first_seen fallback", () => {
    // Rendered label: "by the company's own stated post date". It was computed
    // as median(now() - first_seen) over EVERY row. Measured on 4,179 rows
    // carrying both fields the bases differ by 17.6 days at the median, and the
    // published number was the flattering one.
    // Asserted as a PROPERTY, not as one spelling of it. This used to pin the
    // exact percentile_cont expression, which failed when the median was
    // rewritten to an index-ordered offset over the same column — correct code,
    // rejected for its shape. The rule that matters is narrower and stronger:
    // our discovery timestamp must not appear in this function at all, however
    // the median is computed.
    // THE COMPUTATION MOVED; THE RULE DID NOT. get_ghost_job_index_stats is now
    // a single-row read of job_board_stats_rollup — it aggregated on the request
    // path and returned 57014 at 60s for 5.3 days — and the eight measurements
    // are computed by refresh_ghost_stats() on a cron. So the posting-age basis
    // is asserted where it is now calculated, and the reader is separately held
    // to computing nothing at all, which is a stronger pair than before.
    const compute = latestMigrationDefining("refresh_ghost_stats");
    const cBody = compute.slice(compute.indexOf("FUNCTION public.refresh_ghost_stats"));
    const cOnly = cBody.slice(0, cBody.indexOf("END $$;")).replace(/--[^\n]*/g, "");
    expect(cOnly, "first_seen is our discovery time, never a posting age").not.toMatch(/first_seen/);
    expect(cOnly, "the age median must be measured from posted_at").toMatch(/now\(\) - p?\.?posted_at/);

    const fnBody = sql.slice(sql.indexOf("FUNCTION public.get_ghost_job_index_stats"));
    const bodyOnly = fnBody.slice(0, fnBody.indexOf("$$;")).replace(/--[^\n]*/g, "");
    expect(bodyOnly, "first_seen must not appear in the reader either").not.toMatch(/first_seen/);
    expect(bodyOnly, "the reader must read the rollup, not recompute").toMatch(/job_board_stats_rollup/);
    expect(bodyOnly, "no aggregate belongs on the request path").not.toMatch(/percentile_cont|count\(\*\)/);
  });

  it("time-to-close does not substitute first_seen either", () => {
    // Published as "measured only where the post date is stated".
    expect(sql).toMatch(/closed_at - posted_at/);
    expect(sql).not.toMatch(/closed_at - COALESCE\(posted_at, first_seen\)/);
  });

  it("the coverage caveat the page renders actually exists in the signature", () => {
    // GhostJobIndex.tsx gates the qualifier on stats?.posted_coverage_pct != null.
    // It was absent from the deployed RETURNS TABLE, so the caveat had never
    // rendered once — users saw only the unqualified claim.
    expect(sql).toMatch(/posted_coverage_pct numeric/);
    const page = readFileSync(resolve(root, "src/pages/GhostJobIndex.tsx"), "utf8");
    expect(page).toMatch(/posted_coverage_pct/);
  });

  it("published counts exclude rows the board refuses to serve", () => {
    // A column headed "Open postings" must mean postings we will actually show.
    expect(sql).toMatch(/WHERE missing_since IS NULL/);
    expect(latestMigrationDefining("get_date_coverage")).toMatch(/WHERE missing_since IS NULL/);
  });

  it("the page reads the column the RPC actually returns", () => {
    // THE GATE WAS WIRED TO A RETIRED COLUMN. get_ghost_job_index_stats
    // returned `tracking_days` up to 20260721260000 and `observed_days` in
    // every signature since. The page kept reading the old name, so it was
    // permanently undefined — which silently disabled both things gated on it:
    // the "In the N days we've kept this record" opener fell back to its vaguer
    // form, and the time-to-close sentence (gated on >= 21) could never be true
    // and had not rendered once since the rename. Verified live once fixed:
    // "In the 27 days we've kept this record … about 11 days".
    //
    // Third occurrence of this exact shape on this page, after
    // posted_coverage_pct and the first_seen median. A renamed field does not
    // error — it reads as a deliberately withheld statistic.
    const page = readFileSync(resolve(root, "src/pages/GhostJobIndex.tsx"), "utf8");
    const cols = /RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE/.exec(
      latestMigrationDefining("get_ghost_job_index_stats"),
    )?.[1] ?? "";
    expect(cols, "could not read the RPC signature").not.toBe("");
    expect(cols).toMatch(/observed_days/);
    // Whatever the page gates the closure copy on must be a column the RPC
    // returns — reading only the retired name is the bug this guards.
    expect(page).toMatch(/stats\?\.observed_days/);
    expect(page, "the gate must not depend solely on the retired column")
      .not.toMatch(/\(stats\?\.tracking_days \?\? 0\) >= 21/);
  });

  it("time-to-close names the 30-day window it is measured inside", () => {
    // THE MEDIAN IS CENSORED BY THE BOARD'S OWN RULE. A posting older than 30
    // days is dropped, so it exits rather than being recorded as closed, and no
    // closure longer than that can enter the figure. Measured 2026-08-09 on the
    // 400 closures with the oldest post dates — the ones most able to run long:
    // every top duration was exactly 30.0 days, none exceeded it. A hard
    // ceiling, not a tail.
    //
    // The page said "a typical role closes in about 11 days of the company
    // posting it", which reads as a fact about hiring when it is a fact about
    // roles that close inside a month. Same class as the first_seen-vs-posted_at
    // incident: the number was right and the sentence around it was not.
    const page = readFileSync(resolve(root, "src/pages/GhostJobIndex.tsx"), "utf8");
    const claim = page.slice(page.indexOf("median_days_to_close != null"));
    const sentence = claim.slice(0, claim.indexOf("Postings that never close"));
    expect(sentence, "the rendered claim must state the 30-day window").toMatch(/within 30 days/);
    // …and the methodology entry must explain WHY the bound exists, or the
    // number reads as a fact about hiring speed rather than about this board.
    const method = page.slice(page.indexOf('term: "Typical time to close"'));
    expect(method.slice(0, 1400)).toMatch(/drops any posting older than 30 days|structural/);
  });

  it("every surface quoting time-to-close states the 30-day window", () => {
    // The same censored median is quoted per employer on the account page
    // ("this employer typically fills in ~11d") and on a board tooltip
    // ("a typical role here closes in about 11 days"). The 30-day ceiling
    // applies identically there: a role that stays open longer leaves the board
    // instead of being recorded as closed, so these figures cannot see it.
    //
    // A claim qualified on one page and bare on two others is the same drift
    // the sources note had — and worse here, because these live in nine
    // locales, where the translated value overrides the English default and
    // the qualifier has to exist in all of them or it simply is not shown.
    const KEYS: Array<[string, string]> = [
      ["accountPage", "replyWindow"],
      ["accountPage", "replyWindowPast"],
      ["jobsPage", "urgencyTipFills"],
    ];
    for (const file of readdirSync(localeDir).filter((f) => f.endsWith(".json"))) {
      const d = readJson(resolve(localeDir, file)) as Record<string, Record<string, string>>;
      for (const [sec, key] of KEYS) {
        const v = d[sec]?.[key];
        if (!v) continue;
        expect(v, `${file} ${sec}.${key} quotes the median with no 30-day bound`).toMatch(/30/);
      }
    }
    // The inline English defaults too: a missing translation must not fall back
    // to the unqualified sentence.
    const account = readFileSync(resolve(root, "src/pages/Account.tsx"), "utf8");
    const jobs = readFileSync(resolve(root, "src/pages/Jobs.tsx"), "utf8");
    expect(account).not.toMatch(/\(from \{\{n\}\} tracked fills\)/);
    expect(jobs).not.toMatch(/then closed\), a typical role/);
    expect(account).toMatch(/fills tracked within 30 days of posting/);
    expect(jobs).toMatch(/then closed within 30 days of posting/);
  });

  it("an EMPTY answer is not published as a good one", () => {
    // MEASURED 2026-08-09, and it did visible harm. get_ghost_job_index_stats
    // returned zero rows (its rollup had not filled), which is not an
    // exception — so refresh_stats_cache's per-piece handler never fired. It
    // wrote ghost_stats: null over four hours of perfectly good previous
    // values and reported stale_parts: []. GhostJobIndex reads the cache first
    // and fell through to the same empty RPC, so the page lost its figures
    // while every health signal stayed green.
    //
    // A caught error and an empty answer are different events with the same
    // consequence, and only one of them was handled.
    const cache = latestMigrationDefining("refresh_stats_cache");
    for (const part of ["ghost_stats", "entry_stats"]) {
      expect(
        cache,
        `${part} can still be published as a JSON null`,
      ).toMatch(new RegExp(`jsonb_typeof\\(payload -> '${part}'\\) = 'null'`));
    }
    // …and the guard must restore the previous value, not just rename it.
    expect(cache).toMatch(/stale := stale \|\| 'ghost_stats';\s*\n\s*payload := payload \|\| jsonb_build_object\('ghost_stats', prev -> 'ghost_stats'\);\s*\n\s*END IF;/);
  });

  it("the ghost rollup always writes a row, even when parts fail", () => {
    // The all-or-nothing version left NOTHING behind through a migration seed
    // and two cron ticks, so the reader had no row to serve and the whole
    // index went dark. A row naming its stale parts beats an absent row.
    // Bounded to this function's own END, because the same migration defines
    // refresh_stats_cache below it — an unbounded slice compared the ghost
    // INSERT against the LAST exception block in a different function and
    // failed for a reason that had nothing to do with the property.
    const gs = latestMigrationDefining("refresh_ghost_stats");
    const from = gs.indexOf("FUNCTION public.refresh_ghost_stats");
    const body = gs.slice(from, gs.indexOf("END $$;", from));
    const insertAt = body.indexOf("INSERT INTO public.job_board_stats_rollup");
    const lastExc = body.lastIndexOf("EXCEPTION WHEN OTHERS THEN");
    expect(insertAt, "no unconditional write").toBeGreaterThan(-1);
    expect(insertAt, "the write must come after the last handler, not before it").toBeGreaterThan(lastExc);
    // …and that handler must have CLOSED before the write, or the write is
    // still inside a block that a failure can skip. Ordering alone does not
    // prove that: text placed just after "EXCEPTION WHEN OTHERS THEN" is later
    // in the file and still inside the block.
    expect(
      body.slice(lastExc, insertAt),
      "the write sits inside an exception block a failure would skip",
    ).toMatch(/\bEND;/);
    expect(body).toMatch(/'stale_parts', to_jsonb\(stale\)/);
  });
});

describe("dropped postings are unreachable by EVERY route", () => {
  const fn = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");

  it("the detail action filters them", () => {
    // 20260728120000 claimed to cover "every query shape" and missed this one,
    // so a Google-indexed deep link still rendered a live listing with a
    // working apply button.
    expect(fn).toMatch(/\.eq\("id", id\)\.is\("missing_since", null\)/);
  });

  it("the sitemap does not submit them to search engines", () => {
    const sm = fn.slice(fn.indexOf('.select("id, posted_at")'));
    expect(sm.slice(0, 300)).toMatch(/\.is\("missing_since", null\)/);
  });
});

describe("verify-on-apply cannot destroy a live posting on one probe", () => {
  const fn = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");
  const verify = fn.slice(fn.indexOf("const deadIds: string[] = []"));

  it("a first miss stamps, it does not delete", () => {
    // checkLive reported GONE for 7 of 50 randomly sampled LIVE Workday
    // postings. The cause was found on 2026-08-06: the stored externalId is the
    // externalPath's `_`-suffix, which carries a `-N` dedupe discriminator for
    // multi-location reqs, and Workday's search index holds only the base req
    // id — so we were searching for an id that does not exist. The old branch
    // deleted unconditionally, so a user clicking Apply was the thing
    // destroying the row. The probe is fixed; the two-pass rule stays, because
    // no single probe should ever be able to destroy an open job.
    expect(verify.slice(0, 3800)).toMatch(/update\(\{ missing_since: stampIso \}\)/);
    expect(verify.slice(0, 3800)).toMatch(/nowMs - Date\.parse\(st\) >= VERIFY_GRACE_MS/);
  });

  it("its grace outlasts a cold rotation", () => {
    // The refresh prune's 5-minute GRACE_MS corroborates against a FULL feed
    // re-read; this path has only a single-posting probe with a measured 14%
    // false-negative rate, so one rotation must be able to clear the stamp.
    expect(fn).toMatch(/const VERIFY_GRACE_MS = 6 \* 60 \* 60_000;/);
  });

  it("the workday probe confirms a miss before calling it a closure", () => {
    // The `-N` discriminator bug above is only invisible again once the probe
    // stops treating an empty search as proof. Two corroborations must survive:
    // the base-id retry, and the authoritative CXS detail endpoint. Measured
    // over 172 postings seen live in the feed that same second — 5 false
    // closures before, 0 after, with fabricated ids still reading gone 30/30.
    const wd = fn.slice(fn.indexOf('if (src.source === "workday") {\n      // Workday has no by-id endpoint'));
    expect(wd.slice(0, 3600)).toMatch(/externalId\.replace\(\/-\\d\+\$\/, ""\)/);
    expect(wd.slice(0, 3600)).toMatch(/workdayCxsUrl\(applyUrl\)/);
    // A non-404 on the authoritative probe is unknown, never a closure.
    expect(wd.slice(0, 3600)).toMatch(/if \(det\.status === 404\) return false;/);
    expect(wd.slice(0, 3600)).toMatch(/if \(!det\.ok\) return null;/);
  });

  it("both callers hand the probe the apply_url it needs to be authoritative", () => {
    // checkLive can only reach the CXS detail endpoint via apply_url. If a
    // caller stops passing it, the probe silently drops back to the search
    // index that caused the incident — with no type error to catch it.
    expect(fn).toMatch(/select\("id, apply_url"\)/);
    expect(fn).toMatch(/checkLive\(src, externalId, applyBy\.get\(id\) \?\? null\)/);
    expect(fn).toMatch(/checkLive\(src, rest\.join\(":"\), applyBy\.get\(id\) \?\? null\)/);
  });
});

describe("the accuracy alarm rests on a sample big enough to mean something", () => {
  const hb = readFileSync(resolve(root, "supabase/functions/scan-heartbeat/index.ts"), "utf8");
  const board = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");

  it("a vendor pages only on DECIDED probes, not on drawn ids", () => {
    // The old gate was `sampled >= 5`, which the ~6-per-vendor stratified draw
    // clears every run. Two dead listings out of 6 then reads 66.7% and pages.
    // At a true 3% death rate that lands on some vendor about one day in six,
    // so the alarm carried almost no information — and a real break looked the
    // same as noise.
    expect(hb).toMatch(/const MIN_VENDOR_DECIDED = 20;/);
    expect(hb).toMatch(/\(\(b\.live \?\? 0\) \+ \(b\.gone \?\? 0\)\) >= MIN_VENDOR_DECIDED/);
  });

  it("the audit re-draws a suspicious vendor instead of publishing the thin number", () => {
    // MIN_VENDOR_DECIDED only stops false alarms if something still catches a
    // REAL break — that something is this escalation, which takes any low
    // vendor up to a 30-probe sample before the floor is applied to it.
    expect(board).toMatch(/const SUSPECT_PCT = 90;/);
    expect(board).toMatch(/const DEEPEN_TO = 30;/);
    expect(board).toMatch(/b\.deepened = true;/);
  });

  it("a stratum is never skipped because its count failed", () => {
    // Shipped and caught in production the same day: the exact per-vendor count
    // outgrew the statement timeout at ~590k postings, every count 500'd, each
    // vendor took n = 0, `n === 0` skipped the draw, and a zero-row vendor is
    // not a "missing source" — so the audit published a figure covering 6 of 15
    // hiring systems while its coverage line claimed it had reached them all.
    // Counts are now planner estimates, an unknown count is null rather than 0,
    // and the draw runs regardless of what the count did.
    expect(board).toMatch(/count: "planned", head: true \}\)\.eq\("source", v\)/);
    expect(board).toMatch(/const vendorRows: Record<string, number \| null> = \{\}/);
    // The count no longer controls whether the vendor is drawn at all.
    expect(board).not.toMatch(/if \(cErr\) \{ drawErrors\[v\] = `count: \$\{cErr\.message\}`; continue; \}/);
    // Unknown size still reports as missing rather than vanishing.
    expect(board).toMatch(/\(n === null \|\| n > 0\) && !sampledSources\.has\(v\)/);
    expect(board).toMatch(/"posting count unavailable"/);
  });

  it("coverage shares admit they are estimates", () => {
    expect(board).toMatch(/basis: "planner estimate"/);
  });

  it("an unmeasurable corpus fails the capacity check instead of reading as full headroom", () => {
    // Same root cause, worse blast radius: `corpusSize ?? 0` turned a timed-out
    // count into a corpus of zero, so the meta row published headroom = the
    // entire ceiling and the capacity guard went green while blind.
    expect(board).toMatch(/corpusBasis === "exact" && \(corpusSize as number\) > CORPUS_CEILING/);
    expect(board).toMatch(/headroom: corpusSize === null \? null : CORPUS_CEILING - corpusSize/);
    expect(hb).toMatch(/const capUnmeasured =/);
    expect(hb).toMatch(/passed: !capTight && !capUnmeasured/);
  });

  it("a monitor that cannot measure says so instead of disappearing", () => {
    // job_board_freshness_claim skipped silently when its RPC returned nothing.
    // On 2026-08-06 get_freshness_stats outgrew its own 20s statement timeout
    // and failed on EVERY call, so the check vanished from the heartbeat output
    // and the published "re-verified within a few hours" claim went unwatched —
    // with no signal that watching had stopped.
    expect(hb).toMatch(/claim is currently UNWATCHED/);
    expect(hb).toMatch(/Board freshness claim unwatched/);
    // The two RPC-unavailable paths (empty result, and throw) must not skip.
    // The remaining skip — "too thin a sample to judge" — is a different and
    // legitimate statement: the monitor ran and declined to draw a conclusion,
    // which is not the same as the monitor being gone.
    expect(hb).not.toMatch(/skip\('job_board_freshness_claim', 'get_freshness_stats/);
    expect(hb).not.toMatch(/skip\('job_board_freshness_claim', e instanceof Error/);
    expect(hb).toMatch(/skip\('job_board_freshness_claim', `only \$\{f\.boards \?\? 0\} stamped boards/);
  });

  it("the deploy check's bound sits clear of what status actually costs", () => {
    // Status measured 8.5-26s across seven probes; a 15s abort sat inside that
    // spread, so the check flapped "board unreachable" at a board that was
    // serving audits the same minute.
    expect(hb).toMatch(/controller\.abort\(\), 35000\)/);
    expect(hb).not.toMatch(/controller\.abort\(\), 15000\)/);
  });

  it("the stats behind status are precomputed, not aggregated per request", () => {
    const mig = readFileSync(
      resolve(root, "supabase/migrations/20260806120000_precompute_the_stats_that_outgrew_their_timeouts.sql"),
      "utf8",
    );
    // Both RPCs read the rollup rather than scanning 592k rows.
    expect(mig).toMatch(/CREATE TABLE IF NOT EXISTS public\.job_board_stats_rollup/);
    expect(mig).toMatch(/FROM public\.job_board_stats_rollup r\s+WHERE r\.k = 'freshness'/);
    expect(mig).toMatch(/WHERE r\.k = 'date_coverage'/);
    // DROP before CREATE — Postgres refuses to replace a function whose return
    // type changed, and both gain a trailing computed_at.
    expect(mig).toMatch(/DROP FUNCTION IF EXISTS public\.get_freshness_stats\(\);/);
    expect(mig).toMatch(/DROP FUNCTION IF EXISTS public\.get_date_coverage\(\);/);
    // Refreshed on a schedule, and seeded so it isn't empty on arrival.
    expect(mig).toMatch(/cron\.schedule\(\s*'job-board-stats-rollup',\s*'\*\/15 \* \* \* \*'/);
    expect(mig).toMatch(/PERFORM public\.refresh_job_board_stats\(\);/);
    // Signatures keep every existing caller working, plus a computed_at so the
    // staleness of a precomputed stat is stated rather than hidden.
    expect(mig).toMatch(/RETURNS TABLE \(boards integer, p50_min numeric, p95_min numeric, max_min numeric, computed_at timestamptz\)/);
    expect(mig).toMatch(/RETURNS TABLE \(source text, total bigint, dated bigint, computed_at timestamptz\)/);
    // The writer is not callable by the public.
    expect(mig).toMatch(/REVOKE ALL ON FUNCTION public\.refresh_job_board_stats\(\) FROM anon, authenticated;/);
    // And status no longer carries an 8-second floor waiting on it.
    expect(board).toMatch(/withDeadline\(client\.rpc\("get_date_coverage"\), 2_500\)/);
  });

  it("the alert names the breach that actually fired", () => {
    // This summary line is what the alert email leads with, and it read "Board
    // accuracy 97.8% (below 97% SLA)" — a per-vendor breach in the overall
    // SLA's words, which is self-contradictory on its face.
    expect(hb).toMatch(/lowOverall \? `Board accuracy \$\{aV\.accuracyPct\}% \(below 97% SLA\)`/);
    expect(hb).toMatch(/badVendors\.length > 0 \? `Board accuracy: vendor\(s\) below the 80% floor/);
  });
});

describe("published nouns match what was counted", () => {
  const jobs = readFileSync(resolve(root, "src/pages/Jobs.tsx"), "utf8");
  const ghost = readFileSync(resolve(root, "src/pages/GhostJobIndex.tsx"), "utf8");

  it("/jobs says company feeds, because that is what companiesCount counts", () => {
    // companiesCount is the company_token facet size — one employer with
    // several ATS sub-boards counts several times, 869 more than the DB's own
    // distinct-employer number.
    expect(jobs).not.toMatch(/\{\{companies\}\} companies/);
    expect(jobs).toMatch(/\{\{companyFeeds\}\} company feeds/);
  });

  it("the transparency page names every vendor inside its own figures", () => {
    // It named 12 of 15 while the table below it listed all 15; iCIMS, Oracle
    // and Pinpoint postings are inside total_open and inside the medians.
    for (const v of ["iCIMS", "Oracle", "Pinpoint"]) expect(ghost).toContain(v);
  });

  it("the 30-day bullet is not an unqualified absolute", () => {
    // Contradicted this page's own glossary, which says undated postings are
    // kept and show no age.
    expect(ghost).not.toMatch(/Any role whose posting date passes 30 days is automatically dropped, so ghost\/pipeline postings other boards leave up for months never appear\./);
    expect(ghost).toMatch(/cannot be judged old/);
  });

  it("only one freshness number is published, and it is the measured one", () => {
    // /jobs said "updated 931 min ago" off the full-rotation stamp while the
    // measured re-check median was 112 min and the footer promised 10-15.
    expect(jobs).not.toMatch(/jobsPage\.updatedAgo/);
    expect(jobs).toMatch(/jobsPage\.recheckedAgo/);
  });
});

describe("the scan-feedback control never thanks you for nothing", () => {
  const c = readFileSync(resolve(root, "src/components/ScanFeedback.tsx"), "utf8");

  it("checks the returned error instead of relying on a throw", () => {
    // supabase-js .rpc() RESOLVES with {data,error} on a PostgREST 404, so the
    // old catch was dead code and "Thanks for the feedback!" ran unconditionally
    // against a function that does not exist in production.
    expect(c).toMatch(/if \(res\?\.error\)/);
    const idx = c.indexOf('setSubmitted(rating ? "up" : "down")');
    expect(c.slice(0, idx)).toMatch(/return;/);
  });

  it("tells the user when nothing was recorded", () => {
    expect(c).toMatch(/nothing was recorded/);
  });
});

// Each of these iterates all 9 locale files, which READS as 9x coverage, but
// the patterns only matched English, so a false claim introduced in any other
// locale would ship green. Verified latent, not live — no locale violated them
// at the time. Now every locale carries its own assertion.
describe("locale guards actually check every locale", () => {
  const LOCALES = ["en", "en-GB", "es", "fr", "de", "pt", "nl", "hi", "tl"];

  it("the 30-day claim is qualified in all nine languages, not just English", () => {
    // The old ABSOLUTE regex was English-only, so de "Keine datierte Anzeige
    // älter als 30 Tage" and es "Ninguna vacante ... supera los 30 días" were
    // never actually examined.
    const QUALIFIER: Record<string, RegExp> = {
      "en": /dated|stated/i,
      "en-GB": /dated|stated/i,
      "es": /fechada|con fecha|indicada|indica|informa/i,
      "fr": /datée|datee|indiquée|indiquee|indique|précise|precise/i,
      "de": /datierte|datiert|angegeben|angibt|nennt/i,
      "pt": /datada|com data|indicada|indica|informada|informa/i,
      "nl": /gedateerde|gedateerd|opgegeven|vermeldt|opgeeft/i,
      "hi": /डेटेड|तारीख|तिथि|दिनांक|बताई|बताती/,
      "tl": /petsa|nakasaad|ibinigay|sinabi/i,
    };
    for (const l of LOCALES) {
      const j = JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${l}.json`), "utf8"));
      const hay = JSON.stringify(j);
      const m = hay.match(/[^"]*30[^"]*/g) ?? [];
      const thirtyDayClaims = m.filter((x) => /30\s*(days|días|dias|jours|Tagen|Tage|dagen|दिन|araw)/i.test(x));
      for (const claim of thirtyDayClaims) {
        // Any sentence promising nothing older than 30 days must say WHICH
        // postings that covers — undated ones are kept and show no age.
        if (/nothing|no postings?|ninguna|aucune|keine|nenhuma|geen|कोई|walang/i.test(claim)) {
          expect(claim, `${l}: unqualified 30-day absolute -> ${claim}`).toMatch(QUALIFIER[l]);
        }
      }
    }
  });

  it("every locale carries both plural forms of the feed-health line", () => {
    // Rendered "1 company feeds are unreachable right now" — on the exact line
    // users read to judge whether the board is being straight with them.
    for (const l of LOCALES) {
      const j = JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${l}.json`), "utf8"));
      expect(j.jobsPage.sourcesDown_one, `${l} missing sourcesDown_one`).toBeTruthy();
      expect(j.jobsPage.sourcesDown_other, `${l} missing sourcesDown_other`).toBeTruthy();
      expect(j.jobsPage.sourcesDown, `${l} still has the count-blind base key`).toBeUndefined();
    }
  });

  it("every locale switched to the company-feeds noun together", () => {
    for (const l of LOCALES) {
      const j = JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${l}.json`), "utf8"));
      for (const k of ["countLine", "resultsSummary"]) {
        expect(j.jobsPage[k], `${l}.${k}`).toContain("{{companyFeeds}}");
        expect(j.jobsPage[k], `${l}.${k} still interpolates {{companies}}`).not.toContain("{{companies}}");
      }
      expect(j.jobsPage.recheckedAgo, `${l} missing recheckedAgo`).toBeTruthy();
    }
  });
});

// A diagnostic whose delivery depends on the thing it diagnoses reports
// nothing. The first version passed the hop outcome to the NEXT hop via
// chain(), but the failure being diagnosed is that the chain never reaches hop
// 2 — so note stayed null on a live deploy while the sweep sat at 0% dated.
describe("the sweep's hop outcome does not depend on the chain surviving", () => {
  const fn = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");

  it("writes the outcome directly, not only through chain()", () => {
    const hop = fn.slice(fn.indexOf("const datedTotal = (typeof body.datedTotal"));
    expect(hop.slice(0, 1800)).toMatch(/job_board_meta"\)\.upsert\(/);
    expect(hop.slice(0, 1800)).toMatch(/note: `hop: \$\{dated\}\/\$\{scanned\} boards=/);
  });

  it("the draw failure path also writes directly", () => {
    // This one already worked, and its null told us the draw does NOT throw.
    expect(fn).toMatch(/note: `draw: \$\{error\.message \?\? error\}`/);
  });
});

// The draw loop was an INFINITE LOOP for the per-posting phases, and it is the
// whole reason bamboohr and rippling sat at 0% dated for weeks while
// greenhouse reached 99.2%. `scanned <= IDS_PER_HOP` stays true at exactly
// IDS_PER_HOP, brokeEarly suppresses the exhausted flag, and the next pass
// breaks on its first row without advancing scanned or cursor.
describe("the posted-date draw loop always terminates", () => {
  const fn = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");

  it("bounds the hop with a STRICT comparison", () => {
    expect(fn).not.toMatch(/scanned <= IDS_PER_HOP/);
    expect(fn).not.toMatch(/byBoard\.size <= BOARDS_PER_HOP/);
    expect(fn).toMatch(/perPosting \? scanned < IDS_PER_HOP : byBoard\.size < BOARDS_PER_HOP/);
  });

  it("a page that advances nothing ends the loop", () => {
    // The board-based branch can wedge the same way: rows for tokens beyond
    // BOARDS_PER_HOP `continue` without advancing the cursor, so a full page of
    // new tokens would redraw the same 500 rows forever.
    expect(fn).toMatch(/if \(cursor === lastCursor && !brokeEarly\) exhausted = true;/);
  });

  it("simulating the old condition reproduces the hang", () => {
    // Guard the REASONING, not just the character. IDS_PER_HOP=120, pages of
    // 500: with <= the loop never terminates; with < it does.
    const run = (strict: boolean) => {
      const CAP = 120;
      let scanned = 0, exhausted = false, turns = 0;
      while ((strict ? scanned < CAP : scanned <= CAP) && !exhausted) {
        if (++turns > 50) return "hung";
        let brokeEarly = false;
        for (let i = 0; i < 500; i++) {
          if (scanned >= CAP) { brokeEarly = true; break; }
          scanned++;
        }
        if (!brokeEarly && 500 < 500) exhausted = true;
      }
      return `terminated after ${turns}`;
    };
    expect(run(false)).toBe("hung");
    expect(run(true)).toBe("terminated after 1");
  });
});

// A hardcoded re-check interval is claim drift waiting to happen. "about every
// 10-15 minutes" was plausibly true at ~90k postings and far fewer boards; at
// 28,296 boards the measured figure is p50 81.6 min / p95 183.4 min (2026-07-29,
// get_freshness_stats over 22,877 stamped boards) — a ~6x overstatement that
// nothing caught, on the sentence whose whole job is to be believed.
//
// The rule is not "state a better number" — it is state NO fixed interval. The
// live median and 95th percentile are already published on the Ghost Job Index
// and move with the catalogue on their own.
describe("no locale promises a fixed re-check interval", () => {
  const LOCALES = ["en", "en-GB", "es", "fr", "de", "pt", "nl", "hi", "tl"];
  // "every N minutes" in each language, including the transliterations.
  const INTERVAL = /(\d+\s*[–-]\s*\d+|\bevery\s+\d+)\s*(minutes?|minutos?|minuto|minuten|min\b|मिनट)/i;

  for (const l of LOCALES) {
    it(`${l} states no fixed interval in board copy or changelog`, () => {
      for (const f of [`src/i18n/locales/${l}.json`, `src/i18n/changelog/${l}.json`]) {
        const raw = readFileSync(resolve(root, f), "utf8");
        const hits = (JSON.parse(raw) && raw.split("\n").filter((line) => INTERVAL.test(line) && /re-?check|revisan|vérifi|geprüft|reverific|gecheckt|जांचे|sinusuri/i.test(line)));
        expect(hits, `${f}: promises a fixed re-check interval -> ${hits[0]?.slice(0, 120)}`).toHaveLength(0);
      }
    });
  }
});

// "Newest first" was one refresh batch sorted alphabetically by employer.
// effective_posted ties across a whole 250-row upsert chunk (first_seen
// defaults to a transaction-stable now()), ingest runs per board, so a tie
// group is ONE employer — and the `id ASC` tie-break then walks employers
// alphabetically. Measured 2026-07-29: 13 of 60 first-page slots taken by two
// employers, in runs of 7 and 6.
describe("the board does not hand consecutive slots to one employer", () => {
  const fn = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");

  it("caps consecutive same-employer cards", () => {
    expect(fn).toMatch(/const MAX_CONSECUTIVE_PER_COMPANY = 2;/);
    expect(fn).toMatch(/function interleaveByCompany/);
  });

  it("runs AFTER the page is cut — the opposite of what this test first asserted", () => {
    // This guard originally pinned "BEFORE the cut", encoding the buggy design
    // as an invariant: applying it to an already-truncated slice seemed to cap
    // nothing the user sees. It was wrong, and it would have blocked the fix.
    // nextOffset advances in DB order over the PRE-slice buffer, so permuting
    // that buffer moves rows across a page boundary the cursor cannot see —
    // measured 1-2 duplicated and 1 dropped forever per boundary.
    // A test can be confidently wrong; this one was.
    const cut = fn.indexOf("const grouped = groupSimilar");
    const mix = fn.indexOf("grouped.jobs = interleaveByCompany(grouped.jobs)");
    expect(mix).toBeGreaterThan(cut);
  });

  it("defers rather than drops — every posting still appears", () => {
    // Assert the PROPERTY (deferred rows are always flushed), not the exact
    // return expression: the first version pinned `return out.concat(deferred)`
    // and broke when the tie-group bound replaced it with flush(); return out.
    const h = fn.slice(fn.indexOf("function interleaveByCompany"), fn.indexOf("function interleaveByCompany") + 2200);
    expect(h).toMatch(/const flush = \(\) => \{ out\.push\(\.\.\.deferred\)/);
    expect(h).toMatch(/\n  flush\(\);\n  return out;/);
  });

  it("never moves a row out of its tie group", () => {
    // Rows sharing an effective_posted are equally recent, so permuting them
    // carries no claim. Moving one ACROSS groups makes the page assert a
    // recency it does not have — the previous version inverted 22 of 59
    // adjacent pairs while its own comment promised the opposite.
    const h = fn.slice(fn.indexOf("function interleaveByCompany"), fn.indexOf("function interleaveByCompany") + 2200);
    expect(h).toMatch(/const tieOf =/);
    expect(h).toMatch(/if \(t !== tie\) \{ flush\(\); tie = t; \}/);
  });

  it("simulating it: caps runs where possible, loses nothing, respects tie groups", () => {
    const CAP = 2;
    const run = (rows: Array<{ c: string; t: string }>) => {
      const out: typeof rows = []; let deferred: typeof rows = [];
      let runKey = "", runLen = 0;
      let tie = rows.length ? rows[0].t : "";
      const flush = () => { out.push(...deferred); deferred = []; runKey = ""; runLen = 0; };
      for (const r of rows) {
        if (r.t !== tie) { flush(); tie = r.t; }
        if (r.c === runKey && runLen >= CAP) { deferred.push(r); continue; }
        if (r.c === runKey) runLen++; else { runKey = r.c; runLen = 1; }
        out.push(r);
        if (deferred.length) {
          const i = deferred.findIndex((d) => d.c !== runKey);
          if (i >= 0) { const [d] = deferred.splice(i, 1); runKey = d.c; runLen = 1; out.push(d); }
        }
      }
      flush();
      return out;
    };
    const longestRun = (rows: Array<{ c: string }>) => {
      let worst = 0, cur = 0, prev = "";
      for (const r of rows) { cur = r.c === prev ? cur + 1 : 1; prev = r.c; worst = Math.max(worst, cur); }
      return worst;
    };

    // THE REAL CASE the fix targets: 7 and 6 from two employers among 47 others,
    // which is what page 1 actually looked like (13 of 60 slots, runs of 7 and 6).
    const realistic = [
      ...Array(7).fill(0).map(() => ({ c: "A", t: "T1" })),
      ...Array(6).fill(0).map(() => ({ c: "B", t: "T1" })),
      ...Array(47).fill(0).map((_, i) => ({ c: `C${i}`, t: "T1" })),
    ];
    const got = run(realistic);
    expect(got).toHaveLength(realistic.length);        // nothing lost
    expect(longestRun(got)).toBeLessThanOrEqual(CAP);  // and the runs are capped

    // THE ADVERSARIAL CASE, asserted honestly rather than aspirationally: when a
    // tie group is dominated by ONE employer there is nothing left to interleave
    // with, so a run is arithmetically unavoidable. The guarantee that still
    // holds is that nothing is lost and no row crosses a tie boundary — which is
    // what protects pagination and recency. The cap is best-effort by design.
    const dominated = [
      ...Array(7).fill(0).map(() => ({ c: "A", t: "T1" })),
      ...Array(3).fill(0).map(() => ({ c: "B", t: "T1" })),
      ...Array(4).fill(0).map(() => ({ c: "A", t: "T2" })),
    ];
    const got2 = run(dominated);
    expect(got2).toHaveLength(dominated.length);                       // nothing lost
    expect(got2.slice(0, 10).every((r) => r.t === "T1")).toBe(true);   // no row crossed
    expect(got2.filter((r) => r.t === "T2")).toHaveLength(4);
  });

  it("simulating it breaks the measured 7-run and loses nothing", () => {
    // Guard the behaviour, not the characters.
    const CAP = 2;
    const run = (rows: string[]) => {
      const out: string[] = []; const deferred: string[] = [];
      let runKey = "", runLen = 0;
      for (const k of rows) {
        if (k && k === runKey && runLen >= CAP) { deferred.push(k); continue; }
        if (k === runKey) runLen++; else { runKey = k; runLen = 1; }
        out.push(k);
        if (deferred.length) {
          const i = deferred.findIndex((d) => d !== runKey);
          if (i >= 0) { const [d] = deferred.splice(i, 1); runKey = d; runLen = 1; out.push(d); }
        }
      }
      return out.concat(deferred);
    };
    const input = [...Array(7).fill("A"), ...Array(6).fill("B"), "C", "D"];
    const got = run(input);
    expect(got).toHaveLength(input.length);                       // nothing lost
    expect(got.filter((x) => x === "A")).toHaveLength(7);          // nothing duplicated
    let worst = 0, cur = 0, prev = "";
    for (const k of got) { cur = k === prev ? cur + 1 : 1; prev = k; worst = Math.max(worst, cur); }
    expect(worst).toBeLessThan(7);                                 // the 7-run is broken
  });
});

// Rows were written once and never corrected: `newRows` filters to ids we do
// not already hold, so a title the employer edited kept our first-ever value
// forever. Measured 2026-07-29 against live vendor payloads: title 1.16%,
// location 0.57% disagreement. The structural cost was larger — every
// normaliser improvement only ever reached rows inserted after it shipped.
describe("ingest corrects existing rows without undoing enrichment", () => {
  const fn = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");
  const block = fn.slice(fn.indexOf("const corrections: Array<Record<string, unknown>> = [];"),
                         fn.indexOf("for (let i = 0; i < newRows.length; i += 250)"));

  it("corrects vendor-authoritative fields on rows we already hold", () => {
    for (const f of ["title", "location", "apply_url", "country"]) {
      expect(block, `${f} not corrected`).toContain(`put("${f}"`);
    }
  });

  it("NEVER touches fields owned by a later enrichment step", () => {
    // posted_at belongs to the dating sweep, category to the categoriser,
    // description and experience_band to the description fills. Writing an
    // ingest-time null into any of them would undo work that took weeks.
    for (const f of ["posted_at", "category", "description", "experience_band", "first_seen"]) {
      expect(block, `${f} must not be written by the correction pass`).not.toContain(`put("${f}"`);
      expect(block).not.toMatch(new RegExp(`patch\\.${f}\\s*=`));
    }
  });

  it("an empty vendor value cannot erase a stored one", () => {
    // The whole safety property in one line.
    expect(block).toMatch(/if \(next === null \|\| next === undefined \|\| next === ""\) \{ if \(!allowNull\) return; \}/);
  });

  it("only writes rows that actually changed", () => {
    expect(block).toMatch(/if \(Object\.keys\(patch\)\.length\) corrections\.push/);
  });
});

// Oracle states a work mode on ~a third of its postings and we stored NULL for
// every one, because ORA_REMOTE lowercases to ora_remote and the lookup table
// only knew remote|hybrid|onsite|on_site. Measured 2026-07-29: where a vendor
// STATES a mode we disagreed 72.3% of the time (598 of 915 NULL, 64 wrong).
describe("vendor work modes are actually understood", () => {
  const nz = readFileSync(resolve(root, "supabase/functions/job-board/normalize.ts"), "utf8");

  it("knows Oracle's own vocabulary", () => {
    for (const c of ["ora_remote", "ora_hybrid", "ora_onsite"]) expect(nz).toContain(`["${c}",`);
  });

  it("uses a Map, so the lookup cannot reach Object.prototype", () => {
    // Third instance of this hazard in this codebase — NAME_FIXES and
    // CATEGORY_ACCENT were the first two. `?? null` does not catch a function.
    expect(nz).toMatch(/const VENDOR_MODE = new Map</);
    expect(nz).toMatch(/VENDOR_MODE\.get\(/);
    // Comments explaining the old bug legitimately contain "VENDOR_MODE[v]",
    // so this must read executable lines only — the first version of this
    // assertion failed on the comment describing the very defect it guards.
    const code = nz.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/VENDOR_MODE\[/);
  });
});

// The category fill-speed line printed the REQUESTED window (90 days) as
// though it were the measured one. job_board_closures begins 2026-07-14 — the
// log is 15 days deep. Same defect as get_employer_benchmarks (fixed
// 20260727120000) and the ghost stats observed_days (20260727180000).
describe("fill-speed reports the window it actually observed", () => {
  it("clamps the published window to the log's real depth", () => {
    const mig = readFileSync(resolve(root, "supabase/migrations/20260729090000_fill_speed_observed_window.sql"), "utf8");
    expect(mig).toMatch(/LEAST\(\s*p_days,/);
    expect(mig).toMatch(/MIN\(closed_at\)/);
    expect(mig).toMatch(/GREATEST\(1,/); // a fresh log can never render as "0 days"
  });
});

// The product's whole claim is "every posting is real and still open". Until
// now the evidence for it lived only inside the detail panel — visible after
// the user had already decided to click. recheckedAt is already in the list
// payload (attachRecheckedAt), so putting it on the card costs no query.
describe("the verification receipt is visible before the click", () => {
  const jobs = readFileSync(resolve(root, "src/pages/Jobs.tsx"), "utf8");

  it("renders on the card, not only in the detail panel", () => {
    expect(jobs).toMatch(/job\.recheckedAt && !job\.missingSince/);
    expect(jobs).toMatch(/jobsPage\.verifiedAgo/);
  });

  it("renders nothing when there is no stamp", () => {
    // A missing stamp must never be dressed up as a weaker one — the same rule
    // that replaced lastSeen (insert-time) with recheckedAt (feed-read time).
    const blk = jobs.slice(jobs.indexOf("{job.recheckedAt && !job.missingSince"));
    expect(blk.slice(0, 700)).not.toMatch(/lastSeen|firstSeen|postedAt/);
  });

  it("every locale can render it", () => {
    for (const l of ["en", "en-GB", "es", "fr", "de", "pt", "nl", "hi", "tl"]) {
      const j = JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${l}.json`), "utf8"));
      expect(j.jobsPage.verifiedAgo, `${l} missing verifiedAgo`).toContain("{{ago}}");
    }
  });
});

// A draw timeout used to kill the hop, and because the resume stamp pins the
// chain to its phase, every kick then retried the same doomed query forever —
// leaving the earlier phases' rows stranded behind it. Measured 2026-07-29:
// greenhouse 3.2s -> 500, the identical query shape on rippling 0.34s -> 200,
// because greenhouse is 99.2% dated and must scan 59,878 rows to find 482.
describe("a slow phase cannot wedge the dating sweep", () => {
  const fn = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");
  const draw = fn.slice(fn.indexOf("note: `draw: ${error.message ?? error}`") - 900,
                        fn.indexOf("note: `draw: ${error.message ?? error}`") + 1600);

  it("marks the phase exhausted instead of throwing", () => {
    expect(draw).toMatch(/exhausted = true;\s*\n\s*break;/);
  });

  it("does not rethrow the draw error", () => {
    // Throwing is what pinned the chain to a phase it could never finish.
    expect(draw).not.toMatch(/throw error;/);
  });

  it("still records what happened", () => {
    // Advancing silently would be the same blindness in a new place.
    expect(draw).toMatch(/note: `draw: \$\{error\.message \?\? error\}`/);
  });
});

// I created a function OVERLOAD instead of replacing the original: the live
// signature takes (p_days, p_min_closures) and 20260729090000 wrote one arg.
// Every parameter on both has a DEFAULT, so a no-arg call became ambiguous —
// PGRST203 — and the fill-speed line stopped rendering on 18 landers. Worse
// than the overstatement it was meant to fix.
describe("the fill-speed repair replaces rather than overloads", () => {
  const fix = readFileSync(resolve(root, "supabase/migrations/20260729100000_fix_fill_speed_overload.sql"), "utf8");

  it("drops the accidental single-arg version", () => {
    expect(fix).toMatch(/DROP FUNCTION IF EXISTS public\.get_category_fill_speed\(integer\);/);
  });

  it("redefines the REAL two-arg signature", () => {
    expect(fix).toMatch(/p_days integer DEFAULT 90,\s*\n\s*p_min_closures integer DEFAULT 300/);
  });

  it("keeps what the original had — I dropped both of these the first time", () => {
    expect(fix).toMatch(/SECURITY DEFINER/);
    expect(fix).toMatch(/GREATEST\(p_min_closures, 50\)/);
  });

  it("still reports observed depth, which was the point", () => {
    expect(fix).toMatch(/MIN\(closed_at\)/);
    expect(fix).toMatch(/GREATEST\(1,/);
  });
});

// A filter audit found the same defect twice, independently: `category` and
// `workMode` were case-folded at every site that BINDS the predicate but not at
// the `unfiltered` gate that decides whether to count at all. So
// category=Engineering filtered the page correctly and then returned the cached
// board-wide total — 10 engineering cards under a headline of 587,793, against
// a true 66,842. Reachable from the URL: Jobs.tsx passes ?category= through raw.
describe("enum filters are case-folded once, at the door", () => {
  const fn = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");

  // REWRITTEN 2026-07-29, and the reason is worth keeping.
  //
  // The original three assertions matched the SOURCE TEXT of the morning's fix
  // — `if (typeof body.category === "string") body.category = ...` — and its
  // character offset relative to the gate. That guards one implementation, not
  // the behaviour. When the fix was replaced by a stronger mechanism (a single
  // normalisation in filters.ts feeding every site), all three went red while
  // the property they exist to protect held BETTER than before.
  //
  // A guard that fails when the code improves teaches people to delete guards.
  // These run the real normaliser instead, so any implementation that folds
  // casing correctly passes, and any that stops folding fails.
  it("folds every enum filter, whatever casing arrives", () => {
    expect(normalizeFilters({ category: "Engineering" }, 1).applied.category).toBe("engineering");
    expect(normalizeFilters({ category: "ENGINEERING" }, 1).applied.category).toBe("engineering");
    expect(normalizeFilters({ workMode: "REMOTE" }, 1).applied.workMode).toBe("remote");
    expect(normalizeFilters({ workMode: "Hybrid" }, 1).applied.workMode).toBe("hybrid");
    expect(normalizeFilters({ country: "de" }, 1).applied.country).toBe("DE");
  });

  it("the gate sees the FOLDED value — a mixed-case filter is never read as unfiltered", () => {
    // This is the actual defect: `unfiltered` compared the raw casing, decided
    // no count was needed, and published the whole catalogue's total — 587,793
    // — above 3,949 correctly filtered results.
    expect(isUnfiltered(normalizeFilters({ category: "Engineering" }, 1).applied)).toBe(false);
    expect(isUnfiltered(normalizeFilters({ workMode: "REMOTE" }, 1).applied)).toBe(false);
    expect(isUnfiltered(normalizeFilters({ country: "de" }, 1).applied)).toBe(false);
  });

  it("the count cannot bind a different value than the page", () => {
    // The second instance: cappedCount re-derived work mode with its own
    // expression and dropped the predicate on a mixed-case value — design+Remote
    // reported 3,940, exactly the count with the predicate absent. It fired only
    // when a SECOND filter was active, so it survived the fix to the gate above.
    // Both sites now read `applied`, so there is no second expression to drift.
    expect(fn).not.toMatch(/const wm\w* = String\(body\.workMode/);
    expect(fn).toContain("p_work_mode: applied.workMode");
    expect(fn).toContain("normalizeFilters(body");
  });
});

// My own regression, shipped this session and caught by the audit I asked for.
// interleaveByCompany ran BEFORE the page was cut, which read as the careful
// choice. But nextOffset advances in DB order (grouped.rawConsumed), so
// permuting the pre-slice buffer moved rows across a boundary the cursor knew
// nothing about: measured 1-2 postings duplicated onto page 2 and 1 dropped
// FOREVER per boundary, where the control scored 0/0.
describe("the same-employer interleave cannot lose a posting", () => {
  const fn = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");

  it("permutes only the page that is returned", () => {
    expect(fn).toMatch(/if \(!sortSalary\) grouped\.jobs = interleaveByCompany\(grouped\.jobs\);/);
  });

  it("never touches the pre-slice buffer", () => {
    // The buffer is what nextOffset counts. Reordering it is what dropped rows.
    expect(fn).not.toMatch(/const mappedRows = interleaveByCompany\(/);
  });

  it("runs AFTER the page is cut", () => {
    const cut = fn.indexOf("const grouped = groupSimilar");
    const mix = fn.indexOf("grouped.jobs = interleaveByCompany(grouped.jobs)");
    expect(cut).toBeGreaterThan(-1);
    expect(mix).toBeGreaterThan(cut);
  });

  it("exempts the salary sort, which the old comment claimed but the code did not", () => {
    // Salary ties on money, not on ingest batch: reordering produced 8
    // inversions in 59 adjacent pairs, up to $70k out of order, directly
    // contradicting "highest stated pay first".
    expect(fn).toMatch(/if \(!sortSalary\)/);
  });
});

// Filter-audit batch 3. Each of these was measured against production before
// being changed; the numbers live in the commit message.
describe("filters send and show one honest definition", () => {
  const jobs = readFileSync(resolve(root, "src/pages/Jobs.tsx"), "utf8");
  const fn = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");

  it("the UI sends ONE Remote predicate, not two that AND together", () => {
    // remote=true is a strict subset of work_mode='remote', so sending both
    // narrowed the user's own filter — 7.6% on {workMode:remote,country:GB}.
    expect(jobs).toMatch(/remote: \(remoteOnly && !workMode\) \|\| undefined,/);
    expect(jobs).not.toMatch(/remote: remoteOnly \|\| workMode === "remote"/);
  });

  it("freshness, sort and from survive a reload and a shared link", () => {
    // Measured: freshness narrowed 3,940 -> 965 then reverted to 3,940 after
    // reloading the app's OWN url; ?sort=salary survived 0 of 1 mounts.
    expect(jobs).toMatch(/p\.set\("fresh", freshness\)/);
    expect(jobs).toMatch(/p\.set\("sort", sortMode\)/);
    expect(jobs).toMatch(/p\.set\("from", fromParam\)/);
  });

  it("a repeated id cannot become a phantom sibling", () => {
    // Pages are appended and the corpus shifts under a paginating reader, so
    // the same posting legitimately arrives twice — up to 14 per 240 rows. The
    // grouping keys on company+title, so a duplicate became a "+1 more
    // locations" sibling AND inflated the count and the load-more gate.
    expect(jobs).toMatch(/const seenIds = new Set<string>\(\);/);
    expect(jobs).toMatch(/if \(seenIds\.has\(j\.id\)\) continue;/);
  });

  it("the hidden-openings disclosure refuses a capped denominator", () => {
    // Subtracting a filtered total from a CAPPED one understates without bound:
    // rendered 9,863 against a true 19,361.
    expect(jobs).toMatch(/if \(r\?\.countCapped\) \{ setDisclosure\(null\); return; \}/);
  });

  it("the country control does not vanish when its facet RPC fails", () => {
    // get_country_facet returned 57014 on 10 of 10 calls, so the picker
    // rendered 0% of the time and no country was selectable at all.
    expect(jobs).toMatch(/countryFacet\.length > 0 \|\| fallbackCountries\.length > 0/);
    expect(jobs).toMatch(/const fallbackCountries = useMemo\(/);
  });

  it("board-wide facet counts are not shown inside a filtered view", () => {
    // Correct on exactly one view and misleading on all others: sum 587,793
    // rendered beside a filtered total of 10,000 or less — 15.7x to 45x over.
    // REWRITTEN. This asserted there were exactly THREE gated sites — a census
    // of what existed when it was written, not a property. There were four, and
    // the ungated fourth (index.ts:5450, reading `v` rather than `v0`) was
    // invisible to this guard by construction: adding the gate BROKE it. A bug
    // sweep found the site the guard was supposed to be watching.
    //
    // The property is that NO site emits the facet ungated, however many exist.
    const ungated = fn.match(/categories: \((?:v|v0)\.categoriesFacet/g) ?? [];
    expect(ungated, `ungated board-wide facet site(s): ${ungated.join(", ")}`).toEqual([]);
    expect((fn.match(/categories: unfiltered \?/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("the country facet RPC counts only servable rows", () => {
    const mig = readFileSync(resolve(root, "supabase/migrations/20260729110000_filter_rpc_timeouts.sql"), "utf8");
    expect(mig).toMatch(/SET statement_timeout = '20s'/);
    expect(mig).toMatch(/AND missing_since IS NULL/);
    expect(mig).toMatch(/SECURITY DEFINER/);
  });
});

// Filter-audit batch 4 — the items I had deferred as "needs query plans". Most
// did not: they needed a deadline, a ceiling, or an honest refusal.
describe("slow work degrades instead of failing the request", () => {
  const fn = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");

  it("the count cannot hold the response open", () => {
    // Running it concurrently was never enough — Promise.all still WAITS, so a
    // slow count held the whole response and then took it down: HTTP 500 at
    // 35-79s on 24 of ~40 searches, while the page half is ~0.3s.
    expect(fn).toMatch(/const COUNT_DEADLINE_MS = 4_000;/);
    expect(fn).toMatch(/withDeadline\(cappedCount\(\)/);
  });

  it("the semantic tier can say no", () => {
    // A vector search always returns SOMETHING; it has no notion of "nothing is
    // close". 'zzzqqxwv' came back with one confident unrelated job, 2/2.
    expect(fn).toMatch(/const anchored = Array\.isArray\(sem\)/);
    expect(fn).toMatch(/sem\.length > 0 && anchored/);
  });

  it("an unhonourable filter value is named, not dropped", () => {
    // country="USA" returned 3,939 — the whole design category — because the
    // value was silently discarded and the board answered the unfiltered
    // question instead.
    //
    // Asserted by RUNNING the normaliser, not by matching the four source lines
    // that used to implement it. The earlier version pinned
    // `const ignoredFilters: string[] = [];` and two literal .push() calls, so
    // it failed the moment the same behaviour moved into filters.ts — while
    // simultaneously missing the array-shaped hole those very lines left open
    // (experience:["bogus"] was reported by neither the code nor this guard).
    expect(normalizeFilters({ country: "USA" }, 1).ignored).toContain("country");
    expect(normalizeFilters({ experience: "bogus" }, 1).ignored).toContain("experience");
    expect(normalizeFilters({ experience: ["bogus"] }, 1).ignored).toContain("experience");
    // ...and it still has to reach the caller.
    expect(fn).toMatch(/\.\.\.\(ignoredFilters\.length \? \{ ignoredFilters \} : \{\}\)/);
  });

  it("the two failing RPCs get ceilings and the serving rule", () => {
    const mig = readFileSync(resolve(root, "supabase/migrations/20260729110000_filter_rpc_timeouts.sql"), "utf8");
    expect(mig).toMatch(/get_country_facet/);
    expect(mig).toMatch(/get_company_hiring_health/);
    // Executable lines only — the header comments legitimately mention both
    // phrases while explaining why they are there. This is the third time a
    // guard of mine has matched its own explanation; scoping is the fix.
    const sql = mig.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(sql.match(/SECURITY DEFINER/g)?.length).toBe(2);
    expect(sql.match(/missing_since IS NULL/g)?.length).toBe(2);
  });

  it("a swallowed hiring-health failure now reads as absent, not as zero", () => {
    const jobs = readFileSync(resolve(root, "src/pages/Jobs.tsx"), "utf8");
    expect(jobs).toMatch(/setHealthFailed\(true\)/);
    expect(jobs).toMatch(/jobsPage\.healthUnavailable/);
    expect(jobs).not.toMatch(/RPC not deployed yet — no badges, no error surfaced/);
  });
});

// The last of the 26. A posting whose title is literally what the user typed
// was unreachable at ANY offset, because the candidate pool was truncated by
// RECENCY before anything was ranked. Measured on 'Patient Services Assistant':
// 36 title matches, 12,923 description matches, 200 slots requested -> 5 of 36
// returned (86% lost), 197 slots filled by description-only rows.
// The country fix shipped this morning did not work, and the test I wrote for
// it passed anyway. It asserted that rowToJob EMITS country — which it did —
// and could not see that no query ever SELECTS the column, so every row carried
// undefined. Live probe: three rows matching country=DE came back country:null.
// A mapper cannot invent a field the query did not ask for; assert the fetch.
describe("country is fetched, not just mapped", () => {
  const fn = readFileSync(resolve(root, "supabase/functions/job-board/index.ts"), "utf8");

  it("the serving SELECT lists country", () => {
    expect(fn).toMatch(/id,source,company_token,company,title,location,country,remote,work_mode/);
  });

  it("the mapper still emits it", () => {
    expect(fn).toMatch(/country: r\.country \?\? null,/);
  });

  it("the search RPC PROJECTS it, not just filters on it", () => {
    // search_jobs has always had `AND p.country = $4`; it never returned the
    // column, so the ranked path served country:null even when filtering by it.
    const mig = readFileSync(
      resolve(root, "supabase/migrations/20260729130000_search_returns_country.sql"), "utf8");
    expect(mig).toMatch(/location text, country text, remote boolean/);
    expect(mig).toMatch(/p\.location, p\.country, p\.remote/);
    // RETURNS TABLE cannot change under CREATE OR REPLACE — this must DROP, and
    // the drop must name the exact 14-type signature or it replaces nothing.
    expect(mig).toMatch(/DROP FUNCTION IF EXISTS public\.search_jobs\(text, timestamptz, text, boolean, text, text, text\[\], numeric, text\[\], timestamptz, integer, text, integer, integer\)/);
  });

  it("carries the title-match union through", () => {
    const mig = readFileSync(
      resolve(root, "supabase/migrations/20260729130000_search_returns_country.sql"), "utf8");
    expect(mig).toMatch(/SELECT sid FROM title_hits UNION SELECT sid FROM desc_hits/);
  });
});

describe("search cannot drop a title match before ranking", () => {
  const mig = readFileSync(
    resolve(root, "supabase/migrations/20260729120000_search_title_matches_always_reachable.sql"), "utf8");

  it("every title match enters the candidate pool unconditionally", () => {
    expect(mig).toMatch(/WITH title_hits AS \(/);
    expect(mig).toMatch(/WHERE p\.title_tsv @@ \$1/);
    expect(mig).toMatch(/SELECT sid FROM title_hits UNION SELECT sid FROM desc_hits/);
  });

  it("the title pool is NOT ordered by recency — that was the bug", () => {
    // desc_hits keeps its recency sample (that is the rescue). title_hits must
    // not, or a title match can still be cut before ranking.
    const th = mig.slice(mig.indexOf("WITH title_hits AS ("), mig.indexOf("), desc_hits AS ("));
    expect(th).not.toMatch(/ORDER BY p\.effective_posted DESC/);
  });

  it("the description rescue sample is preserved unchanged", () => {
    const dh = mig.slice(mig.indexOf("), desc_hits AS ("), mig.indexOf("), sample AS ("));
    expect(dh).toMatch(/ORDER BY p\.effective_posted DESC/);
    expect(dh).toMatch(/LIMIT 3000/);
  });

  it("replaces rather than overloads — signature-identical to the live one", () => {
    // A different arity creates an OVERLOAD, not a replacement, and every
    // parameter here has a default — which is exactly how
    // get_category_fill_speed became an ambiguous PGRST203 earlier today.
    const params = mig.match(/FUNCTION public\.search_jobs\(([\s\S]*?)\)\s*RETURNS TABLE/)?.[1] ?? "";
    expect(params.match(/DEFAULT/g)?.length).toBe(12);   // 14 params, 2 required
    expect(params).toMatch(/p_q text,/);
    expect(params).toMatch(/p_offset integer DEFAULT 0/);
    expect(mig).toMatch(/GRANT EXECUTE ON FUNCTION public\.search_jobs\(text, timestamptz, text, boolean, text, text, text\[\], numeric, text\[\], timestamptz, integer, text, integer, integer\)/);
  });
});
