// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz-bugs-privacy-retention CAN FAIL WHAT IT CLAIMS,
 * NEVER FAILS ON TODAY'S PRODUCTION, AND NEVER WRITES.
 *
 * The section judges the lane's three migrations from outside (the purge
 * refused to anon, its nightly job, the four log writers, the fifty-two
 * service-only tables) and the served /privacy (the lane's copy, and the
 * three owner-gated lines). Run here against a fake curl:
 *   - production as it was read on 2026-11-15 (no purge, two writers open,
 *     the census at 2, the page dated 2026-11-06 with none of the lane's
 *     sentences) prints no FAIL;
 *   - a good deploy prints PASS for every claim;
 *   - each regression prints FAIL;
 *   - an owner line reads INFO 'owner pending' until the ledger names its
 *     key, and then judges the page;
 *   - every request is a GET, and the key is never printed.
 * The /privacy fixtures are the crawler page baked from src/pages/Privacy.tsx
 * by the bake's own converter, so the section is tested on the page it reads.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { legalBodyFromTsx } from "../../scripts/prerender-legal.mjs";
import { MCP_PRIVACY_ROWS } from "@/config/mcp-privacy";
import EN from "@/i18n/locales/en.json";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-privacy-retention.sh"), "utf8");
const MIGRATION = readFileSync(resolve(ROOT, "supabase/migrations/20261112102000_a_table_only_the_server_reads_answers_only_the_server.sql"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const PROBE = /^probe\(\) \{[\s\S]*?esac; \}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_bpr";
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

function run(routes: Route[], ledger?: unknown): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbpr-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "ledger.json"), JSON.stringify(ledger ?? { reservations: { "bug-round": { ownerDecided: {} } } }));
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n${PROBE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VDBPR_LEDGER: join(dir, "ledger.json"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

// ── the served /privacy, baked the way scripts/prerender-seo.mjs bakes it ──
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TSX = readFileSync(resolve(ROOT, "src/pages/Privacy.tsx"), "utf8");
/** Each sentence the lane wrote, and what the page read before it. */
const LANE_EDITS: Array<[string, string]> = [
  ["Lovable Emails, which sends sign-in emails through Mailgun from the EU; a sign-in email it cannot send goes through Resend, from the United States, instead", "Lovable Emails, which sends sign-in emails through Mailgun from the EU"],
  ["ipinfo (the country of the IP address a free scan, or a request to email you a scan report, comes from: to set the free scan's limits, and to refuse a report email from a region we do not serve)", "ipinfo (the country of the IP address a free scan comes from, to set its limits)"],
  [" Signing out on this device clears them too, apart from anything you choose to keep on this device.", ""],
  ["Google (AI models, reached through Lovable's AI gateway):", "Google (AI models and fonts):"],
];
const SEARCHES_LI = /\n\s*<li data-search-retention>[\s\S]*?<\/li>/;
const bake = (tsx: string, rows = MCP_PRIVACY_ROWS) => legalBodyFromTsx(tsx, { locale: EN, vars: { AI_CACHE_MAX_HOURS: 48, SHARED_ANALYSIS_DAYS: 90, MCP_PRIVACY_ROWS: rows }, esc });
const page = (body: string, updated: string) => `<!doctype html><html><head><title>Privacy Policy — Resume Booster</title></head><body><main>
  <h1 class="text-3xl font-bold mb-3">Privacy Policy</h1>
  <p class="text-sm text-muted-foreground mb-4">Last updated: ${updated}</p>
  <div class="legal-text">${body}</div></main></body></html>`;
const OLD_TSX = LANE_EDITS.reduce((t, [now, was]) => t.split(now).join(was), TSX).replace(SEARCHES_LI, "");
const PAGE_TODAY = page(bake(OLD_TSX), "2026-11-06");
const PAGE_NEW = page(bake(TSX), "2026-11-16");
/** A page with one Shortlist sentence swapped, or one li added after the Log Data line. */
// The Shortlist sentence as the page reads it, whichever rule it states: the
// owner's branch rewrites it, and these fixtures must not depend on which.
const SHORTLIST_SENTENCE = /(<strong className="text-foreground">Shortlist:<\/strong> )[^<]*(<\/li>)/;
const withShortlist = (s: string) => page(bake(TSX.replace(SHORTLIST_SENTENCE, `$1An employer who screens candidates with Shortlist uploads their resumes. We ${s}$2`)), "2026-11-16");
const TODAYS_SHORTLIST = "keep the redacted text and the evaluation for that employer until they delete the role or their account, and record no candidate's sex or race";
/** The page with no affiliate entry, whichever branch's page this is. */
const withoutAffiliate = (h: string) => h.replace(/<li\b[^>]*>(?:(?!<\/li>)[\s\S])*affiliate_ref(?:(?!<\/li>)[\s\S])*<\/li>/g, "");
const AFFILIATE_LI = "<li><strong>Affiliate program:</strong> If you arrive on a referral link and allow analytics, its code is kept in the affiliate_ref cookie and this browser's storage for 30 days. The click is recorded with a keyed hash of your IP address, never the address, and click records are deleted after 90 days.</li>";
const withLi = (li: string, updated = "2026-11-16") => PAGE_NEW.replace(/(<li><strong>Log Data:<\/strong> Retained[^<]*<\/li>)/, `$1${li}`).replace("Last updated: 2026-11-16", `Last updated: ${updated}`);
const FLIPPED = "From Claude and other connections: the search words and filters, kept for 30 days; searches made from October 31, 2026 on keep no record of which postings were shown.";
const withKept = (kept: string) => page(bake(TSX, MCP_PRIVACY_ROWS.map((r) => (r.id === "search" ? { ...r, kept } : r))), "2026-11-16");

// ── the API as production answered it on 2026-11-15, and after a good deploy ──
const ERR = (code: string, message = code) => JSON.stringify({ code, message });
const CLOSED = (() => {
  const m = /FOREACH v_t IN ARRAY ARRAY\[([\s\S]*?)\] LOOP/.exec(MIGRATION);
  return m ? [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]) : [];
})();
const SECTION_CLOSED = (() => {
  const m = /const CLOSED = \[([\s\S]*?)\];/.exec(SECTION);
  return m ? [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]) : [];
})();
const OTHER_JOB = { ch_jobname: "agent-queue-retention", ch_schedule: "40 6 * * *", ch_active: true, ch_timeout: null, ch_runs: 2, ch_failed: 0, ch_timeouts: 0, ch_last_start: "2026-11-15T06:40:00Z", ch_last_status: "succeeded", ch_last_seconds: 0, ch_max_seconds: 0 };
const NIGHTLY = { ch_jobname: "privacy-retention-nightly", ch_schedule: "41 4 * * *", ch_active: true, ch_timeout: "10min", ch_runs: 1, ch_failed: 0, ch_timeouts: 0, ch_last_start: "2026-11-16T04:41:00Z", ch_last_status: "succeeded", ch_last_seconds: 4, ch_max_seconds: 4 };
const WRITERS = ["log_scan_metric", "log_heartbeat_result", "log_parse_failure", "log_industry_detection"];
const KEPT_OPEN = ["used_stripe_sessions", "purchased_content", "product_deliveries", "user_scans", "shortlist_roles"];

type Over = {
  purge?: { status: number; body: string }; grants?: { status: number; body: string }; cron?: unknown;
  writers?: Record<string, string>; census?: unknown; privacy?: string; apiKeys?: { status: number; body: string };
};
function routes(o: Over = {}, deployed = true): Route[] {
  const writer = (w: string) => o.writers?.[w] ?? (deployed ? "42501" : (w === "log_scan_metric" || w === "log_heartbeat_result" ? "25006" : "42501"));
  return [
    { match: `^GET ${P}/rest/v1/rpc/privacy_retention_nightly$`, ...(o.purge ?? (deployed ? { status: 401, body: ERR("42501", "permission denied for function privacy_retention_nightly") } : { status: 404, body: ERR("PGRST202") })) },
    { match: `^GET ${P}/rest/v1/rpc/client_table_grants$`, ...(o.grants ?? (deployed ? { status: 200, body: JSON.stringify({ anon: KEPT_OPEN, authenticated: KEPT_OPEN }) } : { status: 404, body: ERR("PGRST202") })) },
    { match: `^GET ${P}/rest/v1/rpc/get_cron_health\\?p_hours=48$`, body: JSON.stringify(o.cron ?? (deployed ? [OTHER_JOB, NIGHTLY] : [OTHER_JOB])) },
    ...WRITERS.map((w) => ({ match: `^GET ${P}/rest/v1/rpc/${w}\\?`, status: writer(w) === "42501" ? 401 : 400, body: ERR(writer(w)) })),
    { match: `^GET ${P}/rest/v1/rpc/client_callable_census$`, body: JSON.stringify(o.census ?? { definers: 294, client_callable: deployed ? 64 : 66, unlisted_client_callable: deployed ? 0 : 2 }) },
    { match: `^GET ${P}/rest/v1/api_keys\\?select=id&limit=1$`, ...(o.apiKeys ?? (deployed ? { status: 401, body: ERR("42501", "permission denied for table api_keys") } : { status: 200, body: "[]" })) },
    { match: `^GET ${S}/privacy$`, body: o.privacy ?? (deployed ? PAGE_NEW : PAGE_TODAY) },
  ];
}
const decided = (od: Record<string, unknown>) => ({ reservations: { "bug-round": { ownerDecided: od } } });
const has = (lines: string[], verdict: string, re: RegExp) => lines.some((l) => l.startsWith(verdict) && re.test(l));
const show = (lines: string[]) => lines.join("\n");
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));

describe("the fixtures are the page and the list the section reads", () => {
  it("the lane's sentences are each found once in the page file, so the page before the lane is real", () => {
    for (const [now] of LANE_EDITS) expect(TSX.split(now).length - 1, now).toBe(1);
    expect(TSX).toMatch(SEARCHES_LI);
    expect(TSX).toMatch(SHORTLIST_SENTENCE);
  });
  it("the section's fifty-two tables are the migration's fifty-two, in the same order", () => {
    expect(CLOSED).toHaveLength(52);
    expect(SECTION_CLOSED).toEqual(CLOSED);
  });
});

describe("today's production, before the merge and the paste", () => {
  const { lines, out } = run(routes({}, false));
  it("prints no FAIL: every claim not yet shipped is INFO, and the two closed writers and the Log Data line pass", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of ["PR0", "PR1", "PR3a-e", "PR4"]) expect(has(lines, "INFO", new RegExp(`^INFO {2}${c} `)), `${c}\n${show(lines)}`).toBe(true);
    expect(lines.filter((l) => /^INFO {2}PR2 log_\w+ is still callable/.test(l)), show(lines)).toHaveLength(2);
    expect(has(lines, "INFO", /^INFO {2}PR2 client_callable_census counts 2 /), show(lines)).toBe(true);
    expect(lines.filter((l) => /^PASS {2}PR2 log_\w+ refuses anon/.test(l)), show(lines)).toHaveLength(2);
    expect(has(lines, "PASS", /^PASS {2}PR3f /), show(lines)).toBe(true);
    for (const k of ["S14X-021", "S14X-073", "NB-39"]) expect(has(lines, "INFO", new RegExp(`^INFO {2}PR5[abc] ${k} owner pending`)), `${k}\n${show(lines)}`).toBe(true);
  });
  it("every line is a verdict or the header, and the key is never printed", () => {
    expect(lines.every((l) => /^(PASS|FAIL|INFO) {2}PR\d/.test(l) || /^== 99zzzzzzz\. /.test(l)), show(lines)).toBe(true);
    expect(out).not.toContain(KEY);
  });
});

describe("a good deploy", () => {
  const { lines, calls, out } = run(routes());
  it("prints PASS for every claim and no FAIL", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of ["PR0", "PR1", "PR3a", "PR3b", "PR3c", "PR3d", "PR3e", "PR3f", "PR4"]) expect(has(lines, "PASS", new RegExp(`^PASS {2}${c} `)), `${c}\n${show(lines)}`).toBe(true);
    expect(lines.filter((l) => /^PASS {2}PR2 log_\w+ refuses anon/.test(l)), show(lines)).toHaveLength(4);
    expect(has(lines, "PASS", /^PASS {2}PR2 client_callable_census counts 0/), show(lines)).toBe(true);
    expect(lines.filter((l) => /^PASS {2}PR4 /.test(l)), show(lines)).toHaveLength(2);
    expect(out).not.toContain(KEY);
  });
  it("asks only with GET: nothing is posted, and the purge and the writers are probed read-only", () => {
    expect(calls.length).toBe(10);
    for (const c of calls) expect(c, c).toMatch(/^curl\tGET /);
    expect(calls.filter((c) => /rpc\/privacy_retention_nightly/.test(c))).toHaveLength(1);
    for (const w of WRITERS) expect(calls.filter((c) => new RegExp(`rpc/${w}\\?`).test(c)), w).toHaveLength(1);
  });
});

describe("each regression prints FAIL", () => {
  it("PR0: the purge callable by anon, or an answer that is not PostgREST's", () => {
    expect(has(run(routes({ purge: { status: 400, body: ERR("25006", "cannot execute DELETE in a read-only transaction") } })).lines, "FAIL", /^FAIL {2}PR0 privacy_retention_nightly is CALLABLE/)).toBe(true);
    expect(has(run(routes({ purge: { status: 502, body: "<html>Bad gateway</html>" } })).lines, "FAIL", /^FAIL {2}PR0 /)).toBe(true);
  });

  it("PR1: the job missing, inactive, without its own timeout, failing or timing out, once the purge exists; and an unreadable health list", () => {
    const missing = run(routes({ cron: [OTHER_JOB] })).lines;
    expect(has(missing, "FAIL", /^FAIL {2}PR1 no job 'privacy-retention-nightly'.*though 20261112100000 applied/), show(missing)).toBe(true);
    expect(has(run(routes({ cron: [{ ...NIGHTLY, ch_active: false }] })).lines, "FAIL", /^FAIL {2}PR1 .*not active/)).toBe(true);
    expect(has(run(routes({ cron: [{ ...NIGHTLY, ch_timeout: null }] })).lines, "FAIL", /^FAIL {2}PR1 .*no statement_timeout/)).toBe(true);
    expect(has(run(routes({ cron: [{ ...NIGHTLY, ch_runs: 2, ch_failed: 1, ch_last_status: "failed" }] })).lines, "FAIL", /^FAIL {2}PR1 .*1 failed and 0 timed out/)).toBe(true);
    expect(has(run(routes({ cron: [{ ...NIGHTLY, ch_timeouts: 1 }] })).lines, "FAIL", /^FAIL {2}PR1 .*0 failed and 1 timed out/)).toBe(true);
    expect(has(run(routes({ cron: { code: "PGRST202" } })).lines, "FAIL", /^FAIL {2}PR1 get_cron_health did not answer a list/)).toBe(true);
    const fresh = run(routes({ cron: [{ ...NIGHTLY, ch_runs: 0, ch_last_status: null, ch_last_start: null }] })).lines;
    expect(fails(fresh), show(fresh)).toEqual([]);
    expect(has(fresh, "INFO", /^INFO {2}PR1 .*has not run in the last 48 hours yet/), show(fresh)).toBe(true);
  });

  it("PR2: a writer still open once the migration applied, a probe that no longer reaches it, and an open census", () => {
    const open = run(routes({ writers: { log_scan_metric: "25006" }, census: { unlisted_client_callable: 1 } })).lines;
    expect(has(open, "FAIL", /^FAIL {2}PR2 log_scan_metric is CALLABLE by anon .*an overload stayed open/), show(open)).toBe(true);
    expect(has(open, "FAIL", /^FAIL {2}PR2 client_callable_census counts 1 .*1 log writer\(s\) still answer anon/), show(open)).toBe(true);
    expect(has(run(routes({ writers: { log_parse_failure: "PGRST202" } })).lines, "FAIL", /^FAIL {2}PR2 log_parse_failure has no overload taking/)).toBe(true);
    expect(has(run(routes({ census: { code: "PGRST202" } })).lines, "FAIL", /^FAIL {2}PR2 client_callable_census answered no unlisted_client_callable/)).toBe(true);
    const other = run(routes({ census: { unlisted_client_callable: 1 } })).lines;
    expect(fails(other), show(other)).toEqual([]);
    expect(has(other, "INFO", /^INFO {2}PR2 .*none of them the four log writers/), show(other)).toBe(true);
  });

  it("PR3: once the lane's copy is served, each sentence it ships stands or FAILs on its own", () => {
    const old = (t: string, i: number) => t.split(LANE_EDITS[i][0]).join(LANE_EDITS[i][1]);
    const cases: Array<[string, string, RegExp]> = [
      ["a", page(bake(old(TSX, 3)), "2026-11-16"), /^FAIL {2}PR3a .*AI models and fonts/],
      ["b", page(bake(old(TSX, 0)), "2026-11-16"), /^FAIL {2}PR3b .*does not name the Resend fallback/],
      ["c", page(bake(old(TSX, 1)), "2026-11-16"), /^FAIL {2}PR3c .*names no emailed scan report/],
      ["d", page(bake(old(TSX, 2)), "2026-11-16"), /^FAIL {2}PR3d /],
      ["e", page(bake(TSX.replace(SEARCHES_LI, "")), "2026-11-16"), /^FAIL {2}PR3e /],
      ["f", PAGE_NEW.replace(/<li><strong>Log Data:<\/strong> Retained[^<]*<\/li>/, ""), /^FAIL {2}PR3f /],
    ];
    for (const [id, html, re] of cases) {
      const { lines } = run(routes({ privacy: html }));
      expect(has(lines, "FAIL", re), `${id}\n${show(lines)}`).toBe(true);
      expect(fails(lines).filter((l) => l.startsWith("FAIL  PR3")), `${id}\n${show(lines)}`).toHaveLength(1);
    }
  });

  it("PR3: a page that cannot be read FAILs, and a re-dated page without the lane's sentences is not taken for the lane's publish", () => {
    expect(has(run(routes({ privacy: "<html><body>Service unavailable</body></html>" })).lines, "FAIL", /^FAIL {2}PR3 \/privacy could not be read/)).toBe(true);
    const redated = run(routes({ privacy: PAGE_TODAY.replace("Last updated: 2026-11-06", "Last updated: 2026-11-16") }, false)).lines;
    expect(fails(redated), show(redated)).toEqual([]);
    expect(has(redated, "INFO", /^INFO {2}PR3a-e .*Last updated 2026-11-16; 0 of the lane's 4/), show(redated)).toBe(true);
    const written = run(routes({ privacy: PAGE_NEW.replace("Last updated: 2026-11-16", "Last updated: November 16, 2026") })).lines;
    expect(fails(written), show(written)).toEqual([]);
  });

  it("PR4: a closed table a client role can still touch, a reader that is not there, and a control read the catalogue contradicts", () => {
    const open = run(routes({ grants: { status: 200, body: JSON.stringify({ anon: [...KEPT_OPEN, "api_keys"], authenticated: KEPT_OPEN }) } })).lines;
    expect(has(open, "FAIL", /^FAIL {2}PR4 1 service-only table\(s\) .*api_keys/), show(open)).toBe(true);
    expect(has(run(routes({ grants: { status: 200, body: JSON.stringify({ anon: KEPT_OPEN }) } })).lines, "FAIL", /^FAIL {2}PR4 client_table_grants answered no anon and authenticated/)).toBe(true);
    const lying = run(routes({ apiKeys: { status: 200, body: "[]" } })).lines;
    expect(has(lying, "FAIL", /^FAIL {2}PR4 api_keys read by a real column as anon -> ROWS:0 .*the reader and the table disagree/), show(lying)).toBe(true);
    expect(has(run(routes({ grants: { status: 502, body: "<html>Bad gateway</html>" } })).lines, "FAIL", /^FAIL {2}PR4 client_table_grants as anon -> /)).toBe(true);
  });
});

describe("the owner-gated lines", () => {
  it("print INFO 'owner pending' while the ledger names no key, whatever the page says", () => {
    const { lines } = run(routes({ privacy: withShortlist("keep it forever") }));
    for (const k of ["S14X-021", "S14X-073", "NB-39"]) expect(has(lines, "INFO", new RegExp(`^INFO {2}PR5[abc] ${k} owner pending`)), `${k}\n${show(lines)}`).toBe(true);
    expect(fails(lines), show(lines)).toEqual([]);
  });

  it("S14X-021: once decided, the served page must carry the affiliate entry, and a page older than the answer is not judged", () => {
    const L = decided({ "S14X-021": { choice: "approved-full", on: "2026-11-15" } });
    expect(has(run(routes({ privacy: withoutAffiliate(PAGE_NEW) }), L).lines, "FAIL", /^FAIL {2}PR5a S14X-021: .*never names affiliate_ref/)).toBe(true);
    expect(has(run(routes({ privacy: withoutAffiliate(withLi(AFFILIATE_LI)).replace("</div></main>", `${AFFILIATE_LI}</div></main>`) }), L).lines, "PASS", /^PASS {2}PR5a S14X-021: /)).toBe(true);
    expect(has(run(routes({ privacy: withoutAffiliate(PAGE_NEW).replace("</div></main>", `${AFFILIATE_LI.replace(" and click records are deleted after 90 days", "")}</div></main>`) }), L).lines, "FAIL", /^FAIL {2}PR5a .*without its 30 days, keyed hash or 90 days/)).toBe(true);
    const older = run(routes({}, false), L).lines;
    expect(fails(older), show(older)).toEqual([]);
    expect(has(older, "INFO", /^INFO {2}PR5a S14X-021 decided .* on 2026-11-15; the served page \(Last updated 2026-11-06\) predates the answer/), show(older)).toBe(true);
  });

  it("S14X-073: rule A needs the candidate delete and the four-year purge, rule B the account and the email route; today's sentence FAILs either", () => {
    const A = decided({ "S14X-073": { choice: "A", on: "2026-11-15" } });
    const B = decided({ "S14X-073": "B" });
    const ruleA = "keep the redacted text and the evaluation for that employer until they delete the candidate, the role or their account, and delete any still held four years after it was uploaded; we record no candidate's sex or race";
    const ruleB = "keep the redacted text and the evaluation for that employer until they delete their account; a candidate may ask the employer, or us by email, to erase theirs; we record no candidate's sex or race";
    expect(has(run(routes({ privacy: withShortlist(TODAYS_SHORTLIST) }), A).lines, "FAIL", /^FAIL {2}PR5b S14X-073: rule A .*is still today's text/)).toBe(true);
    expect(has(run(routes({ privacy: withShortlist(ruleA) }), A).lines, "PASS", /^PASS {2}PR5b S14X-073: .*rule A/)).toBe(true);
    expect(has(run(routes({ privacy: withShortlist(ruleB) }), A).lines, "FAIL", /^FAIL {2}PR5b S14X-073: rule A /)).toBe(true);
    expect(has(run(routes({ privacy: withShortlist(TODAYS_SHORTLIST) }), B).lines, "FAIL", /^FAIL {2}PR5b S14X-073: rule B .*is still today's text/)).toBe(true);
    expect(has(run(routes({ privacy: withShortlist(ruleB) }), B).lines, "PASS", /^PASS {2}PR5b S14X-073: .*rule B/)).toBe(true);
    expect(has(run(routes({ privacy: withShortlist(ruleA) }), B).lines, "FAIL", /^FAIL {2}PR5b S14X-073: rule B /)).toBe(true);
    expect(has(run(routes({ privacy: withShortlist(TODAYS_SHORTLIST) }), decided({ "S14X-073": "maybe later" })).lines, "FAIL", /^FAIL {2}PR5b S14X-073: .*neither rule A nor rule B/)).toBe(true);
  });

  it("NB-39: the 180-day row is not judged; once the row says 30 days, option 1 must name the searches before September 7, 2026", () => {
    const one = decided({ "NB-39": { choice: "1", on: "2026-11-15" } });
    const unflipped = run(routes(), one).lines;
    expect(fails(unflipped), show(unflipped)).toEqual([]);
    expect(has(unflipped, "INFO", /^INFO {2}PR5c NB-39: the connector row still says up to 180 days/), show(unflipped)).toBe(true);
    expect(has(run(routes({ privacy: withKept(FLIPPED) }), one).lines, "FAIL", /^FAIL {2}PR5c NB-39: the connector row says 30 days without naming/)).toBe(true);
    const named = `${FLIPPED} Searches made before September 7, 2026 cannot be told apart from the site's own and are kept like them, for up to 180 days.`;
    expect(has(run(routes({ privacy: withKept(named) }), one).lines, "PASS", /^PASS {2}PR5c NB-39: /)).toBe(true);
    const two = run(routes({ privacy: withKept(FLIPPED) }), decided({ "NB-39": "option 2: delete" })).lines;
    expect(fails(two), show(two)).toEqual([]);
  });
});
