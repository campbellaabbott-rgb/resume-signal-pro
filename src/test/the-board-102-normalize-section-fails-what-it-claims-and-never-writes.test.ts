// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz (job-board .102, lane 2) CAN FAIL EVERY CLAIM IT
 * MAKES, WAITS FOR ITS BUILD, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-board-102-normalize.sh is the post-deploy
 * proof of the normalize.ts readers. A PASS is worth something only if a
 * regression could have turned it into a FAIL (verify-deploy.d/README.md), so
 * the section runs here against a fake curl that answers from routes and logs
 * every call:
 *   - a good deploy prints PASS for every claim, one line each;
 *   - an older job-board build prints one INFO and asks the board nothing;
 *     a preflight with no build is a FAIL;
 *   - before a slice of this build has run, every line is INFO, wrong rows
 *     included;
 *   - each claim FAILs on the row that .101 served live on 2026-11-15 (a
 *     dry run against production read ThePlace1's two Nigeria rows with no
 *     country, WorldStrides' Virginia row under Wien, "Accra, Ghana" filed
 *     nowhere, JLL's "Hong Kong, SAR, China" filed CN, 75 Teamtailor and
 *     Personio rows with "&amp;", and 7 of 10 new Remote Sensing postings
 *     filed remote), once the build has read the row or 48 h have passed for
 *     a row with no country; before that it is INFO;
 *   - a vendor that states another code is INFO, never FAIL;
 *   - an unreadable answer is a FAIL that shows it;
 *   - the key is never printed, and every board call carries x-rb-budget:
 *     probe and is a status or list read.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION_PATH = resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-board-102-normalize.sh");
const SECTION = readFileSync(SECTION_PATH, "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const J_HELPER = /^J\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_99zzzzzzz";
const FB = "https://p\\.supabase\\.co/functions/v1/job-board";
// The section's own tables, read the way bash reads them.
const shellVar = (name: string) => {
  const def = new RegExp(`^${name}='.*$`, "m").exec(SECTION)?.[0] ?? "";
  return JSON.parse(execFileSync("bash", ["-c", `${def}\nprintf '%s' "$${name}"`], { encoding: "utf8" }) || "[]");
};
const PICKS = shellVar("VDBN_S120") as Array<[string, string, string, string]>;
const NAMES = shellVar("VDBN_NAMES") as Array<[string, string, string[]]>;

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(x==="-A")i++;else if(["-m","--max-time"].includes(x))i++;
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
if(w)out+=w.replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vd99zzzzzzz-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n${J_HELPER}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 110_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

const H = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
type Row = Record<string, unknown>;
const READ = iso(H); // read by this build: after a buildSince 72 h or 3 h ago
const OLD = iso(200 * H); // read before it
const VA = "1919 Gallows Road Suite 700 Vienna VA 22182; 218 West Water Street Suite 400 Charlottesville VA 22902";
const WS_ID = "greenhouse:world4822stri986des:5459919008";

type Over = {
  build?: string; sliceBuild?: string; buildSince?: string; statusBody?: string;
  place?: Row[]; placeBody?: string; wien?: Row[]; wienPages?: string[]; worldstrides?: Row[];
  names?: Partial<Record<string, Row[]>>; hk?: Row[]; s120?: (id: string, code: string) => Partial<Row>; s120Body?: string;
  ent?: Partial<Record<"teamtailor" | "personio", Row[]>>; trade?: Row[];
};
const list = (jobs: Row[], over: Record<string, unknown> = {}) => JSON.stringify({ jobs, total: jobs.length, hasMore: false, nextOffset: jobs.length, ...over });
const CITY: Record<string, string> = { NG: "Lagos, LA", GH: "Accra", BD: "Dhaka", ET: "Addis Ababa", UG: "Kampala", TZ: "Dar es Salaam", RW: "Kigali", SN: "Dakar", CI: "Abidjan", CM: "Douala", DZ: "Algiers", LK: "Colombo", NP: "Kathmandu", KZ: "Almaty", QA: "Doha", JO: "Amman", LB: "Beirut" };
const nameRows = (code: string, name: string): Row[] => [
  ...[0, 1, 2].map((i) => ({ id: `greenhouse:t${code}:${i}`, source: "greenhouse", location: `${CITY[code]}, ${name}`, country: code, lastSeen: READ })),
  // Never sampled: several countries, or a US town of the same name.
  { id: `greenhouse:multi${code}:9`, source: "greenhouse", location: `Nairobi; ${CITY[code]}, ${name}`, country: "KE", lastSeen: READ },
  ...(code === "LB" ? [{ id: "greenhouse:bayada:1", source: "greenhouse", location: "PA, Lebanon", country: "US", lastSeen: READ }] : []),
  ...(code === "JO" ? [{ id: "greenhouse:t:2", source: "greenhouse", location: "West Jordan, UT", country: "US", lastSeen: READ }] : []),
];
const trade = (i: number, over: Row = {}): Row => ({ id: `greenhouse:t:trade${i}`, source: "greenhouse", title: "Remote Sensing Scientist", location: "Dayton, OH", workMode: null, postedAt: iso(2 * H), lastSeen: READ, ...over });

function routes(o: Over = {}): Route[] {
  const build = o.build ?? "job-board.2026-09-09.102";
  const status = o.statusBody ?? JSON.stringify({ sliceStats: { build: o.sliceBuild ?? build.replace(/^job-board\./, ""), buildSince: o.buildSince ?? iso(72 * H) } });
  const place = o.place ?? Array.from({ length: 8 }, (_, i) => ({ id: `smartrecruiters:ThePlace1:${i}`, source: "smartrecruiters", location: i < 2 ? (i ? "Benin City, ED, Nigeria" : "Yenegwe, BY, Nigeria") : "Lagos, LA, Nigeria", country: "NG", lastSeen: READ }));
  const wien = o.wien ?? [0, 1, 2].map((i) => ({ id: `workday:w:${i}`, source: "workday", location: "Wien, Austria", country: "AT", lastSeen: READ }));
  const ws = o.worldstrides ?? [{ id: WS_ID, source: "greenhouse", location: VA, country: "US", lastSeen: READ }, { id: "greenhouse:world4822stri986des:2", source: "greenhouse", location: "Remote", country: null, lastSeen: READ }];
  const hk = o.hk ?? [
    ...[0, 1, 2].map((i) => ({ id: `greenhouse:hk:${i}`, source: "greenhouse", location: "Hong Kong SAR, China", country: "HK", lastSeen: READ })),
    { id: "workday:jll:1", source: "workday", location: "Hong Kong, SAR, China", country: "HK", lastSeen: READ },
    { id: "greenhouse:hk:9", source: "greenhouse", location: "Shanghai; Hong Kong", country: "CN", lastSeen: READ },
  ];
  const tradeRows = o.trade ?? [0, 1, 2, 3, 4, 5].map((i) => trade(i));
  const ent = {
    teamtailor: o.ent?.teamtailor ?? [{ id: "teamtailor:acme:1", title: "Sales & Marketing Lead", department: "R&D", lastSeen: READ }],
    personio: o.ent?.personio ?? [{ id: "personio:acme:1", title: "Pricing & Contracting Lead", department: "Commercial", lastSeen: READ }],
  };
  const r: Route[] = [
    { match: `^OPTIONS ${FB}$`, headers: build ? { "x-fn-build": build } : {} },
    { match: `^POST ${FB}\t.*"action":"status"`, body: status },
    { match: `^POST ${FB}\t.*"companies":\\["ThePlace1"\\]`, body: o.placeBody ?? list([...place, { id: "smartrecruiters:ThePlace1:x", source: "smartrecruiters", location: "Accra, Ghana", country: "GH", lastSeen: READ }]) },
    { match: `^POST ${FB}\t.*"companies":\\["world4822stri986des"\\]`, body: list(ws) },
    ...(o.wienPages
      ? o.wienPages.map((body, i) => ({ match: `^POST ${FB}\t.*"location":"Wien","limit":60,"offset":${i * 60},`, body }))
      : [{ match: `^POST ${FB}\t.*"location":"Wien"`, body: list(wien) }]),
    ...NAMES.map(([term, code, names]) => ({ match: `^POST ${FB}\t.*"q":"","location":"${esc(term)}"`, body: list(o.names?.[code] ?? nameRows(code, names[0])) })),
    { match: `^POST ${FB}\t.*"location":"Hong Kong","limit":60,"offset":0,`, body: list(hk, { hasMore: true, nextOffset: 60 }) },
    { match: `^POST ${FB}\t.*"location":"Hong Kong"`, body: list([]) },
    ...[...new Set(PICKS.map(([t, , , c]) => `${t}|${c}`))].map((k) => {
      const [t, c] = k.split("|");
      const rows = PICKS.filter((p) => p[0] === t && p[3] === c).map(([, id, code]) => ({ id, source: "breezy", location: `${c}, XX`, country: code, lastSeen: READ, ...(o.s120?.(id, code) ?? {}) }));
      return { match: `^POST ${FB}\t.*"companies":\\["${esc(t)}"\\],"vendor":\\["breezy"\\],"location":"${esc(c)}"`, body: o.s120Body ?? list(rows) };
    }),
    { match: `^POST ${FB}\t.*"vendor":\\["teamtailor"\\],"limit":60,"offset":0,`, body: list(ent.teamtailor) },
    { match: `^POST ${FB}\t.*"vendor":\\["personio"\\],"limit":60,"offset":0,`, body: list(ent.personio) },
    { match: `^POST ${FB}\t.*"vendor":\\["(teamtailor|personio)"\\]`, body: list([]) },
    { match: `^POST ${FB}\t.*remote sensing.*"offset":0,`, body: list(tradeRows) },
    { match: `^POST ${FB}\t.*remote (sensing|pilot)`, body: list([]) },
  ];
  return r;
}
const verdicts = (lines: string[]) => lines.filter((l) => /^(PASS|FAIL|INFO)/.test(l));
const line = (lines: string[], re: RegExp) => verdicts(lines).find((l) => re.test(l)) ?? `(no verdict matching ${re})`;
const CLAIMS = 1 + 1 + 1 + 1 + 17 + 1 + 1 + 1 + 1; // preflight, P1, W1, W2, N1 x17, H1, V1, E1, R1

describe("the section's own tables", () => {
  it("carries twenty picked rows, each a code that is not US or CA, and the seventeen names", () => {
    expect(PICKS.length).toBe(20);
    expect(new Set(PICKS.map((p) => p[1])).size).toBe(20);
    for (const [t, id, code] of PICKS) {
      expect(id.startsWith(`breezy:${t}:`), id).toBe(true);
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(["US", "CA"]).not.toContain(code);
    }
    expect(NAMES.map((n) => n[1])).toEqual(["NG", "GH", "BD", "ET", "UG", "TZ", "RW", "SN", "CI", "CM", "DZ", "LK", "NP", "KZ", "QA", "JO", "LB"]);
  });
});

describe("99zzzzzzz on a good deploy", () => {
  it("prints PASS for every claim and nothing else", () => {
    const { lines, out } = run(routes());
    const v = verdicts(lines);
    expect(v.filter((l) => !l.startsWith("PASS")), out).toEqual([]);
    expect(v.length, out).toBe(CLAIMS);
    expect(out).not.toContain(KEY);
  });

  it("every call is job-board: one OPTIONS, then probe-budget status and list reads that log nothing", () => {
    const { calls } = run(routes());
    expect(calls.length).toBeGreaterThan(40);
    for (const c of calls) expect(c, c).toMatch(/^curl\t(OPTIONS|POST) https:\/\/p\.supabase\.co\/functions\/v1\/job-board\b/);
    expect(calls.filter((c) => c.startsWith("curl\tOPTIONS"))).toHaveLength(1);
    for (const c of calls.filter((x) => x.startsWith("curl\tPOST"))) {
      expect(c, c).toMatch(/x-rb-budget: probe/);
      expect(c, c).toMatch(/\t\{"action":"(status|list)"/);
      if (c.includes('"action":"list"')) expect(c, c).toContain('"noLog":true');
    }
  });

  it("a vendor that states another code is INFO in the tail, never a FAIL", () => {
    const names = { NG: [...nameRows("NG", "Nigeria"), { id: "smartrecruiters:IOTA:1", source: "smartrecruiters", location: "Port Harcourt, RV, Nigeria", country: "US", lastSeen: READ }] };
    const hk = [{ id: "greenhouse:hk:0", source: "greenhouse", location: "Hong Kong", country: "HK", lastSeen: READ }, { id: "lever:x:1", source: "lever", location: "Hong Kong", country: "CN", lastSeen: READ }];
    const { lines } = run(routes({ names, hk }));
    expect(line(lines, /ending in Nigeria/)).toMatch(/^PASS .*left to it.*IOTA/);
    expect(line(lines, /S14X-249/)).toMatch(/^PASS .*filed CN by a vendor that states it/);
  });
});

describe("99zzzzzzz waits for its build and its clock", () => {
  it("an older build is INFO and no board read is made", () => {
    const { lines, calls } = run(routes({ build: "job-board.2026-09-09.101" }));
    expect(verdicts(lines)).toEqual([expect.stringMatching(/^INFO {2}job-board preflight x-fn-build = job-board\.2026-09-09\.101/)]);
    expect(calls.filter((c) => c.startsWith("curl\tPOST"))).toEqual([]);
  });

  it("a preflight with no build is a FAIL", () => {
    expect(verdicts(run(routes({ build: "" })).lines)).toEqual([expect.stringMatching(/^FAIL {2}job-board preflight carries no x-fn-build/)]);
  });

  it("before a slice of this build has run, every line is INFO, wrong rows included", () => {
    const { lines, out } = run(routes({
      sliceBuild: "2026-09-09.101",
      place: [{ id: "smartrecruiters:ThePlace1:1", source: "smartrecruiters", location: "Yenegwe, BY, Nigeria", country: null, lastSeen: READ }],
      wien: [{ id: WS_ID, source: "greenhouse", location: VA, country: "US", lastSeen: READ }],
      hk: [{ id: "greenhouse:hk:0", source: "greenhouse", location: "Hong Kong SAR, China", country: "CN", lastSeen: READ }],
      ent: { teamtailor: [{ id: "teamtailor:a:1", title: "Q&amp;A Lead", lastSeen: READ }] },
    }));
    const v = verdicts(lines).slice(1);
    expect(v.filter((l) => !l.startsWith("INFO")), out).toEqual([]);
    expect(v.length).toBe(CLAIMS); // the clock line, then one per claim
  });

  it("a row with no country waits 48 h for the backfill, then FAILs", () => {
    const place = [{ id: "smartrecruiters:ThePlace1:1", source: "smartrecruiters", location: "Yenegwe, BY, Nigeria", country: null, lastSeen: OLD }];
    expect(line(run(routes({ place, buildSince: iso(3 * H) })).lines, /ThePlace1/)).toMatch(/^INFO .*backfill/);
    expect(line(run(routes({ place, buildSince: iso(72 * H) })).lines, /ThePlace1/)).toMatch(/^FAIL .*Yenegwe/);
  });

  it("rows the build has not read yet, and right, are INFO before 48 h and PASS after", () => {
    const place = [{ id: "smartrecruiters:ThePlace1:1", source: "smartrecruiters", location: "Yenegwe, BY, Nigeria", country: "NG", lastSeen: OLD }];
    expect(line(run(routes({ place, buildSince: iso(3 * H) })).lines, /ThePlace1/)).toMatch(/^INFO .*none was read by this build yet/);
    expect(line(run(routes({ place, buildSince: iso(72 * H) })).lines, /ThePlace1/)).toMatch(/^PASS .*48 h after the first slice/);
  });
});

describe("99zzzzzzz fails each claim when it is false", () => {
  it("P1: a ThePlace1 Nigeria row the build read and filed nowhere, or in Louisiana", () => {
    const at = (country: string | null) => [{ id: "smartrecruiters:ThePlace1:2", source: "smartrecruiters", location: "Benin City, ED, Nigeria", country, lastSeen: READ }];
    expect(line(run(routes({ place: at(null) })).lines, /ThePlace1/)).toMatch(/^FAIL .*Benin City/);
    expect(line(run(routes({ place: at("US") })).lines, /ThePlace1/)).toMatch(/^FAIL/);
  });

  it("W1: a Wien row naming a US state and ZIP; INFO while the build has not read it", () => {
    const row = (country: string | null, lastSeen: string) => [{ id: WS_ID, source: "greenhouse", location: VA, country, lastSeen }];
    expect(line(run(routes({ wien: row(null, READ) })).lines, /location Wien/)).toMatch(/^FAIL .*US state and ZIP/);
    expect(line(run(routes({ wien: row("US", OLD) })).lines, /location Wien/)).toMatch(/^FAIL/);
    expect(line(run(routes({ wien: row(null, OLD), buildSince: iso(3 * H) })).lines, /location Wien/)).toMatch(/^INFO .*FAIL from 48 h/);
    expect(line(run(routes({ wien: row(null, OLD), buildSince: iso(72 * H) })).lines, /location Wien/)).toMatch(/^FAIL/);
    // A row that names Austria too is not a US row.
    expect(line(run(routes({ wien: [{ id: "x:1", location: "Wien, Austria; Vienna VA 22182", country: "AT", lastSeen: READ }] })).lines, /location Wien/)).toMatch(/^PASS/);
  });

  it("W1: the walk follows the list to its end, and an unreadable page is a FAIL that shows it", () => {
    const AT = (i: number) => ({ id: `x:${i}`, location: "Wien", country: "AT", lastSeen: READ });
    const p0 = list([AT(1)], { hasMore: true, nextOffset: 60 });
    expect(line(run(routes({ wienPages: [p0, list([{ id: WS_ID, location: VA, country: null, lastSeen: READ }])] })).lines, /location Wien/)).toMatch(/^FAIL/);
    expect(line(run(routes({ wienPages: [p0, "<html>502 Bad Gateway</html>"] })).lines, /location Wien/)).toMatch(/^FAIL .*page 1 .*502 Bad Gateway/);
  });

  it("W2: WorldStrides' Virginia row the build read and left with no country", () => {
    const ws = [{ id: WS_ID, source: "greenhouse", location: VA, country: null, lastSeen: READ }];
    expect(line(run(routes({ worldstrides: ws })).lines, /WorldStrides/)).toMatch(/^FAIL .*Gallows Road/);
  });

  it("N1: 'Lagos, LA, Nigeria' filed US, and 'Accra, Ghana' filed nowhere, by a reader of the place", () => {
    const { lines } = run(routes({ names: {
      NG: [{ id: "greenhouse:a:1", source: "greenhouse", location: "Lagos, LA, Nigeria", country: "US", lastSeen: READ }],
      GH: [{ id: "bamboohr:wusc:419", source: "bamboohr", location: "Accra, Ghana", country: null, lastSeen: READ }],
    } }));
    expect(line(lines, /ending in Nigeria/)).toMatch(/^FAIL .*Lagos, LA, Nigeria/);
    expect(line(lines, /ending in Ghana/)).toMatch(/^FAIL .*wusc/);
    expect(line(lines, /ending in Bangladesh/)).toMatch(/^PASS/);
  });

  it("N1: a name with no row is INFO, and US towns called Lebanon or Jordan are never sampled", () => {
    const { lines } = run(routes({ names: {
      QA: [],
      LB: [{ id: "greenhouse:bayada:1", source: "greenhouse", location: "Lebanon, PA 17042", country: "US", lastSeen: READ }, { id: "greenhouse:b:2", source: "greenhouse", location: "PA, Lebanon", country: "US", lastSeen: READ }],
      JO: [{ id: "recruitee:g:1", source: "recruitee", location: "West Jordan, Utah, United States", country: "US", lastSeen: READ }, { id: "ashby:t:1", source: "ashby", location: "South Jordan, UT, Jordan", country: "US", lastSeen: READ }],
    } }));
    expect(line(lines, /ending in Qatar/)).toMatch(/^INFO .*no such row/);
    expect(line(lines, /ending in Lebanon/)).toMatch(/^INFO .*no such row/);
    expect(line(lines, /ending in Jordan/)).toMatch(/^INFO .*no such row/);
  });

  it("N1: Côte d'Ivoire is sampled with either apostrophe, and Ivory Coast too", () => {
    const CI = [
      { id: "teamtailor:brut:1", source: "teamtailor", location: "Abidjan, Côte d'Ivoire", country: "FR", lastSeen: READ },
      { id: "recruitee:p:1", source: "recruitee", location: "Abidjan, Côte d’Ivoire", country: "CI", lastSeen: READ },
      { id: "greenhouse:p:2", source: "greenhouse", location: "Abidjan, Ivory Coast", country: "CI", lastSeen: READ },
    ];
    expect(line(run(routes({ names: { CI } })).lines, /read CI/)).toMatch(/^FAIL .*brut.*FR/);
    expect(line(run(routes({ names: { CI: CI.slice(1) } })).lines, /read CI/)).toMatch(/^PASS: ?|^PASS {2}.*2 of 2/);
  });

  it("H1: a Hong Kong row the build read and filed CN by its place", () => {
    const hk = [{ id: "workday:jll~wd1~jllcareers:REQ548675-1", source: "workday", location: "Hong Kong, SAR, China", country: "CN", lastSeen: READ }];
    expect(line(run(routes({ hk })).lines, /S14X-249/)).toMatch(/^FAIL .*jll/);
    expect(line(run(routes({ hk: hk.map((r) => ({ ...r, lastSeen: OLD })) })).lines, /S14X-249/)).toMatch(/^INFO .*none of 1 Hong Kong rows was read/);
  });

  it("V1: a picked row the build read that does not carry its feed code", () => {
    const first = PICKS[0][1];
    const { lines } = run(routes({ s120: (id) => (id === first ? { country: "US" } : {}) }));
    expect(line(lines, /S14X-120/)).toMatch(new RegExp(`^FAIL .*${esc(first)}`));
    expect(line(run(routes({ s120: () => ({ lastSeen: OLD }) })).lines, /S14X-120/)).toMatch(/^INFO .*none read by this build/);
    expect(line(run(routes({ s120Body: "upstream error" })).lines, /S14X-120/)).toMatch(/^FAIL .*unreadable/);
  });

  it("E1: a literal &amp; on a row the build read; none to judge is INFO", () => {
    const tt = (title: string, lastSeen: string, department: string | null = null) => [{ id: "teamtailor:incluso:8744038", title, department, lastSeen }];
    expect(line(run(routes({ ent: { teamtailor: tt("Hands-on Marketing Project Manager", READ, "Sales, Marketing &amp; Communication") } })).lines, /S14X-216/)).toMatch(/^FAIL .*Communication/);
    expect(line(run(routes({ ent: { teamtailor: tt("Q&amp;A Lead", READ) } })).lines, /S14X-216/)).toMatch(/^FAIL/);
    expect(line(run(routes({ ent: { teamtailor: tt("Q&amp;A Lead", OLD) } })).lines, /S14X-216/)).toMatch(/^PASS .*1 read before it still do/);
    expect(line(run(routes({ ent: { teamtailor: tt("Engineer", READ), personio: [] } })).lines, /S14X-216/)).toMatch(/^INFO .*carries an ampersand/);
  });

  it("R1: a new Remote Sensing posting filed remote on the trade alone, over 5%", () => {
    const bad = [trade(0, { workMode: "remote", remote: true }), ...[1, 2, 3, 4, 5].map((i) => trade(i))];
    expect(line(run(routes({ trade: bad })).lines, /BR-08/)).toMatch(/^FAIL .*1 of 6/);
    // A mode stated beside the trade, a remote place, or a vendor's workplace field is not the trade.
    const fine = [
      trade(0, { title: "Remote Sensing Scientist - Remote", workMode: "remote" }),
      trade(1, { location: "Remote, US", workMode: "remote" }),
      trade(2, { source: "lever", id: "lever:x:1", workMode: "remote" }),
      ...[3, 4, 5, 6, 7].map((i) => trade(i)),
    ];
    expect(line(run(routes({ trade: fine })).lines, /BR-08/)).toMatch(/^PASS .*0 of 7/);
  });

  it("R1: postings first posted before the build, and fewer than five, are INFO", () => {
    const before = [0, 1, 2, 3, 4, 5].map((i) => trade(i, { postedAt: iso(100 * H), workMode: "remote" }));
    expect(line(run(routes({ trade: before })).lines, /BR-08/)).toMatch(/^INFO .*0 Remote Sensing/);
    expect(line(run(routes({ trade: [0, 1, 2, 3].map((i) => trade(i)) })).lines, /BR-08/)).toMatch(/^INFO .*4 Remote Sensing/);
  });

  it("an unreadable status or list is a FAIL that shows it, never silence", () => {
    const { lines } = run(routes({ placeBody: "<html>504 Gateway Time-out</html>" }));
    expect(line(lines, /ThePlace1/)).toMatch(/^FAIL .*504 Gateway/);
    const s = run(routes({ statusBody: "not json" }));
    expect(verdicts(s.lines).filter((l) => l.startsWith("FAIL"))).toEqual([]);
    expect(line(s.lines, /status carries no sliceStats/)).toMatch(/^INFO/);
  });
});
