// @vitest-environment node
/**
 * VERIFY SECTION 99 (THE HOMEPAGE AND PRICING SWITCH-OVER) FAILS WHAT IT
 * CLAIMS, AND SAYS INFO WHEN IT CANNOT JUDGE.
 *
 * scripts/verify-deploy.d/99-home-pricing.sh runs here in bash against a fake
 * curl, with the real build_ge cut from the verifier. The healthy site is this
 * checkout's own bake of "/" and "/pricing" (its board read answered from a
 * fixture, every other request refused), its builds the reservation's, its
 * entry carrying the homepage's strings. A healthy deploy prints no FAIL;
 * each claim, broken on its own, prints its FAIL; a read the section cannot
 * make prints INFO; and the section only sends GET and OPTIONS. The rendered
 * claims (C8, C9) are judged by verify-home-pricing-rendered.mjs's pure
 * judge, proved here on facts, and the section says INFO when the browser
 * run is skipped.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { judgeRendered } from "../../scripts/verify-home-pricing-rendered.mjs";

vi.setConfig({ testTimeout: 90_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99-home-pricing.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data")data=a[++i];else if(["-H","-m","-A"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
const key=method+" "+url+(data!==null?" "+data:"");
fs.appendFileSync(process.env.VD_CALLS,key+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
if(o&&o!=="/dev/null")fs.writeFileSync(o,r.body??"");else if(!o)out+=(r.body??"");
if(w)out+=w.replace("%{http_code}",String(st));
process.stdout.write(out);
`;

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };
const dirs: string[] = [];
const ROW = {
  sourcesFacet: { workday: 640000, oracle: 220000, greenhouse: 90000, usajobs: 50000, smartrecruiters: 40000, lever: 488 },
  openTotal: 1040488,
  as_of: "2026-10-17T22:45:00.000Z",
};
let HOME = "";
let PRICING = "";
const pad = "x".repeat(1500);
const ENTRY = `${pad};const s={hero:{sub:"Search postings from employers' own job boards and USAJOBS, then apply on the employer's site."}};`;
const TRUST_ON = `<html><body><main><h1>Trust</h1><p>${pad}</p></main></body></html>`;
const TRUST_OFF = `<html><body><main><h1>Trust</h1><p>The apply agent is switched off and sends it to no one.</p><p>${pad}</p></main></body></html>`;

beforeAll(() => {
  const out = mkdtempSync(join(tmpdir(), "vd-99-bake-"));
  dirs.push(out);
  mkdirSync(join(out, "dist", "assets"), { recursive: true });
  copyFileSync(join(ROOT, "index.html"), join(out, "dist", "index.html"));
  const stub = join(out, "stub-fetch.cjs");
  writeFileSync(stub, `
const row = ${JSON.stringify(ROW)};
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/\\/rest\\/v1\\/rpc\\/get_board_vendor_counts$/.test(url)) return new Response(JSON.stringify(row), { status: 200, headers: { "content-type": "application/json" } });
  throw new Error("stubbed network: " + url);
};`);
  execFileSync("node", [join(ROOT, "scripts/prerender-seo.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PRERENDER_OUT: out, VITE_SUPABASE_URL: "https://stub.supabase.test", VITE_SUPABASE_PUBLISHABLE_KEY: "stub-key", NODE_OPTIONS: `--require ${stub}` },
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
  });
  // The served "/" names its entry; the bake keeps the template's script tag.
  HOME = readFileSync(join(out, "dist", "index.html"), "utf8").replace("</head>", '<script type="module" crossorigin src="/assets/index-Abc123.js"></script></head>');
  PRICING = readFileSync(join(out, "dist", "pricing", "index.html"), "utf8");
}, 300_000);
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

interface Over {
  home?: string; pricing?: string; trust?: string; vc?: string; agent?: string; entry?: string | null;
  builds?: Record<string, string | null>; root?: string;
}
const BUILDS: Record<string, string> = {
  "free-keyword-scan": "free-keyword-scan.2026-10-25.2",
  "send-scan-report": "send-scan-report.2026-10-25.1",
  "send-search-digest": "send-search-digest.2026-10-25.1",
  "send-market-pulse": "send-market-pulse.2026-10-25.2",
  "create-subscription-checkout": "create-subscription-checkout.2026-10-26.1",
  "create-product-checkout": "create-product-checkout.2026-10-26.1",
};
const FN = "https://p\\.supabase\\.co";

function routes(over: Over = {}): Route[] {
  const builds = { ...BUILDS, ...(over.builds ?? {}) };
  return [
    ...Object.entries(builds).map(([fn, b]) => ({ match: `^OPTIONS ${FN}/functions/v1/${fn}$`, headers: b ? { "x-fn-build": b } : {} })),
    { match: "^GET https://site\\.test/$", body: over.home ?? HOME },
    { match: "^GET https://site\\.test/pricing$", body: over.pricing ?? PRICING },
    { match: "^GET https://site\\.test/trust$", body: over.trust ?? TRUST_ON },
    { match: `^GET ${FN}/rest/v1/rpc/get_board_vendor_counts$`, body: over.vc ?? JSON.stringify(ROW) },
    { match: `^GET ${FN}/rest/v1/rpc/agent_sender_public_status$`, body: over.agent ?? "true" },
    ...(over.entry === null ? [] : [{ match: "^GET https://site\\.test/assets/index-Abc123\\.js$", body: over.entry ?? ENTRY }]),
  ];
}

function run(over: Over = {}): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd-99-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes(over)));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "run.sh"), `set -u\nK=pk_test; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n` + SECTION.split("/tmp/").join(`${dir}/`));
  let out = "";
  try {
    out = execFileSync("bash", [join(dir, "run.sh")], {
      env: {
        ...process.env,
        PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
        VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
        VD99_RENDER: "0", VD99_REPO_ROOT: over.root ?? ROOT,
      },
      encoding: "utf8", timeout: 80_000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean) };
}
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
/** A line of this verdict whose message (after "PASS  ", "FAIL  ", "INFO  ") matches. */
const has = (lines: string[], s: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${s}  `) && re.test(l.slice(s.length + 2)));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

describe("section 99 on a healthy deploy", () => {
  it("prints no FAIL, passes every claim it reads, and only sends GET and OPTIONS", () => {
    const { lines, calls } = run();
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C10", "C11"]) expect(has(lines, "PASS", new RegExp(`^${c} `)), `${c}${show(lines)}`).toBe(true);
    expect(has(lines, "INFO", /^C8 C9 the headless run is skipped/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /^G4 /), show(lines)).toBe(true);
    for (const l of lines) expect(l, l).toMatch(/^(PASS|FAIL|INFO|==) /);
    expect(calls.length).toBeGreaterThan(5);
    for (const c of calls) expect(c, c).toMatch(/^(GET|OPTIONS) /);
  });

  it("a row that refreshed since the publish still passes C1 when it is within a tenth", () => {
    const { lines } = run({ vc: JSON.stringify({ ...ROW, openTotal: 1052000, as_of: "2026-10-17T23:00:00.000Z" }) });
    expect(has(lines, "PASS", /^C1 \/ prints 1,040,488 open postings counted .* the row has refreshed since/), show(lines)).toBe(true);
  });
});

describe("each claim can FAIL", () => {
  it("C1: no form, a different figure at the same moment, a figure far off, a floor, no count line", () => {
    expect(has(run({ home: HOME.replace(/<form[\s\S]*?<\/form>/, "") }).lines, "FAIL", /^C1 \/ serves the H1 .* no GET \/jobs form/)).toBe(true);
    expect(has(run({ vc: JSON.stringify({ ...ROW, openTotal: 1040000 }) }).lines, "FAIL", /^C1 \/ prints 1,040,488 .* the row says 1,040,000 at the same moment/)).toBe(true);
    expect(has(run({ vc: JSON.stringify({ ...ROW, openTotal: 600000, as_of: "2026-10-18T09:00:00.000Z" }) }).lines, "FAIL", /more than a tenth apart/)).toBe(true);
    expect(has(run({ home: HOME.replace("</main>", "<p>950,000+ open roles</p></main>") }).lines, "FAIL", /^C1 \/ prints a floored figure "950,000\+"/)).toBe(true);
    expect(has(run({ home: HOME.replace(/data-home-count=""/, "data-was-count") }).lines, "FAIL", /^C1 \/ carries no count line/)).toBe(true);
  });

  it("C2: the word verified, prose or structured data", () => {
    expect(has(run({ home: HOME.replace("</main>", "<p>Every opening verified daily.</p></main>") }).lines, "FAIL", /^C2 \/ carries the word verified/)).toBe(true);
    expect(has(run({ home: HOME.replace("</head>", '<script type="application/ld+json">{"@type":"Thing","description":"verified openings"}</script></head>') }).lines, "FAIL", /^C2 /)).toBe(true);
  });

  it("C3: a field link outside the category list", () => {
    expect(has(run({ home: HOME.replace("</main>", '<a href="/jobs/field/retail">Retail</a></main>') }).lines, "FAIL", /^C3 .*outside the category list: retail/)).toBe(true);
  });

  it("C4: a page that names an IP lookup, or forgets the time zone", () => {
    expect(has(run({ pricing: PRICING.replace("</main>", "<p>We check your IP address.</p></main>") }).lines, "FAIL", /^C4 \/pricing .*names "IP address"/)).toBe(true);
    expect(has(run({ home: HOME.split("time zone").join("clock") }).lines, "FAIL", /^C4 \/ .*does not name the currency and time-zone checks/)).toBe(true);
  });

  it("C5: a priced offer, a baked buy button, a price in the description", () => {
    const priced = '<script type="application/ld+json">{"@type":"SoftwareApplication","offers":[{"@type":"Offer","name":"Pro","price":"45","priceCurrency":"USD"}]}</script>';
    expect(has(run({ home: HOME.replace("</head>", `${priced}</head>`) }).lines, "FAIL", /^C5 .*\/ offers Pro at 45/)).toBe(true);
    expect(has(run({ pricing: PRICING.replace("</main>", "<button>Go Pro, $45 a month</button></main>") }).lines, "FAIL", /^C5 .*\/pricing bakes a buy control/)).toBe(true);
    expect(has(run({ pricing: PRICING.replace(/<meta name="description" content="[^"]*"/, '<meta name="description" content="Pro $45 a month"') }).lines, "FAIL", /^C5 .*description names a price/)).toBe(true);
  });

  it("C6: an older build, and a preflight with no build", () => {
    expect(has(run({ builds: { "free-keyword-scan": "free-keyword-scan.2026-10-14.31" } }).lines, "FAIL", /^C6 free-keyword-scan x-fn-build = free-keyword-scan\.2026-10-14\.31/)).toBe(true);
    expect(has(run({ builds: { "create-subscription-checkout": "create-subscription-checkout.2026-10-11.23" } }).lines, "FAIL", /^C6 create-subscription-checkout/)).toBe(true);
    expect(has(run({ builds: { "create-product-checkout": "create-product-checkout.2026-10-11.27" } }).lines, "FAIL", /^C6 create-product-checkout x-fn-build = create-product-checkout\.2026-10-11\.27 \(want create-product-checkout\.2026-10-26\.1 or later\)/)).toBe(true);
    expect(has(run({ builds: { "send-market-pulse": null } }).lines, "FAIL", /^C6 send-market-pulse preflight carries no x-fn-build/)).toBe(true);
  });

  it("C7: an entry without the homepage's sentences, one with the retired hero's, and none at all", () => {
    expect(has(run({ entry: `${pad};const s="Upload a résumé";` }).lines, "FAIL", /^C7 the React entry does not carry the homepage's sentences/)).toBe(true);
    expect(has(run({ entry: `${ENTRY}const o="Apply yourself, with your own AI's help.";` }).lines, "FAIL", /^C7 .*retired hero's "Apply yourself, with your own AI"/)).toBe(true);
    expect(has(run({ entry: null }).lines, "FAIL", /^C7 the served \/ names no readable/)).toBe(true);
  });

  it("C10: a live agent beside a never-submit promise", () => {
    expect(has(run({ home: HOME.replace("</main>", "<p>We never submit an application for you.</p></main>") }).lines, "FAIL", /^C10 the apply agent is live .* \/ still promise never to submit/)).toBe(true);
  });

  it("C11: no Pro currency sentence, a promise of your local currency, an offer without its sentence", () => {
    expect(has(run({ pricing: PRICING.split("Pro is billed in US dollars").join("Pro is billed") }).lines, "FAIL", /^C11 \/pricing does not say Pro is billed in US dollars/)).toBe(true);
    expect(has(run({ home: HOME.replace("</main>", "<p>Charged in your local currency.</p></main>") }).lines, "FAIL", /^C11 .*\/ puts both products in one currency or promises your local currency/)).toBe(true);
    const fa = '<script type="application/ld+json">{"@type":"SoftwareApplication","offers":[{"@type":"Offer","name":"Full Analysis","price":"0","priceCurrency":"USD"}]}</script>';
    expect(has(run({ pricing: PRICING.replace("</head>", `${fa}</head>`) }).lines, "FAIL", /^C11 .*1 Full Analysis Offer\(s\) without the currency sentence/)).toBe(true);
  });

  it("before the deploy (the old homepage and pricing page) the switch-over's claims FAIL", () => {
    const OLD_HOME = `<html><head><title>Resume Booster — 950,000+ Live Jobs Straight From Employers</title><script type="application/ld+json">{"@type":"WebApplication","description":"Free diagnostic resume scan: ATS score with a full audit trail, verified quotes","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"}}</script></head><body><main><h1 class="text-3xl font-bold mb-3">Live jobs, straight from employers' own hiring systems.</h1><p>950,000+ open roles (counted 2026-10-26, when this page was built)</p>${pad}</main></body></html>`;
    const OLD_PRICING = `<html><head><title>Pricing — Free Scan, $5 Full Resume Analysis or Pro $45/month</title></head><body><main><h1>Pricing</h1><h2>One paid report</h2><p>Prices in US dollars.</p>${pad}</main></body></html>`;
    const { lines } = run({ home: OLD_HOME, pricing: OLD_PRICING, entry: `${pad};const o="Apply yourself, with your own AI's help.";`, builds: { "create-subscription-checkout": "create-subscription-checkout.2026-10-11.23" } });
    for (const c of ["C1", "C2", "C3", "C4", "C6", "C7", "C11"]) expect(has(lines, "FAIL", new RegExp(`^${c} `)), `${c}${show(lines)}`).toBe(true);
  });
});

describe("what the section cannot judge is INFO, never PASS", () => {
  it("C1 with no row to compare, C10 with no answer, C5 with a seller named", () => {
    expect(has(run({ vc: "" }).lines, "INFO", /^C1 \/ prints 1,040,488 counted .*answered no row to compare/)).toBe(true);
    expect(has(run({ agent: "" }).lines, "INFO", /^C10 agent_sender_public_status answered nothing/)).toBe(true);
    const root = mkdtempSync(join(tmpdir(), "vd-99-root-"));
    dirs.push(root);
    for (const f of ["src/i18n/shards/home/en.json", "src/i18n/shards/pricing/en.json", "src/lib/job-board-categories.ts"]) {
      mkdirSync(dirname(join(root, f)), { recursive: true });
      copyFileSync(join(ROOT, f), join(root, f));
    }
    mkdirSync(join(root, "src/config"), { recursive: true });
    writeFileSync(join(root, "src/config/seller.ts"), 'export const SELLER = { legalName: "TEST SELLER", postalAddress: "TEST ADDRESS, NOWHERE" };\n');
    expect(has(run({ root }).lines, "INFO", /^C5 this checkout names a seller/)).toBe(true);
  });

  it("C10 passes once the agent is off, by the RPC or by /trust", () => {
    expect(has(run({ agent: "false" }).lines, "PASS", /^C10 the apply agent is retired \(agent_sender_public_status answers false\)/)).toBe(true);
    expect(has(run({ trust: TRUST_OFF }).lines, "PASS", /^C10 the apply agent is retired \(\/trust says it is switched off\)/)).toBe(true);
  });
});

describe("the rendered claims' judge (C8, C9)", () => {
  const page = (o: Partial<{ rendered: boolean; leaks: string[]; filledHeader: string[]; filledMain: string[] }> = {}) => ({ rendered: true, leaks: [], filledHeader: [], filledMain: ["Search jobs"], ...o });
  const healthy = { upload: { finalUrl: "https://site.test/resume-checker#upload", uploaderInView: true }, checker: { hasUploader: true }, home: page(), pricing: page({ filledMain: ["Create a free account"] }) };

  it("a healthy run passes all four lines", () => {
    const lines = judgeRendered(healthy);
    expect(lines.filter((l) => l.startsWith("PASS")), lines.join("\n")).toHaveLength(4);
  });

  it("each line can FAIL", () => {
    expect(judgeRendered({ ...healthy, upload: { finalUrl: "https://site.test/#upload", uploaderInView: false } })[0]).toMatch(/^FAIL  C8 "\/#upload" lands on \/#upload \(want/);
    // The scanner clears the hash once it has scrolled to the uploader: judged by where the uploader is.
    expect(judgeRendered({ ...healthy, upload: { finalUrl: "https://site.test/resume-checker", uploaderInView: true } })[0]).toMatch(/^PASS  C8 .*the uploader in view/);
    expect(judgeRendered({ ...healthy, upload: { finalUrl: "https://site.test/resume-checker", uploaderInView: false } })[0]).toMatch(/^FAIL  C8 .*but not at the uploader/);
    expect(judgeRendered({ ...healthy, checker: { hasUploader: false } })[1]).toMatch(/^FAIL  C8 \/resume-checker renders no uploader/);
    expect(judgeRendered({ ...healthy, home: page({ leaks: ["Freelance Boost"] }) })[2]).toMatch(/^FAIL  C9 the rendered \/ names "Freelance Boost"/);
    expect(judgeRendered({ ...healthy, pricing: page({ filledHeader: ["Get Started"], filledMain: ["Create a free account"] }) })[3]).toMatch(/^FAIL  C9 the rendered \/pricing the header has 1 filled button/);
    expect(judgeRendered({ ...healthy, home: page({ filledMain: ["Search jobs", "Scan my résumé free"] }) })[2]).toMatch(/main has 2 filled buttons/);
    expect(judgeRendered({ ...healthy, home: page({ rendered: false }) })[2]).toMatch(/^FAIL  C9 \/ did not render/);
    expect(judgeRendered({ upload: null, checker: null, home: null, pricing: null }).every((l) => l.startsWith("FAIL"))).toBe(true);
  });
});
