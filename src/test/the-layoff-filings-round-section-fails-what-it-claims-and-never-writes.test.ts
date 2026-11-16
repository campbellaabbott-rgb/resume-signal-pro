// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz-bugs-layoff-filings CAN FAIL EVERY CLAIM IT MAKES,
 * PRINTS NOTHING BUT INFO BEFORE THE PASTE, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-layoff-filings.sh is the post-deploy
 * proof of bug round A's layoff-filings lane. A PASS is worth something only if
 * a regression could have turned it into a FAIL (verify-deploy.d/README.md), so
 * the section runs here against a fake curl that answers from routes and logs
 * every call:
 *   - a good deploy prints PASS for every claim, one line each;
 *   - production as it answered on 2026-11-16 (build 2026-10-26.1, parser v2,
 *     neither migration, no Iowa notice, Alaska listed twice, the ledger tokens
 *     lit, the old chip and read stamp) prints no FAIL at all;
 *   - each claim FAILs on its own regression once this round's build serves;
 *   - a line whose clock has not run (no nightly chain of this build yet) is
 *     INFO, not FAIL;
 *   - the key is never printed, and every call is a GET except the two public
 *     readers' anon reads.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-layoff-filings.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const R_HELPER = /^R\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_layoff_round";

type Route = { match: string; status?: number; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,data=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(x==="-A")i++;else if(["-m","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\theaders:"+hs.join("|")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const key=method+" "+url+(data!==null?"\\t"+data:"");
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)process.stdout.write(body);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdlf-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n${R_HELPER}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 110_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

const DENIED = (what: string) => JSON.stringify({ code: "42501", message: `permission denied for ${what}` });
const PAD = "x".repeat(25_000);
const NEW_STRINGS = `${PAD} "readVia":"from {{sourceName}} via Big Local News, read {{readAgo}}","lcaChip":"Filed LCA wages (H-1B, H-1B1, E-3) · {{quarter}}"`;
const OLD_STRINGS = `${PAD} "layoffRead":"read from {{sourceName}} {{readAgo}}","lcaChip":"Filed H-1B wages · {{quarter}}"`;
const ia = (basis = "our_first_fetch") => [{ la_state: "IA", la_event_date: "2026-10-09", la_workers: 51, la_public_basis: basis, la_public_date: "2026-11-17", la_total_n: 1 }];
const lca = (token: string, lit = false) => ({ ow_company_token: token, ow_soc_code: lit ? "15-1252" : null, ow_worksite_state: lit ? "WA" : null, ow_employer_filings_n: lit ? 66 : null });

type Over = {
  get?: string; version?: string; parser?: string; warnBuild?: string | null; audit?: Record<string, unknown> | null;
  m1?: string; m4?: string; ia?: unknown[]; ak?: unknown[]; wd?: unknown[];
  ledgerLit?: string[]; twinsLit?: boolean; hisense?: boolean; sigmaLit?: boolean; strings?: string; home?: string;
  /** Where the English strings ride: the board's chunk (this round's build), the entry (an older build), or only the whole-file safety net. */
  where?: "jobs" | "entry" | "all-only";
};
function routes(o: Over = {}): Route[] {
  const get = o.get ?? JSON.stringify({
    ok: true, function: "layoff-filings", version: o.version ?? "2026-11-12.1", parser: o.parser ?? "parse205_v3_ts",
    runs: {
      warnDone: o.warnBuild === null ? null : { at: "2026-11-17T03:52:00Z", build: o.warnBuild ?? "2026-11-12.1" },
      audit: o.audit === null ? null : (o.audit ?? { at: "2026-11-17T05:17:00Z", build: "2026-11-12.1", reread: 10, rereadReplaced: 3 }),
    },
  });
  const where = o.where ?? "jobs";
  const strings = o.strings ?? NEW_STRINGS;
  const ledger = ["socialfinance", "sigmasoftware2", "sunday", "echo", "lockwood", "roadrunner"].map((t) => lca(t, (o.ledgerLit ?? []).includes(t)));
  return [
    { match: "^GET https://p\\.supabase\\.co/functions/v1/layoff-filings$", body: get },
    { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/layoff_warn_retire_unseen\\?", body: o.m4 ?? DENIED("function layoff_warn_retire_unseen") },
    { match: "^GET https://p\\.supabase\\.co/rest/v1/lca_refused_tokens\\?", body: o.m1 ?? DENIED("table lca_refused_tokens") },
    { match: "^POST https://p\\.supabase\\.co/rest/v1/rpc/get_employer_layoff_filings_all\t.*82c90207", body: JSON.stringify(o.ia ?? ia()) },
    { match: "^POST https://p\\.supabase\\.co/rest/v1/rpc/get_employer_layoff_filings_all\t.*alaskaair", body: JSON.stringify(o.ak ?? [{ la_site: "Seattle, Spokane, Renton", la_total_n: 1 }]) },
    { match: "^POST https://p\\.supabase\\.co/rest/v1/rpc/get_employer_layoff_filings_all\t.*Workday", body: JSON.stringify(o.wd ?? [{ la_event_date: "2026-09-29", la_pct: 2.5 }]) },
    { match: "^POST https://p\\.supabase\\.co/rest/v1/rpc/get_employer_lca_wages\t.*socialfinance", body: JSON.stringify(ledger) },
    { match: "^POST https://p\\.supabase\\.co/rest/v1/rpc/get_employer_lca_wages\t.*ebb9e98a", body: JSON.stringify([lca("ebb9e98a-78f1-47eb-a562-c52b36b09dd3", !!o.twinsLit), lca("32d78507-2175-47fb-8427-a89a691203be")]) },
    { match: "^POST https://p\\.supabase\\.co/rest/v1/rpc/get_employer_lca_wages\t.*hisense", body: JSON.stringify([{ ...lca("hisenseusacorporation", o.hisense ?? true), ow_worksite_state: "GA" }, lca("sigmasoftware2", !!o.sigmaLit)]) },
    { match: "^GET https://site\\.test/$", body: o.home ?? '<html><script src="/assets/index-AbC123.js"></script></html>' },
    { match: "^GET https://site\\.test/assets/index-AbC123\\.js$", body: `const J=()=>import("./Jobs-Jb1.js"); import("./rb-en_ns_jobsPage-Zz9.js"); const A=()=>import("./rb-en_all-Al1.js"); ${PAD} ${where === "entry" ? strings : ""}` },
    { match: "^GET https://site\\.test/assets/Jobs-Jb1\\.js$", body: `import"./rb-en_ns_jobsPage-Zz9.js"; const Jobs=()=>null; ${where === "jobs" ? strings : ""}` },
    { match: "^GET https://site\\.test/assets/rb-en_ns_jobsPage-Zz9\\.js$", body: "addEnglish({jobsPage:{}})" },
    { match: "^GET https://site\\.test/assets/rb-en_all-Al1\\.js$", body: `export default {${strings}}` },
  ];
}
const verdicts = (lines: string[]) => lines.filter((l) => /^(PASS|FAIL|INFO) /.test(l));
const line = (lines: string[], id: string) => lines.find((l) => new RegExp(`^(PASS|FAIL|INFO)  ${id} `).test(l)) ?? `(no ${id} line)`;
const IDS = ["B0", "M1", "M4", "S14X-149", "S14X-278", "S14X-158", "S14X-151", "S14X-036", "S14X-069", "S14X-150", "S14X-067", "S14X-068", "RC-OI-21", "S14X-184", "S14X-279"];

describe("a good deploy", () => {
  it("prints PASS for every claim, one line each, and nothing else", () => {
    const { lines } = run(routes());
    for (const id of IDS) expect(line(lines, id), id).toMatch(/^PASS /);
    expect(verdicts(lines).length).toBe(IDS.length);
    expect(lines.filter((l) => !/^(PASS|FAIL|INFO) /.test(l) && !l.startsWith("== "))).toEqual([]);
  });
});

describe("where the English strings ride (the entry carries no page's shard strings)", () => {
  it("an older build that carried them in the entry still PASSes", () => {
    const { lines } = run(routes({ where: "entry" }));
    expect(line(lines, "S14X-184")).toMatch(/^PASS /);
    expect(line(lines, "S14X-279")).toMatch(/^PASS /);
  });
  it("the board chunk carrying them PASSes and names the chunk", () => {
    const { lines } = run(routes());
    expect(line(lines, "S14X-184")).toMatch(/^PASS .*Jobs-Jb1\.js/);
  });
  it("strings found only in the whole-file safety net prove nothing about the board: FAIL", () => {
    const { lines } = run(routes({ where: "all-only" }));
    expect(line(lines, "S14X-184")).toMatch(/^FAIL /);
    expect(line(lines, "S14X-279")).toMatch(/^FAIL /);
  });
});

describe("before the paste", () => {
  it("production as it answered on 2026-11-16 prints no FAIL", () => {
    const { lines } = run(routes({
      version: "2026-10-26.1", parser: "parse205_v2_ts", warnBuild: "2026-10-26.1", audit: null,
      get: JSON.stringify({ ok: true, function: "layoff-filings", version: "2026-10-26.1", parser: "parse205_v2_ts" }),
      m1: JSON.stringify({ code: "PGRST205", message: "Could not find the table" }), m4: JSON.stringify({ code: "PGRST202", message: "Could not find the function" }),
      ia: [], ak: [{ la_site: "Seattle, Spokane, Renton", la_total_n: 2 }, { la_site: "SeaTac", la_total_n: 2 }], wd: [{ la_event_date: "2026-09-29", la_pct: null }],
      ledgerLit: ["socialfinance", "sigmasoftware2", "sunday"], twinsLit: true, hisense: false, sigmaLit: true, strings: OLD_STRINGS,
    }));
    expect(lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
    for (const id of IDS) expect(line(lines, id), id).toMatch(/^INFO /);
  });
});

describe("each claim can FAIL once this round's build serves", () => {
  const cases: Array<[string, Over, string]> = [
    ["B0", { get: "<html>502 Bad Gateway</html>" }, "B0"],
    ["the parser stayed v2", { parser: "parse205_v2_ts" }, "S14X-149"],
    ["the audit of this build re-read nothing", { audit: { at: "2026-11-17T05:17:00Z", build: "2026-11-12.1", reread: null, rereadReplaced: null } }, "S14X-278"],
    ["a nightly chain ran and the Iowa notice is missing", { ia: [] }, "S14X-036"],
    ["the Iowa notice is labelled the state's stamp", { ia: ia("state_received") }, "S14X-036"],
    ["Alaska is listed twice with the retire applied", { ak: [{ la_site: "Seattle, Spokane, Renton", la_total_n: 2 }, { la_site: "SeaTac", la_total_n: 2 }] }, "S14X-069"],
    ["Workday reads a wrong percentage", { wd: [{ la_event_date: "2026-09-29", la_pct: 3 }] }, "S14X-150"],
    ["a ledger token still answers", { ledgerLit: ["socialfinance"] }, "S14X-067"],
    ["a twin still answers", { twinsLit: true }, "S14X-068"],
    ["Hisense answers no cell", { hisense: false }, "RC-OI-21"],
    ["sigmasoftware2 answers again", { sigmaLit: true }, "RC-OI-21"],
    ["the old chip is served", { strings: OLD_STRINGS }, "S14X-184"],
    ["the old read stamp is served", { strings: OLD_STRINGS }, "S14X-279"],
    ["the ledger table is readable by anon", { m1: "[]" }, "M1"],
    ["the build serves without its migration", { m4: JSON.stringify({ code: "PGRST202", message: "x" }) }, "M4"],
  ];
  for (const [name, over, id] of cases) {
    it(`${id}: ${name}`, () => {
      const { lines } = run(routes(over));
      expect(line(lines, id)).toMatch(/^FAIL /);
    });
  }
  it("the build serving without 20261112182000 fails the Iowa line too: first-read states are held", () => {
    const { lines } = run(routes({ ia: [], m4: JSON.stringify({ code: "PGRST202", message: "x" }) }));
    expect(line(lines, "S14X-036")).toMatch(/^FAIL .*held/);
  });
});

describe("a clock that has not run is INFO", () => {
  it("no complete nightly chain of this build: the missing Iowa notice is INFO", () => {
    const { lines } = run(routes({ ia: [], warnBuild: "2026-10-26.1" }));
    expect(line(lines, "S14X-036")).toMatch(/^INFO .*no complete nightly chain/);
  });
  it("Workday not yet re-read is INFO, and no audit of this build yet is INFO", () => {
    const { lines } = run(routes({ wd: [{ la_event_date: "2026-09-29", la_pct: null }], audit: { at: "2026-11-16T05:17:00Z", build: "2026-10-26.1", reread: null } }));
    expect(line(lines, "S14X-150")).toMatch(/^INFO /);
    expect(line(lines, "S14X-278")).toMatch(/^INFO /);
  });
});

describe("it never writes", () => {
  it("every call is a GET but the public readers' anon reads; the key is never printed", () => {
    const { calls, out } = run(routes());
    expect(out).not.toContain(KEY);
    for (const c of calls) {
      const [, req] = c.split("\t");
      if (req.startsWith("GET ")) continue;
      expect(req, c).toMatch(/^POST https:\/\/p\.supabase\.co\/rest\/v1\/rpc\/get_employer_(layoff_filings_all|lca_wages)$/);
    }
    expect(calls.some((c) => /job-board/.test(c))).toBe(false);
    // The retire is asked on its no-op path: p_from after p_to.
    expect(calls.find((c) => /layoff_warn_retire_unseen/.test(c))).toMatch(/p_from=2026-01-02&p_to=2026-01-01/);
  });
});
