// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz-bugs-affiliate CAN FAIL WHAT IT CLAIMS, NEVER FAILS
 * ON TODAY'S PRODUCTION, WAITS FOR THE OWNER, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-affiliate.sh judges the affiliate
 * lane of the 2026-11-08 bug round: two function builds, the three
 * migrations' columns, tables, helpers and job, the census, and the published
 * page, hook and forgetVisitorIds. Run here against a fake curl and a ledger
 * of the test's own:
 *   - production as it is today (payout request 2026-11-09.1, no
 *     affiliate-account, no new column, the old page and hook) prints no FAIL,
 *     and the one owner-gated line (O1, S14X-085's approval rule) says 'owner
 *     pending' while the ledger's ownerDecided is empty;
 *   - the click privacy lines (M6, C1, P2, P3) judge shipped code, so they
 *     wait for the paste and the publish, never for an owner: with
 *     ownerDecided empty they PASS a good deploy and FAIL a broken one
 *     (S14X-021's owner half is the privacy notice, judged by the
 *     privacy-retention section);
 *   - a good deploy with both owner answers prints PASS for every claim;
 *   - each regression prints FAIL, the key table answering rows at any stage;
 *   - every request is a GET or an OPTIONS, and the key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-affiliate.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_baf";
const P = "https://p\\.supabase\\.co";
const S = "https://site\\.test";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,data=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];
  else if(x==="-d"||x==="--data")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(["-m","-A","--max-time","-w"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\theaders:"+hs.join("|")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const key=method+" "+url+(data!==null?"\\t"+data:"");
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[], ownerDecided: Record<string, string> = {}): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbaf-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "ledger.json"), JSON.stringify({ reservations: { "bug-round": { ownerDecided } } }));
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VDAF_LEDGER: join(dir, "ledger.json"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

const DENIED = (t: string) => ({ status: 401, body: JSON.stringify({ code: "42501", message: `permission denied for table ${t}` }) });
const NOCOL = (t: string, c: string) => ({ status: 400, body: JSON.stringify({ code: "42703", message: `column ${t}.${c} does not exist` }) });
const NOTABLE = (t: string) => ({ status: 404, body: JSON.stringify({ code: "PGRST205", message: `Could not find the table 'public.${t}' in the schema cache` }) });
const EMPTY = { status: 200, body: "[]" };
const NOFN = (f: string) => ({ status: 404, body: JSON.stringify({ code: "PGRST202", message: `Could not find the function public.${f}` }) });
const FN_DENIED = (f: string) => ({ status: 401, body: JSON.stringify({ code: "42501", message: `permission denied for function ${f}` }) });

// The page and the hook as production serves them today (2026-11-15:
// Affiliates-C-MavY8l.js, use-affiliate-auth-Bmz-I3PZ.js, cut to their tells) ...
const OLD_PAGE = 'import{s as e}from"./index-A1.js";function F(){e.rpc("get_affiliate_clicks",{});return["Initial Payout","Completed"]}export{F as default};';
const OLD_HOOK = 'const c="affiliate_ref";function g(){const t=[navigator.userAgent,navigator.language,screen.width+"x"+screen.height,new Date().getTimezoneOffset()].join("|");return t}function N(e){w.rpc("track_affiliate_click",{p_referral_code:e,p_ip_hash:g()})}console.debug("Affiliate referral held until analytics are allowed");';
const OLD_ENTRY = 'const m=["assets/Affiliates-PG.js","assets/use-affiliate-auth-H6.js"];function E2(){try{localStorage.removeItem("rb_vid");const t=[];for(let e=0;e<localStorage.length;e++){const n=localStorage.key(e);n&&n.startsWith("ab_")&&t.push(n)}for(const e of t)localStorage.removeItem(e)}catch{}}';
// ... and as this branch builds them.
const NEW_PAGE = 'import{s as e}from"./index-B2.js";function F(){e.rpc("get_affiliate_clicks",{});const r=d?.stats_by_range?.[x],q=d?.payout_requests;t("affiliateProgram.tiles.awaitingApproval");e.functions.invoke("affiliate-account",{body:{}})}export{F as default};';
const NEW_HOOK = 'const c="affiliate_ref";function N(e){w.rpc("track_affiliate_click",{p_referral_code:e,p_user_agent:navigator.userAgent.slice(0,200)})}console.debug("Affiliate referral held until analytics are allowed");';
const NEW_ENTRY = OLD_ENTRY.replace("catch{}}", 'catch{}try{document.cookie="affiliate_ref=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax"}catch{}}');

const cronRow = (name: string, schedule: string, o: Record<string, unknown> = {}) => ({ ch_jobname: name, ch_schedule: schedule, ch_active: true, ch_runs: 1, ch_failed: 0, ch_last_status: "succeeded", ch_last_start: "2026-11-16T04:23:00Z", ...o });
const OTHER_JOB = cronRow("temp-resume-retention", "*/15 * * * *");
const PRUNE = cronRow("affiliate-clicks-prune", "23 4 * * *");
const APPROVAL = cronRow("affiliate-commission-approval", "47 4 * * *");
const CENSUS = (notCallable: string[] = []) => JSON.stringify({ closed: 56, closed_missing: 0, allowlisted: 60, allowlisted_not_callable: notCallable, closed_still_callable: [] });

type R = { status: number; body: string };
type Over = Partial<{
  payout: string | null; account: string | null;
  sessions: R; affiliates: Record<string, R>; conversions: Record<string, R>;
  budget: R; alias: R; keys: R; days: R;
  cron: unknown[] | string; census: string;
  home: string; entry: string; page: string; hook: string;
}>;

function routes(o: Over = {}, deployed = true): Route[] {
  const cols = (t: string, base: Record<string, R>, extra: Record<string, R> | undefined) => Object.entries({ ...base, ...extra }).map(([c, r]) => ({ match: `^GET ${P}/rest/v1/${t}\\?select=${c}&`, ...r }));
  const affiliates = { created_at: EMPTY, email_confirmed_at: deployed ? EMPTY : NOCOL("affiliates", "email_confirmed_at") };
  const conversions = { created_at: EMPTY, review_flags: deployed ? EMPTY : NOCOL("affiliate_conversions", "review_flags"), currency: deployed ? EMPTY : NOCOL("affiliate_conversions", "currency") };
  const payout = o.payout === undefined ? (deployed ? "affiliate-payout-request.2026-11-12.1" : "affiliate-payout-request.2026-11-09.1") : o.payout;
  const account = o.account === undefined ? (deployed ? "affiliate-account.2026-11-12.2" : null) : o.account;
  const cron = o.cron ?? (deployed ? [OTHER_JOB, PRUNE, APPROVAL] : [OTHER_JOB]);
  return [
    { match: `^OPTIONS ${P}/functions/v1/affiliate-payout-request$`, headers: payout ? { "x-fn-build": payout } : {} },
    { match: `^OPTIONS ${P}/functions/v1/affiliate-account$`, status: account ? 200 : 404, headers: account ? { "x-fn-build": account } : {} },
    { match: `^GET ${P}/rest/v1/affiliate_sessions\\?select=token_hash&`, ...(o.sessions ?? (deployed ? DENIED("affiliate_sessions") : NOCOL("affiliate_sessions", "token_hash"))) },
    ...cols("affiliates", affiliates, o.affiliates),
    ...cols("affiliate_conversions", conversions, o.conversions),
    { match: `^GET ${P}/rest/v1/rpc/client_write_budget_left\\?`, ...(o.budget ?? (deployed ? FN_DENIED("client_write_budget_left") : NOFN("client_write_budget_left"))) },
    { match: `^GET ${P}/rest/v1/rpc/affiliate_returning_pro_customer\\?`, ...(o.alias ?? (deployed ? FN_DENIED("affiliate_returning_pro_customer") : NOFN("affiliate_returning_pro_customer"))) },
    { match: `^GET ${P}/rest/v1/affiliate_hash_keys\\?select=purpose&`, ...(o.keys ?? (deployed ? DENIED("affiliate_hash_keys") : NOTABLE("affiliate_hash_keys"))) },
    { match: `^GET ${P}/rest/v1/affiliate_click_days\\?select=day&`, ...(o.days ?? (deployed ? DENIED("affiliate_click_days") : NOTABLE("affiliate_click_days"))) },
    { match: `^GET ${P}/rest/v1/rpc/get_cron_health\\?p_hours=26$`, body: typeof cron === "string" ? cron : JSON.stringify(cron) },
    { match: `^GET ${P}/rest/v1/rpc/client_callable_census$`, body: o.census ?? CENSUS() },
    { match: `^GET ${S}/$`, body: o.home ?? '<html><head><script type="module" src="/assets/index-A1.js"></script></head></html>' },
    { match: `^GET ${S}/assets/index-A1\\.js$`, body: o.entry ?? (deployed ? NEW_ENTRY : OLD_ENTRY) },
    { match: `^GET ${S}/assets/Affiliates-PG\\.js$`, body: o.page ?? (deployed ? NEW_PAGE : OLD_PAGE) },
    { match: `^GET ${S}/assets/use-affiliate-auth-H6\\.js$`, body: o.hook ?? (deployed ? NEW_HOOK : OLD_HOOK) },
    { match: `^GET ${S}/affiliates$`, body: "<html><body>Track clicks for any date range you pick.</body></html>" },
  ];
}

const OWNERS = { "S14X-021": "approved-full", "S14X-085": "30-day hold" };
const has = (lines: string[], verdict: string, re: RegExp) => lines.some((l) => l.startsWith(verdict) && re.test(l));
const show = (lines: string[]) => lines.join("\n");
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const CLAIMS = ["F1", "F2", "M1", "M2", "M3", "M4", "M5", "M6", "C1", "K1", "P1", "P2", "P3", "O1"];

describe("today's production, before the merge and the paste", () => {
  const { lines, out } = run(routes({}, false));
  it("prints no FAIL: what has not shipped is INFO, and the owner-gated lines wait for the ledger", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of ["F1", "F2", "M1", "M2", "M3", "M4", "M5", "M6", "C1", "P1", "P2", "P3"]) expect(has(lines, "INFO", new RegExp(`^INFO {2}${c} `)), `${c}\n${show(lines)}`).toBe(true);
    for (const c of ["M6", "C1", "P2", "P3"]) expect(has(lines, "INFO", new RegExp(`^INFO {2}${c} owner pending`)), `${c} waits for an owner though its code ships\n${show(lines)}`).toBe(false);
    expect(has(lines, "INFO", /^INFO {2}O1 owner pending/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /^PASS {2}K1 /), show(lines)).toBe(true);
  });
  it("with the owner's answers copied in, still no FAIL before the paste", () => {
    const after = run(routes({}, false), OWNERS).lines;
    expect(fails(after), show(after)).toEqual([]);
    expect(after.some((l) => /owner pending/.test(l)), show(after)).toBe(false);
  });
  it("every line is a verdict or the header, and the key is never printed", () => {
    expect(lines.every((l) => /^(PASS|FAIL|INFO) /.test(l) || /^== 99zzzzzzz-bugs-affiliate\. /.test(l)), show(lines)).toBe(true);
    expect(out).not.toContain(KEY);
  });
});

describe("a good deploy", () => {
  const { lines, calls } = run(routes(), OWNERS);
  it("prints PASS for every claim and no FAIL", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of CLAIMS) expect(has(lines, "PASS", new RegExp(`^PASS {2}${c} `)), `${c}\n${show(lines)}`).toBe(true);
  });
  it("asks only with GET and OPTIONS: nothing is posted, the helpers are probed read-only", () => {
    expect(calls.length).toBeGreaterThan(10);
    for (const c of calls) expect(c, c).toMatch(/^curl\t(GET|OPTIONS) /);
  });
  it("without the owner's answers, only O1 waits: the click privacy lines judge the shipped code and pass", () => {
    const pending = run(routes()).lines;
    expect(fails(pending), show(pending)).toEqual([]);
    expect(has(pending, "INFO", /^INFO {2}O1 owner pending/), show(pending)).toBe(true);
    for (const c of CLAIMS.filter((x) => x !== "O1")) expect(has(pending, "PASS", new RegExp(`^PASS {2}${c} `)), `${c}\n${show(pending)}`).toBe(true);
  });
});

describe("each regression prints FAIL", () => {
  it("F1, F2: no build header; affiliate-account missing from the paste that carried the payout function; an older account build", () => {
    expect(has(run(routes({ payout: null }), OWNERS).lines, "FAIL", /^FAIL {2}F1 .*carries no x-fn-build/)).toBe(true);
    const lines = run(routes({ account: null }), OWNERS).lines;
    expect(has(lines, "FAIL", /^FAIL {2}F2 .*not deployed/), show(lines)).toBe(true);
    expect(has(run(routes({ account: "affiliate-account.2026-11-10.1" }), OWNERS).lines, "FAIL", /^FAIL {2}F2 .*older than 2026-11-12\.2/)).toBe(true);
    const first = run(routes({ account: "affiliate-account.2026-11-12.1" }), OWNERS).lines;
    expect(has(first, "FAIL", /^FAIL {2}F2 .*older than 2026-11-12\.2/), `the build before the change-link doors passed\n${show(first)}`).toBe(true);
  });

  it("M1: the column missing after the functions went live, a grant the migration revokes, rows to anon", () => {
    expect(has(run(routes({ sessions: NOCOL("affiliate_sessions", "token_hash") }), OWNERS).lines, "FAIL", /^FAIL {2}M1 .*no token_hash, though the round's functions are live/)).toBe(true);
    expect(has(run(routes({ sessions: EMPTY }), OWNERS).lines, "FAIL", /^FAIL {2}M1 .*anon still holds a grant/)).toBe(true);
    expect(has(run(routes({ sessions: { status: 200, body: '[{"token_hash":"x"}]' } }), OWNERS).lines, "FAIL", /^FAIL {2}M1 .*answered rows/)).toBe(true);
  });

  it("M2, M3: a column missing after the functions went live, a set applied in part, a readable control, a gateway page", () => {
    expect(has(run(routes({ affiliates: { email_confirmed_at: NOCOL("affiliates", "email_confirmed_at") } }), OWNERS).lines, "FAIL", /^FAIL {2}M2 .*has none of email_confirmed_at, though/)).toBe(true);
    const part = run(routes({ conversions: { currency: NOCOL("affiliate_conversions", "currency") } }), OWNERS).lines;
    expect(has(part, "FAIL", /^FAIL {2}M3 .*has 1 of the 2 new columns/), show(part)).toBe(true);
    expect(has(run(routes({ conversions: { created_at: { status: 200, body: '[{"created_at":"x"}]' } } }), OWNERS).lines, "FAIL", /^FAIL {2}M3 .*readable by anyone/)).toBe(true);
    expect(has(run(routes({ affiliates: { created_at: { status: 502, body: "<html>Bad gateway</html>" } } }), OWNERS).lines, "FAIL", /^FAIL {2}M2 the control column .*NONJSON/)).toBe(true);
  });

  it("M4, M5: a helper open to anon, or one that tried to write", () => {
    expect(has(run(routes({ budget: { status: 200, body: "7" } }), OWNERS).lines, "FAIL", /^FAIL {2}M4 client_write_budget_left answered anon a value/)).toBe(true);
    expect(has(run(routes({ alias: { status: 400, body: JSON.stringify({ code: "25006", message: "read-only transaction" }) } }), OWNERS).lines, "FAIL", /^FAIL {2}M5 .*CALLABLE as anon/)).toBe(true);
    expect(has(run(routes({ budget: NOFN("client_write_budget_left") }), OWNERS).lines, "FAIL", /^FAIL {2}M4 .*PGRST202.*though the round's functions are live/)).toBe(true);
  });

  it("M6: the key table answering rows is a FAIL even before the paste and with no owner answer; the rollup keeping a grant", () => {
    const leak = run(routes({ keys: { status: 200, body: '[{"purpose":"click"}]' } }, false)).lines;
    expect(has(leak, "FAIL", /^FAIL {2}M6 affiliate_hash_keys answered the publishable key ROWS:1/), show(leak)).toBe(true);
    expect(has(run(routes({ days: EMPTY }), OWNERS).lines, "FAIL", /^FAIL {2}M6 affiliate_click_days answered \[\] to anon/)).toBe(true);
    expect(has(run(routes({ days: NOTABLE("affiliate_click_days") }), OWNERS).lines, "FAIL", /^FAIL {2}M6 affiliate_click_days does not exist .*though the round's functions are live/)).toBe(true);
  });

  it("C1, O1: a failed prune, a prune missing after its migration applied, the wrong schedule, an approval job missing once answered", () => {
    expect(has(run(routes({ cron: [OTHER_JOB, cronRow("affiliate-clicks-prune", "23 4 * * *", { ch_failed: 1, ch_last_status: "failed" }), APPROVAL] }), OWNERS).lines, "FAIL", /^FAIL {2}C1 affiliate-clicks-prune: 1 run\(s\) in 26 h, 1 failed/)).toBe(true);
    expect(has(run(routes({ cron: [OTHER_JOB, APPROVAL] }), OWNERS).lines, "FAIL", /^FAIL {2}C1 the affiliate-clicks-prune job is not scheduled, though the migration that schedules it applied/)).toBe(true);
    expect(has(run(routes({ cron: [OTHER_JOB, cronRow("affiliate-clicks-prune", "*/5 * * * *"), APPROVAL] }), OWNERS).lines, "FAIL", /^FAIL {2}C1 .*want active, 23 4 \* \* \*/)).toBe(true);
    expect(has(run(routes({ cron: [OTHER_JOB, PRUNE] }), OWNERS).lines, "FAIL", /^FAIL {2}O1 the affiliate-commission-approval job is not scheduled/)).toBe(true);
    expect(has(run(routes({ cron: "<html>Bad gateway</html>" }), OWNERS).lines, "FAIL", /^FAIL {2}C1 get_cron_health is unreadable/)).toBe(true);
  });

  it("K1: an affiliate function the page calls found closed, and a census that cannot be read", () => {
    expect(has(run(routes({ census: CENSUS(["public.login_affiliate(text,text)"]) }), OWNERS).lines, "FAIL", /^FAIL {2}K1 .*login_affiliate/)).toBe(true);
    expect(has(run(routes({ census: JSON.stringify({ code: "PGRST202" }) }), OWNERS).lines, "FAIL", /^FAIL {2}K1 client_callable_census is unreadable/)).toBe(true);
  });

  it("P1: a page that is neither, an entry naming no page chunk, no entry at all", () => {
    const mixed = run(routes({ page: NEW_PAGE.replace("return", "") + 'const z="Initial Payout";' }), OWNERS).lines;
    expect(has(mixed, "FAIL", /^FAIL {2}P1 .*is neither page.*still draws 'Initial Payout'/), show(mixed)).toBe(true);
    expect(has(run(routes({ entry: 'const m=["assets/use-affiliate-auth-H6.js"];' }), OWNERS).lines, "FAIL", /^FAIL {2}P1 .*names no Affiliates chunk/)).toBe(true);
    expect(has(run(routes({ home: "<html></html>" }), OWNERS).lines, "FAIL", /^FAIL {2}P1 the homepage names no/)).toBe(true);
  });

  it("M6, C1, P2, P3 fail a broken paste or publish with no owner answer recorded", () => {
    const noDays = run(routes({ days: NOTABLE("affiliate_click_days") })).lines;
    expect(has(noDays, "FAIL", /^FAIL {2}M6 affiliate_click_days does not exist .*though the round's functions are live/), show(noDays)).toBe(true);
    const noJob = run(routes({ cron: [OTHER_JOB, APPROVAL] })).lines;
    expect(has(noJob, "FAIL", /^FAIL {2}C1 the affiliate-clicks-prune job is not scheduled/), show(noJob)).toBe(true);
    const failedJob = run(routes({ cron: [OTHER_JOB, cronRow("affiliate-clicks-prune", "23 4 * * *", { ch_failed: 3, ch_last_status: "failed" })] })).lines;
    expect(has(failedJob, "FAIL", /^FAIL {2}C1 affiliate-clicks-prune: 1 run\(s\) in 26 h, 3 failed/), show(failedJob)).toBe(true);
    const oldHook = run(routes({ hook: OLD_HOOK })).lines;
    expect(has(oldHook, "FAIL", /^FAIL {2}P2 .*still builds the agent\/screen\/time-zone fingerprint/), show(oldHook)).toBe(true);
    const oldForget = run(routes({ entry: OLD_ENTRY })).lines;
    expect(has(oldForget, "FAIL", /^FAIL {2}P3 .*does not clear the affiliate_ref cookie/), show(oldForget)).toBe(true);
  });

  it("P2, P3: the old hook or the old forget once the round's page is published", () => {
    expect(has(run(routes({ hook: OLD_HOOK }), OWNERS).lines, "FAIL", /^FAIL {2}P2 .*still builds the agent\/screen\/time-zone fingerprint/)).toBe(true);
    expect(has(run(routes({ entry: OLD_ENTRY }), OWNERS).lines, "FAIL", /^FAIL {2}P3 .*does not clear the affiliate_ref cookie, though the round's page is published/)).toBe(true);
    expect(has(run(routes({ entry: NEW_ENTRY.split('startsWith("ab_")').join("x") }), OWNERS).lines, "FAIL", /^FAIL {2}P3 .*holds no forgetVisitorIds/)).toBe(true);
  });
});
