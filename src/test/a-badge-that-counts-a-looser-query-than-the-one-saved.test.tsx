// A BADGE THAT COUNTS A LOOSER QUERY THAN THE ONE SAVED.
//
// The saved-search pills carry a "+N new" badge from a countOnly probe. That
// probe named eight fields of its own — q, location, remote, category,
// experience, companies, salaryFloor, postedAfter — while JobSearchParams
// persists twenty-one. Every filter it did not name was silently WIDENED for
// the count: a search saved as "nurse · remote · GB · no agencies · full-time"
// advertised a new-count drawn from nurse-remote across every country, every
// employment type and every staffing agency on the board. The number described
// a query the user never saved and the click never runs.
//
// This is the second hand-written copy of a mapping that already exists once
// (searchToBoardBody), and the FIRST time the two drifted, the Account card's
// employer scope vanished and a one-company watch counted the whole board. The
// fix is the mapper, not a longer list — so the guard is behavioural (what
// body actually goes on the wire) plus a mechanical drift check between the
// board's own serializer and the saved-search one.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const invoke = vi.fn();
const from = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: (...a: unknown[]) => from(...a),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

import { SavedSearchPills } from "../components/jobs/SavedSearchPills";
import { searchToBoardBody, type JobSearchParams } from "../lib/job-search-params";
import { boardFilterBody, type BoardFilterState } from "../pages/Jobs";

const ROOT = resolve(__dirname, "../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const PILLS = strip(readFileSync(resolve(ROOT, "src/components/jobs/SavedSearchPills.tsx"), "utf8"));

// The search from the defect report, saved whole.
const SAVED: JobSearchParams = {
  q: "nurse",
  // NOT `remote: true` alongside a work mode. The board keeps one definition of
  // Remote — the legacy boolean rides only when no mode was picked, because
  // sending both ANDs a strict subset onto the reader's own choice and drops
  // 7.6% of {workMode:remote,country:GB} — and saveCurrentSearch stores it under
  // that same rule, so no real saved search carries both.
  workMode: "remote,hybrid",
  country: "GB",
  employmentType: "full_time",
  excludeAgencies: true,
  category: "healthcare",
  includeUncategorised: true,
  experience: "senior",
  company: "workday~cvshealth",
  location: "London",
  salaryFloor: 60_000,
  salaryCeiling: 120_000,
  payBasis: "salaried",
  hasStatedPay: true,
  includeUnstatedPay: true,
  maxYears: 5,
  department: "nursing",
  vendor: "greenhouse,lever",
  maxAgeDays: 7,
  sendableOnly: true,
};

const WATERMARK = "2026-09-01T00:00:00.000Z";

function mountWith(params: JobSearchParams) {
  from.mockImplementation(() => {
    const rows = [{ id: "s1", name: "saved", params, last_seen_at: WATERMARK }];
    const thenable = {
      select: () => thenable,
      order: () => thenable,
      limit: () => Promise.resolve({ data: rows }),
      update: () => thenable,
      eq: () => thenable,
      then: (ok: (v: unknown) => void) => Promise.resolve({ data: rows }).then(ok),
    };
    return thenable;
  });
  invoke.mockResolvedValue({ data: { total: 12 } });
  return render(<MemoryRouter><SavedSearchPills /></MemoryRouter>);
}

const probeBody = () => (invoke.mock.calls[0]?.[1] as { body?: Record<string, unknown> })?.body ?? {};

describe("a badge that counts a looser query than the one saved", () => {
  beforeEach(() => { invoke.mockReset(); from.mockReset(); });

  it("probes the EXACT saved filter set, not the eight fields it happened to know", async () => {
    mountWith(SAVED);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    const body = probeBody();
    expect(body.action).toBe("list");
    expect(body.countOnly).toBe(true);
    // The watermark is what makes it a "new since" count at all.
    expect(body.postedAfter).toBe(WATERMARK);
    // Every filter that used to be dropped, on the wire.
    expect(body.workMode).toBe("remote,hybrid");
    expect(body.remote, "the legacy boolean must not ride alongside a work mode").toBeUndefined();
    expect(body.country).toBe("GB");
    expect(body.employmentType).toBe("full_time");
    expect(body.excludeAgencies).toBe(true);
    expect(body.vendor).toBe("greenhouse,lever");
    expect(body.department).toBe("nursing");
    expect(body.maxYears).toBe(5);
    expect(body.payBasis).toBe("salaried");
    expect(body.hasStatedPay).toBe(true);
    expect(body.includeUnstatedPay).toBe(true);
    expect(body.salaryCeiling).toBe(120_000);
    expect(body.maxAgeDays).toBe(7);
    expect(body.sendableOnly).toBe(true);
    expect(body.includeUncategorised).toBe(true);
    // And the ones it already had stay right.
    expect(body.q).toBe("nurse");
    expect(body.location).toBe("London");
    expect(body.category).toBe("healthcare");
    expect(body.experience).toBe("senior");
    expect(body.salaryFloor).toBe(60_000);
  });

  it("scopes the employer the way the board reads it — `companies`, never `company`", async () => {
    mountWith(SAVED);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    const body = probeBody();
    expect(body.companies).toEqual(["workday~cvshealth"]);
    expect(body.company, "a key job-board does not read — sending it drops the scope").toBeUndefined();
  });

  it("counts nothing narrower than the saved search: every filter it sends is one the search actually stored", async () => {
    mountWith(SAVED);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    const body = probeBody();
    const mapped = searchToBoardBody(SAVED);
    for (const [k, v] of Object.entries(body)) {
      if (k === "action" || k === "countOnly" || k === "includeFacets" || k === "postedAfter") continue;
      expect(mapped[k], `the probe sent ${k}, which the saved search did not`).toEqual(v);
    }
  });

  it("goes through the one mapper rather than a second hand-written list", () => {
    expect(PILLS).toMatch(/\.\.\.searchToBoardBody\(s\.params \?\? \{\}\)/);
    // The shape of the defect: filter names typed out inside the probe body.
    for (const k of ["salaryFloor:", "experience:", "companies:", "category:"]) {
      expect(PILLS, `a hand-written \`${k}\` is back in the probe`).not.toContain(k);
    }
  });

  it("the two serializers cannot drift: the board's body and the saved-search body carry the same filters", () => {
    // The deeper failure mode is not this probe but the pair of mappers behind
    // it — the board turns ITS state into a body, the saved search turns the
    // STORED params into a body, and a filter added to one and not the other
    // means a saved search that cannot express what the board can show. Derived
    // mechanically, so a twenty-second filter is covered the day it is added.
    const ALL_ON: BoardFilterState = {
      q: "nurse", location: "London", remoteOnly: true, workMode: "remote,hybrid",
      category: "healthcare", inclUncat: true, agentOnly: true, country: "GB",
      experience: "senior", companyTokens: ["workday~cvshealth"], salaryFloor: 60_000,
      salaryCeiling: 120_000, payBasis: "salaried", statedPayOnly: true,
      includeUnstatedPay: true, maxYears: 5, department: "nursing",
      vendor: "greenhouse,lever", employmentType: "full_time", hideAgencies: true,
      freshness: "7",
    };
    // UNION of the two mutually exclusive remote shapes, because that pair is
    // the one place the board's body is deliberately not a straight mapping:
    // `remote` and `workMode` can never both be emitted.
    const boardKeys = new Set([
      ...Object.keys(boardFilterBody(ALL_ON)),
      ...Object.keys(boardFilterBody({ ...ALL_ON, workMode: "" })),
    ]);
    const emitted = (b: Record<string, unknown>) =>
      Object.entries(b).filter(([, v]) => v !== undefined).map(([k]) => k);
    // Same union on this side, for the same reason.
    const savedKeys = new Set([
      ...emitted(searchToBoardBody(SAVED)),
      ...emitted(searchToBoardBody({ ...SAVED, workMode: undefined, remote: true })),
    ]);
    for (const k of boardKeys) {
      expect(savedKeys.has(k), `the board can filter by \`${k}\` and a saved search cannot carry it`).toBe(true);
    }
    for (const k of savedKeys) {
      expect(boardKeys.has(k), `a saved search carries \`${k}\` that the board's own body never sends`).toBe(true);
    }
  });

  it("a search saved with the standalone Remote toggle still probes remote-only", async () => {
    mountWith({ q: "nurse", remote: true });
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(probeBody().remote).toBe(true);
  });

  it("a search with nothing but a query still probes only that query", async () => {
    // The widening also ran in reverse: undefined filters must be omitted, not
    // sent as nulls, or the board reads a filter the reader never set.
    mountWith({ q: "nurse" });
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    const body = probeBody();
    const sent = Object.entries(body).filter(([, v]) => v !== undefined).map(([k]) => k).sort();
    expect(sent).toEqual(["action", "countOnly", "includeFacets", "postedAfter", "q"]);
  });
});
