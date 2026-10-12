// @vitest-environment node
/**
 * SECTION 93 FAILS A BUNDLE THAT STILL SELLS THE AGENT, OR A DATABASE THAT
 * STILL SCHEDULES IT (wave 4, the apply pivot).
 *
 * scripts/verify-deploy.d/93-wave4-retire.sh is what the owner reads after
 * the retire deploy. Run here in bash against a fake curl and stubbed J/R,
 * with the real build_ge cut from the verifier:
 *   - a healthy deploy is all PASS, the refusals judged from the shared
 *     module's own answer;
 *   - an older checkout bundle FAILs its build line and is never POSTed (an
 *     older bundle would reach its purchase code);
 *   - a 410 that names no free path, or carries a Stripe url, FAILs;
 *   - a cron list still holding either agent job FAILs, and a list without
 *     agent-queue-retention (the positive control in the same read) is INFO;
 *   - a workflow on main with a schedule FAILs;
 *   - the Apply Assistant's shared product checkout is judged the same way,
 *     on its own build floor (2026-10-11.1): an older bundle FAILs and is
 *     never POSTed, and a purchase that still opens Stripe FAILs.
 */
import { afterAll, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { retiredCheckoutAnswer } from "../../supabase/functions/_shared/apply-agent-retired";

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/93-wave4-retire.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d")data=a[++i];else if(["-H","-m","-A"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
fs.appendFileSync(process.env.VD_CALLS,method+" "+url+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.replace("%{http_code}",String(st)).replace(/\\\\n/g,"\\n");
process.stdout.write(out);
`;

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[], cron: unknown, status: unknown = {}): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd93-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "cron.json"), JSON.stringify(cron));
  writeFileSync(join(dir, "status.json"), JSON.stringify(status));
  const prelude = `set -u
K=pk_test; B=https://p.supabase.co; SITE=https://site.test; UA=ua
J() { cat ${JSON.stringify(join(dir, "status.json"))}; }
R() { cat ${JSON.stringify(join(dir, "cron.json"))}; }
${BUILD_GE}
`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  let out = "";
  try {
    out = execFileSync("bash", [join(dir, "run.sh")], {
      env: { ...process.env, PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`, VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log") },
      encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean) };
}

const FNS = ["create-agent-checkout", "create-pass-checkout", "agent-pass-status", "agent-access", "apply-agent", "apply-broker", "agent-runner"];
const pre = (fn: string, build: string): Route => ({ match: `^OPTIONS https://p\\.supabase\\.co/functions/v1/${fn}$`, headers: { "x-fn-build": build } });
const refusal = (fn: string, body: unknown): Route => ({ match: `^POST https://p\\.supabase\\.co/functions/v1/${fn}$`, status: 410, body: JSON.stringify(body) });
const AGENT_410 = retiredCheckoutAnswer("agent_plan", { body: { language: "de" }, origin: "https://resumebooster.work" }).body;
const PASS_410 = retiredCheckoutAnswer("agent_pass", { body: {}, acceptLanguage: "nl-NL,nl;q=0.9", origin: "https://resumebooster.work" }).body;
const ASSIST_410 = retiredCheckoutAnswer("apply_assistant", { body: { language: "fr" }, origin: "https://resumebooster.work" }).body;
const WF_OFF = "name: Apply worker\n# schedule: was here\non:\n  workflow_dispatch:\n    inputs: {}\njobs: {}\n";
const WF_ON = "name: Apply worker\non:\n  workflow_dispatch:\n  schedule:\n    - cron: \"17 */6 * * *\"\njobs: {}\n";
const wf = (body: string): Route => ({ match: "^GET https://raw\\.githubusercontent\\.com/.*/apply-worker\\.yml$", body });
const CRON_OFF = [{ ch_jobname: "agent-queue-retention" }, { ch_jobname: "send-agent-digest" }, { ch_jobname: "reconcile-stripe" }];

const healthy = (over: Partial<Record<string, Route>> = {}): Route[] => [
  ...FNS.map((fn) => over[`pre:${fn}`] ?? pre(fn, `${fn}.2026-10-11.13`)),
  over["post:create-agent-checkout"] ?? refusal("create-agent-checkout", AGENT_410),
  over["post:create-pass-checkout"] ?? refusal("create-pass-checkout", PASS_410),
  over["pre:create-product-checkout"] ?? pre("create-product-checkout", "create-product-checkout.2026-10-11.2"),
  over["post:create-product-checkout"] ?? refusal("create-product-checkout", ASSIST_410),
  over.wf ?? wf(WF_OFF),
];
const has = (lines: string[], s: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${s}  `) && re.test(l));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

describe("section 93: the retire deploy", { timeout: 60_000 }, () => {
  it("cuts build_ge from the verifier", () => expect(BUILD_GE).toContain("build_ge()"));

  it("a healthy deploy is all PASS: seven builds, two refusals, two schedules gone, the workflow by hand", () => {
    const { lines } = run(healthy(), CRON_OFF);
    expect(lines.filter((l) => l.startsWith("FAIL")), show(lines)).toEqual([]);
    for (const fn of FNS) expect(has(lines, "PASS", new RegExp(`^PASS  ${fn} preflight`)), `${fn}${show(lines)}`).toBe(true);
    expect(has(lines, "PASS", /create-agent-checkout answers a purchase 410 product_retired in de/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /create-pass-checkout answers a purchase 410 product_retired in nl/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /^PASS  create-product-checkout preflight x-fn-build = create-product-checkout\.2026-10-11\.2/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /create-product-checkout answers a purchase 410 product_retired in fr/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /apply-agent-hourly .* is unscheduled/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /agent-runner-nightly .* is unscheduled/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /starts only by hand/), show(lines)).toBe(true);
    for (const l of lines.filter((x) => !x.startsWith("== 93."))) expect(l, l).toMatch(/^(PASS|FAIL|INFO)  /);
  });

  it("an older checkout bundle FAILs its build and is never asked to sell", () => {
    const { lines, calls } = run(healthy({ "pre:create-pass-checkout": pre("create-pass-checkout", "create-pass-checkout.2026-10-09.62") }), CRON_OFF);
    expect(has(lines, "FAIL", /^FAIL  create-pass-checkout preflight x-fn-build = create-pass-checkout\.2026-10-09\.62/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /create-pass-checkout was not asked to sell/), show(lines)).toBe(true);
    expect(calls.filter((c) => c.startsWith("POST ") && c.includes("create-pass-checkout"))).toEqual([]);
    expect(calls.filter((c) => c.startsWith("POST ") && c.includes("create-agent-checkout")).length).toBe(1);
  });

  it("an older product checkout FAILs its build and is never asked to sell the Apply Assistant", () => {
    const { lines, calls } = run(healthy({ "pre:create-product-checkout": pre("create-product-checkout", "create-product-checkout.2026-10-09.61") }), CRON_OFF);
    expect(has(lines, "FAIL", /^FAIL  create-product-checkout preflight x-fn-build = create-product-checkout\.2026-10-09\.61/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /create-product-checkout was not asked to sell/), show(lines)).toBe(true);
    expect(calls.filter((c) => c.startsWith("POST ") && c.includes("create-product-checkout"))).toEqual([]);
  });

  // The review of 9fe3bc0d: .1 refused the Apply Assistant only while the
  // agent's products were off; .2 reads a switch of its own.
  it("a product checkout that retired the Apply Assistant only with the agent's products FAILs its build", () => {
    const { lines } = run(healthy({ "pre:create-product-checkout": pre("create-product-checkout", "create-product-checkout.2026-10-11.1") }), CRON_OFF);
    expect(has(lines, "FAIL", /^FAIL  create-product-checkout preflight x-fn-build = create-product-checkout\.2026-10-11\.1/), show(lines)).toBe(true);
  });

  // The plan was sold with a 7-day first-time trial: a subscription still in
  // it is "trialing", which Stripe's active filter leaves out.
  it("the owner's Stripe step names every billable subscription state, not only active", () => {
    const { lines } = run(healthy(), CRON_OFF);
    const stripe = lines.find((l) => l.startsWith("INFO  owner, in Stripe:")) ?? "";
    for (const status of ["active", "trialing", "past_due"]) expect(stripe, status).toContain(`--status=${status}`);
    expect(stripe).toMatch(/cancel each trialing subscription now, which charges nothing/);
  });

  it("an Apply Assistant purchase that still opens Stripe FAILs", () => {
    const { lines } = run(healthy({
      "post:create-product-checkout": { match: "^POST https://p\\.supabase\\.co/functions/v1/create-product-checkout$", status: 200, body: JSON.stringify({ url: "https://checkout.stripe.com/x" }) },
    }), CRON_OFF);
    expect(has(lines, "FAIL", /create-product-checkout did not refuse the purchase as retired: HTTP 200/), show(lines)).toBe(true);
  });

  it("a 410 that names no free path, or carries a Stripe url, FAILs", () => {
    const noFree = { ...AGENT_410, error: "Der Bewerbungs-Agent wird nicht mehr verkauft." };
    const withUrl = { ...PASS_410, url: "https://checkout.stripe.com/x" };
    const { lines } = run(healthy({
      "post:create-agent-checkout": refusal("create-agent-checkout", noFree),
      "post:create-pass-checkout": refusal("create-pass-checkout", withUrl),
    }), CRON_OFF);
    expect(has(lines, "FAIL", /create-agent-checkout did not refuse the purchase as retired: .*Selbst bewerben ist kostenlos/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /create-pass-checkout did not refuse the purchase as retired: .*Stripe url/), show(lines)).toBe(true);
  });

  it("a checkout that still opens Stripe (200 with a url) FAILs", () => {
    const { lines } = run(healthy({
      "post:create-pass-checkout": { match: "^POST https://p\\.supabase\\.co/functions/v1/create-pass-checkout$", status: 200, body: JSON.stringify({ url: "https://checkout.stripe.com/x" }) },
    }), CRON_OFF);
    expect(has(lines, "FAIL", /create-pass-checkout did not refuse the purchase as retired: HTTP 200/), show(lines)).toBe(true);
  });

  it("a cron list still holding an agent job FAILs; one without the control job is INFO, never PASS", () => {
    const still = run(healthy(), [...CRON_OFF, { ch_jobname: "apply-agent-hourly" }]).lines;
    expect(has(still, "FAIL", /pg_cron still runs apply-agent-hourly/), show(still)).toBe(true);
    expect(has(still, "PASS", /agent-runner-nightly .* is unscheduled/), show(still)).toBe(true);

    const blind = run(healthy(), [{ ch_jobname: "refresh-stats-cache" }]).lines;
    expect(has(blind, "PASS", /unscheduled/), show(blind)).toBe(false);
    expect(has(blind, "INFO", /does not list agent-queue-retention either/), show(blind)).toBe(true);

    const unread = run(healthy(), { code: "PGRST202" }).lines;
    expect(has(unread, "PASS", /unscheduled/), show(unread)).toBe(false);
    expect(has(unread, "INFO", /get_cron_health unreadable/), show(unread)).toBe(true);
  });

  it("a workflow on main that still has a schedule FAILs; an unreadable one is INFO", () => {
    const on = run(healthy({ wf: wf(WF_ON) }), CRON_OFF).lines;
    expect(has(on, "FAIL", /still starts on a schedule/), show(on)).toBe(true);
    const gone = run(healthy({ wf: wf("404: Not Found") }), CRON_OFF).lines;
    expect(has(gone, "INFO", /could not be read/), show(gone)).toBe(true);
    expect(has(gone, "PASS", /starts only by hand/)).toBe(false);
  });
});
