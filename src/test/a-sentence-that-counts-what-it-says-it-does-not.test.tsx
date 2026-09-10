// A SENTENCE THAT COUNTS WHAT IT SAYS IT DOES NOT.
//
// Three disclosures on the board, each emitted or computed correctly and each
// telling the reader something other than what it said.
//
// ── 1. THE WORK-MODE BANNER (trace, major; CONFIRMED LIVE) ───────────────────
//
// Under Remote the board said: "…Another 787,292 openings match everything
// else, but don't say remote, hybrid, or on-site". `hidden` was (count with the
// whole mode filter dropped) − (this page's total), which INCLUDES every posting
// stated hybrid or on-site — rows the reader excluded on purpose, presented as
// rows that never said. The sentence was right and the arithmetic under it was
// a different sentence.
//
// The fix keeps the wording and issues ONE extra countOnly probe while a mode
// filter is on: the same body with workMode set to every stated value at once.
// unstated = dropped − any-stated. Both halves must be exact (uncapped) or the
// difference is not published. The number changed meaning, so the key did too:
// discWorkMode2, and discWorkMode is retired from all nine locales.
//
// ── 2. EMPLOYMENT-TYPE COVERAGE NEVER RENDERED (trace, major) ───────────────
//
// coverageDisclosure has emitted filterCoverage.employmentType since the filter
// shipped. The client's BoardResponse type omitted the key and the renderer had
// no clause — so the one filter over the column employers leave blank most
// often published no coverage at all. The guard here is a PROPERTY: every key
// the server can emit (discovered from comment-stripped source) has a renderer
// clause and a type entry, so the twelfth key cannot go mute the way the
// eleventh did.
//
// ── 3. LEGACY remote=1 GOT NO COVERAGE SENTENCE (trace, minor) ───────────────
//
// `?remote=1` (old saved searches, digest links) binds remote=true, hides every
// work_mode-NULL row, shows a "Remote" chip — and coverageDisclosure emitted
// workMode only for applied.workMode. Same column, same silent narrowing, no
// sentence. The guard TRANSPILES coverageDisclosure out of index.ts and CALLS
// it: a pre-fix copy returns {} for {remote:true}.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}
import Jobs from "../pages/Jobs";

const ROOT = resolve(__dirname, "../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const FN_RAW = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const FN = strip(FN_RAW);
const JOBS = strip(readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8"));
const LOCALES = resolve(ROOT, "src/i18n/locales");
const LOCALE_FILES = readdirSync(LOCALES).filter((f) => f.endsWith(".json")).sort();
const jp = (f: string) => JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).jobsPage as Record<string, unknown>;
const SLOW = { timeout: 4000 } as const;

/** A top-level function's text, comment-stripped, from `function name(` to the
 *  first line that is exactly `}`. */
function fnText(name: string): string {
  const i = FN.indexOf(`function ${name}(`);
  expect(i, `${name} is gone`).toBeGreaterThan(0);
  const j = FN.indexOf("\n}", i);
  return FN.slice(i, j + 2);
}

/** coverageDisclosure and the constant it reads, transpiled and CALLED — a
 *  walk, not a spelling. */
function loadCoverageDisclosure(): (applied: Record<string, unknown>, meta: unknown) => Record<string, unknown> {
  const c = FN.indexOf("const MEASURED_COVERAGE = {");
  expect(c, "MEASURED_COVERAGE is gone").toBeGreaterThan(0);
  const constText = FN.slice(c, FN.indexOf("} as const;", c) + "} as const;".length);
  const src = `${constText}\n${fnText("coverageDisclosure")}\nreturn coverageDisclosure;`;
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  return new Function(js)() as (applied: Record<string, unknown>, meta: unknown) => Record<string, unknown>;
}

// ── THE FIXTURE FOR THE BANNER ───────────────────────────────────────────────

const ROWS = [{
  id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme",
  title: "Staff Engineer", location: "Cambridge", country: "GB",
  salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: "remote", employmentType: null, experienceBand: null, minYears: null,
  category: "engineering", department: null, remote: true,
  postedAt: new Date().toISOString(), lastSeen: new Date().toISOString(),
  recheckedAt: null, applyUrl: "https://x/1",
}];
type Body = Record<string, unknown>;

/** The board, with one honest arithmetic behind it: 100 remote, 700 with ANY
 *  stated mode, 1,000 with the mode filter dropped. So the unstated count is
 *  300, and the pre-fix figure (1,000 − 100) would have been 900. */
const COUNTS = { page: 100, anyStated: 700, dropped: 1000 };

function mount(path: string, opts: { capStated?: boolean } = {}) {
  window.history.replaceState({}, "", path);
  rpc.mockImplementation(async () => ({ data: [] }));
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-board" && b.action === "facets") return { data: { categories: {}, refreshedAt: null, sources: null }, error: null };
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) {
        if (b.workMode === "remote,hybrid,onsite") return { data: { total: COUNTS.anyStated, ...(opts.capStated ? { countCapped: true } : {}) } };
        if (b.workMode === undefined && b.remote === undefined) return { data: { total: COUNTS.dropped } };
        return { data: { total: COUNTS.page } };
      }
      return {
        data: {
          jobs: ROWS, total: COUNTS.page, totalAllCompanies: 1, companies: [], companiesCount: 0,
          categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false,
        },
      };
    }
    return { data: {} };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}
const countBodies = () => invoke.mock.calls
  .filter(([fn, o]) => fn === "job-board" && (o as { body?: Body })?.body?.action === "list" && (o as { body: Body }).body.countOnly === true)
  .map(([, o]) => (o as { body: Body }).body);
const text = () => document.body.textContent ?? "";

describe("1. the work-mode banner counts the postings that state no mode", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  it("behaviour: under Remote, the probe asks for every stated mode and the banner prints dropped − any-stated", async () => {
    mount("/jobs?mode=remote");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    // JUDGED BY THE REQUEST BODY. One probe with the mode filter dropped, one
    // with every stated value at once — and the list's own other constraints
    // kept on both (nothing else is active here, so the bodies are bare).
    await waitFor(() => {
      const bodies = countBodies();
      expect(bodies.some((b) => b.workMode === "remote,hybrid,onsite" && b.remote === undefined), "no any-stated probe").toBe(true);
      expect(bodies.some((b) => b.workMode === undefined && b.remote === undefined), "no dropped-mode probe").toBe(true);
    }, SLOW);
    await waitFor(() => expect(text()).toContain("Another 300 openings"), SLOW);
    expect(text(), "the pre-fix figure counted stated hybrid/on-site rows as unstated").not.toContain("Another 900 openings");
    expect(text()).toContain("100 of these employers state where the work happens");
  });

  it("behaviour: the legacy remote=1 binding takes the same two probes", async () => {
    mount("/jobs?remote=1");
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    await waitFor(() => {
      const bodies = countBodies();
      expect(bodies.some((b) => b.workMode === "remote,hybrid,onsite" && b.remote === undefined)).toBe(true);
    }, SLOW);
    await waitFor(() => expect(text()).toContain("Another 300 openings"), SLOW);
  });

  it("behaviour: a capped any-stated count publishes no difference at all", async () => {
    mount("/jobs?mode=remote", { capStated: true });
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    await waitFor(() => expect(countBodies().some((b) => b.workMode === "remote,hybrid,onsite")).toBe(true), SLOW);
    // Give the effect its settle; then the sentence must be absent, not 300
    // and not 900 — a difference with a capped half is not a number.
    await new Promise((r) => setTimeout(r, 300));
    expect(text()).not.toMatch(/Another [\d,]+ openings match everything else, but don't say/);
  });

  it("source: the mode kind issues both probes and subtracts the stated count; the pay kind is untouched", () => {
    const i = JOBS.indexOf("const [disclosure, setDisclosure] = useState");
    expect(i).toBeGreaterThan(0);
    const block = JOBS.slice(i, i + 6000);
    expect(block).toMatch(/probe\(\{ workMode: "remote,hybrid,onsite", remoteOnly: false \}\)/);
    expect(block).toMatch(/hidden = without - anyStated/);
    expect(block).toMatch(/if \(kind === "salary"\) \{\s*hidden = without - data\.total;/);
    expect(block, "a capped stated half must refuse").toMatch(/stated\?\.countCapped\) \{ setDisclosure\(null\); return; \}/);
  });

  it("keys: discWorkMode2 in en and en-GB with both placeholders; discWorkMode retired from all nine; the page calls the new one", () => {
    for (const f of ["en.json", "en-GB.json"]) {
      const s = String(jp(f).discWorkMode2 ?? "");
      expect(s, `${f} lacks jobsPage.discWorkMode2`).not.toBe("");
      expect(s).toContain("{{shown}}");
      expect(s).toContain("{{hidden}}");
    }
    for (const f of LOCALE_FILES) expect("discWorkMode" in jp(f), `${f} still carries jobsPage.discWorkMode`).toBe(false);
    expect(JOBS).toMatch(/jobsPage\.discWorkMode2/);
    expect(JOBS).not.toMatch(/jobsPage\.discWorkMode"/);
  });
});

describe("2. every filterCoverage key the server can emit has a renderer clause", () => {
  const emitted = [...new Set([...fnText("coverageDisclosure").matchAll(/\bout\.(\w+)\s*=/g)].map((m) => m[1]))].sort();

  it("discovers the emitted set, and it includes the one that went mute", () => {
    expect(emitted.length).toBeGreaterThanOrEqual(11);
    expect(emitted).toContain("employmentType");
    expect(emitted).toContain("workMode");
  });

  it("each emitted key is typed on BoardResponse.filterCoverage and rendered as a percentage clause", () => {
    const typeStart = JOBS.indexOf("filterCoverage?: {");
    expect(typeStart).toBeGreaterThan(0);
    const typeBlock = JOBS.slice(typeStart, JOBS.indexOf("};", typeStart));
    const renderStart = JOBS.indexOf("const fc = data?.filterCoverage;");
    expect(renderStart).toBeGreaterThan(0);
    const renderBlock = JOBS.slice(renderStart, JOBS.indexOf('t("jobsPage.filterCoverage"', renderStart));
    for (const k of emitted) {
      expect(typeBlock, `filterCoverage.${k} is emitted but not on the client type`).toMatch(new RegExp(`\\b${k}\\?: number`));
      expect(renderBlock, `filterCoverage.${k} is emitted but has no renderer clause`)
        .toMatch(new RegExp(`typeof fc\\.${k} === "number"[\\s\\S]{0,120}Math\\.round\\(fc\\.${k} \\* 100\\)`));
    }
  });

  it("the employment-type clause has its key in the English locales with {{pct}}, and the filter has a name", () => {
    for (const f of ["en.json", "en-GB.json"]) {
      const j = jp(f);
      expect(String(j.coverageEmploymentType ?? "")).toContain("{{pct}}");
      expect(typeof (j.filterName as Record<string, string>)?.employmentType).toBe("string");
    }
    expect(JOBS).toMatch(/jobsPage\.coverageEmploymentType/);
  });
});

describe("3. the legacy remote=1 binding gets the work-mode coverage sentence", () => {
  const meta = { v: { coverage: { workMode: 0.281, salaryFloor: 0.201 } } };

  it("walk: coverageDisclosure({remote:true}) emits workMode, exactly as {workMode:'remote'} does", () => {
    const cd = loadCoverageDisclosure();
    expect(cd({ workMode: "remote" }, meta)).toEqual({ filterCoverage: { workMode: 0.281 } });
    expect(cd({ remote: true }, meta), "remote=1 narrows to the stated-mode slice and must say so").toEqual({ filterCoverage: { workMode: 0.281 } });
    expect(cd({ remote: true, workMode: "hybrid" }, meta)).toEqual({ filterCoverage: { workMode: 0.281 } });
    // And nothing for nothing: an unfiltered request emits no coverage, and a
    // cold cache emits none either — the early return the intent test pins.
    expect(cd({}, meta)).toEqual({});
    expect(cd({ remote: true }, null)).toEqual({});
    expect(cd({ remote: false }, meta)).toEqual({});
  });

  it("teeth: the pre-fix copy of the function, called the same way, is silent for remote=1", () => {
    // Reconstruct the old line from the new one and run it. If the fixture
    // cannot be made to fail, the walk above is proving nothing.
    const fixed = fnText("coverageDisclosure");
    const preFix = fixed.replace(
      /if \(\(applied\.workMode != null \|\| applied\.remote === true\) && typeof cov\.workMode === "number"\)/,
      'if (applied.workMode != null && typeof cov.workMode === "number")',
    );
    expect(preFix, "the fixed line is not where this guard expects it").not.toBe(fixed);
    const c = FN.indexOf("const MEASURED_COVERAGE = {");
    const constText = FN.slice(c, FN.indexOf("} as const;", c) + "} as const;".length);
    const js = ts.transpileModule(`${constText}\n${preFix}\nreturn coverageDisclosure;`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const old = new Function(js)() as (a: Record<string, unknown>, m: unknown) => Record<string, unknown>;
    expect(old({ remote: true }, meta)).toEqual({});
  });
});
