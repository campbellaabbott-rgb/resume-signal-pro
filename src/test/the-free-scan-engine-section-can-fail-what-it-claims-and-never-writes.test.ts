// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE FREE-SCAN-ENGINE SECTION CAN FAIL WHAT IT CLAIMS, NEVER FAILS BEFORE THE
 * PASTE, AND NEVER WRITES (scripts/verify-deploy.d/99zzzzzzz-bugs-free-scan-engine.sh).
 *
 * Run against a fake curl that answers from routes and logs every call:
 *   - before the paste (today's answers: the cost wave's scanner builds, no
 *     give_back_scan_day, the correction log reaching its write for any
 *     label, no basis, no fallback column, the old country pages) it prints
 *     INFO and no FAIL, and its one PASS is the control;
 *   - after the paste every claim passes, and later builds pass too;
 *   - each claim fails on the state it exists to catch: a partial paste, a
 *     preflight with no build, the stream's build standing in for the
 *     primary's, functions live ahead of their migration, a stranger able to
 *     give back days, an unknown label reaching its write, the control
 *     refused, no basis, no fallback column or one no issue names, a page not
 *     re-baked;
 *   - a stale answer left in its files by an earlier run is never read back;
 *   - the owner-gated line is INFO owner pending until the ledger names the
 *     key, then judges the primary's build;
 *   - every call is a GET or an OPTIONS with no body, and the key is never
 *     printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { COUNTRY_STANDARDS } from "../../supabase/functions/free-keyword-scan/country-standards";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-free-scan-engine.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_free_scan_engine";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string; exit?: number };

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
if(r.exit){if(w)process.stdout.write(w.replace("%{http_code}","000"));process.exit(r.exit);}
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.split("\\\\n").join("\\n").replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

type Run = { lines: string[]; calls: string[]; out: string };

function run(routes: Route[], opts: { ownerDecided?: Record<string, unknown>; stale?: Record<string, string> } = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), "vdbugsfse-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "ledger.json"), JSON.stringify({ reservations: { "bug-round": { ownerDecided: opts.ownerDecided ?? {} } } }));
  for (const [name, body] of Object.entries(opts.stale ?? {})) writeFileSync(join(dir, name), body);
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
    VDFSE_LEDGER: join(dir, "ledger.json"),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

const RPC = "^GET https://p\\.supabase\\.co/rest/v1/rpc/";
const MATCH = {
  primary: "^OPTIONS https://p\\.supabase\\.co/functions/v1/free-keyword-scan$",
  stream: "^OPTIONS https://p\\.supabase\\.co/functions/v1/free-keyword-scan-stream$",
  giveBack: `${RPC}give_back_scan_day\\?p_ip=192\\.0\\.2\\.1&p_function=verify-probe$`,
  control: `${RPC}log_industry_correction\\?p_detected=technology&p_corrected=healthcare$`,
  refuse4: `${RPC}log_industry_correction\\?p_detected=technology&p_corrected=zz-not-an-industry$`,
  refuse9: `${RPC}log_industry_correction\\?p_original_industry=technology&p_corrected_industry=zz-not-an-industry$`,
  refuseCase: `${RPC}log_industry_correction\\?p_original_industry=technology&p_corrected_industry=Technology$`,
  totals: `${RPC}get_scan_totals$`,
  health: `${RPC}get_scan_health_status$`,
  poland: "^GET https://site\\.test/cv-standards/poland$",
  italy: "^GET https://site\\.test/cv-standards/italy$",
} as const;
type Name = keyof typeof MATCH;
type Answer = Omit<Route, "match">;

const WRITE_STOPPED = { status: 405, body: JSON.stringify({ code: "25006", details: null, hint: null, message: "cannot execute INSERT in a read-only transaction" }) };
const conventionsPage = (code: "PL" | "IT") =>
  `<html><body><h2>Market conventions</h2><ul>${COUNTRY_STANDARDS[code].conventions.map((c) => `<li>• ${c}</li>`).join("")}</ul></body></html>`;
const HEALTH_ROW = { status: "degraded", last_successful_scan: "2026-11-15T04:19:07+00:00", scans_last_hour: 0, success_rate_last_hour: 0, avg_latency_last_hour: 0, last_heartbeat_status: "degraded", last_heartbeat_time: "2026-11-16T01:00:39+00:00", issues: ["Last heartbeat: degraded"] };
const build = (b: string | null): Answer => ({ headers: b ? { "x-fn-build": b } : {} });

/** Production as it answers today, before the round's paste. */
const BEFORE: Record<Name, Answer> = {
  primary: build("free-keyword-scan.2026-11-09.2"),
  stream: build("free-keyword-scan-stream.2026-11-10.3"),
  giveBack: { status: 404, body: JSON.stringify({ code: "PGRST202", details: "Searched for the function public.give_back_scan_day", hint: null, message: "Could not find the function" }) },
  control: WRITE_STOPPED,
  refuse4: WRITE_STOPPED,
  refuse9: WRITE_STOPPED,
  refuseCase: WRITE_STOPPED,
  totals: { body: '{"countries": 25, "total_scans": 1102}' },
  health: { body: JSON.stringify([HEALTH_ROW]) },
  poland: { body: "<html><body><ul><li>• RODO/GDPR data-processing consent clause at the bottom — many employers cannot process applications without it</li></ul></body></html>" },
  italy: { body: "<html><body><ul><li>• Privacy-consent line authorizing personal-data processing (GDPR / D.Lgs. 196/2003) at the bottom — CVs without it are often filtered out</li></ul></body></html>" },
};

/** Production once the migration, the two functions and the publish are live. */
const AFTER: Record<Name, Answer> = {
  primary: build("free-keyword-scan.2026-11-15.2"),
  stream: build("free-keyword-scan-stream.2026-11-12.1"),
  giveBack: { status: 401, body: JSON.stringify({ code: "42501", details: null, hint: null, message: "permission denied for function give_back_scan_day" }) },
  control: WRITE_STOPPED,
  refuse4: { status: 204, body: "" },
  refuse9: { status: 200, body: "null" },
  refuseCase: { status: 200, body: "null" },
  totals: { body: JSON.stringify({ total_scans: 1090, countries: 25, basis: "analyses the scanner completed (scan_metrics status completed, scan_type free, free-stream or paid), reports replayed from the cache not counted" }) },
  health: { body: JSON.stringify([{ ...HEALTH_ROW, model_fallback_last_hour: 0 }]) },
  poland: { body: conventionsPage("PL") },
  italy: { body: conventionsPage("IT") },
};

const routes = (world: Record<Name, Answer>, over: Partial<Record<Name, Answer>> = {}): Route[] =>
  (Object.keys(MATCH) as Name[]).map((n) => ({ match: MATCH[n], ...(over[n] ?? world[n]) }));
const verdicts = (lines: string[], v: "PASS" | "FAIL" | "INFO") => lines.filter((l) => l.startsWith(v));
const fails = (r: Run) => verdicts(r.lines, "FAIL");

describe("the free-scan-engine section", () => {
  it("prints its header, so the tally files its lines under it", () => {
    expect(run(routes(AFTER)).out).toMatch(/^== 99zzzzzzz\. bug round A free-scan-engine: .* ==$/m);
  });

  it("before the paste says INFO and fails nothing; its one PASS is the control", () => {
    const r = run(routes(BEFORE));
    expect(fails(r), r.out).toEqual([]);
    expect(verdicts(r.lines, "PASS"), r.out).toEqual([
      "PASS  C control: a real correction (technology to healthcare) still reaches its write (25006: this GET's read-only transaction stopped it)",
    ]);
    expect(r.lines, r.out).toContain("INFO  B free-keyword-scan preflight x-fn-build = free-keyword-scan.2026-11-09.2: bug round A's free-scan-engine (2026-11-15.2) is not pasted yet");
    expect(r.lines, r.out).toContain("INFO  M give_back_scan_day does not exist yet (PGRST202): migration 20261112170000 is not applied");
    expect(r.lines.filter((l) => /^INFO {2}C log_industry_correction's .*: not yet \(HTTP 405, 25006\)/.test(l)), r.out).toHaveLength(3);
    expect(r.lines.some((l) => l.startsWith("INFO  T get_scan_totals names no basis yet (total 1102)")), r.out).toBe(true);
    expect(r.lines.some((l) => l.startsWith("INFO  H get_scan_health_status has no model_fallback_last_hour yet")), r.out).toBe(true);
    expect(r.lines.filter((l) => /^INFO {2}P \/cv-standards\/(poland|italy) .* the round has not published$/.test(l)), r.out).toHaveLength(2);
    expect(r.lines, r.out).toContain("INFO  S14X-101 owner pending: the free scan's failure alert still carries the visitor's address, and each scanner's scan note the visitor's country, until the owner's answer is recorded");
  });

  it("hotfix NB-1's build alone (2026-11-15.1) is not the round's, and fails nothing", () => {
    const r = run(routes(BEFORE, { primary: build("free-keyword-scan.2026-11-15.1") }));
    expect(fails(r), r.out).toEqual([]);
    expect(verdicts(r.lines, "PASS").filter((l) => l.startsWith("PASS  B")), r.out).toEqual([]);
  });

  it("after the paste every claim passes, and a later build passes too", () => {
    for (const [p, s] of [["free-keyword-scan.2026-11-15.2", "free-keyword-scan-stream.2026-11-12.1"], ["free-keyword-scan.2026-12-01.1", "free-keyword-scan-stream.2026-11-13.4"]]) {
      const r = run(routes(AFTER, { primary: build(p), stream: build(s) }));
      expect(fails(r), r.out).toEqual([]);
      const pass = verdicts(r.lines, "PASS");
      expect(pass, r.out).toContain(`PASS  B free-keyword-scan preflight x-fn-build = ${p} (2026-11-15.2 or later: the round's scanner)`);
      expect(pass, r.out).toContain(`PASS  B free-keyword-scan-stream preflight x-fn-build = ${s} (2026-11-12.1 or later: the round's scanner)`);
      expect(pass.filter((l) => l.startsWith("PASS  M give_back_scan_day exists")), r.out).toHaveLength(1);
      expect(pass.filter((l) => l.startsWith("PASS  C ")), r.out).toHaveLength(4);
      expect(pass, r.out).toContain("PASS  T get_scan_totals names its basis, cache replays not counted (total 1090; basis 'analyses the scanner completed (scan_metrics status completed, scan_type free, free-stream or paid), reports replayed from the cache not counted')");
      expect(pass, r.out).toContain("PASS  H get_scan_health_status counts reports the model did not write apart: model_fallback_last_hour = 0 (status degraded)");
      expect(pass.filter((l) => l.startsWith("PASS  P /cv-standards/")), r.out).toHaveLength(2);
      expect(pass, r.out).toHaveLength(11);
    }
  });

  it("the pages' new words are the scanner module's own, so a reworded standard cannot pass on stale words", () => {
    expect(COUNTRY_STANDARDS.PL.conventions.join(" ")).toContain("not a legal requirement");
    expect(COUNTRY_STANDARDS.IT.conventions.join(" ")).toContain("does not require it on a CV you send");
    expect(SECTION).toContain('"poland|RODO|cannot process applications|not a legal requirement"');
    expect(SECTION).toContain('"italy|196/2003|often filtered out|does not require it on a CV you send"');
  });
});

describe("each claim can fail", () => {
  it("B: a partial paste fails the scanner left behind", () => {
    const r = run(routes(AFTER, { stream: build("free-keyword-scan-stream.2026-11-10.3") }));
    expect(fails(r), r.out).toEqual([
      "FAIL  B free-keyword-scan-stream preflight x-fn-build = free-keyword-scan-stream.2026-11-10.3 while the other scanner serves the round's build: a partial paste (want free-keyword-scan-stream.2026-11-12.1 or later)",
    ]);
  });

  it("B: a preflight with no x-fn-build fails, before the paste too", () => {
    const r = run(routes(BEFORE, { primary: build(null) }));
    expect(fails(r), r.out).toEqual([
      "FAIL  B free-keyword-scan preflight carries no x-fn-build (not deployed, or its preflight does not answer; want free-keyword-scan.2026-11-15.2 or later)",
    ]);
  });

  it("B: the stream fork's build never stands in for the primary's", () => {
    const r = run(routes(AFTER, { primary: build("free-keyword-scan-stream.2026-11-15.2") }));
    expect(fails(r).filter((l) => l.startsWith("FAIL  B free-keyword-scan preflight")), r.out).toHaveLength(1);
    expect(verdicts(r.lines, "PASS").filter((l) => l.startsWith("PASS  B free-keyword-scan preflight")), r.out).toEqual([]);
  });

  it("M: the scanners live ahead of their migration fail; a give-back a stranger can run fails", () => {
    const ahead = run(routes(AFTER, { giveBack: BEFORE.giveBack }));
    expect(fails(ahead).filter((l) => l.startsWith("FAIL  M give_back_scan_day does not exist (PGRST202) while a scanner serves the round's build")), ahead.out).toHaveLength(1);
    const open = run(routes(AFTER, { giveBack: { status: 200, body: "false" } }));
    expect(fails(open).filter((l) => l.startsWith("FAIL  M give_back_scan_day answered the publishable key (HTTP 200, SCALAR)")), open.out).toHaveLength(1);
    const html = run(routes(BEFORE, { giveBack: { status: 502, body: "<html>bad gateway</html>" } }));
    expect(fails(html).filter((l) => l.startsWith("FAIL  M give_back_scan_day answered HTTP 502 (NONJSON)") && l.includes("bad gateway")), html.out).toHaveLength(1);
  });

  it("C: an unknown label that reaches its write after the migration fails, each overload on its own line", () => {
    const r = run(routes(AFTER, { refuse4: WRITE_STOPPED, refuse9: WRITE_STOPPED, refuseCase: WRITE_STOPPED }));
    expect(fails(r).filter((l) => /^FAIL {2}C log_industry_correction's .*: not so \(HTTP 405, 25006; 25006 means it reached its write\)/.test(l)), r.out).toHaveLength(3);
  });

  it("C: a control refused after the migration fails, and no refusal is passed without it", () => {
    const r = run(routes(AFTER, { control: { status: 204, body: "" } }));
    expect(fails(r).filter((l) => l.startsWith("FAIL  C control: a real correction (technology to healthcare) no longer reaches its write (HTTP 204, EMPTY)")), r.out).toHaveLength(1);
    expect(verdicts(r.lines, "PASS").filter((l) => l.startsWith("PASS  C ")), r.out).toEqual([]);
    expect(r.lines.filter((l) => /^INFO {2}C log_industry_correction's .*: not judged/.test(l)), r.out).toHaveLength(3);
  });

  it("T: no basis after the migration fails, a basis that counts cache replays fails, and a gateway page fails showing itself", () => {
    const none = run(routes(AFTER, { totals: BEFORE.totals }));
    expect(fails(none), none.out).toEqual(["FAIL  T get_scan_totals names no basis (total 1102) while migration 20261112170000 is applied: cache replays are still counted"]);
    const other = run(routes(AFTER, { totals: { body: JSON.stringify({ total_scans: 5, countries: 1, basis: "every scan_metrics row" }) } }));
    expect(fails(other).filter((l) => l.startsWith("FAIL  T get_scan_totals names a basis that does not leave out cache replays")), other.out).toHaveLength(1);
    const html = run(routes(BEFORE, { totals: { status: 502, body: "<html>upstream</html>" } }));
    expect(fails(html).filter((l) => l.startsWith("FAIL  T get_scan_totals did not answer a total (HTTP 502)") && l.includes("upstream")), html.out).toHaveLength(1);
  });

  it("H: no fallback column after the migration fails, and fallbacks no issue names fail", () => {
    const none = run(routes(AFTER, { health: BEFORE.health }));
    expect(fails(none), none.out).toEqual(["FAIL  H get_scan_health_status has no model_fallback_last_hour while migration 20261112170000 is applied: a rule-based report still reads as a success"]);
    const unnamed = run(routes(AFTER, { health: { body: JSON.stringify([{ ...HEALTH_ROW, model_fallback_last_hour: 3 }]) } }));
    expect(fails(unnamed), unnamed.out).toEqual(["FAIL  H get_scan_health_status counts 3 model fallbacks this hour but no issue names them (status degraded)"]);
    const named = run(routes(AFTER, { health: { body: JSON.stringify([{ ...HEALTH_ROW, model_fallback_last_hour: 3, issues: ["Model fallback: 3 of 4 visitor scans in the last hour were rule-based reports the model did not write"] }]) } }));
    expect(fails(named), named.out).toEqual([]);
    expect(verdicts(named.lines, "PASS"), named.out).toContain("PASS  H get_scan_health_status counts reports the model did not write apart: model_fallback_last_hour = 3 (status degraded)");
  });

  it("P: a page not re-baked fails once the scanners are live; a page with no consent line at all is not judged", () => {
    const stale = run(routes(AFTER, { poland: BEFORE.poland, italy: BEFORE.italy }));
    expect(fails(stale), stale.out).toEqual([
      "FAIL  P /cv-standards/poland as Googlebot reads it still says 'cannot process applications' while the scanners serve the round's build: the page was not re-baked",
      "FAIL  P /cv-standards/italy as Googlebot reads it still says 'often filtered out' while the scanners serve the round's build: the page was not re-baked",
    ]);
    const empty = run(routes(AFTER, { poland: { status: 200, body: "" } }));
    expect(fails(empty), empty.out).toEqual([]);
    expect(empty.lines, empty.out).toContain("INFO  P /cv-standards/poland as Googlebot reads it carries no consent line at all ('RODO'), so it is not judged");
  });
});

describe("the section reads only what it asked for", () => {
  it("a stale answer an earlier run left in its files is never read back: a dead network passes nothing", () => {
    const dead: Route[] = (Object.keys(MATCH) as Name[]).map((n) => ({ match: MATCH[n], exit: 7 }));
    const r = run(dead, {
      stale: {
        vd_fse_hdr: "HTTP/2 200\r\nx-fn-build: free-keyword-scan.2026-11-15.2\r\n\r\n",
        vd_fse_body: JSON.stringify({ code: "42501" }),
        vd_fse_page: conventionsPage("PL"),
      },
    });
    expect(verdicts(r.lines, "PASS"), r.out).toEqual([]);
    expect(fails(r).filter((l) => l.startsWith("FAIL  B ") && l.includes("carries no x-fn-build")), r.out).toHaveLength(2);
  });
});

describe("the owner-gated line", () => {
  it("prints owner pending while the ledger does not name S14X-101, and reads the repo's ledger by default", () => {
    const r = run(routes(AFTER));
    expect(r.lines, r.out).toContain("INFO  S14X-101 owner pending: the free scan's failure alert still carries the visitor's address, and each scanner's scan note the visitor's country, until the owner's answer is recorded");
    expect(SECTION).toContain("${VDFSE_LEDGER:-docs/deploy-ledger.json}");
  });

  it("once decided, judges the primary's build: PASS when it serves the round's, FAIL when only the stream does, INFO before the paste", () => {
    const decided = { "S14X-101": { choice: "counts or a reference only", date: "2026-11-15" } };
    const live = run(routes(AFTER), { ownerDecided: decided });
    expect(verdicts(live.lines, "PASS").filter((l) => l.startsWith("PASS  S14X-101 decided (counts or a reference only)")), live.out).toHaveLength(1);
    const half = run(routes(AFTER, { primary: build("free-keyword-scan.2026-11-15.1") }), { ownerDecided: decided });
    expect(fails(half).filter((l) => l.startsWith("FAIL  S14X-101 decided (counts or a reference only), but free-keyword-scan does not serve the round's build")), half.out).toHaveLength(1);
    const before = run(routes(BEFORE), { ownerDecided: { "S14X-101": "drop" } });
    expect(fails(before), before.out).toEqual([]);
    expect(before.lines, before.out).toContain("INFO  S14X-101 decided (drop); free-keyword-scan does not serve the round's build yet");
  });
});

describe("it never writes", () => {
  it("every call is an OPTIONS or a GET with no body, in this order, and the key is never printed", () => {
    const r = run(routes(AFTER));
    expect(r.calls).toEqual([
      "curl\tOPTIONS https://p.supabase.co/functions/v1/free-keyword-scan",
      "curl\tOPTIONS https://p.supabase.co/functions/v1/free-keyword-scan-stream",
      "curl\tGET https://p.supabase.co/rest/v1/rpc/give_back_scan_day?p_ip=192.0.2.1&p_function=verify-probe",
      "curl\tGET https://p.supabase.co/rest/v1/rpc/log_industry_correction?p_detected=technology&p_corrected=healthcare",
      "curl\tGET https://p.supabase.co/rest/v1/rpc/log_industry_correction?p_detected=technology&p_corrected=zz-not-an-industry",
      "curl\tGET https://p.supabase.co/rest/v1/rpc/log_industry_correction?p_original_industry=technology&p_corrected_industry=zz-not-an-industry",
      "curl\tGET https://p.supabase.co/rest/v1/rpc/log_industry_correction?p_original_industry=technology&p_corrected_industry=Technology",
      "curl\tGET https://p.supabase.co/rest/v1/rpc/get_scan_totals",
      "curl\tGET https://p.supabase.co/rest/v1/rpc/get_scan_health_status",
      "curl\tGET https://site.test/cv-standards/poland",
      "curl\tGET https://site.test/cv-standards/italy",
    ]);
    for (const res of [r, run(routes(BEFORE))]) expect(res.out).not.toContain(KEY);
  });

  it("every line it prints is a verdict", () => {
    const r = run(routes(BEFORE));
    const body = r.out.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("== "));
    expect(body.filter((l) => !/^(PASS|FAIL|INFO) {2}/.test(l)), r.out).toEqual([]);
  });
});
