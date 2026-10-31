/**
 * WHAT llms.txt SAYS IS FOR SALE, FROM THE SAME GATES AS THE PAGES (review
 * round of 2026-10-26; sales stay on, the owner, 2026-10-27).
 *
 * "/" and /pricing name a paid product only while its sale switch is on
 * (src/config/sales-gate.ts; both on, as on main), and never wait for the
 * seller's name and address. The bake passes the pages' gates here, so the
 * paid sentence and the Pricing line of llms.txt name exactly what the pages
 * have on sale, and Pro is said to include the Full Analysis only while that
 * is on sale too (as /pricing says it). A product whose switch is off is left
 * out; nothing here says one opens later.
 *
 * The committed public/llms.txt holds the form with both on sale; each state
 * is rewritten from a normalised base, so the function gives the same text
 * whatever state the input was written in (with nothing on sale the text
 * names no price, and the next rewrite takes the $5 the catalogue sells it
 * at, src/config/products.ts). Pure; no imports.
 */

export interface LlmsSaleState {
  fullAnalysis: boolean;
  pro: boolean;
}

const PRO_PLAN = "Pro (the writing tools and no daily scan cap)";
const PRO_PLAN_WITH_FA = "Pro (the writing tools, the Full Analysis and no daily scan cap)";

/** Every form of the paid sentence this function writes, and the older ones the pages' first draft wrote. */
const PAID = /(?:One paid report \(the (\$\d+) Full Analysis\)(?: and one optional monthly plan, Pro \(the writing tools(?:, the Full Analysis)? and no daily scan cap\))?\.(?: One optional monthly plan, Pro \(the writing tools and no daily scan cap\), opens for purchase soon\.| opens for purchase soon\.)?|One optional monthly plan, Pro \(the writing tools and no daily scan cap\)\.(?: One paid report \(the (\$\d+) Full Analysis\) opens for purchase soon\.)?|No paid product is on sale\.)(?: Purchases open soon\.[^.]*\.)?/;
const PRICING = /^(- \[Pricing\]\([^)]*\): )The free tools(?:, the (\$\d+) Full Analysis and Pro(?: \(purchases open soon\))?| and the (\$\d+) Full Analysis(?: \(Pro opens for purchase soon\))?| and Pro(?: \(the (\$\d+) Full Analysis opens for purchase soon\))?)?/m;

/** llms.txt with its paid sentence and Pricing line for what the pages have on sale. */
export function llmsSaleLines(text: string, state: LlmsSaleState): string {
  let price = "$5";
  const seen = (...p: Array<string | undefined>) => { price = p.find(Boolean) ?? price; };
  const { fullAnalysis, pro } = state;
  const paid = () => fullAnalysis && pro
    ? `One paid report (the ${price} Full Analysis) and one optional monthly plan, ${PRO_PLAN_WITH_FA}.`
    : fullAnalysis
      ? `One paid report (the ${price} Full Analysis).`
      : pro
        ? `One optional monthly plan, ${PRO_PLAN}.`
        : "No paid product is on sale.";
  const pricing = () => fullAnalysis && pro
    ? `The free tools, the ${price} Full Analysis and Pro`
    : fullAnalysis
      ? `The free tools and the ${price} Full Analysis`
      : pro
        ? "The free tools and Pro"
        : "The free tools";
  let t = text.replace(PAID, (_m, a?: string, b?: string) => {
    seen(a, b);
    return paid();
  });
  t = t.replace(PRICING, (_m, head: string, a?: string, b?: string, c?: string) => {
    seen(a, b, c);
    return `${head}${pricing()}`;
  });
  return t;
}
