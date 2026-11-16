/**
 * EVERY SHORTLIST REFUSAL READ "EVALUATION FAILED" (S14X-197, the page's half;
 * the function's half is a-shortlist-refusal-says-what-happened-and-when-to-try-again.test.ts).
 *
 * WHAT WAS WRONG. supabase-js answers a non-2xx call with data null and the
 * Response on error.context. The page read data.error, found nothing, and
 * showed one generic line for a rate limit, a scorer outage, a full account
 * and an expired session alike: no sentence from the server, no hint when to
 * try again, a retry offered where none could help, no way to sign in again.
 *
 * WHAT HOLDS NOW, mounted with the function faked: the banner shows the
 * server's sentence; a 429 or a timed 503 adds "about N minutes" from
 * Retry-After (or the body's seconds); a full account (409) and a missing
 * confirmation say no "try again"; a 401 links to sign in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { shortlistFake } from "./helpers/shortlist-page-fake";

vi.setConfig(MOUNT_TEST_BUDGET);

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./helpers/shortlist-page-fake")).fakeSupabase }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ session: { user: { id: "u-1" } }, user: { id: "u-1", email: "hr@example.com" }, loading: false }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));

import Shortlist from "@/pages/Shortlist";

const ROLE = { id: "role-1", title: "Data Engineer", jd_text: "Senior data engineer: Airflow, dbt and Snowflake.", jd_version: 1, jurisdiction: "OTHER", created_at: "2026-10-01T00:00:00Z" };

beforeEach(() => {
  shortlistFake.reset();
  shortlistFake.respond = (chain) => ({ data: chain.table === "shortlist_roles" ? [ROLE] : [], error: null });
});
afterEach(() => cleanup());

const refuse = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) => {
  shortlistFake.invoke = async () => ({ data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } }) } });
};

const evaluate = async () => {
  render(<MemoryRouter><Shortlist /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: /Data Engineer/ }));
  fireEvent.click(document.querySelector("[data-attestation] input")!);
  fireEvent.change(screen.getByPlaceholderText(/Paste the candidate's resume text/), { target: { value: "Built Airflow pipelines and dbt models on Snowflake for six years. ".repeat(3) } });
  fireEvent.click(screen.getByRole("button", { name: "Evaluate" }));
  return await waitFor(() => { const el = document.querySelector("[data-error]"); if (!el) throw new Error("no banner"); return el; });
};

describe("the banner says what the server said", () => {
  it("a rate limit shows the server's sentence and when to try again", async () => {
    refuse(429, { error: "You've reached the limit for this tool for now.", code: "rate_limited_function" }, { "Retry-After": "3600" });
    const banner = await evaluate();
    expect(banner.textContent).toContain("You've reached the limit for this tool for now.");
    expect(banner.textContent).toMatch(/about 60 minutes/);
    expect(banner.textContent).not.toMatch(/Evaluation failed/);
  });

  it("a scorer outage reads its seconds from the body when the header is not readable", async () => {
    refuse(503, { error: "The scoring service is not answering right now. Nothing was stored; try again in a few minutes.", code: "scoring_unavailable", retryAfterSeconds: 120 });
    const banner = await evaluate();
    expect(banner.textContent).toMatch(/not answering right now/);
    expect(banner.textContent).toMatch(/about 2 minutes/);
  });

  it("a full account says so and offers no retry", async () => {
    refuse(409, { error: "This account holds 10,000 evaluations, the most one account can hold, so no more can be scored on it. Delete candidates or roles you no longer need to make room.", code: "candidate_cap" });
    const banner = await evaluate();
    expect(banner.textContent).toMatch(/holds 10,000 evaluations/);
    expect(banner.textContent).not.toMatch(/try again/i);
  });

  it("an ended session links to sign in", async () => {
    refuse(401, { error: "Sign in to continue." });
    const banner = await evaluate();
    expect(banner.querySelector("[data-sign-in]")?.getAttribute("href")).toMatch(/^\/auth\?next=/);
  });
});
