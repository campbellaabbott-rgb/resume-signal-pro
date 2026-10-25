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

  it("76 L9-11 FAILs a $29 pass sold without the word, and keeps passing Freelance Boost at $29", () => {
    const sold = run76(routes(HOMEPAGE, `${LLMS_FULL}- Raise your limits for six hours for $29.\n`));
    expect(has(sold, "FAIL", /\/llms-full\.txt \(HTTP 200\): still sells the retired pass by its price \("limits for six hours for \$29"\) \(L9-11\)/), show(sold)).toBe(true);
    const usd = run76(routes(HOMEPAGE, `${LLMS_FULL}- Six hours of higher quotas: 29 USD.\n`));
    expect(has(usd, "FAIL", /still sells the retired pass by its price/), show(usd)).toBe(true);
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
