// @vitest-environment node
/**
 * THE PERK ENGINE'S VERIFY SECTION JUDGES WHAT IT READS.
 *
 * scripts/verify-deploy.d/80-company-profiles-perks.sh is run in bash against
 * stubs (a fake curl on PATH, R answering from fixtures, the verifier's own
 * build_ge and probe), the way the-verifier-passed-lines-it-never-evaluated
 * runs the others. A deployed engine prints only PASS and INFO; an
 * undeployed function, a missing migration, a withheld key in the reader's
 * answer or a perk table the publishable key can read each print FAIL. Every
 * call it makes is a preflight, a keyless POST, the reader, or a GET.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/80-company-profiles-perks.sh"), "utf8");
const def = (re: RegExp) => { const m = re.exec(SCRIPT); if (!m) throw new Error(`${re} not in the verifier`); return m[0]; };
const BUILD_GE = def(/^build_ge\(\) \{[\s\S]*?^\}$/m);
const PROBE = def(/^probe\(\) \{[\s\S]*?esac; \}$/m);

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };
const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d")data=a[++i];else if(["-H","-m","-A"].includes(x))i++;else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,method+" "+url+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[], perks: Record<string, unknown> | string): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd80-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "perks.json"), typeof perks === "string" ? perks : JSON.stringify(perks));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u
K=pk_test; B=https://p.supabase.co; SITE=https://site.test; UA=ua
R() { echo "R $1 $2" >> "$VD_CALLS"; cat ${JSON.stringify(join(dir, "perks.json"))}; }
${BUILD_GE}
${PROBE}
`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const out = execFileSync("bash", [join(dir, "run.sh")], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`, VD_CALLS: join(dir, "calls.log"), VD_ROUTES: join(dir, "routes.json") },
  });
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean) };
}

const DEPLOYED: Route[] = [
  { match: "^OPTIONS .*/functions/v1/employer-profiles$", headers: { "x-fn-build": "employer-profiles.2026-10-12.1", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-admin-key, x-employer-profiles-cron" } },
  { match: "^POST .*/functions/v1/employer-profiles$", status: 401, body: '{"error":"Unauthorized"}' },
  { match: "^GET .*/rest/v1/employer_perk_(postings|rollups)\\?", status: 401, body: '{"code":"42501","message":"permission denied for table"}' },
  { match: "^GET .*/rest/v1/rpc/", status: 401, body: '{"code":"42501","message":"permission denied for function"}' },
];
const EMPTY = { token: "ramp", collision: false, expiry_days: 45, perks: [], withheld: [] };

describe("section 80 on a deployed engine", () => {
  it("prints PASS and INFO only, and every call is a preflight, a keyless POST, the reader or a GET", () => {
    const { lines, calls } = run(DEPLOYED, EMPTY);
    expect(lines.filter((l) => !/^(PASS|INFO) {2}|^== /.test(l)), lines.join("\n")).toEqual([]);
    expect(lines.some((l) => /^PASS {2}employer-profiles preflight x-fn-build = employer-profiles\.2026-10-12\.1/.test(l))).toBe(true);
    expect(lines.filter((l) => /^PASS {2}get_employer_perks\((ramp|tailscale|spotify)\) answers the publishable key in shape/.test(l))).toHaveLength(3);
    expect(lines.some((l) => /^PASS {2}employer_perk_audit_status as anon -> 42501/.test(l))).toBe(true);
    for (const c of calls) expect(c, c).toMatch(/^(OPTIONS .*employer-profiles|POST .*functions\/v1\/employer-profiles|R get_employer_perks |GET )/);
  });
});

describe("section 80 fails what is wrong", () => {
  it("an undeployed function, or a previous build", () => {
    expect(run(DEPLOYED.slice(1), EMPTY).lines.some((l) => /^FAIL {2}employer-profiles preflight carries no x-fn-build/.test(l))).toBe(true);
    const old = [{ ...DEPLOYED[0], headers: { ...DEPLOYED[0].headers, "x-fn-build": "employer-profiles.2026-10-11.9" } }, ...DEPLOYED.slice(1)];
    expect(run(old, EMPTY).lines.some((l) => /^FAIL {2}employer-profiles preflight x-fn-build = employer-profiles\.2026-10-11\.9/.test(l))).toBe(true);
  });

  it("a reader that is not there, or one that shows a withheld key or a row under the threshold", () => {
    expect(run(DEPLOYED, '{"code":"PGRST202","message":"Could not find the function"}').lines.filter((l) => /^FAIL {2}get_employer_perks\(\w+\) as anon -> .*PGRST202/.test(l))).toHaveLength(3);
    const flex = { ...EMPTY, perks: [{ perk: "flex", country: "US", k: 6, n: 6, quote: "Flexible working" }] };
    expect(run(DEPLOYED, flex).lines.some((l) => /^FAIL {2}get_employer_perks\(ramp\) answers the publishable key in shape/.test(l))).toBe(true);
    const thin = { ...EMPTY, perks: [{ perk: "health", country: "US", k: 1, n: 6, quote: "Medical insurance" }] };
    expect(run(DEPLOYED, thin).lines.some((l) => /^FAIL {2}ramp US health breaks the published-row rule/.test(l))).toBe(true);
  });

  it("a keyless POST that is answered, or a perk table the publishable key can read", () => {
    const open = DEPLOYED.map((r) => (r.match.startsWith("^POST") ? { ...r, status: 200, body: "{}" } : r));
    expect(run(open, EMPTY).lines.some((l) => /^FAIL {2}employer-profiles answered a keyless POST with 200/.test(l))).toBe(true);
    const readable = [{ match: "^GET .*/rest/v1/employer_perk_postings\\?", status: 200, body: "[]" }, ...DEPLOYED];
    expect(run(readable, EMPTY).lines.some((l) => /^FAIL {2}employer_perk_postings answered the publishable key/.test(l))).toBe(true);
  });
});
