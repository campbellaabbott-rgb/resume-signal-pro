import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A DATA PAGE THAT SERVES NO NUMBER IS AN EMPTY PAGE.
 *
 * WHAT HAPPENED. /ghost-job-index, /pay-transparency, /hiring-trends and
 * /entry-level-index are four pages whose entire purpose is to publish
 * measurements, and to every reader that does not run JavaScript they
 * published none. Measured 2026-09-22 and reproduced 2026-09-23 with a
 * Googlebot UA: 1,334 / 1,073 / 1,035 / 1,219 characters of body text and
 * between zero and five digits, every one of those digits sitting in prose
 * ("30 days", "0-2 year roles"). Byte-identical across user agents, so this
 * was not cloaking or a crawler quirk: the figures only ever existed in a
 * client-side fetch. All four are in sitemap.xml and all four are named in
 * llms.txt as the public slice of the dataset, so the documents an AI engine
 * or a non-rendering crawler actually read argued that job numbers should be
 * sourced and then sourced nothing. The machinery was already there --
 * /explore has prerendered its real facet counts, with a date basis, since
 * 2026-09-10.
 *
 * THE PROPERTY, and it is about OUTPUT, not about source text. Given a
 * payload the board really returns, the builder in scripts/prerender-seo.mjs
 * must emit, for each of the four pages, HTML containing real figures -- and
 * each figure group must carry the sentence project_stat_provenance requires:
 * what it counts, when it was measured, how often it is recomputed. Given no
 * payload, it must emit NO digits at all and say it could not read them,
 * because "no count beats a stale count" and an invented one is worse than
 * both.
 *
 * WHY IT RUNS THE CODE RATHER THAN READING IT. Every prerender guard in this
 * repo before a-const-read-before-its-line read the script as TEXT, and text
 * cannot tell you whether a page renders a number -- which is exactly how
 * four pages stayed number-free under a green build for months. So the
 * builder is written self-contained between two markers, this test slices
 * that source out of the shipped file and evaluates it, and the assertions
 * are made against what it returns. If the builder ever reaches into the
 * surrounding closure the slice stops evaluating and this fails loudly; that
 * is the intended failure, not a reason to loosen the guard.
 *
 * TEETH. Three ways, below: the checker is shown reporting a figure-free page
 * (the pre-fix state, rebuilt); a basis sentence with its date stripped is
 * shown failing the provenance check; and the published refresh cadence is
 * held against the cron expression in the migration that schedules the job,
 * so re-timing a job fails here instead of quietly making four public
 * sentences wrong.
 */

const ROOT = resolve(__dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/prerender-seo.mjs");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");

/**
 * The prerender script with its comments removed, for every assertion below
 * that pins a SPELLING rather than a behaviour. The block above each write()
 * explains what it fixed and quotes the sentences it replaced while doing so,
 * so a scanner reading raw text would report the fix as the defect.
 */
const CODE = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/[^\n]*/gm, " ");

const START = "// >>> DATA-PAGE FIGURE BUILDER START";
const END = "// <<< DATA-PAGE FIGURE BUILDER END";

type PageFigures = { html: string; desc: string | null; read: boolean };
type Built = Record<"ghost" | "entry" | "trends" | "pay", PageFigures>;

/** The shipped builder, sliced out of the shipped file and made callable. */
function loadBuilder(): {
  build: (p: unknown) => Built;
  cadence: Record<string, string>;
} {
  const src = readFileSync(SCRIPT, "utf8");
  const a = src.indexOf(START);
  const b = src.indexOf(END);
  expect(a, "the builder's start marker moved -- re-anchor this guard").toBeGreaterThan(-1);
  expect(b, "the builder's end marker moved -- re-anchor this guard").toBeGreaterThan(a);
  const slice = src.slice(a, b);
  // eslint-disable-next-line no-new-func
  const [build, cadence] = new Function(`${slice}; return [dataPageFigures, DATA_PAGE_CADENCE];`)();
  return { build, cadence };
}

/** Text as a reader with no JavaScript receives it. */
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const digits = (html: string) => (text(html).match(/[0-9]/g) ?? []).length;
/** A counted figure, not a year or a bullet number: 1,234 or 12.3% or 45%. */
const countedFigure = /\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?%/;

/**
 * A payload of the shape the board really returns, with the values it really
 * returned on 2026-09-23. Trimmed to the fields the pages consume; the
 * numbers are not asserted on, only their presence in the output is, so this
 * is a shape fixture and not a figure this repo has to keep up to date.
 */
const PAYLOAD = {
  stats: {
    computed_at: "2026-09-23T17:12:00.019780+00:00",
    stale_parts: [] as string[],
    ghost_stats: {
      total_open: 770989,
      total_companies: 32301,
      total_company_names: 31482,
      closed_90d: 1543884,
      observed_days: 71,
      median_days_open: 13.7,
      median_days_to_close: 12.5,
      posted_coverage_pct: 99.5,
      computed_at: "2026-09-23T17:05:00.019645+00:00",
    },
    entry_stats: {
      total_entry: 114091,
      total_open: 770898,
      companies_with_entry: 13869,
      remote_entry: 4451,
      by_category: { other: 23104, operations: 21306, healthcare: 20580, sales: 9882 },
    },
    entry_companies: [
      { company: "Republic Finance, LLC", company_token: "jobs.republicfinance.com", entry_roles: 219, open_roles: 219 },
      { company: "Agape Care Group", company_token: "agapecare", entry_roles: 115, open_roles: 128 },
    ],
    hiring_trends: [
      { week_start: "2026-08-24", new_postings: 258336, entry_new: 8928, remote_new: 6368, closed: 451212 },
      { week_start: "2026-08-31", new_postings: 253266, entry_new: 20452, remote_new: 7807, closed: 172263 },
      { week_start: "2026-09-07", new_postings: 303025, entry_new: 23170, remote_new: 8337, closed: 845110 },
      { week_start: "2026-09-14", new_postings: 345732, entry_new: 32030, remote_new: 10798, closed: 870536 },
      { week_start: "2026-09-21", new_postings: 144411, entry_new: 16998, remote_new: 6064, closed: 339137 },
    ],
    trending_categories: [
      { category: "other", last7: 45116, prior7: 38179 },
      { category: "operations", last7: 34859, prior7: 30838 },
    ],
  },
  transparency: {
    computed_at: "2026-09-23T16:37:00.020174+00:00",
    pay: {
      overall: { total: 899242, pay_pct: 28.5 },
      categories: [
        { category: "education", total: 11658, pay_pct: 42.0 },
        { category: "healthcare", total: 126542, pay_pct: 38.3 },
      ],
      top_companies: [
        { company: "CarMax", company_token: "carmax~wd1~External", total: 266, pay_pct: 100.0 },
      ],
    },
    coverage: {
      overall: { total: 899242, pay_n: 256068, pay_pct: 28.5, mode_n: 202645, mode_pct: 22.5 },
      by_source: [
        { source: "workday", total: 321212, pay_pct: 35.8, mode_pct: 22.9 },
        { source: "greenhouse", total: 59732, pay_pct: 45.4, mode_pct: 14.1 },
      ],
    },
  },
  freshness: {
    boards: 32303,
    p50_min: 173.4,
    p95_min: 387.3,
    max_min: 3609.4,
    computed_at: "2026-09-23T17:15:00.029989+00:00",
  },
};

/**
 * The published cadence sentence a cron expression implies.
 *
 * AT MODULE SCOPE, AND THAT IS THE POINT. It used to be written out twice --
 * once inside the check and once inside the teeth case that proves the check
 * bites -- so the teeth could keep passing over a copy the real assertion no
 * longer ran. One implementation, exercised by both.
 */
function phraseFor(expr: string): string {
  const minute = expr.trim().split(/\s+/)[0];
  const step = /^\*\/(\d+)$/.exec(minute);
  if (step) return `recomputed every ${step[1]} minutes`;
  const n = minute.split(",").length;
  return n === 1 ? "recomputed once an hour" : n === 2 ? "recomputed twice an hour" : `recomputed ${n} times an hour`;
}

const PAGES: Array<[keyof Built, string]> = [
  ["ghost", "/ghost-job-index"],
  ["entry", "/entry-level-index"],
  ["trends", "/hiring-trends"],
  ["pay", "/pay-transparency"],
];

/**
 * The check this guard is FOR, as a function, so the teeth cases below can
 * run it against a page that fails it.
 */
export function figureFaults(html: string): string[] {
  const faults: string[] = [];
  const t = text(html);
  if (!countedFigure.test(t)) faults.push("serves no counted figure");
  if (digits(html) < 10) faults.push(`serves only ${digits(html)} digits`);
  return faults;
}

/**
 * The provenance sentence, as a function: what it counts is prose and cannot
 * be checked mechanically, but the two halves that CAN be are the date basis
 * and the refresh cadence, and both were the missing halves in the incidents
 * this rule came from.
 */
export function basisFaults(html: string): string[] {
  const t = text(html);
  const faults: string[] = [];
  // Every figure group states a measurement moment...
  const measured = t.match(/Measured [^.]*\d{4}-\d{2}-\d{2}[^.]*UTC/g) ?? [];
  if (measured.length === 0) faults.push("no figure group names the moment it was measured");
  // ...and how often that moment moves.
  if (!/recomputed (once an hour|twice an hour|every \d+ minutes)/.test(t)) {
    faults.push("no figure group says how often it is recomputed");
  }
  return faults;
}

describe("a data page that serves no number is an empty page", () => {
  const { build } = loadBuilder();
  const built = build(PAYLOAD);

  it.each(PAGES)("%s (%s) serves real figures to a reader with no JavaScript", (key) => {
    const page = built[key];
    expect(page.read, `${key}: the builder read its payload but reported otherwise`).toBe(true);
    expect(figureFaults(page.html), `${key} still serves a page with no measurements in it`).toEqual([]);
  });

  it.each(PAGES)("%s (%s) states the basis of the figures it prints", (key) => {
    expect(basisFaults(built[key].html), `${key}: a published number with no date basis`).toEqual([]);
  });

  it.each(PAGES)("%s (%s) offers a meta description carrying a figure, within the SERP clamp", (key) => {
    const d = built[key].desc;
    expect(d, `${key}: no description built from the figures`).toBeTruthy();
    expect(countedFigure.test(d!), `${key}: the description states no figure`).toBe(true);
    // renderFile truncates past 160 and warns; a description that has to be
    // cut is a description written too long, not a clamp to lean on.
    expect(d!.length, `${key}: description ${d!.length} chars, over the SERP clamp`).toBeLessThanOrEqual(160);
  });

  it("every employer and field name reaching the page is escaped", () => {
    const hostile = JSON.parse(JSON.stringify(PAYLOAD));
    hostile.stats.entry_companies[0].company = '<script>alert("x")</script>';
    hostile.transparency.pay.top_companies[0].company = "Ben & Jerry's <b>";
    const out = build(hostile);
    expect(out.entry.html).not.toContain("<script>");
    expect(out.entry.html).toContain("&lt;script&gt;");
    expect(out.pay.html).toContain("Ben &amp; Jerry");
  });

  it("a build that could read nothing prints no figure at all, and says so", () => {
    const none = build({ stats: null, transparency: null, freshness: null });
    for (const [key] of PAGES) {
      expect(none[key].read, `${key} claimed a read it did not make`).toBe(false);
      expect(digits(none[key].html), `${key} invented ${digits(none[key].html)} digits from an unread payload`).toBe(0);
      expect(text(none[key].html)).toMatch(/could not read/i);
      expect(none[key].desc, `${key} must fall back to its written description`).toBeNull();
    }
  });

  it("a build that read one source and not the others publishes only what it measured", () => {
    // The partial case is the realistic failure: the transparency cache is a
    // different cron job from the stats cache and either can stall alone.
    const partial = build({ stats: PAYLOAD.stats, transparency: null, freshness: null });
    expect(partial.entry.read).toBe(true);
    expect(figureFaults(partial.entry.html)).toEqual([]);
    expect(partial.pay.read).toBe(false);
    expect(digits(partial.pay.html)).toBe(0);
    // Ghost has two sources; with freshness gone it still has the ghost row.
    expect(partial.ghost.read).toBe(true);
    expect(text(partial.ghost.html)).not.toMatch(/feeds in the rotation/);
  });

  it("a week the log cannot yet compare prints no change rather than a ratio", () => {
    // Weekly counts exclude postings that predate our tracking of a board, so
    // a partly-observed week has a structurally low count and a ratio against
    // it once read +19,000%. Two weeks of history is not enough to compare.
    const young = JSON.parse(JSON.stringify(PAYLOAD));
    young.stats.hiring_trends = [
      { week_start: "2026-09-14", new_postings: 12, entry_new: 1, remote_new: 1, closed: 3 },
      { week_start: "2026-09-21", new_postings: 144411, entry_new: 16998, remote_new: 6064, closed: 339137 },
    ];
    young.stats.trending_categories = [{ category: "other", last7: 45116, prior7: 19 }];
    const out = build(young);
    expect(text(out.trends.html)).not.toMatch(/against the week before/);
    // And a field whose prior window holds under twenty postings prints a dash.
    expect(text(out.trends.html)).toMatch(/45,116 —/);
  });
});

describe("a data page that serves no number is an empty page -- has teeth", () => {
  const { build, cadence } = loadBuilder();

  it("the checker reports the pre-fix page: prose, links and not one measurement", () => {
    // The /hiring-trends document as it shipped until this change, verbatim
    // apart from the markup, so the guard is shown catching the exact state
    // it exists to catch.
    const preFix = `
      <h1>Weekly Hiring Trends</h1>
      <p>Is hiring up or down this week? This page answers with counted postings, not vibes.</p>
      <p>Counts use each posting's own stated date from the company's official applicant-tracking feed.</p>
      <p><a href="/jobs">Browse the live board</a>.</p>`;
    expect(figureFaults(preFix)).toEqual(["serves no counted figure", "serves only 0 digits"]);
    expect(basisFaults(preFix)).toEqual([
      "no figure group names the moment it was measured",
      "no figure group says how often it is recomputed",
    ]);
  });

  it("the basis check reports a figure published with its date basis removed", () => {
    const built = build(PAYLOAD);
    const stripped = built.pay.html
      .replace(/Measured [^.]*UTC, /g, "")
      .replace(/recomputed (once an hour|twice an hour|every \d+ minutes)/g, "kept current");
    // Still full of numbers, and now sourceless -- which is the shape the
    // 2.8-day median shipped in.
    expect(figureFaults(stripped)).toEqual([]);
    expect(basisFaults(stripped)).toEqual([
      "no figure group names the moment it was measured",
      "no figure group says how often it is recomputed",
    ]);
  });

  it("the published refresh cadence matches the cron that actually does it", () => {
    // THE CLAIM AND THE SCHEDULE LIVE IN DIFFERENT RUNTIMES. "Recomputed once
    // an hour" is a statement about a pg_cron job in a migration; nothing but
    // this test connects the two, which is the exact shape of the "no
    // subscriptions" incident. The expected phrase is DERIVED from the cron
    // expression rather than restated, so re-timing a job fails here.
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    // Comment-stripped: migrations here explain their own schedules in prose,
    // and a scanner that read the prose would take the explanation for the
    // schedule. This repo has shipped that false positive seven times.
    const code = (sql: string) => sql.replace(/^\s*--[^\n]*$/gm, " ");

    expect(Object.keys(cadence).length, "no cadence claims to check").toBeGreaterThan(0);
    for (const [job, claim] of Object.entries(cadence)) {
      // The LAST migration that schedules this job name wins, exactly as
      // effective-definition-wins reasons about function bodies: a later file
      // re-schedules and the earlier one is history.
      let found: string | null = null;
      for (const f of files) {
        const sql = code(readFileSync(resolve(MIGRATIONS, f), "utf8"));
        const re = new RegExp(`cron\\.schedule\\(\\s*'${job}'\\s*,\\s*'([^']+)'`);
        const m = re.exec(sql);
        if (m) found = m[1];
      }
      expect(found, `no migration schedules ${job} -- the page claims a cadence for a job that is not there`).toBeTruthy();
      expect(phraseFor(found!), `${job} runs on "${found}" and the pages publish "${claim}"`).toBe(claim);
    }
  });

  it("the cadence check reports a job re-timed under an unchanged sentence", () => {
    // The one implementation above is what runs here, so this case cannot
    // drift away from the assertion it exists to prove.
    // The hourly cache moved to :07 and :37 and nobody touched the copy.
    expect(phraseFor("7,37 * * * *")).toBe("recomputed twice an hour");
    expect(phraseFor("7,37 * * * *")).not.toBe(cadence["refresh-stats-cache"]);
    // ...and the rollup slowed to half-hourly.
    expect(phraseFor("*/30 * * * *")).not.toBe(cadence["job-board-stats-rollup"]);
  });

  it("the four pages actually render what the builder returns", () => {
    // The builder can be perfect and unconsumed. Comment-stripped, because
    // the block above each write() explains what it fixed and names the
    // paths while doing so.
    const src = CODE;
    for (const [key, path] of PAGES) {
      const at = src.indexOf(`path: "${path}"`);
      expect(at, `${path} is no longer written by the prerender`).toBeGreaterThan(-1);
      const block = src.slice(at, at + 4000);
      expect(block, `${path} does not render DATA_FIGURES.${key}.html`).toContain(`\${DATA_FIGURES.${key}.html}`);
      expect(block, `${path} does not take its description from the figures`).toContain(`DATA_FIGURES.${key}.desc ??`);
    }
  });

  it("the builder is called with the three caches, not with an empty payload", () => {
    // THE ONE PATH BETWEEN A CORRECT BUILDER AND FOUR EMPTY PAGES. Every
    // assertion above hands `build` its own fixture, so `dataPageFigures({})`
    // at the call site would print "could not read" on all four pages with
    // this whole file green. The call is pinned by the three cache
    // identifiers it has to be handed, in comment-stripped code so the
    // paragraph explaining the call cannot satisfy it.
    const call = /const DATA_FIGURES = dataPageFigures\(([^)]*)\)/.exec(CODE);
    expect(call, "the single builder call moved -- re-anchor this guard").not.toBeNull();
    for (const cache of ["stats: statsCache", "transparency: transparencyCache", "freshness: freshnessRow"]) {
      expect(call![1], `the builder is no longer handed ${cache}`).toContain(cache);
    }
  });
});

/**
 * A SHELL'S PROSE MUST NOT STATE WHAT THE FIGURES UNDER IT REFUTE.
 *
 * Until this build the four data pages served prose and no numbers, so a
 * sentence in a shell stood alone and answered to nothing. Now the figure
 * block is written into the SAME DOCUMENT, with a basis line under every
 * group -- and two of the shells carried claims those basis lines deny in the
 * page's own words: /entry-level-index said it "ranks the companies that post
 * the most", the rule the ranking was moved off in 20260908134000, and
 * /hiring-trends promised "how many roles actually got filled" over a figure
 * the same document labels closure events and refuses to call a hire, plus
 * "entry-level and remote shares" over two counts it publishes as floors.
 * A meta description is what a SERP and an AI engine quote, so the refuted
 * sentence was the one most likely to be repeated.
 *
 * SCOPE. This guard reads the prerender script, which is the document a
 * non-JS reader and a crawler actually receive. The same three phrasings also
 * sit on src/pages/HiringTrends.tsx (the React meta description) and on
 * public/llms.txt line 46; both are outside this change's lane and are named
 * in its return value rather than silently excluded here.
 */
describe("a shell's prose does not state what the figures under it refute", () => {
  const REFUTED = [
    {
      claim: "a ranking by who posts the most",
      re: /rank\w*\s+the\s+(?:companies|employers|boards)\s+that\s+post\s+the\s+most/i,
      because: "the table is ordered by the SHARE of a board's open roles that are early-career, with the raw count only as the tie-break",
    },
    {
      claim: "postings described as filled",
      re: /roles?\s+(?:actually\s+)?(?:got|were|get)\s+filled/i,
      because: "a posting coming down is never called a hire; the figure is closure events and the page says so",
    },
    {
      claim: "the floors described as shares",
      re: /entry-level\s+and\s+remote\s+shares/i,
      because: "both are counted over a narrower population than the weekly total and are published as floors, never divided into it",
    },
  ];

  it("is not vacuous: the figure blocks really do deny these claims", () => {
    const { build } = loadBuilder();
    const built = build(PAYLOAD);
    const all = text(built.entry.html + built.trends.html + built.ghost.html);
    expect(all, "the entry table no longer states its ranking rule").toMatch(/not by who posts the most/i);
    expect(all, "the closure figure no longer refuses the word hire").toMatch(/never called a hire/i);
    expect(all, "the weekly counts no longer say they are floors").toMatch(/a FLOOR, not a share/);
  });

  it.each(REFUTED)("the served documents never state $claim", ({ re, because }) => {
    const hit = re.exec(CODE);
    expect(hit && hit[0], `the prerender states "${hit?.[0]}" while the figures beneath it say ${because}`).toBeFalsy();
  });

  it("teeth: the pre-fix sentences are each reported", () => {
    // Verbatim from the shells as they stood before this change.
    const preFix = [
      'openings whose own titles and requirements say early-career and ranks the companies that post the most of them.',
      'which fields are hiring, entry-level and remote shares, and how many roles actually got filled — no estimates, no surveys.',
    ].join("\n");
    const reported = REFUTED.filter((r) => r.re.test(preFix)).map((r) => r.claim);
    expect(reported).toEqual([
      "a ranking by who posts the most",
      "postings described as filled",
      "the floors described as shares",
    ]);
  });
});
