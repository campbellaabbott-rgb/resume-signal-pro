// @vitest-environment node
/**
 * SECTION 92 (FIX ROUNDS 3 AND 4, CORPUS-FIRST) FAILS WHAT IT CLAIMS.
 *
 * scripts/verify-deploy.d/92-w4b-fixer3.sh is what the owner reads after
 * rounds 3 and 4 deploy. A PASS is worth something only if a regression could have
 * turned it into a FAIL (verify-deploy.d/README), so the section runs here in
 * bash against a fake curl, with the real J and build_ge cut from the
 * verifier. Each round's answer is fed in: round 2's negation (it took a
 * second word) and origin/main's (it split the compound) each read FAIL once
 * the wave 4 board code serves, and so does round 3's for round 4's three
 * negations. The salary re-sweep lines left with the salary rule (wave 4
 * descope, 2026-10-25): the section must not read a single posting's pay.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { splitExclusions } from "../../supabase/functions/job-board/search-routing";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/92-w4b-fixer3.sh"), "utf8");
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
  const dir = mkdtempSync(join(tmpdir(), "vd-92t-"));
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
const FIVE = ["agent-mcp", "public-api", "generate-application-answers", "generate-apply-package", "apply-agent"];
const Q = { tx: "nurse not night shift, TX", er: "nurse not travel er", sj: "warehouse not forklift San Jose", sf: "nurse not south florida", or: "nurse not travel or agency", pt: "barista not part-time" } as const;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const list = (q: string, excluded: string[]): Route => ({ match: `^POST ${FN}/job-board .*"q":"${esc(q)}"`, body: JSON.stringify({ jobs: [], excludedTerms: excluded }) });

/** Round 4 deployed. The board answers are what the code on disk answers. */
function healthy(over: Partial<Record<string, Route | null>> = {}, build = "33"): Route[] {
  const base: Record<string, Route> = {};
  for (const f of FIVE) base[`opt:${f}`] = { match: `^OPTIONS ${FN}/${f}$`, headers: { "x-fn-build": `${f}.2026-10-11.${build}` } };
  Object.assign(base, {
    offset: { match: `^POST ${FN}/job-board .*"offset":10001`, status: 400, body: JSON.stringify({ error: "offset_too_deep" }) },
    tx: list(Q.tx, splitExclusions(Q.tx).excluded),
    er: list(Q.er, splitExclusions(Q.er).excluded),
    sj: list(Q.sj, splitExclusions(Q.sj).excluded),
    sf: list(Q.sf, splitExclusions(Q.sf).excluded),
    or: list(Q.or, splitExclusions(Q.or).excluded),
    pt: list(Q.pt, splitExclusions(Q.pt).excluded),
  });
  for (const [k, v] of Object.entries(over)) { if (v === null) delete base[k]; else if (v) base[k] = v; }
  return Object.values(base);
}

describe("the board answers the section expects are what the code on disk answers", () => {
  it("round 3's negation: the compound whole, one word otherwise; round 4's: the region, both of 'A or B', the typed hyphen", () => {
    expect(splitExclusions(Q.tx).excluded).toEqual(["night shift"]);
    expect(splitExclusions(Q.er).excluded).toEqual(["travel"]);
    expect(splitExclusions(Q.sj).excluded).toEqual(["forklift"]);
    expect(splitExclusions(Q.sf).excluded).toEqual(["south florida"]);
    expect(splitExclusions(Q.or).excluded).toEqual(["travel", "agency"]);
    expect(splitExclusions(Q.pt).excluded).toEqual(["part-time"]);
  });
});

describe("section 92 fix rounds 3 and 4, on a healthy deploy", () => {
  it("every build and the six negations PASS, and no posting's pay is read", () => {
    const { lines, calls } = run(healthy());
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.filter((l) => /^PASS {2}\S+ x-fn-build = /.test(l))).toHaveLength(5);
    for (const q of Object.values(Q)) expect(has(lines, "PASS", new RegExp(esc(`q "${q}"`))), show(lines)).toBe(true);
    expect(lines.filter((l) => /salary|re-sweep/i.test(l)), show(lines)).toEqual([]);
    expect(calls.filter((c) => !/^(OPTIONS|GET) /.test(c)).every((c) => /\/job-board /.test(c)), "only job-board reads are POSTed").toBe(true);
    expect(calls.filter((c) => /\/job-board /.test(c)).every((c) => /"action":"list"/.test(c)), "every job-board read is a list").toBe(true);
    expect(calls.filter((c) => /\/job-board /.test(c))).toHaveLength(7);
  });

  it("the section's own text names no salary probe and no v11", () => {
    const code = SECTION.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    expect(code).not.toMatch(/"action":"detail"|salary|v11/i);
  });
});

describe("each regression reads FAIL", () => {
  it("an older build (round 3's)", () => {
    const { lines } = run(healthy({}, "32"));
    for (const f of FIVE) expect(has(lines, "FAIL", new RegExp(`${f} x-fn-build = ${esc(f)}\\.2026-10-11\\.32`)), show(lines)).toBe(true);
  });

  it("round 3's and origin/main's answers to round 4's negations", () => {
    const { lines } = run(healthy({ sf: list(Q.sf, ["south"]), or: list(Q.or, ["travel"]), pt: list(Q.pt, ["parttime"]) }));
    expect(has(lines, "FAIL", /q "nurse not south florida" excludes \["south"\]/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /q "nurse not travel or agency" excludes \["travel"\]/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /q "barista not part-time" excludes \["parttime"\]/), show(lines)).toBe(true);
  });

  it("round 2's negation, which took a second word", () => {
    const { lines } = run(healthy({ er: list(Q.er, ["travel er"]), sj: list(Q.sj, ["forklift san"]) }));
    expect(has(lines, "FAIL", /q "nurse not travel er" excludes \["travel er"\]/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /q "warehouse not forklift San Jose" excludes \["forklift san"\]/), show(lines)).toBe(true);
  });

  it("origin/main's negation, which split the compound", () => {
    const { lines } = run(healthy({ tx: list(Q.tx, ["night"]) }));
    expect(has(lines, "FAIL", /q "nurse not night shift, TX" excludes \["night"\]/), show(lines)).toBe(true);
  });
});

describe("what cannot be judged yet is INFO, never PASS or FAIL", () => {
  it("before the wave 4 board code serves, the negation lines are INFO", () => {
    const { lines } = run(healthy({
      offset: { match: `^POST ${FN}/job-board .*"offset":10001`, body: JSON.stringify({ jobs: [] }) },
      tx: list(Q.tx, ["night"]),
    }));
    expect(fails(lines), show(lines)).toEqual([]);
    for (const q of Object.values(Q)) expect(has(lines, "INFO", new RegExp(`${esc(`q "${q}"`)}.*not judged`)), show(lines)).toBe(true);
  });
});
