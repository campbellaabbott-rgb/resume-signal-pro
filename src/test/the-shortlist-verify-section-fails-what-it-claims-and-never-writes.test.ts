// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE BUG ROUND'S SHORTLIST VERIFY SECTION FAILS WHAT IT CLAIMS, AND NEVER
 * WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-shortlist.sh is run against a fake
 * curl that answers from routes and logs every call:
 *   - before the deploy (shortlist-evaluate on the cost wave's build, the old
 *     Shortlist chunk, no notice columns) every claim prints INFO and nothing
 *     FAILs;
 *   - a good deploy PASSes the build, every function claim, every page claim
 *     and the notice columns, with no FAIL; a later build passes too;
 *   - a preflight with no build, a build that hides Retry-After, a page
 *     published while the function stayed behind, a published chunk missing
 *     any one mark, a missing chunk, a broken guard, the columns missing once
 *     the round is live and a redactor that does not redact each print a FAIL;
 *   - S14X-073 is INFO until the ledger names it; rule A is judged by the cron
 *     job, two anon refusals and the page's delete control, rule B by the
 *     copy, and any other answer FAILs;
 *   - nothing is ever posted, and the publishable key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 180_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-shortlist.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_shortlist";

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

type Opts = { ledger?: unknown; stubRedactor?: boolean };
function run(routes: Route[], o: Opts = {}): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbs-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "ledger.json"), JSON.stringify(o.ledger ?? { reservations: { "bug-round": { ownerDecided: {} } } }));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VDBS_LEDGER: join(dir, "ledger.json"),
  };
  if (o.stubRedactor) {
    // A redactor that hides nothing, and a function that still reads the body's blocklist.
    writeFileSync(join(dir, "redaction.mjs"), "export function redactForScoring(t) { return { redacted: t, exclusionsApplied: [], nameFound: true }; }\n");
    mkdirSync(join(dir, "fn"));
    writeFileSync(join(dir, "fn", "index.ts"), "const cfg = body.redactionConfig;\n");
    env.VDBS_REDACTION = join(dir, "redaction.mjs");
    env.VDBS_FN_SRC = join(dir, "fn", "index.ts");
  }
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 85_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

const NEW = "shortlist-evaluate.2026-11-12.1";
const OLD = "shortlist-evaluate.2026-11-09.2";

function preflight(build: string | null, expose = "x-fn-build, retry-after"): Route {
  const headers: Record<string, string> = { "access-control-allow-headers": "authorization, x-client-info, apikey, content-type" };
  if (build) headers["x-fn-build"] = build;
  if (expose) headers["Access-Control-Expose-Headers"] = expose;
  return { match: "^OPTIONS https://p\\.supabase\\.co/functions/v1/shortlist\\-evaluate$", headers };
}

/** The Shortlist chunk as the round publishes it, minified, and the one live before it. */
const GOOD_CHUNK = 'const r=e.from("shortlist_decisions").select("candidate_id, action, shortlist_candidates!inner(role_id)").eq("shortlist_candidates.role_id",i).range(a,a+999);'
  + 'h("details",{"data-how-shortlist-works":!0});h("details",{"data-model-saw":!0},x.redacted_text,x.candidate_jurisdiction);'
  + 'h("button",{"data-notice-log":!0});n.logged_at??n.sent_at;h("p",{"data-read-error":!0});h("p",{"data-name-not-found":!0});'
  + 'async function q(t){const s=t.context;s.headers.get("retry-after");return"Shortlist could not be reached. Check your connection and try again."}'
  + 'e.rpc("shortlist_decide",{p_candidate_id:c});l({attested:!0});';
const OLD_CHUNK = 'const d=await e.from("shortlist_decisions").select("*").in("candidate_id",ids);h("a",{to:"/methodology"});'
  + 'h("button",null,"Copy + log as sent");y("Evaluation failed — try again.");h("p",null,"Records retained 4 years");'
  + 'e.rpc("shortlist_decide",{p_candidate_id:c});l({attested:!0});';

function site(chunk: string | null): Route[] {
  return [
    { match: "^GET https://site\\.test/shortlist$", body: '<!doctype html><script type="module" src="/assets/index-Main.js"></script>' },
    { match: "^GET https://site\\.test/assets/index\\-Main\\.js$", body: chunk === null ? 'const d=["assets/Board-B.js"];' : 'const d=()=>import("./Shortlist-S1.js");' },
    ...(chunk === null ? [] : [{ match: "^GET https://site\\.test/assets/Shortlist\\-S1\\.js$", body: chunk }]),
  ];
}
const COLS_OK: Route = { match: "^GET https://p\\.supabase\\.co/rest/v1/shortlist_notices\\?select=logged_at,recipients", status: 401, body: '{"code":"42501","message":"permission denied for table shortlist_notices"}' };
const COLS_MISSING: Route = { match: "^GET https://p\\.supabase\\.co/rest/v1/shortlist_notices\\?select=logged_at,recipients", status: 400, body: '{"code":"42703","message":"column shortlist_notices.logged_at does not exist"}' };
const COLS_OPEN: Route = { match: "^GET https://p\\.supabase\\.co/rest/v1/shortlist_notices\\?select=logged_at,recipients", body: "[]" };

const good = (o: { build?: string | null; expose?: string; chunk?: string | null; cols?: Route; extra?: Route[] } = {}): Route[] =>
  [...(o.extra ?? []), preflight(o.build === undefined ? NEW : o.build, o.expose ?? "x-fn-build, retry-after"), ...site(o.chunk === undefined ? GOOD_CHUNK : o.chunk), o.cols ?? COLS_OK];
const before = (): Route[] => good({ build: OLD, expose: "x-fn-build", chunk: OLD_CHUNK, cols: COLS_MISSING });

const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const passes = (lines: string[]) => lines.filter((l) => l.startsWith("PASS"));
const writes = (calls: string[]) => calls.filter((c) => !/^curl\t(GET|OPTIONS) /.test(c));
const failing = (lines: string[], id: string) => fails(lines).filter((l) => l.startsWith(`FAIL  ${id} `));
const FN_KEYS = ["RC-S13-073", "S14X-022", "S14X-023", "S14X-024", "S14X-025", "S14X-072/fn", "S14X-105", "S14X-106", "S14X-288", "S14X-289", "S14X-197/fn"];
const PAGE_KEYS = ["S14X-075", "S14X-162", "S14X-163/page", "S14X-197/page", "S14X-233", "S14X-072/page"];

const decided = (v: unknown) => ({ reservations: { "bug-round": { ownerDecided: { "S14X-073": v } } } });
const CRON_OK: Route = { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/get_cron_health", body: JSON.stringify([
  { ch_jobname: "mail-lists-prune", ch_schedule: "37 4 * * *", ch_active: true, ch_timeout: "5min", ch_last_status: "succeeded" },
  { ch_jobname: "shortlist-four-year-purge", ch_schedule: "23 4 * * *", ch_active: true, ch_timeout: "2min", ch_last_status: "succeeded" },
]) };
const CRON_NONE: Route = { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/get_cron_health", body: JSON.stringify([{ ch_jobname: "mail-lists-prune", ch_schedule: "37 4 * * *", ch_active: true, ch_timeout: "5min" }]) };
const DEL_OK: Route = { match: "^GET https://p\\.supabase\\.co/rest/v1/shortlist_deletions\\?", status: 401, body: '{"code":"42501"}' };
const RPC_OK: Route = { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/shortlist_delete_candidate\\?", status: 401, body: '{"code":"42501"}' };
const RPC_MISSING: Route = { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/shortlist_delete_candidate\\?", status: 404, body: '{"code":"PGRST202"}' };
const RULE_A_CHUNK = `${GOOD_CHUNK}e.rpc("shortlist_delete_candidate",{p_candidate_id:c});`;

describe("section 99zzzzzzz (bug round, lane shortlist)", () => {
  it("before the deploy every claim prints INFO, nothing FAILs, and nothing is written", () => {
    const { lines, calls, out } = run(before());
    expect(fails(lines), out).toEqual([]);
    for (const k of [...FN_KEYS, ...PAGE_KEYS, "B", "S14X-163/db"]) expect(lines.some((l) => l.startsWith(`INFO  ${k} `)), `${k}\n${out}`).toBe(true);
    // Only the offline proof and the three standing guards pass before the paste.
    expect(passes(lines).map((l) => l.split(" ")[2]), out).toEqual(["R0", "G1", "G2", "G3"]);
    expect(lines.some((l) => /^INFO  S14X-073 owner pending/.test(l)), out).toBe(true);
    expect(writes(calls)).toEqual([]);
    expect(out).not.toContain(KEY);
  });

  it("a good deploy PASSes the build, every function and page claim and the notice columns, with no FAIL", () => {
    const { lines, calls, out } = run(good());
    expect(fails(lines), out).toEqual([]);
    for (const k of [...FN_KEYS, ...PAGE_KEYS, "B", "R0", "S14X-163/db", "G1", "G2", "G3"]) expect(passes(lines).some((l) => l.startsWith(`PASS  ${k} `)), `${k}\n${out}`).toBe(true);
    expect(lines.some((l) => /^INFO  S14X-073 owner pending/.test(l)), out).toBe(true);
    expect(writes(calls)).toEqual([]);
    expect(calls.some((c) => /get_cron_health|shortlist_deletions|shortlist_delete_candidate/.test(c)), "no owner probe before the owner decides").toBe(false);
    expect(out).not.toContain(KEY);
  });

  it("a later build passes too", () => {
    const { lines, out } = run(good({ build: "shortlist-evaluate.2026-11-20.1" }));
    expect(fails(lines), out).toEqual([]);
    expect(passes(lines).some((l) => l.startsWith("PASS  B ")), out).toBe(true);
  });
});

describe("each claim can FAIL", () => {
  it("a preflight that names no build", () => {
    const { lines, out } = run(good({ build: null }));
    expect(failing(lines, "B"), out).toHaveLength(1);
  });

  it("this round's build with Retry-After not exposed", () => {
    const { lines, out } = run(good({ expose: "x-fn-build" }));
    expect(failing(lines, "S14X-197/fn"), out).toHaveLength(1);
    expect(fails(lines)).toHaveLength(1);
  });

  it("the page published while the paste left the function behind", () => {
    const { lines, out } = run(good({ build: OLD }));
    for (const k of FN_KEYS) expect(failing(lines, k), `${k}\n${out}`).toHaveLength(1);
    expect(fails(lines)).toHaveLength(FN_KEYS.length);
  });

  const BROKEN: Array<[string, string, string]> = [
    ["S14X-075", '.eq("shortlist_candidates.role_id",i)', '.in("candidate_id",ids)'],
    ["S14X-075", "{\"data-read-error\":!0}", "{}"],
    ["S14X-162", "{\"data-model-saw\":!0}", "{}"],
    ["S14X-163/page", "{\"data-notice-log\":!0}", "{}"],
    ["S14X-163/page", 'h("p",{"data-read-error":!0})', 'h("p",{"data-read-error":!0});h("b",null,"Copy + log as sent")'],
    ["S14X-197/page", "t.context", "t.body"],
    ["S14X-197/page", "Shortlist could not be reached. Check your connection and try again.", "Evaluation failed — try again."],
    ["S14X-233", "{\"data-how-shortlist-works\":!0}", "{to:\"/methodology\"}"],
    ["S14X-233", 'h("p",{"data-read-error":!0})', 'h("p",{"data-read-error":!0});h("p",null,"Records retained 4 years")'],
    ["S14X-072/page", "{\"data-name-not-found\":!0}", "{}"],
    ["G1", "l({attested:!0});", "l({});"],
    ["G3", "l({attested:!0});", 'l({attested:!0});e.from("shortlist_demographics");'],
  ];
  for (const [id, from, to] of BROKEN) {
    it(`a published chunk that breaks ${id} (${to.slice(0, 40)})`, () => {
      const chunk = GOOD_CHUNK.replace(from, to);
      expect(chunk, "the edit changed nothing").not.toBe(GOOD_CHUNK);
      const { lines, out } = run(good({ chunk }));
      expect(failing(lines, id), out).toHaveLength(1);
      expect(fails(lines), out).toHaveLength(1);
    });
  }

  it("a chunk that does not decide through shortlist_decide, or none at all, is unreadable", () => {
    const a = run(good({ chunk: GOOD_CHUNK.replace('e.rpc("shortlist_decide",{p_candidate_id:c});', "") }));
    expect(failing(a.lines, "F0"), a.out).toHaveLength(1);
    const b = run(good({ chunk: null }));
    expect(failing(b.lines, "F0"), b.out).toHaveLength(1);
  });

  it("the notice columns missing, or anon still reading the table, once the round is live", () => {
    const a = run(good({ cols: COLS_MISSING }));
    expect(failing(a.lines, "S14X-163/db"), a.out).toHaveLength(1);
    expect(fails(a.lines)).toHaveLength(1);
    const b = run(good({ cols: COLS_OPEN }));
    expect(failing(b.lines, "S14X-163/db"), b.out).toHaveLength(1);
    const c = run(good({ cols: { ...COLS_OK, status: 502, body: "<html>bad gateway</html>" } }));
    expect(failing(c.lines, "S14X-163/db"), c.out).toHaveLength(1);
  });

  it("a redactor that hides nothing, and a function that reads the body's blocklist", () => {
    const { lines, out } = run(good(), { stubRedactor: true });
    expect(failing(lines, "R0"), out).toHaveLength(1);
    for (const k of FN_KEYS) expect(failing(lines, k), `${k}\n${out}`).toHaveLength(1);
  });
});

describe("S14X-073 is the owner's", () => {
  it("rule A PASSes on the purge job, both anon refusals and the page's delete control", () => {
    const { lines, calls, out } = run(good({ chunk: RULE_A_CHUNK, extra: [CRON_OK, DEL_OK, RPC_OK] }), { ledger: decided("A") });
    expect(passes(lines).some((l) => l.startsWith("PASS  S14X-073 decided (A)")), out).toBe(true);
    expect(fails(lines), out).toEqual([]);
    expect(writes(calls)).toEqual([]);
  });

  it("rule A FAILs once the round is live without the job, the function or the control", () => {
    const a = run(good({ chunk: RULE_A_CHUNK, extra: [CRON_NONE, DEL_OK, RPC_OK] }), { ledger: decided({ choice: "A" }) });
    expect(failing(a.lines, "S14X-073"), a.out).toHaveLength(1);
    const b = run(good({ chunk: RULE_A_CHUNK, extra: [CRON_OK, DEL_OK, RPC_MISSING] }), { ledger: decided("A") });
    expect(failing(b.lines, "S14X-073"), b.out).toHaveLength(1);
    const c = run(good({ extra: [CRON_OK, DEL_OK, RPC_OK] }), { ledger: decided("A") });
    expect(failing(c.lines, "S14X-073"), c.out).toHaveLength(1);
  });

  it("rule A before the paste is INFO", () => {
    const { lines, out } = run([CRON_NONE, ...before()], { ledger: decided("A") });
    expect(lines.some((l) => l.startsWith("INFO  S14X-073 decided (A)")), out).toBe(true);
    expect(fails(lines), out).toEqual([]);
  });

  it("rule B is judged by the copy, and an answer that is neither FAILs", () => {
    const b = run(good(), { ledger: decided("B") });
    expect(passes(b.lines).some((l) => l.startsWith("PASS  S14X-073 decided (B)")), b.out).toBe(true);
    const old = run(good({ chunk: `${GOOD_CHUNK}h("p",null,"Records retained 4 years");` }), { ledger: decided("B") });
    expect(failing(old.lines, "S14X-073"), old.out).toHaveLength(1);
    const odd = run(good(), { ledger: decided("maybe") });
    expect(failing(odd.lines, "S14X-073"), odd.out).toHaveLength(1);
  });
});
