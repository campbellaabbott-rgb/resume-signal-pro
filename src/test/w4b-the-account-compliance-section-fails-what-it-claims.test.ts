// @vitest-environment node
/**
 * SECTION 92 (WAVE 4 ROUND 2, ACCOUNT-COMPLIANCE) FAILS WHAT IT CLAIMS, AND
 * NEVER WRITES.
 *
 * scripts/verify-deploy.d/92-w4b-account-compliance.sh is what the owner reads
 * after this round deploys. A PASS is worth something only if a regression
 * could have turned it into a FAIL (verify-deploy.d/README), so the section
 * runs here in bash against a fake curl, with the real build_ge cut from the
 * verifier. The marketing header it reads is the one the real
 * _shared/marketing-pause.ts produces for the identity this repository
 * carries, and the published chunks it reads are this repository's own
 * sources, so a pause that stops being announced, or a chunk that loses what
 * the section looks for, reads FAIL here first. Every request it makes is an
 * OPTIONS preflight or a GET.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { marketingMailHeader } from "../../supabase/functions/_shared/marketing-pause";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/92-w4b-account-compliance.sh"), "utf8");
const BUILD_GE = (() => { const m = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT); if (!m) throw new Error("build_ge is gone from verify-deploy.sh"); return m[0]; })();
const src = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];
  else if(x==="-d"||x==="--data")data=a[++i];else if(["-H","-m","-A","-w"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,method+" "+url+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url))||{status:404,body:""};
const hdr="HTTP/2 "+(r.status??200)+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
process.stdout.write(out);
`;

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd-92ac-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=pk_test; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  let out = "";
  try {
    out = execFileSync("bash", [join(dir, "run.sh")], {
      env: { ...process.env, PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`, VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log") },
      encoding: "utf8", timeout: 110_000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean) };
}
const has = (lines: string[], s: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${s}  `) && re.test(l));
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

const FN = (fn: string) => `^OPTIONS https://p\\.supabase\\.co/functions/v1/${fn}$`;
const MARKETING = ["send-agent-digest", "send-market-pulse", "send-scan-report"];
const ROUND_11 = [...MARKETING, "send-search-digest", "shortlist-evaluate", "stripe-webhook", "withdraw-subscription"];
const ROUND_14 = ["delete-account", "get-account-data", "account-order", "account-settings"];
const ENTRY = `import"./x.js";const a=()=>import("./ConsentBanner-Ab12.js");const b=()=>import("./Account-Cd34.js");const c=()=>import("./Privacy-Ef56.js");const d=()=>import("./Shortlist-Gh78.js");\n${src("src/lib/consent.ts")}`;

function routes(over: Record<string, Route | null> = {}, mail: Record<string, string> = { "x-marketing-mail": "on" }): Route[] {
  const base: Record<string, Route> = {};
  for (const fn of ROUND_11) base[fn] = { match: FN(fn), headers: { "x-fn-build": `${fn}.2026-10-11.25`, ...(MARKETING.includes(fn) ? mail : {}) } };
  for (const fn of ROUND_14) base[fn] = { match: FN(fn), headers: { "x-fn-build": `${fn}.2026-10-14.25` } };
  base.erase = { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/account_erase_personal_data\\?", status: 401, body: JSON.stringify({ code: "42501", message: "permission denied" }) };
  base.shell = { match: "^GET https://site\\.test/$", body: `<html><head><script type="module" src="/assets/index-Zz99.js"></script></head></html>` };
  base.entry = { match: "^GET https://site\\.test/assets/index-Zz99\\.js$", body: ENTRY };
  base.banner = { match: "ConsentBanner-Ab12\\.js$", body: src("src/components/ConsentBanner.tsx") };
  base.account = { match: "Account-Cd34\\.js$", body: [src("src/pages/Account.tsx"), src("src/components/account/ConnectedAIsCard.tsx"), src("src/components/account/OrdersList.tsx"), src("src/components/account/SecurityCard.tsx")].join("\n") };
  base.privacy = { match: "Privacy-Ef56\\.js$", body: src("src/pages/Privacy.tsx") };
  base.shortlist = { match: "Shortlist-Gh78\\.js$", body: src("src/pages/Shortlist.tsx") };
  for (const [k, v] of Object.entries(over)) { if (v === null) delete base[k]; else base[k] = v; }
  return Object.values(base);
}

describe("section 92 account-compliance on a deploy of this round", () => {
  it("with a seller identity set, every claim reads PASS, and every request is a preflight or a GET", () => {
    const { lines, calls } = run(routes());
    expect(fails(lines), show(lines)).toEqual([]);
    for (const fn of ROUND_11) expect(has(lines, "PASS", new RegExp(`${fn} preflight x-fn-build = ${fn}\\.2026-10-11\\.25`)), show(lines)).toBe(true);
    for (const fn of ROUND_14) expect(has(lines, "PASS", new RegExp(`${fn} preflight x-fn-build = ${fn}\\.2026-10-14\\.25`)), show(lines)).toBe(true);
    for (const fn of MARKETING) expect(has(lines, "PASS", new RegExp(`${fn} x-marketing-mail = on`)), show(lines)).toBe(true);
    expect(has(lines, "PASS", /account_erase_personal_data exists and anon may not run it/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /ConsentBanner-Ab12\.js and carries the analytics consent key/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /Account-Cd34\.js carries the connected-AIs card, .* and the line saying how and when the address was proven/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /20261011172000 .*fix-plan-drip/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /Privacy-Ef56\.js names Mailgun and ipinfo/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /Shortlist-Gh78\.js asks for the uploader's attestation/), show(lines)).toBe(true);
    expect(calls.length).toBeGreaterThan(10);
    for (const c of calls) expect(c, "the section may only preflight and GET").toMatch(/^(OPTIONS|GET) /);
  });
});

describe("section 92 account-compliance fails each regression", () => {
  it("S12-010: while this repository's seller identity is empty, the real header reads FAIL with the owner's step", () => {
    const real = marketingMailHeader();
    const { lines } = run(routes({}, real));
    if (real["x-marketing-mail"] === "on") {
      for (const fn of MARKETING) expect(has(lines, "PASS", new RegExp(`${fn} x-marketing-mail = on`)), show(lines)).toBe(true);
    } else {
      for (const fn of MARKETING) expect(has(lines, "FAIL", new RegExp(`${fn} x-marketing-mail = paused_no_seller_identity: .*OWNER: put both in src/config/seller\\.ts`)), show(lines)).toBe(true);
    }
  });

  it("a current marketing build that stops announcing the pause", () => {
    const { lines } = run(routes({}, {}));
    expect(has(lines, "FAIL", /send-market-pulse carries no x-marketing-mail/), show(lines)).toBe(true);
  });

  it("an older bundle, of either day", () => {
    const { lines } = run(routes({
      "send-scan-report": { match: FN("send-scan-report"), headers: { "x-fn-build": "send-scan-report.2026-10-09.24", "x-marketing-mail": "on" } },
      "delete-account": { match: FN("delete-account"), headers: { "x-fn-build": "delete-account.2026-10-14.1" } },
      "account-settings": null,
      "stripe-webhook": { match: FN("stripe-webhook"), status: 405, headers: { "x-fn-build": "stripe-webhook.2026-10-11.22" } },
    }));
    expect(has(lines, "FAIL", /send-scan-report preflight x-fn-build = send-scan-report\.2026-10-09\.24 \(want/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /delete-account preflight x-fn-build = delete-account\.2026-10-14\.1 \(want/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /account-settings preflight x-fn-build = none/), show(lines)).toBe(true);
    // payments-delivery's own stripe-webhook build, without this round's notice
    expect(has(lines, "FAIL", /stripe-webhook preflight x-fn-build = stripe-webhook\.2026-10-11\.22 \(want/), show(lines)).toBe(true);
  });

  it("the eraser not applied, or open to anon", () => {
    let { lines } = run(routes({ erase: { match: "rpc/account_erase_personal_data", status: 404, body: JSON.stringify({ code: "PGRST202" }) } }));
    expect(has(lines, "FAIL", /20261011170000 has not applied/), show(lines)).toBe(true);
    ({ lines } = run(routes({ erase: { match: "rpc/account_erase_personal_data", status: 200, body: "[]" } })));
    expect(has(lines, "FAIL", /account_erase_personal_data probe as anon -> ROWS/), show(lines)).toBe(true);
  });

  it("a frontend without the banner, the consent key, the connected-AIs card, the processors or the attestation", () => {
    let { lines } = run(routes({ entry: { match: "index-Zz99\\.js$", body: `const b=()=>import("./Account-Cd34.js");const c=()=>import("./Privacy-Ef56.js");const d=()=>import("./Shortlist-Gh78.js");` } }));
    expect(has(lines, "FAIL", /loads no ConsentBanner chunk/), show(lines)).toBe(true);
    ({ lines } = run(routes({ account: { match: "Account-Cd34\\.js$", body: src("src/components/account/OrdersList.tsx") } })));
    expect(has(lines, "FAIL", /Account-Cd34\.js lacks the connected-AIs card/), show(lines)).toBe(true);
    // the account home without the orders list's Report a problem
    ({ lines } = run(routes({ account: { match: "Account-Cd34\\.js$", body: [src("src/pages/Account.tsx"), src("src/components/account/ConnectedAIsCard.tsx"), src("src/components/account/SecurityCard.tsx")].join("\n") } })));
    expect(has(lines, "FAIL", /Account-Cd34\.js lacks the connected-AIs card, account-settings, account-order, Report a problem or the proof line/), show(lines)).toBe(true);
    // the account home without the Security card's proof line
    ({ lines } = run(routes({ account: { match: "Account-Cd34\\.js$", body: [src("src/pages/Account.tsx"), src("src/components/account/ConnectedAIsCard.tsx"), src("src/components/account/OrdersList.tsx")].join("\n") } })));
    expect(has(lines, "FAIL", /Account-Cd34\.js lacks .* or the proof line/), show(lines)).toBe(true);
    ({ lines } = run(routes({ privacy: { match: "Privacy-Ef56\\.js$", body: "Resend Supabase" } })));
    expect(has(lines, "FAIL", /does not name Mailgun and ipinfo/), show(lines)).toBe(true);
    ({ lines } = run(routes({ shortlist: { match: "Shortlist-Gh78\\.js$", body: `from("shortlist_demographics")` } })));
    expect(has(lines, "FAIL", /still reads or writes candidates' sex and race/), show(lines)).toBe(true);
    ({ lines } = run(routes({ shortlist: { match: "Shortlist-Gh78\\.js$", body: "roleId" } })));
    expect(has(lines, "FAIL", /sends no attestation/), show(lines)).toBe(true);
  });
});
