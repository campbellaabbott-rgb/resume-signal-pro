import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE BOARD PUBLISHED ITS WORK-MODE COVERAGE AS ITS EXPERIENCE COVERAGE.
 *
 * The coverage block computed four counts and destructured three names:
 *
 *   const [sal, wm, exp] = await Promise.all([
 *     one("salary_rank_usd"...), one("salary_max_annual"...),
 *     one("work_mode"...),       one("experience_band"...),
 *   ]);
 *
 * The second entry was added for a pay-CEILING filter that was later refused
 * with data, and inserting it SECOND shifted every binding down one. So the
 * page printed the ceiling coverage as "work mode on 14%" (really 29.1%) and
 * the work-mode coverage as "experience level on 30%" (really 42.1%), while
 * the experience count was computed and discarded. Measured live 2026-08-24:
 * the board was understating its own coverage by roughly half, underneath a
 * sentence telling readers those figures were what employers actually state.
 *
 * A count with no reader is what caused it, so the orphan is deleted rather
 * than bound. The generic assertion below is the one that matters: a
 * Promise.all whose array is longer than its destructuring is this defect in
 * its general form, and it is invisible to the type checker.
 *
 * Second defect in the same block: the numerators did not apply the freshness
 * window that the denominator applied, so every fraction was a count over one
 * population divided by the size of a smaller one.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const JOBS = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
const stripTs = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const CODE = stripTs(FN);

describe("a published percentage must measure what it names", () => {
  it("every destructured Promise.all binds every promise it awaits", () => {
    // The general form of the defect. Scans the whole function: an array
    // longer than its names silently re-labels every value after the gap.
    const re = /const \[([^\]]*)\] = await Promise\.all\(\[([\s\S]*?)\n(\s*)\]\)/g;
    const offenders: string[] = [];
    for (const m of CODE.matchAll(re)) {
      const names = m[1].split(",").map((x) => x.trim()).filter(Boolean);
      const body = m[2];
      // Count top-level entries: commas at depth 0 of the array literal.
      let depth = 0, entries = 1;
      for (const ch of body) {
        if ("([{".includes(ch)) depth++;
        else if (")]}".includes(ch)) depth--;
        else if (ch === "," && depth === 0) entries++;
      }
      if (body.trim().endsWith(",")) entries--;
      if (entries !== names.length) {
        offenders.push(`[${names.join(", ")}] binds ${names.length} of ${entries} promises`);
      }
    }
    expect(offenders, "a promise with no name re-labels everything after it").toEqual([]);
  });

  it("the refused pay-ceiling count is gone, not merely unbound", () => {
    const cov = CODE.slice(CODE.indexOf("const coverage = await"), CODE.indexOf("const frac ="));
    expect(cov).not.toMatch(/salary_max_annual/);
    expect(cov).toMatch(/one\("work_mode", "not\.is\.null"\)/);
    expect(cov).toMatch(/one\("experience_band", "neq\.unspecified"\)/);
  });

  it("numerator and denominator stand on the same population", () => {
    const cov = CODE.slice(CODE.indexOf("const one = async (col"), CODE.indexOf("const frac ="));
    // The helper must apply the same freshness window the `open` denominator does.
    expect(cov).toMatch(/\.is\("missing_since", null\)\.gte\("effective_posted", freshIso\)/);
  });

  it("country is disclosed like the other three filters", () => {
    expect(CODE).toMatch(/one\("country", "not\.is\.null"\)/);
    expect(CODE).toMatch(/if \(applied\.country && typeof cov\.country === "number"\) out\.country = cov\.country;/);
    expect(JOBS).toMatch(/fc\.country/);
  });
});

describe("the arrow keys still scroll the page", () => {
  // The results page is 16,038px tall on desktop, 21,971px on mobile, and a
  // window-level keydown handler called preventDefault() on ArrowUp/ArrowDown
  // whenever nothing was focused — which is the state of every cold load,
  // because e.target is then <body> and neither guard covers it. Measured
  // live: dispatching ArrowDown on document.body returned defaultPrevented
  // true, while PageDown/Space/Home/End returned false.
  it("arrows only steer the list when focus is inside it", () => {
    expect(JOBS).toMatch(/const inList = typeof el\?\.closest === "function" && !!el\.closest\("\[data-job-id\]"\)/);
    expect(JOBS).toMatch(/if \(!isVim && \(e\.key === "ArrowDown" \|\| e\.key === "ArrowUp"\) && !inList\) return;/);
  });

  it("j and k stay global, because they scroll nothing natively", () => {
    expect(JOBS).toMatch(/const isDown = \(e\.key === "ArrowDown" && inList\) \|\| e\.key === "j";/);
    expect(JOBS).toMatch(/const isUp = \(e\.key === "ArrowUp" && inList\) \|\| e\.key === "k";/);
  });
});

describe("a count the page disproves is withdrawn, not published", () => {
  // Measured live 2026-08-24: q=camarero published total 3 above 60 delivered
  // rows, 57 titled "Camarero/a"; cocinero published 10 above 50. The counter
  // asks the FTS predicate while the retriever also runs a prefix scan, so a
  // title the parser welded into one lexeme ("camarero/a") is served but
  // never counted. The ROWS were right — this is arithmetic, not recall, and
  // an audit lane that read it as a 39x recall loss was refuted by the rows
  // themselves.
  it("suppresses the total when the page already holds more than it claims", () => {
    expect(CODE).toMatch(/const totalUnderstated = !augmented && typeof total === "number" && \(offset \+ shownRowCount\) > total;/);
    expect(CODE).toMatch(/total: augmented \|\| totalUnderstated \? null : total,/);
  });

  it("publishes a provable floor in its place", () => {
    expect(CODE).toMatch(/totalUnderstated \? \{ countUnavailable: true, totalAtLeast: offset \+ shownRowCount \}/);
  });
});

describe("a client-side filter must not quote a server count", () => {
  // "Actively hiring" filters the rows already fetched, while every total on
  // the summary line came from the unfiltered query — the audit measured 7
  // rows under a 10,000 headline. The page now states only what it shows.
  //
  // The label was wrong too. The lifecycle log observes a posting
  // DISAPPEARING, which may be a fill, a cancelled req or a paused budget —
  // and measured 2026-08-24 across the top 150 employers, of the 31 that
  // qualify the median carries 60% superseded (reposted) closure activity and
  // 68% are majority churn, with a median tracking window of 40 days rather
  // than the 90 the field name implies. "Proven fill record" was not a claim
  // this data can support.
  const JOBS_SRC = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
  const EXPLORE = readFileSync(resolve(ROOT, "src/pages/Explore.tsx"), "utf8");
  // Comment-stripped: the code comments EXPLAIN why the old wording was wrong
  // and therefore quote it. A negative assertion that reads its own
  // justification fails — the ninth time this repo has hit that trap.
  const jobsCode = stripTs(JOBS_SRC);
  const exploreCode = stripTs(EXPLORE);

  it("the summary withdraws server totals while the client filter is on", () => {
    expect(jobsCode).toMatch(/\{activelyHiringOnly\s*\n?\s*\?\s*t\("jobsPage\.resultsSummaryNoTotal"/);
  });

  it("no surface claims a fill the lifecycle log cannot observe", () => {
    expect(exploreCode).not.toMatch(/proven fill record/i);
    expect(jobsCode).not.toMatch(/roles they've actually filled/i);
  });
});

describe("a count must not cost more than the rows it labels", () => {
  // Measured 2026-08-25 with per-RPC timings on the live board:
  //   q=nurse     count_jobs_capped 817-870ms | search_jobs ~310ms
  //   q=camarero  count_jobs_capped 2,336ms   | search_jobs   171ms
  // The count is the dominant phase of a text search and already runs in
  // parallel with the page fetch, so it is the critical path, not a
  // sequencing problem. On camarero the board waited 2.3s for a number it
  // then WITHDREW as untrustworthy.
  it("the count deadline is tightened to the measured normal range", () => {
    expect(CODE).toMatch(/const COUNT_DEADLINE_MS = 1_500;/);
  });

  it("rows are never gated on the count", () => {
    // Promise.all, not await-then-await: a slow count must never delay rows.
    expect(CODE).toMatch(/const \[firstPage, cappedRes\] = await Promise\.all\(\[/);
    // The count is raced explicitly now rather than through withDeadline, so a
    // TIMEOUT is distinguishable from a missing RPC — conflating them made a
    // lost race fall back to the unbounded inline count and cost 5.4s instead
    // of 0.4s. The property this guard protects is unchanged: rows and count
    // are issued together, and the count can never delay the rows.
    expect(CODE).toMatch(/const racedCount: Promise<\{ n: number; capped\?: boolean \} \| null> = wantCount/);
    expect(CODE).toMatch(/racedCount,\n\s*\]\);/);
  });
});

describe("the facet budget must actually bound the facets", () => {
  // Measured 2026-08-25: the per-category counts are the single largest cost
  // of a text search — 2,238-2,489ms across 18 categories for q=camarero,
  // against 156-291ms for search_jobs. Three chunks of six finish in ~2.4s,
  // inside the old 6s budget, so the deadline never fired and every text
  // search paid in full to number the category rail.
  //
  // Lowering the facet CAP was the other option and was rejected: a guard
  // requires facet and list to share COUNT_CAP so the sidebar cannot
  // contradict the page. Bounding the time respects that invariant; changing
  // the cap would have broken it for a few hundred milliseconds.
  it("a text query gets a budget the loop can actually hit", () => {
    expect(CODE).toMatch(/const FACET_DEADLINE = Date\.now\(\) \+ \(qText \? 1_500 : 4_000\);/);
  });

  it("the loop still checks the budget between chunks", () => {
    expect(CODE).toMatch(/if \(Date\.now\(\) > FACET_DEADLINE\) break;/);
  });

  it("facet and list still share one ceiling", () => {
    expect(CODE).not.toMatch(/FACET_COUNT_CAP/);
    expect(CODE).toMatch(/const COUNT_CAP = 10_000;/);
  });
});

describe("the facet chunk races its budget, not the gap between chunks", () => {
  // Checking the deadline BETWEEN chunks never bounded anything: the first
  // chunk of six always runs in full. Measured 2026-08-25 after tightening
  // the between-chunk budget to 1.5s, q=camarero still spent 2,257-2,314ms in
  // count_jobs_capped and still took 5.7s end to end, because six concurrent
  // counts are issued before the deadline is consulted again.
  it("the chunk itself is raced", () => {
    expect(CODE).toMatch(/const chunkBudget = Math\.max\(250, FACET_DEADLINE - Date\.now\(\)\);/);
    expect(CODE).toMatch(/const raced = await withDeadline\(chunkWork, chunkBudget\);/);
  });

  it("a missed budget yields no numbers, never a crash", () => {
    // withDeadline resolves { data: null } on a miss — the shape its other
    // callers destructure — so this must test for the array, not for null.
    expect(CODE).toMatch(/const settled = Array\.isArray\(raced\) \? raced : \[\];/);
  });
});

describe("a slow search must say WHERE it was slow", () => {
  // Measured on the live board 2026-08-25, five runs of q=camarero: 9.0s,
  // 9.5s, 14.1s, 14.2s, 18.8s wall, tookMs 8393-13549. The published phase
  // record summed to ~1.8-2.1s, so 6.5-11.5s of every one of those requests
  // was invisible. q=nurse, by contrast, accounted for ~80% of its 1.4s.
  //
  // The gap was structural, not accidental: `phase` was only ever stamped
  // around RPC calls. Seven deadline-bounded PostgREST queries — the
  // salary-sorted route, the routed retriever, the related count, and the
  // four rescue tiers — carried no mark at all, so a request that spent ten
  // seconds in them reported spending two.
  //
  // Two fixes were attempted against guesses about which query it was, and
  // both were wrong. This pins the instrument rather than a hypothesis: every
  // deadline-bounded query on the search path reports its own time, so the
  // NEXT measurement names the culprit instead of nominating one.
  it("every deadline-bounded query on the search path is marked", () => {
    for (const name of [
      "salary_sorted", "routed_retriever", "related_count",
      "simple_config", "semantic", "semantic_filtered", "head_ring",
    ]) {
      // The start variable is not always `t_<name>`: head_ring is now ISSUED
      // before search_jobs and awaited later, so it measures from
      // t_head_ring_started. What matters is that the mark is anchored to a
      // timestamp taken when the query was issued — not that the two share a
      // spelling.
      expect(CODE, `${name} runs under a deadline but reports no time`)
        .toMatch(new RegExp(`markFrom\\("${name}", (t_${name}|t_${name}_started)\\);`));
    }
  });

  it("a mark measures the query, not the whole handler", () => {
    // t0 read immediately before the await, not once at the top: a shared
    // start time would charge each tier for everything that preceded it.
    for (const name of ["salary_sorted", "head_ring", "semantic"]) {
      expect(CODE).toMatch(new RegExp(`const t_${name}(_started)? = Date\\.now\\(\\);`));
    }
  });
});

describe("a phase mark must measure what the request waited on", () => {
  // withDeadline is a Promise.race and does NOT cancel the losing promise. The
  // count RPC's mark lived INSIDE cappedCount(), while the raced call site
  // stops waiting at COUNT_DEADLINE_MS = 1_500. So the abandoned RPC kept
  // running and stamped its full settle time — up to 8,237ms observed — under
  // the same phase name, against a request that waited 1.5s for it.
  //
  // Everything computed from that number was wrong in both directions: the
  // count looked like the dominant cost when it was off the critical path, and
  // "tookMs minus the phase sum" UNDERSTATED the genuinely unmarked time,
  // because the marked side was inflated. Two latency fixes were aimed at this
  // phantom before the instrument itself was checked.
  it("the raced count marks the race, not the RPC", () => {
    expect(CODE).toMatch(/const t_count_raced = Date\.now\(\);/);
    expect(CODE).toMatch(/markFrom\("count_jobs_capped", t_count_raced\);/);
  });

  it("the settle time is kept, under a name that says so", () => {
    // Worth having — it is how you see an RPC that is slow but deadlined —
    // but it must never be summed with critical-path phases.
    expect(CODE).toMatch(/markFrom\("count_jobs_capped_settle", t_count_jobs_capped_6\);/);
    expect(CODE).toMatch(/markFrom\("count_jobs_capped_settle", t_count_jobs_capped_5\);/);
  });

  it("the unraced call site still measures its own wait", () => {
    // cappedCount() is also awaited directly, where settle time IS wait time.
    expect(CODE).toMatch(/const t_count_direct = Date\.now\(\);/);
    expect(CODE).toMatch(/markFrom\("count_jobs_capped", t_count_direct\);/);
  });

  it("no phase name is stamped both inside and outside the same race", () => {
    // markFrom ACCUMULATES (phase[name] = (phase[name] ?? 0) + delta), so a
    // name marked on both sides of a race double-counts silently.
    const inner = (CODE.match(/markFrom\("count_jobs_capped",/g) ?? []).length;
    expect(inner, "count_jobs_capped must be stamped once per call site, never nested").toBe(2);
  });
});
