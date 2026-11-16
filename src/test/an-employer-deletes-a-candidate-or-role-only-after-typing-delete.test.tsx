/**
 * AN EMPLOYER DELETES A CANDIDATE OR A ROLE ONLY AFTER TYPING DELETE
 * (S14X-073, the owner's rule A: the page half of 20261112211000).
 *
 * WHAT WAS WRONG. The page promised a four-year retention and offered no way
 * to delete anything; the only route was an email.
 *
 * WHAT HOLDS NOW, mounted with the database faked: until the deletions log
 * answers (the migration has not applied) the page offers no delete and says
 * there is no automatic deletion yet; once it answers, a role and an opened
 * candidate each offer a delete that runs only after DELETE is typed, calls
 * the migration's own function with the right id, says what went and reloads,
 * and a refused delete says nothing was deleted. The retention sentences then
 * state rule A.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { argsOf, page, shortlistFake } from "./helpers/shortlist-page-fake";

vi.setConfig(MOUNT_TEST_BUDGET);

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./helpers/shortlist-page-fake")).fakeSupabase }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ session: { user: { id: "u-1" } }, user: { id: "u-1", email: "hr@example.com" }, loading: false }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));

import Shortlist from "@/pages/Shortlist";

const ROLE = { id: "role-1", title: "Data Engineer", jd_text: "Senior data engineer: Airflow, dbt and Snowflake.", jd_version: 1, jurisdiction: "NYC", created_at: "2026-10-01T00:00:00Z" };
const ROW = {
  id: "cand-1", file_name: "Candidate 1", score: 88, flags: [], signals: [], interview_questions: [], level_read: "Senior", exclusions_applied: [],
  status: "pending", model_version: "m", created_at: "2026-10-02T00:00:00Z", jd_version: 1, jd_text_scored: "x", parsed_fields: {},
};

/** migrated: whether the deletions log answers, as it does once 20261112211000 has applied. */
function database(migrated: boolean) {
  shortlistFake.respond = (chain, t) => {
    if (chain.table === "shortlist_deletions") return migrated ? { data: [], error: null } : { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.shortlist_deletions'" } };
    if (chain.table === "shortlist_roles") return { data: [ROLE], error: null };
    if (chain.table === "shortlist_candidates") return t === "maybe" || t === "single" ? { data: ROW, error: null } : { data: page(chain, [ROW]), error: null };
    return { data: [], error: null };
  };
}

beforeEach(() => { shortlistFake.reset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mount = async () => {
  render(<MemoryRouter><Shortlist /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: /Data Engineer/ }));
  await screen.findByText("Candidate 1");
};
const reads = (table: string) => shortlistFake.chains.filter((c) => c.table === table && argsOf(c, "select")).length;

describe("before the migration applies", () => {
  it("offers no delete and says there is no automatic deletion yet", async () => {
    database(false);
    await mount();
    fireEvent.click(screen.getByText("Candidate 1"));
    await waitFor(() => expect(shortlistFake.chains.some((c) => c.table === "shortlist_deletions")).toBe(true));
    expect(document.querySelector("[data-delete-role]")).toBeNull();
    expect(document.querySelector("[data-delete-candidate]")).toBeNull();
    expect(document.querySelector("[data-retention-rule-a]")).toBeNull();
    expect(document.body.textContent).toContain("there is no automatic deletion yet");
    expect(document.body.textContent).not.toMatch(/four years/);
  });
});

describe("once the migration has applied", () => {
  it("states rule A where the page says how long records are kept", async () => {
    database(true);
    await mount();
    await waitFor(() => expect(document.querySelector("[data-retention-rule-a]")).not.toBeNull());
    expect(document.body.textContent).toContain("Records are kept until you delete the candidate, the role or your account, and anything still held four years after it was uploaded is deleted");
    expect(document.body.textContent).not.toContain("there is no automatic deletion yet");
  });

  it("deletes a candidate only after DELETE is typed, through shortlist_delete_candidate, and reloads the role", async () => {
    database(true);
    await mount();
    fireEvent.click(screen.getByText("Candidate 1"));
    fireEvent.click(await waitFor(() => { const b = document.querySelector("[data-delete-candidate]"); if (!b) throw new Error("no candidate delete"); return b as HTMLElement; }));
    const go = document.querySelector("[data-delete-go]") as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "delete" } });
    expect(go.disabled).toBe(true);
    fireEvent.click(go);
    expect(shortlistFake.rpcs).toEqual([]);
    const before = reads("shortlist_candidates");
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(document.querySelector("[data-delete-msg]")?.textContent).toMatch(/candidate, its evaluation and its decisions were deleted/));
    expect(shortlistFake.rpcs).toEqual([{ name: "shortlist_delete_candidate", args: { p_candidate_id: "cand-1" } }]);
    expect(reads("shortlist_candidates")).toBeGreaterThan(before);
    expect(document.querySelector("[data-delete-confirm]")).toBeNull();
  });

  it("deletes a role through shortlist_delete_role and leaves no role open", async () => {
    database(true);
    await mount();
    fireEvent.click(await waitFor(() => { const b = document.querySelector("[data-delete-role]"); if (!b) throw new Error("no role delete"); return b as HTMLElement; }));
    expect(document.querySelector("[data-delete-confirm]")?.textContent).toContain("Data Engineer");
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
    fireEvent.click(document.querySelector("[data-delete-go]") as HTMLElement);
    await waitFor(() => expect(document.querySelector("[data-delete-msg]")?.textContent).toMatch(/role, its candidates, their decisions and its notices were deleted/));
    expect(shortlistFake.rpcs).toEqual([{ name: "shortlist_delete_role", args: { p_role_id: "role-1" } }]);
    expect(screen.queryByText("Candidate 1")).toBeNull();
  });

  it("a refused delete says nothing was deleted and keeps the confirmation open", async () => {
    database(true);
    shortlistFake.rpcAnswer = () => ({ data: null, error: { code: "P0002", message: "That role was not found in your account, so nothing was deleted" } });
    await mount();
    fireEvent.click(await waitFor(() => { const b = document.querySelector("[data-delete-role]"); if (!b) throw new Error("no role delete"); return b as HTMLElement; }));
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
    fireEvent.click(document.querySelector("[data-delete-go]") as HTMLElement);
    await waitFor(() => expect(document.querySelector("[data-delete-msg]")?.textContent).toMatch(/^Nothing was deleted: That role was not found/));
    expect(document.querySelector("[data-delete-confirm]")).not.toBeNull();
    expect(screen.getByText("Candidate 1")).toBeTruthy();
  });
});
