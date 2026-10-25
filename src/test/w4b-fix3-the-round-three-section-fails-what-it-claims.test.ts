// @vitest-environment node
/**
 * SECTION 92 (FIX ROUND 3, CORPUS-FIRST) FAILS WHAT IT CLAIMS.
 *
 * scripts/verify-deploy.d/92-w4b-fixer3.sh is what the owner reads after
 * round 3 deploys. A PASS is worth something only if a regression could have
 * turned it into a FAIL (verify-deploy.d/README), so the section runs here in
 * bash against a fake curl, with the real J and build_ge cut from the
 * verifier. Each round's answer is fed in: round 2's negation (it took a
 * second word) and origin/main's (it split the compound) each read FAIL once
 * the wave 4 board code serves; a re-sweep that NULLs a stated pay, or writes
 * another figure, reads FAIL; a posting still holding its old business figure
 * or already gone reads INFO, never PASS or FAIL.
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
const Q = { tx: "nurse not night shift, TX", er: "nurse not travel er", sj: "warehouse not forklift San Jose" } as const;
const DETAIL = {
  airbus: "workday:ag~wd3~Airbus:JR10428421",
  bb: "workday:bbinsurance~wd1~Careers:0000003072",
  pl: "paylocity:8a6852cc-82d6-47e2-9e95-214ed5a77edf:4257268",
  kipp: "smartrecruiters:KIPP:744000153836599",
} as const;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const list = (q: string, excluded: string[]): Route => ({ match: `^POST ${FN}/job-board .*"q":"${esc(q)}"`, body: JSON.stringify({ jobs: [], excludedTerms: excluded }) });
const detail = (id: string, salary: string | null): Route => ({ match: `^POST ${FN}/job-board .*"action":"detail","id":"${esc(id)}"`, body: JSON.stringify({ job: { id, salary } }) });

/** Round 3 deployed, the v11 re-sweep done. The board answers are what the code on disk answers. */
function healthy(over: Partial<Record<string, Route | null>> = {}, build = "32"): Route[] {
  const base: Record<string, Route> = {};
  for (const f of FIVE) base[`opt:${f}`] = { match: `^OPTIONS ${FN}/${f}$`, headers: { "x-fn-build": `${f}.2026-10-11.${build}` } };
  Object.assign(base, {
    offset: { match: `^POST ${FN}/job-board .*"offset":10001`, status: 400, body: JSON.stringify({ error: "offset_too_deep" }) },
    tx: list(Q.tx, splitExclusions(Q.tx).excluded),
    er: list(Q.er, splitExclusions(Q.er).excluded),
    sj: list(Q.sj, splitExclusions(Q.sj).excluded),
    airbus: detail(DETAIL.airbus, null),
    bb: detail(DETAIL.bb, "$50.00 - $53.00 Hourly"),
    pl: detail(DETAIL.pl, "$225,000 to $275,000"),
    kipp: detail(DETAIL.kipp, "$300,000 - $350,000"),
  });
  for (const [k, v] of Object.entries(over)) { if (v === null) delete base[k]; else if (v) base[k] = v; }
  return Object.values(base);
}

describe("the board answers the section expects are what the code on disk answers", () => {
  it("round 3's negation: the compound whole, one word otherwise", () => {
    expect(splitExclusions(Q.tx).excluded).toEqual(["night shift"]);
    expect(splitExclusions(Q.er).excluded).toEqual(["travel"]);
    expect(splitExclusions(Q.sj).excluded).toEqual(["forklift"]);
  });
});

describe("section 92 fix round 3, on a healthy deploy after the re-sweep", () => {
  it("every build, the three negations and the four postings PASS", () => {
    const { lines, calls } = run(healthy());
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.filter((l) => /^PASS {2}\S+ x-fn-build = /.test(l))).toHaveLength(5);
    for (const q of Object.values(Q)) expect(has(lines, "PASS", new RegExp(esc(`q "${q}"`))), show(lines)).toBe(true);
    expect(has(lines, "PASS", /Airbus placement \(S12-019\) salary null/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /Bbinsurance .* salary "\$50\.00 - \$53\.00 Hourly"/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /Paylocity .* keeps its pay/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /KIPP .* keeps its pay/), show(lines)).toBe(true);
    expect(calls.filter((c) => !/^(OPTIONS|GET) /.test(c)).every((c) => /\/job-board /.test(c)), "only job-board reads are POSTed").toBe(true);
    expect(calls.filter((c) => /\/job-board /.test(c)).every((c) => /"action":"(list|detail)"/.test(c)), "every job-board read is a list or a detail").toBe(true);
  });
});

describe("each regression reads FAIL", () => {
  it("an older build", () => {
    const { lines } = run(healthy({}, "31"));
    for (const f of FIVE) expect(has(lines, "FAIL", new RegExp(`${f} x-fn-build = ${esc(f)}\\.2026-10-11\\.31`)), show(lines)).toBe(true);
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

  it("a re-sweep that NULLs a stated pay", () => {
    const { lines } = run(healthy({ bb: detail(DETAIL.bb, null), kipp: detail(DETAIL.kipp, null) }));
    expect(has(lines, "FAIL", /Bbinsurance .* salary null/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /KIPP .* salary null/), show(lines)).toBe(true);
  });

  it("a re-sweep that writes another figure", () => {
    const { lines } = run(healthy({ airbus: detail(DETAIL.airbus, "£40,000"), pl: detail(DETAIL.pl, "$10,000") }));
    expect(has(lines, "FAIL", /Airbus placement .* salary "£40,000"/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /Paylocity .* salary "\$10,000"/), show(lines)).toBe(true);
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

  it("an old business figure the re-sweep has not reached yet is INFO, as is a posting that is gone", () => {
    const { lines } = run(healthy({
      airbus: detail(DETAIL.airbus, "£350K to £800K annually"),
      bb: { match: `^POST ${FN}/job-board .*"action":"detail","id":"${esc(DETAIL.bb)}"`, body: JSON.stringify({ job: null, closed: true }) },
    }));
    expect(fails(lines), show(lines)).toEqual([]);
    expect(has(lines, "INFO", /Airbus placement .* old business figure: the v11 re-sweep has not reached it yet/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /Bbinsurance .* no posting row to read \(closed\)/), show(lines)).toBe(true);
    expect(lines.some((l) => /^PASS {2}(Airbus|Bbinsurance)/.test(l)), show(lines)).toBe(false);
  });
});
