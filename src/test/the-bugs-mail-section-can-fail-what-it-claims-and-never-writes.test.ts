// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl and a fake dig on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz-bugs-mail CAN FAIL WHAT IT CLAIMS, NEVER FAILS
 * FALSELY ON TODAY'S PRODUCTION, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-mail.sh judges the bug round's mail
 * lane from outside: four builds, the prune job, the pulse's claim and
 * schedules, the account page's and the confirm page's marks, the mail string
 * shard, two owner gates and the notify subdomain's DMARC. Run here against
 * fakes:
 *   - production as it was on 2026-11-15 (every function 2026-11-09.1, 58 cron
 *     jobs with no prune, the one-argument claim, the account page without the
 *     lane's marks, notify's DMARC p=none) prints INFO and no FAIL but the
 *     DMARC line, which is the owner's DNS step and is true;
 *   - a good deploy prints PASS for every claim and no FAIL;
 *   - each regression prints FAIL: a missing build header, a partial paste, a
 *     paste without the prune job, the job without its own timeout or failing,
 *     a paste without the two-argument claim, a claim anon reaches, no pulse
 *     schedule or three, a published page missing a mark, a missing or
 *     unreadable chunk, a short mail shard, and a DMARC record of p=none;
 *   - the owner-gated lines are INFO 'owner pending' until the ledger names
 *     their keys, then judge the option chosen;
 *   - every request is a GET or an OPTIONS, a function is only asked for its
 *     preflight, and the key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 240_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-mail.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_bugs_mail";
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
if(o&&o!=="/dev/null")fs.writeFileSync(o,r.body??"");else if(!o)out+=r.body??"";
process.stdout.write(out);
`;
const FAKE_DIG = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);const name=a.find((x)=>/^_dmarc\\./.test(x))||"";
fs.appendFileSync(process.env.VD_CALLS,"dig\\t"+a.join(" ")+"\\n");
const map=JSON.parse(process.env.VD_DIG||"{}");
process.stdout.write(map[name]!=null?map[name]+"\\n":"");
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

type Run = { lines: string[]; calls: string[]; out: string };
function run(routes: Route[], dig: Record<string, string>, ledger?: unknown): Run {
  const dir = mkdtempSync(join(tmpdir(), "vdbm-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  writeFileSync(join(dir, "bin", "dig"), FAKE_DIG);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  chmodSync(join(dir, "bin", "dig"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "ledger.json"), JSON.stringify(ledger ?? { reservations: { "bug-round": { ownerDecided: {} } } }));
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VD_DIG: JSON.stringify(dig),
    VDBM_LEDGER: join(dir, "ledger.json"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

const FNS = ["send-search-digest", "send-agent-digest", "send-market-pulse", "account-settings", "send-scan-report"] as const;
type Fn = typeof FNS[number];
const job = (name: string, schedule: string, over: Record<string, unknown> = {}) => ({
  ch_jobname: name, ch_schedule: schedule, ch_active: true, ch_timeout: null, ch_runs: 1, ch_failed: 0, ch_timeouts: 0,
  ch_last_start: "2026-11-15T15:47:00+00:00", ch_last_status: "succeeded", ch_last_seconds: 0, ch_max_seconds: 0, ...over,
});
const OTHER = Array.from({ length: 54 }, (_, i) => job(`job-${i}`, "*/10 * * * *"));
const PULSE = [job("send-market-pulse", "47 15 * * *"), job("send-market-pulse-monthly", "0 9 1 * *", { ch_runs: 0, ch_last_status: null })];
const TODAY_CRON = [...OTHER, ...PULSE, job("rb-auth-mail-drain", "10 seconds", { ch_timeout: "10s" }), job("send-search-digest", "23 14 * * *")];
const PRUNE = job("mail-lists-prune", "37 4 * * *", { ch_timeout: "5min", ch_runs: 0, ch_last_status: null });
const DONE_CRON = [...TODAY_CRON, PRUNE];
const E42501 = JSON.stringify({ code: "42501", details: null, hint: null, message: "permission denied for function market_pulse_claim_batch" });
const E202 = JSON.stringify({ code: "PGRST202", message: "Could not find the function public.market_pulse_claim_batch(p_limit, p_now) in the schema cache" });

const BASE_ACCOUNT = 'const x="data-mail-card";const y="digest_opt_in";'.padEnd(2000, " ");
const NEW_ACCOUNT = `${BASE_ACCOUNT} r.mailStopped;({digest_cadence:e,...l});"data-cadence-select";"data-mail-stopped";t("mailPrefs.newHeadlineCapped")`;
const BASE_PULSE = 't("pulseConfirm.done");t("pulseConfirm.title")';
const NEW_PULSE = `${BASE_PULSE};"data-next-pulse"`;
const LANGS = ["de", "en-GB", "es", "fr", "hi", "nl", "pt", "tl"];
const SHARD_KEYS = ["pulseDoneNextMonth", "pulseDoneLater", "stoppedUnsubscribe", "stoppedAccountDeleted", "stoppedBounce", "stoppedComplaint", "cadenceAria", "newHeadlineCapped"];
const shardBody = (keys = SHARD_KEYS) => `const e={${keys.map((k) => `${k}:"x"`).join(",")}};export{e as default};`;

type Over = {
  builds?: Partial<Record<Fn, string | null>>; cron?: string; claim?: string; claimStatus?: number;
  account?: string | null; pulse?: string | null; shard?: "none" | "full" | "seven" | "short" | "no-en"; accountName?: string | null;
};
function routes(o: Over = {}, deployed = true): Route[] {
  const today: Record<Fn, string> = Object.fromEntries(FNS.map((f) => [f, `${f}.2026-11-09.1`])) as Record<Fn, string>;
  const fresh: Record<Fn, string> = Object.fromEntries(FNS.map((f) => [f, `${f}.2026-11-12.1`])) as Record<Fn, string>;
  const builds: Record<Fn, string | null> = { ...(deployed ? { ...fresh, "send-scan-report": today["send-scan-report"] } : today), ...o.builds };
  const shard = o.shard ?? (deployed ? "full" : "none");
  const accountName = o.accountName === undefined ? "Account-AAA111.js" : o.accountName;
  const lazy = (shard === "seven" ? LANGS.slice(0, 7) : shard === "none" ? [] : LANGS)
    .map((l) => `"./shards/mail/${l}.json":()=>O(()=>import("./${l}-m${l.replace("-", "")}.js"),[])`).join(",");
  const enInline = shard === "none" || shard === "no-en" ? "" : `"./shards/mail/en.json":Mn,${SHARD_KEYS.map((k) => `${k}:"x"`).join(",")}`;
  const entry = `import"./x.js";${accountName ? `"assets/${accountName}";` : ""}"assets/MarketPulseConfirm-PPP222.js";${enInline};${lazy}`;
  const out: Route[] = [
    ...FNS.map((fn): Route => ({ match: `^OPTIONS ${P}/functions/v1/${fn}$`, headers: { "access-control-allow-origin": "*", ...(builds[fn] ? { "x-fn-build": builds[fn] as string } : {}) } })),
    { match: `^GET ${P}/rest/v1/rpc/get_cron_health\\?p_hours=24$`, body: o.cron ?? JSON.stringify(deployed ? DONE_CRON : TODAY_CRON) },
    { match: `^GET ${P}/rest/v1/rpc/market_pulse_claim_batch\\?p_limit=1&p_now=`, status: o.claimStatus ?? (deployed ? 401 : 404), body: o.claim ?? (deployed ? E42501 : E202) },
    { match: `^GET ${S}/account$`, body: '<html><script type="module" src="/assets/index-ENTRY1.js"></script></html>' },
    { match: `^GET ${S}/assets/index-ENTRY1\\.js$`, body: entry },
    { match: `^GET ${S}/assets/Account-AAA111\\.js$`, body: o.account === undefined ? (deployed ? NEW_ACCOUNT : BASE_ACCOUNT) : (o.account ?? "") },
    { match: `^GET ${S}/assets/MarketPulseConfirm-PPP222\\.js$`, body: o.pulse === undefined ? (deployed ? NEW_PULSE : BASE_PULSE) : (o.pulse ?? "") },
    ...LANGS.map((l, i): Route => ({ match: `^GET ${S}/assets/${l}-m${l.replace("-", "")}\\.js$`, body: shard === "short" && i === 2 ? shardBody(SHARD_KEYS.slice(1)) : shardBody() })),
  ];
  return out;
}
const DIG_TODAY = { "_dmarc.notify.resumebooster.work": '"v=DMARC1; p=none"', "_dmarc.resumebooster.work": '"v=DMARC1; p=quarantine; adkim=r; aspf=r;"' };
const DIG_FIXED = { ...DIG_TODAY, "_dmarc.notify.resumebooster.work": '"v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"' };
const decided = (d: Record<string, unknown>) => ({ reservations: { "bug-round": { ownerDecided: d } } });

const has = (lines: string[], verdict: string, re: RegExp) => lines.some((l) => l.startsWith(verdict) && re.test(l));
const show = (lines: string[]) => lines.join("\n");
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const KEYS = ["S14X-062", "S14X-107", "S14X-102", "S14X-237", "S14X-238", "S14X-239", "S14X-171", "S14X-172", "S14X-252/mail-handoff", "RC-S13-083", "S14X-012-mail", "S14X-234-verify"];

describe("today's production, before the paste", () => {
  const { lines, out, calls } = run(routes({}, false), DIG_TODAY);
  it("prints no FAIL but the notify DMARC, which is true today and the owner's step", () => {
    expect(fails(lines), show(lines)).toEqual([expect.stringMatching(/^FAIL {2}S14X-234-verify _dmarc\.notify\.resumebooster\.work says 'v=DMARC1; p=none'/)]);
    expect(lines.filter((l) => /^INFO {2}B /.test(l)), show(lines)).toHaveLength(4);
    expect(has(lines, "INFO", /^INFO {2}S14X-102 no mail-lists-prune job among 58 yet/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /^INFO {2}S14X-238 market_pulse_claim_batch takes p_limit alone yet/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /^INFO {2}F0 .*frontend is unpublished/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /^INFO {2}S14X-012-mail owner pending/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /^INFO {2}D9 owner pending/), show(lines)).toBe(true);
  });
  it("names every one of the lane's twelve verify keys", () => {
    for (const k of KEYS) expect(lines.some((l) => l.startsWith(`INFO  ${k} `) || l.startsWith(`FAIL  ${k} `)), k).toBe(true);
  });
  it("every line is a verdict or the header, and the key is never printed", () => {
    expect(lines.every((l) => /^(PASS|FAIL|INFO) /.test(l) || /^== 99zzzzzzz\. /.test(l)), show(lines)).toBe(true);
    expect(out).not.toContain(KEY);
    expect(calls.some((c) => c.startsWith("dig\t"))).toBe(true);
  });
});

describe("a good deploy", () => {
  const { lines, calls, out } = run(routes(), DIG_FIXED, decided({ "S14X-012": { choice: "B" }, D9: "yes" }));
  it("prints PASS for every claim and no FAIL", () => {
    const withB = run(routes({ builds: { "send-scan-report": "send-scan-report.2026-11-12.1" }, account: `${NEW_ACCOUNT};"mail_resume"` }), DIG_FIXED, decided({ "S14X-012": { choice: "B" }, D9: "yes" })).lines;
    expect(fails(withB), show(withB)).toEqual([]);
    expect(withB.filter((l) => /^PASS {2}B /.test(l)), show(withB)).toHaveLength(4);
    for (const k of KEYS) expect(withB.some((l) => l.startsWith(`PASS  ${k} `)), `${k}\n${show(withB)}`).toBe(true);
    for (const k of ["NB-21", "S1", "D9"]) expect(withB.some((l) => l.startsWith(`PASS  ${k} `)), `${k}\n${show(withB)}`).toBe(true);
    expect(has(withB, "PASS", /^PASS {2}S14X-102 mail-lists-prune runs 37 4 \* \* \* with statement_timeout 5min/), show(withB)).toBe(true);
    expect(has(withB, "PASS", /^PASS {2}S14X-238 the two-argument claim exists .*second schedule is the owner step C-S14-080/), show(withB)).toBe(true);
    expect(has(withB, "PASS", /^PASS {2}S1 the entry carries the English mail shard and names 8 more/), show(withB)).toBe(true);
  });
  it("a later build passes too: this round's build or later", () => {
    const later = run(routes({ builds: { "send-market-pulse": "send-market-pulse.2026-11-13.1" } }), DIG_FIXED).lines;
    expect(has(later, "PASS", /^PASS {2}B send-market-pulse x-fn-build = send-market-pulse\.2026-11-13\.1/), show(later)).toBe(true);
    expect(has(later, "PASS", /^PASS {2}S14X-237 /), show(later)).toBe(true);
  });
  it("asks only with GET and OPTIONS: nothing is posted, no function is called but for its preflight, and the key is never printed", () => {
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls.filter((x) => x.startsWith("curl\t"))) expect(c, c).toMatch(/^curl\t(GET|OPTIONS) /);
    for (const c of calls.filter((x) => /\/functions\/v1\//.test(x))) expect(c, c).toMatch(/^curl\tOPTIONS /);
    expect(out).not.toContain(KEY);
  });
});

describe("each regression prints FAIL", () => {
  it("B: a function whose preflight carries no build header, before the paste or after", () => {
    for (const fn of ["send-search-digest", "send-agent-digest", "send-market-pulse", "account-settings"] as const) {
      const r = run(routes({ builds: { [fn]: null } }), DIG_FIXED).lines;
      expect(has(r, "FAIL", new RegExp(`^FAIL {2}B ${fn} preflight carries no x-fn-build`)), show(r)).toBe(true);
    }
    expect(has(run(routes({ builds: { "account-settings": null } }, false), DIG_TODAY).lines, "FAIL", /^FAIL {2}B account-settings preflight carries no x-fn-build/)).toBe(true);
  });

  it("a partial paste: one function left behind fails its B line and every key it carries", () => {
    const r = run(routes({ builds: { "send-search-digest": "send-search-digest.2026-11-09.1" } }), DIG_FIXED).lines;
    expect(has(r, "FAIL", /^FAIL {2}B send-search-digest x-fn-build = send-search-digest\.2026-11-09\.1 while the lane's other functions serve 2026-11-12\.1/), show(r)).toBe(true);
    for (const k of ["S14X-062", "S14X-171", "S14X-172", "S14X-252/mail-handoff"]) expect(has(r, "FAIL", new RegExp(`^FAIL {2}${k.replace("/", "\\/")} the paste is live but send-search-digest=`)), `${k}\n${show(r)}`).toBe(true);
    const pulse = run(routes({ builds: { "send-market-pulse": "send-market-pulse.2026-11-09.1" } }), DIG_FIXED).lines;
    expect(has(pulse, "FAIL", /^FAIL {2}S14X-102 mail-lists-prune is scheduled, but send-market-pulse or account-settings does not serve/), show(pulse)).toBe(true);
    expect(has(pulse, "FAIL", /^FAIL {2}S14X-238 the calendar-month claim exists but send-market-pulse does not serve/), show(pulse)).toBe(true);
  });

  it("S14X-102: a paste without the job, the job without its own timeout, switched off or failing, and a reader that answers nothing", () => {
    expect(has(run(routes({ cron: JSON.stringify(TODAY_CRON) }), DIG_FIXED).lines, "FAIL", /^FAIL {2}S14X-102 the paste is live but get_cron_health lists no mail-lists-prune job among 58/)).toBe(true);
    expect(has(run(routes({ cron: JSON.stringify([...TODAY_CRON, { ...PRUNE, ch_timeout: null }]) }), DIG_FIXED).lines, "FAIL", /^FAIL {2}S14X-102 mail-lists-prune is scheduled \(37 4 \* \* \*\) without a statement_timeout of its own/)).toBe(true);
    expect(has(run(routes({ cron: JSON.stringify([...TODAY_CRON, { ...PRUNE, ch_active: false }]) }), DIG_FIXED).lines, "FAIL", /^FAIL {2}S14X-102 mail-lists-prune is scheduled but switched off/)).toBe(true);
    expect(has(run(routes({ cron: JSON.stringify([...TODAY_CRON, { ...PRUNE, ch_runs: 1, ch_failed: 1, ch_last_status: "failed" }]) }), DIG_FIXED).lines, "FAIL", /^FAIL {2}S14X-102 mail-lists-prune last ran and failed \(1 of 1/)).toBe(true);
    const refused = run(routes({ cron: JSON.stringify({ code: "42501", message: "permission denied for function get_cron_health" }) }, false), DIG_TODAY).lines;
    expect(has(refused, "FAIL", /^FAIL {2}S14X-102 get_cron_health as anon answered no jobs/), show(refused)).toBe(true);
  });

  it("S14X-238: a paste without the two-argument claim, a claim anon reaches, an odd answer, no pulse schedule, or three", () => {
    expect(has(run(routes({ claim: E202, claimStatus: 404 }), DIG_FIXED).lines, "FAIL", /^FAIL {2}S14X-238 the paste is live but there is no market_pulse_claim_batch\(p_limit, p_now\)/)).toBe(true);
    const reached = run(routes({ claim: JSON.stringify({ code: "25006", message: "cannot execute UPDATE in a read-only transaction" }), claimStatus: 500 }, false), DIG_TODAY).lines;
    expect(has(reached, "FAIL", /^FAIL {2}S14X-238 anon reached market_pulse_claim_batch/), show(reached)).toBe(true);
    expect(has(run(routes({ claim: "<html>Bad gateway</html>", claimStatus: 502 }), DIG_FIXED).lines, "FAIL", /^FAIL {2}S14X-238 the claim probe answered <html>/)).toBe(true);
    const none = JSON.stringify(DONE_CRON.filter((r) => !/^send-market-pulse/.test(r.ch_jobname)));
    expect(has(run(routes({ cron: none }), DIG_FIXED).lines, "FAIL", /^FAIL {2}S14X-238 the calendar-month claim exists but no send-market-pulse job is scheduled/)).toBe(true);
    const three = JSON.stringify([...DONE_CRON, job("send-market-pulse-extra", "0 12 * * *")]);
    expect(has(run(routes({ cron: three }), DIG_FIXED).lines, "FAIL", /^FAIL {2}S14X-238 3 send-market-pulse jobs are scheduled/)).toBe(true);
    const one = run(routes({ cron: JSON.stringify(DONE_CRON.filter((r) => r.ch_jobname !== "send-market-pulse-monthly")) }), DIG_FIXED).lines;
    expect(has(one, "PASS", /^PASS {2}S14X-238 the two-argument claim exists .*whichever of send-market-pulse runs it$/), show(one)).toBe(true);
  });

  it("the frontend: a published page missing a mark, and a chunk that is missing or not the page", () => {
    const noCadence = run(routes({ account: NEW_ACCOUNT.replace("digest_cadence:", "cadence:") }), DIG_FIXED).lines;
    expect(has(noCadence, "FAIL", /^FAIL {2}RC-S13-083 the round's frontend published but the chunk holds no digest_cadence:/), show(noCadence)).toBe(true);
    const noStop = run(routes({ account: NEW_ACCOUNT.replace("r.mailStopped", "r.x") }), DIG_FIXED).lines;
    expect(has(noStop, "FAIL", /^FAIL {2}S14X-107 the round's frontend published but the chunk holds no mailStopped/), show(noStop)).toBe(true);
    const noNext = run(routes({ pulse: BASE_PULSE }), DIG_FIXED).lines;
    expect(has(noNext, "FAIL", /^FAIL {2}S14X-238 the round's frontend published but the chunk holds no data-next-pulse/), show(noNext)).toBe(true);
    expect(has(run(routes({ accountName: null }), DIG_FIXED).lines, "FAIL", /^FAIL {2}F0 the entry \/assets\/index-ENTRY1\.js names no Account chunk/)).toBe(true);
    expect(has(run(routes({ account: "<html>not found</html>" }), DIG_FIXED).lines, "FAIL", /^FAIL {2}F0 .*names no Account chunk holding the Email preferences card \(Account-AAA111\.js\)/)).toBe(true);
    expect(has(run(routes({ pulse: "" }), DIG_FIXED).lines, "FAIL", /^FAIL {2}F0 .*names no MarketPulseConfirm chunk/)).toBe(true);
    // The marks alone, with no shard, still say the round published.
    const noShard = run(routes({ shard: "none" }), DIG_FIXED).lines;
    expect(has(noShard, "FAIL", /^FAIL {2}S1 the round's account page published but the entry loads no mail shard/), show(noShard)).toBe(true);
  });

  it("S1: a mail shard with seven languages, a missing English one, or a language short of a string", () => {
    expect(has(run(routes({ shard: "seven" }), DIG_FIXED).lines, "FAIL", /^FAIL {2}S1 the entry names 7 non-English mail shards, not 8/)).toBe(true);
    expect(has(run(routes({ shard: "no-en" }), DIG_FIXED).lines, "FAIL", /^FAIL {2}S1 the entry names 8 lazy mail shards but not the English one/)).toBe(true);
    expect(has(run(routes({ shard: "short" }), DIG_FIXED).lines, "FAIL", /^FAIL {2}S1 mail shard strings missing: es:pulseDoneNextMonth$/)).toBe(true);
  });

  it("S14X-234-verify: notify's own p=none, and no record over an apex of p=none; no record over a quarantined apex passes", () => {
    expect(has(run(routes(), DIG_TODAY).lines, "FAIL", /^FAIL {2}S14X-234-verify _dmarc\.notify\.resumebooster\.work says 'v=DMARC1; p=none'/)).toBe(true);
    const bare = run(routes(), { "_dmarc.resumebooster.work": '"v=DMARC1; p=none"' }).lines;
    expect(has(bare, "FAIL", /^FAIL {2}S14X-234-verify no record at _dmarc\.notify and the apex says 'v=DMARC1; p=none'/), show(bare)).toBe(true);
    const apex = run(routes(), { "_dmarc.resumebooster.work": DIG_TODAY["_dmarc.resumebooster.work"] }).lines;
    expect(has(apex, "PASS", /^PASS {2}S14X-234-verify no record at _dmarc\.notify, so the apex's applies: v=DMARC1; p=quarantine/), show(apex)).toBe(true);
  });
});

describe("the owner gates", () => {
  it("S14X-012-mail decided B: the paste without send-scan-report's build fails, before the paste it waits", () => {
    const after = run(routes(), DIG_FIXED, decided({ "S14X-012": { choice: "B", on: "2026-11-15" } })).lines;
    expect(has(after, "FAIL", /^FAIL {2}S14X-012-mail decided \(B\): the paste is live but send-scan-report serves send-scan-report\.2026-11-09\.1/), show(after)).toBe(true);
    const before = run(routes({}, false), DIG_TODAY, decided({ "S14X-012": "B" })).lines;
    expect(has(before, "INFO", /^INFO {2}S14X-012-mail decided \(B\): send-scan-report serves send-scan-report\.2026-11-09\.1; the paste has not landed/), show(before)).toBe(true);
    const none = run(routes({ builds: { "send-scan-report": null } }), DIG_FIXED, decided({ "S14X-012": "B" })).lines;
    expect(has(none, "FAIL", /^FAIL {2}S14X-012-mail decided \(B\): send-scan-report's preflight carries no x-fn-build/), show(none)).toBe(true);
  });

  it("S14X-012-mail decided A: a drain job with its own timeout passes; none after the paste fails; an unknown option fails", () => {
    const drained = JSON.stringify([...DONE_CRON, job("transactional-emails-drain", "*/5 * * * *", { ch_timeout: "30s" })]);
    expect(has(run(routes({ cron: drained }), DIG_FIXED, decided({ "S14X-012": "A" })).lines, "PASS", /^PASS {2}S14X-012-mail decided \(A\): transactional-emails-drain drains transactional_emails/)).toBe(true);
    expect(has(run(routes(), DIG_FIXED, decided({ "S14X-012": "A" })).lines, "FAIL", /^FAIL {2}S14X-012-mail decided \(A\): the paste is live but no job drains transactional_emails/)).toBe(true);
    expect(has(run(routes(), DIG_FIXED, decided({ "S14X-012": "C" })).lines, "FAIL", /^FAIL {2}S14X-012-mail ownerDecided names S14X-012 as 'C'/)).toBe(true);
  });

  it("D9 decided yes: a published page with no resume button fails; the notice-only answer is INFO", () => {
    const missing = run(routes(), DIG_FIXED, decided({ D9: "yes" })).lines;
    expect(has(missing, "FAIL", /^FAIL {2}D9 decided \(yes\): the round published, but the Account chunk asks no mail_resume/), show(missing)).toBe(true);
    expect(has(run(routes(), DIG_FIXED, decided({ D9: "notice only" })).lines, "INFO", /^INFO {2}D9 decided \(notice only\): the notice alone/)).toBe(true);
  });
});

describe("the marks the section reads are the ones the lane ships", () => {
  const src = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
  it("each Account, confirm-page and shard mark is in the source the round publishes", () => {
    const cards = src("src/components/account/ConnectedAIsCard.tsx") + src("src/components/account/SavedSearchesCard.tsx") + src("src/components/account/NotificationsPanel.tsx");
    for (const m of ["data-mail-card", "mailStopped", "digest_cadence:", "data-cadence-select", "data-mail-stopped", "mailPrefs.newHeadlineCapped"]) expect(cards, m).toContain(m);
    const page = src("src/pages/MarketPulseConfirm.tsx");
    for (const m of ["pulseConfirm.", "data-next-pulse"]) expect(page, m).toContain(m);
    const shardDir = resolve(ROOT, "src/i18n/shards/mail");
    const langs = readdirSync(shardDir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
    expect(langs).toEqual(["de", "en", "en-GB", "es", "fr", "hi", "nl", "pt", "tl"]);
    const keys = Object.keys((JSON.parse(src("src/i18n/shards/mail/en.json")) as { mailPrefs: Record<string, string> }).mailPrefs);
    for (const k of SHARD_KEYS) expect(keys, k).toContain(k);
    expect(SECTION).toContain(`VDBM_KEYS="${SHARD_KEYS.join(" ")}"`);
  });
  it("the prune job the section reads is the one the migration schedules, with its timeout first", () => {
    const mig = readdirSync(resolve(ROOT, "supabase/migrations")).find((f) => f.startsWith("20261112160000_"));
    expect(mig).toBeTruthy();
    expect(src(`supabase/migrations/${mig}`)).toMatch(/cron\.schedule\(\s*'mail-lists-prune',\s*'[^']+',\s*'SET statement_timeout = ''[^']+''; SELECT public\.mail_lists_prune\(\);'/);
  });
});
