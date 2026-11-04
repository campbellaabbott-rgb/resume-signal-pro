/**
 * REOPENING PREPARE OPENS THE LETTER AND THE RÉSUMÉ ALREADY DRAFTED (S12-052,
 * the letter and tailored-résumé half; the answers half is
 * reopening-prepare-shows-the-answers-already-drafted).
 *
 * The board's Prepare dialog has a button for a tailored résumé and one for a
 * cover letter. Each press cleared the last result and called the generator
 * again, so a letter closed without copying could only be reached by drafting it
 * again, on the daily writing allowance. A draft is now kept per job, for the
 * same résumé, posting text and language, while the page is open: the same press
 * opens it with no call, and asking for a new one is its own control.
 *
 * The whole board mounted; only the backend is faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [], error: null }),
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t", user: { id: "u1" } } } }),
      getUser: async () => ({ data: { user: { id: "u1" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "sam@example.com" }, session: { access_token: "t", user: { id: "u1", email: "sam@example.com" } }, loading: false }),
  safeNextPath: (s: string) => s,
}));
function stubTable() {
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is", "upsert", "delete"]) th[k] = () => th;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import Jobs, { forgetKeptWriting } from "../pages/Jobs";
import { forgetKeptDrafts } from "@/components/apply/ApplicationAnswers";

vi.setConfig(MOUNT_TEST_BUDGET);

const RESUME = "Sam Park, Software Engineer, Initech, 2019-2024: built billing services in Go and Postgres, led a team of four, cut invoice failures by half.";
const OTHER_RESUME = "Dana Reyes, Operations Lead, Globex, 2017-2024: ran a warehouse of ninety people, moved the site to a new stock system, and halved mis-picks.";
const DAY = 86_400_000;
const row = (n: number, token: string, title: string) => ({
  id: `greenhouse:${token}:${n}`, source: "greenhouse", token, company: token[0].toUpperCase() + token.slice(1),
  title, location: "Leeds, UK", country: "GB", salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: "onsite", employmentType: "full_time", experienceBand: "mid", minYears: 3, category: "engineering", department: null,
  postedAt: new Date(Date.now() - n * DAY).toISOString(), lastSeen: new Date().toISOString(), recheckedAt: new Date().toISOString(),
  applyUrl: `https://apply.example/${token}/${n}`, remote: false,
});
const ROWS = [row(1, "acme", "Staff Engineer"), row(2, "beta", "Warehouse Associate")];
const postings: Record<string, string> = {};

const letterCalls = () => invoke.mock.calls.filter(([fn]) => fn === "generate-cover-letter").length;
const resumeCalls = () => invoke.mock.calls.filter(([fn]) => fn === "generate-tailored-resume").length;
const letter = (text: string) => ({ data: { success: true, data: { coverLetter: text } }, error: null });
const written = (summary: string) => ({
  data: { success: true, professionalSummary: summary, keySkills: ["go"], experienceHighlights: [], suggestedJobTitle: "Staff Engineer", coverLetterOpening: "Hello.", applicationTips: [], jobTitle: "Staff Engineer", jobCompany: "Acme" },
  error: null,
});
let letterAnswer: () => unknown;
let resumeAnswer: () => unknown;

let matchMedia: typeof window.matchMedia;
beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  sessionStorage.setItem("rb_board_resume", RESUME);
  for (const r of ROWS) postings[r.id] = `The posting for ${r.title}, with enough words to read.`;
  matchMedia = window.matchMedia;
  window.matchMedia = ((q: string) => ({ matches: /min-width:\s*1024px/.test(q), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  letterAnswer = () => letter("Dear Acme, the first letter.");
  resumeAnswer = () => written("The first summary.");
  invoke.mockReset();
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "generate-cover-letter") return letterAnswer();
    if (fn === "generate-tailored-resume") return resumeAnswer();
    if (fn === "generate-application-answers") return { data: { answers: [], skipped: [], inferred: true, undrafted: [] }, error: null };
    if (fn !== "job-board") return { data: {} };
    if (b.action === "detail") return { data: { job: ROWS.find((r) => r.id === b.id) ?? null, description: postings[String(b.id)] ?? "" } };
    if (b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: ROWS.length } };
      return { data: { jobs: ROWS, total: ROWS.length, totalAllCompanies: ROWS.length, companies: [], companiesCount: 2, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false } };
    }
    return { data: {} };
  });
});
afterEach(async () => {
  cleanup();
  window.matchMedia = matchMedia;
  forgetKeptWriting();
  forgetKeptDrafts();
  if (i18n.language !== "en") await i18n.changeLanguage("en");
});

const mount = () => render(<MemoryRouter initialEntries={["/jobs"]}><Jobs /></MemoryRouter>);
async function openPrepare() {
  fireEvent.click(await screen.findByRole("button", { name: /Prep answers/ }, SLOW));
  await screen.findByRole("dialog", {}, SLOW);
  await screen.findByRole("button", { name: /Draft a cover letter|Open your cover letter|Anschreiben/ }, SLOW);
}
const button = (name: RegExp) => screen.getByRole("button", { name });
const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
/** The Close control of the dialog on top: Radix hides what is under it from the accessibility tree. */
const closeTop = async () => {
  const before = document.querySelectorAll('[role="dialog"]').length;
  const closes = screen.getAllByRole("button", { name: /^Close$/ });
  fireEvent.click(closes[closes.length - 1]);
  await waitFor(() => expect(document.querySelectorAll('[role="dialog"]').length, "the dialog did not close").toBe(before - 1), SLOW);
};
async function closeEverything() {
  while (document.querySelectorAll('[role="dialog"]').length) await closeTop();
}

describe("the cover letter in the Prepare dialog", () => {
  it("closed and pressed again: the same letter, and no second draft", async () => {
    mount();
    await openPrepare();
    fireEvent.click(button(/Draft a cover letter/));
    expect(await screen.findByText("Dear Acme, the first letter.", {}, SLOW)).toBeTruthy();
    expect(letterCalls()).toBe(1);
    await closeEverything();

    await openPrepare();
    fireEvent.click(button(/Open your cover letter/));
    expect(await screen.findByText("Dear Acme, the first letter.", {}, SLOW)).toBeTruthy();
    await settle();
    expect(letterCalls(), "reopening spent another draft on the same job").toBe(1);
  });

  it("a letter that lands after its dialog was closed is still there, with no second draft", async () => {
    let land: (v: unknown) => void = () => {};
    letterAnswer = () => new Promise((r) => { land = r; });
    mount();
    await openPrepare();
    fireEvent.click(button(/Draft a cover letter/));
    await waitFor(() => expect(letterCalls()).toBe(1));
    await closeTop();
    land(letter("The letter that landed late."));
    await settle();
    fireEvent.click(await screen.findByRole("button", { name: /Open your cover letter/ }, SLOW));
    expect(await screen.findByText("The letter that landed late.", {}, SLOW)).toBeTruthy();
    expect(letterCalls()).toBe(1);
  });

  it("Draft again asks for a new letter, and that one is kept", async () => {
    mount();
    await openPrepare();
    fireEvent.click(button(/Draft a cover letter/));
    await screen.findByText("Dear Acme, the first letter.", {}, SLOW);
    letterAnswer = () => letter("Dear Acme, the second letter.");
    fireEvent.click(button(/Draft again/));
    expect(await screen.findByText("Dear Acme, the second letter.", {}, SLOW)).toBeTruthy();
    expect(letterCalls()).toBe(2);
    await closeEverything();
    await openPrepare();
    fireEvent.click(button(/Open your cover letter/));
    expect(await screen.findByText("Dear Acme, the second letter.", {}, SLOW)).toBeTruthy();
    expect(letterCalls()).toBe(2);
  });

  it("a Draft again that fails leaves the earlier letter to come back to", async () => {
    mount();
    await openPrepare();
    fireEvent.click(button(/Draft a cover letter/));
    await screen.findByText("Dear Acme, the first letter.", {}, SLOW);
    letterAnswer = () => ({ data: null, error: new Error("refused") });
    fireEvent.click(button(/Draft again/));
    await waitFor(() => expect(letterCalls()).toBe(2));
    await waitFor(() => expect(screen.queryByText(/Your cover letter/)).toBeNull(), SLOW);
    fireEvent.click(await screen.findByRole("button", { name: /Open your cover letter/ }, SLOW));
    expect(await screen.findByText("Dear Acme, the first letter.", {}, SLOW)).toBeTruthy();
    expect(letterCalls()).toBe(2);
  });

  it("is kept in the page's memory only: no browser storage holds it", async () => {
    mount();
    await openPrepare();
    fireEvent.click(button(/Draft a cover letter/));
    await screen.findByText("Dear Acme, the first letter.", {}, SLOW);
    const stored = JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage });
    expect(stored).not.toContain("the first letter");
  });

  describe("is drafted anew when what it was written from changed", () => {
    async function draftThenLeave() {
      const view = mount();
      await openPrepare();
      fireEvent.click(button(/Draft a cover letter/));
      await screen.findByText("Dear Acme, the first letter.", {}, SLOW);
      await closeEverything();
      return view;
    }

    it("the employer changed the posting's text", async () => {
      await draftThenLeave();
      postings[ROWS[0].id] = "The posting for Staff Engineer, rewritten by the employer since.";
      await openPrepare();
      letterAnswer = () => letter("For the rewritten posting.");
      fireEvent.click(button(/Draft a cover letter/));
      expect(await screen.findByText("For the rewritten posting.", {}, SLOW)).toBeTruthy();
      expect(letterCalls()).toBe(2);
    });

    it("another résumé is on the board", async () => {
      const view = await draftThenLeave();
      view.unmount();
      sessionStorage.setItem("rb_board_resume", OTHER_RESUME);
      mount();
      await openPrepare();
      letterAnswer = () => letter("For the other résumé.");
      fireEvent.click(button(/Draft a cover letter/));
      expect(await screen.findByText("For the other résumé.", {}, SLOW)).toBeTruthy();
      expect(letterCalls()).toBe(2);
    });

    it("the page's language changed", async () => {
      await draftThenLeave();
      await i18n.changeLanguage("de");
      await settle();
      await openPrepare();
      letterAnswer = () => letter("Sehr geehrtes Team.");
      fireEvent.click(button(/Anschreiben entwerfen/));
      expect(await screen.findByText("Sehr geehrtes Team.", {}, SLOW)).toBeTruthy();
      expect(letterCalls()).toBe(2);
    });
  });
});

describe("the tailored résumé in the Prepare dialog", () => {
  it("closed and pressed again: the same résumé, and no second draft", async () => {
    mount();
    await openPrepare();
    fireEvent.click(button(/Tailor my résumé/));
    expect(await screen.findByText(/The first summary\./, {}, SLOW)).toBeTruthy();
    expect(resumeCalls()).toBe(1);
    await closeEverything();

    await openPrepare();
    fireEvent.click(button(/Open your tailored résumé/));
    expect(await screen.findByText(/The first summary\./, {}, SLOW)).toBeTruthy();
    await settle();
    expect(resumeCalls(), "reopening spent another draft on the same job").toBe(1);
  });

  it("Tailor it again asks for a new one, and that one is kept", async () => {
    mount();
    await openPrepare();
    fireEvent.click(button(/Tailor my résumé/));
    await screen.findByText(/The first summary\./, {}, SLOW);
    await closeTop();
    resumeAnswer = () => written("The second summary.");
    fireEvent.click(await screen.findByRole("button", { name: /Tailor it again/ }, SLOW));
    expect(await screen.findByText(/The second summary\./, {}, SLOW)).toBeTruthy();
    expect(resumeCalls()).toBe(2);
    await closeTop();
    fireEvent.click(await screen.findByRole("button", { name: /Open your tailored résumé/ }, SLOW));
    expect(await screen.findByText(/The second summary\./, {}, SLOW)).toBeTruthy();
    expect(resumeCalls()).toBe(2);
  });

  it("another job is drafted for itself, and offers nothing kept", async () => {
    mount();
    await openPrepare();
    fireEvent.click(button(/Tailor my résumé/));
    await screen.findByText(/The first summary\./, {}, SLOW);
    await closeEverything();

    const card = Array.from(document.querySelectorAll<HTMLElement>("[data-job-id]")).find((c) => (c.textContent ?? "").includes("Warehouse Associate"))!;
    const title = Array.from(card.querySelectorAll<HTMLElement>("h2, h3, a, button")).find((el) => (el.textContent ?? "").includes("Warehouse Associate")) ?? card;
    fireEvent.click(title);
    await waitFor(() => expect(invoke.mock.calls.some(([fn, o]) => fn === "job-board" && (o as { body?: { id?: string } })?.body?.id === ROWS[1].id)).toBe(true), SLOW);
    await settle(50);
    await openPrepare();
    expect(screen.queryByRole("button", { name: /Open your tailored résumé/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Tailor it again/ })).toBeNull();
    resumeAnswer = () => written("For the warehouse.");
    fireEvent.click(button(/Tailor my résumé/));
    expect(await screen.findByText(/For the warehouse\./, {}, SLOW)).toBeTruthy();
    expect(resumeCalls()).toBe(2);
  });
});
