// What the crawler copy may no longer sell, and the one true line it says
// instead. Pure: read by the bake (scripts/prerender-seo.mjs), by the tests
// that run the bake and read what it wrote (src/test/pd-bake-*), and by the
// verifier section that reads the live pages as Googlebot
// (scripts/verify-deploy.d/83-profiles-design-bake.sh).
//
// THE APPLY PIVOT (owner, 2026-10-11): the server-side Apply Agent, the Agent
// plan, the Agent Pass and the Apply Assistant are retired, and applying
// happens through people's own AIs: the person reads the posting with their
// AI and submits on the employer's own site. The Premium Resume Package is
// being retired with them (product line, 2026-10-12). Until this round the
// bake still sold all of them to every crawler and answer engine: a Service
// block with the plan's and the pass's prices as Offers on the homepage, an
// H1 that said the agent applies, a priced title on /agent, the plan and the
// pass on /agents, /pricing and in llms-full, and both retired one-time
// products in /pricing's list. React reads the products mirror; the bake
// read it too, so retiring a product in one runtime left it on sale in the
// other (the claim-drift rule).

/** One-time products the bake never lists, by their `id` in src/config/products.ts, whatever that mirror still carries. */
export const RETIRED_PRODUCT_IDS = ["premium_package", "apply_assistant"];

/**
 * The line every crawler page says about applying. Seeker-facing copy names
 * only Claude, ChatGPT and Claude Code as AI hosts (owner, 2026-09-18), and
 * never says that Resume Booster submits an application: the person does.
 */
export const APPLY_YOURSELF_LINE = "Search the board from your own AI (Claude, ChatGPT or Claude Code), read each posting in full, and apply yourself on the employer's own site: you check every answer and you press submit.";

/**
 * The phrases no crawler page, JSON-LD block or llms file may carry, each
 * with the claim it stands for. They match SELLING and SUBMITTING, not the
 * names alone, because a retirement notice has to be able to say what it
 * retires: a price beside a retired product, an offer of one, a sentence that
 * says the agent applies or submits for you, and the two absolutes the owner
 * ruled out ("verified openings": we read employers' feeds, we do not verify
 * each role; "zero ghost").
 */
export const RETIRED_CLAIMS = [
  // A monthly $99, or $99 beside the plan's names: an employer's own "$99
  // per visit" in a listed job title is not the plan's price (measured on a
  // live bake, 2026-10-12).
  ["the Apply Agent's $99 a month", /\$\s?99(?!\d|[,.]\d)(?:\s?\/\s?mo(?:nth)?\b|\s+(?:a|per)\s+month\b)|\b(?:Agent|plan|Morning Queue)\b[^.<]{0,40}\$\s?99(?!\d|[,.]\d)|\$\s?99(?!\d|[,.]\d)[^.<]{0,40}\b(?:Agent|plan|Morning Queue)\b/i],
  ["the $29 Agent Pass", /\$\s?29(?!\d|[,.]\d)[^.<]{0,60}\bpass\b|\bpass\b[^.<]{0,60}\$\s?29(?!\d|[,.]\d)/i],
  ["the $7 Apply Assistant", /\$\s?7\b[^.<\d]{0,80}Apply Assistant|Apply Assistant[^.<]{0,80}\$\s?7\b/i],
  ["the Premium Resume Package", /\bPremium (?:Resume )?Package\b/i],
  ["an agent that applies for you", /\bapplies for you\b|\bapply for you\b|\bsubmits? (?:applications? )?(?:for|on behalf of) you\b|\bsubmits end[- ]to[- ]end\b|\bsubmit applications for you\b/i],
  ["auto mode", /\bauto mode\b/i],
  ["the Agent plan's trial", /\bdays free for first-time subscribers\b/i],
  ["'verified openings'", /\bverified (?:open roles|openings|open positions|jobs)\b/i],
  ["'zero ghost'", /\bzero ghost\b/i],
];

/**
 * The names a page that SELLS may not carry at all (/, /pricing, the Offer
 * and Service JSON-LD): on a page with prices, a retired product's name is an
 * offer of it.
 */
export const RETIRED_NAMES_ON_SALES_PAGES = [
  ["the Agent plan", /\bAgent plan\b|\bMorning Queue\b/i],
  ["the Agent Pass", /\bAgent Pass\b|\/agents\/pass\b/i],
  ["the Apply Assistant", /\bApply Assistant\b/i],
  ["the Apply Agent as a product", /\bApply Agent\b(?! is (?:retired|switched off))/],
];

/** The text of an HTML page as a crawler reads it: tags out, the entities the bake writes decoded. */
export const crawlerText = (html) => String(html ?? "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");

/**
 * Every retired claim one served document carries, as [claim, matched text].
 * `sales` adds the name checks for a page that sells; `ld` is the page's
 * JSON-LD blocks, read whole (an Offer's price is a field, not prose).
 */
export function retiredClaimsIn(text, { sales = false } = {}) {
  const t = String(text ?? "");
  const out = [];
  for (const [claim, re] of RETIRED_CLAIMS) { const m = re.exec(t); if (m) out.push([claim, m[0]]); }
  if (sales) for (const [claim, re] of RETIRED_NAMES_ON_SALES_PAGES) { const m = re.exec(t); if (m) out.push([claim, m[0]]); }
  return out;
}

/** The JSON-LD blocks of an HTML document, parsed; an unparseable block is returned as { unparseable: true }. */
export const jsonLdBlocks = (html) => [...String(html ?? "").matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
  .map((m) => { try { return JSON.parse(m[1].replace(/\\u003c/g, "<")); } catch { return { unparseable: true }; } });

/** Every Offer in a set of JSON-LD blocks, at any depth. */
export function offersIn(blocks) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== "object") return;
    if (v["@type"] === "Offer" || v["@type"] === "AggregateOffer") out.push(v);
    for (const x of Object.values(v)) walk(x);
  };
  walk(blocks);
  return out;
}
