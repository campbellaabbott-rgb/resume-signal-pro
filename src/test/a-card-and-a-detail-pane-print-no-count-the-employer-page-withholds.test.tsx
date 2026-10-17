// A CARD AND A DETAIL PANE PRINT NO COUNT THE EMPLOYER PAGE WITHHOLDS.
//
// The Hiring Health card on /jobs/company/:token reads its record through the
// shared gate (src/lib/hiring-record-gate.ts) and refuses the ninety-day
// counts where our re-list detector is failing (Domino's: 13,347 taken down
// and none back) or the board has not been watched long enough. The same page
// also prints the employer's job cards, and each card, its detail pane and the
// compare drawer read the closure verdict too. Until this change they read it
// raw: the card under "Closure record withheld" carried an "Actively hiring"
// badge whose tooltip said "we watched 13347 of its roles come off the board
// in the last 90 days and stay off", and the detail pane said the same.
//
// Every surface now reads the verdict through the gate once
// (gatedHiringRecord): a withheld record is never "closes", never a no, and
// never "no closure record": it is badged "Closure record withheld" with the
// gate's reason, as on the employer page itself. And the "Actively hiring"
// filter counts withheld employers apart from the ones we hold no record for.
//
// Judged by rendered text and tooltips against get_company_fill_curve rows
// shaped like the live ones, with a positive control.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

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

import Jobs, { gatedHiringRecord, partitionByHiringSignal } from "../pages/Jobs";

vi.setConfig(MOUNT_TEST_BUDGET);
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

const curve = (token: string, over: Record<string, unknown>) => ({
  company_token: token, open_roles: 1200, fills_90d: 0, relists_90d: 0,
  filled_roles_90d: 0, relisted_roles_90d: 0, ageouts_90d: 10,
  n_at_risk_14: 400, fills_le_14: 60, fill_rate_14: 0.2, fill_rate_14_lo: 0.17, fill_rate_14_hi: 0.23,
  relist_rate_14: 0.02, still_open_14: 0.78, fill_rate_7: 0.1, fill_rate_30: 0.4,
  median_days_to_fill: null, median_censored: true, dated_coverage: 0.9, dated_n: 900, undated_n: 100,
  fill_through: 0.5, churn: 0, absorption: 0.1, tracking_days: 40, sufficient: true,
  observability_bucket: "full_read", sufficient_30: false, insufficient_reason_30: "events",
  // Track 1 (A1): the gate reads a watch floor and the multi-site share; a
  // board read in full and dated, whose titles are not spread over sites.
  watched_from: "2026-08-01", multi_site_title_share: 0,
  ...over,
});
const DOMINOS = curve("dominos", { open_roles: 21829, observability_bucket: "lap_proven", tracking_days: 10, fill_rate_14: 0.0053, insufficient_reason_30: "lap", filled_roles_90d: 13347, relisted_roles_90d: 0, fills_90d: 13347, dated_coverage: 0.9979 });
// As the review probed it: read in full, watched 87 days, 1,293 down and none back.
const EUROFINS = curve("Eurofins", { open_roles: 1106, tracking_days: 87, fill_rate_14: 0.3047, filled_roles_90d: 1293, relisted_roles_90d: 0, dated_coverage: 0.8631 });
const OREILLY = curve("oreillyauto~wd1~oreilly", { open_roles: 4224, observability_bucket: "lap_proven", tracking_days: 10, fill_rate_14: 0.0135, insufficient_reason_30: "lap", filled_roles_90d: 509, relisted_roles_90d: 2, dated_coverage: 0.87 });
const FULL = curve("acme", { open_roles: 40, tracking_days: 40, fill_rate_14: 0.22, fill_rate_14_lo: 0.18, fill_rate_14_hi: 0.27, median_days_to_fill: 12, median_censored: false, filled_roles_90d: 60, relisted_roles_90d: 9 });

const jobOf = (token: string) => ({
  id: `workday:${token}:1`, source: "workday", token, company: "Acme", title: "Store Manager", location: "Austin, TX, USA", country: "US",
  salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: "onsite", employmentType: "full_time", experienceBand: "mid", minYears: 3, category: "operations",
  department: null, agency: false, postedAt: ago(2), lastSeen: ago(2), recheckedAt: ago(0), applyUrl: "https://x/1", remote: false,
});

// Pass B (2026-10-12): the employer's job cards carry its record on the BOARD
// (/jobs); on its own company page every card is that employer, so the page
// prints the record once, in G3's HiringRecordCard, and its cards carry none
// (CP26). The card and pane cases mount the board; the employer-page case
// mounts the lander.
function mount(token: string, row: Record<string, unknown>, where: "board" | "lander" = "board") {
  const path = where === "board" ? "/jobs" : `/jobs/company/${token}`;
  window.history.replaceState({}, "", path);
  const job = jobOf(token);
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_company_fill_curve") return { data: [row], error: null };
    return { data: [], error: null };
  });
  invoke.mockImplementation(async (fn: string, a: { body?: Record<string, unknown> } | undefined) => {
    const b = a?.body ?? {};
    if (fn === "job-fit") return { data: { terms: [] }, error: null };
    if (fn === "job-board" && b.action === "detail") return { data: { job, description: "A role." } };
    if (fn === "job-board" && b.action === "facets") return { data: { categories: {}, refreshedAt: ago(0), sources: {}, sourcesAt: ago(0) }, error: null };
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: 1 } };
      return { data: { jobs: [job], total: 1, totalAllCompanies: 1, companies: [{ token, name: "Acme", open: 1 }], companiesCount: 1, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false } };
    }
    return { data: {} };
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/jobs/company/:companyToken" element={<Jobs />} />
      </Routes>
    </MemoryRouter>,
  );
}
const text = () => document.body.textContent ?? "";
const card = () => document.querySelector<HTMLElement>("[data-job-id]");
const titles = () => Array.from(document.querySelectorAll<HTMLElement>("[title]")).map((e) => e.getAttribute("title") ?? "");
/** Every way a surface states this employer's own ninety-day count (the
 *  filter's basis sentence says "at least 3 of their roles" and is not one). */
const STAY_OFF = /\bwatched [\d,]+ of its roles come off the board\b/;

async function openDetail() {
  fireEvent.click(card()!);
  await waitFor(() => expect(text()).toMatch(/What the data says|The data says/), SLOW);
}

describe("a card and a detail pane print no count the employer page withholds", () => {
  beforeEach(() => {
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  for (const [name, token, row, why] of [
    ["Domino's (13,347 down, none back)", "dominos", DOMINOS, /re-list detection is not working here/],
    ["Eurofins (1,293 down, none back, read in full)", "Eurofins", EUROFINS, /re-list detection is not working here/],
    // GD5(a): a lap-read board's re-post test sees one visit's window, so its
    // counts are withheld at any depth, with the lap sentence.
    ["O'Reilly (a lap board)", "oreillyauto~wd1~oreilly", OREILLY, /our re-post test sees only the part read on one visit/],
  ] as const) {
    it(`${name}: the card is badged withheld with the gate's reason, and neither it nor the detail pane prints the count`, async () => {
      mount(token, row);
      await waitFor(() => expect(card()?.textContent ?? "").toContain("Closure record withheld"), SLOW);
      const chip = Array.from(card()!.querySelectorAll<HTMLElement>("[title]")).find((e) => (e.textContent ?? "").includes("Closure record withheld"))!;
      expect(chip.getAttribute("title")).toMatch(why);
      expect(card()!.textContent, "a withheld record is not 'no closure record'").not.toContain("No closure record");
      expect(card()!.textContent, "withheld counts cannot carry the badge").not.toContain("Actively hiring");
      expect(titles().filter((s) => STAY_OFF.test(s)), "a tooltip printed the withheld count").toEqual([]);
      await openDetail();
      expect(text(), "the detail pane printed the withheld count").not.toMatch(STAY_OFF);
      expect(titles().filter((s) => STAY_OFF.test(s))).toEqual([]);
      expect(text(), "the detail pane said we hold no record").not.toMatch(/we hold no closure record for this employer/);
      expect(text()).toMatch(why);
    });

    it(`${name}: the employer page's hiring record is badged withheld, prints no count, and its own cards carry no record`, async () => {
      mount(token, row, "lander");
      await waitFor(() => expect(document.querySelector("[data-hiring-record] [data-hh-withheld]")?.textContent).toContain("Closure record withheld"), SLOW);
      expect(text(), "the employer page printed the withheld count").not.toMatch(STAY_OFF);
      expect(titles().filter((s) => STAY_OFF.test(s))).toEqual([]);
      expect(card()!.textContent, "a card on the employer's own page carries the record the header already prints").not.toMatch(/Closure record withheld|Actively hiring|No closure record/);
    });
  }

  it("positive control: a board read in full and watched 40 days keeps its badge, its count and its clause", async () => {
    mount("acme", FULL);
    await waitFor(() => expect(card()?.textContent ?? "").toContain("Actively hiring"), SLOW);
    expect(titles().some((s) => s.includes("we watched 60 of its roles come off the board in the last 90 days and stay off"))).toBe(true);
    expect(card()!.textContent).not.toContain("Closure record withheld");
    await openDetail();
    expect(text()).toContain("we watched 60 of its roles come off the board and stay off");
  });
});

describe("the verdict through the gate, as every surface reads it", () => {
  it("a record the gate refuses is unknown with the gate's reason; an empty record is unknown with none; a readable one keeps its verdict", () => {
    expect(gatedHiringRecord(DOMINOS as never)).toEqual({ verdict: "unknown", withheld: "relist detection unproven" });
    expect(gatedHiringRecord(OREILLY as never)).toEqual({ verdict: "unknown", withheld: "relist detection unproven" });
    expect(gatedHiringRecord(FULL as never)).toEqual({ verdict: "closes", withheld: null });
    expect(gatedHiringRecord(curve("q", { filled_roles_90d: 0, relisted_roles_90d: 0 }) as never)).toEqual({ verdict: "unknown", withheld: null });
    expect(gatedHiringRecord(undefined)).toEqual({ verdict: "unknown", withheld: null });
    // A read that found no pattern is a reading, and the gate does not turn it into a refusal.
    expect(gatedHiringRecord(curve("q", { filled_roles_90d: 2, relisted_roles_90d: 0 }) as never)).toEqual({ verdict: "no-pattern", withheld: null });
  });

  it("the filter counts a withheld employer and a shared board name apart from an employer we hold no record of", () => {
    const rows = [{ token: "dominos" }, { token: "quiet" }, { token: "clear" }, { token: "acme" }];
    const verdict = (t?: string | null) => (t === "acme" ? "closes" as const : "unknown" as const);
    const kind = (t?: string | null) => (t === "dominos" ? "withheld" as const : t === "clear" ? "shared" as const : null);
    const growth = (t?: string | null) => (t === "clear" ? undefined : { verdict: "unknown", unknown_reason: "windowed_read" });
    const p = partitionByHiringSignal(rows, verdict, growth, kind);
    expect(p.shown.map((r) => r.token)).toEqual(["acme"]);
    expect(p.setAside.map((r) => r.token)).toEqual(["dominos", "quiet", "clear"]);
    expect(p.noClosureEmployers, "only 'quiet' is an employer we hold no closure record for").toBe(1);
    expect(p.withheldEmployers).toBe(1);
    expect(p.sharedEmployers).toBe(1);
    expect(p.growthUnreadEmployers, "a shared board name is never 'not read yet'").toBe(2);
    expect(p.growthReasons.unread).toBe(0);
  });
});
