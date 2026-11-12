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

/**
 * THE PRICES AND LIMITS, STATED IN BOTH llms FILES (GEO-1107-06).
 *
 * llms.txt named the $5 report and pointed at /pricing for everything else,
 * and llms-full.txt named no price and no limit at all, so an assistant asked
 * what Resume Booster costs had one figure to quote. This block states every
 * price and limit /pricing states, from the same constants the pricing page
 * reads (the bake passes them in; plan-facts.ts mirrors each to the code that
 * enforces it), dated by LIMITS_AS_OF, and only the products the pages have
 * on sale. The ChatGPT figure is the per-person share the server keeps
 * (MCP_ANON_CAPS.chatgptPerPerson), never the per-connection one.
 */
export interface LlmsPriceFacts {
  /** The site's origin, for the /pricing link. */
  site: string;
  /** The day the limits were last read against the server's constants (plan-facts.ts LIMITS_AS_OF). */
  asOf: string;
  /** Prices as the pages print them ("$5", "$45"). */
  faPrice: string;
  proPrice: string;
  freeScansPerDay: number;
  signedInScansPerDay: number;
  writingFreePerToolPerDay: number;
  proPackagesPerDay: number;
  proPackagesPerMonth: number;
  /** Pro's scan perk in its own words (the perk list's proPlan.perks.noDailyScanCap), never typed here. */
  proScanPerk?: string | null;
  /** Counts as the pages print them ("1,000"). */
  freeKeyPerDay: string;
  fitFreePerDay: number;
  fitProKeyPerDay: string;
  chatgptPerPerson: number;
  /** The purchase terms' one-line rule ("All sales are final."). */
  finalSale: string;
}

/** The heading the block starts with; the rewrite finds an earlier copy by it. */
export const LLMS_PRICE_HEADING = "## Prices and limits";

/** The block's lines, heading first, for what the pages have on sale. */
export function llmsPriceLines(state: LlmsSaleState, f: LlmsPriceFacts): string[] {
  const lines = [
    `${LLMS_PRICE_HEADING} (as of ${f.asOf})`,
    "",
    `Prices are in USD; days are UTC days. The same figures are on [/pricing](${f.site}/pricing).`,
    "",
    `- Free, signed out: search the board and open each posting on the employer's own site; ${f.freeScansPerDay} résumé scan reports a day; fit on postings in this browser.`,
    `- Free account: ${f.signedInScansPerDay} résumé scan reports a day; the tailored résumé, the cover letter and the interview prep, ${f.writingFreePerToolPerDay} of each a day.`,
  ];
  if (state.fullAnalysis) lines.push(`- Full Analysis: ${f.faPrice} each, paid once per report.`);
  if (state.pro) {
    const writing = `the writing tools ${f.proPackagesPerDay} of each a day and ${f.proPackagesPerMonth} a month`;
    lines.push(`- Pro: ${f.proPrice} a month. ${f.proScanPerk ? `${f.proScanPerk}; ${writing}` : `${writing[0].toUpperCase()}${writing.slice(1)}`}${state.fullAnalysis ? "; the Full Analysis included" : ""}.`);
  }
  if (state.fullAnalysis || state.pro) lines.push(`- ${f.finalSale}`);
  lines.push(
    `- Your own AI (Claude, ChatGPT, Claude Code): searching and reading postings is free, with no account, within a shared daily allowance; from ChatGPT, ${f.chatgptPerPerson} calls a day for each person ChatGPT's call names.`,
    `- A free key (Claude Code and any app that sends a header): ${f.freeKeyPerDay} calls a day, and fit scoring ${f.fitFreePerDay} a day; ${f.fitProKeyPerDay} a day with a key on a Pro account.`,
  );
  return lines;
}

const PRICE_BLOCK = /^## Prices and limits \(as of [^)\n]*\)\n[\s\S]*?(?=^## |(?![\s\S]))/m;

/**
 * The text with its price block replaced by `lines`, placed before the
 * "## Free tools" section (or at the end when there is none). Rewriting a
 * text that already carries a block gives the same result as writing it
 * fresh, so the committed file and each bake agree.
 */
export function withLlmsPriceBlock(text: string, lines: readonly string[]): string {
  const block = `${lines.join("\n")}\n\n`;
  const base = text.replace(PRICE_BLOCK, "");
  const at = base.search(/^## Free tools$/m);
  if (at < 0) return `${base.replace(/\n*$/, "\n\n")}${block.replace(/\n+$/, "\n")}`;
  return `${base.slice(0, at)}${block}${base.slice(at)}`;
}
