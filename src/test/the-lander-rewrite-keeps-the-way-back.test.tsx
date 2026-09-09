// A GUARD THAT ASSERTS THE LANDER *KEEPS* from=explore, NOT THAT EXPLORE SENDS IT.
//
// Three guards already assert Explore emits `from=explore` — explore-claims
// ("a board link bypassed the wrapper that adds from=explore"),
// a-default-view-that-reached-two-tenths-of-a-percent ("a /jobs link with no
// way back"), and a-figure-the-same-on-every-tile ("a tile link lost the way
// back to Explore"). All three were green while the param was being deleted on
// arrival, because all three read the SENDER.
//
// What deleted it: Jobs.tsx's URL-sync effect reads `from` off the live search
// string and writes it into `p`, then two lander branches build their own URL
// by hand and `return` before `p` is ever serialised. `job` was re-added there
// by name; `from` was not. The branch that returns early is the no-filters
// lander — which is precisely and only what a tile click produces
// (/jobs/field/:id?from=explore), so the affordance survived every arrival
// except the one it exists for.
//
// It hid because `cameFromExplore` reads the param ONCE in a useState
// initialiser and holds it, so the Back-to-Explore link kept rendering for the
// rest of the session. The loss showed only on reload or a copied link — and
// no server-side attribution could survive it at all, which is why the
// explore->board referral is unmeasurable in the events table today.
//
// BEHAVIOURAL, driving the real effect against a real jsdom location, because
// this is a bug a source grep passed for weeks.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { readFileSync } from "node:fs";
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

import Jobs from "../pages/Jobs";

const ROOT = resolve(__dirname, "../..");
const RAW = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
// CODE IS JUDGED AGAINST COMMENT-STRIPPED SOURCE. This repo has failed four
// guards whose required literal was satisfied by a sentence in a comment, and
// the comment block above this very fix names `jobParam` several times.
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const ROWS = [
  { id: "j1", title: "Nurse", company: "Acme", company_token: "acme", location: "Boston, MA",
    apply_url: "https://acme.example/j1", source: "greenhouse", posted_at: new Date().toISOString(),
    first_seen: new Date().toISOString(), category: "healthcare" },
];

function mount(path: string, routePath: string) {
  window.history.replaceState({}, "", path);
  rpc.mockImplementation(async () => ({ data: [], error: null }));
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: ROWS.length } };
      return {
        data: {
          jobs: ROWS, total: ROWS.length, totalAllCompanies: ROWS.length,
          companies: [{ token: "acme", name: "Acme", count: 1 }],
          companiesCount: 1, categories: {}, failedSources: [], failedCount: 0,
          refreshedAt: null, hasMore: false,
        },
      };
    }
    return { data: {} };
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path={routePath} element={<Jobs />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { invoke.mockReset(); rpc.mockReset(); });

describe("the lander rewrite keeps the way back", () => {
  it("keeps from=explore on a field lander, the one arrival a tile click makes", async () => {
    mount("/jobs/field/healthcare?from=explore", "/jobs/field/:category");
    // The effect runs on mount and rewrites the address. Wait for it to have
    // rewritten at all, then assert what it kept.
    await waitFor(() => {
      expect(window.location.pathname).toBe("/jobs/field/healthcare");
    }, { timeout: 4000 });
    expect(
      new URLSearchParams(window.location.search).get("from"),
      `the lander rewrite deleted from=explore; address is ${window.location.pathname}${window.location.search}`,
    ).toBe("explore");
  });

  it("keeps from=explore on a company lander too", async () => {
    mount("/jobs/company/acme?from=explore", "/jobs/company/:companyToken");
    await waitFor(() => {
      expect(window.location.pathname).toBe("/jobs/company/acme");
    }, { timeout: 4000 });
    expect(
      new URLSearchParams(window.location.search).get("from"),
      "the company lander rewrite deleted from=explore",
    ).toBe("explore");
  });

  it("adds no query string at all when there is nothing to keep", async () => {
    // The fix must not make every clean lander URL grow a stray "?" — the
    // lander form is what /jobs/field/:id is canonicalised to for search.
    mount("/jobs/field/healthcare", "/jobs/field/:category");
    await waitFor(() => {
      expect(window.location.pathname).toBe("/jobs/field/healthcare");
    }, { timeout: 4000 });
    expect(window.location.search, "a bare lander grew a query string").toBe("");
  });

  it("builds both lander URLs from one params object, so neither can be forgotten", () => {
    // PROPERTY, NOT SPELLING. The defect was that each branch interpolated its
    // own hand-rolled string, so a parameter added to one was absent from the
    // other and from any branch added later. Both must now read the SAME
    // identifier, and that identifier must be built from something that sets
    // "from".
    // Matched line-wise: these are NESTED template literals, so a `[^`]*`
    // body regex stops at the inner backtick and silently finds nothing —
    // which is a guard that passes by matching zero things.
    const landers = CODE.split("\n")
      .map((l) => l.trim())
      .filter((l) => /replaceState\(\{\}, "", `\/jobs\/(?:field|company)\//.test(l));
    expect(landers.length, "expected exactly the two lander rewrites").toBe(2);
    for (const l of landers) {
      expect(l, `a lander rewrite still hand-builds its query string: ${l}`)
        .not.toMatch(/\bjobParam\b/);
      expect(l, `a lander rewrite does not use the shared params object: ${l}`)
        .toMatch(/\blanderQs\b/);
    }
    // ...and the shared object carries both. `job` was already load-bearing (a
    // shared ?job= deep link opens the detail panel); `from` is the fix.
    const builder = CODE.match(/const landerKeep = new URLSearchParams\(\);[\s\S]{0,400}?const landerQs/);
    expect(builder, "the shared lander params builder is gone").toBeTruthy();
    expect(builder![0]).toMatch(/landerKeep\.set\("job"/);
    expect(builder![0]).toMatch(/landerKeep\.set\("from"/);
  });

  it("still reads `from` off the live address rather than off filter state", () => {
    // `from` is not filter state and must never be added to the lander GATES —
    // if it were, arriving from Explore would disqualify the clean lander form
    // and every tile click would land on /jobs?category=... instead, which is
    // the URL the landers exist to avoid.
    const gates = [...CODE.matchAll(/if \(lander(?:Company|Category) &&[^)]*\)/g)].map((m) => m[0]);
    expect(gates.length).toBe(2);
    for (const g of gates) {
      expect(g, `a lander gate now tests \`from\`, which would break the clean lander URL: ${g}`)
        .not.toMatch(/\bfromParam\b/);
    }
  });
});
