// @vitest-environment node
/**
 * SECTION 92 (THE FIXER) FAILS WHAT IT CLAIMS.
 *
 * scripts/verify-deploy.d/92-w4b-fixer.sh is what the owner reads after the
 * review's fixes deploy. A PASS is worth something only if a regression could
 * have turned it into a FAIL (verify-deploy.d/README), so the section runs
 * here in bash against a fake curl, with the real J and build_ge cut from the
 * verifier: each claim's regression reads FAIL, an older generator is never
 * asked to write a cover note, and the board lines are INFO until the round-2
 * board code serves.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/92-w4b-fixer.sh"), "utf8");
const cut = (re: RegExp, what: string) => { const m = re.exec(SCRIPT); if (!m) throw new Error(`${what} is gone from verify-deploy.sh`); return m[0]; };
const HELPERS = [cut(/^J\(\) \{.*\}$/m, "J"), cut(/^build_ge\(\) \{[\s\S]*?^\}$/m, "build_ge")].join("\n");

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
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd-92f-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "run.sh"), `set -u\nK=pk_test; B=https://p.supabase.co\n${HELPERS}\n` + SECTION.split("/tmp/").join(`${dir}/`));
  let out = "";
  try {
    out = execFileSync("bash", [join(dir, "run.sh")], {
      env: { ...process.env, PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`, VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log") },
      encoding: "utf8", timeout: 110_000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean) };
}
const has = (lines: string[], s: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${s}  `) && re.test(l));
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

const FN = "https://p\\.supabase\\.co/functions/v1";
const ELEVEN = ["generate-career-path", "generate-application-answers", "generate-apply-package", "free-keyword-scan-stream", "stripe-webhook", "check-subscription", "agent-mcp", "public-api", "apply-agent", "scan-heartbeat"];
const FOURTEEN = ["get-account-data", "free-keyword-scan", "account-order"];

function healthy(over: Partial<Record<string, Route | null>> = {}, build = "30"): Route[] {
  const base: Record<string, Route> = {};
  for (const f of ELEVEN) base[`opt:${f}`] = { match: `^OPTIONS ${FN}/${f}$`, headers: { "x-fn-build": `${f}.2026-10-11.${build}` } };
  for (const f of FOURTEEN) base[`opt:${f}`] = { match: `^OPTIONS ${FN}/${f}$`, headers: { "x-fn-build": `${f}.2026-10-14.${build}` } };
  Object.assign(base, {
    cover: { match: `^POST ${FN}/generate-application-answers .*cover-note`, status: 401, body: JSON.stringify({ error: "sign_in_required" }) },
    offset: { match: `^POST ${FN}/job-board .*"offset":10001`, status: 400, body: JSON.stringify({ error: "offset_too_deep" }) },
    boston: { match: `^POST ${FN}/job-board .*night shift in Boston`, body: JSON.stringify({ jobs: [], excludedTerms: ["night"], intentFilters: ["in Boston"] }) },
    tx: { match: `^POST ${FN}/job-board .*not in Texas`, body: JSON.stringify({ jobs: [], ignoredFilters: ["placeExclusion"] }) },
    cursor: { match: `^POST ${FN}/job-board .*"cursor"`, body: JSON.stringify({ jobs: [] }) },
  });
  for (const [k, v] of Object.entries(over)) { if (v === null) delete base[k]; else if (v) base[k] = v; }
  return Object.values(base);
}

describe("section 92 fixer on a healthy deploy", () => {
  it("every build, the cover-note gate and the three board lines PASS", () => {
    const { lines } = run(healthy());
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.filter((l) => /^PASS {2}\S+ x-fn-build = /.test(l))).toHaveLength(13);
    expect(has(lines, "PASS", /signed-out cover-note request answers 401 sign_in_required/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /night shift in Boston/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /names placeExclusion/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /paged by a keyset cursor is served/), show(lines)).toBe(true);
  });
});

describe("each regression reads FAIL", () => {
  it("an older generator: FAIL on its build, and it is never asked to write a cover note", () => {
    const { lines, calls } = run(healthy({}, "29"));
    expect(has(lines, "FAIL", /generate-application-answers x-fn-build = generate-application-answers\.2026-10-11\.29/), show(lines)).toBe(true);
    expect(calls.some((c) => /cover-note/.test(c)), "an older bundle would write the note").toBe(false);
  });

  it("a cover note served to a signed-out caller", () => {
    const { lines } = run(healthy({ cover: { match: `^POST ${FN}/generate-application-answers .*cover-note`, body: JSON.stringify({ note: "Dear hiring manager" }) } }));
    expect(has(lines, "FAIL", /cover-note request answers 200/), show(lines)).toBe(true);
  });

  it("'not' swallowing the place again", () => {
    const { lines } = run(healthy({ boston: { match: `^POST ${FN}/job-board .*night shift in Boston`, body: JSON.stringify({ jobs: [], excludedTerms: ["night shift in boston"] }) } }));
    expect(has(lines, "FAIL", /night shift in Boston/), show(lines)).toBe(true);
  });

  it("the descoped phrase rule's answer (the compound taken whole) instead of origin/main's one word", () => {
    const { lines } = run(healthy({ boston: { match: `^POST ${FN}/job-board .*night shift in Boston`, body: JSON.stringify({ jobs: [], excludedTerms: ["night shift"], intentFilters: ["in Boston"] }) } }));
    expect(has(lines, "FAIL", /night shift in Boston" excludes \["night shift"\]/), show(lines)).toBe(true);
  });

  it("a cursor-paged browse refused past 10,000", () => {
    const { lines } = run(healthy({ cursor: { match: `^POST ${FN}/job-board .*"cursor"`, status: 400, body: JSON.stringify({ error: "offset_too_deep" }) } }));
    expect(has(lines, "FAIL", /paged by a keyset cursor/), show(lines)).toBe(true);
  });

  it("before the round-2 board code serves, the board lines are INFO, never FAIL", () => {
    const { lines } = run(healthy({ offset: { match: `^POST ${FN}/job-board .*"offset":10001`, body: JSON.stringify({ jobs: [] }) }, boston: { match: `^POST ${FN}/job-board .*night shift in Boston`, body: "{}" } }));
    expect(fails(lines), show(lines)).toEqual([]);
    expect(has(lines, "INFO", /night shift in Boston.*not judged/), show(lines)).toBe(true);
  });
});
