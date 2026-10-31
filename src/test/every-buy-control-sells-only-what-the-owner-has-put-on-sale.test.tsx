/**
 * EVERY BUY CONTROL SELLS ONLY WHAT THE OWNER HAS PUT ON SALE (homepage and
 * pricing spec of 2026-10-17, gates G1, G2 and G2b; review of hp/scanner and
 * hp/honesty, 2026-10-25).
 *
 * G1 is the seller's name (src/config/seller.ts, purchasesOpen()). G2 and G2b
 * are the owner's switches in src/config/sales-gate.ts: FULL_ANALYSIS_ON_SALE
 * opens once one real purchase was watched to its delivered report,
 * PRO_ON_SALE once one Pro subscription was watched to its cancellation.
 * Only the uploader read G2; the free report, the sticky bar, the comparison
 * table, the closing call to action, the old pricing page, Index's checkout
 * handler and the Pro card read G1 alone. So the day the owner named the
 * seller with G2 still closed, the uploader would have said purchases open
 * soon while the report under it, the bar and the table sold the $5 Full
 * Analysis, and the Pro card sold Pro with the Full Analysis "included".
 *
 * Every buy control now reads fullAnalysisOnSale() (G1 and G2) or proOnSale()
 * (G1 and G2b) from src/lib/purchases-open.ts, and nothing outside that file
 * calls purchasesOpen() itself. The Pro card also leaves out the included
 * Full Analysis, in its list and its summary, while G2 is closed: Pro never
 * promises a report nobody has seen delivered (as the pricing card does).
 * Index's handler keeps the one exception it had: a Pro member's included
 * analysis is not a sale.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

const seller = vi.hoisted(() => ({ legalName: "", postalAddress: "" }));
const gate = vi.hoisted(() => ({ fa: false, pro: false }));
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
vi.mock("@/lib/checkout-territory", () => ({ inSalesTerritory: () => false, territoryHint: () => ({}), buyerTimeZone: () => "" }));
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
  gate.fa = false;
  gate.pro = false;
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
  it("fullAnalysisOnSale needs the seller and G2; proOnSale needs the seller and G2b", () => {
    expect([fullAnalysisOnSale(), proOnSale()]).toEqual([false, false]);
    nameSeller();
    expect([fullAnalysisOnSale(), proOnSale()], "a named seller alone").toEqual([false, false]);
    gate.fa = true;
    expect([fullAnalysisOnSale(), proOnSale()]).toEqual([true, false]);
    gate.pro = true;
    expect([fullAnalysisOnSale(), proOnSale()]).toEqual([true, true]);
    seller.legalName = "";
    expect([fullAnalysisOnSale(), proOnSale()], "the switches alone").toEqual([false, false]);
  });
});

describe("a named seller with G2 and G2b closed: nothing priced anywhere on the scanner or the Pro card", () => {
  it("the sticky bar does not show", () => {
    nameSeller();
    expect(sticky().textContent).toBe("");
  });

  it("the comparison table and the closing call to action say purchases open soon, with no price on a button", () => {
    nameSeller();
    render(<MemoryRouter><ComparisonTable /><FinalCTA onGetStarted={vi.fn()} isLoading={false} /></MemoryRouter>);
    expect(document.querySelector("[data-comparison-closed]")).not.toBeNull();
    expect(document.querySelector("[data-final-cta-closed]")).not.toBeNull();
    expect(screen.queryAllByRole("button").filter((b) => PRICE.test(b.textContent ?? ""))).toEqual([]);
  });

  it("the free report offers no Full Analysis button and no purchase terms", async () => {
    nameSeller();
    const steps = await report();
    expect(steps.querySelector('[data-offer="fullAnalysis"]')).toBeNull();
    expect(steps.querySelector("[data-testid='purchase-terms']")).toBeNull();
    expect(steps.querySelector("[data-purchases-open-soon]")).not.toBeNull();
  });

  it("the Pro card offers no Go Pro and promises no included Full Analysis", () => {
    nameSeller();
    const card = proCard();
    expect(screen.queryByRole("button", { name: /Go Pro/ })).toBeNull();
    expect(card.querySelector("[data-purchases-open-soon]")).not.toBeNull();
    expect(card.textContent).not.toMatch(INCLUDED);
  });

  it("G2b open, G2 closed: Pro is sold, without the Full Analysis among its perks", () => {
    nameSeller();
    gate.pro = true;
    const card = proCard();
    expect(screen.getByRole("button", { name: /Go Pro/ })).not.toBeNull();
    expect(card.textContent).not.toMatch(INCLUDED);
    expect(card.textContent).toMatch(/writing tools/);
  });
});

describe("control: both switches open, the same controls sell", () => {
  it("the bar, the table, the closing call to action, the report and the Pro card", async () => {
    nameSeller();
    gate.fa = true;
    gate.pro = true;
    expect(sticky().textContent).toMatch(PRICE);
    cleanup();
    render(<MemoryRouter><ComparisonTable /><FinalCTA onGetStarted={vi.fn()} isLoading={false} /></MemoryRouter>);
    expect(document.querySelector("[data-comparison-closed]")).toBeNull();
    expect(document.querySelector("[data-final-cta-closed]")).toBeNull();
    cleanup();
    const steps = await report();
    expect(steps.querySelector('[data-offer="fullAnalysis"]')).not.toBeNull();
    cleanup();
    const card = proCard();
    expect(screen.getByRole("button", { name: /Go Pro/ })).not.toBeNull();
    expect(card.textContent).toMatch(INCLUDED);
  });
});

/**
 * The rebuilt /pricing (the homepage switch-over) resolves its own gates, so
 * it can give each closed card its reason (the seller, the delivery, the
 * watched subscription); it reads the same seller and the same switches, and
 * sells exactly what fullAnalysisOnSale() and proOnSale() say.
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

  it("a named seller with both switches closed: no buy control, each card says why", () => {
    nameSeller();
    expect(pricing()).toEqual([]);
    expect(document.querySelector("[data-plan='full-analysis'] [data-gate='delivery']")).not.toBeNull();
    expect(document.querySelector("[data-plan='pro'] [data-gate='watched']")).not.toBeNull();
    expect(document.querySelector("[data-plan='pro']")?.textContent).not.toMatch(INCLUDED);
  });

  it("G2b open, G2 closed: Pro is sold without the Full Analysis among its perks, and the Full Analysis is not", () => {
    nameSeller();
    gate.pro = true;
    expect(pricing()).toEqual(["pro"]);
    expect(document.querySelector("[data-plan='pro']")?.textContent).not.toMatch(INCLUDED);
  });

  it("control: both switches open, both are sold", () => {
    nameSeller();
    gate.fa = true;
    gate.pro = true;
    expect(pricing()).toEqual(["full-analysis", "pro"]);
  });
});

describe("no buy control reads the seller's gate alone", () => {
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

  it("nothing outside src/lib/purchases-open.ts calls purchasesOpen()", () => {
    const callers = walk(SRC)
      .filter((p) => !p.endsWith(join("lib", "purchases-open.ts")))
      .filter((p) => /\bpurchasesOpen\s*\(/.test(strip(readFileSync(p, "utf8"))))
      .map((p) => relative(ROOT, p));
    expect(callers).toEqual([]);
  });

  it("each control that sold on the seller's gate alone now reads its product's gate", () => {
    const read = (p: string) => strip(readFileSync(resolve(ROOT, p), "utf8"));
    for (const p of [
      "src/components/FreeKeywordResults.tsx",
      "src/components/StickyBottomCTA.tsx",
      "src/components/ComparisonTable.tsx",
      "src/components/FinalCTA.tsx",
      "src/components/ResumeUploader.tsx",
    ]) expect(read(p), p).toMatch(/\bfullAnalysisOnSale\(\)/);
    expect(read("src/components/ProSubscriptionCard.tsx")).toMatch(/\bproOnSale\(\)/);
    // Index's checkout handler: on sale, or a Pro member's included analysis.
    expect(read("src/pages/Index.tsx")).toMatch(/if \(!fullAnalysisOnSale\(\) && !proIncludesAnalysis\)/);
  });
});
