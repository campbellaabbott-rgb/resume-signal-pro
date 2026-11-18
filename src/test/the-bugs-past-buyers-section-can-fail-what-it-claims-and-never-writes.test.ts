// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE BUG ROUND PAST-BUYERS SECTION CAN FAIL WHAT IT CLAIMS, NEVER FAILS
 * BEFORE THE PASTE, AND NEVER WRITES
 * (scripts/verify-deploy.d/99zzzzzzz-bugs-past-buyers.sh).
 *
 * Run against a fake curl that answers from routes and logs every call, a
 * ledger fixture standing in for docs/deploy-ledger.json, and (for the repo
 * lines) either this checkout or a small fixture checkout:
 *   - before the paste (older builds, no lease function, no pass closer, the
 *     old success page) it prints INFO and no FAIL, and both owner keys print
 *     owner pending;
 *   - a full paste passes every build, the lease, the closer, the purge, the
 *     page and this checkout's repo lines;
 *   - a partial paste fails each function left behind; a later build passes
 *     and another function's build never stands in;
 *   - after the paste a missing or callable lease function, a missing,
 *     inactive, untimed or failing closer, a failing purge and an unpublished
 *     page each fail;
 *   - each repo line fails when its claim is false;
 *   - a decided owner key judges what its decision ships, and a key that
 *     ships in round B (S14X-225 yes) prints INFO while only round A is live
 *     and is judged once round B's send-product-email build serves;
 *   - every call is an OPTIONS or a GET, no body is sent, and the key is
 *     never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-past-buyers.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_bugs_past_buyers";
const CLOSED_EN = (JSON.parse(readFileSync(resolve(ROOT, "src/i18n/shards/past-buyers/en.json"), "utf8")) as { pastBuyers: { closedNoCopy: string } }).pastBuyers.closedNoCopy;

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
const tmp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; };

function run(routes: Route[], opts: { ownerDecided?: Record<string, unknown>; repo?: string } = {}): { lines: string[]; calls: string[]; out: string } {
  const dir = tmp("vdbugspastbuyers-");
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "ledger.json"), JSON.stringify({ reservations: { "bug-round": { ownerDecided: opts.ownerDecided ?? {} } } }));
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VDPB_LEDGER: join(dir, "ledger.json"),
  };
  let out = "";
  const cwd = opts.repo ?? ROOT;
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd, env: { ...env, PWD: cwd }, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

const FNS = [
  "generate-keyword-fix", "generate-cover-letter", "generate-premium-package", "generate-career-snapshot", "generate-graduate-gameplan",
  "generate-ats-defense", "generate-freelance-boost", "admin-regenerate-delivery", "verify-product-purchase", "send-product-email",
];
const OWNER_FNS = ["generate-career-path", "import-freelance-profile", "create-product-checkout", "create-scan-pack-checkout"];
const OLD = (fn: string) => `${fn}.2026-11-10.3`;
const NEW = (fn: string) => `${fn}.2026-11-12.1`;
const preflights = (build: (fn: string) => string | null): Route[] =>
  [...FNS, ...OWNER_FNS].map((fn) => { const b = build(fn); return { match: `^OPTIONS https://p\\.supabase\\.co/functions/v1/${fn}$`, headers: b ? { "x-fn-build": b } : {} }; });

const LEASE = "^GET https://p\\.supabase\\.co/rest/v1/rpc/take_delivery_lease_status\\?";
const lease = (state: "missing" | "locked" | "callable" | "rows"): Route => ({
  match: LEASE,
  ...(state === "missing" ? { status: 404, body: JSON.stringify({ code: "PGRST202", message: "Could not find the function" }) }
    : state === "locked" ? { status: 401, body: JSON.stringify({ code: "42501", message: "permission denied for function take_delivery_lease_status" }) }
    : state === "callable" ? { status: 400, body: JSON.stringify({ code: "25006", message: "cannot execute INSERT in a read-only transaction" }) }
    : { body: JSON.stringify([{ token: "t", refusal: null }]) }),
});

type Job = Record<string, unknown>;
const job = (name: string, over: Job = {}): Job => ({
  ch_jobname: name, ch_schedule: "41 3 * * *", ch_active: true, ch_timeout: "2min", ch_runs: 1, ch_failed: 0, ch_timeouts: 0,
  ch_last_start: "2026-11-13T03:41:00Z", ch_last_status: "succeeded", ch_last_seconds: 0.2, ch_max_seconds: 0.2, ...over,
});
const OLD_PURGE = job("scan-cache-and-telemetry-purge", { ch_schedule: "10 4 * * *", ch_timeout: null });
const NEW_PURGE = job("scan-cache-and-telemetry-purge", { ch_schedule: "10 4 * * *" });
const DIGESTS = [job("send-agent-digest", { ch_timeout: null }), job("send-agent-digest-morning", { ch_timeout: null })];
const cron = (jobs: Job[] | string): Route => ({
  match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/get_cron_health\\?p_hours=48$",
  body: typeof jobs === "string" ? jobs : JSON.stringify([job("other-job"), ...jobs]),
});

const PS_NEW = [
  `sessionStorage.setItem("rb_builder_seed",_.resume.rewrittenResume);`,
  `n("label",{htmlFor:"product-success-recovery-file"});a.download="cover-letter.txt";`,
  `e(Coach,{savedCopy:q});if(d?.closedNoCopy===!0)x();`,
  `e("div",{"data-rb-saved-parse-simulation":!0});const p='<html lang="en" data-rb-print>';`,
].join("");
const PS_OLD = `sessionStorage.setItem("rb_resume_text",_.resume.rewrittenResume);n("div",{onClick:f});`;
const SHAPE_NEW = `const R=["ready to apply","listo para aplicar","listo para postularte","lista para postularte","आवेदन करने के लिए तैयार"];`;
const SHAPE_OLD = `const R=["ready to apply","listo para aplicar"];`;
// The English strings: `pageStrings` in the ProductSuccess chunk, as the
// namespace plugin registers them there (this branch's build);
// `entryStrings` in the entry (a build from before the bug round's review).
const EN_STRINGS = `ne({pastBuyers:{closedNoCopy:${JSON.stringify(CLOSED_EN)}}});`;
const site = (opts: { ps?: string; shape?: string; entryStrings?: boolean; pageStrings?: boolean; noChunk?: boolean } = {}): Route[] => [
  { match: "^GET https://site\\.test/$", body: '<script type="module" src="/assets/index-AbC123.js"></script>' },
  {
    match: "^GET https://site\\.test/assets/index-AbC123\\.js$",
    body: (opts.noChunk ? "const a=1;" : `const a=()=>import("./ProductSuccess-Ps1.js");`) + (opts.entryStrings ? `const s={pastBuyers:{closedNoCopy:${JSON.stringify(CLOSED_EN)}}};` : `const s={};`),
  },
  { match: "^GET https://site\\.test/assets/ProductSuccess-Ps1\\.js$", body: `import{j as e}from"./index-AbC123.js";import{S as s}from"./ATSParseSimulator-At1.js";${opts.ps ?? PS_OLD}${opts.pageStrings ? EN_STRINGS : ""}` },
  { match: "^GET https://site\\.test/assets/ATSParseSimulator-At1\\.js$", body: opts.shape ?? SHAPE_OLD },
];
const PUBLISHED = { ps: PS_NEW, shape: SHAPE_NEW, pageStrings: true };

const before = (): Route[] => [...preflights(OLD), lease("missing"), cron([OLD_PURGE, ...DIGESTS]), ...site()];
/** Round A pasted: every lane function at 2026-11-12.1 (production since round A's deploy). */
const after = (): Route[] => [...preflights(NEW), lease("locked"), cron([NEW_PURGE, job("agent-pass-close"), ...DIGESTS]), ...site(PUBLISHED)];
/** Round B's builds of the functions it restamps in this lane (the owner keys of 2026-11-18 ship with them). */
const ROUND_B: Record<string, string> = { "send-product-email": "send-product-email.2026-11-13.1" };
/** Round B pasted on top of round A. */
const afterB = (): Route[] => [...preflights((fn) => ROUND_B[fn] ?? NEW(fn)), ...after().slice(FNS.length + OWNER_FNS.length)];
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const swap = (routes: Route[], match: string, to: Route): Route[] => routes.map((r) => (r.match === match ? to : r));
const CRON_MATCH = cron([]).match;

/** A small checkout holding only the files the repo lines read, all claims true. */
function fixtureRepo(edit: (put: (p: string, s: string) => void) => void = () => undefined): string {
  const repo = tmp("vdbpb-repo-");
  const put = (p: string, s: string) => { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), s); };
  for (const f of ["generate-keyword-fix", "generate-cover-letter", "generate-premium-package", "generate-career-snapshot", "generate-graduate-gameplan"]) {
    put(`supabase/functions/${f}/index.ts`, `import { keepPastBuyerCopy } from "../_shared/past-buyer-copy.ts";\nawait keepPastBuyerCopy(db, {});\n`);
  }
  put("supabase/functions/admin-regenerate-delivery/index.ts",
    `import { stripInventedContact } from "../_shared/contact-guard.ts";\nrewrittenResumeFigureIssues(a, b);\nvalidateProseClaims(a, b);\nstripInventedContact(a, b);\n`);
  put("src/lib/ats-parse-simulator.ts", "export const simulator = 1;\n");
  put("supabase/functions/generate-ats-defense/ats-parse-simulator.ts", "export const simulator = 1;\n");
  mkdirSync(join(repo, "supabase/functions/_shared"), { recursive: true });
  copyFileSync(resolve(ROOT, "supabase/functions/_shared/paid-session.ts"), join(repo, "supabase/functions/_shared/paid-session.ts"));
  put("src/i18n/shards/past-buyers/en.json", JSON.stringify({ pastBuyers: { closedNoCopy: CLOSED_EN } }));
  put("supabase/functions/_shared/product-cuts.ts", "  pastBuyers: `If you bought it before, your link keeps working for ${PAST_BUYER_DAYS} days.`,\n");
  edit(put);
  return repo;
}

describe("the bug round past-buyers section", () => {
  it("before the paste says INFO for every build, the lease, the closer, the purge, the page and both owner keys, and fails nothing", () => {
    const { lines, out } = run(before());
    expect(fails(lines), out).toEqual([]);
    for (const fn of FNS) expect(lines.some((l) => l.startsWith(`INFO  B ${fn} preflight x-fn-build = ${OLD(fn)}: bug round A is not pasted yet`)), `${fn}\n${out}`).toBe(true);
    expect(lines.some((l) => l.startsWith("INFO  M1 take_delivery_lease_status is not there yet (PGRST202)")), out).toBe(true);
    expect(lines.some((l) => l.startsWith("INFO  M2 no job 'agent-pass-close' among 4 jobs")), out).toBe(true);
    expect(lines.some((l) => l.startsWith("INFO  M3 'scan-cache-and-telemetry-purge' sets no statement_timeout")), out).toBe(true);
    expect(lines.some((l) => l.startsWith("INFO  F the published success page lacks the builder's one-shot seed")), out).toBe(true);
    for (const k of ["S14X-143", "S14X-225"]) expect(lines.some((l) => l.startsWith(`INFO  ${k} owner pending`)), `${k}\n${out}`).toBe(true);
    // The repo lines judge this checkout, which carries the lane.
    expect(lines.filter((l) => /^PASS {2}R\d /.test(l)), out).toHaveLength(4);
  });

  it("a full paste passes every build, the lease, the closer, the purge, the page and the repo lines", () => {
    const { lines, out } = run(after());
    expect(fails(lines), out).toEqual([]);
    expect(lines.filter((l) => l.startsWith("PASS")), out).toHaveLength(FNS.length + 4 + 4);
    expect(lines.some((l) => l.startsWith("PASS  M2 'agent-pass-close' is scheduled (41 3 * * *), active, with statement_timeout 2min in its command, last run succeeded")), out).toBe(true);
  });

  it("a partial paste fails each function left behind, and a missing header fails once others serve the build", () => {
    const { lines, out } = run([
      ...preflights((fn) => (fn === "send-product-email" ? "send-product-email.2026-10-31.1" : fn === "admin-regenerate-delivery" ? null : NEW(fn))),
      lease("locked"), cron([NEW_PURGE, job("agent-pass-close")]), ...site(PUBLISHED),
    ]);
    expect(fails(lines), out).toEqual([
      "FAIL  B admin-regenerate-delivery preflight carries no x-fn-build while others serve 2026-11-12.1 (want admin-regenerate-delivery.2026-11-12.1 or later)",
      "FAIL  B send-product-email preflight x-fn-build = send-product-email.2026-10-31.1 while others serve 2026-11-12.1: a partial paste (want send-product-email.2026-11-12.1 or later)",
    ]);
  });

  it("a later build passes, and another function's build never stands in for this one", () => {
    const { lines, out } = run([
      ...preflights((fn) => (fn === "generate-cover-letter" ? "generate-keyword-fix.2026-11-12.1" : `${fn}.2026-11-14.2`)),
      lease("locked"), cron([NEW_PURGE, job("agent-pass-close")]), ...site(PUBLISHED),
    ]);
    expect(fails(lines), out).toEqual([
      "FAIL  B generate-cover-letter preflight x-fn-build = generate-keyword-fix.2026-11-12.1 while others serve 2026-11-12.1: a partial paste (want generate-cover-letter.2026-11-12.1 or later)",
    ]);
  });

  it("the lease function: missing after the paste, callable by anon, or answering anon with rows each fail", () => {
    const missing = run(swap(after(), LEASE, lease("missing")));
    expect(fails(missing.lines), missing.out).toEqual([expect.stringMatching(/^FAIL {2}M1 take_delivery_lease_status is not there \(PGRST202\) while the lane's functions serve 2026-11-12\.1/)]);
    for (const state of ["callable", "rows"] as const) {
      for (const routes of [swap(after(), LEASE, lease(state)), swap(before(), LEASE, lease(state))]) {
        const r = run(routes);
        expect(fails(r.lines), r.out).toEqual([expect.stringMatching(/^FAIL {2}M1 take_delivery_lease_status (is CALLABLE by anon|answered anon with rows)/)]);
      }
    }
  });

  it("the pass closer: absent after the paste, inactive, untimed or failing each fail, and one that has not run yet passes", () => {
    const cases: Array<[Job[], RegExp]> = [
      [[NEW_PURGE], /^FAIL {2}M2 no job 'agent-pass-close' among 2 jobs while the lane's functions serve 2026-11-12\.1/],
      [[NEW_PURGE, job("agent-pass-close", { ch_active: false })], /^FAIL {2}M2 'agent-pass-close' is listed but not active/],
      [[NEW_PURGE, job("agent-pass-close", { ch_timeout: null })], /^FAIL {2}M2 'agent-pass-close' sets no statement_timeout/],
      [[NEW_PURGE, job("agent-pass-close", { ch_last_status: "failed", ch_failed: 1 })], /^FAIL {2}M2 'agent-pass-close' last run failed/],
    ];
    for (const [jobs, want] of cases) {
      const r = run(swap(after(), CRON_MATCH, cron(jobs)));
      expect(fails(r.lines), r.out).toEqual([expect.stringMatching(want)]);
    }
    const fresh = run(swap(after(), CRON_MATCH, cron([NEW_PURGE, job("agent-pass-close", { ch_runs: 0, ch_last_status: null, ch_last_start: null })])));
    expect(fails(fresh.lines), fresh.out).toEqual([]);
    expect(fresh.lines.some((l) => l.startsWith("PASS  M2 'agent-pass-close' is scheduled")), fresh.out).toBe(true);
    expect(fresh.lines.some((l) => l.startsWith("INFO  M2 'agent-pass-close' has not run in the last 48 hours yet")), fresh.out).toBe(true);
  });

  it("the purge guard fails after the paste when the rewritten job fails, lost its timeout or is gone", () => {
    for (const purge of [job("scan-cache-and-telemetry-purge", { ch_last_status: "failed" }), OLD_PURGE, null]) {
      const r = run(swap(after(), CRON_MATCH, cron([job("agent-pass-close"), ...(purge ? [purge] : [])])));
      expect(fails(r.lines), r.out).toEqual([expect.stringMatching(/^FAIL {2}M3 'scan-cache-and-telemetry-purge' .* after 20261112150000 rewrote its pro_grants clause/)]);
    }
  });

  it("a cron listing that is not a list is a FAIL, not a silent pass", () => {
    const r = run(swap(before(), CRON_MATCH, cron("<html>gateway</html>")));
    expect(fails(r.lines), r.out).toEqual([expect.stringMatching(/^FAIL {2}M2 get_cron_health did not answer a list/)]);
  });

  it("after the paste an unpublished page fails, naming what it lacks, and the rewrite over the scan fails", () => {
    const old = run([...preflights(NEW), lease("locked"), cron([NEW_PURGE, job("agent-pass-close")]), ...site()]);
    expect(fails(old.lines), old.out).toEqual([expect.stringMatching(/^FAIL {2}F the published success page lacks the builder's one-shot seed \(RC-S12-110\); an 'Open in builder' that leaves the scanned résumé alone .* the English past-buyers strings \(with the success page or in the entry\) while the lane's functions serve 2026-11-12\.1/)]);
    const noHindi = run([...preflights(NEW), lease("locked"), cron([NEW_PURGE, job("agent-pass-close")]), ...site({ ...PUBLISHED, shape: SHAPE_NEW.replace(',"आवेदन करने के लिए तैयार"', "") })]);
    expect(fails(noHindi.lines), noHindi.out).toEqual(["FAIL  F the published success page lacks the Spanish and Hindi ready verdicts (RC-S12-113) while the lane's functions serve 2026-11-12.1: the round's frontend publish has not happened"]);
    const both = run([...preflights(NEW), lease("locked"), cron([NEW_PURGE, job("agent-pass-close")]), ...site({ ...PUBLISHED, ps: PS_NEW + PS_OLD })]);
    expect(fails(both.lines), both.out).toEqual([expect.stringContaining("an 'Open in builder' that leaves the scanned résumé alone (RC-S12-110: the rewrite still goes to rb_resume_text)")]);
    const noStrings = run([...preflights(NEW), lease("locked"), cron([NEW_PURGE, job("agent-pass-close")]), ...site({ ...PUBLISHED, pageStrings: false })]);
    expect(fails(noStrings.lines), noStrings.out).toEqual([expect.stringContaining("lacks the English past-buyers strings (with the success page or in the entry) while")]);
    const inEntry = run([...preflights(NEW), lease("locked"), cron([NEW_PURGE, job("agent-pass-close")]), ...site({ ...PUBLISHED, pageStrings: false, entryStrings: true })]);
    expect(fails(inEntry.lines), "a build from before the review, the English strings in the entry: " + inEntry.out).toEqual([]);
  });

  it("a bundle that names no ProductSuccess chunk is a FAIL even before the paste: nothing could be judged", () => {
    const r = run([...preflights(OLD), lease("missing"), cron([OLD_PURGE]), ...site({ noChunk: true })]);
    expect(fails(r.lines), r.out).toEqual([expect.stringMatching(/^FAIL {2}F the served entry \(\/assets\/index-AbC123\.js\) names no ProductSuccess chunk/)]);
  });

  it("each repo line fails when its claim is false, and a fixture where all hold passes", () => {
    const good = run(after(), { repo: fixtureRepo() });
    expect(fails(good.lines), good.out).toEqual([]);
    expect(good.lines.filter((l) => /^PASS {2}R\d /.test(l)), good.out).toHaveLength(4);
    const cases: Array<[(put: (p: string, s: string) => void) => void, RegExp]> = [
      [(put) => put("supabase/functions/generate-cover-letter/index.ts", "export {};\n"), /^FAIL {2}R1 these recovery-form writers do not keep the copy they make: generate-cover-letter/],
      [(put) => put("supabase/functions/admin-regenerate-delivery/index.ts", "Quantify achievements where you can infer reasonable metrics\nrewrittenResumeFigureIssues(a);validateProseClaims(a);stripInventedContact(a);\n"), /^FAIL {2}R2 the owner's re-delivery still asks the model to infer figures/],
      [(put) => put("supabase/functions/admin-regenerate-delivery/index.ts", "rewrittenResumeFigureIssues(a);\n"), /^FAIL {2}R2 the owner's re-delivery does not run the figure and contact checks/],
      [(put) => put("src/lib/ats-parse-simulator.ts", "export const simulator = 2;\n"), /^FAIL {2}R3 supabase\/functions\/generate-ats-defense\/ats-parse-simulator\.ts is missing or differs/],
      [(put) => put("supabase/functions/_shared/paid-session.ts", "// changed\n"), /^FAIL {2}R4 _shared\/paid-session\.ts changed/],
    ];
    for (const [edit, want] of cases) {
      const r = run(after(), { repo: fixtureRepo(edit) });
      expect(fails(r.lines), r.out).toEqual([expect.stringMatching(want)]);
    }
  });

  it("S14X-143 decided A judges the window in the writers, their builds and the published page", () => {
    const WRITERS = ["generate-keyword-fix", "generate-cover-letter", "generate-premium-package", "generate-career-snapshot", "generate-graduate-gameplan", "generate-ats-defense", "generate-career-path", "generate-freelance-boost", "import-freelance-profile"];
    const withWindow = (put: (p: string, s: string) => void) => {
      put("supabase/functions/_shared/past-buyer-window.ts", "export const PAST_BUYER_DAYS = 90;\n");
      for (const f of WRITERS) put(`supabase/functions/${f}/index.ts`, `import { pastBuyerWindowRefusal } from "../_shared/past-buyer-window.ts";\nawait keepPastBuyerCopy(db, {});\n`);
    };
    const decided = { ownerDecided: { "S14X-143": { choice: "A", date: "2026-11-16" } } };
    const none = run(after(), { ...decided, repo: fixtureRepo() });
    expect(fails(none.lines), none.out).toEqual([expect.stringMatching(/^FAIL {2}S14X-143 decided \(A\), but this checkout lacks the window in: _shared\/past-buyer-window\.ts; generate-keyword-fix;/)]);
    const unpublished = run(after(), { ...decided, repo: fixtureRepo(withWindow) });
    expect(fails(unpublished.lines), unpublished.out).toEqual(["FAIL  S14X-143 decided (A), but the published success page never names past_buyer_window_closed while the lane's functions serve 2026-11-12.1"]);
    const shipped = run(swap(after(), "^GET https://site\\.test/assets/ATSParseSimulator-At1\\.js$", { match: "^GET https://site\\.test/assets/ATSParseSimulator-At1\\.js$", body: SHAPE_NEW + `if(c==="past_buyer_window_closed")w();` }), { ...decided, repo: fixtureRepo(withWindow) });
    expect(fails(shipped.lines), shipped.out).toEqual([]);
    expect(shipped.lines.filter((l) => l.startsWith("PASS  S14X-143")), shipped.out).toHaveLength(3);
    const behind = run([...preflights((fn) => (fn === "import-freelance-profile" ? OLD(fn) : NEW(fn))), ...after().slice(FNS.length + OWNER_FNS.length)], { ...decided, repo: fixtureRepo(withWindow) });
    expect(fails(behind.lines), behind.out).toContain("FAIL  S14X-143 import-freelance-profile preflight x-fn-build = import-freelance-profile.2026-11-10.3 while the lane's functions serve 2026-11-12.1 (want 2026-11-12.1 or later: it enforces the window)");
  });

  it("S14X-143 decided B judges the cut sentence and the two checkouts' builds; another answer fails", () => {
    const decided = { ownerDecided: { "S14X-143": "B" } };
    const promised = run(after(), { ...decided, repo: fixtureRepo() });
    expect(fails(promised.lines), promised.out).toEqual(["FAIL  S14X-143 decided (B), but _shared/product-cuts.ts still promises the link for PAST_BUYER_DAYS days in a pastBuyers sentence"]);
    const dropped = fixtureRepo((put) => put("supabase/functions/_shared/product-cuts.ts", "  pastBuyers: \"If you bought it before, your link keeps working.\",\n"));
    const shipped = run(after(), { ...decided, repo: dropped });
    expect(fails(shipped.lines), shipped.out).toEqual([]);
    expect(shipped.lines.filter((l) => l.startsWith("PASS  S14X-143")), shipped.out).toHaveLength(3);
    const behind = run([...preflights((fn) => (fn === "create-scan-pack-checkout" ? "create-scan-pack-checkout.2026-10-27.1" : NEW(fn))), ...after().slice(FNS.length + OWNER_FNS.length)], { ...decided, repo: dropped });
    expect(fails(behind.lines), behind.out).toEqual(["FAIL  S14X-143 create-scan-pack-checkout preflight x-fn-build = create-scan-pack-checkout.2026-10-27.1 while the lane's functions serve 2026-11-12.1 (want 2026-11-12.1 or later: it bundles product-cuts.ts)"]);
    const neither = run(after(), { ownerDecided: { "S14X-143": "C" }, repo: dropped });
    expect(fails(neither.lines), neither.out).toEqual(["FAIL  S14X-143 ownerDecided reads 'C', neither A (enforce) nor B (drop the promise): nothing says what must ship"]);
  });

  it("S14X-225 decided yes: INFO while only round A is live, a FAIL once round B is pasted with a digest job still scheduled, a PASS once both are gone; a 'no' ships nothing", () => {
    const yes = { ownerDecided: { "S14X-225": { choice: "yes: unschedule both", date: "2026-11-16" } } };
    // Round A is live (every lane function at 2026-11-12.1); the yes ships in round B, not pasted yet.
    const roundA = run(after(), yes);
    expect(fails(roundA.lines), roundA.out).toEqual([]);
    expect(roundA.lines, roundA.out).toContain("INFO  S14X-225 decided (yes: unschedule both); get_cron_health still lists send-agent-digest send-agent-digest-morning: round B, which carries 20261112153000, is not pasted yet (send-product-email serves send-product-email.2026-11-12.1; judged once it serves 2026-11-13.1)");
    const early = run(before(), yes);
    expect(fails(early.lines), early.out).toEqual([]);
    expect(early.lines.some((l) => l.startsWith("INFO  S14X-225 decided (yes: unschedule both); get_cron_health still lists") && l.includes("is not pasted yet")), early.out).toBe(true);
    const still = run(afterB(), yes);
    expect(fails(still.lines), still.out).toEqual(["FAIL  S14X-225 decided (yes: unschedule both), but get_cron_health still lists send-agent-digest send-agent-digest-morning while send-product-email serves send-product-email.2026-11-13.1: round B is pasted, so 20261112153000 did not apply"]);
    const one = run(swap(afterB(), CRON_MATCH, cron([NEW_PURGE, job("agent-pass-close"), job("send-agent-digest-morning", { ch_timeout: null })])), yes);
    expect(fails(one.lines), one.out).toEqual([expect.stringMatching(/^FAIL {2}S14X-225 decided \(yes: unschedule both\), but get_cron_health still lists send-agent-digest-morning while/)]);
    for (const routes of [afterB(), after()]) {
      const gone = run(swap(routes, CRON_MATCH, cron([NEW_PURGE, job("agent-pass-close")])), yes);
      expect(fails(gone.lines), gone.out).toEqual([]);
      expect(gone.lines.some((l) => l.startsWith("PASS  S14X-225 decided (yes: unschedule both): neither send-agent-digest nor send-agent-digest-morning is scheduled")), gone.out).toBe(true);
    }
    const no = run(afterB(), { ownerDecided: { "S14X-225": "no" } });
    expect(fails(no.lines), no.out).toEqual([]);
    expect(no.lines.some((l) => l.startsWith("INFO  S14X-225 decided (no): both agent-digest jobs stay")), no.out).toBe(true);
  });

  it("the answers docs/deploy-ledger.json records print no FAIL while only round A is live, and each is judged, never 'owner pending', once round B is", () => {
    const ledger = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8")) as { reservations: Record<string, { ownerDecided?: Record<string, unknown> }> };
    const ownerDecided = ledger.reservations["bug-round"].ownerDecided ?? {};
    expect(ownerDecided["S14X-225"], "the owner's yes of 2026-11-18 is recorded").toMatchObject({ choice: "yes" });
    const roundA = run(after(), { ownerDecided });
    expect(fails(roundA.lines), roundA.out).toEqual([]);
    expect(roundA.lines.some((l) => l.startsWith("INFO  S14X-225 owner pending")), roundA.out).toBe(false);
    const roundB = run(afterB(), { ownerDecided });
    expect(fails(roundB.lines), roundB.out).toContain("FAIL  S14X-225 decided (yes), but get_cron_health still lists send-agent-digest send-agent-digest-morning while send-product-email serves send-product-email.2026-11-13.1: round B is pasted, so 20261112153000 did not apply");
  });

  it("every call is an OPTIONS or a GET with no body, and the key is never printed", () => {
    for (const [routes, opts] of [[before(), {}], [after(), { ownerDecided: { "S14X-143": "A", "S14X-225": "yes" } }], [after(), { ownerDecided: { "S14X-143": "B" } }]] as const) {
      const { calls, out } = run([...routes], opts);
      expect(calls.length).toBeGreaterThan(10);
      for (const c of calls) {
        expect(c, c).toMatch(/^curl\t(OPTIONS|GET) https:\/\//);
        expect(c.split("\t")).toHaveLength(2);
      }
      expect(out).not.toContain(KEY);
    }
  });
});
