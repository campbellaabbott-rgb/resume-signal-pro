/**
 * THE HEARTBEAT SAYS WHEN THE LAYOFF READ IS STALE, AND WHEN IT CANNOT LOOK.
 *
 * Every layoff line on a card prints two dates: the filing's own and OUR
 * read. The second one is honest only while the poller and the two SQL crons
 * keep running; a dead poller leaves every card printing "read 3 days ago"
 * and nothing goes red. The scan-heartbeat check `layoff_feeds` is the thing
 * that goes red -- and, like every check in that endpoint, it must SKIP WITH
 * A REASON when it cannot look (tables not migrated, tables empty, a read
 * past its deadline) rather than pass or vanish.
 *
 * The check's judgement is a pure function, evaluateLayoffFeeds(input, now),
 * so it is TRANSPILED AND EXECUTED here on fixtures: an empty table, a dead
 * EDGAR read, a dead nightly read, a full-text audit that found what the Atom
 * feed missed, a future-dated row, an SEC row without its section, an 8-K/A
 * that names nothing, a partition with one arm missing, a sufficient arm at
 * S(30)=1.0 (a windowed board published as a share), a sufficient filed arm
 * on three employers. Each must fail with its reason named; the healthy
 * fixture must pass; the empty fixture must skip.
 *
 * The call site is pinned on comment-stripped code: it reads the TABLES
 * through the service client, every failure path records a skip under the
 * check's name, and the rate limiter is never touched.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const PATH = resolve(__dirname, "../../supabase/functions/scan-heartbeat/index.ts");
const RAW = readFileSync(PATH, "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*/gm, " ");

/** The evaluator and its constants, lifted from the shipped file and executed. */
const shipped = (() => {
  const pick = (re: RegExp, what: string) => {
    const m = RAW.match(re);
    if (!m) throw new Error(`${what} not found in scan-heartbeat/index.ts -- RE-ANCHOR this guard`);
    return m[0];
  };
  const src = [
    pick(/const LAYOFF_STALE_HOURS = [^\n]*\n/, "LAYOFF_STALE_HOURS"),
    pick(/const LAYOFF_MIN_ARM_EMPLOYERS = [^\n]*\n/, "LAYOFF_MIN_ARM_EMPLOYERS"),
    pick(/const LAYOFF_LIVE_KINDS: Record<string, number> = \{[\s\S]*?\n\};\n/, "LAYOFF_LIVE_KINDS"),
    pick(/const LAYOFF_S30_PLAUSIBLE[^\n]*\n/, "LAYOFF_S30_PLAUSIBLE"),
    pick(/interface LayoffReadRow [^\n]*\n/, "LayoffReadRow"),
    pick(/interface LayoffPartitionRow [^\n]*\n/, "LayoffPartitionRow"),
    pick(/interface LayoffFeedInput \{[\s\S]*?\n\}\n/, "LayoffFeedInput"),
    pick(/interface LayoffFeedVerdict [^\n]*\n/, "LayoffFeedVerdict"),
    pick(/function evaluateLayoffFeeds\([\s\S]*?\n\}\n/, "evaluateLayoffFeeds"),
    "return { evaluateLayoffFeeds, LAYOFF_STALE_HOURS, LAYOFF_LIVE_KINDS, LAYOFF_MIN_ARM_EMPLOYERS, LAYOFF_S30_PLAUSIBLE };",
  ].join("\n");
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(js)() as {
    evaluateLayoffFeeds: (input: Input, nowMs: number) => { skip?: string; passed: boolean; error?: string; summary: string };
    LAYOFF_STALE_HOURS: { edgar: number; warn: number };
    LAYOFF_LIVE_KINDS: Record<string, number>;
    LAYOFF_MIN_ARM_EMPLOYERS: number;
    LAYOFF_S30_PLAUSIBLE: [number, number];
  };
})();

type ReadRow = { kind: string; read_at: string; ok: boolean; new_rows: number | null };
type PartRow = { arm: string; sufficient_30: boolean | null; still_open_30: number | null; employers_n: number | null; computed_at: string | null };
type Input = { readLog: ReadRow[]; filingsTotal: number; futureDated: number; secWithoutSection: number; amendmentsUnresolved: number; partition: PartRow[] };

const NOW = Date.parse("2026-09-18T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const ok = (kind: string, h: number, new_rows: number | null = 0): ReadRow => ({ kind, read_at: hoursAgo(h), ok: true, new_rows });
const bad = (kind: string, h: number): ReadRow => ({ kind, read_at: hoursAgo(h), ok: false, new_rows: null });

/** A board an hour after a good night: every kind fresh, nothing implausible, both arms insufficient (today's state). */
const healthy = (): Input => ({
  readLog: [ok("edgar_atom", 0.7), ok("edgar_atom", 1.7), ok("edgar_fts_audit", 5.3, 0), ok("warn", 8.3), ok("mirror", 7.0), ok("matcher", 6.8), ok("partition", 6.8)],
  filingsTotal: 312,
  futureDated: 0,
  secWithoutSection: 0,
  amendmentsUnresolved: 0,
  partition: [
    { arm: "filed", sufficient_30: false, still_open_30: 0.51, employers_n: 6, computed_at: hoursAgo(6.8) },
    { arm: "control", sufficient_30: true, still_open_30: 0.70, employers_n: 4100, computed_at: hoursAgo(6.8) },
  ],
});

describe("evaluateLayoffFeeds, executed", () => {
  it("the bounds it uses are the config's and the kinds it requires are the six that recur", () => {
    expect(shipped.LAYOFF_STALE_HOURS).toEqual({ edgar: 6, warn: 48 });
    expect(shipped.LAYOFF_MIN_ARM_EMPLOYERS).toBe(10);
    expect(shipped.LAYOFF_S30_PLAUSIBLE).toEqual([0.02, 0.98]);
    expect(Object.keys(shipped.LAYOFF_LIVE_KINDS).sort()).toEqual(["edgar_atom", "edgar_fts_audit", "matcher", "mirror", "partition", "warn"]);
    expect(shipped.LAYOFF_LIVE_KINDS.edgar_atom).toBe(6);
    for (const k of ["edgar_fts_audit", "warn", "matcher", "partition", "mirror"]) expect(shipped.LAYOFF_LIVE_KINDS[k]).toBe(48);
    // The one-time backfill is not a kind that must recur.
    expect(shipped.LAYOFF_LIVE_KINDS).not.toHaveProperty("edgar_backfill");
  });

  it("a healthy board passes and the summary names every kind's age", () => {
    const v = shipped.evaluateLayoffFeeds(healthy(), NOW);
    expect(v.skip).toBeUndefined();
    expect(v.passed).toBe(true);
    expect(v.error).toBeUndefined();
    expect(v.summary).toMatch(/filings=312/);
    for (const k of Object.keys(shipped.LAYOFF_LIVE_KINDS)) expect(v.summary).toMatch(new RegExp(`${k}=\\d+\\.\\dh`));
  });

  it("THE SKIP PATH: empty tables skip with the reason, never pass, never fail", () => {
    const v = shipped.evaluateLayoffFeeds({ readLog: [], filingsTotal: 0, futureDated: 0, secWithoutSection: 0, amendmentsUnresolved: 0, partition: [] }, NOW);
    expect(v.skip).toMatch(/empty/);
    expect(v.skip).toMatch(/poller has never run/);
    expect(v.error).toBeUndefined();
  });

  it("but a read log with rows and no filings is NOT the skip path -- it is a poller that runs and stores nothing, judged on liveness", () => {
    const v = shipped.evaluateLayoffFeeds({ ...healthy(), filingsTotal: 0 }, NOW);
    expect(v.skip).toBeUndefined();
    expect(v.passed).toBe(true);
    const dead = shipped.evaluateLayoffFeeds({ ...healthy(), filingsTotal: 0, readLog: [ok("matcher", 1), ok("partition", 1)] }, NOW);
    expect(dead.passed).toBe(false);
    expect(dead.error).toMatch(/edgar_atom: no ok run recorded/);
    expect(dead.error).toMatch(/warn: no ok run recorded/);
  });

  it("an EDGAR read older than its bound degrades, and the bound is the edgar one (6 h), not the nightly one", () => {
    const at = healthy();
    at.readLog = at.readLog.filter((r) => r.kind !== "edgar_atom").concat([ok("edgar_atom", 6.5), bad("edgar_atom", 0.5)]);
    const v = shipped.evaluateLayoffFeeds(at, NOW);
    expect(v.passed).toBe(false);
    expect(v.error).toMatch(/edgar_atom: last ok run 6\.5h ago \(bound 6h\)/);
    // 5.5 h old is inside the bound: a failed attempt since does not, by itself, degrade.
    at.readLog = at.readLog.filter((r) => r.kind !== "edgar_atom").concat([ok("edgar_atom", 5.5), bad("edgar_atom", 0.5)]);
    expect(shipped.evaluateLayoffFeeds(at, NOW).passed).toBe(true);
  });

  it("a failed run never counts as liveness: only ok=true rows do", () => {
    const at = healthy();
    at.readLog = at.readLog.filter((r) => r.kind !== "warn").concat([bad("warn", 8), bad("warn", 32), ok("warn", 49)]);
    const v = shipped.evaluateLayoffFeeds(at, NOW);
    expect(v.passed).toBe(false);
    expect(v.error).toMatch(/warn: last ok run 49\.0h ago \(bound 48h\)/);
  });

  it("each SQL kind is required too: a matcher or partition writer that stopped is named", () => {
    for (const kind of ["matcher", "partition", "edgar_fts_audit"]) {
      const at = healthy();
      at.readLog = at.readLog.filter((r) => r.kind !== kind);
      const v = shipped.evaluateLayoffFeeds(at, NOW);
      expect(v.passed, kind).toBe(false);
      expect(v.error).toMatch(new RegExp(`${kind}: no ok run recorded`));
    }
  });

  it("the board-name mirror is a live kind: a mirror that fails every night (stale names, never empty) degrades on the daily bound", () => {
    // The mirror runs at 05:00 UTC by cron and prunes only on success, so a
    // failing run leaves yesterday's names in place; nothing but this
    // liveness read tells. Its bound is the daily one (48 h), like the matcher's.
    const at = healthy();
    at.readLog = at.readLog.filter((r) => r.kind !== "mirror").concat([bad("mirror", 7), bad("mirror", 31), ok("mirror", 49)]);
    const v = shipped.evaluateLayoffFeeds(at, NOW);
    expect(v.passed).toBe(false);
    expect(v.error).toMatch(/mirror: last ok run 49\.0h ago \(bound 48h\)/);
    // A run inside the bound with a failed attempt since is not yet stale.
    at.readLog = at.readLog.filter((r) => r.kind !== "mirror").concat([bad("mirror", 7), ok("mirror", 31)]);
    expect(shipped.evaluateLayoffFeeds(at, NOW).passed).toBe(true);
    // The kind the heartbeat watches is the kind the poller writes.
    const poller = readFileSync(resolve(__dirname, "../../supabase/functions/layoff-filings/index.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*/gm, " ");
    expect(poller).toMatch(/readLog\(client, "mirror", \{/);
    for (const kind of ["mirror"]) {
      const at = healthy();
      at.readLog = at.readLog.filter((r) => r.kind !== kind);
      const v = shipped.evaluateLayoffFeeds(at, NOW);
      expect(v.passed, kind).toBe(false);
      expect(v.error).toMatch(new RegExp(`${kind}: no ok run recorded`));
    }
  });

  it("completeness: the newest full-text audit that found accessions the Atom feed missed alerts; one that found none does not", () => {
    const at = healthy();
    at.readLog = at.readLog.filter((r) => r.kind !== "edgar_fts_audit").concat([ok("edgar_fts_audit", 5, 2), ok("edgar_fts_audit", 29, 0)]);
    const v = shipped.evaluateLayoffFeeds(at, NOW);
    expect(v.passed).toBe(false);
    expect(v.error).toMatch(/audit found 2 Item 2\.05 accession\(s\) the Atom feed missed/);
    // Yesterday's miss, cleared by today's clean audit, is history.
    at.readLog = at.readLog.filter((r) => r.kind !== "edgar_fts_audit").concat([ok("edgar_fts_audit", 5, 0), ok("edgar_fts_audit", 29, 2)]);
    expect(shipped.evaluateLayoffFeeds(at, NOW).passed).toBe(true);
  });

  it("plausibility: a future-dated row, a sectionless SEC row, a nameless 8-K/A -- each named", () => {
    expect(shipped.evaluateLayoffFeeds({ ...healthy(), futureDated: 1 }, NOW).error).toMatch(/1 filing\(s\) dated after today/);
    expect(shipped.evaluateLayoffFeeds({ ...healthy(), secWithoutSection: 3 }, NOW).error).toMatch(/3 SEC row\(s\) without their Item 2\.05 section/);
    expect(shipped.evaluateLayoffFeeds({ ...healthy(), amendmentsUnresolved: 2 }, NOW).error).toMatch(/2 8-K\/A row\(s\) name no original/);
  });

  it("plausibility: both partition arms must exist", () => {
    const one = { ...healthy(), partition: healthy().partition.slice(0, 1) };
    const v = shipped.evaluateLayoffFeeds(one, NOW);
    expect(v.passed).toBe(false);
    expect(v.error).toMatch(/partition holds 1 arm\(s\); both filed and control must always be written/);
    expect(shipped.evaluateLayoffFeeds({ ...healthy(), partition: [] }, NOW).error).toMatch(/holds 0 arm/);
  });

  it("plausibility: a SUFFICIENT arm at S(30)=1.0 is a windowed board published as a share; an insufficient arm at 1.0 is just unread", () => {
    const at = healthy();
    at.partition[1] = { ...at.partition[1], still_open_30: 1.0 };
    const v = shipped.evaluateLayoffFeeds(at, NOW);
    expect(v.passed).toBe(false);
    expect(v.error).toMatch(/control arm is sufficient with S\(30\)=1 outside \[0\.02, 0\.98\]/);
    at.partition[1] = { ...at.partition[1], still_open_30: 0.01 };
    expect(shipped.evaluateLayoffFeeds(at, NOW).error).toMatch(/S\(30\)=0\.01 outside/);
    // Not sufficient: the section prints its reason, the number is not published, nothing to alert on.
    at.partition[1] = { ...at.partition[1], sufficient_30: false, still_open_30: 1.0 };
    expect(shipped.evaluateLayoffFeeds(at, NOW).passed).toBe(true);
  });

  it("plausibility: a sufficient filed arm below the employer floor is an instrument fault, named with the floor", () => {
    const at = healthy();
    at.partition[0] = { arm: "filed", sufficient_30: true, still_open_30: 0.5, employers_n: 3, computed_at: hoursAgo(6.8) };
    const v = shipped.evaluateLayoffFeeds(at, NOW);
    expect(v.passed).toBe(false);
    expect(v.error).toMatch(/filed arm is sufficient on 3 employer\(s\); the floor is 10/);
    at.partition[0] = { ...at.partition[0], employers_n: 10 };
    expect(shipped.evaluateLayoffFeeds(at, NOW).passed).toBe(true);
    at.partition[0] = { ...at.partition[0], employers_n: null };
    expect(shipped.evaluateLayoffFeeds(at, NOW).error).toMatch(/on no employer\(s\)/);
  });

  it("several faults are all named in one error, none swallowed", () => {
    const at = healthy();
    at.readLog = at.readLog.filter((r) => r.kind !== "warn");
    at.futureDated = 1;
    at.partition = at.partition.slice(1);
    const v = shipped.evaluateLayoffFeeds(at, NOW);
    expect(v.error).toMatch(/warn: no ok run recorded/);
    expect(v.error).toMatch(/dated after today/);
    expect(v.error).toMatch(/holds 1 arm/);
  });
});

describe("the call site, on comment-stripped code", () => {
  it("reads the tables through the service client, never the function's log lines", () => {
    expect(CODE).toMatch(/supabase\.from\('layoff_read_log'\)\.select\('kind, read_at, ok, new_rows'\)/);
    expect(CODE).toMatch(/supabase\.from\('layoff_filings'\)\.select\('filing_id', \{ count: 'exact', head: true \}\)\.gt\('event_date', todayIso\)/);
    expect(CODE).toMatch(/\.eq\('source', 'sec_8k_205'\)\.is\('section_text', null\)/);
    expect(CODE).toMatch(/\.eq\('form', '8-K\/A'\)\.is\('amends_adsh', null\)\.eq\('amend_unresolved', false\)/);
    expect(CODE).toMatch(/supabase\.from\('job_board_layoff_partition'\)\.select\('arm, sufficient_30, still_open_30, employers_n, computed_at'\)/);
    expect(CODE).not.toMatch(/\[layoff-filings\]/);
  });

  it("every path that cannot look records a skip under the check's name; the verdict's own skip is honoured", () => {
    expect(CODE).toMatch(/skip\('layoff_feeds', why\)/);
    expect(CODE).toMatch(/skip\('layoff_feeds', verdict\.skip\)/);
    expect(CODE).toMatch(/skip\('layoff_feeds', e instanceof Error \? e\.message : 'layoff tables unreadable'\)/);
    expect(CODE).toMatch(/exceeded its \$\{LAYOFF_MS\}ms deadline/);
    expect(CODE).toMatch(/layoff tables unreadable: \$\{/);
  });

  it("a failing verdict degrades the run and is pushed under the check's name; a passing one is pushed too", () => {
    expect(CODE).toMatch(/checks\.push\(\{ name: 'layoff_feeds', passed: verdict\.passed, responseTimeMs: 0, error: verdict\.error \}\)/);
    const site = CODE.slice(CODE.indexOf("checks.push({ name: 'layoff_feeds'"));
    expect(site.slice(0, 400)).toMatch(/if \(!verdict\.passed\) \{\s*if \(overallStatus === 'healthy'\) overallStatus = 'degraded';/);
  });

  it("the read window covers the widest bound, and the rate limiter is never touched by this check", () => {
    expect(CODE).toMatch(/2 \* LAYOFF_STALE_HOURS\.warn \* 3_600_000/);
    const start = CODE.indexOf("const LAYOFF_MS = 6_000");
    const end = CODE.indexOf("const vendorStart = Date.now()");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = CODE.slice(start, end);
    expect(block.length).toBeGreaterThan(500);
    expect(block).not.toMatch(/check_rate_limit|check_global_rate_limit|rate_limits/);
  });

  it("the version marker moved with the check, so a stale deploy is tellable from the payload", () => {
    expect(CODE).toMatch(/const BUILD_VERSION = "2026-09-21\.\d+"/);
  });
});

describe("the executed guard has teeth", () => {
  it("a copy whose skip path is removed passes on an empty table -- the property this file forbids", () => {
    const src = RAW.match(/function evaluateLayoffFeeds\([\s\S]*?\n\}\n/)![0]
      .replace(/if \(input\.readLog\.length === 0 && input\.filingsTotal === 0\) \{[\s\S]*?\n  \}\n/, "");
    expect(src).not.toMatch(/poller has never run/);
    const js = ts.transpileModule(
      `const LAYOFF_STALE_HOURS = { edgar: 6, warn: 48 }; const LAYOFF_MIN_ARM_EMPLOYERS = 10; const LAYOFF_S30_PLAUSIBLE = [0.02, 0.98];
       const LAYOFF_LIVE_KINDS = { edgar_atom: 6, edgar_fts_audit: 48, warn: 48, matcher: 48, partition: 48 };
       ${src} return evaluateLayoffFeeds;`,
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
    ).outputText;
    const mutant = new Function(js)() as typeof shipped.evaluateLayoffFeeds;
    const v = mutant({ readLog: [], filingsTotal: 0, futureDated: 0, secWithoutSection: 0, amendmentsUnresolved: 0, partition: [] }, NOW);
    // Without the skip path an empty table reads as five dead feeds -- a page
    // about nothing. The shipped function skips instead.
    expect(v.skip).toBeUndefined();
    expect(v.passed).toBe(false);
  });

  it("a copy that counts failed runs as liveness passes a dead nightly read", () => {
    const src = RAW.match(/function evaluateLayoffFeeds\([\s\S]*?\n\}\n/)![0].replace("if (r.ok !== true) continue;\n    const t = Date.parse(r.read_at);", "const t = Date.parse(r.read_at);");
    expect(src).not.toBe(RAW.match(/function evaluateLayoffFeeds\([\s\S]*?\n\}\n/)![0]);
    const js = ts.transpileModule(
      `const LAYOFF_STALE_HOURS = { edgar: 6, warn: 48 }; const LAYOFF_MIN_ARM_EMPLOYERS = 10; const LAYOFF_S30_PLAUSIBLE = [0.02, 0.98];
       const LAYOFF_LIVE_KINDS = { edgar_atom: 6, edgar_fts_audit: 48, warn: 48, matcher: 48, partition: 48 };
       ${src} return evaluateLayoffFeeds;`,
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
    ).outputText;
    const mutant = new Function(js)() as typeof shipped.evaluateLayoffFeeds;
    const at = healthy();
    at.readLog = at.readLog.filter((r) => r.kind !== "warn").concat([bad("warn", 8), ok("warn", 49)]);
    expect(mutant(at, NOW).passed).toBe(true);
    expect(shipped.evaluateLayoffFeeds(at, NOW).passed).toBe(false);
  });
});
