/**
 * THE llms FILES STATE THE PRICES AND LIMITS /pricing STATES (GEO-1107-06).
 *
 * On 2026-11-07 llms.txt named the $5 report and "Current prices are on
 * /pricing", and llms-full.txt named no price and no limit, so an assistant
 * asked what Resume Booster costs had one figure to quote. Both files now
 * carry one dated block built from the constants the pricing page reads.
 * The same files said ChatGPT users get 100 calls each; the server gives
 * each person ChatGPT names 200 (MCP_ANON_CAPS.chatgptPerPerson).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LLMS_PRICE_HEADING, llmsPriceLines, withLlmsPriceBlock, type LlmsPriceFacts } from "@/components/pricing/llms-lines";
import { FREE_SCANS_PER_DAY, FULL_ANALYSIS_PRICE_USD, LIMITS_AS_OF, PRO_PRICE_USD, SIGNED_IN_SCANS_PER_DAY, WRITING } from "@/components/pricing/plan-facts";
import { MCP_ANON_CAPS } from "@/config/mcp-tools";
import { PRO_PERK_ITEMS } from "@/config/pro-perks";

const ROOT = resolve(__dirname, "../..");
const FACTS: LlmsPriceFacts = {
  site: "https://resumebooster.work",
  asOf: LIMITS_AS_OF,
  faPrice: `$${FULL_ANALYSIS_PRICE_USD}`,
  proPrice: `$${PRO_PRICE_USD}`,
  freeScansPerDay: FREE_SCANS_PER_DAY,
  signedInScansPerDay: SIGNED_IN_SCANS_PER_DAY,
  writingFreePerToolPerDay: WRITING.freePerToolPerDay,
  proPackagesPerDay: WRITING.proPackagesPerDay,
  proPackagesPerMonth: WRITING.proPackagesPerMonth,
  proScanPerk: PRO_PERK_ITEMS.find((p) => p.key === "proPlan.perks.noDailyScanCap")!.text,
  freeKeyPerDay: "1,000",
  fitFreePerDay: 25,
  fitProKeyPerDay: "1,000",
  chatgptPerPerson: MCP_ANON_CAPS.chatgptPerPerson,
  finalSale: "All sales are final.",
};

describe("llmsPriceLines", () => {
  const both = llmsPriceLines({ fullAnalysis: true, pro: true }, FACTS).join("\n");

  it("is dated, and states every price and limit the pricing page states", () => {
    expect(both).toContain(`${LLMS_PRICE_HEADING} (as of ${LIMITS_AS_OF})`);
    expect(both).toContain(`$${PRO_PRICE_USD} a month`);
    expect(both).toContain(`$${FULL_ANALYSIS_PRICE_USD} each`);
    expect(both).toContain(`${FREE_SCANS_PER_DAY} résumé scan reports a day`);
    expect(both).toContain(`${SIGNED_IN_SCANS_PER_DAY} résumé scan reports a day`);
    expect(both).toContain(`${WRITING.proPackagesPerDay} of each a day and ${WRITING.proPackagesPerMonth} a month`);
    expect(both).toContain("All sales are final.");
    expect(both).toContain(`$${PRO_PRICE_USD} a month. ${PRO_PERK_ITEMS.find((p) => p.key === "proPlan.perks.noDailyScanCap")!.text}; the writing tools`);
  });

  it("says ChatGPT's per-person figure the server keeps, not the per-connection one", () => {
    expect(MCP_ANON_CAPS.chatgptPerPerson).not.toBe(MCP_ANON_CAPS.otherPerConnection);
    expect(both).toContain(`from ChatGPT, ${MCP_ANON_CAPS.chatgptPerPerson} calls a day for each person`);
  });

  it("names only what is on sale, and no sale terms when nothing is", () => {
    const faOnly = llmsPriceLines({ fullAnalysis: true, pro: false }, FACTS).join("\n");
    expect(faOnly).not.toContain(`$${PRO_PRICE_USD}`);
    const proOnly = llmsPriceLines({ fullAnalysis: false, pro: true }, FACTS).join("\n");
    expect(proOnly).not.toContain("Full Analysis");
    const none = llmsPriceLines({ fullAnalysis: false, pro: false }, FACTS).join("\n");
    expect(none).not.toMatch(/\$\d/);
    expect(none).not.toContain("All sales are final.");
  });

  it("names only Claude, ChatGPT and Claude Code as the AI apps", () => {
    expect(both).not.toMatch(/\b(?:Cursor|VS Code|Cline|Windsurf|Gemini|Codex)\b/);
  });
});

describe("withLlmsPriceBlock", () => {
  const base = "# Resume Booster\n\nIntro.\n\n## Free tools\n\n- one\n";
  const lines = llmsPriceLines({ fullAnalysis: true, pro: true }, FACTS);

  it("puts the block before the free tools, and rewriting it changes nothing", () => {
    const once = withLlmsPriceBlock(base, lines);
    expect(once.indexOf(LLMS_PRICE_HEADING)).toBeLessThan(once.indexOf("## Free tools"));
    expect(withLlmsPriceBlock(once, lines)).toBe(once);
  });

  it("replaces a block written under an older date", () => {
    const old = withLlmsPriceBlock(base, llmsPriceLines({ fullAnalysis: true, pro: true }, { ...FACTS, asOf: "2026-01-01", proPrice: "$99" }));
    const now = withLlmsPriceBlock(old, lines);
    expect(now).not.toContain("2026-01-01");
    expect(now).not.toContain("$99");
    expect(now.match(/## Prices and limits/g)).toHaveLength(1);
  });
});

describe("the committed llms.txt and the bake", () => {
  it("public/llms.txt carries the block as the bake writes it with both products on sale", () => {
    const committed = readFileSync(resolve(ROOT, "public/llms.txt"), "utf8");
    expect(withLlmsPriceBlock(committed, llmsPriceLines({ fullAnalysis: true, pro: true }, FACTS))).toBe(committed);
    expect(committed).not.toContain("Current prices are on");
  });

  it("the bake writes the block into both files, and llms-full says ChatGPT's per-person figure", () => {
    const src = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");
    expect(src).toMatch(/lines\.push\(\.\.\.LLMS_PRICE_LINES\);/);
    expect(src).toMatch(/lt = D\.withLlmsPriceBlock\(lt, LLMS_PRICE_LINES\);/);
    expect(src).toMatch(/proScanPerk: \(D\.PRO_PERK_ITEMS\.find\(\(p\) => p\.key === "proPlan\.perks\.noDailyScanCap"\)/);
    expect(src).toMatch(/from ChatGPT each person has their own \$\{D\.MCP_ANON_CAPS\.chatgptPerPerson\}/);
    expect(src).toMatch(/from ChatGPT, \$\{D\.MCP_ANON_CAPS\.chatgptPerPerson\} for each person/);
  });
});
