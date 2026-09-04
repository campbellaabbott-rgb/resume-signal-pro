// A 546 RENDERED AS A FIT-RANKED LIST.
//
// 2026-09-03 moved the scorer into its own function (job-fit), and the pin in
// the-scorer-in-its-own-isolate declared "the site calls job-fit" — counting
// only Jobs.tsx. The report's LiveMatches was never moved. Three consequences
// on the free scan report and the post-purchase page, read from the source:
//   (a) it sent thirty ids in one call against a server cap of twenty, so ids
//       21-30 were never scored and the sort pushed them under every scored
//       row — a third of the candidate set could never reach the "top 5";
//   (b) it destructured only `{ data }`, so a 546 WORKER_RESOURCE_LIMIT (or a
//       429/500 body) left `fits` as {}, every fit null, `failed` unset, and
//       the first five rows in list order were presented as "top matches for
//       THIS resume, fit-ranked";
//   (c) it still scored through job-board — the co-tenant copy whose worker
//       pool exhaustion motivated the move.
// Pinned here against comment-stripped source AND behaviourally with the
// board mocked: the scorer is job-fit, twenty ids a call, and a batch that
// comes back without `fits` is reported in the board page's own words — never
// ranked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { LiveMatches } from "../components/LiveMatches";

const ROOT = resolve(__dirname, "../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const LIVE = strip(readFileSync(resolve(ROOT, "src/components/LiveMatches.tsx"), "utf8"));

type Call = { fn: string; body: Record<string, unknown> };
const calls = (): Call[] => invoke.mock.calls.map((c) => ({ fn: c[0] as string, body: (c[1] as { body?: Record<string, unknown> } | undefined)?.body ?? {} }));
const fitCalls = () => calls().filter((c) => c.body.action === "fit-batch");

// Thirty candidates — what the list call asks for (limit: 30) and more than
// the server scores in one call. The best fit sits at position 25, inside the
// batch the old single call never scored.
const THIRTY = Array.from({ length: 30 }, (_, i) => ({
  id: `j${i + 1}`, company: `Employer ${i + 1}`, title: `Role ${i + 1}`, location: "Remote", salary: null, applyUrl: `https://x/${i + 1}`,
}));
const FIT_OF = (id: string) => (id === "j25" ? 90 : id === "j3" ? 40 : 10);
const RESUME = "registered nurse ".repeat(20);

type FitAnswer = { data: unknown; error?: unknown };
function boardMock(fit: (ids: string[], nth: number) => FitAnswer) {
  let nth = 0;
  invoke.mockImplementation(async (fn: string, opts: { body?: Record<string, unknown> } | undefined) => {
    const action = opts?.body?.action;
    if (fn === "job-board" && action === "list") return { data: { jobs: THIRTY } };
    if (fn === "job-board" && action === "verify") return { data: { live: {} } };
    if (fn === "job-fit" && action === "fit-batch") return fit(opts!.body!.ids as string[], nth++);
    throw new Error(`unexpected invoke ${fn} ${String(action)}`);
  });
}
const scored = (ids: string[]): FitAnswer => ({ data: { fits: Object.fromEntries(ids.map((id) => [id, FIT_OF(id)])), missing: {}, matched: {} } });
const mount = () => render(<MemoryRouter><LiveMatches resumeText={RESUME} industry="healthcare" /></MemoryRouter>);

describe("a 546 rendered as a fit-ranked list", () => {
  // Braces on purpose: mockReset() returns the mock, and a function returned
  // from beforeEach is registered by vitest as a cleanup hook — which then
  // called invoke() with no arguments into the strict mock below.
  beforeEach(() => { invoke.mockReset(); });

  it("scores through job-fit, and no fit action of any kind targets the ingest function", () => {
    expect(LIVE).toMatch(/functions\.invoke\("job-fit",\s*\{\s*body:\s*\{\s*action:\s*"fit-batch"/);
    expect(LIVE, "no fit call may still target the ingest function").not.toMatch(/invoke\("job-board",\s*\{\s*body:\s*\{\s*action:\s*"fit-(batch|terms)"/);
    // Every fit action literal, wherever it sits, is inside a job-fit invoke —
    // a body built in a variable and handed to job-board would fail this too.
    const fitActions = [...LIVE.matchAll(/action:\s*"fit-(?:batch|terms)"/g)];
    expect(fitActions.length).toBeGreaterThan(0);
    for (const m of fitActions) {
      expect(LIVE.slice(Math.max(0, (m.index ?? 0) - 120), m.index), "a fit action outside a job-fit invoke").toMatch(/invoke\("job-fit"/);
    }
    // And the ingest function is asked only for what it is for.
    for (const m of LIVE.matchAll(/action:\s*"([^"]+)"/g)) expect(["list", "verify", "fit-batch"]).toContain(m[1]);
  });

  it("batches twenty ids a call — the server's cap — never the whole candidate set", () => {
    expect(LIVE).toMatch(/const FIT_BATCH = 20;/);
    expect(LIVE).toMatch(/i \+= FIT_BATCH\)/);
    expect(LIVE).toMatch(/jobs\.slice\(i, i \+ FIT_BATCH\)/);
    expect(LIVE, "the whole list in one call is the thirty-against-twenty bug").not.toMatch(/ids: jobs\.map\(/);
    const FIT = strip(readFileSync(resolve(ROOT, "supabase/functions/job-fit/index.ts"), "utf8"));
    expect(FIT, "the client constant mirrors the server cap").toMatch(/const FIT_BATCH_MAX = 20;/);
  });

  it("a batch without `fits` — transport error or a 2xx error body — is counted, not ranked", () => {
    expect(LIVE).toMatch(/const \{ data, error \} = await supabase\.functions\.invoke\("job-fit"/);
    expect(LIVE).toMatch(/if \(error \|\| !payload\?\.fits\)/);
    expect(LIVE).toMatch(/fitFailed \+= ids\.length;/);
    expect(LIVE, "a row no scorer call answered for cannot be in a fit-ranked list").toMatch(/\.filter\(\(j\) => String\(j\.id\) in fits\)/);
    expect(LIVE, "the board page's own words, not a silent fallback").toMatch(/t\("jobsPage\.fitFailedNote"/);
    expect(LIVE).toMatch(/t\("jobsPage\.fitRetry"/);
    expect(LIVE, "an empty list with unscored candidates must not fall to the count-free CTA").toMatch(/matches\.length === 0 && fitFailedCount === 0/);
  });

  it("the reused copy exists in all nine locales", () => {
    const dir = resolve(ROOT, "src/i18n/locales");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(9);
    for (const f of files) {
      const j = JSON.parse(readFileSync(resolve(dir, f), "utf8")) as { jobsPage?: Record<string, unknown> };
      expect(typeof j.jobsPage?.fitFailedNote, `${f}: jobsPage.fitFailedNote`).toBe("string");
      expect(String(j.jobsPage?.fitFailedNote), `${f}: the count is interpolated`).toContain("{{n}}");
      expect(typeof j.jobsPage?.fitRetry, `${f}: jobsPage.fitRetry`).toBe("string");
    }
  });

  it("behaviour: thirty candidates reach job-fit as 20 + 10, and a posting from the second batch can top the list", async () => {
    boardMock((ids) => scored(ids));
    mount();
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBe(5));
    const fits = fitCalls();
    expect(fits.map((c) => c.fn)).toEqual(["job-fit", "job-fit"]);
    expect(fits.map((c) => (c.body.ids as string[]).length)).toEqual([20, 10]);
    expect(calls().filter((c) => c.fn === "job-board").map((c) => c.body.action)).toEqual(["list", "verify"]);
    const top = screen.getAllByRole("listitem")[0].textContent ?? "";
    expect(top).toContain("Employer 25");
    expect(top).toContain("fit 90%");
  });

  it("behaviour: a 2xx body without `fits` renders no list, says what was not scored, and offers a retry", async () => {
    boardMock(() => ({ data: { code: "WORKER_RESOURCE_LIMIT", message: "Function failed due to not having enough compute resources" } }));
    mount();
    await screen.findByText(/30 postings could not be scored just now/);
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.queryByText(/fit \d+%/)).toBeNull();
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
    // Not the count-free fallback either: the reader is told, not shrugged at.
    expect(screen.queryByRole("link", { name: /Open the live job board/i })).toBeNull();
  });

  it("behaviour: a transport error is the same honest state", async () => {
    boardMock(() => ({ data: null, error: { message: "546 WORKER_RESOURCE_LIMIT" } }));
    mount();
    await screen.findByText(/30 postings could not be scored just now/);
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.queryByText(/fit \d+%/)).toBeNull();
  });

  it("behaviour: when one of two batches fails, only scored rows are ranked and the note counts the other ten", async () => {
    boardMock((ids, nth) => (nth === 0 ? scored(ids) : { data: null, error: { message: "546" } }));
    mount();
    await screen.findByText(/10 postings could not be scored just now/);
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(5);
    // j25 sits in the failed batch and must not appear; the best scored row is j3.
    expect(items[0].textContent).toContain("Employer 3");
    for (const li of items) expect(li.textContent).not.toMatch(/Employer (2[1-9]|30)\b/);
  });

  it("behaviour: Try again re-scores, and a batch that failed once can succeed", async () => {
    boardMock((ids, nth) => (nth < 2 ? { data: { code: "WORKER_RESOURCE_LIMIT" } } : scored(ids)));
    mount();
    const retry = await screen.findByRole("button", { name: /Try again/i });
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBe(5));
    expect(screen.queryByText(/could not be scored just now/)).toBeNull();
    expect(fitCalls().length).toBe(4);
  });
});
