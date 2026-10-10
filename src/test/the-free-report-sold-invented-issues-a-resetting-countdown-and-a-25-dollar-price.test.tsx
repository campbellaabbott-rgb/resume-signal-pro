/**
 * THE FREE REPORT SOLD INVENTED ISSUES, A RESETTING COUNTDOWN AND A $25 PRICE
 * (commercial-readiness item 6 and 7; owner decision 2026-10-08).
 *
 * After any red flag, the free report showed "N+2 more issues … Premium
 * Only" over three hard-coded fake issues ("A formatting pattern on line 3",
 * "a 7-month gap"), a "saved for 48 more hours" timer that restarted on every
 * visit (the FAQ says 7 days), a last button priced "$25" for the $5 Full
 * Analysis, and a stack of other products down to a hidden $3 keyword fix. A
 * buyer who paid $5 would not find those issues.
 *
 * The report now offers exactly two upgrades, both honest: the $5 Full
 * Analysis and Pro. Rendered with a report that has red flags, keywords,
 * withheld keywords, a job description and an uploaded job: the only prices
 * on the page are those two.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

// jsdom has neither; the report's section nav uses both.
Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import { FreeKeywordResults } from "@/components/FreeKeywordResults";
import { PRODUCTS, SUBSCRIPTIONS } from "@/config/products";

function mount() {
  const onGetFullAnalysis = vi.fn();
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
        jobDescriptionText="We need a data engineer with Airflow, dbt and Snowflake."
        redFlags={[
          { issue: "No metrics in bullets", impact: "Recruiters skip unquantified impact", severity: "critical" },
          { issue: "Generic summary", impact: "Reads like every other applicant", severity: "warning" },
        ] as never}
        keywords={[{ keyword: "airflow", reason: "Standard for the role", frequencyWeight: 3, suggestedSection: "skills" }] as never}
        gatedKeywords={[{ keyword: "dbt", category: "tool", gated: true }, { keyword: "snowflake", category: "tool", gated: true }]}
        uploadedJobs={[{ title: "Data Engineer", company: "Acme" }] as never}
        sampleRewrite={{ before: "Responsible for data pipelines", after: "Built 12 Airflow pipelines processing 2TB daily", improvement: "Quantified scope" }}
        quickWins={[{ fix: "Add pipeline throughput numbers", timeEstimate: "10 min", impact: "high", scoreImpact: 6, category: "quantification" }] as never}
        onGetFullAnalysis={onGetFullAnalysis}
        onGenerateTailoredResume={vi.fn()}
      />
    </MemoryRouter>,
  );
  return { ...utils, onGetFullAnalysis };
}

describe("the free report's offers", () => {
  it("shows no invented locked issues and no countdown", () => {
    const { container } = mount();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/premium only/i);
    expect(text).not.toMatch(/formatting pattern on line 3|7-month gap/i);
    expect(text).not.toMatch(/saved for \d+ more hours/i);
  });

  it("prices only the Full Analysis and Pro, never $25", () => {
    const { container } = mount();
    // A price, not an example metric such as "$25M in closed deals".
    const prices = new Set([...(container.textContent ?? "").matchAll(/\$\s?(\d+)(?![\d.,]*\s?[KMBkmb](?![a-z]))(?![\d.,])/g)].map((m) => Number(m[1])));
    expect([...prices].sort((a, b) => a - b)).toEqual([PRODUCTS.fullAnalysis.priceUsd, SUBSCRIPTIONS.pro.priceUsd].sort((a, b) => a - b));
  });

  it("the Full Analysis offer starts its checkout, and the Pro offer opens the plan", () => {
    const { onGetFullAnalysis } = mount();
    const steps = screen.getByTestId("report-next-steps");
    const full = steps.querySelector('[data-offer="fullAnalysis"]') as HTMLButtonElement;
    fireEvent.click(full);
    expect(onGetFullAnalysis).toHaveBeenCalledTimes(1);
    const pro = steps.querySelector('[data-offer="pro"]') as HTMLAnchorElement;
    expect(pro.getAttribute("href")).toBe("/pricing");
  });
});

// The homepage's value table priced us at "$5 – $25 one-time" in every
// language, a typed range that matched no product (one-time prices run from
// $2 to $59) and showed €/£ where checkout charges dollars.
describe("the value table's cost", () => {
  it("names the Full Analysis price checkout charges, in every language", async () => {
    const { ValueComparison } = await import("@/components/ValueComparison");
    const i18n = (await import("@/i18n")).default;
    const { readdirSync, readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const dir = resolve(__dirname, "../i18n/locales");
    const langs = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
    expect(langs.length).toBe(9);
    try {
      for (const lng of langs) {
        // Only English ships in the bundle; load each locale the way the lazy loader does.
        i18n.addResourceBundle(lng, "translation", JSON.parse(readFileSync(resolve(dir, `${lng}.json`), "utf8")), true, true);
        await i18n.changeLanguage(lng);
        expect(i18n.t("valueComparison.feature"), lng).toBe(JSON.parse(readFileSync(resolve(dir, `${lng}.json`), "utf8")).valueComparison.feature);
        const { container, unmount } = render(<MemoryRouter><ValueComparison /></MemoryRouter>);
        const row = [...container.querySelectorAll("div.grid")].find((r) => r.textContent?.includes(i18n.t("valueComparison.rows.cost.feature")));
        const cell = row?.children[1]?.textContent ?? "";
        const numbers = [...cell.matchAll(/\d+/g)].map((m) => Number(m[0]));
        expect(numbers, `${lng}: ${cell}`).toEqual([PRODUCTS.fullAnalysis.priceUsd]);
        expect(cell, lng).toContain("$");
        unmount();
      }
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
