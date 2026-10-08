// A DATA PAGE SAID "LOADING…" FOR EVER WHEN ITS CACHE COULD NOT BE READ.
//
// /pay-transparency reads one row, get_transparency_cache. When that row was
// missing or the read failed, the page fell back to get_pay_transparency and
// get_transparency_coverage -- both revoked from anon since 20260812 -- and a
// rejected read was swallowed by an empty catch, so both sections rendered
// "Loading…" indefinitely (register L2-10). The fallback is gone; a failed or
// empty read renders a sentence saying the figure could not be read.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    functions: { invoke: async () => ({ data: {} }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import PayTransparencyIndex from "../pages/PayTransparencyIndex";

const body = () => document.body.textContent ?? "";
const UNREAD = "We could not read this figure just now.";
const PAY = {
  categories: [{ category: "engineering", total: 1200, pay_pct: 41 }],
  top_companies: [{ company: "Acme", company_token: "acme", total: 80, pay_pct: 90 }],
  overall: { total: 5000, pay_pct: 38 },
};
const COVERAGE = { by_source: [{ source: "greenhouse", total: 900, pay_pct: 44, mode_pct: 70 }], overall: { total: 5000, pay_pct: 38, mode_n: 3000, mode_pct: 60 } };

function mount(cache: () => Promise<unknown>) {
  rpc.mockImplementation((fn: string) => (fn === "get_transparency_cache" ? cache() : Promise.resolve({ data: null, error: { code: "42501" } })));
  return render(<MemoryRouter><PayTransparencyIndex /></MemoryRouter>);
}

beforeEach(() => { rpc.mockReset(); });

describe("the Pay Transparency Index when its cache cannot be read", () => {
  it("says the figure could not be read, in both sections, when the read is rejected", async () => {
    mount(() => Promise.reject(new Error("network")));
    await waitFor(() => expect(document.querySelectorAll('[data-unread="transparency"]')).toHaveLength(2));
    expect(body()).not.toContain("Loading…");
  });

  it("does the same when the row is there but carries neither figure", async () => {
    mount(() => Promise.resolve({ data: null, error: null }));
    await waitFor(() => expect(document.querySelectorAll('[data-unread="transparency"]')).toHaveLength(2));
    expect(body()).not.toContain("Loading…");
  });

  it("never asks the two aggregates anon cannot run", async () => {
    mount(() => Promise.resolve({ data: null, error: null }));
    await waitFor(() => expect(body()).toContain(UNREAD));
    const asked = rpc.mock.calls.map((c) => c[0]);
    expect(asked).toEqual(["get_transparency_cache"]);
  });

  it("positive control: a read that answers prints the figures and no unread sentence", async () => {
    mount(() => Promise.resolve({ data: { pay: PAY, coverage: COVERAGE, computed_at: "2026-10-08T01:37:00Z" }, error: null }));
    await waitFor(() => expect(body()).toContain("Engineering & IT"));
    expect(body()).toContain("greenhouse");
    expect(body()).not.toContain(UNREAD);
  });
});
