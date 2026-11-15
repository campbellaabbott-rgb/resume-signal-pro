/**
 * A PAGE THE EMPLOYER CLOSED STAYS CLOSED WHEN THE PAGE HYDRATES (SEO/GEO
 * audit 2026-11-07, B01; the fix round of 2026-11-08).
 *
 * When the bake finds a posting closed at the employer's own system it writes
 * the noindex "no longer listed" page with no job markup. The board still
 * serves the row (it reads its stored row, not the employer), so the React
 * page, which read only ldTypes, indexable, the canonical and the employer's
 * statements from the baked head, rendered the posting as live with its Apply
 * link over the bake's "no longer listed" head. A crawler was safe (noindex,
 * no markup); a person arriving from an old search result was shown a closed
 * posting as open.
 *
 * The bake now writes the closure into the head (POSTING_CLOSED_META), the
 * baked-head reader hands it on, and the page renders the gone view saying
 * the employer's own system no longer serves the posting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [], error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = () => th;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import JobPosting from "@/pages/JobPosting";
import * as postingPage from "@/components/jobs/posting-page";
import * as companyDisplay from "@/lib/company-display";
import { POSTING_LD_TAG_ID, postingPagePath, type PostingRow } from "@/components/jobs/posting-page";
import { bakedHead, resetBakedHeadForTests } from "@/components/seo/baked-head";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { POSTING_CLOSED_META } from "../../scripts/employer-statements.mjs";
import { composeHtml, employerClosedStub } from "../../scripts/prerender-seo.mjs";
import { postingStubPage } from "../../scripts/prerender-pages.mjs";

vi.setConfig(MOUNT_TEST_BUDGET);

const ROOT = resolve(__dirname, "../..");
const SITE = "https://resumebooster.work";
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const DESC = "We are hiring a registered nurse for our medical-surgical unit, working beside physicians and therapists every shift. ".repeat(5);
const D = { ...companyDisplay, ...postingPage };
const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const OPTS = { template: readFileSync(resolve(ROOT, "index.html"), "utf8"), D: { POSTING_LD_TAG_ID }, esc, shell: (c: string) => c, preloadFor: () => "", publicHref: (p: string) => p, onTruncated: () => {} };
const CLOSED_BODY = /the employer's own hiring system answered that it no longer serves this posting/;

const row = (over: Partial<PostingRow> = {}): PostingRow => ({
  id: "workday:sanford~wd5~SanfordHealth:R-0278723",
  title: "Registered Nurse",
  company: "Sanford Health",
  token: "sanford~wd5~SanfordHealth",
  source: "workday",
  location: "Sioux Falls, SD",
  country: "US",
  workMode: null,
  postedAt: ago(3),
  missingSince: null,
  applyUrl: "https://sanford.wd5.myworkdayjobs.com/en-US/SanfordHealth/job/SD-Sioux-Falls/Registered-Nurse_R-0278723",
  salary: null,
  agency: false,
  ...over,
});

/** The stub page the bake writes, as a whole file. */
const stubFile = (basis: "employer" | null) => {
  const job = row();
  const stub = basis ? employerClosedStub(job, D) : { id: job.id, path: postingPagePath(job.id)!, state: "gone", title: job.title, company: job.company };
  return composeHtml(postingStubPage({ ...stub, since: "2026-11-08", windowDays: 30, esc, companyLink: "" }), OPTS);
};

describe("the bake writes an employer's closure into the stub's head", () => {
  it("a page the employer closed carries the closure, and a page the board took down does not", () => {
    expect(stubFile("employer")).toContain(`<meta name="${POSTING_CLOSED_META}" content="employer" />`);
    expect(stubFile(null)).not.toContain(POSTING_CLOSED_META);
  });
});

describe("the React page keeps an employer's closure the bake recorded", () => {
  /** jsdom's head as the bake wrote it, at the posting's own address. */
  function loadBaked(html: string) {
    const path = postingPagePath(row().id)!;
    window.history.replaceState({}, "", path);
    document.head.innerHTML = /<head>([\s\S]*?)<\/head>/.exec(html)![1];
    resetBakedHeadForTests();
  }
  function mount() {
    invoke.mockImplementation(async (fn: string, a: { body?: { action?: string } } | undefined) =>
      fn === "job-board" && a?.body?.action === "detail" ? { data: { job: row(), description: DESC }, error: null } : { data: [], error: null },
    );
    return render(
      <HelmetProvider>
        <MemoryRouter initialEntries={[postingPagePath(row().id)!]}>
          <Routes><Route path="/jobs/posting/:source/:token/:key" element={<JobPosting />} /></Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );
  }

  beforeEach(() => { invoke.mockReset(); clearBoardBudgetRefusal(); });
  afterEach(() => { cleanup(); clearBoardBudgetRefusal(); document.head.innerHTML = ""; resetBakedHeadForTests(); window.history.replaceState({}, "", "/"); });

  it("the baked head says the employer closed it", () => {
    loadBaked(stubFile("employer"));
    expect(bakedHead()?.postingClosed).toBe("employer");
    loadBaked(stubFile(null));
    expect(bakedHead()?.postingClosed).toBeNull();
  });

  it("renders the gone view naming the employer's own system, with no apply link and no job markup, though the board serves the row", async () => {
    loadBaked(stubFile("employer"));
    const { container } = mount();
    await screen.findByRole("heading", { level: 1, name: "This posting is no longer live" }, SLOW);
    expect(container.textContent).toMatch(CLOSED_BODY);
    expect(container.textContent).not.toContain(DESC.slice(0, 40));
    expect(container.querySelector(`a[href^="https://sanford.wd5.myworkdayjobs.com"]`)).toBeNull();
    const jobBlocks = [...document.head.querySelectorAll('script[type="application/ld+json"]')].filter((s) => /"JobPosting"/.test(s.textContent ?? ""));
    expect(jobBlocks).toEqual([]);
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toMatch(/^noindex/);
    // The closure is the bake's answer: no board read is spent on it.
    expect(invoke.mock.calls.filter(([fn]) => fn === "job-board")).toEqual([]);
  });

  it("negative control: a page the board took down, which the board serves again, renders the posting", async () => {
    loadBaked(stubFile(null));
    const { container } = mount();
    await screen.findByRole("heading", { level: 1, name: "Registered Nurse" }, SLOW);
    expect(container.textContent).not.toMatch(CLOSED_BODY);
  });
});
