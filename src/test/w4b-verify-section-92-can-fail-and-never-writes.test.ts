// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 92 (CHECKOUT AND CATALOGUE) CAN FAIL, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/92-w4b-checkout-catalogue.sh is run against a fake
 * curl that answers from routes and logs every call:
 *   - a good deploy prints PASS (and INFO) lines and no FAIL;
 *   - nothing deployed prints FAIL for the builds and asks no checkout;
 *   - a cut product that still sells, a GET with no territory flag, and a
 *     readable checkout_buyers each print FAIL;
 *   - (owner decisions 2026-10-17) Freelance Boost and Transition Pro are
 *     asked for their 410; a GET with no purchasesOpen, a published Pricing
 *     page without the purchases-open-soon line, the renewal box or India,
 *     a Freelance Boost page that still sells, and a missing or readable
 *     pro_auto_renew_consents each print FAIL; purchasesOpen false is a PASS
 *     with the owner's step beside it, never a FAIL;
 *   - the only POSTs are to the cut and switched-off checkouts (answered
 *     before any limiter); create-checkout is only ever sent a GET or an
 *     OPTIONS, and the publishable key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { cutSentence } from "../../supabase/functions/_shared/product-cuts";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/92-w4b-checkout-catalogue.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_92";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(["-H","-m","-A","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url+(data!==null?" "+data:"")))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.split("\\\\n").join("\\n").replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vd92-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

const builds: Record<string, string> = {
  "create-checkout": "create-checkout.2026-10-11.23",
  "create-product-checkout": "create-product-checkout.2026-10-11.23",
  "create-subscription-checkout": "create-subscription-checkout.2026-10-11.23",
  "create-scan-pack-checkout": "create-scan-pack-checkout.2026-10-11.23",
  "create-test-checkout": "create-test-checkout.2026-10-11.23",
  "check-subscription": "check-subscription.2026-10-11.23",
  "create-portal-session": "create-portal-session.2026-10-14.23",
};
const BUILDS = Object.keys(builds).length;
const preflights = (over: Record<string, string | null> = {}): Route[] =>
  Object.entries({ ...builds, ...over }).map(([fn, b]) => ({ match: `^OPTIONS https://p\\.supabase\\.co/functions/v1/${fn}$`, headers: b ? { "x-fn-build": b } : {} }));
const cutAnswer = (id: string, product: string, lang = "en") => JSON.stringify({ retired: true, cut: true, reason: "product_retired", product, language: lang, error: cutSentence(id, lang as "en"), pricing: "https://resumebooster.work/pricing" });
const PRODUCTS: Array<[string, string]> = [
  ["basicKeywordFix", "basic_keyword_fix"], ["coverLetter", "cover_letter"], ["premiumPackage", "premium_package"], ["atsDefense", "ats_defense"],
  ["careerSnapshot", "career_snapshot"], ["graduateGamePlan", "graduate_gameplan"], ["interviewCoach", "interview_coach"],
  ["careerPathSimulator", "career_path_simulator"], ["scanPack", "scan_pack"],
  ["freelanceBoost", "freelance_boost"], ["freelanceTransitionPro", "freelance_transition_pro"],
];
const PRICING_CHUNK = `import{a as x}from"./PurchaseTerms-AAAA1111.js";const k=["checkoutGate.purchasesOpenSoon","proPlan.perks.noDailyScanCap"];`;
const TERMS_CHUNK = `const z=["purchaseTerms.autoRenewConsent","Asia/Kolkata","Asia/Calcutta"];`;
const FB_CHUNK = `const t=["freelanceBoost.noLongerSoldTitle"];`;
const site = (over: { pricing?: string; terms?: string; fb?: string } = {}): Route[] => [
  { match: "^GET https://site\\.test/$", body: `<html><script type="module" src="/assets/index-ENTRY0001.js"></script></html>` },
  { match: "^GET https://site\\.test/assets/index-ENTRY0001\\.js$", body: `const r={a:()=>import("./Pricing-PRIC0001.js"),b:()=>import("./FreelanceBoost-FBST0001.js")};` },
  { match: "^GET https://site\\.test/assets/Pricing-PRIC0001\\.js$", body: over.pricing ?? PRICING_CHUNK },
  { match: "^GET https://site\\.test/assets/PurchaseTerms-AAAA1111\\.js$", body: over.terms ?? TERMS_CHUNK },
  { match: "^GET https://site\\.test/assets/FreelanceBoost-FBST0001\\.js$", body: over.fb ?? FB_CHUNK },
];
const good = (): Route[] => [
  ...preflights(),
  { match: "^GET https://p\\.supabase\\.co/functions/v1/create-checkout$", body: JSON.stringify({ euUkSales: false, withdrawalDays: 14, waiverVersion: "2026-10-09", territoryRefused: true, purchasesOpen: false }) },
  { match: "^POST https://p\\.supabase\\.co/functions/v1/create-product-checkout .*\"coverLetter\",\"language\":\"de\"", status: 410, body: cutAnswer("coverLetter", "cover_letter", "de") },
  ...PRODUCTS.map(([id, type]): Route => ({ match: `^POST https://p\\.supabase\\.co/functions/v1/create-product-checkout .*"${id}"`, status: 410, body: cutAnswer(id, type) })),
  { match: "^POST https://p\\.supabase\\.co/functions/v1/create-scan-pack-checkout", status: 410, body: cutAnswer("scanPack", "scan_pack") },
  { match: "^POST https://p\\.supabase\\.co/functions/v1/create-test-checkout", status: 410, body: JSON.stringify({ retired: true, reason: "test_checkout_off", error: "The development checkout is switched off." }) },
  { match: "^GET https://p\\.supabase\\.co/rest/v1/checkout_buyers\\?", status: 401, body: JSON.stringify({ code: "42501", message: "permission denied for table checkout_buyers" }) },
  { match: "^GET https://p\\.supabase\\.co/rest/v1/checkout_buyers_never_existed", status: 404, body: JSON.stringify({ code: "PGRST205" }) },
  { match: "^GET https://p\\.supabase\\.co/rest/v1/pro_auto_renew_consents\\?", status: 401, body: JSON.stringify({ code: "42501", message: "permission denied for table pro_auto_renew_consents" }) },
  ...site(),
];

describe("section 92", () => {
  it("a good deploy prints no FAIL, and PASSes each claim", () => {
    const { lines, out } = run(good());
    expect(lines.filter((l) => l.startsWith("FAIL")), out).toEqual([]);
    const pass = lines.filter((l) => l.startsWith("PASS"));
    expect(pass.filter((l) => /preflight x-fn-build/.test(l))).toHaveLength(BUILDS);
    expect(pass.some((l) => /territoryRefused true/.test(l))).toBe(true);
    // The cut products, the de sentence, the scan packs and the dev checkout.
    expect(pass.filter((l) => /answers 410/.test(l)).length).toBe(PRODUCTS.length + 3);
    expect(pass.some((l) => /checkout_buyers -> 42501/.test(l))).toBe(true);
    expect(pass.some((l) => /pro_auto_renew_consents -> 42501/.test(l))).toBe(true);
    // Closed purchases are the gate working: a PASS, and the owner's step.
    expect(pass.some((l) => /purchasesOpen false/.test(l))).toBe(true);
    expect(lines.some((l) => /^INFO  owner: purchases stay closed/.test(l))).toBe(true);
    expect(pass.some((l) => /published Pricing page .* purchases open soon/.test(l))).toBe(true);
    expect(pass.some((l) => /published Freelance Boost page .* no longer sold/.test(l))).toBe(true);
    for (const [id] of PRODUCTS.filter(([x]) => x.startsWith("freelance"))) {
      expect(pass.some((l) => l.includes(`answers 410 for ${PRODUCTS.find(([x]) => x === id)![1]}`)), id).toBe(true);
    }
    expect(out).not.toContain(KEY);
  });

  it("the 2026-10-17 claims each FAIL when the deploy does not carry them", () => {
    const base = good().filter((r) => !/create-checkout\$|site\\\.test|pro_auto_renew_consents/.test(r.match));
    const { lines } = run([
      { match: "^GET https://p\\.supabase\\.co/functions/v1/create-checkout$", body: JSON.stringify({ euUkSales: false, territoryRefused: true }) },
      { match: "^GET https://p\\.supabase\\.co/rest/v1/pro_auto_renew_consents\\?", status: 404, body: JSON.stringify({ code: "PGRST205" }) },
      ...site({ terms: `const z=["Europe/Berlin"];`, fb: `const t=["Boost my experience — $29"];` }),
      ...base,
    ]);
    const fails = lines.filter((l) => l.startsWith("FAIL"));
    expect(fails.some((l) => /no purchasesOpen/.test(l))).toBe(true);
    expect(fails.some((l) => /pro_auto_renew_consents does not exist/.test(l))).toBe(true);
    expect(fails.some((l) => /Pricing page .* lacks: the renewal box; India in the refused time zones;/.test(l))).toBe(true);
    expect(fails.some((l) => /Freelance Boost page .* still sells/.test(l))).toBe(true);
  });

  it("the old perk naming the cut products on the published page FAILs", () => {
    const base = good().filter((r) => !/site\\\.test/.test(r.match));
    const { lines } = run([...site({ pricing: PRICING_CHUNK + `const o="proPlan.perks.includedOneOffs";` }), ...base]);
    expect(lines.filter((l) => l.startsWith("FAIL")).some((l) => /old Pro perk/.test(l))).toBe(true);
  });

  it("nothing deployed: the builds FAIL, and no checkout is asked to sell", () => {
    const { lines, calls } = run([...preflights(Object.fromEntries(Object.keys(builds).map((k) => [k, null]))), ...good().slice(BUILDS)]);
    expect(lines.filter((l) => l.startsWith("FAIL") && /carries no x-fn-build/.test(l))).toHaveLength(BUILDS);
    expect(calls.filter((c) => c.includes("\tPOST "))).toEqual([]);
    expect(calls.some((c) => / POST /.test(c)), "a POST went to an old bundle").toBe(false);
  });

  it("a cut product that still sells, a GET with no territory flag, and a readable table each FAIL", () => {
    const routes = good().filter((r) => !/coverLetter|create-checkout\$|checkout_buyers\\\?/.test(r.match));
    routes.unshift(
      { match: "^POST https://p\\.supabase\\.co/functions/v1/create-product-checkout .*\"coverLetter\"", status: 200, body: JSON.stringify({ url: "https://checkout.stripe.com/c/x", sessionId: "cs_x" }) },
      { match: "^GET https://p\\.supabase\\.co/functions/v1/create-checkout$", body: JSON.stringify({ euUkSales: false, withdrawalDays: 14 }) },
      { match: "^GET https://p\\.supabase\\.co/rest/v1/checkout_buyers\\?", body: "[]" },
    );
    const { lines } = run(routes);
    const fails = lines.filter((l) => l.startsWith("FAIL"));
    expect(fails.some((l) => /create-product-checkout did not refuse the purchase: HTTP 200/.test(l))).toBe(true);
    expect(fails.some((l) => /no territoryRefused/.test(l))).toBe(true);
    expect(fails.some((l) => /checkout_buyers -> ROWS:0/.test(l))).toBe(true);
  });

  it("never POSTs to a checkout that would reach a limiter, a token read or Stripe", () => {
    const { calls } = run(good());
    const posts = calls.filter((c) => /^curl\tPOST /.test(c));
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) expect(p, p).toMatch(/create-product-checkout|create-scan-pack-checkout|create-test-checkout/);
    for (const p of posts.filter((c) => c.includes("create-product-checkout"))) {
      const id = /"productId":"([A-Za-z]+)"/.exec(p)?.[1];
      expect(PRODUCTS.map(([x]) => x), p).toContain(id);
    }
    expect(calls.filter((c) => /create-checkout/.test(c)).every((c) => /^curl\t(GET|OPTIONS) /.test(c))).toBe(true);
  });
});
