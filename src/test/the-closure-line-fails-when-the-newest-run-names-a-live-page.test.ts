// @vitest-environment node
/**
 * THE CLOSURE LINE FAILS WHEN THE NEWEST RUN NAMES A LIVE PAGE (SEO audit
 * 2026-11-18b, STRUCTURED-B1 part 1).
 *
 * WHAT WAS WRONG. Posting-closure run 44431382185 (scheduled 2026-11-19
 * 00:44Z) found 7 live posting pages closed at their employer: Five Below
 * JR103021, Fresenius Medical Care R0217655, GDIT RQ230851-1, KnitWell
 * R-2038250, Mass General Brigham RQ4084036-1, PNC R217438-1 and RSM
 * JR101377. The bake retires only what scripts/seo-seed/closed-at-employer.txt
 * lists, the list held nothing but its header, and the 11-19 bake served all 7
 * in the sitemap with their JobPosting. Section 98zzz's R4 judges that list
 * alone, so an empty list printed INFO ("nothing to judge") and the deploy
 * check could not see the 7.
 *
 * WHAT HOLDS NOW. The committed list names the 7, dated the day the run found
 * them, so the next bake retires them. R4b reads the newest completed run
 * itself (gh run list, then gh run view --log) and judges every page it names
 * against the served site. It runs here in bash, sourced as verify-deploy.sh
 * sources it, with a fake gh on PATH answering with that run's own log
 * (src/test/fixtures/posting-closure-run-44431382185.log, its measuring step
 * as gh prints it) and a fetch stub serving the pages as the 11-19 bake did:
 * FAIL while any of them is in the sitemap, served with a JobPosting or
 * served without noindex; PASS once all 7 are retired; INFO only when the run
 * measured a day and named none; FAIL when gh cannot read the run or the run
 * printed no measured day. Nothing here reads the network.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { closedAtEmployerList } from "../../scripts/prerender-seo.mjs";

vi.setConfig({ testTimeout: 90_000 });

const ROOT = resolve(__dirname, "../..");
const SECTION = resolve(ROOT, "scripts/verify-deploy.d/98zzz-seo-1118-bake.sh");
const SITE = "https://site.test";
const RUN = 44431382185;
const RUN_LOG = readFileSync(resolve(__dirname, "fixtures/posting-closure-run-44431382185.log"), "utf8");
const RUNS = JSON.stringify([
  // A later slot still running is skipped: its log is not there yet.
  { databaseId: 44500000001, createdAt: "2026-11-19T10:43:15Z", status: "in_progress", conclusion: "" },
  { databaseId: RUN, createdAt: "2026-11-19T00:44:08Z", status: "completed", conclusion: "success" },
]);

/** The 7 pages run 44431382185 named, as the live 11-19 ledger held them (state "live" for every one). */
const W = "/jobs/posting/workday/";
const SEVEN: Array<{ path: string; title: string; company: string }> = [
  { path: `${W}fivebelow~wd1~fivebelowcareers/JR103021`, title: "merchandise manager", company: "Five Below" },
  { path: `${W}freseniusmedicalcare~wd3~fme/R0217655`, title: "Junior Field Service Technician", company: "Fresenius Medical Care" },
  { path: `${W}gdit~wd5~External_Career_Site/RQ230851-1`, title: "Systems Administrator LVL II (C4ISR)", company: "GDIT" },
  { path: `${W}knitwellgroup~wd1~US_Retail_Jobs/R-2038250`, title: "Sales Lead, Greengate Center", company: "KnitWell Group" },
  { path: `${W}massgeneralbrigham~wd1~MGBExternal/RQ4084036-1`, title: "Quality Assurance Team Leader", company: "Mass General Brigham" },
  { path: `${W}pnc~wd5~External/R217438-1`, title: "Quantitative Analytics & Model Development Analyst Senior - Data, Model & Analytics", company: "PNC" },
  { path: `${W}rsmaus~wd105~RSMCareers/JR101377`, title: "Senior Associate - Transaction Support", company: "RSM Australia" },
];
const OPEN = { path: "/jobs/posting/greenhouse/acme/4001", title: "Analyst", company: "Acme" };

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

const FETCH_STUB = `const fs=require("fs");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
globalThis.fetch=async(url,init)=>{const u=String(url);
if(init&&init.method&&init.method!=="GET")throw new Error("not a GET: "+init.method+" "+u);
const r=routes.find((x)=>x.url===u);
if(!r)return new Response("",{status:404,headers:{"content-type":"text/plain"}});
return new Response(r.body??"",{status:r.status??200,headers:{"content-type":r.type??"text/html"}});};
`;
// The fake gh logs every call and answers only the two reads R4b makes.
const FAKE_GH = `#!/bin/sh
printf '%s\\n' "$*" >> "$VD_GH_CALLS"
if [ "$1 $2" = "run list" ] && [ -s "$VD_GH_RUNS" ]; then cat "$VD_GH_RUNS"; exit 0; fi
if [ "$1 $2" = "run view" ] && [ "$3" = "$VD_GH_RUN" ] && [ -s "$VD_GH_LOG" ]; then cat "$VD_GH_LOG"; exit 0; fi
exit 1
`;

type Route = { url: string; status?: number; body?: string; type?: string };
type Served = "live" | "retired" | "gone" | { robots: string; ld: boolean } | { status: number };
const today = new Date().toISOString().slice(0, 10);
const page = (p: { title: string; company: string }, robots: string, ld: boolean) => `<!doctype html><html><head><meta name="robots" content="${robots}">${ld ? `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title: p.title, datePosted: today, hiringOrganization: { "@type": "Organization", name: p.company } })}</script>` : ""}</head><body><div id="root"><h1>${p.title}</h1></div></body></html>`;

/** The site, each of the 7 in the given state: "live" is in the sitemap, index, follow with its JobPosting, as the 11-19 bake served it. */
function site(state: (path: string) => Served, inSitemap: (path: string) => boolean = (p) => state(p) === "live"): Route[] {
  const listed = [OPEN.path, ...SEVEN.map((s) => s.path).filter(inSitemap)];
  const routes: Route[] = [
    { url: `${SITE}/sitemap.xml`, type: "application/xml", body: `<?xml version="1.0"?><urlset>${listed.map((p) => `<url><loc>${SITE}${p}</loc><lastmod>${today}</lastmod></url>`).join("")}</urlset>` },
    { url: `${SITE}/posting-pages.json`, type: "application/json", body: JSON.stringify({ at: today, live: listed }) },
    { url: `${SITE}/prerender-ledger.json`, type: "application/json", body: JSON.stringify({ postings: {} }) },
    { url: `${SITE}${OPEN.path}`, body: page(OPEN, "index, follow", false) },
  ];
  for (const s of SEVEN) {
    const st = state(s.path);
    if (st === "gone") continue;
    if (st === "live") routes.push({ url: `${SITE}${s.path}`, body: page(s, "index, follow", true) });
    else if (st === "retired") routes.push({ url: `${SITE}${s.path}`, body: page(s, "noindex, follow", false) });
    else if ("status" in st) routes.push({ url: `${SITE}${s.path}`, status: st.status, body: "" });
    else routes.push({ url: `${SITE}${s.path}`, body: page(s, st.robots, st.ld) });
  }
  return routes;
}

/** Sources the section in bash as verify-deploy.sh does; returns its lines and the gh calls it made. */
function runSection(routes: Route[], gh: { runs?: string; log?: string } = { runs: RUNS, log: RUN_LOG }, list = ""): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd-98zzz-r4b-"));
  dirs.push(dir);
  writeFileSync(join(dir, "fetch.cjs"), FETCH_STUB);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "closed.txt"), list);
  writeFileSync(join(dir, "runs.json"), gh.runs ?? "");
  writeFileSync(join(dir, "run.log"), gh.log ?? "");
  writeFileSync(join(dir, "calls.txt"), "");
  writeFileSync(join(dir, "gh"), FAKE_GH);
  chmodSync(join(dir, "gh"), 0o755);
  writeFileSync(join(dir, "run.sh"), `set -u\nSITE=${SITE}; UA=ua\n. ${JSON.stringify(SECTION)}\n`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${dir}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"),
    VD98ZZZ_LIST: join(dir, "closed.txt"),
    VD_GH_CALLS: join(dir, "calls.txt"),
    VD_GH_RUNS: join(dir, "runs.json"),
    VD_GH_LOG: join(dir, "run.log"),
    VD_GH_RUN: String(RUN),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "fetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 85_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.txt"), "utf8").split("\n").filter(Boolean) };
}
const r4b = (lines: string[]) => lines.filter((l) => /^\w+\s+R4b /.test(l));
const show = (lines: string[]) => lines.join("\n");
const RUN_NAME = "run 44431382185 \\(2026-11-19 00:44Z, success\\) measured 2026-11-19";

describe("the run's own log", () => {
  it("names the 7 pages, under a measured day", () => {
    expect(RUN_LOG).toMatch(/posting closure: 2026-11-19 checked 497: 467 open, 7 closed, 23 unknown/);
    const named = [...RUN_LOG.matchAll(/closed at the employer: (\S+)/g)].map((m) => m[1]);
    expect(named).toEqual(SEVEN.map((s) => s.path));
  });
});

describe("R4b, as the 11-19 bake served the 7 (in the sitemap, index, follow, with a JobPosting)", () => {
  const { lines, calls } = runSection(site(() => "live"));

  it("FAILs and names each page, while R4 reads the empty list as nothing to judge", () => {
    const fail = r4b(lines).find((l) => l.startsWith("FAIL"));
    expect(fail, show(lines)).toMatch(new RegExp(`^FAIL\\s+R4b the newest posting-closure ${RUN_NAME} and named 7 page\\(s\\) closed at the employer: 7 still served as open; `));
    expect(fail).toContain(`${SEVEN[0].path} is in the sitemap, serves no noindex, serves a JobPosting`);
    expect(r4b(lines).some((l) => l.startsWith("PASS")), show(lines)).toBe(false);
    expect(lines.some((l) => /^INFO\s+R4 the closed-at-employer list names no page dated in the last 14 days/.test(l)), show(lines)).toBe(true);
  });

  it("reads the newest completed run, not the one still running, with the two gh reads and no other", () => {
    expect(calls).toContain(`run view ${RUN} --log`);
    expect(calls.some((c) => c.startsWith("run view 44500000001")), calls.join("\n")).toBe(false);
    for (const c of calls) expect(c, c).toMatch(/^run (?:list --workflow posting-closure\.yml |view \d+ --log$)/);
  });
});

describe("R4b names each way a page still reads as open", () => {
  it("in the sitemap, served with a JobPosting, served without noindex, or not answering", () => {
    const [inMap, withLd, noNoindex, broken] = SEVEN.map((s) => s.path);
    const state = (p: string): Served =>
      p === withLd ? { robots: "noindex, follow", ld: true }
        : p === noNoindex ? { robots: "index, follow", ld: false }
          : p === broken ? { status: 500 }
            : "retired";
    const { lines } = runSection(site(state, (p) => p === inMap));
    const fail = r4b(lines).find((l) => l.startsWith("FAIL")) ?? "";
    expect(fail, show(lines)).toMatch(new RegExp(`^FAIL\\s+R4b the newest posting-closure ${RUN_NAME} and named 7 page\\(s\\) closed at the employer: 4 still served as open; `));
    expect(fail).toContain(`${inMap} is in the sitemap;`);
    expect(fail).toContain(`${withLd} serves a JobPosting;`);
    expect(fail).toContain(`${noNoindex} serves no noindex`);
    const alone = runSection(site((p) => (p === broken ? { status: 500 } : "retired"), () => false)).lines;
    expect(r4b(alone).find((l) => l.startsWith("FAIL")), show(alone)).toContain(`${broken} answered HTTP 500`);
  });
});

describe("R4b once the 7 are retired", () => {
  it("PASSes: none in the sitemap, each served noindex with no JobPosting, or not served at all", () => {
    const { lines } = runSection(site((p) => (p === SEVEN[6].path ? "gone" : "retired")));
    expect(r4b(lines).filter((l) => /^(?:PASS|FAIL)/.test(l)), show(lines)).toEqual([
      expect.stringMatching(new RegExp(`^PASS\\s+R4b the newest posting-closure ${RUN_NAME} and named 7 page\\(s\\) closed at the employer: none in the sitemap, none served with a JobPosting or without noindex$`)),
    ]);
  });
});

describe("R4b judges nothing only when the run named nothing", () => {
  it("INFO when the run measured a day and named no page", () => {
    const none = RUN_LOG.split("\n").filter((l) => !/closed at the employer:/.test(l)).join("\n");
    const { lines } = runSection(site(() => "live"), { runs: RUNS, log: none });
    expect(r4b(lines).filter((l) => /^(?:PASS|FAIL)/.test(l)), show(lines)).toEqual([]);
    expect(r4b(lines).some((l) => new RegExp(`^INFO\\s+R4b the newest posting-closure ${RUN_NAME} and named no page closed at its employer \\(nothing to judge\\)`).test(l)), show(lines)).toBe(true);
  });

  it("FAIL when the run printed no measured day", () => {
    const unread = "check\tMeasure the closed share and apply the rule\t2026-11-19T00:45:29.0000000Z posting closure: could not read the live sitemap\n";
    const { lines } = runSection(site(() => "live"), { runs: RUNS, log: unread });
    expect(r4b(lines), show(lines)).toEqual([expect.stringMatching(/^FAIL\s+R4b the newest posting-closure run 44431382185 \(2026-11-19 00:44Z, success\) printed no measured day, so it judged no page$/)]);
  });

  it("FAIL when gh answers nothing, lists no completed run, or gives no log", () => {
    const noGh = runSection(site(() => "live"), {}).lines;
    expect(r4b(noGh), show(noGh)).toEqual([expect.stringMatching(/^FAIL\s+R4b gh run list answered nothing/)]);
    const running = runSection(site(() => "live"), { runs: JSON.stringify([{ databaseId: 44500000001, createdAt: "2026-11-19T10:43:15Z", status: "in_progress", conclusion: "" }]), log: RUN_LOG }).lines;
    expect(r4b(running), show(running)).toEqual([expect.stringMatching(/^FAIL\s+R4b gh lists no completed posting-closure run \(1 listed\)/)]);
    const noLog = runSection(site(() => "live"), { runs: RUNS, log: "" }).lines;
    expect(r4b(noLog), show(noLog)).toEqual([expect.stringMatching(/^FAIL\s+R4b gh run view 44431382185 --log answered nothing/)]);
  });
});

describe("the committed list", () => {
  it("names the 7 pages the run found closed, dated 2026-11-19, so the next bake retires each one", () => {
    const text = readFileSync(resolve(ROOT, "scripts/seo-seed/closed-at-employer.txt"), "utf8");
    const m = closedAtEmployerList(text, "2026-11-19");
    for (const s of SEVEN) expect(m.get(s.path), s.path).toEqual({ date: "2026-11-19", basis: "employer" });
  });
});

describe("the section asks GitHub only to read", () => {
  it("its gh calls are run list and run view --log", () => {
    const src = readFileSync(SECTION, "utf8");
    const calls = [...src.matchAll(/\bgh\(\[([^\]]*)\]/g)].map((m) => m[1]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(/^"run", "list", "--workflow", "posting-closure\.yml"/);
    expect(calls[1]).toMatch(/^"run", "view", String\(run\.databaseId\), "--log"$/);
    expect(src).not.toMatch(/execFileSync\("gh", \[/);
  });
});
