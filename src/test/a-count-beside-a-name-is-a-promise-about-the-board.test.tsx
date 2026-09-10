// A COUNT BESIDE A NAME IS A PROMISE ABOUT THE BOARD.
//
// Owner's ask, 2026-09-10: "for the vendor dropdown — can you put the numbered
// inventory beside each name to give users that view". The number exists
// already: refresh_job_board_facets writes `sourcesFacet` (source -> servable
// count, both serving predicates, jsonb_object_agg — exact, never capped) into
// the fat facet row on every pass. What did not exist was a path from that row
// to the control: the head row `vHead` did not carry it, the `facets` action
// did not forward it, and VENDOR_OPTIONS was a bare list of names.
//
// ── THE PATH, END TO END ─────────────────────────────────────────────────────
//
//   refresh pass  ->  vHead.sourcesFacet  ->  action:"facets" {sources, sourcesAt}
//                 ->  readBoardFacets()   ->  vendorOptionsWithCounts(sources)
//                 ->  MultiSelectFilter rows, with the basis stated once below them
//
// Every hop is asserted here, because the disclosure-nobody-renders file
// records what happens when only one end is: the data arrives for months and
// nobody sees it.
//
// ── THE RULES A NUMBER HAS TO KEEP ──────────────────────────────────────────
//
//   1. NEVER `capped`. The 10,000 cap belongs to the list `total`; a facet
//      count is exact. A "+" beside Workday would claim a ceiling the query
//      never hit.
//   2. ZERO OR ABSENT IS NO NUMBER. The facet omits an empty source rather
//      than sending 0; the row keeps its name and prints nothing. And the
//      option carries no `count` key at all, so a mutant rendering "0" has
//      nothing to render from.
//   3. THE BASIS IS STATED ONCE, ON THE CONTROL, WITH THE FACET'S OWN STAMP —
//      and only while there are numbers for it to describe. Null `sources`
//      (an older function during the deploy window, a failed read, a carried
//      map with no counted-at) means no numbers AND no basis line.
//   4. A CHANGED MEANING IS A NEW KEY. The tooltip now says what the number
//      is, so vendorTip is retired from all nine locales and vendorTip2 stands
//      in its place.
//
// Behavioural where the defect is behaviour (jsdom, the board mocked, the
// popover opened, the row text read); source guards against comment-stripped
// text for the server hops a render cannot reach; teeth proven on mutants.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

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

import Jobs, { vendorOptionsWithCounts } from "../pages/Jobs";
import { readBoardFacets } from "../lib/board-facets";
import { ATS_VENDORS, NON_ATS_SOURCES, UNMEASURED_ATS_SOURCES } from "../config/ats-vendors";

const ROOT = resolve(__dirname, "../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const FN = strip(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));
const JOBS = strip(readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8"));
const LOCALES = resolve(ROOT, "src/i18n/locales");
const LOCALE_FILES = readdirSync(LOCALES).filter((f) => f.endsWith(".json")).sort();
const jp = (f: string) => JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).jobsPage as Record<string, unknown>;
const SLOW = { timeout: 4000 } as const;

/** The facets action, from its `if` to the next action's. */
function facetsAction(): string {
  const i = FN.indexOf('if (action === "facets")');
  const j = FN.indexOf('if (action === "list")', i);
  expect(i, "the facets action is gone").toBeGreaterThan(0);
  expect(j, "the list action no longer follows the facets action — re-point this slice").toBeGreaterThan(i);
  return FN.slice(i, j);
}
/** The head row literal, from `const vHead = {` to its upsert. */
function headRow(): string {
  const i = FN.indexOf("const vHead = {");
  const j = FN.indexOf('k: "refresh_head"', i);
  expect(i, "vHead is gone").toBeGreaterThan(0);
  expect(j).toBeGreaterThan(i);
  return FN.slice(i, j);
}

// ── THE FIXTURE ──────────────────────────────────────────────────────────────

const AT = "2026-09-10T08:15:00.000Z";
const SOURCES = { workday: 1234, greenhouse: 77, lever: 0, oracle: 9 };
const ROWS = [{
  id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme",
  title: "Staff Engineer", location: "Cambridge", country: "GB",
  salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: null, employmentType: null, experienceBand: null, minYears: null,
  category: "engineering", department: null, remote: false,
  postedAt: new Date().toISOString(), lastSeen: new Date().toISOString(),
  recheckedAt: null, applyUrl: "https://x/1",
}];

type FacetsReply = Record<string, unknown> | null;

function mount(facets: FacetsReply) {
  window.history.replaceState({}, "", "/jobs");
  rpc.mockImplementation(async () => ({ data: [] }));
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-board" && b.action === "facets") return { data: facets, error: null };
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: 1 } };
      return {
        data: {
          jobs: ROWS, total: 1, totalAllCompanies: 1, companies: [], companiesCount: 0,
          categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false,
        },
      };
    }
    return { data: {} };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

/** Open the vendor popover; return each row's text keyed by its label, plus
 *  the basis note (or null). */
async function openVendorPicker() {
  fireEvent.click(screen.getAllByRole("button", { name: "Job board source" })[0]);
  await waitFor(() => expect(screen.queryAllByRole("checkbox", { name: /Workday/ }).length).toBeGreaterThan(0), SLOW);
  // THE POPOVER'S OWN ROWS, not every checkbox on the page: the "States pay"
  // and "Hide staffing agencies" boxes are checkboxes too.
  const group = screen.getByRole("group", { name: "Job board source" });
  const rows: Record<string, string> = {};
  for (const cb of within(group).getAllByRole("checkbox")) {
    const label = cb.querySelector("span.truncate")?.textContent ?? "";
    rows[label] = cb.textContent ?? "";
  }
  const notes = document.querySelectorAll('[data-testid="multi-select-note"]');
  return { rows, note: notes.length ? (notes[0].textContent ?? "") : null, noteCount: notes.length };
}

// ── THE WALK, AS A FUNCTION, SO ITS TEETH CAN BE SHOWN ON A MUTANT ──────────

type Opt = { value: string; label: string; count?: number; capped?: boolean };
function assertHonest(opts: Opt[], sources: Record<string, number> | null) {
  const keys = [...ATS_VENDORS, ...UNMEASURED_ATS_SOURCES, ...NON_ATS_SOURCES].map((v) => v.key);
  expect(opts.map((o) => o.value), "the option set must not depend on inventory").toEqual(keys);
  for (const o of opts) {
    expect("capped" in o, `${o.value} carries a capped flag — facet counts are exact`).toBe(false);
    const n = sources?.[o.value];
    if (typeof n === "number" && n > 0) {
      expect(o.count, `${o.value} should print ${n}`).toBe(n);
    } else {
      expect("count" in o, `${o.value} has ${n === undefined ? "no entry" : `count ${n}`} in the facet and must carry NO count key`).toBe(false);
    }
  }
}

describe("a count beside a name is a promise about the board", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  // ── SERVER: the two hops a render cannot reach ─────────────────────────────

  it("the head row carries sourcesFacet (a source-keyed map, not the employer map the row was split to avoid)", () => {
    const head = headRow();
    expect(head).toMatch(/sourcesFacet/);
    // Guarded as an object, spread conditionally — never `?? {}`, which would
    // publish an empty map as twenty zeros on a pre-migration row.
    expect(head).toMatch(/sourcesFacet[\s\S]{0,400}typeof[\s\S]{0,200}sourcesFacet[\s\S]{0,200}=== "object"/);
    expect(head).not.toMatch(/sourcesFacet\s*\?\?\s*\{\}/);
    // The fat row the head is cut from carries it too, or there is nothing to cut.
    const fat = FN.slice(FN.indexOf("categoriesFacet: f.categoriesFacet ?? {},"), FN.indexOf("const vHead = {"));
    expect(fat).toMatch(/sourcesFacet: f\.sourcesFacet/);
  });

  it("the facets action forwards `sources` from the head row's sourcesFacet, with `sourcesAt`, and never a cap", () => {
    const block = facetsAction();
    expect(block).toMatch(/sources:\s*\(?fv\.sourcesFacet/);
    expect(block).toMatch(/sourcesAt:\s*\(fv\.refreshedAt as string\) \?\? null/);
    // Absent -> null, never {} — the deploy-window rule.
    expect(block).toMatch(/:\s*null,\s*sourcesAt:/);
    expect(block).not.toMatch(/sources:[^\n]*\?\?\s*\{\}/);
    expect(block, "a facet count is exact; no cap rides with it").not.toMatch(/capped/i);
  });

  // ── CLIENT: the reader and the option builder, walked ──────────────────────

  it("readBoardFacets validates the shape and keeps null distinct from an empty map", async () => {
    invoke.mockImplementation(async () => ({
      data: { categories: { engineering: 5 }, refreshedAt: AT, sources: { workday: 3, bad: -1, worse: "x" }, sourcesAt: AT },
      error: null,
    }));
    const r = await readBoardFacets();
    expect(r?.sources).toEqual({ workday: 3 });
    expect(r?.sourcesAt).toBe(AT);
    expect(r?.carried).toBe(false);
    // An OLD function: no sources key at all. Null, not {}.
    invoke.mockImplementation(async () => ({ data: { categories: { engineering: 5 }, refreshedAt: AT }, error: null }));
    expect((await readBoardFacets())?.sources).toBeNull();
    // A failed read is null, and a throw never escapes.
    invoke.mockImplementation(async () => { throw new Error("boom"); });
    expect(await readBoardFacets()).toBeNull();
  });

  it("vendorOptionsWithCounts: every option keeps its row, a positive count rides, zero/absent carry no count key, nothing is capped", () => {
    assertHonest(vendorOptionsWithCounts(SOURCES), SOURCES);
    assertHonest(vendorOptionsWithCounts(null), null);
    assertHonest(vendorOptionsWithCounts(undefined), null);
    assertHonest(vendorOptionsWithCounts({}), {});
    // The one value that is positive is the one that prints.
    const wd = vendorOptionsWithCounts(SOURCES).find((o) => o.value === "workday");
    expect(wd?.count).toBe(1234);
  });

  it("teeth: a mutant marking capped, and a mutant carrying 0, both fail the walk", () => {
    const capped = vendorOptionsWithCounts(SOURCES).map((o) => ({ ...o, capped: true }));
    expect(() => assertHonest(capped, SOURCES)).toThrow();
    const zero = vendorOptionsWithCounts(SOURCES).map((o) => ("count" in o ? o : { ...o, count: 0 }));
    expect(() => assertHonest(zero, SOURCES)).toThrow();
    // And a mutant that HIDES the empty source fails too: the option set is fixed.
    const hidden = vendorOptionsWithCounts(SOURCES).filter((o) => "count" in o);
    expect(() => assertHonest(hidden, SOURCES)).toThrow();
  });

  it("vendor keys ARE the facet's source strings — lowercase, as the ingest writes them", () => {
    for (const o of vendorOptionsWithCounts(null)) {
      expect(o.value).toBe(o.value.toLowerCase());
      expect(o.value).toMatch(/^[a-z0-9]+$/);
    }
  });

  // ── BEHAVIOUR: what the reader sees ────────────────────────────────────────

  it("behaviour: a source in the map prints its exact count, a source absent from it prints no number, and the basis is stated once with the stamp", async () => {
    mount({ categories: { engineering: 1 }, refreshedAt: AT, sources: SOURCES, sourcesAt: AT });
    await waitFor(() => expect(document.body.textContent).toContain("Staff Engineer"), SLOW);
    const { rows, note, noteCount } = await waitFor(async () => {
      const r = await openVendorPicker();
      expect(r.rows["Workday"]).toContain("1,234");
      return r;
    }, SLOW);
    // THE POSITIVE FIRST, so the negatives below cannot pass on a facet that
    // never arrived or a popover that never opened.
    expect(rows["Workday"]).toContain("1,234");
    expect(rows["Workday"], "an exact count never claims a cap").not.toContain("+");
    expect(rows["Greenhouse"]).toContain("77");
    expect(rows["Oracle"]).toContain("9");
    // Zero in the map: the row stays, the number does not.
    expect(rows["Lever"]).toBe("Lever");
    expect(rows["Lever"]).not.toMatch(/\d/);
    // Absent from the map entirely: same.
    expect(rows["Ashby"]).toBe("Ashby");
    expect(rows["USAJOBS"]).toBe("USAJOBS");
    expect(Object.keys(rows).length, "every source keeps its row").toBe(vendorOptionsWithCounts(null).length);
    // The basis: once, on the control, naming the population and the stamp.
    expect(noteCount).toBe(1);
    expect(note).toContain("whole board");
    expect(note).toContain("not narrowed by your other filters");
    expect(note).toContain("2026");
  });

  it("behaviour: an older function (sources null) prints no numbers and no basis line — silence, never 0", async () => {
    mount({ categories: { engineering: 1 }, refreshedAt: AT, sources: null, sourcesAt: AT });
    await waitFor(() => expect(document.body.textContent).toContain("Staff Engineer"), SLOW);
    // Let the facet read settle before opening, so an absent number is a
    // decision and not a race.
    await waitFor(() => expect(invoke.mock.calls.some(([, o]) => (o as { body?: { action?: string } })?.body?.action === "facets")).toBe(true), SLOW);
    const { rows, noteCount } = await openVendorPicker();
    for (const [label, text] of Object.entries(rows)) {
      expect(text, `${label} printed a number under a null map`).toBe(label);
    }
    expect(noteCount, "a basis line over no numbers is a sentence about nothing").toBe(0);
    expect(document.body.textContent).not.toContain("whole board");
  });

  it("behaviour: a map that arrived EMPTY ({}) prints no numbers and no basis line — an empty board is not an inventory", async () => {
    // refresh_job_board_facets COALESCEs an empty aggregate to '{}' and the
    // server's object-guard forwards it; the reader keeps {} apart from null.
    // {} is truthy, so a publish gate on `f.sources` alone would put the basis
    // sentence under twenty nameless rows.
    mount({ categories: {}, refreshedAt: AT, sources: {}, sourcesAt: AT });
    await waitFor(() => expect(document.body.textContent).toContain("Staff Engineer"), SLOW);
    await waitFor(() => expect(invoke.mock.calls.some(([, o]) => (o as { body?: { action?: string } })?.body?.action === "facets")).toBe(true), SLOW);
    const { rows, noteCount } = await openVendorPicker();
    for (const [label, text] of Object.entries(rows)) {
      expect(text, `${label} printed a number under an empty map`).toBe(label);
    }
    expect(noteCount, "a basis line over no numbers is a sentence about nothing").toBe(0);
    expect(document.body.textContent).not.toContain("whole board");
    // And the gate is the property, not the truthiness of the map.
    expect(JOBS).toMatch(/if \(!Object\.values\(f\.sources\)\.some\(\(n\) => n > 0\)\) return;/);
  });

  it("behaviour: carried counts with no counted-at stamp are not published either", async () => {
    mount({ categories: { engineering: 1 }, refreshedAt: AT, facetsCarried: true, sources: SOURCES, sourcesAt: AT });
    await waitFor(() => expect(document.body.textContent).toContain("Staff Engineer"), SLOW);
    await waitFor(() => expect(invoke.mock.calls.some(([, o]) => (o as { body?: { action?: string } })?.body?.action === "facets")).toBe(true), SLOW);
    const { rows, noteCount } = await openVendorPicker();
    expect(rows["Workday"]).toBe("Workday");
    expect(noteCount).toBe(0);
  });

  it("behaviour: carried counts WITH their counted-at stamp print under that stamp", async () => {
    const COUNTED = "2026-09-09T20:00:00.000Z";
    mount({ categories: { engineering: 1 }, refreshedAt: AT, facetsCarried: true, facetsCarriedAt: COUNTED, sources: SOURCES, sourcesAt: AT });
    await waitFor(() => expect(document.body.textContent).toContain("Staff Engineer"), SLOW);
    const { rows, note } = await waitFor(async () => {
      const r = await openVendorPicker();
      expect(r.rows["Workday"]).toContain("1,234");
      return r;
    }, SLOW);
    expect(rows["Workday"]).toContain("1,234");
    expect(note).toContain(new Date(COUNTED).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }));
  });

  // ── THE CONTROL IS WIRED TO THE BUILDER, AND THE KEYS ARE THE NEW ONES ─────

  it("the vendor control takes the counted options and states the basis in the re-minted keys", () => {
    const i = JOBS.indexOf('ariaLabel={t("jobsPage.vendorFieldLabel"');
    expect(i).toBeGreaterThan(0);
    const block = JOBS.slice(i - 400, i + 1600);
    expect(block).toMatch(/options=\{vendorOptions\}/);
    expect(block).not.toMatch(/options=\{VENDOR_OPTIONS\}/);
    expect(block).toMatch(/jobsPage\.vendorTip2/);
    expect(block).toMatch(/jobsPage\.vendorCountsBasis/);
    expect(JOBS, "the retired tooltip key is still called").not.toMatch(/jobsPage\.vendorTip"/);
    // The builder feeds the control from the shared reader, once, on mount.
    expect(JOBS).toMatch(/vendorOptionsWithCounts\(vendorInventory\?\.sources\)/);
    expect(JOBS).toMatch(/await readBoardFacets\(\)/);
  });

  it("the basis key is in the English locales with {{when}} intact; vendorTip is retired from all nine", () => {
    expect(LOCALE_FILES.length, "expected nine locale files").toBe(9);
    for (const f of ["en.json", "en-GB.json"]) {
      const j = jp(f);
      expect(typeof j.vendorCountsBasis, `${f} lacks jobsPage.vendorCountsBasis`).toBe("string");
      expect(String(j.vendorCountsBasis)).toContain("{{when}}");
      expect(typeof j.vendorTip2, `${f} lacks jobsPage.vendorTip2`).toBe("string");
      // No count spelled as a word, and the population named.
      expect(String(j.vendorCountsBasis)).toMatch(/whole board/);
    }
    for (const f of LOCALE_FILES) {
      expect("vendorTip" in jp(f), `${f} still carries the retired jobsPage.vendorTip`).toBe(false);
    }
  });
});
