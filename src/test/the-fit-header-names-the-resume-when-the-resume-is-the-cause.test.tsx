// THE FIT HEADER NAMES THE RÉSUMÉ WHEN THE RÉSUMÉ IS THE CAUSE (sweep MATCH-09).
//
// WHAT WAS WRONG. Over a fit-ranked page with nothing scored, the order caption
// said "not ranked — none of these postings has a description we can score
// yet", whatever had happened. It said it when the scorer read no skill in the
// reader's résumé (every posting comes back unscored for that, and no posting
// is at fault), when the hourly allowance was already spent, when the scorer
// did not answer, and while scores were still on their way. A reader with a
// résumé in another language was told the board's postings were the problem.
//
// WHAT HOLDS NOW, on the mounted board and in the rule the caption reads:
//   - the résumé, the allowance and a failed call each get their own sentence;
//   - the description sentence is kept for the one case it is true of;
//   - the new sentences exist in all nine languages.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import Jobs, * as JobsModule from "@/pages/Jobs";

vi.setConfig(MOUNT_TEST_BUDGET);

type Body = Record<string, unknown>;
type Answer = "no_resume_terms" | "no_description" | "limit" | "failed";
const RESUME = "Infirmière diplômée avec huit ans d'expérience en soins intensifs dans un centre hospitalier. ".repeat(3);
const row = (n: number) => ({
  id: `greenhouse:acme:${n}`, token: "acme", company: `Employer ${n}`, title: `Nurse ${n}`, location: "Austin, TX, USA", country: "US",
  salary: null, applyUrl: `https://x/${n}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
const ROWS = [row(1), row(2), row(3)];
const httpError = (status: number, body: unknown) => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }) },
});

let answer: Answer = "no_resume_terms";
let fitCalls = 0;

function mount() {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-fit" && b.action === "fit-terms") return { data: { terms: [] }, error: null };
    if (fn === "job-fit" && b.action === "fit-batch") {
      fitCalls++;
      const ids = (b.ids as string[]) ?? [];
      if (answer === "limit") return httpError(429, { error: "rate_limited", message: "Hourly fit-scoring allowance of 30 reached.", limit: 30, window: "1h", rateLimited: true });
      if (answer === "failed") return httpError(546, { code: "WORKER_RESOURCE_LIMIT" });
      return { data: { fits: Object.fromEntries(ids.map((id) => [id, null])), unscored: Object.fromEntries(ids.map((id) => [id, answer])), missing: {}, matched: {} }, error: null };
    }
    if (fn !== "job-board") return { data: null, error: null };
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 3 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: ROWS, total: 3, totalAllCompanies: 3, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
  window.history.replaceState({}, "", "/jobs");
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const text = () => document.body.textContent ?? "";
const DESCRIPTIONS = "none of these postings has a description we can score yet";
/** The header once the scorer has been asked and its answer is on screen. */
async function headerAfter(a: Answer) {
  answer = a;
  mount();
  await waitFor(() => expect(text()).toContain("Nurse 1"), SLOW);
  await waitFor(() => expect(fitCalls, "the scorer was never asked").toBeGreaterThan(0), SLOW);
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  sessionStorage.setItem("rb_board_resume", RESUME);
  fitCalls = 0;
  invoke.mockReset();
  clearBoardBudgetRefusal();
});
afterEach(cleanup);

describe("the order caption over a page with nothing scored", () => {
  it("names the résumé when the scorer read no skill in it, and does not blame the postings", async () => {
    await headerAfter("no_resume_terms");
    await waitFor(() => expect(text()).toContain("not ranked — we recognised no skill or tool in your résumé"), SLOW);
    expect(text(), "the postings were blamed for a résumé the scorer could not read").not.toContain(DESCRIPTIONS);
  });

  it("names the allowance when the allowance is spent", async () => {
    await headerAfter("limit");
    await waitFor(() => expect(text()).toContain("not ranked yet — the fit-scoring allowance is used up for now"), SLOW);
    expect(text()).not.toContain(DESCRIPTIONS);
  });

  it("names the scorer when the scorer did not answer", async () => {
    await headerAfter("failed");
    await waitFor(() => expect(text()).toContain("not ranked — the scorer did not answer for these postings just now."), SLOW);
    expect(text()).not.toContain(DESCRIPTIONS);
  });

  it("control: keeps the description sentence when no posting has a description", async () => {
    await headerAfter("no_description");
    await waitFor(() => expect(text()).toContain(DESCRIPTIONS), SLOW);
    expect(text()).not.toContain("we recognised no skill or tool in your résumé, so there was nothing to score");
  });
});

describe("the rule the caption reads", () => {
  const cause = (JobsModule as unknown as {
    fitHeaderCause: (ids: string[], fits: Record<string, number | null>, why: Record<string, string | undefined>, heldOf: (id: string) => "limit" | "failed" | null) => string;
  }).fitHeaderCause;
  const none = () => null;

  it("one posting the résumé could not be scored against is enough to name the résumé", () => {
    expect(cause(["a", "b"], { a: null }, { a: "no_resume_terms" }, none)).toBe("resume");
  });

  it("an unanswered posting is still being scored, unless something is holding it", () => {
    expect(cause(["a", "b"], { a: null }, { a: "no_description" }, none)).toBe("scoring");
    expect(cause(["a", "b"], {}, {}, (id) => (id === "b" ? "limit" : null))).toBe("limit");
    expect(cause(["a", "b"], {}, {}, () => "failed")).toBe("failed");
    // One failed, one still out: still scoring. One failed, one held by the allowance: the allowance.
    expect(cause(["a", "b"], {}, {}, (id) => (id === "a" ? "failed" : null))).toBe("scoring");
    expect(cause(["a", "b"], {}, {}, (id) => (id === "a" ? "failed" : "limit"))).toBe("limit");
  });

  it("every posting answered: descriptions only when that is every posting's reason", () => {
    expect(cause(["a", "b"], { a: null, b: null }, { a: "no_description", b: "no_description" }, none)).toBe("descriptions");
    expect(cause(["a", "b"], { a: null, b: null }, { a: "no_description", b: "not_found" }, none)).toBe("descriptions");
    expect(cause(["a", "b"], { a: null, b: null }, { a: "no_description", b: "no_recognised_terms" }, none)).toBe("unreadable");
  });
});

describe("the new sentences, in every language", () => {
  const dir = resolve(__dirname, "../i18n/shards/board-ui");
  const read = (f: string) => (JSON.parse(readFileSync(resolve(dir, f), "utf8")) as { boardUi: Record<string, string> }).boardUi;
  const KEYS = ["orderFitNoResumeTerms", "orderFitScoring", "orderFitLimited", "orderFitFailed", "orderFitUnreadable"];

  it.each(["de", "es", "fr", "hi", "nl", "pt", "tl"])("%s holds each one, translated", (lng) => {
    const en = read("en.json"), own = read(`${lng}.json`);
    for (const k of KEYS) {
      expect(typeof own[k], `${lng}: ${k}`).toBe("string");
      expect(own[k], `${lng}: ${k} is the English copied across`).not.toBe(en[k]);
    }
  });

  it("British English says CV", () => {
    const gb = read("en-GB.json");
    for (const k of KEYS) expect(gb[k], k).not.toMatch(/r[ée]sum[ée]/i);
    expect(gb.orderFitNoResumeTerms).toContain("your CV");
  });
});
