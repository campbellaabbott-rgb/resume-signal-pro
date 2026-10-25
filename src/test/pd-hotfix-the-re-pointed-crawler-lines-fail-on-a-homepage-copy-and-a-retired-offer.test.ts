// @vitest-environment node
//
// Node, not jsdom: this file runs verifier lines in bash, with stubs for the
// network, through child_process.
/**
 * THE RE-POINTED CRAWLER LINES FAIL ON A HOMEPAGE COPY AND A RETIRED OFFER
 * (profiles+design hotfix, fix round of 2026-10-24).
 *
 * The hotfix re-pointed four crawler lines the apply pivot had made stale.
 * The review found that each could still PASS on a page that proves nothing:
 *   - 65's /agent line PASSed on the homepage file, which also carries the
 *     apply-yourself sentence (the host serves the homepage at an unknown
 *     path), so it now needs /agent's own canonical;
 *   - 7d's /agents line PASSed on the homepage file, and on an /agents that
 *     sold the plan and the pass only through JSON-LD Offers (an Offer's
 *     price has no dollar sign, and the retired names are judged only on a
 *     sales page), so it now needs /agents' own canonical and walks every
 *     Offer for 99 and 29, as 76 L1-08 does;
 *   - 76 L9-11 said "names no pass" while it matched only two of the pass's
 *     names ("a six-hour pass for $29" passed), so it now also reads 83 C1's
 *     retired list (scripts/prerender-retired.mjs) and the six-hour name;
 *   - 76 L1-08 PASSed on a homepage with no JSON-LD at all, so it now needs
 *     at least one parsed block before it can say the homepage sells nothing.
 * Each is run on the page that fooled it (FAIL), on the page it was written
 * to catch (FAIL) and on today's true page (PASS).
 *
 * The recheck of 2026-10-25 found shapes the Offer walk still passed (an
 * @type array, a nested priceSpecification, "29 USD"), a Service nested in
 * an @graph, and a $29 pass sold without the word "pass". 7d and 76 now read
 * offers and services with the retired list's own walks
 * (retiredOfferPrices and nodesOfType), and L9-11 reads $29 beside hours,
 * limits or a quota.
 *
 * The round 3 review (2026-10-25) found: 7d judged /pricing's JSON-LD only as
 * text, so an @type array or a nested priceSpecification at 29 or 99 passed
 * there; the walks missed an untyped object under offers or makesOffer, a
 * decimal-comma price ("29,00"), an @type written "schema:Offer" or with the
 * schema.org URL, and a Service subtype; and L9-11's price rule was one more
 * pattern, missing "$29.00", "6h" and "caps" and failing a true Freelance
 * Boost sentence beside "48 hours". L9-11 is now judged by the retired pass's
 * own copy (RETIRED_PASS_COPY, every clause that sold it, from git history),
 * with the price rule kept as a backstop for a paraphrase.
 *
 * The final recheck of round 3 found the backstop still a pattern list: it
 * passed paraphrases that name the price without its words ("a 360-minute
 * window of higher throughput for $29") and FAILed true copy (a $29 Freelance
 * Boost whose name comes after the price or more than 40 characters before
 * it, a $29 resume review returned within 24 hours). Round 4 makes the
 * backstop INFO: the retired copy, the names (and the pass page's address,
 * which the bake linked) and 83 C1's list stay the FAIL judge, and every
 * sentence that prices something at $29 without naming Freelance Boost is
 * printed for a person to read. Every historical pass sentence 474dca30
 * FAILed (fixtures/retired-pass-sentences-2026-10-25.json) still FAILs.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { APPLY_YOURSELF_LINE } from "../../scripts/prerender-retired.mjs";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SITE = "https://resumebooster.work";
const MAIN = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const S65 = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/65-wave2-entitlements.sh"), "utf8");
const S76 = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/76-wave3-seo-content.sh"), "utf8");

/** 65's crawler /agent line, from the curl to its closing fi. */
const AGENT_LINE = (/^AG65=\$\(curl[\s\S]*?\nelse echo [^\n]*; fi$/m.exec(S65) ?? [""])[0];
/** 7d, from the /pricing curl to the end of its node block. */
const BLOCK_7D = (/^PR=\$\(curl[\s\S]*?\n'\n(?=\necho "== 7e)/m.exec(MAIN) ?? [""])[0];

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

/** Run a bash fragment whose curl answers from `pages` (keyed by the path the URL ends with). */
function bash(fragment: string, pages: Record<string, string>): string[] {
  const dir = mkdtempSync(join(tmpdir(), "vd-pdfix-"));
  dirs.push(dir);
  const cases = Object.entries(pages).map(([path, body], i) => {
    writeFileSync(join(dir, `page${i}.html`), body);
    return `    *${JSON.stringify(path)}) cat ${JSON.stringify(join(dir, `page${i}.html`))};;`;
  }).join("\n");
  const prelude = `set -u\nSITE=${SITE}; UA=ua\ncurl() {\n  local u="\${@: -1}"\n  case "$u" in\n${cases}\n    *) : ;;\n  esac\n}\n`;
  writeFileSync(join(dir, "run.sh"), `${prelude}${fragment}\n`);
  const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return out.split("\n").filter(Boolean);
}

type Route = { match: string; status?: number; body?: string };
const FETCH_STUB = `const fs=require("fs");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
globalThis.fetch=async(url)=>{const u=String(url);
const r=routes.find((x)=>new RegExp(x.match).test(u));
return r?new Response(r.body??"",{status:r.status??200}):new Response("",{status:404});};
`;
/** Source section 76 in bash with node's fetch answering from `routes`. */
function run76(routes: Route[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), "vd-pdfix76-"));
  dirs.push(dir);
  writeFileSync(join(dir, "fetch.cjs"), FETCH_STUB);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "run.sh"), `set -u\nK=pk_test; B=https://p.supabase.co; SITE=${SITE}; UA=ua\ncurl() { :; }\n. ${JSON.stringify(resolve(ROOT, "scripts/verify-deploy.d/76-wave3-seo-content.sh"))}\n`);
  const env = {
    ...process.env, HOME: dir, VD_ROUTES: join(dir, "routes.json"),
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "fetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return out.split("\n").filter(Boolean);
}
const esc = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const route = (path: string, body: string, status = 200): Route => ({ match: `^${esc(SITE + path)}$`, status, body });

/** A line with this status whose message (after "PASS  ") matches. */
const has = (lines: string[], status: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${status}  `) && re.test(l.slice(status.length + 2)));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

// ── the pages ───────────────────────────────────────────────────────────────
const pad = "<p>" + "Search the live board, read each posting in full. ".repeat(60) + "</p>";
const ld = (o: object) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const WEBSITE = ld({ "@context": "https://schema.org", "@type": "WebSite", name: "Resume Booster", url: `${SITE}/` });
const doc = (title: string, canonical: string | null, head: string, body: string) =>
  `<!doctype html><html><head><title>${title}</title>${canonical ? `<link rel="canonical" href="${canonical}" />` : ""}${head}</head><body>${body}${pad}</body></html>`;
const HOME_TITLE = "Resume Booster — 900,000+ Live Jobs Straight From Employers";
/** The homepage file, which the host also serves at an unknown path: it carries the apply-yourself sentence. */
const HOMEPAGE = doc(HOME_TITLE, `${SITE}/`, WEBSITE, `<h1>Live jobs straight from employers</h1><p>${APPLY_YOURSELF_LINE}</p>`);
const AGENT_PAGE = doc("Apply with your own AI: Claude, ChatGPT or Claude Code", `${SITE}/agent`, WEBSITE, `<h1>Apply with your own AI</h1><p>${APPLY_YOURSELF_LINE}</p>`);
const AGENT_OLD = doc("Apply Agent", `${SITE}/agent`, WEBSITE, "<p>The Apply Agent plan is $99/month, 7 days free for first-time subscribers.</p>");
const AGENTS_PAGE = doc("Connect Your Agent — MCP Server for the Live Job Board", `${SITE}/agents`, WEBSITE, "<h1>Connect your agent</h1><p>Search the board from Claude, ChatGPT or Claude Code.</p>");
const AGENTS_OFFERS = doc("Connect Your Agent — MCP Server for the Live Job Board", `${SITE}/agents`,
  WEBSITE + ld({ "@context": "https://schema.org", "@type": "Service", name: "Apply Agent", offers: [{ "@type": "Offer", price: "99", priceCurrency: "USD" }, { "@type": "Offer", price: "29", priceCurrency: "USD" }] }),
  "<h1>Connect your agent</h1>");
const AGENTS_OLD = doc("Connect Your Agent", `${SITE}/agents`, WEBSITE, "<p>The Apply Agent plan is $99/month. A $29 pass raises your limits for six hours.</p>");
const PRICING = doc("Pricing", `${SITE}/pricing`, `<meta name="description" content="One-time tools $2–$59; Pro $45/month.">`, "<h2>Pro</h2><p>Pro is $45/month and renews every month until you cancel.</p>");
const LLMS_FULL = "# Resume Booster\n\n- MCP server: work.resumebooster/jobs in the official MCP registry.\n- /companies — the 485 employers this site gives a page of their own.\n";

describe("65: the crawler's /agent must be /agent's own page", () => {
  it("the line was found", () => { expect(AGENT_LINE).toMatch(/apply yourself on the employer/); });

  it("today's /agent PASSes", () => {
    const lines = bash(AGENT_LINE, { "/agent": AGENT_PAGE });
    expect(lines, show(lines)).toEqual(["PASS  /agent as served to a crawler names no trial and no plan price, is its own page, and says to apply yourself on the employer's own site"]);
  });

  it("the homepage file served at /agent FAILs, though it carries the apply-yourself sentence", () => {
    const lines = bash(AGENT_LINE, { "/agent": HOMEPAGE });
    expect(lines.length, show(lines)).toBe(1);
    expect(lines[0]).toMatch(/^FAIL {2}\/agent as served to a crawler is not \/agent's own page \(canonical https:\/\/resumebooster\.work\/\)/);
  });

  it("the retired /agent still FAILs on its trial", () => {
    const lines = bash(AGENT_LINE, { "/agent": AGENT_OLD });
    expect(lines[0], show(lines)).toMatch(/^FAIL {2}\/agent as served to a crawler still names the retired agent plan's trial/);
  });
});

describe("7d: /agents must be its own page and offer neither retired price in its JSON-LD", () => {
  it("the block was found", () => { expect(BLOCK_7D).toMatch(/prerender-retired\.mjs/); });

  it("today's /agents PASSes", () => {
    const lines = bash(BLOCK_7D, { "/pricing": PRICING, "/agents": AGENTS_PAGE });
    expect(has(lines, "PASS", /^\/agents is its own page and carries no retired claim, no Offer at 99 or 29/), show(lines)).toBe(true);
    expect(lines.filter((l) => l.includes("/agents") && !l.startsWith("PASS")), show(lines)).toEqual([]);
  });

  it("the homepage file served at /agents FAILs", () => {
    const lines = bash(BLOCK_7D, { "/pricing": PRICING, "/agents": HOMEPAGE });
    expect(has(lines, "FAIL", /^\/agents as served to a crawler is not its own page \(canonical "https:\/\/resumebooster\.work\/"\)/), show(lines)).toBe(true);
    expect(lines.filter((l) => l.startsWith("PASS") && l.includes("/agents")), show(lines)).toEqual([]);
  });

  it("an /agents that sells the plan and the pass only through JSON-LD Offers FAILs", () => {
    const lines = bash(BLOCK_7D, { "/pricing": PRICING, "/agents": AGENTS_OFFERS });
    expect(has(lines, "FAIL", /^\/agents offers a retired price in its JSON-LD: price 99, price 29/), show(lines)).toBe(true);
  });

  it("the old /agents still FAILs on its prices", () => {
    const lines = bash(BLOCK_7D, { "/pricing": PRICING, "/agents": AGENTS_OLD });
    expect(has(lines, "FAIL", /^\/agents carries a retired price or claim/), show(lines)).toBe(true);
  });
});

describe("76: L1-08 needs JSON-LD to judge, L9-11 reads the retired list", () => {
  const routes = (home: string, llmsFull: string) => [route("/", home), route("/llms-full.txt", llmsFull)];
  const homeNoLd = HOMEPAGE.replace(WEBSITE, "");

  it("today's homepage (a WebSite block, no Service, no retired Offer) PASSes L1-08; today's llms-full PASSes L9-11", () => {
    const lines = run76(routes(HOMEPAGE, LLMS_FULL));
    expect(has(lines, "PASS", /the homepage carries no Service block and no Offer at \$99 or \$29/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /\/llms-full\.txt names the registry entry, names no pass and carries no retired claim by 83 C1's list \(L9-11\)/), show(lines)).toBe(true);
  });

  it("a homepage with no JSON-LD at all FAILs L1-08 instead of passing", () => {
    const lines = run76(routes(homeNoLd, LLMS_FULL));
    expect(has(lines, "FAIL", /the homepage carries no parseable JSON-LD at all, so whether it sells the retired agent cannot be judged \(L1-08/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /no Service block and no Offer/), show(lines)).toBe(false);
  });

  it("the homepage Service block with offers at 99 and 29 still FAILs L1-08", () => {
    const svc = HOMEPAGE.replace(WEBSITE, WEBSITE + ld({ "@context": "https://schema.org", "@type": "Service", name: "Apply Agent", offers: [{ "@type": "Offer", price: "99" }, { "@type": "Offer", price: "29" }] }));
    const lines = run76(routes(svc, LLMS_FULL));
    expect(has(lines, "FAIL", /the homepage still sells the retired apply agent: 1 Service block/), show(lines)).toBe(true);
  });

  it("llms-full selling a six-hour pass for $29 FAILs L9-11 (the review's case), as does the old pass clause", () => {
    const sixHour = run76(routes(HOMEPAGE, `${LLMS_FULL}- Buy a six-hour pass for $29 to raise your limits.\n`));
    expect(has(sixHour, "FAIL", /\/llms-full\.txt \(HTTP 200\): .*still names the retired pass.*the \$29 Agent Pass .*\(L9-11\)/), show(sixHour)).toBe(true);
    const old = run76(routes(HOMEPAGE, `${LLMS_FULL}- a live Agent Pass on an account-linked key raises both for its hours\n`));
    expect(has(old, "FAIL", /\/llms-full\.txt \(HTTP 200\): still says a pass raises the \/v1 limits, still names the retired pass/), show(old)).toBe(true);
  });
});

// ── the recheck of 2026-10-25: the shapes the Offer-only walk passed ────────
// A harness built from 7d's expression found three shapes of a retired offer
// on /agents that PASSed: an @type written as an array, a price inside a
// nested priceSpecification, and a price written with its currency. 76 L1-08
// shared the walk and read Service blocks only at the top level, and L9-11
// passed a $29 pass sold without the word "pass".
const agentsWith = (o: object) => doc("Connect Your Agent — MCP Server for the Live Job Board", `${SITE}/agents`, WEBSITE + ld({ "@context": "https://schema.org", ...o }), "<h1>Connect your agent</h1>");
const RECHECK_OFFERS: Array<[string, object]> = [
  ["an @type array", { "@type": ["Offer"], price: "99", priceCurrency: "USD" }],
  ["a nested priceSpecification", { "@type": "Offer", priceSpecification: { "@type": "UnitPriceSpecification", price: 99, priceCurrency: "USD" } }],
  ["a priceSpecification with no @type", { "@type": "Product", name: "x", offers: { "@type": "Offer", priceSpecification: { price: "29" } } }],
  ["a price with its currency", { "@type": "Offer", price: "29 USD" }],
  ["an AggregateOffer in an array @type with a lowPrice", { "@type": ["AggregateOffer", "Thing"], lowPrice: "$29.00", highPrice: "99" }],
];

describe("7d and 76 read every shape of a retired offer (recheck, 2026-10-25)", () => {
  it("the retired list's walk finds each shape, and an on-sale price is not one", async () => {
    const R = await import("../../scripts/prerender-retired.mjs");
    for (const [what, o] of RECHECK_OFFERS) expect(R.retiredOfferPrices([o]).length, what).toBeGreaterThan(0);
    expect(R.retiredOfferPrices([{ "@type": "Offer", price: "45" }, { "@type": "Offer", price: "29.99" }, { "@type": "Offer", price: "290 USD" }])).toEqual([]);
    expect(R.retiredOfferPrices([{ "@type": "Offer", price: "29 USD" }])).toEqual(["price 29 USD"]);
    expect(R.ldPriceNumber("USD 1,029.50")).toBe(1029.5);
    expect(R.ldPriceNumber("free")).toBeNull();
    expect(R.nodesOfType([{ "@graph": [{ "@type": ["Service", "Thing"], name: "x" }] }], "Service").length).toBe(1);
  });

  for (const [what, o] of RECHECK_OFFERS) {
    it(`7d FAILs an /agents whose JSON-LD prices a retired offer through ${what}`, () => {
      const lines = bash(BLOCK_7D, { "/pricing": PRICING, "/agents": agentsWith(o) });
      expect(has(lines, "FAIL", /^\/agents offers a retired price in its JSON-LD: /), show(lines)).toBe(true);
      expect(has(lines, "PASS", /^\/agents is its own page/), show(lines)).toBe(false);
    });
  }

  it("7d still PASSes an /agents whose only Offer is a price on sale", () => {
    const lines = bash(BLOCK_7D, { "/pricing": PRICING, "/agents": agentsWith({ "@type": "Offer", price: "45", priceCurrency: "USD" }) });
    expect(has(lines, "PASS", /^\/agents is its own page and carries no retired claim, no Offer at 99 or 29/), show(lines)).toBe(true);
  });

  const routes = (home: string, llmsFull: string) => [route("/", home), route("/llms-full.txt", llmsFull)];
  it("76 L1-08 FAILs a Service nested in an @graph that prices through a priceSpecification, and each recheck shape on the homepage", () => {
    const graph = HOMEPAGE.replace(WEBSITE, ld({ "@context": "https://schema.org", "@graph": [{ "@type": "WebSite", name: "Resume Booster" }, { "@type": "Service", name: "Apply Agent", offers: { "@type": "Offer", priceSpecification: { "@type": "UnitPriceSpecification", price: 99 } } }] }));
    const g = run76(routes(graph, LLMS_FULL));
    expect(has(g, "FAIL", /the homepage still sells the retired apply agent: 1 Service block\(s\), Offers at \["price 99"\]/), show(g)).toBe(true);
    const svcOnly = HOMEPAGE.replace(WEBSITE, ld({ "@context": "https://schema.org", "@graph": [{ "@type": "WebSite", name: "Resume Booster" }, { "@type": ["Service"], name: "Apply Agent" }] }));
    expect(has(run76(routes(svcOnly, LLMS_FULL)), "FAIL", /the homepage still sells the retired apply agent: 1 Service block/)).toBe(true);
    const offer = HOMEPAGE.replace(WEBSITE, WEBSITE + ld({ "@context": "https://schema.org", "@type": "Offer", price: "29 USD" }));
    expect(has(run76(routes(offer, LLMS_FULL)), "FAIL", /the homepage still sells the retired apply agent: 0 Service block\(s\), Offers at \["price 29 USD"\]/)).toBe(true);
  });

  it("76 L9-11 FAILs a $29 pass in the pass's own words, prints a $29 paraphrase as INFO, and keeps passing Freelance Boost at $29", () => {
    const sold = run76(routes(HOMEPAGE, `${LLMS_FULL}- Raise your limits for six hours for $29.\n`));
    expect(has(sold, "FAIL", /\/llms-full\.txt \(HTTP 200\): still carries the retired pass's own copy \("6 hours for \$29"\) \(L9-11\)/), show(sold)).toBe(true);
    // Round 4: the price is read as INFO, never FAIL.
    const usd = run76(routes(HOMEPAGE, `${LLMS_FULL}- Six hours of higher quotas: 29 USD.\n`));
    expect(has(usd, "PASS", /\/llms-full\.txt names the registry entry, names no pass and carries no retired claim/), show(usd)).toBe(true);
    expect(has(usd, "INFO", /^L9-11 backstop: \/llms-full\.txt prices something at \$29 without naming Freelance Boost: "- Six hours of higher quotas: 29 USD\."/), show(usd)).toBe(true);
    const boost = run76(routes(HOMEPAGE, `${LLMS_FULL}- A: Ours does: Freelance Boost ($29) takes a guided project intake and applies it to your profile.\n`));
    expect(has(boost, "PASS", /\/llms-full\.txt names the registry entry, names no pass and carries no retired claim/), show(boost)).toBe(true);
  });
});

describe("the lines stay where this test reads them", () => {
  it("76 still carries the L1-08 and L9-11 judges", () => {
    expect(S76).toMatch(/L1-08/);
    expect(S76).toMatch(/L9-11/);
  });
});

// ── round 3 (2026-10-25) ────────────────────────────────────────────────────
const pricingWith = (o: object) => PRICING.replace("</head>", `${ld({ "@context": "https://schema.org", ...o })}</head>`);
const ROUND3_OFFERS: Array<[string, object]> = [
  ["an untyped object under offers", { "@type": "Product", name: "x", offers: { price: "29" } }],
  ["untyped offers in an array", { "@type": "Product", name: "x", offers: [{ price: 99 }] }],
  ["a decimal-comma price", { "@type": "Offer", price: "29,00" }],
  ["an @type written schema:Offer", { "@type": "schema:Offer", price: "29" }],
  ["an @type written as the schema.org URL", { "@type": "https://schema.org/Offer", price: "99" }],
  ["an untyped object under makesOffer", { "@type": "Organization", name: "x", makesOffer: { price: "29" } }],
];

describe("round 3: /pricing's JSON-LD is walked, and the walks read four more shapes", () => {
  it("the retired list's walk finds each round 3 shape; prices on sale and the live /pricing AggregateOffer are not retired", async () => {
    const R = await import("../../scripts/prerender-retired.mjs");
    for (const [what, o] of ROUND3_OFFERS) expect(R.retiredOfferPrices([o]).length, what).toBeGreaterThan(0);
    expect(R.ldPriceNumber("29,00")).toBe(29);
    expect(R.ldPriceNumber("1.029,50")).toBe(1029.5);
    expect(R.ldPriceNumber("1,029")).toBe(1029);
    expect(R.retiredOfferPrices([{ "@type": "AggregateOffer", lowPrice: "0", highPrice: "59", offerCount: 12 }, { "@type": "Offer", price: "0" }, { "@type": "Product", offers: { price: "45" } }])).toEqual([]);
    expect(R.nodesOfType([{ "@type": "ProfessionalService" }, { "@type": "schema:Service" }, { "@type": "WebSite" }], R.SERVICE_TYPE).length).toBe(2);
  });

  for (const [what, o] of [...RECHECK_OFFERS.slice(0, 2), ...ROUND3_OFFERS]) {
    it(`7d FAILs a /pricing whose JSON-LD prices a retired offer through ${what}`, () => {
      const lines = bash(BLOCK_7D, { "/pricing": pricingWith(o), "/agents": AGENTS_PAGE });
      expect(has(lines, "FAIL", /^\/pricing offers a retired price in its JSON-LD: /), show(lines)).toBe(true);
      expect(has(lines, "PASS", /^\/pricing carries no retired claim/), show(lines)).toBe(false);
    });
  }

  it("7d PASSes today's /pricing (an AggregateOffer from 0 to 59) and the /pricing with no JSON-LD", () => {
    for (const page of [PRICING, pricingWith({ "@type": "SoftwareApplication", name: "Resume Booster", offers: { "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: "0", highPrice: "59", offerCount: 12 } })]) {
      const lines = bash(BLOCK_7D, { "/pricing": page, "/agents": AGENTS_PAGE });
      expect(has(lines, "PASS", /^\/pricing carries no retired claim by 83 C1's list and no JSON-LD offer at 99 or 29/), show(lines)).toBe(true);
    }
  });

  for (const [what, o] of ROUND3_OFFERS) {
    it(`7d FAILs an /agents whose JSON-LD prices a retired offer through ${what}`, () => {
      const lines = bash(BLOCK_7D, { "/pricing": PRICING, "/agents": agentsWith(o) });
      expect(has(lines, "FAIL", /^\/agents offers a retired price in its JSON-LD: /), show(lines)).toBe(true);
    });
  }

  const routes = (home: string, llmsFull: string) => [route("/", home), route("/llms-full.txt", llmsFull)];
  it("76 L1-08 FAILs a Service subtype, a prefixed Service, and an untyped offer under offers on the homepage", () => {
    for (const [what, block, re] of [
      ["ProfessionalService", { "@type": "ProfessionalService", name: "Apply Agent" }, /1 Service block/],
      ["schema:Service", { "@type": "schema:Service", name: "Apply Agent" }, /1 Service block/],
      ["an untyped offer", { "@type": "Product", name: "Agent", offers: { price: "99" } }, /Offers at \["price 99"\]/],
    ] as Array<[string, object, RegExp]>) {
      const home = HOMEPAGE.replace(WEBSITE, WEBSITE + ld({ "@context": "https://schema.org", ...block }));
      const lines = run76(routes(home, LLMS_FULL));
      expect(has(lines, "FAIL", /the homepage still sells the retired apply agent/), `${what}${show(lines)}`).toBe(true);
      expect(lines.some((l) => l.startsWith("FAIL") && re.test(l)), `${what}${show(lines)}`).toBe(true);
    }
  });
});

describe("round 3: L9-11 is judged by the retired pass's own copy, with the price rule as a backstop", () => {
  const routes = (home: string, llmsFull: string) => [route("/", home), route("/llms-full.txt", llmsFull)];
  const l911 = (extra: string) => run76(routes(HOMEPAGE, `${LLMS_FULL}${extra}\n`));
  const passes = (lines: string[]) => has(lines, "PASS", /\/llms-full\.txt names the registry entry, names no pass and carries no retired claim/);

  it("the copy is the pass's own: 42 clauses from git history, none in today's crawler copy, each naming the pass, its price, hours or terms", async () => {
    const R = await import("../../scripts/prerender-retired.mjs");
    expect(R.RETIRED_PASS_COPY.length).toBe(42);
    for (const c of R.RETIRED_PASS_COPY) expect(c, c).toMatch(/\$29|\b6 hours\b|\bpass\b|\bPass\b|\b10 (?:applications|jobs)\b/);
    // The homepage strip's pass line as the bake wrote it before the apply pivot (f04bf146^), in any case and number spelling.
    expect(R.retiredPassCopyIn("A $29.00 PASS gives it six hours at full speed to research the board and apply to ten jobs for you. Never renews; sign in to buy.")).toEqual(["A $29 pass gives it 6 hours at full speed to research the board and apply to 10 jobs for you"]);
    const bake = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");
    expect(R.retiredPassCopyIn(bake), "today's bake source carries a retired pass clause").toEqual([]);
  });

  for (const sentence of [
    "- Bring your own AI agent. A $29 pass gives it 6 hours at full speed to research the board and apply to 10 jobs for you. Never renews; sign in to buy.",
    "- Search free; apply on the $99/month Agent plan or a $29 pass.",
    "- Or a one-off pass for your own AI agent: $29 for 6 hours and 10 applications. Never renews.",
    "- Your 6 hours begin at your agent's first call.",
  ]) {
    it(`FAILs the retired copy: ${sentence.slice(2, 60)}`, () => {
      const lines = l911(sentence);
      expect(has(lines, "FAIL", /\/llms-full\.txt \(HTTP 200\): .*still carries the retired pass's own copy/), show(lines)).toBe(true);
    });
  }

  for (const sentence of ["- Six hours of unlimited searches: $29.00.", "- $29 for 6h of uncapped calls.", "- $29 one-time: higher rate caps until midnight."]) {
    it(`the backstop prints a paraphrase round 3 found passing as INFO, and the line does not FAIL on it (round 4): ${sentence.slice(2)}`, () => {
      const lines = l911(sentence);
      expect(passes(lines), show(lines)).toBe(true);
      expect(has(lines, "INFO", /^L9-11 backstop: \/llms-full\.txt prices something at \$29 without naming Freelance Boost/), show(lines)).toBe(true);
    });
  }

  for (const sentence of ["- Freelance Boost ($29): a one-time rewrite delivered within 48 hours.", "- Freelance Boost $29, no limits on edits."]) {
    it(`PASSes a true Freelance Boost sentence, with no backstop INFO: ${sentence.slice(2)}`, () => {
      const lines = l911(sentence);
      expect(passes(lines), show(lines)).toBe(true);
      expect(lines.some((l) => /L9-11 backstop/.test(l)), show(lines)).toBe(false);
    });
  }

  it("today's live llms-full shape (its only $29 is Freelance Boost) PASSes", () => {
    const lines = l911("- A: Ours does: Freelance Boost ($29) takes a guided project intake — or a pasted platform profile — and applies exactly the structure rules and bullet formula in this guide, using only facts you provide.");
    expect(passes(lines), show(lines)).toBe(true);
  });
});

// ── round 4 (2026-10-25): the price backstop is INFO ───────────────────────
const RETIRED = JSON.parse(readFileSync(resolve(__dirname, "fixtures/retired-pass-sentences-2026-10-25.json"), "utf8")) as {
  fail: Array<[sentence: string, source: string]>;
  excluded: Record<string, [source: string, why: string]>;
};
/** 76's L9-11 block, cut from the script: from the llms-full read to the L4-11 line. */
const L911_BLOCK = (() => {
  const a = S76.indexOf('  const lf = await get("/llms-full.txt");');
  const b = S76.indexOf("  if (/every employer with open roles/.test(lf.body))");
  return a > 0 && b > a ? S76.slice(a, b) : "";
})();
/** L9-11's lines for each sentence appended to today's llms-full, in one node process (the block as section 76 runs it). */
function l911Many(sentences: string[]): string[][] {
  expect(L911_BLOCK, "76's L9-11 block moved: RE-ANCHOR").toMatch(/retiredPassCopyIn/);
  const dir = mkdtempSync(join(tmpdir(), "vd-l911-"));
  dirs.push(dir);
  const code = `(async () => { const REPO_ROOT = ${JSON.stringify(ROOT)}; const res = [];
for (const s of ${JSON.stringify(sentences)}) { const lines = []; const out = (st, m) => lines.push(st.padEnd(5) + " " + m);
  const get = async () => ({ status: 200, body: ${JSON.stringify(LLMS_FULL)} + s + "\\n" });
  { ${L911_BLOCK} }
  res.push(lines); }
process.stdout.write(JSON.stringify(res)); })();`;
  writeFileSync(join(dir, "l911.js"), code);
  return JSON.parse(execFileSync(process.execPath, [join(dir, "l911.js")], { cwd: ROOT, encoding: "utf8", timeout: 55_000 })) as string[][];
}
const verdict = (lines: string[]) => (lines.find((l) => /\(L9-11\)$/.test(l)) ?? "").slice(0, 4);

describe("round 4: L9-11 FAILs on the pass's own copy, its names and the retired list; the price is INFO", () => {
  const passes = (lines: string[]) => has(lines, "PASS", /\/llms-full\.txt names the registry entry, names no pass and carries no retired claim/);
  const backstop = (lines: string[]) => lines.filter((l) => /L9-11 backstop/.test(l));

  it("every historical pass sentence 474dca30 FAILed still FAILs, and the pass page's address the bake linked FAILs now", () => {
    expect(RETIRED.fail.length).toBe(50);
    const lines = l911Many(RETIRED.fail.map(([t]) => t));
    const notFailing = RETIRED.fail.filter((_, i) => verdict(lines[i]) !== "FAIL").map(([t, src]) => `${t} (${src})`);
    expect(notFailing, "historical pass sentences L9-11 passes").toEqual([]);
    expect(RETIRED.fail.map(([t]) => t)).toContain("https://resumebooster.work /agents/pass");
    // A backstop line is never the reason: it is INFO.
    for (const ls of lines) for (const l of backstop(ls)) expect(l).toMatch(/^INFO/);
  });

  it("the strings left out are not the pass's crawler copy, each with why", () => {
    const why = Object.values(RETIRED.excluded).map(([, w]) => w);
    expect(why.length).toBe(17);
    for (const w of why) expect(w).toMatch(/^not the pass|^a JSON-LD key, a path or a CSS class|^a label on the pass page or the consent screen/);
  });

  // The final recheck's sentences, verbatim.
  const TRUE_COPY = [
    "$29 one-time Freelance Boost, delivered within 48 hours.",
    "Freelance Boost, our guided one-time profile rewrite for freelancers, costs $29 and is delivered within 48 hours.",
    "Resume review: $29, returned within 24 hours.",
  ];
  const PARAPHRASES = [
    "$29 unlocks a burst of uncapped agent calls on your account key.",
    "Agents can buy a 360-minute window of higher throughput for $29.",
    "One payment of $29 lifts your agent's daily ceiling for the rest of the day.",
  ];

  it("the three true sentences the recheck saw FAIL now PASS; the two that name Freelance Boost print no INFO", () => {
    const lines = l911Many(TRUE_COPY);
    TRUE_COPY.forEach((t, i) => expect(passes(lines[i]), `${t}\n${lines[i].join("\n")}`).toBe(true));
    expect(backstop(lines[0])).toEqual([]);
    expect(backstop(lines[1])).toEqual([]);
    expect(backstop(lines[2])).toEqual([expect.stringMatching(/^INFO +L9-11 backstop: \/llms-full\.txt prices something at \$29 without naming Freelance Boost: "Resume review: \$29, returned within 24 hours\."/)]);
  });

  it("the three paraphrases the recheck saw PASS print INFO, quoted, and never FAIL", () => {
    const lines = l911Many(PARAPHRASES);
    PARAPHRASES.forEach((t, i) => {
      expect(passes(lines[i]), `${t}\n${lines[i].join("\n")}`).toBe(true);
      expect(backstop(lines[i]), t).toEqual([expect.stringMatching(new RegExp(`^INFO +L9-11 backstop: /llms-full\\.txt prices something at \\$29 without naming Freelance Boost: "${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`))]);
    });
  });

  it("today's live llms-full shape prints no backstop INFO; six priced sentences print five and a count", () => {
    const [live] = l911Many(["- A: Ours does: Freelance Boost ($29) takes a guided project intake — or a pasted platform profile — and applies exactly the structure rules and bullet formula in this guide, using only facts you provide."]);
    expect(passes(live), live.join("\n")).toBe(true);
    expect(backstop(live)).toEqual([]);
    const [many] = l911Many([Array.from({ length: 6 }, (_, i) => `Thing ${i + 1} costs $29.`).join(" ")]);
    expect(backstop(many).length).toBe(6);
    expect(backstop(many)[5]).toMatch(/^INFO +L9-11 backstop: and 1 more sentence\(s\) priced at \$29 without naming Freelance Boost$/);
  });
});
