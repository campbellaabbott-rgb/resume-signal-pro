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
  // Also "the employers it applies to for you" and "sends it to the
  // employers": /trust described the agent that way for months while this
  // check, which matched only "applies for you", reported every page clean
  // (2026-10-18 review).
  ["an agent that applies for you", /\bapplies for you\b|\bapply for you\b|\bsubmits? (?:applications? )?(?:for|on behalf of) you\b|\bsubmits end[- ]to[- ]end\b|\bsubmit applications for you\b|\bappl(?:y|ies) to\b[^.<]{0,40}\bfor you\b|\bsends it to the employers\b/i],
  ["auto mode", /\bauto mode\b/i],
  ["the Agent plan's trial", /\bdays free for first-time subscribers\b/i],
  ["'verified openings'", /\bverified (?:open roles|openings|open positions|jobs)\b/i],
  // We read employers' feeds through the day; we do not verify each role
  // ("re-verified through the day" sat in llms.txt while this list matched
  // only "verified openings"). A tool's "so a shortlist is re-verified" is the
  // reader's own check, not a claim about the board, and stays.
  ["'re-verified'", /\bre-?verified (?:through|all|throughout|every|continuously|within)\b|\bcontinuously re-?verified\b|\b(?:postings?|openings?|jobs?|roles?|feeds?|boards?) (?:are |is |get |were )?re-?verified\b/i],
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

/** The types a JSON-LD node names: its @type as written, a string or an array of strings. */
export const ldTypes = (node) => (node && typeof node === "object" && !Array.isArray(node) ? [].concat(node["@type"] ?? []).filter((t) => typeof t === "string") : []);

/**
 * Every node in a set of JSON-LD blocks, at any depth (an @graph included),
 * whose types include `type`: a string names one type exactly, a RegExp is
 * tested against each type as written ("schema:Offer",
 * "https://schema.org/Offer", a subtype such as ProfessionalService).
 */
export function nodesOfType(blocks, type) {
  const out = [];
  const is = typeof type === "string" ? (t) => t === type : (t) => type.test(t);
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== "object") return;
    if (ldTypes(v).some(is)) out.push(v);
    for (const x of Object.values(v)) walk(x);
  };
  walk(blocks);
  return out;
}

/** A Service, or any subtype of one, however its @type is prefixed (round 3 review, 2026-10-25). */
export const SERVICE_TYPE = /Service$/;

/**
 * The number a JSON-LD price field states, however it is written: 29, "29",
 * "29.00", "29,00", "29 USD", "USD 29" and "$29" all read 29; "1,029" reads
 * 1029 and "1.029,50" reads 1029.5. A comma followed by exactly two digits at
 * the end is a decimal point (round 3 review: "29,00" read 2900). null when
 * it states no number.
 */
export function ldPriceNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = /\d[\d.,]*/.exec(v);
  if (!m) return null;
  let tok = m[0].replace(/[.,]+$/, "");
  if (/,\d{2}$/.test(tok) && !/\.\d{1,2}$/.test(tok)) tok = tok.replace(/\./g, "").replace(/,(\d{2})$/, ".$1");
  const n = Number(tok.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const PRICE_FIELDS = ["price", "lowPrice", "highPrice", "minPrice", "maxPrice"];
/** An offer or a price specification, by type as written: "Offer", "schema:Offer", "https://schema.org/AggregateOffer", "UnitPriceSpecification". */
const PRICED_TYPE = (t) => /(?:^|[:/])(?:Offer|AggregateOffer|\w*PriceSpecification)$/.test(t);
/** Keys whose objects are priced whatever their @type: schema.org reads an untyped object under offers or makesOffer as an Offer. */
const PRICED_KEYS = new Set(["priceSpecification", "offers", "makesOffer"]);

/**
 * Every retired price an offer states in a set of JSON-LD blocks, at any
 * depth, as "field value" strings: a node whose types include Offer,
 * AggregateOffer or a price specification (an @type string or an array), and
 * any object under a priceSpecification key whatever its type, read through
 * its price, lowPrice, highPrice, minPrice and maxPrice, a number or a
 * string with its currency. The 2026-10-25 recheck found three shapes the
 * Offer-only walk passed: an array @type, a nested priceSpecification and a
 * price written with its currency. The round 3 review found four more: an
 * untyped object under offers (schema.org and Google read it as an Offer), a
 * decimal-comma price ("29,00"), and an @type written "schema:Offer" or
 * "https://schema.org/Offer"; each is read now.
 */
export function retiredOfferPrices(blocks, prices = [99, 29]) {
  const out = [];
  const walk = (v, priced = false) => {
    if (Array.isArray(v)) { v.forEach((x) => walk(x, priced)); return; }
    if (!v || typeof v !== "object") return;
    if (priced || ldTypes(v).some(PRICED_TYPE)) {
      for (const k of PRICE_FIELDS) if (k in v && prices.includes(ldPriceNumber(v[k]))) out.push(`${k} ${typeof v[k] === "string" ? v[k] : String(v[k])}`);
    }
    for (const [k, x] of Object.entries(v)) walk(x, PRICED_KEYS.has(k));
  };
  walk(blocks);
  return out;
}

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

/**
 * THE RETIRED PASS'S OWN COPY, clause by clause (round 3 review, 2026-10-25).
 * A pattern for "the pass sold by its price" failed one recheck and then
 * another, so llms-full.txt is judged against the copy that sold the pass:
 * every English string in src/i18n/locales/en.json that named the pass or
 * filled its price, hours or applications (git 23e294ac..9f6f3fce), and every
 * literal of the bake's that did (scripts/prerender-seo.mjs, 6961adac to
 * f04bf146), rendered with the pass's own figures ($29, 6 hours, 10
 * applications; the PASS mirror never changed them) and cut into clauses that
 * name the pass, its price, its hours, its applications or its terms. Two
 * clauses that use the word for something else (an ATS score is not a pass
 * mark; a probe is not counted as a pass) are left out. A clause the file
 * carries, in any case, with "six" or "6", "$29", "$29.00" or "29 USD", is
 * the retired pass's copy. A paraphrase in new words is not in this list and
 * passes 76 L9-11, which says so: a price rule beside the list failed true
 * copy and missed paraphrases, so L9-11 prints every other sentence priced at
 * $29 that does not name Freelance Boost as INFO instead (round 4).
 */
export const RETIRED_PASS_COPY = [
  "$29 for 6 hours and 10 applications",
  "6 hours for $29",
  "6 hours for an agent you bring yourself",
  "6 hours with your agent",
  "6 hours with your agent and 10 applications for $29",
  "a $29 pass for your own agent",
  "a $29 pass gives it 6 hours and 10 applications",
  "A $29 pass gives it 6 hours at full speed to research the board and apply to 10 jobs for you",
  "A $29 pass gives your agent 6 hours to search the board and apply to 10 jobs for you",
  "a live Agent Pass on an account-linked key raises both for its hours",
  "a live pass raises both for its hours",
  "a paid key or a live Agent Pass",
  "A pass for your agent",
  "A pass is bound to your account",
  "an account holds one open pass at a time",
  "an account-linked key with an Agent plan or a live Agent Pass",
  "An unstarted pass keeps for",
  "and its pass is on that account",
  "applications need a pass or the Agent plan",
  "apply on the $99/month Agent plan or a $29 pass",
  "Buy or open your pass",
  "Could not read your pass right now",
  "it carries the pass",
  "m of 6 hours left",
  "Morning Queue and the Agent Pass earn no commission",
  "No pass on this account",
  "No pass on this account yet",
  "Or a one-off pass for your own AI agent",
  "Pass not started ·",
  "Sign in to buy the pass",
  "so it does not open a pass",
  "the pass can be used only once sign-in is switched on",
  "the pass never does",
  "This checkout is not matched to a pass yet",
  "This payment did not create a second pass",
  "To spend the pass",
  "You hold a pass",
  "Your 6 hours begin at your agent's first call",
  "Your Agent Pass funds this agent",
  "Your existing agent key already carries the pass",
  "Your last pass ended on",
  "Your last pass expired unused on",
];

/** Text as RETIRED_PASS_COPY is matched: lower case, plain quotes and spaces, "six" as 6, every way of writing $29 as "$29". */
export const passCopyNorm = (s) => String(s ?? "").toLowerCase()
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
  .replace(/\bsix\b/g, "6").replace(/\bten\b/g, "10")
  .replace(/\$\s?29(?:\.00)?(?!\d)/g, "$29").replace(/\b(?:usd\s?29|29\s?(?:usd|us dollars|dollars))\b/g, "$29")
  .replace(/[-\u2010\u2013\u2014]/g, " ").replace(/\s+/g, " ");

/** Every clause of the retired pass's own copy a served document carries. */
export function retiredPassCopyIn(text) {
  const t = passCopyNorm(text);
  return RETIRED_PASS_COPY.filter((c) => t.includes(passCopyNorm(c)));
}
