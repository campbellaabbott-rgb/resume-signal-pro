// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzz CAN FAIL EVERY CLAIM IT MAKES (board-stream group
 * "fields", job-board .100).
 *
 * scripts/verify-deploy.d/99zzzz-board-fields.sh is the post-deploy proof
 * that vendor-stated pay, types and countries reach the rows, that an age or a
 * story no longer decides a band, and that Lever,
 * Personio and Paylocity descriptions read whole. A PASS is worth something
 * only if a regression could have turned it into a FAIL
 * (verify-deploy.d/README.md), so the section runs here against a fake curl
 * that answers from routes and logs every call:
 *   - a good deploy prints PASS for every claim;
 *   - each claim prints FAIL when its rows or reads are wrong once what it
 *     waits for has happened (this build's read of the board, or 24 h), and
 *     INFO before;
 *   - before .100 serves, no board call is made;
 *   - the key is never printed, and every board call carries x-rb-budget:
 *     probe and is a status, list or detail read.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 900_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzz-board-fields.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const J_HELPER = /^J\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_99zzzz";
const FB = "https://p\\.supabase\\.co/functions/v1/job-board";
const BOARDS = JSON.parse(/VDBF_BOARDS='(\[[\s\S]*?\])'/.exec(SECTION)?.[1] ?? "[]") as Array<[string, string, string]>;
const PAYLOCITY = JSON.parse(/VDBF_PAYLOCITY='(\[[\s\S]*?\])'/.exec(SECTION)?.[1] ?? "[]") as Array<[string, string]>;

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
  const dir = mkdtempSync(join(tmpdir(), "vd99zzzz-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "bin", "sleep"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(dir, "bin", "sleep"), 0o755);
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
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 240_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

const H = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
type Row = Record<string, unknown>;
const LEVER_ID = "lever:tryjeeves:7a1d";
const POSTING = {
  id: "7a1d", text: "Account Executive", descriptionPlain: "Jeeves is a global financial operating system for companies in Latin America and beyond.\n",
  lists: [{ text: "What you bring", content: "<li>Three years closing enterprise software deals</li><li>Spanish</li>" }],
};
const LEVER_TEXT = "Jeeves is a global financial operating system for companies in Latin America and beyond.\nWhat you bring\nThree years closing enterprise software deals\nSpanish";
const pos = (id: string, desc: string) => `<position><id>${id}</id><name>Role</name>${desc}</position>`;
const PDE = `<workzag-jobs>${pos("901", "<jobDescriptions></jobDescriptions>")}</workzag-jobs>`;
const PEN = `<workzag-jobs>${pos("901", "<jobDescriptions><jobDescription><name>Tasks</name><value><![CDATA[<p>You will build the GPU cloud scheduler.</p>]]></value></jobDescription></jobDescriptions>")}</workzag-jobs>`;
const INTERN_FEED = `<workzag-jobs><position><id>2864862</id><name>Human Resources Praktikant (m/w/d)</name><employmentType>intern</employmentType><schedule>full-time</schedule><createdAt>${new Date(Date.now() - 4 * 86_400_000).toISOString()}</createdAt></position></workzag-jobs>`;
const PAGE = `<html><body><div class="job-preview-details"><div class="job-listing-header">Description</div><div><p>${"After school care. ".repeat(20)}</p></div></div><div class="preview-bottom-apply-btn"></div></body></html>`;

type Over = {
  build?: string; buildSince?: string; read?: string;
  dominos?: Row[]; exec?: Row[]; boards?: Partial<Record<string, Row[]>>; leverRows?: Row[];
  leverDetail?: string | null; personioDetail?: string | null; paylocityDetail?: string | null;
  internFeed?: string; internRows?: Row[];
};
/** Rows a good deploy serves for each board kind, read at `read`. */
function goodRows(kind: string, read: string): Row[] {
  const base = (i: number): Row => ({ id: `x:${i}`, title: "Role", recheckedAt: read, country: "US", employmentType: "full_time" });
  const n = Array.from({ length: 10 }, (_, i) => base(i));
  if (kind === "pay") return n.map((r, i) => (i < 6 ? { ...r, salary: "$22 - $24 / hour", salaryMinAnnual: 45760 } : r));
  if (kind === "bcca") return n.map((r, i) => (i < 5 ? { ...r, location: "3388 Sweden Way, Richmond, BC", country: "CA" } : { ...r, location: "Toronto, ON", country: "CA" }));
  if (kind === "notcontract") return n.map((r, i) => (i < 1 ? { ...r, employmentType: "contract" } : { ...r, employmentType: null }));
  return n;
}
function routes(o: Over = {}): Route[] {
  const read = o.read ?? iso(2 * H);
  const r: Route[] = [
    { match: `^OPTIONS ${FB}$`, headers: { "x-fn-build": o.build ?? "job-board.2026-09-09.100" } },
    { match: `^POST ${FB}\t.*"action":"status"`, body: JSON.stringify({ sliceStats: { build: (o.build ?? "job-board.2026-09-09.100").replace(/^job-board\./, ""), buildSince: o.buildSince ?? iso(30 * H) } }) },
    { match: `^POST ${FB}\t.*"companies":\\["dominos"\\].*"experience":"expert"`, body: JSON.stringify({ total: (o.dominos ?? []).length, jobs: o.dominos ?? [] }) },
    { match: `^POST ${FB}\t.*"companies":\\["dominos"\\]`, body: JSON.stringify({ total: 40, jobs: [] }) },
    { match: `^POST ${FB}\t.*"q":"director","experience":"entry"`, body: JSON.stringify({ total: (o.exec ?? []).length, jobs: o.exec ?? [] }) },
    { match: `^POST ${FB}\t.*"q":"director"`, body: JSON.stringify({ total: 685, jobs: [] }) },
    { match: `^POST ${FB}\t.*"companies":\\["tryjeeves"\\]`, body: JSON.stringify({ total: 1, jobs: o.leverRows ?? [{ id: LEVER_ID, title: "Account Executive", lastSeen: iso(H), recheckedAt: read }] }) },
    ...BOARDS.map(([, t, kind]) => ({ match: `^POST ${FB}\t.*"companies":\\["${esc(t)}"\\]`, body: JSON.stringify({ total: 10, jobs: o.boards?.[t] ?? goodRows(kind, read) }) })),
    { match: `^POST ${FB}\t.*"action":"detail","id":"${esc(LEVER_ID)}"`, body: JSON.stringify({ job: { id: LEVER_ID }, description: o.leverDetail === undefined ? LEVER_TEXT : o.leverDetail }) },
    { match: `^POST ${FB}\t.*"action":"detail","id":"personio:lyceum-technology:901"`, body: JSON.stringify({ job: { id: "personio:lyceum-technology:901" }, description: o.personioDetail === undefined ? "Tasks\nYou will build the GPU cloud scheduler." : o.personioDetail }) },
    { match: `^POST ${FB}\t.*"action":"detail","id":"paylocity:${esc(PAYLOCITY[0][0])}:${PAYLOCITY[0][1]}"`, body: JSON.stringify({ job: { id: "p" }, description: o.paylocityDetail === undefined ? "After school care. ".repeat(20) : o.paylocityDetail }) },
    { match: `^GET https://api\\.lever\\.co/v0/postings/tryjeeves/7a1d$`, body: JSON.stringify(POSTING) },
    { match: `^GET https://lyceum-technology\\.jobs\\.personio\\.de/xml\\?language=en$`, body: PEN },
    { match: `^GET https://lyceum-technology\\.jobs\\.personio\\.de/xml$`, body: PDE },
    { match: `^GET https://recruiting\\.paylocity\\.com/recruiting/jobs/Details/${PAYLOCITY[0][1]}$`, body: PAGE },
    { match: `^GET https://mynaric\\.jobs\\.personio\\.de/xml$`, body: o.internFeed ?? INTERN_FEED },
    { match: `^POST ${FB}\t.*"companies":\\["mynaric"\\]`, body: JSON.stringify({ total: 13, jobs: o.internRows ?? [{ id: "personio:mynaric:2864862", title: "Human Resources Praktikant (m/w/d)", employmentType: "internship", recheckedAt: read }] }) },
  ];
  return r;
}
const verdicts = (lines: string[]) => lines.filter((l) => /^(PASS|FAIL|INFO)/.test(l));
const line = (lines: string[], re: RegExp) => verdicts(lines).find((l) => re.test(l)) ?? `(no verdict matching ${re})`;

describe("99zzzz on a good deploy", () => {
  it("prints PASS for every claim and nothing else", () => {
    const { lines, out } = run(routes());
    const v = verdicts(lines);
    expect(v.filter((l) => !l.startsWith("PASS")), out).toEqual([]);
    expect(v.length, out).toBe(2 + BOARDS.length + 4);
    expect(out).not.toContain(KEY);
  });
  it("every board call is a probe-budget status, list or detail read", () => {
    const { calls } = run(routes());
    const board = calls.filter((c) => c.includes("/functions/v1/job-board"));
    expect(board.length).toBeGreaterThan(10);
    for (const c of board.filter((x) => x.includes("\tPOST "))) {
      expect(c, c).toMatch(/x-rb-budget: probe/);
      expect(c, c).toMatch(/"action":"(status|list|detail)"/);
    }
    for (const c of calls.filter((x) => !x.includes("/functions/v1/job-board"))) expect(c, c).toMatch(/^curl\tGET /);
  });
});

describe("99zzzz waits for .100", () => {
  it("an older build is INFO and no board read is made", () => {
    const { lines, calls } = run(routes({ build: "job-board.2026-09-09.99" }));
    expect(verdicts(lines)).toEqual([expect.stringMatching(/^INFO {2}job-board preflight x-fn-build = job-board\.2026-09-09\.99/)]);
    expect(calls.filter((c) => /\tPOST /.test(c))).toEqual([]);
  });
});

describe("99zzzz fails each claim when it is false", () => {
  it("a Domino's delivery row filed Expert on an age: FAIL after 24 h, INFO before", () => {
    const bad = [{ id: "smartrecruiters:dominos:1", title: "Delivery Expert", experienceBand: "expert", minYears: 18 }];
    expect(line(run(routes({ dominos: bad })).lines, /Domino/)).toMatch(/^FAIL/);
    expect(line(run(routes({ dominos: bad, buildSince: iso(5 * H) })).lines, /Domino/)).toMatch(/^INFO/);
    expect(line(run(routes({ dominos: [{ ...bad[0], title: "Director, Data Platform", minYears: 18 }] })).lines, /Domino/), "only delivery rows are judged").toMatch(/^PASS/);
  });
  it("makes no executive-rung claim: the stated figure decides a director's band, as on main (S13-016 declined, n1420)", () => {
    const { lines, calls } = run(routes({ exec: [{ id: "greenhouse:x:1", title: "Assistant Store Director", experienceBand: "entry", minYears: 1 }] }));
    expect(verdicts(lines).filter((l) => /rung|director/i.test(l))).toEqual([]);
    expect(calls.filter((c) => /"q":"director"/.test(c))).toEqual([]);
  });
  it.each(BOARDS.map(([v, t, kind]) => [v, t, kind] as const))("%s board %s (%s): FAIL when its rows lack the field, after this build read it", (_v, t, kind) => {
    const read = iso(2 * H);
    const strip: Row[] = goodRows(kind, read).map((r) => {
      if (kind === "pay") return { ...r, salary: null, salaryMinAnnual: null };
      if (kind === "bcca") return { ...r, location: "3388 Sweden Way, Richmond, BC", country: "SE" };
      if (kind === "notcontract") return { ...r, employmentType: "contract" };
      if (kind === "country") return { ...r, country: null };
      if (kind === "typecountry") return { ...r, country: Number(String(r.id).slice(2)) % 2 ? null : "FI" };
      return { ...r, employmentType: null };
    });
    expect(line(run(routes({ boards: { [t]: strip } })).lines, new RegExp(`board ${esc(t)}`))).toMatch(/^FAIL/);
  });
  it("Breezy pay at the share .96 served by description mining alone (4 of 60): FAIL", () => {
    const read = iso(2 * H);
    const rows = goodRows("pay", read).map((r, i) => (i < 1 ? r : { ...r, salary: null, salaryMinAnnual: null }));
    expect(line(run(routes({ boards: { "national-assemblers-inc": rows } })).lines, /board national-assemblers-inc/)).toMatch(/^FAIL .*1 of 10 .*want 40%/);
  });
  it("a Personio posting its feed lists as intern on a full-time schedule, filed full_time: FAIL; none in the feeds: INFO", () => {
    const read = iso(2 * H);
    expect(line(run(routes({ internRows: [{ id: "personio:mynaric:2864862", employmentType: "full_time", recheckedAt: read }] })).lines, /personio:mynaric/)).toMatch(/^FAIL .*filed full_time/);
    expect(line(run(routes({ internRows: [{ id: "personio:mynaric:2864862", employmentType: "full_time", recheckedAt: iso(40 * H) }] })).lines, /personio:mynaric/)).toMatch(/^FAIL .*has not read mynaric/);
    expect(line(run(routes({ internRows: [] })).lines, /personio:mynaric/)).toMatch(/^FAIL .*not served/);
    expect(line(run(routes({ internFeed: INTERN_FEED.replace("full-time", "part-time") })).lines, /Personio type line/)).toMatch(/^INFO/);
    expect(line(run(routes({ internFeed: INTERN_FEED.replace(/<createdAt>[^<]*/, "<createdAt>2025-05-15T15:57:31+00:00") })).lines, /Personio type line/)).toMatch(/^INFO/);
  });
  it("a board this build has not read: INFO for 24 h, then FAIL", () => {
    const t = BOARDS[0][1];
    const stale = goodRows(BOARDS[0][2], iso(40 * H));
    expect(line(run(routes({ boards: { [t]: stale } })).lines, new RegExp(`board ${esc(t)}`))).toMatch(/^FAIL .*has not been read by this build/);
    expect(line(run(routes({ boards: { [t]: goodRows(BOARDS[0][2], iso(9 * H)) }, buildSince: iso(5 * H) })).lines, new RegExp(`board ${esc(t)}`))).toMatch(/^INFO/);
  });
  it("a new Lever row without its list, or with its opening twice: FAIL", () => {
    expect(line(run(routes({ leverDetail: "Jeeves is a global financial operating system for companies in Latin America and beyond." })).lines, /Lever row/)).toMatch(/^FAIL .*MISSING/);
    expect(line(run(routes({ leverDetail: `${LEVER_TEXT}\n${POSTING.descriptionPlain}` })).lines, /Lever row/)).toMatch(/^FAIL .*opening 2 time/);
    expect(line(run(routes({ leverRows: [{ id: LEVER_ID, lastSeen: iso(40 * H), recheckedAt: iso(H) }] })).lines, /tryjeeves/), "an old row is not judged").toMatch(/^INFO/);
  });
  it("a Personio posting that reads no English description: FAIL", () => {
    expect(line(run(routes({ personioDetail: null })).lines, /personio:lyceum/)).toMatch(/^FAIL/);
  });
  it("a Paylocity posting with no structured data that reads a short description: FAIL", () => {
    expect(line(run(routes({ paylocityDetail: null })).lines, /paylocity:/)).toMatch(/^FAIL .*0-character/);
  });
});
