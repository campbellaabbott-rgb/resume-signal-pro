// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE BUG ROUND PAYMENTS SECTION CAN FAIL WHAT IT CLAIMS, NEVER FAILS BEFORE
 * THE PASTE, AND NEVER WRITES (scripts/verify-deploy.d/99zzzzzzz-bugs-payments.sh).
 *
 * Run against a fake curl that answers from routes and logs every call, and a
 * ledger fixture standing in for docs/deploy-ledger.json:
 *   - before the paste (every function on an older build, both columns
 *     missing, the old strings and the old /pricing) it prints INFO and no
 *     FAIL, and every owner-gated key prints owner pending;
 *   - a full paste passes every build, both columns, the published strings
 *     and /pricing's cap;
 *   - a partial paste fails each function left behind; a later build passes
 *     and another function's build never stands in;
 *   - after the paste a missing column, a column anon can read, missing
 *     strings and a /pricing that does not name the cap each fail;
 *   - a decided owner key judges what its decision ships, and fails when that
 *     has not published;
 *   - every call is an OPTIONS or a GET, no body is sent, and the key is
 *     never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-payments.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_bugs_payments";

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

function run(routes: Route[], ownerDecided: Record<string, unknown> = {}): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbugspayments-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "ledger.json"), JSON.stringify({ reservations: { "bug-round": { ownerDecided } } }));
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VDBP_LEDGER: join(dir, "ledger.json"),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

const FNS = [
  "create-checkout", "create-subscription-checkout", "create-portal-session", "delete-account", "stripe-webhook", "check-subscription",
  "analyze-resume", "verify-product-purchase", "create-product-checkout", "create-agent-checkout", "create-pass-checkout", "agent-access",
  "agent-connect", "agent-pass-status", "generate-apply-package", "generate-freelance-boost", "withdraw-subscription",
];
const OLD = (fn: string) => `${fn}.2026-11-10.2`;
const NEW = (fn: string) => `${fn}.2026-11-12.1`;
const preflights = (build: (fn: string) => string | null): Route[] =>
  FNS.map((fn) => { const b = build(fn); return { match: `^OPTIONS https://p\\.supabase\\.co/functions/v1/${fn}$`, headers: b ? { "x-fn-build": b } : {} }; });

const MISSING = (col: string) => ({ status: 400, body: JSON.stringify({ code: "42703", message: `column ${col} does not exist` }) });
const columns = (state: "missing" | "empty" | "refused" | "rows"): Route[] => [["pro_grants", "redeem_until"], ["checkout_buyers", "network_key"]].map(([t, c]) => ({
  match: `^GET https://p\\.supabase\\.co/rest/v1/${t}\\?select=${c}&limit=1$`,
  ...(state === "missing" ? MISSING(`${t}.${c}`)
    : state === "empty" ? { body: "[]" }
    : state === "refused" ? { status: 401, body: JSON.stringify({ code: "42501", message: `permission denied for table ${t}` }) }
    : { body: JSON.stringify([{ [c]: "x" }]) }),
}));

const site = (published: boolean, opts: { pricing?: string; terms?: string } = {}): Route[] => [
  { match: "^GET https://site\\.test/$", body: '<script type="module" src="/assets/index-AbC123.js"></script>' },
  {
    match: "^GET https://site\\.test/assets/index-AbC123\\.js$",
    body: `const a=()=>import("./PricingPage-Pp1.js"),b=()=>import("./Account-Ac1.js");const s={payments:{pro:{pausedUntilPaid:"${published ? "Pro's tools are paused until this payment goes through." : ""}"}}};`,
  },
  {
    match: "^GET https://site\\.test/assets/PricingPage-Pp1\\.js$",
    body: `import{j as e}from"./index-AbC123.js";import{B as b}from"./BuyBlock-Bb1.js";e("pricingPlans.pro.owing");`,
  },
  {
    match: "^GET https://site\\.test/assets/BuyBlock-Bb1\\.js$",
    body: published ? `t("payments.pro.pausedUntilPaid");t("proPlan.linkPendingUnlinked");t("proPlan.endsOn");` : `t("pricingPlans.pro.owing");`,
  },
  { match: "^GET https://site\\.test/assets/Account-Ac1\\.js$", body: published ? `t("payments.pro.pausedUntilPaid")` : `t("pricingPlans.pro.owing")` },
  { match: "^GET https://site\\.test/pricing$", body: opts.pricing ?? (published ? PRICING_NEW : PRICING_OLD) },
  { match: "^GET https://site\\.test/terms$", body: opts.terms ?? "<p>The Full Analysis costs $5 per analysis.</p>" },
];
const FA_ROW = (pro: string) => `<tr data-row="fa"><th scope="row" class="font-normal">Full Analysis</th><td>$5 each</td><td>$5 each</td><td>${pro}</td></tr>`;
const PRICING_OLD = `<ul><li>Everything in a free account, plus the writing tools</li><li>The $5 Full Analysis included</li></ul><table>${FA_ROW("Included")}</table>`;
const PRICING_NEW = `<ul><li>Everything in a free account, plus the writing tools</li><li>Up to 10 Full Analyses a day and 60 a month</li></ul><table>${FA_ROW("Included: 10 a day, 60 a month")}</table>`;

const before = (): Route[] => [...preflights(OLD), ...columns("missing"), ...site(false)];
const after = (): Route[] => [...preflights(NEW), ...columns("empty"), ...site(true)];
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));

describe("the bug round payments section", () => {
  it("before the paste says INFO for every build, column, string and owner key, and fails nothing", () => {
    const { lines, out } = run(before());
    expect(fails(lines), out).toEqual([]);
    for (const fn of FNS) expect(lines.some((l) => l.startsWith(`INFO  B ${fn} preflight x-fn-build = ${OLD(fn)}: bug round A is not pasted yet`)), `${fn}\n${out}`).toBe(true);
    expect(lines.filter((l) => l.startsWith("PASS")), out).toEqual([]);
    expect(lines.some((l) => l.startsWith("INFO  M1 pro_grants.redeem_until does not exist yet")), out).toBe(true);
    expect(lines.some((l) => l.startsWith("INFO  M2 checkout_buyers.network_key does not exist yet")), out).toBe(true);
    expect(lines.some((l) => l.startsWith("INFO  F1 the published site lacks")), out).toBe(true);
    expect(lines.some((l) => l.startsWith("INFO  F2 /pricing as Googlebot reads it does not name the cap yet")), out).toBe(true);
    for (const k of ["S14X-013", "S14X-086", "S14X-235", "NB-11"]) expect(lines.some((l) => l.startsWith(`INFO  ${k} owner pending`)), `${k}\n${out}`).toBe(true);
  });

  it("a full paste passes every build, both columns, the published strings and /pricing's cap", () => {
    const { lines, out } = run(after());
    expect(fails(lines), out).toEqual([]);
    expect(lines.filter((l) => l.startsWith("PASS")), out).toHaveLength(FNS.length + 4);
    expect(lines.some((l) => l.startsWith("PASS  F2 /pricing as Googlebot reads it names the cap: the Full Analysis row's Pro cell says 10 a day, 60 a month")), out).toBe(true);
  });

  it("a partial paste fails each function left behind, and a missing header fails once others serve the build", () => {
    const { lines, out } = run([
      ...preflights((fn) => (fn === "stripe-webhook" ? OLD(fn) : fn === "delete-account" ? null : NEW(fn))),
      ...columns("empty"), ...site(true),
    ]);
    expect(fails(lines), out).toEqual([
      "FAIL  B delete-account preflight carries no x-fn-build while others serve 2026-11-12.1 (want delete-account.2026-11-12.1 or later)",
      "FAIL  B stripe-webhook preflight x-fn-build = stripe-webhook.2026-11-10.2 while others serve 2026-11-12.1: a partial paste (want stripe-webhook.2026-11-12.1 or later)",
    ]);
  });

  it("a later build passes, and another function's build never stands in for this one", () => {
    const { lines, out } = run([
      ...preflights((fn) => (fn === "create-checkout" ? "create-product-checkout.2026-11-12.1" : `${fn}.2026-11-14.3`)),
      ...columns("empty"), ...site(true),
    ]);
    expect(fails(lines), out).toEqual([
      "FAIL  B create-checkout preflight x-fn-build = create-product-checkout.2026-11-12.1 while others serve 2026-11-12.1: a partial paste (want create-checkout.2026-11-12.1 or later)",
    ]);
  });

  it("after the paste a missing column fails, a column anon can read fails, and a refused read passes", () => {
    const missing = run([...preflights(NEW), ...columns("missing"), ...site(true)]);
    expect(fails(missing.lines), missing.out).toEqual([
      "FAIL  M1 pro_grants.redeem_until does not exist while the lane's functions serve 2026-11-12.1: 20261112110000, S14X-078 did not apply (re-apply it under a fresh stamp)",
      "FAIL  M2 checkout_buyers.network_key does not exist while the lane's functions serve 2026-11-12.1: the affiliate lane's 20261112122000, which RC-S13-063's checkouts fill did not apply (re-apply it under a fresh stamp)",
    ]);
    const rows = run([...preflights(NEW), ...columns("rows"), ...site(true)]);
    expect(fails(rows.lines), rows.out).toHaveLength(2);
    expect(fails(rows.lines)[0]).toMatch(/^FAIL {2}M1 pro_grants\.redeem_until: an anonymous read returned rows/);
    const refused = run([...preflights(NEW), ...columns("refused"), ...site(true)]);
    expect(fails(refused.lines), refused.out).toEqual([]);
    expect(refused.lines.filter((l) => /^PASS {2}M[12] /.test(l)), refused.out).toHaveLength(2);
  });

  it("after the paste, unpublished strings and a /pricing that does not name the cap each fail", () => {
    const { lines, out } = run([...preflights(NEW), ...columns("empty"), ...site(false)]);
    const f = fails(lines);
    expect(f, out).toHaveLength(2);
    expect(f[0]).toBe("FAIL  F1 the published site lacks the entry's English payments shard; the Pro block's paused-until-paid line (S14X-077); the Pro block's link-pending state (S14X-114); the Pro block's ends-on date (S14X-114); the account card's paused-until-paid line (S14X-077) while the lane's functions serve 2026-11-12.1: the round's frontend publish has not happened");
    expect(f[1]).toBe("FAIL  F2 /pricing as Googlebot reads it does not name the cap (row nocell noperk) while the lane's functions serve 2026-11-12.1: the round's frontend publish (which re-renders /pricing) has not happened");
    const half = run([...preflights(NEW), ...columns("empty"), ...site(true, { pricing: PRICING_NEW.replace("Up to 10 Full Analyses a day and 60 a month", "The $5 Full Analysis included") })]);
    expect(fails(half.lines), half.out).toEqual([expect.stringContaining("FAIL  F2 /pricing as Googlebot reads it does not name the cap (row cell noperk)")]);
    const noRow = run([...preflights(OLD), ...columns("missing"), ...site(false, { pricing: "<p>no table</p>" })]);
    expect(fails(noRow.lines), noRow.out).toEqual([expect.stringContaining("FAIL  F2 /pricing as Googlebot reads it has no Full Analysis row")]);
  });

  it("a bundle that names no PricingPage chunk is a FAIL even before the paste: nothing could be judged", () => {
    const routes = before().map((r) => (r.match.includes("index-AbC123\\.js") ? { ...r, body: "const x=1;" } : r));
    const { lines, out } = run(routes);
    expect(fails(lines), out).toEqual([expect.stringContaining("FAIL  F1 the served entry (/assets/index-AbC123.js) names no PricingPage or Account chunk")]);
  });

  it("a decided owner key judges what its decision ships, and fails when that has not published", () => {
    const decided = { "S14X-013": { choice: "approved", date: "2026-11-20" }, "S14X-086": "our notice (2026-11-20)", "S14X-235": "translate", "NB-11": "approved wording" };
    const stale = run([...preflights((fn) => (fn === "stripe-webhook" || fn === "withdraw-subscription" ? OLD(fn) : NEW(fn))), ...columns("empty"), ...site(true)], decided);
    expect(fails(stale.lines).filter((l) => /^FAIL {2}(S14X|NB)-/.test(l)), stale.out).toEqual([
      "FAIL  S14X-013 decided (approved), but /terms as Googlebot reads it never says renew while the lane's functions serve 2026-11-12.1: the terms did not publish",
      "FAIL  S14X-086 decided (our notice (2026-11-20)), but stripe-webhook does not serve 2026-11-12.1 while the lane's other functions do",
      "FAIL  S14X-235 decided (translate), but withdraw-subscription does not serve 2026-11-12.1 while the lane's other functions do",
      "FAIL  NB-11 decided (approved wording), but /pricing still lists 'Everything in a free account, plus the writing tools' while the lane's functions serve 2026-11-12.1",
    ]);
    const shipped = run([...preflights(NEW), ...columns("empty"), ...site(true, {
      terms: "<p>Pro renews every month until you cancel.</p>",
      pricing: PRICING_NEW.replace("Everything in a free account, plus the writing tools<", "Everything in a free account, plus five writing packages a day<"),
    })], decided);
    expect(fails(shipped.lines), shipped.out).toEqual([]);
    for (const k of ["S14X-013", "S14X-086", "S14X-235", "NB-11"]) expect(shipped.lines.some((l) => l.startsWith(`PASS  ${k} decided`)), `${k}\n${shipped.out}`).toBe(true);
    const english = run(after(), { "S14X-235": "English", "S14X-086": "Stripe setting" });
    expect(fails(english.lines), english.out).toEqual([]);
    expect(english.lines.some((l) => l.startsWith("INFO  S14X-235 decided (English): the confirmation and the withdrawal acknowledgement stay English")), english.out).toBe(true);
    expect(english.lines.some((l) => l.startsWith("INFO  S14X-086 decided (Stripe setting): Stripe's own failed-payment emails")), english.out).toBe(true);
    const pending = run(before(), decided);
    expect(fails(pending.lines), pending.out).toEqual([]);
  });

  it("never writes: every call is an OPTIONS or a GET, no body is sent, and the key is never printed", () => {
    const { calls, out } = run(after(), { "S14X-013": "approved", "NB-11": "approved" });
    expect(calls.length).toBeGreaterThan(FNS.length + 2);
    expect(calls.every((c) => /^curl\t(OPTIONS|GET) /.test(c) && c.split("\t").length === 2), calls.join("\n")).toBe(true);
    expect(out).not.toContain(KEY);
  });
});
