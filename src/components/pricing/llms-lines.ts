/**
 * WHAT llms.txt SAYS IS FOR SALE, FROM THE SAME GATES AS THE PAGES (review
 * round of 2026-10-26).
 *
 * The bake restated llms.txt's purchase lines from the seller alone
 * (src/lib/pricing-offer.ts llmsPurchaseLines), while "/" and /pricing read
 * the seller and the owner's two switches (src/config/sales-gate.ts). On the
 * first publish after the seller is named, with the switches still closed
 * (owner decision D4), llms.txt would have listed the Full Analysis and Pro
 * as available while both pages said "Not on sale yet". It also said Pro
 * includes the Full Analysis, which /pricing leaves out until that is on
 * sale. So the bake passes the pages' gates here, and the paid sentence and
 * the Pricing line name only what is on sale.
 *
 * The committed public/llms.txt holds the closed form; each state is
 * rewritten from a normalised base, so the function gives the same text
 * whatever state the input was written in. Pure; relative imports only.
 */
import { llmsPurchaseLines } from "../../lib/pricing-offer";

export interface LlmsSaleState {
  fullAnalysis: boolean;
  pro: boolean;
}

const PAID = /One paid report \(the (\$\d+) Full Analysis\)(?: and one optional monthly plan, Pro \(the writing tools(?:, the Full Analysis)? and no daily scan cap\)\.|\. One optional monthly plan, Pro \(the writing tools and no daily scan cap\), opens for purchase soon\.| opens for purchase soon\.)|One optional monthly plan, Pro \(the writing tools and no daily scan cap\)\. One paid report \(the (\$\d+) Full Analysis\) opens for purchase soon\./;
const PRICING = /^(- \[Pricing\]\([^)]*\): )The free tools(?:, the (\$\d+) Full Analysis and Pro| and the (\$\d+) Full Analysis \(Pro opens for purchase soon\)| and Pro \(the (\$\d+) Full Analysis opens for purchase soon\))/m;

const base = (price: string) => `One paid report (the ${price} Full Analysis) and one optional monthly plan, Pro (the writing tools and no daily scan cap).`;

/** llms.txt with its paid sentence and Pricing line for what the pages have on sale. */
export function llmsSaleLines(text: string, state: LlmsSaleState, sentence: string): string {
  let price = "$5";
  // Back to the closed base first, whatever state the text was written in.
  let t = text.replace(PAID, (_m, a?: string, b?: string) => {
    price = a ?? b ?? price;
    return base(price);
  });
  t = t.replace(PRICING, (_m, head: string, a?: string, b?: string, c?: string) => {
    price = a ?? b ?? c ?? price;
    return `${head}The free tools, the ${price} Full Analysis and Pro`;
  });
  const { fullAnalysis, pro } = state;
  t = llmsPurchaseLines(t, fullAnalysis || pro, sentence);
  if (fullAnalysis && pro) {
    return t.replace(base(price), `One paid report (the ${price} Full Analysis) and one optional monthly plan, Pro (the writing tools, the Full Analysis and no daily scan cap).`);
  }
  if (fullAnalysis) {
    t = t.replace(base(price), `One paid report (the ${price} Full Analysis). One optional monthly plan, Pro (the writing tools and no daily scan cap), opens for purchase soon.`);
    return t.replace(PRICING, (_m, head: string) => `${head}The free tools and the ${price} Full Analysis (Pro opens for purchase soon)`);
  }
  if (pro) {
    t = t.replace(base(price), `One optional monthly plan, Pro (the writing tools and no daily scan cap). One paid report (the ${price} Full Analysis) opens for purchase soon.`);
    return t.replace(PRICING, (_m, head: string) => `${head}The free tools and Pro (the ${price} Full Analysis opens for purchase soon)`);
  }
  return t;
}
