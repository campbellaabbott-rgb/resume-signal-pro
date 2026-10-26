// @vitest-environment node
//
// Node, not jsdom: this file runs verifier sections in bash, with node stubs
// for the network, through child_process.
/**
 * THE OLD SECTIONS JUDGE THE RETIRED PRODUCTS AS RETIRED (review of 9fe3bc0d).
 *
 * Wave 4 retired the Agent plan ($99), the Agent Pass ($29) and the Apply
 * Assistant, and rewrote the subscription FAQ. Sections written for earlier
 * waves still required them:
 *   - 74 wanted the FAQ's "turns into the paid plan when it ends" in the
 *     English strings and on /pricing, which the wave-4 FAQ no longer says, so
 *     a correct wave-4 deploy read two FAILs;
 *   - 65 wanted the pass page's repair sentence (a key wave 4 removed) and the
 *     plan's trial on the /agent bake;
 *   - 7d wanted $99 and $29 at least five times on /pricing and /agents, and
 *     the pass sentence ending the /pricing description: they passed only
 *     while the bake, which wave 4 may not touch, still sold both products.
 * From agent-mcp 2026-10-11.1 on, each is judged by what replaced it: the
 * wave-4 copy is required, and a bake still selling a retired product is INFO
 * naming its owner, never PASS for the sale and never FAIL for the owner's
 * removal. Before that build, each line is exactly what it was.
 *
 * MAIN MERGED (2026-10-25). The profiles+design hotfix re-pointed the crawler
 * lines of 65 (/agent), 74 (/pricing) and 7d, ungated, and main's note on the
 * merge says wave 4 keeps main's version of each and drops its own gated
 * branches; pd-hotfix-the-re-pointed-crawler-lines-fail-on-a-homepage-copy-
 * and-a-retired-offer holds them. What stays wave 4's, and is held here, is
 * the English-strings swaps of 65 and 74 and the "turns into the paid plan"
 * FAIL.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const sectionFile = (n: string) => readFileSync(resolve(ROOT, "scripts/verify-deploy.d", n), "utf8");

/** A section of the main script: from its echo line up to the next section's echo line. */
function section(script: string, header: string): string {
  const open = new RegExp(`^echo "== ${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m").exec(script);
  if (!open) throw new Error(`no section ${header} in the verifier`);
  const rest = script.slice(open.index + 1);
  const next = /^echo "(?:== |done\.)/m.exec(rest);
  return script.slice(open.index, next ? open.index + 1 + next.index : undefined);
}
const def = (script: string, re: RegExp, what: string) => { const m = re.exec(script); if (!m) throw new Error(`no ${what} in the verifier`); return m[0]; };
const BUILD_GE = def(SCRIPT, /^build_ge\(\) \{[\s\S]*?^\}$/m, "build_ge");
const PROBE = def(SCRIPT, /^probe\(\) \{[\s\S]*?esac; \}$/m, "probe");

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };
type Answer = { match?: string; body: string };
interface Fx {
  J?: Answer[];
  R?: Record<string, Answer[]>;
  curl?: Route[];
  files?: Record<string, string>;
  env?: Record<string, string>;
  bin?: Record<string, string>;
}

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

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
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.replace("%{http_code}",String(st)).replace(/\\\\n/g,"\\n");
process.stdout.write(out);
`;
const STUB = `const fs=require("fs");const [kind,a1,a2]=process.argv.slice(2);
const fx=JSON.parse(fs.readFileSync(process.env.VD_FX,"utf8"));
fs.appendFileSync(process.env.VD_CALLS,kind+"\\t"+a1+(a2!==undefined?"\\t"+a2:"")+"\\n");
const pick=(list,s)=>(list||[]).find((x)=>!x.match||new RegExp(x.match).test(s||""));
const hit=kind==="J"?pick(fx.J,a1):pick((fx.R||{})[a1],a2||"");
process.stdout.write(hit?hit.body:(kind==="R"?'{"code":"PGRST202","message":"stub: no fixture"}':"{}"));
`;

/** Run `body` in bash with the stubs. /tmp/ in the body is pointed at a private directory. */
function run(body: string, fx: Fx = {}, cwd = ROOT): { lines: string[]; calls: string[]; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "vd-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  for (const [n, src] of Object.entries(fx.bin ?? {})) { writeFileSync(join(dir, "bin", n), src); chmodSync(join(dir, "bin", n), 0o755); }
  writeFileSync(join(dir, "stub.cjs"), STUB);
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  writeFileSync(join(dir, "fx.json"), JSON.stringify(fx));
  writeFileSync(join(dir, "routes.json"), JSON.stringify(fx.curl ?? []));
  writeFileSync(join(dir, "calls.log"), "");
  for (const [n, v] of Object.entries(fx.files ?? {})) writeFileSync(join(dir, n), v);
  const prelude = `set -u
K=pk_test; RB=""; B=\${VD_B:-https://p.supabase.co}; SITE=https://site.test; UA=ua
J() { node ${JSON.stringify(join(dir, "stub.cjs"))} J "$1"; }
R() { node ${JSON.stringify(join(dir, "stub.cjs"))} R "$1" "\${2:-}"; }
MC() { echo '{}'; }
${BUILD_GE}
${PROBE}
`;
  writeFileSync(join(dir, "run.sh"), prelude + body.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env, ...fx.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_FX: join(dir, "fx.json"), VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  delete env.DAY30_APPLIED_AT;
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), dir };
}
const has = (lines: string[], status: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${status}  `) && re.test(l));
const show = (lines: string[]) => `\n${lines.join("\n")}`;


// ── fixtures ────────────────────────────────────────────────────────────────
const EN_W4 = readFileSync(resolve(ROOT, "src/i18n/locales/en.json"), "utf8");
/** The wave-3 copy, as main served it before wave 4 (the FAQ and the pass page as they were). */
const EN_W3 = execFileSync("git", ["show", "e75945fe:src/i18n/locales/en.json"], { cwd: ROOT, encoding: "utf8" });
const mcpBuild = (build: string): Route => ({ match: "^OPTIONS https://p\\.supabase\\.co/functions/v1/agent-mcp$", headers: { "x-fn-build": build } });
const W4 = mcpBuild("agent-mcp.2026-10-11.2");
const W3 = mcpBuild("agent-mcp.2026-10-09.71");
const bundle = (en: string): Route[] => [
  { match: "^GET https://site\\.test/$", body: '<script type="module" src="/assets/index-abc.js"></script>' },
  { match: "^GET https://site\\.test/assets/index-abc\\.js$", body: 'import("./en-xyz.js")' },
  { match: "^GET https://site\\.test/assets/en-xyz\\.js$", body: en },
];
const page = (path: string, body: string): Route => ({ match: `^GET https://site\\.test${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, body });
const faqOf = (en: string) => (JSON.parse(en) as { faq: { questions: { subscription: { answer: string } } } }).faq.questions.subscription.answer;

describe("section 74: the subscription FAQ", () => {
  const S74 = sectionFile("74-wave3-payments-account.sh");

  it("a correct wave-4 deploy (the new FAQ in the strings and on /pricing) reads no FAQ FAIL", () => {
    const { lines } = run(S74, { curl: [W4, ...bundle(EN_W4), page("/pricing", `<p>${faqOf(EN_W4)}</p><p>Pro renews every month until you cancel.</p>`)] });
    expect(lines.filter((l) => l.startsWith("FAIL") && /FAQ|paid plan|optional monthly plan|renews/.test(l)), show(lines)).toEqual([]);
    expect(has(lines, "PASS", /English strings carry "there is one optional monthly plan"/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /English strings no longer say a trial turns into the paid plan/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /\/pricing as served to a crawler says Pro renews every month until you cancel/), show(lines)).toBe(true);
  });

  it("with the wave-4 build serving, the old trial sentence FAILs, in the strings and on /pricing", () => {
    const { lines } = run(S74, { curl: [W4, ...bundle(EN_W3), page("/pricing", `<p>${faqOf(EN_W3)}</p>`)] });
    expect(has(lines, "FAIL", /English strings lack "there is one optional monthly plan"/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /English strings still say a trial turns into the paid plan/), show(lines)).toBe(true);
  });

  it("before the wave-4 build, the wave-3 lines are as they were", () => {
    const { lines } = run(S74, { curl: [W3, ...bundle(EN_W3), page("/pricing", `<p>${faqOf(EN_W3)}</p>`)] });
    expect(has(lines, "PASS", /English strings carry "turns into the paid plan when it ends"/), show(lines)).toBe(true);
  });
});

describe("section 65: the pass page and the /agent bake", () => {
  const S65 = sectionFile("65-wave2-entitlements.sh");

  it("a wave-4 deploy is judged by the retirement notice in the strings, and a trial still on the bake FAILs (main's line)", () => {
    const { lines } = run(S65, { curl: [W4, ...bundle(EN_W4), page("/agent", "<p>See how it works: 7 days free for first-time subscribers</p>")] });
    expect(has(lines, "PASS", /English strings carry "we will honour what you bought"/), show(lines)).toBe(true);
    expect(lines.some((l) => /repairRefunded/.test(l)), show(lines)).toBe(false);
    expect(has(lines, "FAIL", /\/agent as served to a crawler still names the retired agent plan's trial/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS") && /\/agent as served to a crawler/.test(l)), show(lines)).toBe(false);
  });

  it("before the wave-4 build, the pass page's repair sentence is still required", () => {
    const { lines } = run(S65, { curl: [W3, ...bundle(EN_W4), page("/agent", "<p>7 days free for first-time subscribers</p>")] });
    expect(has(lines, "FAIL", /English strings lack "repairRefunded"/), show(lines)).toBe(true);
  });
});
