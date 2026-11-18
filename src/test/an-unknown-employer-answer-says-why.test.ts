// @vitest-environment node
/**
 * AN UNKNOWN EMPLOYER ANSWER SAYS WHY (SEO audit 2026-11-18, STRUCTURED-1).
 *
 * The 18 Nov publish bake read 302 Workday posting pages at their employers
 * and recorded 276 unknown, with counts only: the ledger could not say
 * whether the shared budget ran out, a vendor refused, or a bot challenge
 * stood in the way, and the bake said so with one console.warn over the
 * whole run. Every unknown answer now carries a named reason, counted per
 * vendor into the ledger (employerReads.byVendor[v].why); a vendor with 20 or
 * more pages over half unknown gets a FAIL-tier line naming it and why; and
 * section 98-r2 G1b reads the served ledger and FAILs a checked vendor over
 * 20% unknown.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import * as reads from "../../scripts/employer-reads.mjs";

vi.setConfig({ testTimeout: 90_000 });

const FIX = resolve(__dirname, "fixtures/employer-reads");
const CHALLENGE = readFileSync(resolve(FIX, "workday-challenge-429.html"), "utf8");

const wd = (n: number) => ({ id: `workday:acme${n}~wd1~Careers:R-1000${n}`, applyUrl: `https://acme${n}.wd1.myworkdayjobs.com/en-US/Careers/job/US-Remote/Analyst_R-1000${n}` });
const gh = (n: number) => ({ id: `greenhouse:acme:${3000 + n}`, applyUrl: `https://job-boards.greenhouse.io/acme/jobs/${3000 + n}` });

describe("every unknown answer is counted with its reason", () => {
  it("a deadline that runs out after three of six rows, and a vendor that answers with a challenge", async () => {
    let clock = 0;
    const asked: string[] = [];
    const fetchImpl = async (url: string) => {
      asked.push(url);
      clock += 1000;
      const challenged = url.includes("myworkdayjobs.com");
      return { status: challenged ? 429 : 200, url, text: async () => (challenged ? CHALLENGE : "{}"), headers: { get: () => null } };
    };
    const rows = [wd(1), gh(1), wd(2), gh(2), gh(3), gh(4)];
    const out = await reads.readEmployers(rows, { fetchImpl, budgetMs: 2_500, now: () => clock, concurrency: 1, retryDelayMs: 1 });
    expect(asked).toHaveLength(3);
    const s = reads.summarizeEmployerReads(out);
    expect(s).toMatchObject({ checked: 6, open: 1, closed: 0, unknown: 5 });
    expect(s.why).toEqual({ budget: 3, challenge: 2 });
    expect(s.byVendor.workday).toEqual({ open: 0, closed: 0, unknown: 2, why: { challenge: 2 } });
    expect(s.byVendor.greenhouse).toEqual({ open: 1, closed: 0, unknown: 3, why: { budget: 3 } });
    expect(reads.employerReadLine(s)).toMatch(/greenhouse 1\/0\/3 \(budget 3\), workday 0\/0\/2 \(challenge 2\)/);
  });

  it("names each reason the reader gives", () => {
    const cases: Array<[string, string]> = [
      ["budget", "budget"],
      ["its own site's list did not answer (budget)", "budget"],
      ["challenge", "challenge"],
      ["vendor challenged", "vendor challenged"],
      ["no answer (timeout)", "timeout"],
      ["no answer (fetch failed)", "network"],
      ["HTTP 429", "429"],
      ["board HTTP 403", "403"],
      ["404 (the applyUrl slug may be wrong)", "404"],
      ["HTTP 503", "5xx"],
      ["HTTP 418", "other HTTP"],
      ["implausible: 9 of 10 workday answers said closed", "implausible closure"],
      ["not listed on this site", "not listed"],
      ["not read for state", "stated only"],
      ["applyUrl is not a Workday job address", "no plan"],
      ["200 without jobPostingInfo", "other"],
    ];
    for (const [why, reason] of cases) expect(reads.unknownReason(why), why).toBe(reason);
  });
});

describe("the bake's FAIL-tier line names a vendor whose closures are not being seen", () => {
  // The served ledger's counts of 2026-11-18, with the reasons a run under
  // today's challenge would give them.
  const summary = {
    checked: 513, open: 185, closed: 0, unknown: 328, why: {},
    byVendor: {
      workday: { open: 26, closed: 0, unknown: 276, why: { challenge: 3, "vendor challenged": 273 } },
      ukg: { open: 0, closed: 0, unknown: 15, why: { "stated only": 15 } },
      icims: { open: 20, closed: 0, unknown: 10, why: { budget: 10 } },
      paylocity: { open: 11, closed: 0, unknown: 9, why: { budget: 9 } },
      oracle: { open: 29, closed: 0, unknown: 6, why: { "not listed": 6 } },
      lever: { open: 1, closed: 0, unknown: 3, why: { budget: 3 } },
    },
  };
  it("names Workday, and why", () => {
    const lines = reads.employerReadAlarms(summary);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^EMPLOYER READS FAIL: workday answered for 26 of 302 pages \(276 unknown, 91%: vendor challenged 273, challenge 3\)/);
  });
  it("names no vendor read for its statements only, none under 20 pages, none at half or under", () => {
    const text = reads.employerReadAlarms(summary).join("\n");
    for (const v of ["ukg", "icims", "paylocity", "oracle", "lever"]) expect(text).not.toMatch(new RegExp(`: ${v} `));
  });
  it("the bake prints the lines at the error tier", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    expect(src).toMatch(/for \(const line of employerReadAlarms\(summary\)\) console\.error\(/);
  });
});

/**
 * SECTION 98-r2 G1b CAN FAIL WHAT IT CLAIMS: run against a stubbed site whose
 * ledger records the bake's employer reads, once with Workday over 20%
 * unknown (and once from a bake with no reasons), once under.
 */
const ROOT = resolve(__dirname, "../..");
const SITE = "https://site.test";
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });
const FETCH_STUB = `const fs=require("fs");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
globalThis.fetch=async(url,init)=>{const u=String(url);
if(init&&init.method&&init.method!=="GET")throw new Error("not a GET: "+init.method+" "+u);
const r=routes.find((x)=>new RegExp(x.match).test(u));
if(!r)return new Response("",{status:404,headers:{"content-type":"text/plain"}});
return new Response(r.body??"",{status:r.status??200,headers:{"content-type":r.type??"text/html"}});};
`;
type Route = { match: string; status?: number; body?: string; type?: string };
function runSection(routes: Route[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), "vd-98r2-g1b-"));
  dirs.push(dir);
  writeFileSync(join(dir, "fetch.cjs"), FETCH_STUB);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "run.sh"), `set -u\nSITE=${SITE}; UA=ua\n. ${JSON.stringify(resolve(ROOT, "scripts/verify-deploy.d/98-seo-r2.sh"))}\n`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "fetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 85_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return out.split("\n").filter(Boolean);
}
const esc = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (lines: string[], level: string, re: RegExp) => lines.some((l) => l.startsWith(level) && re.test(l));
const show = (lines: string[]) => lines.join("\n");
const P = "/jobs/posting/greenhouse/acme/1001";
function site(employerReads: unknown): Route[] {
  return [
    { match: `^${esc(`${SITE}/sitemap.xml`)}$`, body: `<urlset><url><loc>${SITE}${P}</loc></url></urlset>`, type: "application/xml" },
    { match: `^${esc(`${SITE}/prerender-ledger.json`)}$`, body: JSON.stringify({ postings: { [P]: { state: "live", applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1001" } }, employerReads }), type: "application/json" },
    { match: "^https://boards-api\\.greenhouse\\.io/v1/boards/acme/jobs/1001$", body: "{}", type: "application/json" },
  ];
}
describe("section 98-r2 G1b judges the bake's own employer reads", () => {
  const bad = runSection(site({ at: "2026-11-18", checked: 330, open: 46, closed: 0, unknown: 284, byVendor: { workday: { open: 26, closed: 0, unknown: 276, why: { challenge: 3, "vendor challenged": 273 } }, greenhouse: { open: 20, closed: 0, unknown: 8, why: { budget: 8 } }, ukg: { open: 0, closed: 0, unknown: 15, why: { "stated only": 15 } } } }));
  const old = runSection(site({ at: "2026-11-18", checked: 302, open: 26, closed: 0, unknown: 276, byVendor: { workday: { open: 26, closed: 0, unknown: 276 } } }));
  const good = runSection(site({ at: "2026-11-19", checked: 330, open: 320, closed: 4, unknown: 6, byVendor: { workday: { open: 290, closed: 4, unknown: 6, why: { timeout: 6 } }, greenhouse: { open: 30, closed: 0, unknown: 0 } } }));

  it("FAILs a checked vendor over 20% unknown, naming why, and prints its challenges apart", () => {
    expect(has(bad, "FAIL", /G1b workday: 276 of 302 posting pages unknown at the employer in the bake of 2026-11-18 \(91\.4%, over 20%\): vendor challenged 273, challenge 3/), show(bad)).toBe(true);
    expect(has(bad, "FAIL", /G1b greenhouse: 8 of 28 .*budget 8/), show(bad)).toBe(true);
    expect(has(bad, "INFO", /G1b workday: bot challenges in the bake of 2026-11-18: 3 answered with a challenge, 273 not asked after three/), show(bad)).toBe(true);
    expect(has(bad, "FAIL", /G1b ukg/), show(bad)).toBe(false);
    expect(has(bad, "PASS", /G1b /), show(bad)).toBe(false);
  });
  it("FAILs a ledger whose unknown answers carry no reason", () => {
    expect(has(old, "FAIL", /G1b the ledger of 2026-11-18 counts unknown employer answers with no reason \(workday 276\)/), show(old)).toBe(true);
  });
  it("PASSes when every checked vendor is at most 20% unknown", () => {
    expect(has(good, "PASS", /G1b every vendor the bake of 2026-11-19 checked at the employer is at most 20% unknown \(workday 6 of 300, greenhouse 0 of 30\)/), show(good)).toBe(true);
    expect(good.filter((l) => /^FAIL\s+G1b/.test(l)), show(good)).toEqual([]);
  });
});
