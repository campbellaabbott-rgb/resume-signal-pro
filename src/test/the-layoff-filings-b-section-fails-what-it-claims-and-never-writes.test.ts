// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz-bugs-layoff-filings-b CAN FAIL EVERY CLAIM IT
 * MAKES, PRINTS NOTHING BUT INFO BEFORE THE PASTE, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-layoff-filings-b.sh is the
 * post-deploy proof of S14X-185 (an Illinois notice printed a bare street as
 * its site). A PASS is worth something only if a regression could have turned
 * it into a FAIL (verify-deploy.d/README.md), so the section runs here against
 * a fake curl that answers from routes and logs every call, and a drizzle
 * folder the test writes:
 *   - a good deploy prints PASS for both claims;
 *   - production as it answered on 2026-11-17 (no helper, no stub, no
 *     Illinois row in the window) prints no FAIL, and a bare street before the
 *     paste is INFO;
 *   - each claim FAILs on its own regression once the migration is applied,
 *     whether the stub or the helper says so;
 *   - a row the state's file no longer holds is not judged;
 *   - the key is never printed, every call is a GET but the two public readers'
 *     anon reads, and the state's file is fetched only when an Illinois row is
 *     printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-layoff-filings-b.sh"), "utf8");
const R_HELPER = /^R\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_layoff_b";
const MIGRATION = readdirSync(resolve(ROOT, "supabase/migrations")).find((f) => f.endsWith("_a_state_notice_names_the_town_its_street_is_in.sql")) ?? "";

type Route = { match: string; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",o=null,data=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-o")o=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(x==="-A")i++;else if(["-m","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\theaders:"+hs.join("|")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const key=method+" "+url+(data!==null?"\\t"+data:"");
const r=routes.find((x)=>new RegExp(x.match).test(key))||{body:""};
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)process.stdout.write(body);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

type Stub = "none" | "by-name" | "by-text";
function run(routes: Route[], stub: Stub = "none", env: Record<string, string> = {}): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdlfb-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "drizzle"));
  writeFileSync(join(dir, "drizzle", "0230_some_other_migration.sql"), "SELECT 1;\n");
  if (stub === "by-name") writeFileSync(join(dir, "drizzle", "0231_stage.sql"), `SELECT public._mig_exec((SELECT sql FROM public._mig_stage WHERE name = '${MIGRATION.replace(/\.sql$/, "")}'));\n`);
  if (stub === "by-text") writeFileSync(join(dir, "drizzle", "0231_town_beside_street.sql"), readFileSync(resolve(ROOT, "supabase/migrations", MIGRATION), "utf8").replace(/^--.*$/gm, "-- retyped"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${R_HELPER}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const out = (() => {
    try {
      return execFileSync("bash", [join(dir, "run.sh")], {
        cwd: ROOT, encoding: "utf8", timeout: 110_000, stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
          VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VDLFB_DRIZZLE: join(dir, "drizzle"), ...env,
        },
      });
    } catch (e) { return String((e as { stdout?: string }).stdout ?? ""); }
  })();
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

const DENIED = JSON.stringify({ code: "42501", message: "permission denied for function layoff_site_text" });
const MISSING = JSON.stringify({ code: "PGRST202", message: "Could not find the function public.layoff_site_text(p_city, p_site) in the schema cache" });
const HEADER = "Location Name,Doing Business As Name,Location Address,Location City,Location State,WARN Notice,Expected Layoff,Revised Layoff,Initial Date Reported,Notification Date(s)";
const CSV = [
  HEADER,
  `"Tyson Foods, Inc.","Tyson Warehousing Services, LLC",28424 38TH Ave. North ,Hillsdale,IL,True,2495,2495,2026-08-13 00:00:00,8/13/2026`,
  `"Medline Industries, LP",,3 Lakes Dr. ,Northfield,IL,True,304,304,2026-10-30 00:00:00,"11/4/2026, 10/30/2026"`,
  `Rock Island Works,,Rock Island Arsenal,Rock Island,IL,True,80,,2026-10-01 00:00:00,10/1/2026`,
].join("\n");
type Card = { lf_company_token: string; lf_source: string | null; lf_state?: string | null; lf_filer?: string | null; lf_event_date?: string | null; lf_workers?: number | null; lf_site?: string | null; lf_more_n: number };
const il = (token: string, filer: string, date: string, workers: number, site: string, more = 0): Card =>
  ({ lf_company_token: token, lf_source: "state_warn", lf_state: "IL", lf_filer: filer, lf_event_date: date, lf_workers: workers, lf_site: site, lf_more_n: more });
const none = (token: string): Card => ({ lf_company_token: token, lf_source: null, lf_state: null, lf_site: null, lf_more_n: 0 });
const GOOD_CARDS: Card[] = [
  il("medline~wd5~Medline", "Medline Industries, LP", "2026-10-30", 304, "3 Lakes Dr., Northfield"),
  il("riw", "Rock Island Works", "2026-10-01", 80, "Rock Island Arsenal"),
  { lf_company_token: "bdx", lf_source: "state_warn", lf_state: "CA", lf_filer: "BD", lf_event_date: "2026-09-24", lf_workers: 85, lf_site: "3750 Torrey View Court San Diego CA 92130", lf_more_n: 0 },
  none("dominos"),
];
const asList = (c: Card[]) => c.filter((x) => x.lf_source).map((x) => ({
  la_company_token: x.lf_company_token, la_source: x.lf_source, la_state: x.lf_state, la_filer: x.lf_filer,
  la_event_date: x.lf_event_date, la_workers: x.lf_workers, la_site: x.lf_site, la_total_n: 1,
}));

type Over = { m1?: string; cards?: Card[] | string; list?: unknown[] | string; csv?: string };
function routes(o: Over = {}): Route[] {
  const cards = o.cards ?? GOOD_CARDS;
  return [
    { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/layoff_site_text\\?p_site=", body: o.m1 ?? DENIED },
    { match: "^POST https://p\\.supabase\\.co/rest/v1/rpc/get_employer_layoff_filings\t", body: typeof cards === "string" ? cards : JSON.stringify(cards) },
    { match: "^POST https://p\\.supabase\\.co/rest/v1/rpc/get_employer_layoff_filings_all\t", body: typeof o.list === "string" ? o.list : JSON.stringify(o.list ?? []) },
    { match: "^GET https://raw\\.githubusercontent\\.com/biglocalnews/warn-github-flow/transformer/data/warn-transformer/raw/il\\.csv$", body: o.csv ?? CSV },
  ];
}
const verdicts = (lines: string[]) => lines.filter((l) => /^(PASS|FAIL|INFO) /.test(l));
const line = (lines: string[], id: string) => lines.find((l) => new RegExp(`^(PASS|FAIL|INFO)  ${id} `).test(l)) ?? `(no ${id} line)`;
const TODAY: Over = { m1: MISSING, cards: [none("tysonfoods~wd5~TSN"), none("medline~wd5~Medline"), GOOD_CARDS[2]] };

describe("a good deploy", () => {
  it("prints PASS for both claims, one line each, and only the stage as INFO", () => {
    expect(MIGRATION, "the lane's migration is not in supabase/migrations").not.toBe("");
    const { lines } = run(routes(), "by-name");
    expect(line(lines, "M1")).toMatch(/^PASS /);
    expect(line(lines, "S14X-185")).toMatch(/^PASS .*2 Illinois notice\(s\) print the street with its town/);
    expect(verdicts(lines).filter((l) => l.startsWith("INFO"))).toEqual([expect.stringMatching(/^INFO  stage: database applied/)]);
    expect(lines.filter((l) => !/^(PASS|FAIL|INFO) /.test(l) && !l.startsWith("== "))).toEqual([]);
  });
  it("the helper answering is enough to call the migration applied, with no stub yet", () => {
    const { lines } = run(routes());
    expect(line(lines, "M1")).toMatch(/^PASS /);
    expect(lines[1]).toMatch(/^INFO  stage: database applied \(its helper answers\)/);
  });
  it("an Illinois row seen only on the employer page is judged too", () => {
    const { lines } = run(routes({
      cards: [{ ...GOOD_CARDS[2], lf_company_token: "tysonfoods~wd5~TSN", lf_more_n: 1 }],
      list: asList([il("tysonfoods~wd5~TSN", "Tyson Foods, Inc.", "2026-08-13", 2495, "28424 38TH Ave. North, Hillsdale")]),
    }));
    expect(line(lines, "S14X-185")).toMatch(/^PASS .*tysonfoods~wd5~TSN 2026-08-13 .*Hillsdale/);
  });
});

describe("before the paste", () => {
  it("production as it answered on 2026-11-17 prints no FAIL", () => {
    const { lines } = run(routes(TODAY));
    expect(lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
    expect(line(lines, "M1")).toMatch(/^INFO .*not in the database \(before this part is pasted\)/);
    expect(line(lines, "S14X-185")).toMatch(/^INFO  S14X-185 not judged: none of \d+ token\(s\), \d+ from the layoff catalogue prints an Illinois notice/);
  });
  it("a bare street before the paste is INFO, with the town the state names", () => {
    const { lines } = run(routes({ ...TODAY, cards: [il("medline~wd5~Medline", "Medline Industries, LP", "2026-10-30", 304, "3 Lakes Dr.")] }));
    expect(lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
    expect(line(lines, "S14X-185")).toMatch(/^INFO .*print a bare street: .*"3 Lakes Dr\." \(the state names Northfield\) \(before this part is pasted\)/);
  });
});

describe("each claim can FAIL once the migration is applied", () => {
  const cases: Array<[string, Over, Stub, string, RegExp?]> = [
    ["a stub names the file and the helper is missing", { ...TODAY }, "by-name", "M1"],
    ["Lovable retyped the file under its own title and the helper is missing", { ...TODAY }, "by-text", "M1"],
    ["the helper answers anon with a value", { m1: JSON.stringify("1 Main St, Springfield") }, "none", "M1"],
    ["the helper probe answers a gateway page", { m1: "<html>502 Bad Gateway</html>" }, "none", "M1"],
    ["an Illinois card prints the street cell alone", { cards: [il("medline~wd5~Medline", "Medline Industries, LP", "2026-10-30", 304, "3 Lakes Dr.")] }, "none", "S14X-185", /Northfield/],
    ["the pinned Tyson notice prints its bare street", { cards: [il("tysonfoods~wd5~TSN", "Tyson Foods", "2026-08-13", 2495, "28424 38TH Ave. North")], csv: HEADER }, "none", "S14X-185", /Hillsdale/],
    ["applied by the stub alone and a bare street", { m1: MISSING, cards: [il("medline~wd5~Medline", "Medline Industries, LP", "2026-10-30", 304, "3 Lakes Dr.")] }, "by-name", "S14X-185"],
    ["the cards' reader answers a gateway page", { cards: "<html>502</html>" }, "none", "S14X-185", /unreadable/],
    ["the employer page's reader answers an error", { list: JSON.stringify({ code: "57014", message: "canceling statement due to statement timeout" }) }, "none", "S14X-185", /unreadable/],
  ];
  for (const [name, over, stub, id, re] of cases) {
    it(`${id}: ${name}`, () => {
      const { lines } = run(routes(over), stub);
      expect(line(lines, id)).toMatch(/^FAIL /);
      if (re) expect(line(lines, id)).toMatch(re);
    });
  }
  it("S14X-185: the layoff catalogue was not read", () => {
    const { lines } = run(routes(), "none", { VDLFB_ALIASES: "supabase/functions/layoff-filings/no-such-file.ts" });
    expect(line(lines, "S14X-185")).toMatch(/^FAIL .*layoff catalogue/);
  });
});

describe("a row the section cannot judge is INFO, never a FAIL", () => {
  it("an Illinois row the state's file does not hold", () => {
    const { lines } = run(routes({ cards: [il("x", "Nobody Ltd", "2026-10-02", 90, "1 Elm St")] }));
    expect(line(lines, "S14X-185")).toMatch(/^INFO  S14X-185 not judged: 1 Illinois notice/);
  });
  it("the state's file is unreadable", () => {
    const { lines } = run(routes({ cards: [il("medline~wd5~Medline", "Medline Industries, LP", "2026-10-30", 304, "3 Lakes Dr.")], csv: "<html>429</html>" }));
    expect(line(lines, "S14X-185")).toMatch(/^INFO .*unreadable/);
  });
  it("the state's file now names the street differently and the site lacks the town", () => {
    const { lines } = run(routes({ cards: [il("medline~wd5~Medline", "Medline Industries, LP", "2026-10-30", 304, "Three Lakes Drive")] }));
    expect(line(lines, "S14X-185")).toMatch(/^INFO .*the state file now reads otherwise/);
  });
});

describe("it never writes", () => {
  it("every call is a GET but the two readers' anon reads; the key is never printed", () => {
    const { calls, out } = run(routes());
    expect(out).not.toContain(KEY);
    for (const c of calls) {
      const [, req] = c.split("\t");
      if (req.startsWith("GET ")) continue;
      expect(req, c).toMatch(/^POST https:\/\/p\.supabase\.co\/rest\/v1\/rpc\/get_employer_layoff_filings(_all)?$/);
    }
    expect(calls.some((c) => /job-board|functions\/v1/.test(c))).toBe(false);
    // The cards' reader is asked at most 200 tokens a call, and the catalogue fills more than one call.
    const asked = calls.filter((c) => /rpc\/get_employer_layoff_filings\t/.test(c)).map((c) => (JSON.parse(c.split("\t")[2]) as { p_tokens: string[] }).p_tokens.length);
    expect(asked.length).toBeGreaterThan(1);
    expect(Math.max(...asked)).toBeLessThanOrEqual(200);
  });
  it("the state's file is fetched only when an Illinois row is printed", () => {
    const { calls } = run(routes(TODAY));
    expect(calls.some((c) => /raw\.githubusercontent\.com/.test(c))).toBe(false);
    expect(run(routes()).calls.filter((c) => /raw\.githubusercontent\.com/.test(c)).length).toBe(1);
  });
});
