// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE BUG ROUND'S WRITING-TOOLS VERIFY SECTION FAILS WHAT IT CLAIMS, AND NEVER
 * WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-writing-tools.sh is run against a
 * fake curl that answers from routes and logs every call:
 *   - before the deploy (every function on an earlier build, the old bundle)
 *     it prints INFO and no PASS or FAIL;
 *   - a good deploy prints a PASS for each of the ten builds, the kit
 *     writer's exposed retry-after and the eleven page claims, and no FAIL; a
 *     later build passes too;
 *   - a function the paste left behind, a preflight with no build, the kit's
 *     preflight without retry-after and a published bundle missing any one
 *     claim each print a FAIL;
 *   - NB-10 is INFO until the ledger names it; an answer of retire is judged
 *     by a GET of the preview function, another answer stays INFO;
 *   - nothing is ever posted, and the publishable key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 180_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-writing-tools.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_writing_tools";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

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
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url+(data!==null?" "+data:"")))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.split("\\\\n").join("\\n").replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[], ledger: unknown = { reservations: { "bug-round": { ownerDecided: {} } } }): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdwt-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "ledger.json"), JSON.stringify(ledger));
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VDWT_LEDGER: join(dir, "ledger.json"),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 85_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

const FNS = ["generate-apply-package", "generate-tailored-resume", "generate-interview-coach", "generate-application-answers", "fetch-job-posting",
  "generate-career-path", "generate-career-snapshot", "generate-graduate-gameplan", "generate-keyword-fix", "generate-product-preview"];
const NEW = (fn: string) => `${fn}.2026-11-12.1`;
const OLD = (fn: string) => `${fn}.2026-11-10.3`;
const fnRe = (fn: string) => fn.replace(/-/g, "\\-");

function preflights(build: (fn: string) => string | null, expose = "x-fn-build, retry-after"): Route[] {
  return FNS.map((fn) => {
    const headers: Record<string, string> = { "access-control-allow-headers": "authorization, x-client-info, apikey, content-type" };
    const b = build(fn);
    if (b) headers["x-fn-build"] = b;
    if (fn === "generate-apply-package" && expose) headers["Access-Control-Expose-Headers"] = expose;
    return { match: `^OPTIONS https://p\\.supabase\\.co/functions/v1/${fnRe(fn)}$`, headers };
  });
}

/** The published app, as minified chunks: the round's page, or the one before it. */
type Bundle = Record<string, string>;
const GOOD_BUNDLE: Bundle = {
  "index-Main.js": 'const d=["assets/Board-B.js","assets/Jobs-J.js","assets/Account-A.js","assets/Coach-C.js","assets/career-tools-export-E.js","assets/Modal-M.js"];',
  // The board page names the tailor's error key on its own, as the live one does.
  "Board-B.js": 'n({title:t("jobsPage.tailorErrorTitle","x")});',
  "Jobs-J.js": 'const T={tailor:{limitTitle:["writingTools.tailorBusyTitle","Busy right now"],limit:["writingTools.tailorBusy","x"],errorTitle:["jobsPage.tailorErrorTitle","x"]}};'
    + 'function q(s,c){if(s===401||c==="sign_in_required")return t("applyAnswers.signIn","x");if(s===429&&c==="rate_limited_global")return 1;if(s===429&&c==="rate_limited_network")return 2;return t("applyAnswers.failed","x")}'
    + 'h("p",{"data-testid":"answers-retryable"});h("p",{"data-testid":"answers-joined-draft"});h("p",{"data-testid":"answers-writing"});',
  "Account-A.js": 'n(t("writingTools.lettersStillOwed","x"));async function o(e){return j.code==="ai_unavailable"}n(t("accountPage.acAiUnavailable","x"));',
  "Coach-C.js": 'import{w as x}from"./refusal-R.js";function C({savedCopy:s}){x("coach",e,t);t("interviewCoach.evaluateFailed")}',
  "refusal-R.js": 'const r=t("writingRefusal.dailyNoTime","x");',
  "career-tools-export-E.js": 'function p(d,l){return l.whyAsked}u.save("interview_prep_guide.pdf");',
  "Modal-M.js": 'h("p",{"data-testid":"tailor-posting-truncated"},t("writingTools.postingTruncated","x"));',
};
const OLD_BUNDLE: Bundle = {
  "index-Main.js": 'const d=["assets/Board-B.js","assets/Jobs-J.js","assets/Account-A.js","assets/Coach-C.js","assets/career-tools-export-E.js"];',
  "Board-B.js": 'n({title:t("jobsPage.tailorErrorTitle","x")});',
  "Jobs-J.js": 'const T={tailor:{limitTitle:["jobsPage.tailorLimitTitle","Hourly limit reached"],errorTitle:["jobsPage.tailorErrorTitle","x"]}};'
    + 'function q(s,c){if(s===401||c==="sign_in_required")return t("applyAnswers.signIn","x");return t("applyAnswers.failed","x")}',
  "Account-A.js": 'n(t("accountPage.acAiUnavailable","x"));',
  "Coach-C.js": 'function C({resumeText:r}){t("interviewCoach.evaluateFailed")}',
  "career-tools-export-E.js": 'function p(d){return"Why they ask: "+d}a("Questions to Ask Them");a("Skills to develop:");u.save("interview_prep_guide.pdf");',
};

function site(bundle: Bundle): Route[] {
  const main = Object.keys(bundle).find((n) => n.startsWith("index-"));
  return [
    { match: "^GET https://site\\.test/$", body: `<!doctype html><script type="module" src="/assets/${main}"></script>` },
    ...Object.entries(bundle).map(([n, body]) => ({ match: `^GET https://site\\.test/assets/${n.replace(/[.-]/g, (c) => `\\${c}`)}$`, body })),
  ];
}
/** The good bundle with one chunk's text changed. */
const edit = (chunk: string, from: string | RegExp, to: string): Bundle => {
  const b = { ...GOOD_BUNDLE };
  const next = b[chunk].replace(from, to);
  if (next === b[chunk]) throw new Error(`the edit to ${chunk} changed nothing`);
  b[chunk] = next;
  return b;
};

const good = (o: { build?: (fn: string) => string | null; expose?: string; bundle?: Bundle; extra?: Route[] } = {}): Route[] =>
  [...(o.extra ?? []), ...preflights(o.build ?? NEW, o.expose ?? "x-fn-build, retry-after"), ...site(o.bundle ?? GOOD_BUNDLE)];
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const passes = (lines: string[]) => lines.filter((l) => l.startsWith("PASS"));
const writes = (calls: string[]) => calls.filter((c) => !/^curl\t(GET|OPTIONS) /.test(c));
const failing = (lines: string[], id: string) => fails(lines).filter((l) => l.startsWith(`FAIL  ${id} `));

let goodRun: ReturnType<typeof run> | null = null;
const theGoodRun = () => (goodRun ??= run(good()));

describe("section 99zzzzzzz (bug round, lane writing-tools)", () => {
  it("before the deploy it prints INFO and no PASS or FAIL, and writes nothing", () => {
    const { lines, calls, out } = run(good({ build: OLD, expose: "", bundle: OLD_BUNDLE }));
    expect(fails(lines), out).toEqual([]);
    expect(passes(lines), out).toEqual([]);
    expect(lines.filter((l) => /not deployed yet/.test(l))).toHaveLength(FNS.length);
    expect(lines.filter((l) => /^INFO  P\d+ /.test(l)).length, out).toBe(12);
    expect(writes(calls)).toEqual([]);
    expect(out).not.toContain(KEY);
  });

  it("a good deploy PASSes every build, the exposed retry-after and every page claim, with no FAIL", () => {
    const { lines, calls, out } = theGoodRun();
    expect(fails(lines), out).toEqual([]);
    for (let i = 1; i <= FNS.length; i++) expect(passes(lines).some((l) => l.startsWith(`PASS  F${i} `)), `F${i}\n${out}`).toBe(true);
    expect(passes(lines).some((l) => l.startsWith("PASS  S1 ")), out).toBe(true);
    for (let i = 1; i <= 11; i++) expect(passes(lines).some((l) => l.startsWith(`PASS  P${i} `)), `P${i}\n${out}`).toBe(true);
    expect(lines.some((l) => /^INFO  O1 owner pending/.test(l)), out).toBe(true);
    expect(writes(calls)).toEqual([]);
    expect(out).not.toContain(KEY);
  });

  it("a later build passes too", () => {
    const { lines, out } = run(good({ build: (fn) => `${fn}.2026-11-20.1` }));
    expect(fails(lines), out).toEqual([]);
    expect(passes(lines).filter((l) => /^PASS  F\d+ /.test(l))).toHaveLength(FNS.length);
  });
});

describe("each claim can FAIL", () => {
  it("a function the paste left behind, and one whose preflight names no build", () => {
    const { lines, out } = run(good({ build: (fn) => (fn === "generate-keyword-fix" ? OLD(fn) : fn === "fetch-job-posting" ? null : NEW(fn)) }));
    expect(failing(lines, "F9"), out).toHaveLength(1);
    expect(failing(lines, "F9")[0]).toMatch(/left it behind/);
    expect(failing(lines, "F5"), out).toHaveLength(1);
    expect(fails(lines)).toHaveLength(2);
  });

  it("the kit writer on this round's build without retry-after exposed", () => {
    const { lines, out } = run(good({ expose: "x-fn-build" }));
    expect(failing(lines, "S1"), out).toHaveLength(1);
    expect(fails(lines)).toHaveLength(1);
  });

  const BROKEN: Array<[string, Bundle]> = [
    ["P1", edit("Jobs-J.js", 'limitTitle:["writingTools.tailorBusyTitle"', 'limitTitle:["jobsPage.tailorLimitTitle"')],
    ["P2", edit("Jobs-J.js", 'if(s===429&&c==="rate_limited_network")return 2;', "")],
    ["P3", edit("Jobs-J.js", '"answers-retryable"', '"answers-undrafted"')],
    ["P4", edit("Jobs-J.js", '"answers-joined-draft"', '"answers-draft"')],
    ["P5", edit("Jobs-J.js", '"answers-writing"', '"answers-yours"')],
    ["P6", edit("career-tools-export-E.js", "return l.whyAsked", 'return"Why they ask: "')],
    ["P7", edit("Account-A.js", 'n(t("writingTools.lettersStillOwed","x"));', "")],
    ["P8", edit("Account-A.js", 'j.code==="ai_unavailable"', "j.status===402")],
    ["P9", edit("Coach-C.js", 'x("coach",e,t);', "")],
    ["P10", edit("Coach-C.js", "{savedCopy:s}", "{resumeText:s}")],
    ["P11", edit("Modal-M.js", '"tailor-posting-truncated"', '"tailor-result"')],
  ];
  for (const [id, bundle] of BROKEN) {
    it(`${id}: a published bundle without the claim`, () => {
      const { lines, out } = run(good({ bundle }));
      expect(failing(lines, id), out).toHaveLength(1);
      expect(fails(lines), out).toHaveLength(1);
    });
  }

  it("P9: the coach calls a helper that never reaches the shared refusal copy", () => {
    const { lines, out } = run(good({ bundle: edit("refusal-R.js", "writingRefusal.dailyNoTime", "somethingElse") }));
    expect(failing(lines, "P9"), out).toHaveLength(1);
  });

  it("P0: a homepage that names no entry", () => {
    const routes = good().map((r) => (r.match === "^GET https://site\\.test/$" ? { ...r, body: "<html>maintenance</html>" } : r));
    const { lines, out } = run(routes);
    expect(failing(lines, "P0"), out).toHaveLength(1);
  });
});

describe("NB-10, owner-gated", () => {
  const PREVIEW_GET = (status: number, body: string): Route => ({ match: "^GET https://p\\.supabase\\.co/functions/v1/generate\\-product\\-preview$", status, body });
  const decided = (answer: string) => ({ reservations: { "bug-round": { ownerDecided: { "NB-10": answer } } } });

  it("is INFO 'owner pending' until the ledger names it, and the preview is not asked", () => {
    const { lines, calls } = theGoodRun();
    expect(lines.filter((l) => /O1/.test(l))).toEqual([expect.stringMatching(/^INFO  O1 owner pending/)]);
    expect(calls.some((c) => /^curl\tGET .*generate-product-preview/.test(c))).toBe(false);
  });

  it("retire, and the preview answers 410 retired: PASS", () => {
    const { lines, calls, out } = run(good({ extra: [PREVIEW_GET(410, JSON.stringify({ error: "This endpoint has been retired.", code: "retired" }))] }), decided("retire"));
    expect(lines.some((l) => l.startsWith("PASS  O1 ")), out).toBe(true);
    expect(writes(calls)).toEqual([]);
  });

  it("retire, on this round's build, and the preview still answers: FAIL", () => {
    const { lines, out } = run(good({ extra: [PREVIEW_GET(500, JSON.stringify({ error: "Failed to generate preview" }))] }), decided("retire"));
    expect(failing(lines, "O1"), out).toHaveLength(1);
  });

  it("retire, before the paste: INFO", () => {
    const { lines, out } = run(good({ build: OLD, expose: "", bundle: OLD_BUNDLE, extra: [PREVIEW_GET(500, "{}")] }), decided("retire"));
    expect(fails(lines), out).toEqual([]);
    expect(lines.some((l) => /^INFO  O1 the owner answered retire/.test(l)), out).toBe(true);
  });

  it("an answer other than retire stays INFO", () => {
    const { lines, out } = run(good(), decided("keep previews signed-in only"));
    expect(lines.filter((l) => /O1/.test(l))).toEqual([expect.stringMatching(/^INFO  O1 the owner answered NB-10/)]);
    expect(fails(lines), out).toEqual([]);
  });
});
