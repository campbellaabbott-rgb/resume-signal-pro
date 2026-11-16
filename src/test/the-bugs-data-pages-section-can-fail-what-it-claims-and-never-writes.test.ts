// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz-bugs-data-pages CAN FAIL WHAT IT CLAIMS, NEVER
 * FAILS ON TODAY'S PRODUCTION, WAITS FOR THE OWNER, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-data-pages.sh judges the data-pages
 * lane of the 2026-11-08 bug round: seven migrations through their anon
 * readers, five page chunks, the bake and llms.txt. Run here against a fake
 * curl and a ledger of the test's own:
 *   - production as it is today (no band_floor, the old chunks, the old bake)
 *     prints no FAIL, and the owner lines say 'owner pending';
 *   - a good deploy with the owner's answers prints PASS for every claim;
 *   - each regression after the deploy prints FAIL;
 *   - every request is a GET or an OPTIONS, and the key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { FREE_SCANS_PER_DAY, SIGNED_IN_SCANS_PER_DAY } from "@/config/scan-allowance";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-data-pages.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_bdp";
const P = "https://p\\.supabase\\.co";
const S = "https://site\\.test";

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

function run(routes: Route[], ownerDecided: Record<string, string> = {}): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbdp-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "ledger.json"), JSON.stringify({ reservations: { "bug-round": { ownerDecided } } }));
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VDDP_LEDGER: join(dir, "ledger.json"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

const page = (body: string, head = "") => `<html><head><title>t</title>${head}</head><body>${body}</body></html>`;
const desc = (d: string) => `<meta name="description" content="${d}" />`;
const crumb = '<script type="application/ld+json">{"@type":"BreadcrumbList"}</script>';
const PWC = "pwc~wd3~Global_Experienced_Careers";
const companiesRow = (n: string) => `<li><a href="/jobs/company/${PWC}" class="text-primary hover:underline">PwC</a> <span class="text-muted-foreground">— ${n} open roles</span></li>`;
const ALLOW = `${FREE_SCANS_PER_DAY} free scans a day (${SIGNED_IN_SCANS_PER_DAY} with a free account)`;

// The page chunks as production serves them today (2026-11-15, cut to their tells) ...
const OLD_CHUNKS = {
  GhostJobIndex: 'n.toLocaleString();"roles an employer took down";"company feeds in the rotation"',
  HiringTrends: "d.toLocaleDateString()",
  PayTransparencyIndex: "x.toLocaleString()",
  ScoreStudy: '"minimum 25 scans per bucket"',
  DataApi: '"GET /v1/changes"',
};
// ... and as this branch builds them.
const NEW_CHUNKS = {
  GhostJobIndex: 'n.toLocaleString("en-US");"data-ghost-stats-carried";"closure events";"job boards we read that hold a live posting";"but this is the latest run on record"',
  HiringTrends: '"data-trends-as-of";d.toLocaleString("en-US")',
  PayTransparencyIndex: '"data-pay-carried"',
  ScoreStudy: '"data-band-floor-hidden"',
  DataApi: '"GET /v1/jobs/{id}/application";"settledThrough";"resumeCursor"',
};

type Bake = Record<string, string>;
const OLD_BAKE: Bake = {
  "/ghost-job-index": page("31,304 — company feeds in the rotation. recomputed every 30 minutes. recomputed once an hour"),
  "/trust": page("No signup and no card — 7 free scans a day."),
  "/agents": page("100 calls a day per network address"),
  "/affiliates": page("a dashboard that shows referrals and earnings over any date range you pick."),
  "/data-api": page("<h2>Query it yourself</h2><ul><li><code>GET /v1/changes</code></li></ul>"),
  "/companies": page(companiesRow("891")),
  [`/jobs/company/${PWC}`]: "<html><head><title>PwC jobs: 2,008 open roles across 3 hiring-system boards</title></head></html>",
  "/ats/lever": page("", desc("Yes. Lever&#39;s section detection expects standard headers.")),
  "/ats/workday": page("", desc("Unreliably. Multi-column layouts frequently scramble Workday&#39;s parser.")),
  "/research/ats-score-benchmarks": page('{"@type":"Article"}'),
  "/es/normas-cv/espana": page('{"@type":"FAQPage"}'),
  "/es/industrias/legal": page("derecho", desc("abogado, derecho, contrato")),
  "/es/industrias/finance": page("finanzas", desc("contabilidad, finanzas")),
  "/jobs": page("<li><a>Customer Service Banker</a> — Group withMVSB wtag, Hooksett, NH, US</li>"),
  "/jobs/company/usasurveyjob": page("Usasurveyjob jobs: 502 open roles", '<meta name="robots" content="index, follow" />'),
  "/zz-not-real": page('<script>if(location.pathname!=="/"){var r=1}</script>'),
  "/jobs/posting/workday/hcmportal~wd5~Search/R26040621": page('{"addressCountry":"US","addressRegion":"AR"}'),
};
const NEW_BAKE: Bake = {
  ...OLD_BAKE,
  "/ghost-job-index": page('31,304 — job boards we read that hold a live posting. recomputed every 15 minutes. recomputed once an hour. "license":"https://creativecommons.org/licenses/by/4.0/"'),
  "/trust": page(`No signup and no card — ${ALLOW}.`),
  "/agents": page("100 calls a day for each internet connection an app calls from. Your calls come from your own internet connection: 100 a day."),
  "/affiliates": page("a dashboard that shows referrals and earnings over the last 7, 30, 90 or 365 days."),
  "/data-api": page("<h2>Query it yourself</h2><ul><li><code>GET /v1/jobs/{id}/application</code></li><li><code>GET /v1/changes</code> settledThrough resumeCursor</li></ul>"),
  "/companies": page(companiesRow("2,008")),
  "/ats/lever": page("", desc("Lever&#39;s section detection expects standard headers.") + crumb),
  "/ats/workday": page("", desc("Multi-column layouts frequently scramble Workday&#39;s parser.")),
  "/research/ats-score-benchmarks": page(crumb),
  // The trail is shown and marked up in Spanish (SEO-F18, the review).
  "/es/normas-cv/espana": page(`<nav class="text-xs"><a href="/">Inicio</a> / <a href="/cv-standards">Normas de CV</a> / <span>España</span></nav>`, '<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Inicio"}]}</script>'),
  "/es/industrias/legal": page("litigios, juzgado", desc("Abogado, derecho, litigios")),
  "/es/industrias/finance": page("contador", desc("Contabilidad, finanzas")),
  "/jobs": page("<li><a>Customer Service Banker</a> — the employer, Hooksett, NH, US</li>"),
  "/jobs/company/usasurveyjob": page("Usasurveyjob jobs", '<meta name="robots" content="noindex, follow" />'),
  "/zz-not-real": page('<script>if(location.pathname!=="/"){var m=document.querySelector(\'meta[name="robots"]\');if(m)m.setAttribute("content","noindex, follow")}</script>'),
};
const OLD_LLMS = "GET /v1/jobs, /v1/changes. A rescan returns the cached result. every quoted line checked";
const NEW_LLMS = "GET /v1/jobs, /v1/jobs/{id}/application, /v1/changes. A rescan of the same file against the same job posting within 7 days returns the same full report under the same report ID; a partial report is not kept, so a rescan after one runs again. every quoted line checked";

const OVERALL = { n: 190, median: 52, p25: 44, p75: 61, pct_under_50: 41 };
const SI_OLD = { overall: { ...OVERALL, pct_80_plus: 0 }, histogram: [{ bucket: 0, n: 2 }, { bucket: 30, n: 40 }, { bucket: 40, n: 60 }] };
const SI_NEW = { overall: { ...OVERALL, pct_80_plus: null }, histogram: [{ bucket: 30, n: 40 }, { bucket: 40, n: 60 }], histogram_hidden_n: 2, band_floor: 25 };
const FIN_OLD = { oscar: { series: [{ fy: 2025, revenue: 28_600_000, net_income: 100_000_000 }] }, affirm: { series: [{ fy: 2025, revenue: 1_110_000_000, net_income: 52_000_000 }] } };
const FIN_NEW = { oscar: { series: [{ fy: 2025, revenue: 11_700_000_000, net_income: 100_000_000, revenue_basis: "0001-25" }] }, affirm: { series: [{ fy: 2025, revenue: 3_220_000_000, net_income: 52_000_000 }] } };
const FC_OLD = [{ company_token: "Fonio", fills_90d: 38, filled_roles_90d: 19 }, { company_token: "ATEXIS", fills_90d: 116, filled_roles_90d: 90 }];
const FC_NEW = [{ company_token: "Fonio", fills_90d: 19, filled_roles_90d: 19 }, { company_token: "ATEXIS", fills_90d: 90, filled_roles_90d: 90 }];
const GJI_OLD = [{ total_open: 794317, computed_at: "2026-11-16T03:05:00Z" }];
const GJI_NEW = [{ total_open: 794000, computed_at: "2026-11-16T03:05:00Z", stale_parts: [], open_window_days: 30 }];
const EC = { chip_coverage: { open: 794100, at: "2026-11-16T03:10:00Z" } };
const WEEKS = [{ week_start: "2026-11-02", new_postings: 130, closed: 13 }, { week_start: "2026-11-09", new_postings: 40, closed: 4 }];
const CRON = [{ ch_jobname: "refresh-ghost-stats", ch_schedule: "15 * * * *", ch_active: true }, { ch_jobname: "job-board-stats-rollup", ch_schedule: "*/15 * * * *", ch_active: true }];
const SC_NEW = { actively_hiring: { computed_at: "2026-11-16T03:00:00Z", rows: [{ company_token: "hilton~wd3~Careers" }, { company_token: "aecom~wd5~External" }] } };
const LANDERS_OLD = { [PWC]: `/jobs/company/${PWC}` };
const LANDERS_NEW = { ...LANDERS_OLD, "pwc~wd3~US_Experienced_Careers": `/jobs/company/${PWC}` };
const NOFN = (f: string) => ({ status: 404, body: JSON.stringify({ code: "PGRST202", message: `Could not find the function public.${f}` }) });

type Over = Partial<{
  chunks: Partial<typeof NEW_CHUNKS>; bake: Bake; llms: string; landers: unknown;
  si: unknown; fin: Record<string, unknown>; trend: { status?: number; body?: string }; weeks: unknown; fc: unknown; gji: unknown; cron: unknown; sc: unknown; fks: string | null;
}>;

function routes(deployed: boolean, o: Over = {}): Route[] {
  const chunks = { ...(deployed ? NEW_CHUNKS : OLD_CHUNKS), ...o.chunks };
  const bake = { ...(deployed ? NEW_BAKE : OLD_BAKE), ...o.bake };
  const fin = { ...(deployed ? FIN_NEW : FIN_OLD), ...o.fin } as Record<string, unknown>;
  const rx = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const llms = o.llms ?? (deployed ? NEW_LLMS : OLD_LLMS);
  return [
    { match: `^GET ${S}/$`, body: '<html><head><script type="module" src="/assets/index-A1.js"></script></head></html>' },
    { match: `^GET ${S}/assets/index-A1\\.js$`, body: Object.keys(chunks).map((c) => `"assets/${c}-X1.js"`).join(",") },
    ...Object.entries(chunks).map(([c, body]) => ({ match: `^GET ${S}/assets/${c}-X1\\.js$`, body })),
    ...Object.entries(bake).map(([p, body]) => ({ match: `^GET ${S}${rx(p)}$`, body })),
    { match: `^GET ${S}/landers\\.json$`, body: JSON.stringify(o.landers ?? (deployed ? LANDERS_NEW : LANDERS_OLD)) },
    { match: `^GET ${S}/llms\\.txt$`, body: llms },
    { match: `^GET ${S}/llms-full\\.txt$`, body: deployed ? "GET /v1/jobs, /v1/jobs/{id}/application" : "GET /v1/jobs" },
    { match: `^GET ${P}/rest/v1/rpc/get_public_scan_insights$`, body: JSON.stringify(o.si ?? (deployed ? SI_NEW : SI_OLD)) },
    ...["oscar", "mtb~wd5~mtb", "uhaul~wd1~UhaulJobs", "affirm"].map((t) => ({ match: `^GET ${P}/rest/v1/rpc/get_company_financials\\?p_token=${rx(t)}$`, body: JSON.stringify(fin[t] ?? { series: [] }) })),
    { match: `^GET ${P}/rest/v1/rpc/get_trending_categories\\?p_watch_days=14$`, ...(o.trend ?? (deployed ? { body: "[]" } : NOFN("get_trending_categories"))) },
    { match: `^GET ${P}/rest/v1/rpc/get_hiring_trends$`, body: JSON.stringify(o.weeks ?? WEEKS) },
    { match: `^GET ${P}/rest/v1/rpc/get_company_fill_curve\\?p_tokens=`, body: JSON.stringify(o.fc ?? (deployed ? FC_NEW : FC_OLD)) },
    { match: `^GET ${P}/rest/v1/rpc/get_ghost_job_index_stats$`, body: JSON.stringify(o.gji ?? (deployed ? GJI_NEW : GJI_OLD)) },
    { match: `^GET ${P}/rest/v1/rpc/get_explore_cache$`, body: JSON.stringify(EC) },
    { match: `^GET ${P}/rest/v1/rpc/get_stats_cache$`, body: JSON.stringify(o.sc ?? SC_NEW) },
    { match: `^GET ${P}/rest/v1/rpc/get_cron_health\\?p_hours=26$`, body: JSON.stringify(o.cron ?? CRON) },
    { match: `^OPTIONS ${P}/functions/v1/free-keyword-scan$`, headers: o.fks === null ? {} : { "x-fn-build": o.fks ?? (deployed ? "free-keyword-scan.2026-11-15.2" : "free-keyword-scan.2026-11-09.2") } },
  ];
}

const OWNERS = { "NB-5": "exclude staffing boards", "SEO-F24": "CC BY 4.0", "SEO-F03": "noindex", "SEO-F10": "not indexable: noindex", "RC-S12-016": "cache" };
const has = (lines: string[], verdict: string, re: RegExp) => lines.some((l) => l.startsWith(verdict) && re.test(l));
const show = (lines: string[]) => lines.join("\n");
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const CLAIMS = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "B12", "B14", "O1", "O2", "O3", "O4", "O5"];

describe("on production as it is today", () => {
  const { lines, calls, out } = run(routes(false));
  it("prints no FAIL, and the stages say nothing is live", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.some((l) => /stages: database pending.*frontend not published.*bake not published/.test(l)), show(lines)).toBe(true);
  });
  it("prints a line for every claim, and every line is a verdict", () => {
    for (const c of [...CLAIMS, "B13"]) expect(lines.some((l) => new RegExp(`^(PASS|FAIL|INFO)  ${c} `).test(l)), `${c}\n${show(lines)}`).toBe(true);
    for (const l of lines.slice(1)) expect(l, show(lines)).toMatch(/^(PASS|FAIL|INFO)  /);
  });
  it("says 'owner pending' on each owner line while ownerDecided is empty", () => {
    for (const c of ["O1 NB-5", "O2 SEO-F24", "O3 SEO-F03", "O4 SEO-F10", "O5 RC-S12-016"]) expect(has(lines, "INFO", new RegExp(`^INFO  ${c} owner pending`)), `${c}\n${show(lines)}`).toBe(true);
  });
  it("asks with GET or OPTIONS only, and never prints the key", () => {
    expect(calls.length).toBeGreaterThan(30);
    for (const c of calls) expect(c, c).toMatch(/^curl\t(GET|OPTIONS) /);
    expect(out).not.toContain(KEY);
  });
});

describe("after a good deploy with the owner's answers", () => {
  const { lines } = run(routes(true), OWNERS);
  it("passes every claim", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of CLAIMS) expect(has(lines, "PASS", new RegExp(`^PASS  ${c} `)), `${c}\n${show(lines)}`).toBe(true);
    expect(lines.some((l) => /stages: database live.*frontend published.*bake published/.test(l)), show(lines)).toBe(true);
  });
});

describe("each regression after the deploy is a FAIL", () => {
  const cases: Array<[string, Over, Record<string, string>?]> = [
    ["D1", { fin: { oscar: FIN_OLD.oscar } }],
    ["D2", { trend: NOFN("get_trending_categories") }],
    ["D3", { weeks: [{ week: "2026-11-09" }] }],
    ["D4", { fc: FC_OLD }],
    ["D5", { gji: [{ ...GJI_NEW[0], stale_parts: undefined }] }],
    ["D6", { gji: [{ ...GJI_NEW[0], open_window_days: null }] }],
    ["D7", { si: { ...SI_NEW, histogram: [...SI_NEW.histogram, { bucket: 70, n: 8 }] } }],
    ["F1", { chunks: { PayTransparencyIndex: '"pay"' } }],
    ["F2", { chunks: { GhostJobIndex: NEW_CHUNKS.GhostJobIndex + ';"roles an employer took down"' } }],
    ["F3", { bake: { "/ghost-job-index": NEW_BAKE["/ghost-job-index"] + "company feeds" } }],
    ["F4", { chunks: { ScoreStudy: '"score"' } }],
    ["F5", { chunks: { GhostJobIndex: NEW_CHUNKS.GhostJobIndex.replace("but this is the latest run on record", "We run this audit every day.") } }],
    ["F6", { chunks: { ScoreStudy: '"data-band-floor-hidden";n.toLocaleString()' } }],
    ["F7", { chunks: { DataApi: '"GET /v1/jobs/{id}/application"' } }],
    ["B1", { llms: NEW_LLMS.replace("/v1/jobs/{id}/application, ", "") }],
    ["B2", { llms: NEW_LLMS.replace("same full report", "same result") }],
    ["B3", { bake: { "/trust": page("No signup and no card — 7 free scans a day. with a free account)") } }],
    ["B4", { bake: { "/agents": NEW_BAKE["/agents"] + " per network address" } }],
    ["B5", { bake: { "/affiliates": page("over the last 7, 30, 90 or 365 days. any date range you pick") } }],
    ["B6", { landers: LANDERS_OLD }],
    ["B7", { bake: { "/es/industrias/legal": page("litigios", desc("abogado, derecho, litigios")) } }],
    ["B8", { cron: [{ ch_jobname: "job-board-stats-rollup", ch_schedule: "*/20 * * * *", ch_active: true }] }],
    ["B9", { bake: { "/companies": page(companiesRow("891")) } }],
    ["B10", { bake: { "/es/normas-cv/espana": page('{"@type":"FAQPage"}') } }],
    // An English trail marked up on a page that shows none (the review of SEO-F18).
    ["B10", { bake: { "/es/normas-cv/espana": page("<h1>Normas</h1>", '<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home"}]}</script>') } }],
    ["B11", { bake: { "/ats/workday": OLD_BAKE["/ats/workday"] } }],
    ["B12", { bake: { "/jobs": OLD_BAKE["/jobs"] } }],
    ["B13", { bake: { "/jobs/posting/workday/hcmportal~wd5~Search/R26040621": page('{"addressCountry":"US"}', '<meta name="x-rb-employer-stated" content="{&quot;address&quot;:{&quot;addressLocality&quot;:&quot;Tortuguitas&quot;,&quot;addressCountry&quot;:&quot;Argentina&quot;}}" />') } }],
    ["B14", { fks: null }],
    ["O1", { sc: { actively_hiring: { computed_at: "2026-11-16T03:00:00Z", rows: [{ company_token: "weekday-1" }] } } }, OWNERS],
    ["O2", { bake: { "/ghost-job-index": page("31,304 — job boards we read that hold a live posting. recomputed every 15 minutes. recomputed once an hour") } }, OWNERS],
    ["O3", { bake: { "/jobs/company/usasurveyjob": OLD_BAKE["/jobs/company/usasurveyjob"] } }, OWNERS],
    ["O4", { bake: { "/zz-not-real": OLD_BAKE["/zz-not-real"] } }, OWNERS],
  ];
  for (const [claim, over, owners] of cases) {
    it(`${claim}`, () => {
      const { lines } = run(routes(true, over), owners ?? OWNERS);
      expect(has(lines, "FAIL", new RegExp(`^FAIL  ${claim} `)), `${claim}\n${show(lines)}`).toBe(true);
    });
  }
});

describe("B14 waits for the round's grounded engine, not for the NB-1 hotfix above the floor date", () => {
  it("free-keyword-scan.2026-11-15.1 (the hotfix, no grounding) is INFO, never a PASS for the llms.txt promise", () => {
    const { lines } = run(routes(true, { fks: "free-keyword-scan.2026-11-15.1" }), OWNERS);
    expect(has(lines, "PASS", /^PASS  B14 /), show(lines)).toBe(false);
    expect(has(lines, "INFO", /^INFO  B14 S14X-269 llms\.txt promises every quoted line checked while free-keyword-scan is at free-keyword-scan\.2026-11-15\.1/), show(lines)).toBe(true);
  });
  it("the round's free-keyword-scan.2026-11-15.2, or a later build, passes", () => {
    for (const fks of ["free-keyword-scan.2026-11-15.2", "free-keyword-scan.2026-11-20.1"]) {
      const { lines } = run(routes(true, { fks }), OWNERS);
      expect(has(lines, "PASS", /^PASS  B14 /), `${fks}\n${show(lines)}`).toBe(true);
    }
  });
});

describe("the owner's answer decides what an owner line judges", () => {
  it("a 'label' answer for NB-5 and a 'keep' answer for SEO-F10 print INFO, not a verdict on the other option", () => {
    const { lines } = run(routes(true), { ...OWNERS, "NB-5": "label them", "SEO-F10": "indexable: bake them" });
    expect(has(lines, "INFO", /^INFO  O1 NB-5 the owner chose to label/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /^INFO  O4 SEO-F10 the owner chose/), show(lines)).toBe(true);
  });
});
