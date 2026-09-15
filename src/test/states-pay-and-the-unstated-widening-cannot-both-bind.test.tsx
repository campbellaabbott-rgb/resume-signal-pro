// STATES PAY AND THE UNSTATED WIDENING CANNOT BOTH BIND.
//
// The controls guard's C12 case (every-control-in-the-picture-sends-what-it-
// names, 2026-09-15) observed a body carrying both hasStatedPay:true and
// includeUnstatedPay:true. The server ANDs `salary_min_annual IS NOT NULL`
// with the floor's OR-arm (`salary_rank_usd >= floor OR salary_rank_usd IS
// NULL`), so every unpriced row the widening re-admitted was thrown straight
// back out — two lit controls, one of them doing nothing, and ignoredFilters
// silent about it. The one thing the OR-arm still let through under the AND
// was stated pay in a currency the rank column cannot convert (it is
// GENERATED, ELSE NULL): a slice nobody asked for by name.
//
// As of job-board build 2026-09-09.72, normalizeFilters binds the widening
// FALSE when hasStatedPay is true and names it in `ignored`. That is a result
// change for the unconvertible-currency slice, not disclosure alone, and it is
// the honest one: a key the body carries either means what its control says
// or is reported back.
//
// Three runtimes have to agree for the reader to ever see the sentence:
//   1. filters.ts (Deno) puts the key in `ignored`         — pure cases below
//   2. Jobs.tsx routes the key to the WIDENING sentence   — jsdom case below
//   3. all nine locales can NAME the key                  — locale case below
// This vitest imports the Deno module directly (the cross-runtime pattern the
// other filter guards use); `npm run check:functions` only type-checks it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { normalizeFilters } from "../../supabase/functions/job-board/filters";

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

const norm = (b: Record<string, unknown>) => normalizeFilters(b, 12);
const times = (xs: string[], k: string) => xs.filter((x) => x === k).length;

describe("filters.ts: the pairing is refused and named", () => {
  it("States pay + Incl. unstated pay binds the widening false and names it once", () => {
    const r = norm({ salaryFloor: 100000, hasStatedPay: true, includeUnstatedPay: true });
    expect(r.applied.hasStatedPay).toBe(true);
    expect(r.applied.includeUnstatedPay, "the widening cannot bind under the stated-pay AND").toBe(false);
    expect(times(r.ignored, "includeUnstatedPay"), "named, exactly once").toBe(1);
    // Nothing else in the body is disturbed by the refusal.
    expect(r.applied.salaryFloor).toBe(100000);
    expect(r.ignored).toEqual(["includeUnstatedPay"]);
  });

  it("the widening alone still binds, and States pay alone is silent", () => {
    const alone = norm({ salaryFloor: 100000, includeUnstatedPay: true });
    expect(alone.applied.includeUnstatedPay).toBe(true);
    expect(alone.ignored).toEqual([]);
    const stated = norm({ salaryFloor: 100000, hasStatedPay: true });
    expect(stated.applied.hasStatedPay).toBe(true);
    expect(stated.applied.includeUnstatedPay).toBe(false);
    expect(stated.ignored).toEqual([]);
  });

  it("a non-boolean widening under States pay is named once, not twice", () => {
    // The type guard already names a string "true"; the pairing rule must not
    // add a second entry for the same key.
    const r = norm({ salaryFloor: 100000, hasStatedPay: true, includeUnstatedPay: "true" });
    expect(r.applied.includeUnstatedPay).toBe(false);
    expect(times(r.ignored, "includeUnstatedPay")).toBe(1);
  });

  it("with no floor the pairing is still named — the key was sent, and it will not bind", () => {
    const r = norm({ hasStatedPay: true, includeUnstatedPay: true });
    expect(r.applied.includeUnstatedPay).toBe(false);
    expect(times(r.ignored, "includeUnstatedPay")).toBe(1);
  });
});

describe("the page can say it, in every language", () => {
  const LOCALES = resolve(__dirname, "../i18n/locales");
  const files = readdirSync(LOCALES).filter((f) => f.endsWith(".json"));

  it("nine locales each name includeUnstatedPay under jobsPage.filterName", () => {
    expect(files.length).toBe(9);
    for (const f of files) {
      const jp = JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).jobsPage as { filterName?: Record<string, string> };
      const v = jp.filterName?.includeUnstatedPay;
      expect(typeof v, `${f} cannot name the refused widening — the disclosure would print a raw identifier`).toBe("string");
      expect(String(v).trim().length, `${f} names it with an empty string`).toBeGreaterThan(0);
      expect(v, `${f} must not fall back to the wire name`).not.toBe("includeUnstatedPay");
    }
  });

  it("the disclosure routes the key to the widening sentence, not the narrowing one", () => {
    // Property over spelling: the set the disclosure partitions on must hold
    // the key, read from the comment-stripped source so prose cannot pass it.
    const raw = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const m = code.match(/const WIDENING = new Set\(\[([^\]]*)\]\);/);
    expect(m, "the ignoredFilters disclosure no longer partitions on a WIDENING set").toBeTruthy();
    const members = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(members).toContain("includeUnstatedPay");
    expect(members).toContain("includeUncategorised");
  });
});

describe("the sentence renders where the results are", () => {
  const ROW = {
    id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme",
    title: "Staff Engineer", location: "Cambridge", country: "GB",
    salary: "$120,000 – $150,000", salaryMinAnnual: 120000, salaryMaxAnnual: 150000,
    salaryPeriod: "year", salaryCurrency: "USD",
    workMode: "remote", employmentType: "full_time", experienceBand: "senior", minYears: 6,
    category: "engineering", department: "Platform", agency: false,
    postedAt: new Date().toISOString(), lastSeen: new Date().toISOString(), recheckedAt: null,
    applyUrl: "https://x/1", remote: true,
  };

  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  it("a list reply naming includeUnstatedPay prints the widening sentence with the key's name, not the narrowing one", async () => {
    rpc.mockImplementation(async () => ({ data: [], error: null }));
    invoke.mockImplementation(async (fn: string, a: { body?: Record<string, unknown> } | undefined) => {
      const b = a?.body ?? {};
      if (fn !== "job-board") return { data: {}, error: null };
      if (b.action === "facets") return { data: { categories: { engineering: 61_204 }, refreshedAt: null }, error: null };
      if (b.action === "list" && (b.facetCounts || b.countOnly)) return { data: { categories: {}, total: 1 } };
      if (b.action === "list") {
        return {
          data: {
            jobs: [ROW], total: 1, totalAllCompanies: 1, companies: [], companiesCount: 0,
            categories: { engineering: 61_204 }, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false,
            // What build .72 answers for hasStatedPay:true + includeUnstatedPay:true
            // (pinned above against the module itself); here the reply is the
            // fixture and the page's rendering of it is the property.
            ignoredFilters: ["includeUnstatedPay"],
          },
        };
      }
      return { data: {} };
    });
    render(<MemoryRouter><Jobs /></MemoryRouter>);
    const text = () => document.body.textContent ?? "";
    await waitFor(() => expect(text()).toContain("Staff Engineer"), { timeout: 4000 });
    await waitFor(() => expect(text()).toContain("postings that don't state pay"), { timeout: 4000 });
    // The WIDENING sentence: "couldn't add … left out here", never "unfiltered by it".
    expect(text()).toContain("couldn't add postings that don't state pay");
    expect(text()).not.toContain("unfiltered by it");
    // And never the raw wire name.
    expect(text()).not.toContain("includeUnstatedPay");
  });
});
