/**
 * llms.txt SELLS WHAT THE PAGES SELL, AND llms-full.txt LEADS WITH THE BOARD
 * (review round of 2026-10-26; src/components/pricing/llms-lines.ts).
 *
 * The bake restated llms.txt's purchase lines from the seller alone, while
 * the pages read the seller and the owner's two switches: the first publish
 * after the seller is named (switches still closed, D4) would have told AI
 * hosts the Full Analysis and Pro were available while "/" and /pricing said
 * "Not on sale yet". It also said Pro includes the Full Analysis, which
 * /pricing leaves out until that is on sale. And llms-full.txt still opened
 * by calling the site root the résumé scanner, with no /resume-checker
 * address, after "/" became the job search.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { llmsSaleLines } from "@/components/pricing/llms-lines";
import { codeOf } from "./helpers/strip-comments";
import en from "@/i18n/locales/en.json";

const ROOT = resolve(__dirname, "../..");
const COMMITTED = readFileSync(resolve(ROOT, "public/llms.txt"), "utf8");
const SOON = en.checkoutGate.purchasesOpenSoon;
const pricingLine = (t: string) => /^- \[Pricing\]\([^)]*\): (.*)$/m.exec(t)?.[1] ?? "";
const paidLine = (t: string) => t.split("\n").find((l) => /One (?:paid report|optional monthly plan)/.test(l)) ?? "";

describe("the committed file is the closed form", () => {
  it("names both products as opening soon, and Pro without the Full Analysis the page hides", () => {
    expect(paidLine(COMMITTED)).toContain("Pro (the writing tools and no daily scan cap). " + SOON);
    expect(pricingLine(COMMITTED)).toBe("The free tools, the $5 Full Analysis and Pro (purchases open soon).");
    expect(llmsSaleLines(COMMITTED, { fullAnalysis: false, pro: false }, SOON)).toBe(COMMITTED);
  });
});

describe("each sale state", () => {
  it("the seller named and both switches closed: still nothing on sale", () => {
    // What the old bake printed here (seller-only) dropped both lines' "soon".
    const t = llmsSaleLines(COMMITTED, { fullAnalysis: false, pro: false }, SOON);
    expect(paidLine(t)).toContain(SOON);
    expect(pricingLine(t)).toMatch(/\(purchases open soon\)\.$/);
  });

  it("the Full Analysis alone on sale: it is, and Pro opens soon", () => {
    const t = llmsSaleLines(COMMITTED, { fullAnalysis: true, pro: false }, SOON);
    expect(paidLine(t)).toMatch(/^One paid report \(the \$5 Full Analysis\)\. One optional monthly plan, Pro \(the writing tools and no daily scan cap\), opens for purchase soon\. Current prices/);
    expect(t).not.toContain(SOON);
    expect(pricingLine(t)).toBe("The free tools and the $5 Full Analysis (Pro opens for purchase soon).");
  });

  it("both on sale: both, and Pro includes the Full Analysis", () => {
    const t = llmsSaleLines(COMMITTED, { fullAnalysis: true, pro: true }, SOON);
    expect(paidLine(t)).toMatch(/Pro \(the writing tools, the Full Analysis and no daily scan cap\)\. Current prices/);
    expect(pricingLine(t)).toBe("The free tools, the $5 Full Analysis and Pro.");
  });

  it("the same text whatever state the input was written in", () => {
    const states = [
      { fullAnalysis: false, pro: false }, { fullAnalysis: true, pro: false },
      { fullAnalysis: false, pro: true }, { fullAnalysis: true, pro: true },
    ];
    for (const from of states) for (const to of states) {
      expect(llmsSaleLines(llmsSaleLines(COMMITTED, from, SOON), to, SOON), `${JSON.stringify(from)} -> ${JSON.stringify(to)}`)
        .toBe(llmsSaleLines(COMMITTED, to, SOON));
    }
  });
});

describe("the bake", () => {
  const code = codeOf(readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8"));

  it("restates llms.txt from the pages' gates, not from the seller alone", () => {
    expect(code).toMatch(/D\.llmsSaleLines\(lt, \{ fullAnalysis: PRICING_GATES\.fullAnalysis\.onSale, pro: PRICING_GATES\.pro\.onSale \}/);
    expect(code).not.toMatch(/llmsPurchaseLines\(lt, Boolean\(D\.sellerIdentity\(\)\)/);
  });

  it("llms-full.txt opens with the job board and names the scanner's own address", () => {
    const lead = /lines\.push\(`> ([^`]*)`\);/.exec(code)?.[1] ?? "";
    expect(lead).toMatch(/^A live job board/);
    expect(lead).toContain("resumebooster.work/resume-checker");
    expect(lead).not.toMatch(/^Free diagnostic resume scanner \(resumebooster\.work\)/);
  });
});
