// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE BUG ROUND'S FULL-ANALYSIS SECTION CAN FAIL WHAT IT CLAIMS, AND NEVER
 * WRITES (scripts/verify-deploy.d/99zzzzzzz-bugs-full-analysis.sh).
 *
 * The section is run against a fake curl that answers from routes and logs
 * every call:
 *   - a good deploy (four preflights on 2026-11-12.1, the owed-notice column
 *     there and closed to anon, the published success page carrying all six
 *     page fixes) prints PASS lines and no FAIL;
 *   - today, before the paste (older builds, no column, the page before the
 *     merge), prints INFO lines and no FAIL;
 *   - the frontend published first passes its page lines and fails nothing;
 *   - with the functions live, a missing column and an unpublished page FAIL;
 *     a paste of only some of the four FAILs the rest; a table anon can read
 *     FAILs; a missing build header FAILs; an entry that names no Success
 *     chunk FAILs rather than passing over nothing; each page fix missing
 *     FAILs alone;
 *   - nothing is POSTed, and the publishable key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-full-analysis.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_bugs_full_analysis";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(["-H","-m","-A","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbugsfa-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

const FNS = ["analyze-resume", "send-analysis-email", "retry-failed-deliveries", "verify-scan-pack-purchase"];
/** The builds live on 2026-11-15, before the paste. */
const TODAY: Record<string, string> = {
  "analyze-resume": "analyze-resume.2026-11-10.4",
  "send-analysis-email": "send-analysis-email.2026-11-03.1",
  "retry-failed-deliveries": "retry-failed-deliveries.2026-10-11.22",
  "verify-scan-pack-purchase": "verify-scan-pack-purchase.2026-11-10.2",
};
const preflights = (build: (fn: string) => string | null): Route[] =>
  FNS.map((fn) => { const b = build(fn); return { match: `^OPTIONS https://p\\.supabase\\.co/functions/v1/${fn}$`, headers: b ? { "x-fn-build": b } : {} }; });
const LIVE = preflights((fn) => `${fn}.2026-11-12.1`);
const OLD = preflights((fn) => TODAY[fn]);

const notice = (status: number, body: unknown): Route => ({
  match: "^GET https://p\\.supabase\\.co/rest/v1/product_deliveries\\?select=notice_owed,notice_tries,notice_tried_at,notice_given_up&limit=1$", status, body: typeof body === "string" ? body : JSON.stringify(body),
});
const EMPTY = notice(200, []);
const REFUSED = notice(401, { code: "42501", message: "permission denied for table product_deliveries" });
const NO_COLUMN = notice(400, { code: "42703", message: "column product_deliveries.notice_owed does not exist" });
/** 20261112130000 as the lanes first wrote it: the marker without the try count, the last try and the reason a notice was given up. */
const MARKER_ONLY = notice(400, { code: "42703", message: "column product_deliveries.notice_tries does not exist" });

/** The success chunk after the merge, minified as Vite writes it. */
const NEW_PAGE = [
  'e.jsx("div",{className:"mx-auto","data-testid":"sections-missing",role:"note",children:t("paidAnalysis.sectionsMissing.jobDescription")})',
  'const Rc=["purchase_refunded","payment_required","purchase_not_found","session_used","grant_refused"]',
  'throw await Af(n,{timedOut:t("success.error.timedOut"),busy:t("paidAnalysis.busy")})',
  'if(!d||d==="data:,")throw new Pn("an empty image")',
  'const Uw=new Set(["strong","proven","understanding","familiarity","experience","skills"])',
  'e.jsx(Seo,{title:t("paidAnalysis.page.seoTitle"),description:t("paidAnalysis.page.seoDescription"),path:"/success",noIndex:!0})',
  'e.jsx("h3",{children:t("paidAnalysis.page.clearTitle")}),e.jsx("span",{children:t("paidAnalysis.page.scrollHint")})',
].join(";");
/** The success chunk as published today (Success-Dx3ZZvhr.js, read 2026-11-15). */
const OLD_PAGE = [
  'e.jsx("div",{"data-testid":"inputs-clipped",children:x})',
  'if(l.status===402)throw new Error(t("success.error.paymentRequired"))',
  'e.jsx("span",{children:"Scroll to view results"})',
  'children:[e.jsx(Je,{className:"w-4 h-4 text-amber-500"}),"Clear Browser Data"]',
  'children:"Delete Server Data"',
  'e.jsx(Ac,{children:"Yes, delete my data"})',
  'const g=c.toDataURL("image/jpeg",.95)',
].join(";");
const site = (chunk: string | null): Route[] => [
  { match: "^GET https://site\\.test/$", body: '<script type="module" src="/assets/index-AbC123.js"></script>' },
  { match: "^GET https://site\\.test/assets/index-AbC123\\.js$", body: chunk === null ? "no chunks here" : 'import("./Success-XyZ789.js");import("./Index-IdX456.js")' },
  { match: "^GET https://site\\.test/assets/Success-XyZ789\\.js$", body: chunk ?? "" },
];
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const passes = (lines: string[]) => lines.filter((l) => l.startsWith("PASS"));

/** Each page fix, by the marker the section reads for it. */
const PAGE_FIXES: Array<[string, string]> = [
  ["S14X-041", "sections-missing"],
  ["RC-S13-048", "purchase_refunded"],
  ["S14X-110", "paidAnalysis.busy"],
  ["S14X-112", "data:,"],
  ["RC-S13-051", '"familiarity"'],
  ["S14X-178", "paidAnalysis.page.seoTitle"],
];

describe("the bug round's full-analysis section", () => {
  it("a good deploy passes every claim and fails none", () => {
    const { lines, out } = run([...LIVE, EMPTY, ...site(NEW_PAGE)]);
    expect(fails(lines), out).toEqual([]);
    expect(passes(lines).length, out).toBe(FNS.length + 1 + PAGE_FIXES.length);
  });

  it("today, before anything is pasted, prints no FAIL: every claim reads as not yet", () => {
    const { lines, out } = run([...OLD, NO_COLUMN, ...site(OLD_PAGE)]);
    expect(fails(lines), out).toEqual([]);
    expect(passes(lines), out).toEqual([]);
    expect(lines.filter((l) => /^INFO  BF[123] /.test(l)).length, out).toBe(FNS.length + 1 + PAGE_FIXES.length);
    expect(lines.find((l) => l.startsWith("INFO  BF3 S14X-178")), out)
      .toContain('still prints "Scroll to view results", "Clear Browser Data", "Delete Server Data", "Yes, delete my data" in English');
  });

  it("the frontend published first, before the functions and the migration: the page passes and nothing fails", () => {
    const { lines, out } = run([...OLD, NO_COLUMN, ...site(NEW_PAGE)]);
    expect(fails(lines), out).toEqual([]);
    expect(passes(lines).filter((l) => l.startsWith("PASS  BF3 ")).length, out).toBe(PAGE_FIXES.length);
  });

  it("the migration applied ahead of the functions passes its line and fails nothing", () => {
    for (const answer of [EMPTY, REFUSED]) {
      const { lines, out } = run([...OLD, answer, ...site(OLD_PAGE)]);
      expect(fails(lines), out).toEqual([]);
      expect(passes(lines).map((l) => l.slice(0, 9)), out).toEqual(["PASS  BF2"]);
    }
  });

  it("with the functions live, a missing column and an unpublished page fail", () => {
    const { lines, out } = run([...LIVE, NO_COLUMN, ...site(OLD_PAGE)]);
    expect(fails(lines).map((l) => l.slice(0, 9)), out).toEqual(["FAIL  BF2", ...PAGE_FIXES.map(() => "FAIL  BF3")]);
    expect(fails(lines)[0], out).toContain("while retry-failed-deliveries serves 2026-11-12.1");
    expect(fails(lines).slice(1).every((l) => l.includes("while analyze-resume serves 2026-11-12.1")), out).toBe(true);
  });

  it("a marker without the try count, the last try and the given-up reason fails once the sweep is live: the sweep writes all four in one write", () => {
    const { lines, out } = run([...LIVE, MARKER_ONLY, ...site(NEW_PAGE)]);
    expect(fails(lines), out).toEqual([expect.stringMatching(/^FAIL  BF2 .*notice_tries.*while retry-failed-deliveries serves 2026-11-12\.1/)]);
  });

  it("a paste of only some of the four fails the ones left behind", () => {
    const { lines, out } = run([...preflights((fn) => (fn === "analyze-resume" ? `${fn}.2026-11-12.1` : TODAY[fn])), EMPTY, ...site(NEW_PAGE)]);
    expect(fails(lines), out).toEqual([
      "FAIL  BF1 send-analysis-email preflight x-fn-build = send-analysis-email.2026-11-03.1 while another of this lane's functions serves 2026-11-12.1: the round's paste is partial",
      "FAIL  BF1 retry-failed-deliveries preflight x-fn-build = retry-failed-deliveries.2026-10-11.22 while another of this lane's functions serves 2026-11-12.1: the round's paste is partial",
      "FAIL  BF1 verify-scan-pack-purchase preflight x-fn-build = verify-scan-pack-purchase.2026-11-10.2 while another of this lane's functions serves 2026-11-12.1: the round's paste is partial",
    ]);
  });

  it("a table anon can read fails; a missing build header fails; a later build passes", () => {
    const { lines, out } = run([
      ...preflights((fn) => (fn === "send-analysis-email" ? null : `${fn}.2026-11-21.3`)),
      notice(200, [{ notice_owed: "owner" }]),
      ...site(NEW_PAGE),
    ]);
    expect(fails(lines), out).toEqual([
      "FAIL  BF1 send-analysis-email preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)",
      "FAIL  BF2 product_deliveries answered anon with rows (ROWS:1): buyers' orders are readable by anyone",
    ]);
    expect(passes(lines).filter((l) => l.startsWith("PASS  BF1 ")).length, out).toBe(3);
  });

  it("an answer the column read cannot judge fails, whatever is live", () => {
    for (const odd of [notice(502, "<html>Bad gateway</html>"), notice(500, { code: "XX000", message: "internal" })]) {
      const { lines, out } = run([...OLD, odd, ...site(OLD_PAGE)]);
      expect(fails(lines).map((l) => l.slice(0, 9)), out).toEqual(["FAIL  BF2"]);
      expect(fails(lines)[0], out).toContain("(want [] or 42501)");
    }
  });

  it("an entry that names no Success chunk fails rather than passing over nothing, even before the paste", () => {
    const { lines, out } = run([...OLD, NO_COLUMN, ...site(null)]);
    expect(fails(lines), out).toEqual([expect.stringMatching(/^FAIL  BF3 the served entry \(\/assets\/index-AbC123\.js\) names no Success chunk/)]);
    expect(passes(lines), out).toEqual([]);
  });

  it.each(PAGE_FIXES)("with analyze-resume live, a published page without %s's fix fails that line alone", (claim, marker) => {
    const page = NEW_PAGE.split(marker).join("");
    expect(page).not.toContain(marker);
    const { lines, out } = run([...LIVE, EMPTY, ...site(page)]);
    expect(fails(lines), out).toHaveLength(1);
    expect(fails(lines)[0], out).toMatch(new RegExp(`^FAIL  BF3 ${claim} the published success page \\(Success-XyZ789\\.js\\) .* while analyze-resume serves 2026-11-12\\.1`));
  });

  it("a page that still prints one English label fails S14X-178; a sentence naming the button inside it does not", () => {
    const literal = run([...LIVE, EMPTY, ...site(`${NEW_PAGE};e.jsx(Ac,{children:"Yes, delete my data"})`)]);
    expect(fails(literal.lines), literal.out).toEqual([
      "FAIL  BF3 S14X-178 the published success page (Success-XyZ789.js) still prints \"Yes, delete my data\" in English whatever the buyer's language while analyze-resume serves 2026-11-12.1: the round's frontend has not published",
    ]);
    const sentence = run([...LIVE, EMPTY, ...site(`${NEW_PAGE};const tr={howLong:"Until it is cleared: the Clear Browser Data button on a paid results page clears all of it"}`)]);
    expect(fails(sentence.lines), sentence.out).toEqual([]);
  });

  it("the English paidAnalysis strings riding in the chunk are not literals the page prints (the bug round's review moved them there)", () => {
    const en = readFileSync(resolve(ROOT, "src/i18n/shards/paid/en.json"), "utf8");
    // As the namespace plugin registers them, minified: unquoted keys, the sentences as written.
    const registered = `Rn(${JSON.stringify(JSON.parse(en)).replace(/"([A-Za-z_$][\w$]*)":/g, "$1:")});`;
    expect(registered).toContain('"Clear Browser Data"');
    const withShard = run([...LIVE, EMPTY, ...site(`${registered}${NEW_PAGE}`)]);
    expect(fails(withShard.lines), withShard.out).toEqual([]);
    expect(withShard.lines.some((l) => l.startsWith("PASS  BF3 S14X-178 ")), withShard.out).toBe(true);
    const andALiteral = run([...LIVE, EMPTY, ...site(`${registered}${NEW_PAGE};e.jsx(Ac,{children:"Clear Browser Data"})`)]);
    expect(fails(andALiteral.lines), andALiteral.out).toEqual([
      "FAIL  BF3 S14X-178 the published success page (Success-XyZ789.js) still prints \"Clear Browser Data\" in English whatever the buyer's language while analyze-resume serves 2026-11-12.1: the round's frontend has not published",
    ]);
  });

  it("never writes: nothing is POSTed, and the key is never printed", () => {
    for (const routes of [[...LIVE, EMPTY, ...site(NEW_PAGE)], [...OLD, NO_COLUMN, ...site(OLD_PAGE)]]) {
      const { calls, out } = run(routes);
      expect(calls.filter((c) => c.startsWith("curl\tPOST ")), calls.join("\n")).toEqual([]);
      expect(calls.every((c) => /^curl\t(GET|OPTIONS) /.test(c)), calls.join("\n")).toBe(true);
      expect(out).not.toContain(KEY);
    }
  });

  it("every line it prints is a verdict, and what it cannot read is said as INFO", () => {
    const { out, lines } = run([...LIVE, EMPTY, ...site(NEW_PAGE)]);
    const stray = out.split("\n").filter((l) => l && !/^(PASS|FAIL|INFO|==)/.test(l));
    expect(stray, out).toEqual([]);
    expect(lines.filter((l) => l.startsWith("INFO  BF4 ")), out).toHaveLength(1);
  });
});
