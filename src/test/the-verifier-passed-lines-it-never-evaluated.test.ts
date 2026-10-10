// @vitest-environment node
//
// Node, not jsdom: this file runs verifier sections in bash, with node stubs
// for the network, through child_process.
/**
 * THE VERIFIER PASSED LINES IT NEVER EVALUATED, FAILED LINES THAT HELD, AND
 * COULD HAVE WRITTEN TO PRODUCTION.
 *
 * scripts/verify-deploy.sh is the post-deploy proof every deploy note points
 * at. The 2026-10-08 sweep found it lying in both directions:
 *   - S8-125: its refusal probes POSTed write RPCs with real arguments, so a
 *     regressed revoke would have turned every run into a writer;
 *   - S8-126 / S8-124: build checks that pinned a date pattern or one exact
 *     string, so a later rebuild read FAIL ("previous bundle") or INFO forever;
 *   - S8-127: 4c passed rows with no reason and its control was INFO; section
 *     90 passed "every light re-read landed" on 0 of 0;
 *   - S8-128: 5u asked the Ontario reader about the newest posting only, which
 *     the reader excludes by design when it is remote;
 *   - S8-129: 7i sent `vendors`, a key job-board ignores;
 *   - L1-06: overlapping runs mixed answers in the shared /tmp/vd_* files.
 *
 * Each section is cut out of the script and RUN in bash against stubs: J and
 * R answer from fixtures, and a fake curl on PATH answers every direct call
 * and logs its method and URL. Assertions are on the lines printed and the
 * calls made. Nothing here reads the network.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const sectionFile = (n: string) => readFileSync(resolve(ROOT, "scripts/verify-deploy.d", n), "utf8");

/** A section of the main script: from its echo line up to the next section's echo line. */
function section(script: string, header: string): string {
  const open = new RegExp(`^echo "== ${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m").exec(script);
  if (!open) throw new Error(`no section ${header} in the verifier`);
  const rest = script.slice(open.index + 1);
  const next = /^echo "(?:== |done\.)/m.exec(rest);
  return script.slice(open.index, next ? open.index + 1 + next.index : undefined);
}
const def = (script: string, re: RegExp, what: string) => { const m = re.exec(script); if (!m) throw new Error(`no ${what} in the verifier`); return m[0]; };
const BUILD_GE = def(SCRIPT, /^build_ge\(\) \{[\s\S]*?^\}$/m, "build_ge");
const PROBE = def(SCRIPT, /^probe\(\) \{[\s\S]*?esac; \}$/m, "probe");

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };
type Answer = { match?: string; body: string };
interface Fx {
  /** J(body): first answer whose regex matches the body. */
  J?: Answer[];
  /** R(fn, args): answers per function, first whose regex matches the args. */
  R?: Record<string, Answer[]>;
  /** Every direct curl call, matched on "METHOD URL". */
  curl?: Route[];
  /** Files under the private /tmp, by name. */
  files?: Record<string, string>;
  env?: Record<string, string>;
}

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

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
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.replace("%{http_code}",String(st)).replace(/\\\\n/g,"\\n");
process.stdout.write(out);
`;
const STUB = `const fs=require("fs");const [kind,a1,a2]=process.argv.slice(2);
const fx=JSON.parse(fs.readFileSync(process.env.VD_FX,"utf8"));
fs.appendFileSync(process.env.VD_CALLS,kind+"\\t"+a1+(a2!==undefined?"\\t"+a2:"")+"\\n");
const pick=(list,s)=>(list||[]).find((x)=>!x.match||new RegExp(x.match).test(s||""));
const hit=kind==="J"?pick(fx.J,a1):pick((fx.R||{})[a1],a2||"");
process.stdout.write(hit?hit.body:(kind==="R"?'{"code":"PGRST202","message":"stub: no fixture"}':"{}"));
`;

/** Run `body` in bash with the stubs. /tmp/ in the body is pointed at a private directory. */
function run(body: string, fx: Fx = {}, cwd = ROOT): { lines: string[]; calls: string[]; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "vd-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "stub.cjs"), STUB);
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  writeFileSync(join(dir, "fx.json"), JSON.stringify(fx));
  writeFileSync(join(dir, "routes.json"), JSON.stringify(fx.curl ?? []));
  writeFileSync(join(dir, "calls.log"), "");
  for (const [n, v] of Object.entries(fx.files ?? {})) writeFileSync(join(dir, n), v);
  const prelude = `set -u
K=pk_test; RB=""; B=\${VD_B:-https://p.supabase.co}; SITE=https://site.test; UA=ua
J() { node ${JSON.stringify(join(dir, "stub.cjs"))} J "$1"; }
R() { node ${JSON.stringify(join(dir, "stub.cjs"))} R "$1" "\${2:-}"; }
MC() { echo '{}'; }
${BUILD_GE}
${PROBE}
`;
  writeFileSync(join(dir, "run.sh"), prelude + body.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env, ...fx.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_FX: join(dir, "fx.json"), VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  delete env.DAY30_APPLIED_AT;
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), dir };
}
const has = (lines: string[], status: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${status}  `) && re.test(l));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

// ─────────────────────────────────────────────────────────────────────────────
describe("a refusal probe is a read: it can never commit a write (S8-125)", () => {
  const rpc = (status: number, body: unknown): Route[] => [{ match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/", status, body: JSON.stringify(body) }];

  it("probes with a GET, which PostgREST runs read-only, and never a POST", () => {
    const { lines, calls } = run(`probe record_checkout_start '{"p_stripe_session_id":"cs_x","p_amount_cents":0,"p_metadata":{},"p_tokens":["a","b c"]}'`,
      { curl: rpc(401, { code: "42501", message: "permission denied" }) });
    expect(has(lines, "PASS", /record_checkout_start as anon -> 42501/), show(lines)).toBe(true);
    const rpcCalls = calls.filter((c) => /\/rest\/v1\/rpc\//.test(c) || /^R\t/.test(c));
    expect(rpcCalls.length, `calls: ${calls.join(" | ")}`).toBe(1);
    expect(rpcCalls[0], "the probe POSTed: had the revoke regressed, the call would have written").toMatch(/^curl\tGET https:\/\/p\.supabase\.co\/rest\/v1\/rpc\/record_checkout_start\?/);
    // Typed values in the query string: arrays as Postgres array literals, objects as JSON.
    const qs = new URL(rpcCalls[0].split(" ")[1]).searchParams;
    expect(qs.get("p_amount_cents")).toBe("0");
    expect(qs.get("p_metadata")).toBe("{}");
    expect(qs.get("p_tokens")).toBe('{"a","b c"}');
  });

  it("a function that turns out to be callable is a FAIL naming the read-only stop, not a pass", () => {
    const { lines } = run(`probe promote_category '{"p_basis":"rule","p_key":"x","p_target":"y"}'`,
      { curl: rpc(500, { code: "25006", message: "cannot execute INSERT in a read-only transaction" }) });
    expect(has(lines, "FAIL", /promote_category is CALLABLE as anon/), show(lines)).toBe(true);
    const open = run(`probe get_db_size_stats '{}'`, { curl: rpc(200, [{ size: 1 }]) });
    expect(has(open.lines, "FAIL", /get_db_size_stats as anon -> ROWS:1/), show(open.lines)).toBe(true);
  });

  it("a null argument, which a GET cannot carry, fails the probe before any call", () => {
    const { lines, calls } = run(`probe x '{"p_a":null}'`, { curl: rpc(401, { code: "42501" }) });
    expect(has(lines, "FAIL", /null argument/), show(lines)).toBe(true);
    expect(calls.filter((c) => /rpc/.test(c))).toEqual([]);
  });

  it("no probe call site in the verifier passes a null argument", () => {
    const files = [SCRIPT, ...["30-email-relays.sh", "35-model-spend-gate.sh", "40-db-exposure.sh", "40-resume-privacy.sh", "45-agents-api.sh", "45-payments.sh", "45-scan-ai.sh"].filter((n) => existsSync(resolve(ROOT, "scripts/verify-deploy.d", n))).map(sectionFile)];
    const sites = files.flatMap((f) => [...f.matchAll(/(?:^|; )probe ([a-z_]+) '([^']*)'/gm)].map((m) => ({ fn: m[1], args: m[2] })));
    expect(sites.length, "found no probe call sites: the scan is broken").toBeGreaterThan(30);
    const nulls = sites.filter((s) => Object.values(JSON.parse(s.args) as Record<string, unknown>).some((v) => v === null)).map((s) => s.fn);
    expect(nulls, "these probes pass null, so they would refuse to run").toEqual([]);
  });
});

/**
 * Whether the latest definition of each function in supabase/migrations
 * writes: its body (comments dropped) holds an INSERT, an UPDATE ... SET (an
 * alias allowed), a DELETE or a TRUNCATE. Readers are false; functions no
 * migration defines are absent.
 */
function migrationWriters(): Map<string, boolean> {
  const dir = resolve(ROOT, "supabase/migrations");
  const out = new Map<string, boolean>();
  const WRITES = /\b(insert\s+into|update\s+(?:only\s+)?[\w."]+(?:\s+(?:as\s+)?\w+)?\s+set|delete\s+from|truncate)\b/i;
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, f), "utf8");
    const head = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi;
    for (let m = head.exec(sql); m; m = head.exec(sql)) {
      const semi = sql.indexOf(";", m.index);
      const tag = /\$[a-z_]*\$/i.exec(sql.slice(m.index, semi < 0 ? undefined : semi));
      if (!tag) continue;
      const from = m.index + tag.index + tag[0].length;
      const to = sql.indexOf(tag[0], from);
      if (to < 0) continue;
      out.set(m[1].toLowerCase(), WRITES.test(sql.slice(from, to).replace(/--[^\n]*/g, "")));
      head.lastIndex = to + tag[0].length;
    }
  }
  return out;
}

describe("no section POSTs a writer to watch it refuse (S8-125, sections 63 and 65)", () => {
  const SECTIONS = readdirSync(resolve(ROOT, "scripts/verify-deploy.d")).filter((n) => n.endsWith(".sh")).sort();
  const refuse = (by: Record<string, { status: number; body: unknown }> = {}): Route[] => [
    ...Object.entries(by).map(([fn, a]) => ({ match: `^GET https://p\\.supabase\\.co/rest/v1/rpc/${fn}\\?`, status: a.status, body: JSON.stringify(a.body) })),
    { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/", status: 401, body: JSON.stringify({ code: "42501", message: "permission denied" }) },
  ];

  it("every RPC a section POSTs is a reader by its migration; the writers 63 and 65 prove closed go out as read-only GETs", () => {
    const writes = migrationWriters();
    // Positive control: the migration reader knows these four write and these two read.
    for (const w of ["payment_revoke", "payment_revoke_credits", "agent_pass_settle", "search_digest_record_sent"]) expect(writes.get(w), `${w} reads as a reader`).toBe(true);
    for (const r of ["get_cron_health", "client_callable_census"]) expect(writes.get(r), `${r} reads as a writer`).toBe(false);

    const posted = new Set<string>();
    const gets = new Set<string>();
    for (const n of ["63-wave2-email-ops.sh", "65-wave2-entitlements.sh"]) {
      const { calls } = run(sectionFile(n), { curl: refuse() });
      for (const c of calls) {
        const r = /^R\t([a-z_]+)/.exec(c) ?? /^curl\tPOST https:\/\/p\.supabase\.co\/rest\/v1\/rpc\/([a-z_]+)/.exec(c);
        if (r) posted.add(r[1]);
        const g = /^curl\tGET https:\/\/p\.supabase\.co\/rest\/v1\/rpc\/([a-z_]+)/.exec(c);
        if (g) gets.add(g[1]);
      }
    }
    // Every other call site, read from the main script and each section file.
    for (const src of [SCRIPT, ...SECTIONS.map(sectionFile)]) {
      const code = src.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
      for (const m of code.matchAll(/(?:^|[\s($;|])R ([a-z_]+)\b/gm)) posted.add(m[1]);
    }
    expect(posted.size, "found no R call sites: the scan is broken").toBeGreaterThan(15);
    const writers = [...posted].filter((fn) => writes.get(fn) === true).sort();
    expect(writers, "the verifier POSTs these writers: had a revoke regressed, every run would write").toEqual([]);
    for (const w of ["payment_revoke", "payment_revoke_credits", "agent_pass_settle", "search_digest_record_sent"]) expect(gets.has(w), `${w} is no longer probed at all`).toBe(true);
  });

  it("section 65 still judges its migrations: 42501 passes, a callable writer fails, and PGRST202 fails as not applied", () => {
    const { lines } = run(sectionFile("65-wave2-entitlements.sh"), { curl: refuse({
      payment_revoke_credits: { status: 500, body: { code: "25006", message: "cannot execute UPDATE in a read-only transaction" } },
      agent_pass_settle: { status: 404, body: { code: "PGRST202", message: "Could not find the function" } },
    }) });
    expect(has(lines, "PASS", /^PASS {2}payment_revoke exists and refuses anon by name \(42501\)/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /payment_revoke_credits is CALLABLE as anon/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /agent_pass_settle not found \(PGRST202\): its migration has not applied/), show(lines)).toBe(true);
  });

  it("section 63 judges its four the same way, over a GET", () => {
    const { lines } = run(sectionFile("63-wave2-email-ops.sh"), { curl: refuse({
      email_delivery_health: { status: 404, body: { code: "PGRST202", message: "Could not find the function" } },
    }) });
    expect(has(lines, "PASS", /^PASS {2}search_digest_record_sent as anon -> 42501 \(closed\)/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /email_delivery_health -> PGRST202 \(not created/), show(lines)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("one run at a time: two runs never share the /tmp/vd_* files (L1-06)", () => {
  const LOCK = () => def(SCRIPT, /^# ONE RUN AT A TIME\.[\s\S]*?^trap 'rm -rf "\$VD_LOCK"' EXIT$/m, "the run lock");

  it("a second run while the first is alive refuses, and the lock is released when the first ends", async () => {
    // Hold the lock in a background run, then start a second one.
    const dir = mkdtempSync(join(tmpdir(), "vd-lock-"));
    dirs.push(dir);
    const body = (msg: string) => `set -u\n${LOCK()}\necho "INFO  ${msg}"\nsleep 4\n`.split("/tmp/").join(`${dir}/`);
    writeFileSync(join(dir, "a.sh"), body("first"));
    writeFileSync(join(dir, "b.sh"), body("second"));
    const a = spawn("bash", [join(dir, "a.sh")], { stdio: "ignore" });
    for (let i = 0; i < 50 && !existsSync(join(dir, "vd_verify_deploy.lock.d", "pid")); i++) await new Promise((r) => setTimeout(r, 50));
    let out = "";
    let code = 0;
    try { out = execFileSync("bash", [join(dir, "b.sh")], { encoding: "utf8" }); } catch (e) { const x = e as { status?: number; stdout?: string }; code = x.status ?? 1; out = String(x.stdout ?? ""); }
    expect(code, out).not.toBe(0);
    expect(out).toMatch(/^FAIL {2}another verify-deploy run \(pid \d+\)/m);
    await new Promise((r) => a.on("exit", r));
    expect(existsSync(join(dir, "vd_verify_deploy.lock.d")), "the first run left its lock behind").toBe(false);
  });

  it("a lock left by a run that died is taken over, not obeyed for ever", () => {
    const { lines } = run(`mkdir -p /tmp/vd_verify_deploy.lock.d; echo 999999 > /tmp/vd_verify_deploy.lock.d/pid\n${LOCK()}\necho "INFO  ran"`);
    expect(has(lines, "INFO", /took over a lock left by an interrupted run \(pid 999999\)/), show(lines)).toBe(true);
    expect(lines, "the run did not continue past the stale lock").toContain("INFO  ran");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("builds are judged 'this build or later', by number (S8-126, S8-124)", () => {
  const S1 = section(SCRIPT, "1. job-board bundle");
  const REPO_BUILD = /BUILD_VERSION = "([^"]+)"/.exec(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"))![1];
  const status = (o: Record<string, unknown>) => [{ match: '"status"', body: JSON.stringify({ catalogSize: 1, orphanPruneBlocked: false, ...o }) }];

  it("section 1 passes .100, which its pattern read as FAIL", () => {
    const { lines } = run(S1, { J: status({ version: "2026-09-09.100" }) });
    expect(has(lines, "PASS", /status\.version = 2026-09-09\.100/), show(lines)).toBe(true);
    expect(has(run(S1, { J: status({ version: "2026-09-09.72" }) }).lines, "FAIL", /status\.version = 2026-09-09\.72/)).toBe(true);
  });

  it("section 1 compares catalogSize with this checkout's own catalogue, and only when production serves this checkout's build", () => {
    const counted = Number(execFileSync("npx", ["--no-install", "tsx", "-e", 'import("./src/test/helpers/catalog.ts").then((m)=>console.log(m.CATALOG.length))'], { cwd: ROOT, encoding: "utf8" }).trim());
    expect(counted).toBeGreaterThan(20_000);
    const same = run(S1, { J: status({ version: REPO_BUILD, catalogSize: counted }) });
    expect(has(same.lines, "PASS", new RegExp(`catalogSize = ${counted} \\(want ${counted}`)), show(same.lines)).toBe(true);
    const off = run(S1, { J: status({ version: REPO_BUILD, catalogSize: counted - 1 }) });
    expect(has(off.lines, "FAIL", /catalogSize = /), show(off.lines)).toBe(true);
    const other = run(S1, { J: status({ version: "2026-09-09.1", catalogSize: 5 }) });
    expect(has(other.lines, "INFO", /production serves 2026-09-09\.1 and this checkout is/), show(other.lines)).toBe(true);
  });

  const preflight = (fnBuild: (fn: string) => string): Route[] => [
    ...["free-keyword-scan", "free-keyword-scan-stream", "scan-credits", "parse-pdf", "parse-docx", "parse-spreadsheet", "generate-interview-coach", "generate-career-path", "generate-premium-package", "generate-premium-package-stream", "generate-cover-letter", "generate-cover-letter-stream", "generate-keyword-fix", "analyze-linkedin-profile", "generate-resume-roast", "get-account-data", "generate-summary", "generate-tailored-resume", "generate-elevator-pitch", "generate-recruiter-view", "generate-application-answers", "generate-product-preview", "nl-search", "import-freelance-profile", "test-ai-fallback", "parse-resume-structured", "shortlist-evaluate", "generate-career-snapshot", "generate-graduate-gameplan", "generate-tailored-resume-stream", "generate-freelance-boost", "check-alerts"]
      .map((fn) => ({ match: `^OPTIONS https://p\\.supabase\\.co/functions/v1/${fn}$`, status: 200, headers: { "x-fn-build": fnBuild(fn) } })),
  ];

  it("45-scan-ai passes a rebuild dated 2026-10-10 or 2027, which its date pattern read as the previous bundle", () => {
    for (const d of ["2026-10-10.1", "2026-10-31.2", "2027-01-04.1"]) {
      const { lines } = run(sectionFile("45-scan-ai.sh"), { curl: preflight((fn) => `${fn}.${d}`) });
      expect(has(lines, "PASS", new RegExp(`free-keyword-scan preflight x-fn-build = free-keyword-scan\\.${d.replace(".", "\\.")}`)), show(lines)).toBe(true);
      expect(lines.some((l) => /previous bundle is still serving/.test(l)), show(lines)).toBe(false);
    }
    const old = run(sectionFile("45-scan-ai.sh"), { curl: preflight((fn) => `${fn}.2026-10-04.9`) });
    expect(has(old.lines, "FAIL", /free-keyword-scan preflight x-fn-build = free-keyword-scan\.2026-10-04\.9/), show(old.lines)).toBe(true);
  });

  it("35-model-spend-gate passes a later build and fails an older one, where it printed INFO for both", () => {
    const later = run(sectionFile("35-model-spend-gate.sh"), { curl: preflight((fn) => `${fn}.2026-10-10.1`) });
    expect(has(later.lines, "PASS", /generate-summary preflight x-fn-build = generate-summary\.2026-10-10\.1/), show(later.lines)).toBe(true);
    const older = run(sectionFile("35-model-spend-gate.sh"), { curl: preflight((fn) => `${fn}.2026-10-03.5`) });
    expect(has(older.lines, "FAIL", /generate-summary preflight x-fn-build = generate-summary\.2026-10-03\.5/), show(older.lines)).toBe(true);
  });

  it("40's check-alerts line passes a rebuild and still sends its keyless probe", () => {
    const routes: Route[] = [
      { match: "^OPTIONS https://p\\.supabase\\.co/functions/v1/check-alerts$", status: 200, headers: { "x-fn-build": "check-alerts.2026-10-10.1", "access-control-allow-headers": "x-alerts-cron, content-type" } },
      { match: "^POST https://p\\.supabase\\.co/functions/v1/check-alerts$", status: 401, body: "{}" },
    ];
    const { lines, calls } = run(sectionFile("40-db-exposure.sh"), { curl: routes });
    expect(has(lines, "PASS", /check-alerts preflight x-fn-build = check-alerts\.2026-10-10\.1/), show(lines)).toBe(true);
    expect(calls.some((c) => /^curl\tPOST https:\/\/p\.supabase\.co\/functions\/v1\/check-alerts/.test(c)), "the keyless refusal was never asked").toBe(true);
    expect(has(lines, "PASS", /check-alerts without a key -> 401/), show(lines)).toBe(true);
  });

  it("no section still tells the reader to discount 7a or 7f as failing by construction", () => {
    for (const n of ["30-email-relays.sh", "45-payments.sh"]) {
      expect(sectionFile(n), `${n} still says a build_ge line fails by construction`).not.toMatch(/FAIL by construction|it prints FAIL for create-checkout/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("4c: a refusal names its reason, beside a board the gate admits (S8-127)", () => {
  const S4C = section(SCRIPT, "4c.");
  const TOK = Array.from({ length: 40 }, (_, i) => `tok${i}`);
  const facets = [{ match: '"includeFacets"', body: JSON.stringify({ companies: TOK.map((token) => ({ token, open: 9 })) }) }];
  const named = (why: string | null) => JSON.stringify([
    { company_token: "dominos", sufficient_30: false, still_open_30: null, events_30: null, insufficient_reason_30: why },
    { company_token: "oreillyauto~wd1~oreilly", sufficient_30: false, still_open_30: null, events_30: null, insufficient_reason_30: why },
    { company_token: "workday~wd5~Workday", sufficient_30: false, still_open_30: null, events_30: null, insufficient_reason_30: "lap" },
  ]);
  /** The company curve: the named call answers `why`; a chunk answers one sufficient row if it holds `ctl`. */
  const curve = (why: string | null, ctl: string | null): Answer[] => [
    { match: '"dominos"', body: named(why) },
    ...(ctl ? [{ match: `"${ctl}"`, body: JSON.stringify([{ company_token: ctl, sufficient_30: true, events_30: 40, still_open_30: 0.41, insufficient_reason_30: null }]) }] : []),
    { match: '"tok', body: JSON.stringify([{ company_token: "tok0", sufficient_30: false, still_open_30: null, events_30: null, insufficient_reason_30: "lap" }]) },
  ];

  it("positive control found, refusals named: PASS, PASS, PASS", () => {
    const { lines, calls } = run(S4C, { J: facets, R: { get_company_fill_curve: curve("lap", "tok23") } });
    expect(has(lines, "PASS", /positive control: tok23 is sufficient/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /dominos refused for its named reason lap/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /oreillyauto~wd1~oreilly refused for its named reason lap/), show(lines)).toBe(true);
    const chunks = calls.filter((c) => /^R\tget_company_fill_curve\t.*"tok/.test(c));
    expect(chunks.length, "it stops at the first chunk holding a sufficient board").toBe(3);
    for (const c of chunks) expect((JSON.parse(c.split("\t")[2]).p_tokens as string[]).length).toBeLessThanOrEqual(10);
  });

  it("a refusal with no reason is a FAIL, which it used to pass", () => {
    const { lines } = run(S4C, { J: facets, R: { get_company_fill_curve: curve(null, "tok3") } });
    expect(has(lines, "FAIL", /dominos refused WITHOUT a reason/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS") && /dominos/.test(l)), show(lines)).toBe(false);
  });

  it("with no sufficient board anywhere, the refusals are INFO: a gate that refuses everything looks the same", () => {
    const { lines } = run(S4C, { J: facets, R: { get_company_fill_curve: curve("lap", null) } });
    expect(has(lines, "INFO", /no board among the largest 150 is sufficient/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /dominos refused for its named reason lap/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS")), show(lines)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("5u asks the Ontario reader about postings inside its own scope (S8-128)", () => {
  const S5U = section(SCRIPT, "5u.");
  const list = [{ match: '"ontario"', body: JSON.stringify({ jobs: [
    { id: "smartrecruiters:VentureMedia:1", remote: true },
    { id: "workday:td~wd3~TD:2", remote: false },
    { id: "bamboohr:schemaapp:3", remote: false },
  ] }) }];
  const ROW = { od_pay_evidence: null, od_pay_basis: null, od_vacancy_evidence: null, od_ai_evidence: null, od_canadian_experience_evidence: null };

  it("skips the remote newest posting, asks the next ones in turn, and judges the first row that comes back", () => {
    const { lines, calls } = run(S5U, { J: list, R: { get_ontario_posting_disclosures: [
      { match: "schemaapp", body: JSON.stringify([ROW]) },
      { match: "zz-not-a-posting", body: "[]" },
      { body: "[]" },
    ] } });
    const asked = calls.filter((c) => /^R\tget_ontario_posting_disclosures/.test(c)).map((c) => JSON.parse(c.split("\t")[2]).p_id);
    expect(asked.slice(0, 2), "the remote posting is outside the reader's scope and must not be asked").toEqual(["workday:td~wd3~TD:2", "bamboohr:schemaapp:3"]);
    expect(has(lines, "PASS", /one row for the asked posting bamboohr:schemaapp:3/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /five evidence fields present/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /no verdict, no score -- evidence only, read on a returned row/), show(lines)).toBe(true);
    expect(lines.filter((l) => l.startsWith("FAIL")), show(lines)).toEqual([]);
  });

  it("no in-scope posting answering at all is the FAIL, and nothing is passed off an empty object", () => {
    const { lines } = run(S5U, { J: list, R: { get_ontario_posting_disclosures: [{ body: "[]" }] } });
    expect(has(lines, "FAIL", /answered no row for any of 2 non-remote/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS") && /no verdict/.test(l)), show(lines)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("7i filters by the vendor key job-board reads (S8-129)", () => {
  const S7I = section(SCRIPT, "7i.");
  const feed = JSON.stringify({ jobs: Array.from({ length: 12 }, (_, i) => ({ id: i, first_published: new Date().toISOString(), publishedAt: new Date().toISOString(), isListed: true })) });
  const lever = JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ id: i, createdAt: Date.now() })));
  const curl: Route[] = [
    { match: "boards-api\\.greenhouse\\.io", body: feed },
    { match: "api\\.ashbyhq\\.com", body: feed },
    { match: "api\\.lever\\.co", body: lever },
  ];
  const files = { "vd_status.json": "{}" };
  const status = JSON.stringify({ version: "2026-09-09.92", sliceStats: { lightSet: 1, lightCap: 500, wallStopped: false, heapMb: 40 }, chainKick: { status: 200 }, oversizeBoards: [] });

  it("every list request names `vendor`, never the ignored plural, and a fair count passes", () => {
    const { lines, calls } = run(S7I, { files, curl, J: [{ match: '"status"', body: status }, { body: JSON.stringify({ total: 12, ignoredFilters: [] }) }] });
    const lists = calls.filter((c) => /^J\t.*"action":"list"/.test(c));
    expect(lists.length, show(lines)).toBeGreaterThanOrEqual(12);
    for (const c of lists) {
      const body = JSON.parse(c.slice(2)) as Record<string, unknown>;
      expect("vendors" in body, `a list still sends the plural key: ${c}`).toBe(false);
      expect(Array.isArray(body.vendor), `no vendor filter on ${c}`).toBe(true);
    }
    expect(has(lines, "PASS", /greenhouse:anthropic serves 12 vs 12 in-window/), show(lines)).toBe(true);
  });

  it("a filter the board says it ignored makes the line a FAIL, whatever the count", () => {
    const { lines } = run(S7I, { files, curl, J: [{ match: '"status"', body: status }, { body: JSON.stringify({ total: 12, ignoredFilters: ["vendor"] }) }] });
    expect(has(lines, "FAIL", /greenhouse:anthropic the board ignored a filter this line sent \(vendor\)/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /greenhouse:okta the board ignored a filter this line sent/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS") && /serves 12 vs 12/.test(l)), show(lines)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("section 90 does not pass a light re-read that never happened (S8-127)", () => {
  const S90 = sectionFile("90-job-board-light-and-deep.sh");
  const st = (lr: Record<string, unknown>) => JSON.stringify({ version: "2026-09-09.90", sliceStats: { lightReread: { since: new Date(Date.now() - 30 * 3600_000).toISOString(), ...lr }, lightSet: 3, lightCap: 500 }, oversizeBoards: [], deepCursor: {}, cursor: {} });

  it("0 of 0 re-reads is INFO, not 'every light re-read landed'", () => {
    const { lines } = run(S90, { J: [{ match: '"status"', body: st({ enrolled: 0, reread: 0, ok: 0, deferred: 0 }) }], env: { VD_B: "http://127.0.0.1:9" } });
    expect(has(lines, "INFO", /lightReread\.ok = reread = 0: no light re-read has happened/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS") && /every light re-read landed/.test(l)), show(lines)).toBe(false);
    expect(lines.some((l) => l.startsWith("PASS") && /lightReread\.deferred/.test(l)), show(lines)).toBe(false);
  });

  it("positive control: re-reads that all landed still pass", () => {
    const { lines } = run(S90, { J: [{ match: '"status"', body: st({ enrolled: 3, reread: 3, ok: 3, deferred: 0 }) }], env: { VD_B: "http://127.0.0.1:9" } });
    expect(has(lines, "PASS", /lightReread\.ok = reread \(3 of 3\): every light re-read landed/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /lightReread\.deferred = 0/), show(lines)).toBe(true);
  });
});
