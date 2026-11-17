// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE BUG ROUND SITE-SHELL-B SECTION CAN FAIL WHAT IT CLAIMS, NEVER FAILS
 * BEFORE THE PUBLISH, AND NEVER WRITES
 * (scripts/verify-deploy.d/99zzzzzzz-bugs-site-shell-b.sh).
 *
 * Run against a fake curl that answers from routes and logs every call:
 *   - before the publish (today's entry: no marker of the lane, the A/B
 *     crash event) every code claim is INFO and nothing FAILs, while the
 *     served skip link is judged at once;
 *   - a full publish passes the skip link's language, the route announcer
 *     and the crash log, with the German words read from this checkout;
 *   - once one marker is published, a missing one FAILs: the announcer, the
 *     crash log, the German chunk missing, in English or in other words;
 *   - the crash log published beside the A/B crash event FAILs;
 *   - a page that does not open with the skip link FAILs at any stage, and
 *     a page with no entry FAILs;
 *   - against this branch's own build (when dist/ is there) every line
 *     PASSes, so the markers are the strings the minified code keeps;
 *   - every call is a GET with no body, and every marker the section looks
 *     for is written by this branch's source.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-site-shell-b.sh"), "utf8");
const KEY = "pk_test_SECRET_marker_bugs_site_shell_b";
const GERMAN = (JSON.parse(readFileSync(resolve(ROOT, "src/i18n/shards/site-shell/de.json"), "utf8")) as { siteShell: { skipToMain: string } }).siteShell.skipToMain;

type Route = { match: string; status?: number; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(["-H","-m","-A","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url))||{status:404,body:""};
const st=r.status??200;const body=r.body??"";
if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)process.stdout.write(body);
if(w)process.stdout.write(w.split("\\\\n").join("\\n").replace("%{http_code}",String(st)));
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[], env: Record<string, string> = {}): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbugssiteshellb-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  let out = "";
  try {
    out = execFileSync("bash", [join(dir, "run.sh")], {
      cwd: ROOT,
      env: { ...process.env, ...env, PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`, VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log") },
      encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const GET = (url: string) => `^GET ${esc(url)}$`;
const line = (lines: string[], key: string) => lines.find((l) => new RegExp(`^(PASS|FAIL|INFO)  ${esc(key)}\\b`).test(l)) ?? "(no line)";
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));

const PAGE = '<!doctype html><html><head></head><body>\n    <!-- Skip to main content for accessibility -->\n    <a href="#main-content" class="sr-only">\n      Skip to main content\n    </a>\n    <div id="root"></div><script type="module" src="/assets/index-E1.js"></script></body></html>';
const PAGE_NO_LINK = PAGE.replace(/<a href="#main-content"[\s\S]*?<\/a>/, "");

const ENTRY_TODAY = 'const v={testName:"client_error",variant:crashVariant("app",m),eventType:"view"};const L={"./shards/home/de.json":()=>S(()=>import("./de-H1.js"))};';
const SKIP = 'const k=t("siteShell.skipToMain","Skip to main content");const q=d.querySelector(\'body > a[href="#main-content"]\');const L={"./shards/site-shell/de.json":()=>S(()=>import("./de-Ss1.js"))};';
const ANNOUNCER = 'const id="rb-route-announcer";const M=\'[role="dialog"][aria-modal="true"], [role="alertdialog"], [role="dialog"][data-state="open"]\';el.focus({preventScroll:!0});';
const CRASHES = 'n.rpc("log_error_telemetry",r);const c=`CRASH_${e.source.toUpperCase()}`;w.addEventListener("unhandledrejection",o);';
const DE_GOOD = `const e={skipToMain:${JSON.stringify(GERMAN)},crashHome:"Zur Startseite"};export{e as default};`;
const DE_ENGLISH = 'const e={skipToMain:"Skip to main content",crashHome:"Zur Startseite"};export{e as default};';
const DE_OTHER = 'const e={skipToMain:"Zum Inhalt",crashHome:"Zur Startseite"};export{e as default};';

const site = (opts: { page?: string; entry?: string; de?: string | null }): Route[] => [
  { match: GET("https://site.test/pricing"), body: opts.page ?? PAGE },
  { match: GET("https://site.test/assets/index-E1.js"), body: opts.entry ?? ENTRY_TODAY },
  ...(opts.de === null ? [] : [{ match: GET("https://site.test/assets/de-Ss1.js"), body: opts.de ?? DE_GOOD }]),
];
const PUBLISHED = SKIP + ANNOUNCER + CRASHES;

describe("before the publish", () => {
  const r = run(site({}));
  it("prints INFO for every code claim and FAILs nothing", () => {
    expect(fails(r.lines)).toEqual([]);
    expect(line(r.lines, "stage")).toMatch(/^INFO .*not published/);
    for (const k of ["S14X-177", "S14X-256", "NB-42"]) expect(line(r.lines, k), k).toMatch(/^INFO .*not published yet/);
  });
  it("judges the served skip link at once", () => {
    expect(line(r.lines, "H1")).toMatch(/^PASS/);
  });
});

describe("a full publish", () => {
  it("passes every claim, with the German words read from this checkout", () => {
    const r = run(site({ entry: PUBLISHED }));
    expect(fails(r.lines)).toEqual([]);
    for (const k of ["H1", "S14X-177", "S14X-256", "NB-42"]) expect(line(r.lines, k), k).toMatch(/^PASS/);
    expect(line(r.lines, "S14X-177")).toContain(JSON.stringify(GERMAN));
  });
});

describe("once one marker is published, a missing one fails", () => {
  it("the announcer missing", () => {
    const r = run(site({ entry: SKIP + CRASHES }));
    expect(line(r.lines, "S14X-256")).toMatch(/^FAIL .*rb-route-announcer/);
  });
  it("the crash log missing, and the A/B crash event still sent", () => {
    const r = run(site({ entry: SKIP + ANNOUNCER + ENTRY_TODAY }));
    expect(line(r.lines, "NB-42")).toMatch(/^FAIL .*log_error_telemetry.*still sends the A\/B event client_error/);
  });
  it("the crash log published beside the A/B crash event", () => {
    const r = run(site({ entry: PUBLISHED + ENTRY_TODAY }));
    expect(line(r.lines, "NB-42")).toMatch(/^FAIL .*still sends the A\/B event client_error/);
  });
  it("the German chunk missing, in English, or in other words than this checkout's", () => {
    expect(line(run(site({ entry: PUBLISHED, de: null })).lines, "S14X-177")).toMatch(/^FAIL .*does not carry/);
    expect(line(run(site({ entry: PUBLISHED.replace("./shards/site-shell/de.json", "./shards/home/de.json") })).lines, "S14X-177")).toMatch(/^FAIL .*names no chunk/);
    expect(line(run(site({ entry: PUBLISHED, de: DE_ENGLISH })).lines, "S14X-177")).toMatch(/^FAIL .*English words/);
    expect(line(run(site({ entry: PUBLISHED, de: DE_OTHER })).lines, "S14X-177")).toMatch(/^FAIL .*does not carry/);
  });
  it("the localiser missing from the entry", () => {
    const r = run(site({ entry: ANNOUNCER + CRASHES + SKIP.replace("siteShell.skipToMain", "siteShell.other") }));
    expect(line(r.lines, "S14X-177")).toMatch(/^FAIL .*lacks "siteShell.skipToMain"/);
  });
});

describe("at any stage", () => {
  it("a page that does not open with the skip link fails, before the publish and after", () => {
    expect(line(run(site({ page: PAGE_NO_LINK })).lines, "H1")).toMatch(/^FAIL/);
    expect(line(run(site({ page: PAGE_NO_LINK, entry: PUBLISHED })).lines, "H1")).toMatch(/^FAIL/);
  });
  it("a page that names no entry fails the stage instead of reading nothing as not published", () => {
    const r = run(site({ page: PAGE.replace("/assets/index-E1.js", "/somewhere.js") }));
    expect(line(r.lines, "stage")).toMatch(/^FAIL/);
  });
});

const DIST = resolve(ROOT, "dist");
describe("this branch's own build", () => {
  it.skipIf(!existsSync(resolve(DIST, "pricing.html")))("passes every line: the markers are what the minified code keeps", () => {
    const page = readFileSync(resolve(DIST, "pricing.html"), "utf8");
    const entryName = /\/assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(page)![1];
    const entry = readFileSync(resolve(DIST, "assets", entryName), "utf8");
    const deName = /"\.\/shards\/site-shell\/de\.json":[^"]{0,40}"\.\/([A-Za-z0-9_-]+\.js)"/.exec(entry)![1];
    const r = run([
      { match: GET("https://site.test/pricing"), body: page },
      { match: GET(`https://site.test/assets/${entryName}`), body: entry },
      { match: GET(`https://site.test/assets/${deName}`), body: readFileSync(resolve(DIST, "assets", deName), "utf8") },
    ]);
    expect(fails(r.lines)).toEqual([]);
    for (const k of ["H1", "S14X-177", "S14X-256", "NB-42"]) expect(line(r.lines, k), k).toMatch(/^PASS/);
  });
});

describe("it only reads", () => {
  it("every call is a GET with no body, and the key is never printed", () => {
    for (const r of [run(site({})), run(site({ entry: PUBLISHED }))]) {
      expect(r.calls.length).toBeGreaterThan(0);
      for (const c of r.calls) expect(c, "a call that is not a bodiless GET").toMatch(/^curl\tGET https:\/\/site\.test\/[^\t]*$/);
      expect(r.out).not.toContain(KEY);
    }
  });

  it("every marker the section looks for is written by this branch's source", () => {
    const marks = /const MARKS = \{([\s\S]*?)\n\};/.exec(SECTION)![1];
    const strings = [...marks.matchAll(/"((?:[^"\\]|\\.)*)"(?=[,\]])/g)].map((m) => JSON.parse(`"${m[1]}"`) as string);
    expect(strings.length).toBe(7);
    const src = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? (d.name === "test" ? [] : src(join(dir, d.name))) : /\.tsx?$/.test(d.name) ? [readFileSync(join(dir, d.name), "utf8")] : []);
    const all = src(resolve(ROOT, "src")).join("\n");
    for (const s of strings) expect(all.includes(s), `nothing in src writes ${s}`).toBe(true);
  });
});
