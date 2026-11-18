/**
 * A SHORTLIST ROLE PAST SIX HUNDRED CANDIDATES LOST ITS DECISIONS (S14X-075).
 *
 * WHAT WAS WRONG. The page read a role's candidates in one request (PostgREST
 * answers at most 1,000 rows) and their decisions with .in("candidate_id",
 * <every id>), a URL that outgrows the gateway past about six hundred ids.
 * That read failed, the page dropped the error, and an alternative-review
 * candidate (whose AI score must never be used) was ranked by it; the audit
 * export read the same way and downloaded a file missing decisions.
 *
 * WHAT HOLDS NOW, mounted with the database faked (an .in() over more than
 * six hundred ids answers the way the gateway does): candidates are read by
 * role in pages of 1,000; decisions are read through their candidate's
 * role_id with no id list; a failed read shows [data-read-error] and ranks
 * nothing; the JSON export holds every decision of all 1,200 candidates.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { argsOf, blobText, callsOf, page, shortlistFake, type Chain } from "./helpers/shortlist-page-fake";

vi.setConfig(MOUNT_TEST_BUDGET);

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./helpers/shortlist-page-fake")).fakeSupabase }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ session: { user: { id: "u-1" } }, user: { id: "u-1", email: "hr@example.com" }, loading: false }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));

import Shortlist from "@/pages/Shortlist";

const ROLE = { id: "role-1", title: "Data Engineer", jd_text: "Senior data engineer: Airflow, dbt and Snowflake.", jd_version: 1, jurisdiction: "OTHER", created_at: "2026-10-01T00:00:00Z" };
const CANDIDATES = Array.from({ length: 1200 }, (_, i) => ({
  id: `cand-${i}`, file_name: `Candidate ${i}`, score: 90 - (i % 50), flags: [], signals: [], interview_questions: [], level_read: "Senior",
  exclusions_applied: [], status: "pending", model_version: "m", created_at: "2026-10-02T00:00:00Z", jd_version: 1, jd_text_scored: null, parsed_fields: null,
}));
// cand-7 scored 83 and was then routed to alternative review: it must never be ranked.
const ALT = { id: "dec-alt", candidate_id: "cand-7", action: "alt_review_requested", new_value: null, created_at: "2026-10-03T00:00:00Z" };
const NOTES = CANDIDATES.map((c, i) => ({ id: `dec-${i}`, candidate_id: c.id, action: "note", new_value: "uploader_attested:v1", created_at: "2026-10-02T00:00:00Z" }));

let decisionsFail = false;
const tooLong = (chain: Chain) => callsOf(chain, "in").some(([col, ids]) => col === "candidate_id" && Array.isArray(ids) && ids.length > 600);

beforeEach(() => {
  shortlistFake.reset();
  decisionsFail = false;
  shortlistFake.respond = (chain) => {
    if (chain.table === "shortlist_roles") return { data: [ROLE], error: null };
    if (chain.table === "shortlist_candidates") return { data: page(chain, CANDIDATES), error: null };
    if (chain.table === "shortlist_decisions") {
      if (tooLong(chain)) return { data: null, error: { message: "414 Request-URI Too Large" } };
      if (decisionsFail) return { data: null, error: { message: "connection reset" } };
      const actions = argsOf(chain, "in") as [string, string[]] | undefined;
      const all = [ALT, ...NOTES].filter((d) => !actions || actions[0] !== "action" || actions[1].includes(d.action));
      return { data: page(chain, all), error: null };
    }
    return { data: [], error: null };
  };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const openRole = async () => {
  render(<MemoryRouter><Shortlist /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: /Data Engineer/ }));
};

describe("a role past six hundred candidates", () => {
  it("reads every candidate in pages of 1,000 and the decisions by role, with no id list", async () => {
    await openRole();
    await screen.findByText("Candidate 1199");
    const cand = shortlistFake.chains.filter((c) => c.table === "shortlist_candidates");
    expect(cand.map((c) => argsOf(c, "range"))).toEqual(expect.arrayContaining([[0, 999], [1000, 1999]]));
    const dec = shortlistFake.chains.filter((c) => c.table === "shortlist_decisions");
    expect(dec.length).toBeGreaterThan(0);
    for (const c of dec) {
      expect(callsOf(c, "in").some(([col]) => col === "candidate_id"), "an id list travelled in the URL").toBe(false);
      expect(callsOf(c, "eq")).toContainEqual(["shortlist_candidates.role_id", "role-1"]);
    }
  });

  it("never ranks the alternative-review candidate by its AI score", async () => {
    await openRole();
    await screen.findByText("Candidate 1199");
    const card = document.querySelector('[data-candidate="cand-7"]')!;
    expect(card.querySelector("[data-alt-review]")).not.toBeNull();
    expect(card.querySelector("[data-rank]")?.textContent ?? "").toBe("");
  });

  it("a failed decision read is shown and nothing is ranked", async () => {
    decisionsFail = true;
    await openRole();
    const banner = await waitFor(() => { const el = document.querySelector("[data-read-error]"); if (!el) throw new Error("no read error shown"); return el; });
    expect(banner.textContent).toMatch(/connection reset/);
    expect(document.querySelectorAll("[data-rank]")).toHaveLength(0);
  });

  it("the JSON export holds the decisions of all 1,200 candidates", async () => {
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => { blobs.push(b as Blob); return "blob:x"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    await openRole();
    await screen.findByText("Candidate 1199");
    fireEvent.click(screen.getByRole("button", { name: /Audit JSON/ }));
    await waitFor(() => expect(blobs).toHaveLength(1));
    const payload = JSON.parse(await blobText(blobs[0]));
    expect(payload.candidates).toHaveLength(1200);
    expect(new Set(payload.decisions.map((d: { candidate_id: string }) => d.candidate_id)).size).toBe(1200);
    expect(payload.decisions).toHaveLength(1201);
  });

  it("an export whose decisions cannot be read is not downloaded", async () => {
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => { blobs.push(b as Blob); return "blob:x"; });
    await openRole();
    await screen.findByText("Candidate 1199");
    decisionsFail = true;
    fireEvent.click(screen.getByRole("button", { name: /Audit CSV/ }));
    await waitFor(() => expect(document.querySelector("[data-error]")?.textContent ?? "").toMatch(/export was not downloaded/));
    expect(blobs).toHaveLength(0);
  });
});
