/**
 * THE FREE REPORT OFFERS ONLY WHAT IS SOLD, AND SAYS WHAT IT DOES.
 *
 *   - Owner decision 2026-10-12: the free report extras (the elevator pitch,
 *     the recruiter view, the roast, the AI summary, the free Career Path) are
 *     no longer offered. They are not mounted, so no press on the report can
 *     ask their generators for anything.
 *   - Interview prep is a writing tool counted by account (one set a day on a
 *     free account; the server answers a signed-out caller 401). A signed-out
 *     reader is asked to sign in instead of being handed a tool the server
 *     refuses.
 *   - S12-009: the Full Analysis was sold as "applies the fixes from this
 *     report", but analyze-resume never receives this report: it is its own,
 *     deeper read of the résumé. The offer now says so.
 *   - Pro's line is the one summary every page reads (owner decision
 *     2026-10-17, src/config/pro-perks.ts): everything in a free account,
 *     plus the writing tools, the $5 Full Analysis included and no daily cap
 *     on scans.
 *   - The Full Analysis button shows only once the seller's legal name and
 *     postal address are on the site (owner decision 2026-10-17, B&P
 *     17538(d)); until then the report says purchases open soon.
 *   - Freelance Boost is no longer sold, so the platform-profile note names
 *     it nowhere and links to no page that sells it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const q = () => chain;
  Object.assign(chain, {
    select: q, eq: q, in: q, order: q, limit: q, gte: q, lte: q, insert: q, upsert: q, update: q,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: vi.fn(async () => ({ data: null, error: null })),
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
      auth: {
        getSession: async () => ({ data: { session: null } }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});

const auth = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
// The seller, as shipped (empty) or named by a test.
const seller = vi.hoisted(() => ({ legalName: "", postalAddress: "" }));
vi.mock("@/config/seller", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/config/seller")>();
  return { ...real, SELLER: seller, sellerIdentity: (x = seller) => real.sellerIdentity(x) };
});
vi.mock("@/contexts/AuthContext", async (orig) => {
  const real = await orig<typeof import("@/contexts/AuthContext")>();
  return { ...real, useAuth: () => ({ ...real.useAuth(), user: auth.user }) };
});

Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import { FreeKeywordResults } from "@/components/FreeKeywordResults";
import { supabase } from "@/integrations/supabase/client";
import { PRO_SUMMARY } from "@/config/pro-perks";

afterEach(() => { cleanup(); auth.user = null; seller.legalName = ""; seller.postalAddress = ""; });
const nameSeller = () => { seller.legalName = "Example Seller LLC"; seller.postalAddress = "1 Example Street, Springfield"; };

const tailor = vi.fn();

async function mount(extra: Record<string, unknown> = {}) {
  const utils = render(
    <MemoryRouter>
      <FreeKeywordResults
        industry="data_engineering"
        atsScoreEstimate={62}
        formatGrade="B"
        formatIssue="Minor spacing inconsistencies"
        resumeLength={"good" as never}
        candidateName="Jane Doe"
        currentRole="Senior Data Engineer"
        resumeText={"Jane Doe\nSenior Data Engineer\nBuilt pipelines with Airflow and Spark for 3 years.\n".repeat(4)}
        redFlags={[{ issue: "No metrics in bullets", impact: "Recruiters skip unquantified impact", severity: "critical" }] as never}
        keywords={[{ keyword: "airflow", reason: "Standard for the role", frequencyWeight: 3, suggestedSection: "skills" }] as never}
        quickWins={[{ fix: "Add pipeline throughput numbers", timeEstimate: "10 min", impact: "high", scoreImpact: 6, category: "quantification" }] as never}
        onGetFullAnalysis={vi.fn()}
        onGenerateTailoredResume={tailor}
        jobMatchScore={64}
        jobMatchGrade={"C" as never}
        matchingSkills={["Airflow"]}
        missingSkills={["dbt"]}
        {...extra}
      />
    </MemoryRouter>,
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return utils;
}

const CUT_GENERATORS = ["generate-summary", "generate-elevator-pitch", "generate-recruiter-view", "generate-resume-roast", "generate-career-path"];

describe("the free report extras are not offered", () => {
  it("none of their sections is mounted, and none of their generators is asked for anything", async () => {
    const invoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;
    invoke.mockClear();
    const { container } = await mount();
    for (const id of ["elevator-pitch", "recruiter-view", "resume-roast", "career-path"]) {
      expect(container.querySelector(`#${id}`), id).toBeNull();
    }
    expect(invoke.mock.calls.map(([fn]) => fn).filter((fn) => CUT_GENERATORS.includes(fn))).toEqual([]);
  });
});

describe("interview prep is counted by account", () => {
  it("signed out, the section asks the reader to sign in", async () => {
    const { container } = await mount();
    const section = container.querySelector("#interview-coach");
    expect(section).not.toBeNull();
    const card = section!.querySelector('[data-testid="interview-prep-sign-in"]');
    expect(card).not.toBeNull();
    expect(card!.querySelector('a[href^="/auth"]')).not.toBeNull();
  });

  it("signed in, the tool itself is mounted", async () => {
    auth.user = { id: "4f9a3c2e-1b7d-4e8a-9c0f-2a6b5d4e3f21", email: "free@example.com" };
    const { container } = await mount();
    const section = container.querySelector("#interview-coach");
    expect(section).not.toBeNull();
    expect(section!.querySelector('[data-testid="interview-prep-sign-in"]')).toBeNull();
  });
});

describe("the tailored résumé is counted by account", () => {
  it("signed out, the job-match block asks the reader to sign in instead of offering the button", async () => {
    tailor.mockClear();
    const { container, queryByRole } = await mount();
    const link = container.querySelector('[data-testid="tailored-resume-sign-in"]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toMatch(/^\/auth/);
    expect(queryByRole("button", { name: /generate tailored resume/i })).toBeNull();
  });

  it("signed in, the button is there and calls the generator", async () => {
    auth.user = { id: "4f9a3c2e-1b7d-4e8a-9c0f-2a6b5d4e3f21", email: "free@example.com" };
    tailor.mockClear();
    const { container, getByRole } = await mount();
    expect(container.querySelector('[data-testid="tailored-resume-sign-in"]')).toBeNull();
    getByRole("button", { name: /generate tailored resume/i }).click();
    expect(tailor).toHaveBeenCalledTimes(1);
  });
});

describe("the two offers say what they are", () => {
  it("the Full Analysis is its own analysis, never 'the fixes from this report'", async () => {
    nameSeller();
    const { getByTestId } = await mount();
    const full = getByTestId("report-next-steps").querySelector('[data-offer="fullAnalysis"]')!;
    expect(full.textContent).toMatch(/separate, deeper analysis of your résumé/);
    expect(full.textContent).not.toMatch(/fixes from this report/i);
  });

  it("Pro's line is the one summary every page reads", async () => {
    const { getByTestId } = await mount();
    const pro = getByTestId("report-next-steps").querySelector('[data-offer="pro"]')!;
    expect(pro.textContent).toContain(PRO_SUMMARY.text);
    expect(pro.textContent).toContain("Everything in a free account, plus the writing tools");
    expect(pro.textContent).not.toMatch(/every paid tool|unlimited/i);
  });
});

describe("no buy button until the seller is named", () => {
  it("with no seller named, the report offers no Full Analysis button and says purchases open soon", async () => {
    const { getByTestId } = await mount();
    const steps = getByTestId("report-next-steps");
    expect(steps.querySelector('[data-offer="fullAnalysis"]')).toBeNull();
    expect(steps.querySelector("[data-purchases-open-soon]")).not.toBeNull();
    // Pro's row stays: it opens /pricing, which gates its own button.
    expect(steps.querySelector('[data-offer="pro"]')).not.toBeNull();
  });

  it("control: with a seller named, the button is back and the line is gone", async () => {
    nameSeller();
    const { getByTestId } = await mount();
    const steps = getByTestId("report-next-steps");
    expect(steps.querySelector('[data-offer="fullAnalysis"]')).not.toBeNull();
    expect(steps.querySelector("[data-purchases-open-soon]")).toBeNull();
  });

  // Wave 4 round 2 review (money lens): a Pro member's included analysis is
  // not a sale (create-checkout mints it before its seller gate), but every
  // surface hid it and the page refused before asking the server.
  it("a paid Pro member is offered the included analysis, unpriced, while purchases are closed", async () => {
    const run = vi.fn();
    const { getByTestId } = await mount({ proIncludesAnalysis: true, onGetFullAnalysis: run });
    const steps = getByTestId("report-next-steps");
    expect(steps.querySelector('[data-offer="fullAnalysis"]'), "nothing is priced").toBeNull();
    const included = steps.querySelector('[data-offer="fullAnalysisIncluded"]') as HTMLButtonElement | null;
    expect(included).not.toBeNull();
    expect(included!.textContent).toMatch(/Included with your Pro plan/);
    expect(included!.textContent).not.toMatch(/\$\d/);
    expect(steps.querySelector("[data-purchases-open-soon]")).toBeNull();
    await act(async () => { included!.click(); });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("the page asks the server for an included analysis instead of refusing first", () => {
    const page = readFileSync(resolve(__dirname, "../pages/Index.tsx"), "utf8");
    expect(page).toMatch(/const proIncludesAnalysis = proPlan\.active && !proPlan\.trialing;/);
    expect(page).toMatch(/if \(!purchasesOpen\(\) && !proIncludesAnalysis\) \{/);
    expect(page).toMatch(/proIncludesAnalysis=\{proIncludesAnalysis\}/);
    const fn = readFileSync(resolve(__dirname, "../../supabase/functions/create-checkout/index.ts"), "utf8");
    expect(fn.indexOf('.from("pro_grants")'), "the grant is minted before the seller gate").toBeLessThan(fn.indexOf("const closed = sellerGate("));
  });
});

describe("a platform profile is told what it is, and sold nothing", () => {
  it("the note names no Freelance Boost and links to no page selling it", async () => {
    const { container } = await mount({ platformProfileDetected: { signals: ["Upwork", "Job Success Score", "hourly rate"] } });
    expect(container.textContent).toMatch(/freelance platform profile, not a resume/);
    expect(container.textContent).not.toMatch(/Freelance Boost/);
    expect(container.querySelector('a[href="/freelance-boost"]')).toBeNull();
  });
});
