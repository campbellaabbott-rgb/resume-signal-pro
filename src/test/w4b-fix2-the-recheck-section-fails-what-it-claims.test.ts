// @vitest-environment node
/**
 * SECTION 92 (THE FIXER AFTER THE RECHECK) FAILS WHAT IT CLAIMS.
 *
 * scripts/verify-deploy.d/92-w4b-fixer2.sh is what the owner reads after the
 * recheck's fixes deploy. A PASS is worth something only if a regression could
 * have turned it into a FAIL (verify-deploy.d/README), so the section runs
 * here in bash against a fake curl, with the real J and build_ge cut from the
 * verifier: an older build, an open past-buyers table and a swallowed place
 * each read FAIL; the board line is INFO until the round-2 board code serves.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/92-w4b-fixer2.sh"), "utf8");
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
  const dir = mkdtempSync(join(tmpdir(), "vd-92r-"));
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
const SIX = ["generate-career-path", "agent-mcp", "public-api", "generate-application-answers", "generate-apply-package", "apply-agent"];

function healthy(over: Partial<Record<string, Route | null>> = {}, build = "31"): Route[] {
  const base: Record<string, Route> = {};
  for (const f of SIX) base[`opt:${f}`] = { match: `^OPTIONS ${FN}/${f}$`, headers: { "x-fn-build": `${f}.2026-10-11.${build}` } };
  Object.assign(base, {
    table: { match: "^GET https://p\\.supabase\\.co/rest/v1/career_path_past_buyers", status: 401, body: JSON.stringify({ code: "42501", message: "permission denied" }) },
    offset: { match: `^POST ${FN}/job-board .*"offset":10001`, status: 400, body: JSON.stringify({ error: "offset_too_deep" }) },
    dallas: { match: `^POST ${FN}/job-board .*not forklift Dallas`, body: JSON.stringify({ jobs: [], excludedTerms: ["forklift"] }) },
  });
  for (const [k, v] of Object.entries(over)) { if (v === null) delete base[k]; else if (v) base[k] = v; }
  return Object.values(base);
}

describe("section 92 fixer after the recheck, on a healthy deploy", () => {
  it("every build, the closed table and the board line PASS", () => {
    const { lines, calls } = run(healthy());
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.filter((l) => /^PASS {2}\S+ x-fn-build = /.test(l))).toHaveLength(6);
    expect(has(lines, "PASS", /career_path_past_buyers as anon -> 401/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /warehouse not forklift Dallas/), show(lines)).toBe(true);
    expect(calls.filter((c) => !/^(OPTIONS|GET) /.test(c)).every((c) => /\/job-board /.test(c)), "only job-board list reads are POSTed").toBe(true);
  });
});

describe("each regression reads FAIL", () => {
  it("an older build", () => {
    const { lines } = run(healthy({}, "30"));
    expect(has(lines, "FAIL", /generate-career-path x-fn-build = generate-career-path\.2026-10-11\.30/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /agent-mcp x-fn-build = agent-mcp\.2026-10-11\.30/), show(lines)).toBe(true);
  });

  it("the past-buyers table readable by the anon key", () => {
    const { lines } = run(healthy({ table: { match: "^GET https://p\\.supabase\\.co/rest/v1/career_path_past_buyers", body: "[]" } }));
    expect(has(lines, "FAIL", /career_path_past_buyers as anon -> 200/), show(lines)).toBe(true);
  });

  it("a place swallowed by the negation again", () => {
    const { lines } = run(healthy({ dallas: { match: `^POST ${FN}/job-board .*not forklift Dallas`, body: JSON.stringify({ jobs: [], excludedTerms: ["forklift dallas"] }) } }));
    expect(has(lines, "FAIL", /warehouse not forklift Dallas/), show(lines)).toBe(true);
  });

  it("before the migration and the round-2 board code, those lines are INFO, never FAIL", () => {
    const { lines } = run(healthy({
      table: { match: "^GET https://p\\.supabase\\.co/rest/v1/career_path_past_buyers", status: 404, body: JSON.stringify({ code: "PGRST205" }) },
      offset: { match: `^POST ${FN}/job-board .*"offset":10001`, body: JSON.stringify({ jobs: [] }) },
      dallas: { match: `^POST ${FN}/job-board .*not forklift Dallas`, body: "{}" },
    }));
    expect(fails(lines), show(lines)).toEqual([]);
    expect(has(lines, "INFO", /20261011213000 not applied yet/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /warehouse not forklift Dallas.*not judged/), show(lines)).toBe(true);
  });
});
