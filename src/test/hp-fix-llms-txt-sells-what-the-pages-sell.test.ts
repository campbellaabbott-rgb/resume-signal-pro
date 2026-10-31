/**
 * llms.txt SELLS WHAT THE PAGES SELL, AND llms-full.txt LEADS WITH THE BOARD
 * (review round of 2026-10-26; src/components/pricing/llms-lines.ts; sales
 * stay on, the owner, 2026-10-27).
 *
 * The bake restated llms.txt's purchase lines from the seller alone, while
 * the pages read the owner's two switches. Now the pages and llms.txt read
 * the same switches (both on, as on main) and never the seller: with no
 * seller named both products are on sale, Pro includes the Full Analysis,
 * and nothing says a purchase opens soon. A product whose switch is off is
 * left out, not promised. And llms-full.txt still opened by calling the site
 * root the résumé scanner, with no /resume-checker address, after "/" became
 * the job search.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { llmsSaleLines } from "@/components/pricing/llms-lines";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const COMMITTED = readFileSync(resolve(ROOT, "public/llms.txt"), "utf8");
const pricingLine = (t: string) => /^- \[Pricing\]\([^)]*\): (.*)$/m.exec(t)?.[1] ?? "";
const paidLine = (t: string) => t.split("\n").find((l) => /One (?:paid report|optional monthly plan)|No paid product/.test(l)) ?? "";

describe("the committed file is the form with both on sale", () => {
  it("names both products, Pro with the Full Analysis, and nothing opening soon", () => {
    expect(paidLine(COMMITTED)).toMatch(/^One paid report \(the \$5 Full Analysis\) and one optional monthly plan, Pro \(the writing tools, the Full Analysis and no daily scan cap\)\. Current prices/);
    expect(pricingLine(COMMITTED)).toBe("The free tools, the $5 Full Analysis and Pro.");
    expect(COMMITTED).not.toMatch(/open(?:s for purchase)? soon/i);
    expect(llmsSaleLines(COMMITTED, { fullAnalysis: true, pro: true })).toBe(COMMITTED);
  });
});

describe("each sale state", () => {
  it("both switches off: no paid product, and no promise that one opens", () => {
    const t = llmsSaleLines(COMMITTED, { fullAnalysis: false, pro: false });
    expect(paidLine(t)).toMatch(/^No paid product is on sale\. Current prices/);
    expect(pricingLine(t)).toBe("The free tools.");
    expect(t).not.toMatch(/soon/i);
  });

  it("the Full Analysis alone on sale: it alone is named", () => {
    const t = llmsSaleLines(COMMITTED, { fullAnalysis: true, pro: false });
    expect(paidLine(t)).toMatch(/^One paid report \(the \$5 Full Analysis\)\. Current prices/);
    expect(pricingLine(t)).toBe("The free tools and the $5 Full Analysis.");
    expect(t).not.toMatch(/soon/i);
  });

  it("Pro alone on sale: Pro without the Full Analysis the page leaves out", () => {
    const t = llmsSaleLines(COMMITTED, { fullAnalysis: false, pro: true });
    expect(paidLine(t)).toMatch(/^One optional monthly plan, Pro \(the writing tools and no daily scan cap\)\. Current prices/);
    expect(pricingLine(t)).toBe("The free tools and Pro.");
  });

  it("the same text whatever state the input was written in", () => {
    const states = [
      { fullAnalysis: false, pro: false }, { fullAnalysis: true, pro: false },
      { fullAnalysis: false, pro: true }, { fullAnalysis: true, pro: true },
    ];
    for (const from of states) for (const to of states) {
      expect(llmsSaleLines(llmsSaleLines(COMMITTED, from), to), `${JSON.stringify(from)} -> ${JSON.stringify(to)}`)
        .toBe(llmsSaleLines(COMMITTED, to));
    }
  });

  it("the closed form the switch-over committed (purchases open soon) normalises to what the pages sell", () => {
    const closed = COMMITTED
      .replace("Pro (the writing tools, the Full Analysis and no daily scan cap).", "Pro (the writing tools and no daily scan cap). Purchases open soon. Searching jobs, the free scan and a free account work now.")
      .replace("The free tools, the $5 Full Analysis and Pro.", "The free tools, the $5 Full Analysis and Pro (purchases open soon).");
    expect(closed).not.toBe(COMMITTED);
    expect(llmsSaleLines(closed, { fullAnalysis: true, pro: true })).toBe(COMMITTED);
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
