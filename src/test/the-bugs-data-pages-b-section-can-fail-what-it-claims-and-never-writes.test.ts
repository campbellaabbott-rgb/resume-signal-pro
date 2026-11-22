// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz-bugs-data-pages-b CAN FAIL WHAT IT CLAIMS, NEVER
 * FAILS ON TODAY'S PRODUCTION, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-data-pages-b.sh judges part B's
 * data-pages-b lane: the closure rollup's suspect column through a PostgREST
 * column probe, the field curve's refusal through a POST whose argument
 * cannot cast (CW2-SC5, side branch bugs/b-data-pages-census), the company
 * page's markers in the entry and the Jobs chunks, and the German Austria
 * page's bake. Run here against a fake curl and a drizzle directory of the
 * test's own:
 *   - production as it is today (42703, a curve anon reaches, the old chunks,
 *     the old bake, no drizzle stub) prints no FAIL and says nothing is live;
 *   - a good deploy prints PASS for every claim;
 *   - each regression after the deploy prints FAIL, and an open rollup is a
 *     FAIL at any stage;
 *   - every request is a GET but the one POST, whose day count cannot cast,
 *     and the key is never printed;
 *   - the markers it reads are the ones the code and the shard carry.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-data-pages-b.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_bdpb";
const P = "https://p\\.supabase\\.co";
const S = "https://site\\.test";
const MIGRATION = "20261113100000_a_pruned_takedown_is_counted_in_the_column_its_mark_names.sql";
const CURVE_MIGRATION = "20261113101000_a_field_curve_no_page_calls_answers_only_the_service_role.sql";

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
const key=method+" "+url;
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[], stubs: string | string[] | null = null): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbdpb-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "drizzle"));
  writeFileSync(join(dir, "drizzle", "0226_stop_unused_recency_ladder.sql"), "SELECT 1;\n");
  (stubs === null ? [] : Array.isArray(stubs) ? stubs : [stubs]).forEach((stub, i) =>
    writeFileSync(join(dir, "drizzle", stub.endsWith(".sql") ? stub : `024${i}_stub.sql`), stub.endsWith(".sql") ? "SELECT 1;\n" : stub));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VDDPB_DRIZZLE: join(dir, "drizzle"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

// The English strings the entry carries, as the company shard states them.
const EN = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/shards/company/en.json"), "utf8")).companyProfile;
const LABEL = EN.facts.countriesLabelPooled as string;
const HEADING = EN.h1SystemBoard as string;

// Production today (2026-11-17), cut to its tells, and this branch's build.
const OLD = {
  entry: '"assets/Jobs-J1.js";countriesLabel:"Most roles in"',
  jobs: 'import{a as x}from"./CompanyLander-C1.js";t("companyProfile.h1Generic")',
  lander: 't("companyProfile.facts.countriesLabel");t("companyProfile.pay.floor")',
  at: '<li>Tabellarischer Lebenslauf nach deutschem Muster</li><li>Zeugnisse werden erwartet</li>',
};
const NEW = {
  entry: `"assets/Jobs-J1.js";countriesLabel:"Most roles in",countriesLabelPooled:${JSON.stringify(LABEL)},h1SystemBoard:${JSON.stringify(HEADING)}`,
  jobs: 'import{a as x}from"./CompanyLander-C1.js";t("companyProfile.h1Generic")',
  lander: 't("companyProfile.facts.countriesLabelPooled");t("companyProfile.pay.floorPooled",n);t("companyProfile.h1SystemBoard");t("companyProfile.h1ThisBoard");t("companyProfile.actions.moreThis");t("companyProfile.employerChipOneBoard");"data-employer-chip-board"',
  at: "<li>Tabellarischer Lebenslauf nach deutschem Muster</li><li>Akademische Titel (Mag., Dipl.-Ing.) zählen mehr als in Deutschland</li>",
};
const ROLL_OLD = { status: 400, body: JSON.stringify({ code: "42703", message: "column job_board_closure_rollup.suspect_n does not exist" }) };
const ROLL_NEW = { status: 401, body: JSON.stringify({ code: "42501", message: "permission denied for table job_board_closure_rollup" }) };
// The field curve as production answered the probe on 2026-11-17, and as a
// closed function answers it.
const CURVE_OLD = { status: 400, body: JSON.stringify({ code: "22P02", message: "invalid input syntax for type integer: \"x\"" }) };
const CURVE_NEW = { status: 401, body: JSON.stringify({ code: "42501", message: "permission denied for function get_category_fill_curve" }) };

type Over = Partial<{ entry: string; jobs: string; lander: string; at: string; roll: { status?: number; body?: string }; curve: { status?: number; body?: string } }>;
function routes(deployed: boolean, o: Over = {}): Route[] {
  const v = { ...(deployed ? NEW : OLD), ...o };
  return [
    { match: `^GET ${S}/$`, body: '<html><head><script type="module" src="/assets/index-A1.js"></script></head></html>' },
    { match: `^GET ${S}/assets/index-A1\\.js$`, body: v.entry },
    { match: `^GET ${S}/assets/Jobs-J1\\.js$`, body: v.jobs },
    { match: `^GET ${S}/assets/CompanyLander-C1\\.js$`, body: v.lander },
    { match: `^GET ${S}/de/lebenslauf-standards/oesterreich$`, body: `<html><body><ul>${v.at}</ul></body></html>` },
    { match: `^GET ${P}/rest/v1/job_board_closure_rollup\\?select=suspect_n&limit=0$`, ...(o.roll ?? (deployed ? ROLL_NEW : ROLL_OLD)) },
    { match: `^POST ${P}/rest/v1/rpc/get_category_fill_curve$`, ...(o.curve ?? (deployed ? CURVE_NEW : CURVE_OLD)) },
  ];
}
const APPLIED = [`0240_${MIGRATION}`, `0241_${CURVE_MIGRATION}`];

const has = (lines: string[], verdict: string, re: RegExp) => lines.some((l) => l.startsWith(verdict) && re.test(l));
const show = (lines: string[]) => lines.join("\n");
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const CLAIMS = ["D1", "D2", "F1", "F2", "F3", "B1"];

describe("on production as it is today", () => {
  const { lines, calls, out } = run(routes(false));
  it("prints no FAIL, and the stages say nothing is live", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.some((l) => /stages: database pending.*frontend not published/.test(l)), show(lines)).toBe(true);
    expect(has(lines, "INFO", /^INFO  D1 S14X-159 job_board_closure_rollup has no suspect_n \(42703\) -- the migration has not applied yet/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /^INFO  D2 CW2-SC5 the publishable key still reaches get_category_fill_curve \(22P02 .*-- the migration has not applied yet/), show(lines)).toBe(true);
  });
  it("prints a line for every claim, and every line is a verdict", () => {
    for (const c of [...CLAIMS, "I1"]) expect(lines.some((l) => new RegExp(`^(PASS|FAIL|INFO)  ${c} `).test(l)), `${c}\n${show(lines)}`).toBe(true);
    for (const l of lines.slice(1)) expect(l, show(lines)).toMatch(/^(PASS|FAIL|INFO)  /);
  });
  it("asks with GET but for one POST to the curve, whose day count cannot cast, and never prints the key", () => {
    expect(calls.length).toBeGreaterThanOrEqual(7);
    const posts = calls.filter((c) => !/^curl\tGET /.test(c));
    expect(posts, posts.join("\n")).toHaveLength(1);
    const [, target, data] = posts[0].split("\t");
    expect(target).toBe("POST https://p.supabase.co/rest/v1/rpc/get_category_fill_curve");
    const args = JSON.parse(data) as { p_days: unknown };
    expect(typeof args.p_days, "a day count that casts would run the curve while it is open").toBe("string");
    expect(Number.isNaN(Number(args.p_days))).toBe(true);
    expect(out).not.toContain(KEY);
  });
});

describe("after a good deploy", () => {
  it("passes every claim, with the migration named by a drizzle stub or by a stub's text", () => {
    for (const stub of [APPLIED, [MIGRATION, CURVE_MIGRATION].map((m) => `UPDATE _mig_stage SET done = true WHERE name = '${m.replace(".sql", "")}';`)]) {
      const { lines } = run(routes(true), stub);
      expect(fails(lines), show(lines)).toEqual([]);
      for (const c of CLAIMS) expect(has(lines, "PASS", new RegExp(`^PASS  ${c} `)), `${c}\n${show(lines)}`).toBe(true);
      expect(lines.some((l) => /stages: database applied.*field curve applied.*frontend published/.test(l)), show(lines)).toBe(true);
    }
  });
  it("a stub Lovable titled its own way counts when it holds the file's SQL, comments and spacing aside", () => {
    const sql = readFileSync(resolve(ROOT, "supabase/migrations", MIGRATION), "utf8").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n  ");
    const { lines } = run(routes(true, { roll: ROLL_OLD }), sql.replace(/^/, "-- lovable 0240\n"));
    expect(has(lines, "FAIL", /^FAIL  D1 S14X-159 .*although the migration applied/), show(lines)).toBe(true);
    const other = run(routes(true, { roll: ROLL_OLD }), "SELECT 1;\n").lines;
    expect(has(other, "INFO", /^INFO  D1 S14X-159 .*has not applied yet/), show(other)).toBe(true);
    const curveSql = readFileSync(resolve(ROOT, "supabase/migrations", CURVE_MIGRATION), "utf8").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n  ");
    const curve = run(routes(true, { curve: CURVE_OLD }), curveSql.replace(/^/, "-- lovable 0241\n")).lines;
    expect(has(curve, "FAIL", /^FAIL  D2 CW2-SC5 .*although the migration applied/), show(curve)).toBe(true);
  });
  it("each migration is staged on its own: the rollup's stub does not stage the curve", () => {
    const { lines } = run(routes(true, { curve: CURVE_OLD }), `0240_${MIGRATION}`);
    expect(has(lines, "INFO", /^INFO  D2 CW2-SC5 .*has not applied yet/), show(lines)).toBe(true);
    expect(fails(lines), show(lines)).toEqual([]);
  });
  it("a new stamp from the integrator still counts: the stub is matched by the file's name", () => {
    const { lines } = run(routes(true, { roll: ROLL_OLD }), "0241_20261117120000_a_pruned_takedown_is_counted_in_the_column_its_mark_names.sql");
    expect(has(lines, "FAIL", /^FAIL  D1 S14X-159 .*although the migration applied/), show(lines)).toBe(true);
  });
});

describe("each regression after the deploy is a FAIL", () => {
  const cases: Array<[string, Over]> = [
    ["D1", { roll: ROLL_OLD }],
    ["D1", { roll: { status: 200, body: "[]" } }],
    ["D1", { roll: { status: 502, body: "<html>bad gateway</html>" } }],
    ["D2", { curve: CURVE_OLD }],
    ["D2", { curve: { status: 200, body: "[]" } }],
    ["D2", { curve: { status: 404, body: JSON.stringify({ code: "PGRST202", message: "Could not find the function public.get_category_fill_curve(p_days, p_min_n)" }) } }],
    ["D2", { curve: { status: 502, body: "<html>bad gateway</html>" } }],
    ["F1", { lander: NEW.lander.replace('t("companyProfile.pay.floorPooled",n);', "") }],
    ["F1", { entry: NEW.entry.replace(LABEL, "Most roles in") }],
    ["F2", { lander: NEW.lander.replace('t("companyProfile.actions.moreThis");', "") }],
    ["F2", { entry: NEW.entry.replace(HEADING, "Roles on the board") }],
    ["F3", { lander: NEW.lander.replace(';"data-employer-chip-board"', "") }],
    ["B1", { at: OLD.at }],
    ["B1", { at: NEW.at + "<li>Zeugnisse werden erwartet</li>" }],
  ];
  for (const [claim, over] of cases) {
    it(`${claim} ${JSON.stringify(over).slice(0, 70)}`, () => {
      const { lines } = run(routes(true, over), APPLIED);
      expect(has(lines, "FAIL", new RegExp(`^FAIL  ${claim} `)), `${claim}\n${show(lines)}`).toBe(true);
    });
  }
  it("an anon-readable rollup is a FAIL before the migration too", () => {
    const { lines } = run(routes(false, { roll: { status: 200, body: "[]" } }));
    expect(has(lines, "FAIL", /^FAIL  D1 S14X-159 anon READ job_board_closure_rollup/), show(lines)).toBe(true);
  });
});

describe("the markers it reads are the ones the build carries", () => {
  const code = (p: string) => codeOf(readFileSync(resolve(ROOT, p), "utf8"));
  const COMPONENTS = ["src/components/jobs/company/CompanyHeader.tsx", "src/components/jobs/company/PaySummary.tsx"].map(code).join("\n");
  it("each key and attribute the section names is in the components' code, not a comment", () => {
    for (const m of ["companyProfile.facts.countriesLabelPooled", "companyProfile.pay.floorPooled", "companyProfile.h1SystemBoard", "companyProfile.h1ThisBoard", "companyProfile.actions.moreThis", "companyProfile.employerChipOneBoard", "data-employer-chip-board"]) {
      expect(SECTION, m).toContain(`"${m}"`);
      expect(COMPONENTS, m).toContain(m);
    }
  });
  it("the English label and heading it looks for are the shard's own", () => {
    expect(SECTION).toContain(`"${LABEL}"`);
    expect(SECTION).toContain(`"${HEADING}"`);
  });
  it("the drizzle names it waits for are the migrations' own files", () => {
    for (const m of [MIGRATION, CURVE_MIGRATION]) {
      expect(readFileSync(resolve(ROOT, "supabase/migrations", m), "utf8").length).toBeGreaterThan(0);
      expect(SECTION).toContain(`"${m.replace(/^\d{14}_/, "").replace(/\.sql$/, "")}"`);
    }
  });
});
