/**
 * SHORTLIST ASKS THE UPLOADER FIRST AND RECORDS NO SEX OR RACE (owner decision
 * D14; S12-151 on the page).
 *
 * WHAT WAS WRONG. Any signed-in account could upload strangers' resumes for AI
 * scoring with nothing confirming it was allowed to, and record each
 * candidate's sex and race on the page.
 *
 * WHAT HOLDS NOW, mounted with the database faked: the page offers no sex or
 * race field and reads none; Evaluate and the no-AI review stay disabled until
 * the uploader ticks the confirmation, whose words are the ones the function
 * logs, and the request carries attested: true; a candidate whose resume held
 * text addressed to the scorer shows that warning.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { SHORTLIST_ATTESTATION_TEXT } from "../../supabase/functions/_shared/shortlist-attestation";
import { PLANTED_INSTRUCTIONS_FLAG } from "../../supabase/functions/_shared/planted-instructions";

vi.setConfig(MOUNT_TEST_BUDGET);

const tablesRead: string[] = [];
const invoked: Array<{ fn: string; body: Record<string, unknown> }> = [];
const ROLE = { id: "role-1", title: "Data Engineer", jd_text: "Senior data engineer: Airflow, dbt and Snowflake.", jd_version: 1, jurisdiction: "OTHER", created_at: "2026-10-01T00:00:00Z" };
const CANDIDATE = {
  id: "cand-1", file_name: "Candidate 1", score: 88, flags: [PLANTED_INSTRUCTIONS_FLAG, "JD requires Kafka; not present"], signals: [], interview_questions: [],
  level_read: "Senior", exclusions_applied: [], status: "pending", model_version: "m", created_at: "2026-10-02T00:00:00Z", jd_version: 1, jd_text_scored: null,
  parsed_fields: { scoringIntegrity: { plantedInstructions: true, matched: ["asks for a score"], modelSuspected: false } },
};

function q(table: string) {
  tablesRead.push(table);
  const data = table === "shortlist_roles" ? [ROLE] : table === "shortlist_candidates" ? [CANDIDATE] : [];
  const self: Record<string, unknown> = {};
  for (const k of ["select", "eq", "in", "order", "limit", "insert", "upsert"]) self[k] = () => self;
  self.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(ok);
  self.single = async () => ({ data: data[0] ?? null, error: null });
  return self;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => q(t),
    rpc: async () => ({ data: null, error: null }),
    functions: { invoke: async (fn: string, opts: { body: Record<string, unknown> }) => { invoked.push({ fn, body: opts.body }); return { data: { success: true }, error: null }; } },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ session: { user: { id: "u-1" } }, user: { id: "u-1", email: "hr@example.com" }, loading: false }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));

import Shortlist from "@/pages/Shortlist";

afterEach(() => { cleanup(); tablesRead.length = 0; invoked.length = 0; });

describe("D14 on the page", () => {
  it("offers no sex or race field and reads none; evaluation waits for the uploader's confirmation", async () => {
    render(<MemoryRouter><Shortlist /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Data Engineer/ }));
    await screen.findByText("Candidate 1");
    expect(screen.queryByLabelText("Sex")).toBeNull();
    expect(screen.queryByLabelText("Race/ethnicity")).toBeNull();
    expect(tablesRead).not.toContain("shortlist_demographics");

    const evaluate = screen.getByRole("button", { name: "Evaluate" }) as HTMLButtonElement;
    expect(evaluate.disabled, "a stranger's resume could be scored with nothing confirmed").toBe(true);
    expect((screen.getByRole("button", { name: /Alternative review, no AI/ }) as HTMLButtonElement).disabled).toBe(true);
    const box = document.querySelector("[data-attestation]")!;
    expect(box.textContent).toBe(SHORTLIST_ATTESTATION_TEXT);
    fireEvent.click(box.querySelector("input")!);
    fireEvent.change(screen.getByPlaceholderText(/Paste the candidate's resume text/), { target: { value: "Built Airflow pipelines and dbt models on Snowflake for six years. ".repeat(3) } });
    fireEvent.click(evaluate);
    await waitFor(() => expect(invoked).toHaveLength(1));
    expect(invoked[0]).toMatchObject({ fn: "shortlist-evaluate", body: { roleId: "role-1", attested: true } });
  });

  it("a candidate whose resume talked to the scorer shows the warning, apart from the job-related gaps", async () => {
    render(<MemoryRouter><Shortlist /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Data Engineer/ }));
    fireEvent.click(await screen.findByText("Candidate 1"));
    const warn = await waitFor(() => document.querySelector("[data-steered]")!);
    expect(warn.textContent).toBe(PLANTED_INSTRUCTIONS_FLAG);
    expect(screen.getByText(/JD requires Kafka/)).toBeTruthy();
    expect(screen.getAllByText(PLANTED_INSTRUCTIONS_FLAG)).toHaveLength(1);
  });
});
