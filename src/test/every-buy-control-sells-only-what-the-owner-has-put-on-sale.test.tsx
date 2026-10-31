/**
 * EVERY BUY CONTROL SELLS ONLY WHAT THE OWNER HAS PUT ON SALE (homepage and
 * pricing spec of 2026-10-17, gates G2 and G2b; review of hp/scanner and
 * hp/honesty, 2026-10-25; sales stay on, the owner, 2026-10-27).
 *
 * G2 and G2b are the owner's switches in src/config/sales-gate.ts:
 * FULL_ANALYSIS_ON_SALE and PRO_ON_SALE, both on, as on main. Only the
 * uploader read G2 once; the free report, the sticky bar, the comparison
 * table, the closing call to action and the Pro card read the seller's name
 * alone. Every buy control now reads fullAnalysisOnSale() (G2) or proOnSale()
 * (G2b) from src/lib/purchases-open.ts, and none reads the seller: with
 * src/config/seller.ts empty, as shipped, everything main sells is on sale.
 * The Pro card leaves out the included Full Analysis, in its list and its
 * summary, only while G2 is off (as the pricing card does). Index's checkout
 * handler reads no switch: the checkouts sell what main sells.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

const seller = vi.hoisted(() => ({ legalName: "", postalAddress: "" }));
const gate = vi.hoisted(() => ({ fa: true, pro: true }));
vi.mock("@/config/seller", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/config/seller")>();
  return { ...real, SELLER: seller, sellerIdentity: (x = seller) => real.sellerIdentity(x) };
});
vi.mock("@/config/sales-gate", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    get FULL_ANALYSIS_ON_SALE() { return gate.fa; },
    get PRO_ON_SALE() { return gate.pro; },
  };
});
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
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});
vi.mock("@/hooks/use-pro-subscription", () => ({
  useProSubscription: () => ({
    pro: { active: false, status: null, currentPeriodEnd: null, loading: false, trialing: false, linkPending: false, cancelAtPeriodEnd: false, planTier: null },
    subscribe: vi.fn(), manage: vi.fn(), actionLoading: false, knownEmail: null, refresh: vi.fn(), justSubscribed: false, notConfirmedYet: false,
  }),
}));

Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import { StickyBottomCTA } from "@/components/StickyBottomCTA";
import { ComparisonTable } from "@/components/ComparisonTable";
import { FinalCTA } from "@/components/FinalCTA";
import { FreeKeywordResults } from "@/components/FreeKeywordResults";
import { ProSubscriptionCard } from "@/components/ProSubscriptionCard";
import { HelmetProvider } from "react-helmet-async";
import PricingPage from "@/pages/pricing/PricingPage";
import { resolveSaleGates } from "@/components/pricing/sale-gates";
import { PRODUCTS } from "@/config/products";
import { fullAnalysisOnSale, proOnSale } from "@/lib/purchases-open";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(() => {
  cleanup();
  seller.legalName = "";
  seller.postalAddress = "";
  gate.fa = true;
  gate.pro = true;
});
const nameSeller = () => { seller.legalName = "Example Seller LLC"; seller.postalAddress = "1 Example Street, Springfield"; };
const PRICE = new RegExp(`\\$\\s?${PRODUCTS.fullAnalysis.priceUsd}(?!\\d)`);

function sticky() {
  const view = render(<MemoryRouter><StickyBottomCTA /></MemoryRouter>);
  act(() => {
    Object.defineProperty(window, "scrollY", { value: 900, configurable: true });
    window.dispatchEvent(new Event("scroll"));
  });
  return view.container;
}
async function report() {
  render(
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
        onGenerateTailoredResume={vi.fn()}
        jobMatchScore={64}
        jobMatchGrade={"C" as never}
        matchingSkills={["Airflow"]}
        missingSkills={["dbt"]}
      />
    </MemoryRouter>,
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return screen.getByTestId("report-next-steps");
}
const proCard = () => render(<MemoryRouter><ProSubscriptionCard /></MemoryRouter>).container.querySelector("[data-pro-card]") as HTMLElement;
const INCLUDED = /Full Analysis included/;

describe("the gates themselves", () => {
  it("fullAnalysisOnSale is G2 and proOnSale is G2b, and the seller changes neither", () => {
    expect([fullAnalysisOnSale(), proOnSale()], "as shipped: both on, no seller named").toEqual([true, true]);
    for (const named of [false, true]) {
      if (named) nameSeller();
      for (const fa of [false, true]) for (const pro of [false, true]) {
        gate.fa = fa;
        gate.pro = pro;
        expect([fullAnalysisOnSale(), proOnSale()], `seller ${named}, G2 ${fa}, G2b ${pro}`).toEqual([fa, pro]);
      }
    }
  });
});

describe("as shipped, with no seller named: every control sells, as on main", () => {
  it("the bar, the table, the closing call to action, the report and the Pro card", async () => {
    expect(seller).toEqual({ legalName: "", postalAddress: "" });
    expect(sticky().textContent).toMatch(PRICE);
    cleanup();
    render(<MemoryRouter><ComparisonTable /><FinalCTA onGetStarted={vi.fn()} isLoading={false} /></MemoryRouter>);
    expect(document.querySelector("[data-comparison-closed]")).toBeNull();
    expect(document.querySelector("[data-final-cta-closed]")).toBeNull();
    expect(screen.queryAllByRole("button").filter((b) => PRICE.test(b.textContent ?? "")).length).toBeGreaterThan(0);
    expect(document.body.textContent ?? "").toMatch(PRICE);
    cleanup();
    const steps = await report();
    expect(steps.querySelector('[data-offer="fullAnalysis"]')).not.toBeNull();
    expect(steps.querySelector("[data-testid='purchase-terms']")).not.toBeNull();
    cleanup();
    const card = proCard();
    expect(screen.getByRole("button", { name: /Go Pro/ })).not.toBeNull();
    expect(card.textContent).toMatch(INCLUDED);
    expect(document.body.textContent ?? "").not.toMatch(/open soon/i);
  });
});

describe("G2 and G2b off: nothing priced anywhere on the scanner or the Pro card", () => {
  const off = () => { gate.fa = false; gate.pro = false; };

  it("the sticky bar does not show", () => {
    off();
    expect(sticky().textContent).toBe("");
  });

  it("the comparison table and the closing call to action offer the free scan, with no price on a button", () => {
    off();
    render(<MemoryRouter><ComparisonTable /><FinalCTA onGetStarted={vi.fn()} isLoading={false} /></MemoryRouter>);
    expect(document.querySelector("[data-comparison-closed]")).not.toBeNull();
    expect(document.querySelector("[data-final-cta-closed]")).not.toBeNull();
    expect(screen.queryAllByRole("button").filter((b) => PRICE.test(b.textContent ?? ""))).toEqual([]);
    expect(document.body.textContent ?? "").not.toMatch(/open soon/i);
  });

  it("the free report offers no Full Analysis button and no purchase terms", async () => {
    off();
    const steps = await report();
    expect(steps.querySelector('[data-offer="fullAnalysis"]')).toBeNull();
    expect(steps.querySelector("[data-testid='purchase-terms']")).toBeNull();
  });

  it("the Pro card offers no Go Pro and promises no included Full Analysis", () => {
    off();
    const card = proCard();
    expect(screen.queryByRole("button", { name: /Go Pro/ })).toBeNull();
    expect(card.textContent).not.toMatch(INCLUDED);
    expect(card.textContent ?? "").not.toMatch(/open soon/i);
  });

  it("G2b on, G2 off: Pro is sold, without the Full Analysis among its perks", () => {
    gate.fa = false;
    const card = proCard();
    expect(screen.getByRole("button", { name: /Go Pro/ })).not.toBeNull();
    expect(card.textContent).not.toMatch(INCLUDED);
    expect(card.textContent).toMatch(/writing tools/);
  });
});

/**
 * The rebuilt /pricing (the homepage switch-over) resolves its own gates, so
 * it can give each switched-off card its reason (the delivery, the watched
 * subscription); it reads the same switches, and sells exactly what
 * fullAnalysisOnSale() and proOnSale() say, seller named or not.
 */
describe("the rebuilt /pricing sells what fullAnalysisOnSale() and proOnSale() say", () => {
  const pricing = () => {
    render(<HelmetProvider><MemoryRouter initialEntries={["/pricing"]}><PricingPage /></MemoryRouter></HelmetProvider>);
    return [...document.querySelectorAll("[data-buy]")].map((b) => b.getAttribute("data-buy")).sort();
  };

  it("its gates agree with src/lib/purchases-open.ts in every state of the seller and the switches", () => {
    for (const named of [false, true]) for (const fa of [false, true]) for (const pro of [false, true]) {
      seller.legalName = named ? "Example Seller LLC" : "";
      seller.postalAddress = named ? "1 Example Street, Springfield" : "";
      gate.fa = fa;
      gate.pro = pro;
      const g = resolveSaleGates();
      expect([g.fullAnalysis.onSale, g.pro.onSale], `seller ${named}, G2 ${fa}, G2b ${pro}`).toEqual([fullAnalysisOnSale(), proOnSale()]);
    }
  });

  it("as shipped, no seller named: both are sold, and no card prints a gate note", () => {
    expect(pricing()).toEqual(["full-analysis", "pro"]);
    expect(document.querySelector("[data-gate]")).toBeNull();
  });

  it("both switches off: no buy control, each card says why", () => {
    gate.fa = false;
    gate.pro = false;
    expect(pricing()).toEqual([]);
    expect(document.querySelector("[data-plan='full-analysis'] [data-gate='delivery']")).not.toBeNull();
    expect(document.querySelector("[data-plan='pro'] [data-gate='watched']")).not.toBeNull();
    expect(document.querySelector("[data-plan='pro']")?.textContent).not.toMatch(INCLUDED);
  });

  it("G2b on, G2 off: Pro is sold without the Full Analysis among its perks, and the Full Analysis is not", () => {
    gate.fa = false;
    expect(pricing()).toEqual(["pro"]);
    expect(document.querySelector("[data-plan='pro']")?.textContent).not.toMatch(INCLUDED);
  });

  it("control: a named seller changes nothing", () => {
    nameSeller();
    expect(pricing()).toEqual(["full-analysis", "pro"]);
  });
});

describe("no buy control reads the seller", () => {
  const ROOT = resolve(__dirname, "../..");
  const SRC = resolve(ROOT, "src");
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return name === "test" ? [] : walk(p);
      return /\.(tsx?|jsx?)$/.test(name) ? [p] : [];
    });
  }

  it("no source calls purchasesOpen(), and src/lib/purchases-open.ts reads no seller", () => {
    const callers = walk(SRC)
      .filter((p) => /\bpurchasesOpen\s*\(/.test(strip(readFileSync(p, "utf8"))))
      .map((p) => relative(ROOT, p));
    expect(callers).toEqual([]);
    expect(strip(readFileSync(resolve(SRC, "lib/purchases-open.ts"), "utf8"))).not.toMatch(/seller/i);
  });

  it("each control reads its product's switch", () => {
    const read = (p: string) => strip(readFileSync(resolve(ROOT, p), "utf8"));
    for (const p of [
      "src/components/FreeKeywordResults.tsx",
      "src/components/StickyBottomCTA.tsx",
      "src/components/ComparisonTable.tsx",
      "src/components/FinalCTA.tsx",
      "src/components/ResumeUploader.tsx",
    ]) expect(read(p), p).toMatch(/\bfullAnalysisOnSale\(\)/);
    expect(read("src/components/ProSubscriptionCard.tsx")).toMatch(/\bproOnSale\(\)/);
    // Index's checkout handler reads no switch and no seller: the checkouts sell what main sells.
    expect(read("src/pages/Index.tsx")).not.toMatch(/fullAnalysisOnSale|purchasesOpen|proIncludesAnalysis/);
  });
});
