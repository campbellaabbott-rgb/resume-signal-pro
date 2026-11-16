/**
 * THE EMPLOYER COULD NOT SEE WHAT THE MODEL SCORED (S14X-162; the page half
 * of S14X-072).
 *
 * WHAT WAS WRONG. Every evaluation stores the redacted text the model was
 * shown, the candidate's jurisdiction and the planted-instruction matches,
 * but the page dropped all three: an employer could not check what the
 * redactor let through, and the JSON audit export, the compliance evidence,
 * left them out. Nor did anything say when no name had been found.
 *
 * WHAT HOLDS NOW, mounted with the database faked: opening a candidate reads
 * its row and shows a "What the model saw" block with the text, the
 * jurisdiction and the matches; the JSON export carries redacted_text,
 * candidate_jurisdiction and parsed_fields for every candidate; a candidate
 * whose résumé showed no name says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { argsOf, blobText, page, shortlistFake } from "./helpers/shortlist-page-fake";

vi.setConfig(MOUNT_TEST_BUDGET);

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./helpers/shortlist-page-fake")).fakeSupabase }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ session: { user: { id: "u-1" } }, user: { id: "u-1", email: "hr@example.com" }, loading: false }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));

import Shortlist from "@/pages/Shortlist";

const ROLE = { id: "role-1", title: "Data Engineer", jd_text: "Senior data engineer: Airflow, dbt and Snowflake.", jd_version: 1, jurisdiction: "NYC", created_at: "2026-10-01T00:00:00Z" };
const ROW = {
  id: "cand-1", file_name: "Candidate 1", score: 88, flags: [], signals: [], interview_questions: [], level_read: "Senior", exclusions_applied: [],
  status: "pending", model_version: "m", created_at: "2026-10-02T00:00:00Z", jd_version: 1, jd_text_scored: "Senior data engineer: Airflow, dbt and Snowflake.",
  redacted_text: "[CANDIDATE] built Airflow pipelines on Snowflake for six years.",
  candidate_jurisdiction: "NYC",
  parsed_fields: { scoringIntegrity: { plantedInstructions: true, matched: ["asks for a score"], modelSuspected: false }, redaction: { nameDetected: false } },
};

beforeEach(() => {
  shortlistFake.reset();
  shortlistFake.respond = (chain, t) => {
    if (chain.table === "shortlist_roles") return { data: [ROLE], error: null };
    if (chain.table === "shortlist_candidates") {
      const cols = String(argsOf(chain, "select")?.[0] ?? "*");
      // The list read names its columns; the scored text is not among them.
      const row = cols === "*" || cols.includes("redacted_text") ? ROW : Object.fromEntries(Object.entries(ROW).filter(([k]) => cols.includes(k)));
      return t === "maybe" || t === "single" ? { data: row, error: null } : { data: page(chain, [row]), error: null };
    }
    return { data: [], error: null };
  };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const openCandidate = async () => {
  render(<MemoryRouter><Shortlist /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: /Data Engineer/ }));
  fireEvent.click(await screen.findByText("Candidate 1"));
};

describe("what the model saw", () => {
  it("opening a candidate shows the text the model scored, its jurisdiction and the planted-instruction matches", async () => {
    await openCandidate();
    const saw = await waitFor(() => { const el = document.querySelector("[data-model-saw]"); if (!el) throw new Error("no model-saw block"); return el; });
    expect(saw.textContent).toContain("[CANDIDATE] built Airflow pipelines on Snowflake for six years.");
    expect(saw.textContent).toContain("NYC");
    expect(saw.textContent).toContain("asks for a score");
  });

  it("a candidate whose résumé showed no name says the name may have reached the model", async () => {
    await openCandidate();
    await waitFor(() => expect(document.querySelector("[data-name-not-found]")).not.toBeNull());
  });

  it("the JSON export carries the scored text, the jurisdiction and parsed_fields", async () => {
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => { blobs.push(b as Blob); return "blob:x"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    render(<MemoryRouter><Shortlist /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Data Engineer/ }));
    await screen.findByText("Candidate 1");
    fireEvent.click(screen.getByRole("button", { name: /Audit JSON/ }));
    await waitFor(() => expect(blobs).toHaveLength(1));
    const c = JSON.parse(await blobText(blobs[0])).candidates[0];
    expect(c.redacted_text).toBe(ROW.redacted_text);
    expect(c.candidate_jurisdiction).toBe("NYC");
    expect(c.parsed_fields.scoringIntegrity.matched).toEqual(["asks for a score"]);
    expect(c.jd_text_scored).toBe(ROW.jd_text_scored);
  });
});
