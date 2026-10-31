// @vitest-environment node
/**
 * VERIFY SECTION 52b (THE CHANGELOG OF THE ONE DEPLOY) FAILS WHAT IT CLAIMS,
 * SAYS INFO BEFORE THE PUBLISH, AND ONLY READS.
 *
 * scripts/verify-deploy.d/52b-changelog-big-deploy.sh runs here in bash
 * against a fake curl, with the real build_ge cut from the verifier. The
 * healthy site is built from this checkout: the crawler /changelog in the
 * bake's own markup from the newest 30 entries, the US English changelog
 * chunk (found through scripts/verify-us-english.sh, as the section finds
 * it), a crawler /pricing with both products on sale and no place named as
 * unsold, the apply agent off, each function the entries describe at its
 * build, and a policy file whose verifiedDeploys records the deploy.
 *
 * THE ENTRIES WAIT FOR THE DEPLOY (land/all final recheck, 2026-10-31):
 * merging into main publishes the frontend by itself, so the seventeen
 * entries no longer ride in the deploy's merge. They wait in
 * docs/changelog-pending/one-deploy.json until the changelog step applies them
 * (scripts/apply-pending-changelog.mjs), dated the day the functions went
 * live. This test reads them from wherever they are: the pending file before
 * that step, the tree after it.
 *
 * Then each claim, broken on its own, prints its FAIL: a gate note or "open
 * soon" on /pricing, a territory refusal on /pricing or in the changelog
 * (land/all removed it: the owner, 2026-10-27, "Keep selling as today"), a
 * live agent, a title the crawler page lost, a title dropped from both, the
 * placeholder date, a date before land/all's last change, a date after the
 * deploy's record, a publish with no record at all, a description that names
 * another entry, and an older build.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/52b-changelog-big-deploy.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
type Text = { title: string; description: string };
const TREE_EN = (JSON.parse(readFileSync(resolve(ROOT, "src/i18n/changelog/en.json"), "utf8")) as { changelogEntries: Record<string, Text> }).changelogEntries;
/** The entries of src/data/changelog.ts, in its order: { id, date, tags }. */
const TREE = [...readFileSync(resolve(ROOT, "src/data/changelog.ts"), "utf8").matchAll(/\{ id: "([A-Za-z0-9]+)", date: "(\d{4}-\d{2}-\d{2})", tags: \[([^\]]*)\] \}/g)]
  .map((m) => ({ id: m[1], date: m[2], tags: m[3].split(",").map((t) => t.trim().replace(/"/g, "")).filter(Boolean) }));
const PENDING_FILE = resolve(ROOT, "docs/changelog-pending/one-deploy.json");
const PENDING = existsSync(PENDING_FILE)
  ? (JSON.parse(readFileSync(PENDING_FILE, "utf8")) as { date: string; entries: Array<{ key: string; category: string; en: Text }> })
  : null;
/** The day the healthy fixture's deploy went live and was recorded. */
const DAY = "2026-11-02";
const THIS_DEPLOY = PENDING
  ? PENDING.entries.map((e) => ({ id: e.key, date: DAY, tags: e.category.split(",").map((t) => t.trim()).filter(Boolean) }))
  : TREE.slice(0, 17);
/** The site after the changelog step: this deploy's entries above the tree's, and their English text. */
const ENTRIES = PENDING ? [...THIS_DEPLOY, ...TREE] : TREE;
const EN: Record<string, Text> = PENDING ? { ...TREE_EN, ...Object.fromEntries(PENDING.entries.map((e) => [e.key, e.en])) } : TREE_EN;
const PUBLISHED_DAY = PENDING ? DAY : THIS_DEPLOY[0].date;
const TITLES = THIS_DEPLOY.map((e) => EN[e.id].title);

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data")data=a[++i];else if(["-H","-m","-A"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
const key=method+" "+url+(data!==null?" "+data:"");
fs.appendFileSync(process.env.VD_CALLS,key+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
if(o&&o!=="/dev/null")fs.writeFileSync(o,r.body??"");else if(!o)out+=(r.body??"");
if(w)out+=w.replace("%{http_code}",String(st));
process.stdout.write(out);
`;

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TAG = { new: "New", improved: "Improved", fixed: "Fixed" } as Record<string, string>;

/** The crawler /changelog as the bake writes it (scripts/prerender-seo.mjs): its description and the newest 30 articles. */
function changelogPage(over: { titles?: (t: string) => string | null; date?: string; first?: string } = {}): string {
  const items = ENTRIES.slice(0, 30).map((e, i) => ({ ...e, title: i < 17 && over.titles ? over.titles(EN[e.id].title) : EN[e.id]?.title, date: i < 17 && over.date ? over.date : e.date }));
  const shown = items.filter((e) => e.title);
  const first = over.first ?? `${shown[0].date}): ${shown[0].title}`;
  return `<html><head><meta name="description" content="What changed and when, newest first — including honest postmortems. Latest (${esc(first)}."></head><body><main><h1>Changelog</h1><div class="space-y-4">${shown
    .map((e) => `<article class="rounded-xl border border-border bg-card p-4"><p class="text-xs text-muted-foreground mb-1">${esc(e.date)} · ${e.tags.map((t) => TAG[t] ?? t).join(" · ")}</p><h2 class="text-sm font-semibold text-foreground mb-1">${esc(e.title as string)}</h2></article>`)
    .join("")}</div></main></body></html>`;
}

/** The US English changelog chunk, as the build writes a lazy locale file. */
const chunkOf = (entries: Record<string, unknown>) => `const e=${JSON.stringify({ changelogEntries: entries })};export{e as default};`;
const PUBLISHED = chunkOf(EN);
const UNPUBLISHED = chunkOf(Object.fromEntries(Object.entries(EN).filter(([k]) => !THIS_DEPLOY.some((e) => e.id === k))));
const ENTRY = `const lazy=[()=>import("./rb-en_all-ALL00001.js"),()=>import("./en-CHLG0001.js"),()=>import("./en-GB-GBCL0001.js")];export{lazy as a};`;
const PRICING_OK = `<html><head><meta name="description" content="Search jobs and scan your résumé free. $5 once for a Full Analysis, or $45 a month for Pro's writing. All sales final."></head><body><main><h1>Pricing</h1><section data-plan="full-analysis"><p><a href="/resume-checker#upload">Buy the Full Analysis, $5</a></p><p>All sales are final.</p></section><section data-plan="pro"><p>Go Pro, $45 a month</p></section></main></body></html>`;
const BUILDS: Record<string, string> = {
  "process-email-queue": "process-email-queue.2026-10-14.2",
  "agent-mcp": "agent-mcp.2026-10-11.38",
  "job-board": "job-board.2026-09-09.96",
  "public-api": "public-api.2026-10-11.37",
  "free-keyword-scan": "free-keyword-scan.2026-10-31.1",
  "create-subscription-checkout": "create-subscription-checkout.2026-10-31.2",
  "delete-account": "delete-account.2026-10-14.25",
  "generate-cover-letter": "generate-cover-letter.2026-10-11.24",
  "parse-pdf": "parse-pdf.2026-10-11.26",
  "fetch-job-posting": "fetch-job-posting.2026-10-11.27",
};
const FN = "https://p\\.supabase\\.co";

interface Over { changelog?: string; chunk?: string; pricing?: string; agent?: string; builds?: Record<string, string | null>; recorded?: string | null }
function routes(over: Over = {}): Route[] {
  const builds = { ...BUILDS, ...(over.builds ?? {}) };
  return [
    ...Object.entries(builds).map(([fn, b]) => ({ match: `^OPTIONS ${FN}/functions/v1/${fn}$`, headers: b ? { "x-fn-build": b } : {} })),
    { match: "^GET https://site\\.test/changelog$", body: over.changelog ?? changelogPage() },
    { match: "^GET https://site\\.test/pricing$", body: over.pricing ?? PRICING_OK },
    { match: "^GET https://site\\.test/$", body: `<html><head><script type="module" crossorigin src="/assets/index-ENTRY001.js"></script></head><body></body></html>` },
    { match: "^GET https://site\\.test/assets/index-ENTRY001\\.js$", body: ENTRY },
    { match: "^GET https://site\\.test/assets/rb-en_all-ALL00001\\.js$", body: `const s={header:{jobs:"Jobs"}};` },
    { match: "^GET https://site\\.test/assets/en-CHLG0001\\.js$", body: over.chunk ?? PUBLISHED },
    // The British chunk carries every key too; the section must never read it.
    { match: "^GET https://site\\.test/assets/en-GB-GBCL0001\\.js$", body: PUBLISHED },
    { match: `^GET ${FN}/rest/v1/rpc/agent_sender_public_status$`, body: over.agent ?? "false" },
  ];
}

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(over: Over = {}): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd-52b-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes(over)));
  writeFileSync(join(dir, "calls.log"), "");
  // The policy file the date is judged against: the deploy recorded on its day (or not at all).
  const recorded = over.recorded === undefined ? PUBLISHED_DAY : over.recorded;
  writeFileSync(join(dir, "ledger.json"), JSON.stringify({ verifiedDeploys: [
    { date: "2026-10-17", functions: { "job-board": "job-board.2026-09-09.92" } },
    ...(recorded ? [{ date: recorded, functions: { "job-board": "job-board.2026-09-09.96" } }] : []),
  ] }));
  writeFileSync(join(dir, "run.sh"), `set -u\nK=pk_test; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n` + SECTION.split("/tmp/").join(`${dir}/`));
  let out = "";
  try {
    out = execFileSync("bash", [join(dir, "run.sh")], {
      cwd: ROOT,
      env: { ...process.env, PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`, VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VD52B_LEDGER: join(dir, "ledger.json") },
      encoding: "utf8", timeout: 50_000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean) };
}
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const has = (lines: string[], s: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${s}  `) && re.test(l.slice(s.length + 2)));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

describe("the premise: the seventeen entries 52b names wait for the deploy, or follow it", () => {
  it("52b's titles are this deploy's, in its order, each with an English title", () => {
    const listed = /<<'VD52B_TITLES'\n([\s\S]*?)\nVD52B_TITLES/.exec(SECTION)?.[1].split("\n") ?? [];
    expect(THIS_DEPLOY).toHaveLength(17);
    expect(listed).toEqual(TITLES);
    expect(THIS_DEPLOY[0].id).toBe("theHomePageIsTheJobSearch");
    expect(ENTRIES[17].id).toBe("workdayCompanyPagesLostTheirFacts");
  });

  it("while they are pending the tree carries none of them, and the pending file dates nothing", () => {
    if (!PENDING) {
      // After the changelog step: in the tree, newest first, on one day no earlier than land/all's last change.
      expect(new Set(THIS_DEPLOY.map((e) => e.date)).size).toBe(1);
      expect(THIS_DEPLOY[0].date >= "2026-10-31").toBe(true);
      return;
    }
    expect(PENDING.date).toBe("DATE_OF_DEPLOY");
    for (const e of THIS_DEPLOY) {
      expect(TREE.some((t) => t.id === e.id), `${e.id} is in changelog.ts before the deploy verified`).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(TREE_EN, e.id), `${e.id} is in en.json before the deploy verified`).toBe(false);
    }
  });

  it("no entry of this deploy names a territory refusal, a placeholder or a sale that opens soon", () => {
    for (const e of THIS_DEPLOY) {
      const t = `${EN[e.id].title} ${EN[e.id].description}`;
      expect(t, e.id).not.toMatch(/DATE_OF_DEPLOY|open soon|turns away buyers it places in the EU|not registered for VAT/i);
    }
  });
});

describe("section 52b on a healthy deploy, after the publish", () => {
  it("prints no FAIL, passes every title, the date, the description and each precondition, and only sends GET and OPTIONS", () => {
    const { lines, calls } = run();
    expect(fails(lines), show(lines)).toEqual([]);
    expect(has(lines, "PASS", /^the US English changelog chunk \(en-CHLG0001\.js\) carries this deploy's entries/), show(lines)).toBe(true);
    for (const t of TITLES) expect(has(lines, "PASS", new RegExp(`^/changelog serves crawlers "${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"$`)), t).toBe(true);
    expect(has(lines, "PASS", new RegExp(`^/changelog dates this deploy's entries ${PUBLISHED_DAY} \\(the deploy was recorded ${PUBLISHED_DAY}\\)$`)), show(lines)).toBe(true);
    expect(has(lines, "PASS", /^\/changelog's description names the newest entry/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /^the crawler \/pricing prints no not-on-sale note and no purchases-open-soon line/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /^neither \/pricing nor the changelog speaks of an EU\/EEA\/UK\/India refusal/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /^agent_sender_public_status answers false/), show(lines)).toBe(true);
    expect(lines.filter((l) => /^PASS {2}[a-z-]+ x-fn-build = /.test(l))).toHaveLength(Object.keys(BUILDS).length);
    for (const l of lines) expect(l, l).toMatch(/^(PASS|FAIL|INFO|==) /);
    expect(calls.some((c) => c.includes("en-GB-")), "the section read the British chunk").toBe(false);
    for (const c of calls) expect(c, c).toMatch(/^(GET|OPTIONS) /);
  });
});

describe("before the publish every judged line is INFO", () => {
  it("the chunk without this deploy's entries: titles, date, description, sale, territory and agent are INFO, and nothing FAILs", () => {
    const { lines } = run({ chunk: UNPUBLISHED, changelog: changelogPage({ titles: () => null }), pricing: PRICING_OK.replace("</main>", '<p data-gate="seller">Not on sale yet. Purchases open soon.</p></main>'), agent: "true", builds: { "job-board": "job-board.2026-09-09.92" } });
    expect(fails(lines), show(lines)).toEqual([]);
    expect(has(lines, "INFO", /does not carry this deploy's entries yet/), show(lines)).toBe(true);
    for (const t of TITLES) expect(has(lines, "INFO", new RegExp(`^/changelog does not serve "${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" yet`)), t).toBe(true);
    expect(has(lines, "INFO", /^the sale and territory claims are judged after the publish/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /^job-board x-fn-build = job-board\.2026-09-09\.92: job-board\.2026-09-09\.96 is not serving yet/), show(lines)).toBe(true);
  });
});

describe("each claim can FAIL after the publish", () => {
  it("a gate note or 'open soon' on the crawler /pricing", () => {
    expect(has(run({ pricing: PRICING_OK.replace("</main>", '<p data-gate="delivery">Not on sale yet.</p></main>') }).lines, "FAIL", /^the crawler \/pricing prints a not-on-sale note \(data-gate="delivery"/)).toBe(true);
    expect(has(run({ pricing: PRICING_OK.replace("</main>", "<p>Paid extras are not on sale yet; purchases open soon.</p></main>") }).lines, "FAIL", /^the crawler \/pricing says purchases open soon/)).toBe(true);
  });

  it("a territory refusal on /pricing, or in the changelog, or in both: each is its own FAIL", () => {
    const refusal = "<p>Not sold in the EU, the EEA, the UK or India yet.</p></main>";
    const sentence = "Checkout now turns away buyers it places in the EU, the EEA, the UK or India, from the currency or the time zone their device reports.";
    const withSentence = chunkOf({ ...EN, aPricingPageThatStartsWithWhatIsFree: { ...EN.aPricingPageThatStartsWithWhatIsFree, description: `${EN.aPricingPageThatStartsWithWhatIsFree.description} ${sentence}` } });
    const page = run({ pricing: PRICING_OK.replace("</main>", refusal) }).lines;
    expect(has(page, "FAIL", /^the crawler \/pricing names the EU, the EEA, the UK or India/), show(page)).toBe(true);
    const entry = run({ chunk: withSentence }).lines;
    expect(has(entry, "FAIL", /^the changelog's pricing entry says checkout turns away buyers/), show(entry)).toBe(true);
    const both = run({ chunk: withSentence, pricing: PRICING_OK.replace("</main>", refusal) }).lines;
    expect(fails(both).filter((l) => /EU, the EEA, the UK or India/.test(l)), show(both)).toHaveLength(2);
    expect(both.some((l) => /^PASS .*EU\/EEA\/UK\/India/.test(l))).toBe(false);
  });

  it("a live apply agent", () => {
    expect(has(run({ agent: "true" }).lines, "FAIL", /^agent_sender_public_status answers true, but the changelog says the apply agent is switched off/)).toBe(true);
  });

  it("a title the crawler page lost (the prerender did not rebuild), and a title dropped from both", () => {
    const lost = run({ changelog: changelogPage({ titles: (t) => (t === TITLES[5] ? null : t) }) }).lines;
    expect(has(lost, "FAIL", new RegExp(`carry "${TITLES[5]}", but the crawler copy of /changelog does not`)), show(lost)).toBe(true);
    const dropped = Object.fromEntries(Object.entries(EN).filter(([k]) => k !== THIS_DEPLOY[8].id));
    const gone = run({ chunk: chunkOf(dropped), changelog: changelogPage({ titles: (t) => (t === TITLES[8] ? null : t) }) }).lines;
    expect(has(gone, "FAIL", new RegExp(`neither /changelog nor the US English changelog strings carry "${TITLES[8]}"`)), show(gone)).toBe(true);
  });

  it("the placeholder date, a date before land/all's last change, a date after the record, no record, and a description naming another entry", () => {
    const ph = run({ changelog: changelogPage({ date: "DATE_OF_DEPLOY" }) }).lines;
    expect(has(ph, "FAIL", /^\/changelog prints the placeholder DATE_OF_DEPLOY/), show(ph)).toBe(true);
    const early = run({ changelog: changelogPage({ date: "2026-10-30" }), recorded: "2026-11-02" }).lines;
    expect(has(early, "FAIL", /^\/changelog dates this deploy's entries 2026-10-30, before land\/all's last change \(2026-10-31\)/), show(early)).toBe(true);
    // The finding: entries dated 2026-10-31 on a deploy that went live later passed.
    const late = run({ changelog: changelogPage({ date: "2026-11-05" }), recorded: "2026-11-02" }).lines;
    expect(has(late, "FAIL", /^\/changelog dates this deploy's entries 2026-11-05, after the deploy was recorded \(2026-11-02\)/), show(late)).toBe(true);
    const unrecorded = run({ recorded: null }).lines;
    expect(has(unrecorded, "FAIL", /verifiedDeploys records no deploy serving job-board 2026-09-09\.96 or later: the entries went out before the deploy was verified and recorded$/), show(unrecorded)).toBe(true);
    const sameDayAsLanding = run({ changelog: changelogPage({ date: "2026-10-31" }), recorded: "2026-11-02" }).lines;
    expect(has(sameDayAsLanding, "PASS", /^\/changelog dates this deploy's entries 2026-10-31 \(the deploy was recorded 2026-11-02\)$/), show(sameDayAsLanding)).toBe(true);
    const other = run({ changelog: changelogPage({ first: `${PUBLISHED_DAY}): Jobs filed in the wrong country` }) }).lines;
    expect(has(other, "FAIL", /^\/changelog's description does not name "The home page is now the job search"/), show(other)).toBe(true);
  });

  it("an older build, and a preflight with no build, of a function an entry describes as live", () => {
    expect(has(run({ builds: { "job-board": "job-board.2026-09-09.95" } }).lines, "FAIL", /^job-board x-fn-build = job-board\.2026-09-09\.95, older than job-board\.2026-09-09\.96/)).toBe(true);
    expect(has(run({ builds: { "free-keyword-scan": "free-keyword-scan.2026-10-27.1" } }).lines, "FAIL", /^free-keyword-scan x-fn-build = free-keyword-scan\.2026-10-27\.1, older than free-keyword-scan\.2026-10-31\.1/)).toBe(true);
    expect(has(run({ builds: { "agent-mcp": null } }).lines, "FAIL", /^agent-mcp preflight carries no x-fn-build, and the changelog describes/)).toBe(true);
  });

  it("no US English changelog chunk at all is a FAIL, and the British chunk is never read in its place", () => {
    const { lines, calls } = run({ chunk: `const e={};export{e as default};` });
    expect(has(lines, "FAIL", /^no US English changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts/), show(lines)).toBe(true);
    expect(calls.some((c) => c.includes("en-GB-"))).toBe(false);
  });
});
