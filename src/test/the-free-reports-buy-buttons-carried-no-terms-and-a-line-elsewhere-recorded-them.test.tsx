/**
 * THE FREE REPORT'S BUY BUTTONS CARRIED NO TERMS, AND A LINE ELSEWHERE ON THE
 * PAGE RECORDED THEM AS SHOWN (wave 3 review of payments-account, item 12).
 *
 * WHAT WAS WRONG.
 *   - The free report rendered live buy buttons with no "By continuing you
 *     agree" line above them: the next-steps Full Analysis and Interview
 *     Coach, the Premium Package, Cover Letter and Apply kit buttons, and the
 *     report's other Full Analysis entry points.
 *   - The Terms version was sent whenever any line was mounted anywhere. The
 *     same report mounts the add-ons and the pricing tiers, each with its own
 *     line, so every one of those uncovered buttons recorded the Terms as
 *     shown.
 *   - With the EU/UK switch on, a box ticked on one card counted as the
 *     waiver for a button on another card.
 *
 * WHAT HOLDS NOW: a line covers only the buttons in its own block. Every
 * button in the rendered report that starts a checkout has a line in its own
 * block, and its call records the version; a press outside every line's block
 * records neither the version nor the box.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { TERMS_VERSION } from "@/config/terms";

const eu = vi.hoisted(() => ({ on: false }));
vi.mock("@/config/eu-consumer", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  get EU_UK_SALES_ON() { return eu.on; },
}));

// Every checkout call spreads purchaseTerms(): recording each call is how a
// click is known to have started one, and what it would have sent.
const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@/lib/purchase-terms", async (orig) => {
  const actual = await orig<typeof import("@/lib/purchase-terms")>();
  return {
    ...actual,
    purchaseTerms: () => {
      const body = actual.purchaseTerms();
      sent.push(body as Record<string, unknown>);
      return body;
    },
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
        getSession: async () => ({ data: { session: null } }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});

// jsdom has neither; the report's section nav uses both.
Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import { FreeKeywordResults } from "@/components/FreeKeywordResults";
import { PurchaseTerms } from "@/components/PurchaseTerms";
import { purchaseTerms, resetPurchaseTermsForTests } from "@/lib/purchase-terms";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(() => {
  cleanup();
  eu.on = false;
  resetPurchaseTermsForTests();
  sent.length = 0;
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** True when a mounted Terms line sits in the same block as this button. */
const lineAbove = (button: Element) =>
  [...document.querySelectorAll('[data-testid="purchase-terms"]')].some((line) => line.parentElement?.contains(button));

function mountReport(onGetFullAnalysis: () => void) {
  return render(
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
        jobDescriptionText="We need a data engineer with Airflow, dbt and Snowflake."
        redFlags={[
          { issue: "No metrics in bullets", impact: "Recruiters skip unquantified impact", severity: "critical" },
          { issue: "Generic summary", impact: "Reads like every other applicant", severity: "warning" },
        ] as never}
        keywords={[{ keyword: "airflow", reason: "Standard for the role", frequencyWeight: 3, suggestedSection: "skills" }] as never}
        gatedKeywords={[{ keyword: "dbt", category: "tool", gated: true }]}
        uploadedJobs={[{ title: "Data Engineer", company: "Acme" }] as never}
        jobMatchScore={70}
        jobMatchGrade="B"
        jobMatchSummary="A close match on pipelines."
        matchingSkills={["airflow"]}
        missingSkills={["dbt"]}
        atsSystemCompatibility={{ overallRating: "good", topIssue: "Tables", bestFor: ["Greenhouse"], worstFor: ["Taleo"] } as never}
        sampleRewrite={{ before: "Responsible for data pipelines", after: "Built 12 Airflow pipelines processing 2TB daily", improvement: "Quantified scope" }}
        quickWins={[{ fix: "Add pipeline throughput numbers", timeEstimate: "10 min", impact: "high", scoreImpact: 6, category: "quantification" }] as never}
        onGetFullAnalysis={onGetFullAnalysis}
        onGenerateTailoredResume={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe("the free report's buy buttons", () => {
  it("each one that starts a checkout carries the Terms line in its own block, and its call records the version", async () => {
    // Index's handleCheckout spreads purchaseTerms() into create-checkout.
    const onGetFullAnalysis = vi.fn(() => { purchaseTerms(); });
    const { container } = mountReport(onGetFullAnalysis);
    const uncovered: string[] = [];
    let checkouts = 0;
    for (const button of [...container.querySelectorAll("button")]) {
      if (!button.isConnected || button.disabled) continue;
      sent.length = 0;
      fireEvent.click(button);
      await settle();
      if (sent.length === 0) continue;
      checkouts++;
      const label = (button.textContent ?? "").trim().slice(0, 60);
      if (!lineAbove(button)) uncovered.push(`${label}: no line in its block`);
      if (sent.some((b) => b.termsVersion !== TERMS_VERSION)) uncovered.push(`${label}: sent no Terms version`);
    }
    expect(onGetFullAnalysis, "the report's Full Analysis offer was not found").toHaveBeenCalled();
    expect(checkouts).toBeGreaterThan(0);
    expect(uncovered).toEqual([]);
  });
});

describe("which button a Terms line belongs to", () => {
  function twoCards() {
    render(
      <div>
        <div>
          <PurchaseTerms kind="payment" />
          <button type="button">covered</button>
        </div>
        <div>
          <button type="button">elsewhere</button>
        </div>
      </div>,
    );
  }

  it("a line on one card records nothing for a button on another", () => {
    twoCards();
    fireEvent.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(purchaseTerms().termsVersion).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "covered" }));
    expect(purchaseTerms().termsVersion).toBe(TERMS_VERSION);
  });

  it("once the line is gone, a press that had it records nothing", () => {
    twoCards();
    fireEvent.click(screen.getByRole("button", { name: "covered" }));
    cleanup();
    expect(purchaseTerms().termsVersion).toBeUndefined();
  });

  it("with the EU/UK switch on, a box ticked on one card is not the waiver for a button on another", () => {
    eu.on = true;
    twoCards();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(purchaseTerms().withdrawalWaiver).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "covered" }));
    expect(purchaseTerms().withdrawalWaiver).toBe(true);
  });
});
