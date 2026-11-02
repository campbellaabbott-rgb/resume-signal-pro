// @vitest-environment node
//
// Node, not jsdom: this file runs verifier sections in bash, with a fake curl
// on PATH, through child_process.
/**
 * THE AUDIT-REST FIXER SECTION CAN FAIL WHAT IT CLAIMS, AND NEVER WRITES
 * (scripts/verify-deploy.d/99zzzz-audit-rest-fixer.sh), AND THE PAGES
 * SECTION'S P1 READS THE PAIR IT CLAIMS (99zzzz-audit-rest-pages.sh).
 *
 * The sections run against a fake curl that answers from routes and logs every
 * call:
 *   - a good publish (every chunk carries its new key, the claim column
 *     exists, the OAuth server off) passes every claim and fails none;
 *   - the old publish fails each page claim, a missing column fails, and an
 *     OAuth server that answers with no probe of /auth/v1/user fails;
 *   - with a connector token, /auth/v1/user answering 200 fails and 401
 *     passes, and the token is never printed;
 *   - every call is a GET: nothing is posted, nothing PUT to the account;
 *   - P1 fails a success page that sends a share id alone, which the review
 *     found the old line passed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const FIXER = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzz-audit-rest-fixer.sh"), "utf8");
const PAGES = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzz-audit-rest-pages.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_fixer";
const TOKEN = "eyJ.connector_SECRET_token.sig";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary"||x==="-T"||x==="--upload-file")data=a[++i];else if(["-H","-m","-A","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.split("\\\\n").join("\\n").replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(section: string, routes: Route[], extraEnv: Record<string, string> = {}): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdfixer-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + section.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
    ...extraEnv,
  };
  if (!("RB_CONNECTOR_TOKEN" in extraEnv)) delete env.RB_CONNECTOR_TOKEN;
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const get = (url: string, body: string, status = 200): Route => ({ match: `^GET ${esc(url)}$`, status, body });

type Chunks = Record<string, string>;
const NEW_CHUNKS: Chunks = {
  ProductSuccess: `t("productSuccess.refusal.busy.title");h("a",{"data-testid":"sign-in-again",href:"/auth"});import"./vendor-z9.js";`,
  // The spend key lives in the library the page imports, as gap-report does.
  Account: `import{s as x}from"./gap-report-q1.js";x();`,
  OAuthConsent: `h("p",{"data-testid":"consent-scopes"},t("oauthConsent.scopesAsked"))`,
  Privacy: `h("li",{"data-fonts":!0},"No font host: the site's fonts are served from this site itself")`,
  FreelanceBoost: `"This link doesn't hold a completed Freelance Boost payment, so there is nothing to generate yet"`,
  AnalyticsDashboard: `"New and returning visitors are approximate on every day, the fully read ones too"`,
};
const OLD_CHUNKS: Chunks = {
  ProductSuccess: `t("productSuccess.refusal.refunded.title")`,
  Account: `import{r as x}from"./gap-report-q1old.js";x();`,
  OAuthConsent: `"It cannot buy anything, change your plan, or see your payment details."`,
  Privacy: `h("li",null,"Google Fonts (your browser loads the site's fonts from Google, which sees your IP address)")`,
  FreelanceBoost: `"This link doesn't hold a paid Freelance Boost purchase"`,
  AnalyticsDashboard: `"Days before the read stopped are a floor"`,
};
function site(chunks: Chunks): Route[] {
  const names = Object.keys(chunks);
  const entry = names.map((n, i) => `"./${n}-h${i}.js"`).join(",");
  return [
    get("https://site.test/", `<script type="module" crossorigin src="/assets/index-main1.js"></script>`),
    get("https://site.test/assets/index-main1.js", `const routes=[${entry}];`),
    ...names.map((n, i) => get(`https://site.test/assets/${n}-h${i}.js`, chunks[n])),
    get("https://site.test/assets/gap-report-q1.js", `const k="rb_gap_auto_spend";export{k as s};`),
    get("https://site.test/assets/gap-report-q1old.js", `const k="rb_gap_fits";export{k as r};`),
    get("https://site.test/assets/vendor-z9.js", `/* vendor */`),
  ];
}
const CLAIMS = "https://p.supabase.co/rest/v1/company_claims?select=locale&limit=1";
const DISCOVERY = "https://p.supabase.co/auth/v1/.well-known/oauth-authorization-server";
const USER = "https://p.supabase.co/auth/v1/user";
const good = (): Route[] => [...site(NEW_CHUNKS), get(CLAIMS, "[]"), get(DISCOVERY, `{"message":"not found"}`, 404)];
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const passes = (lines: string[]) => lines.filter((l) => l.startsWith("PASS"));

describe("the audit-rest fixer section", () => {
  it("a good publish passes every page claim and the column, fails none, and leaves S9-001 as INFO", () => {
    const { lines, out } = run(FIXER, good());
    expect(fails(lines), out).toEqual([]);
    expect(passes(lines).map((l) => l.split(" ")[2]), out).toEqual(["F1", "F1b", "F2", "F3", "F4", "F5", "F6", "company_claims.locale"]);
    expect(lines.some((l) => /^INFO {2}\/auth\/v1\/user not probed .*S9-001 is open on that path, latent while the OAuth server is off/.test(l)), out).toBe(true);
  });

  it("the old publish fails each page claim, a column that is missing fails, and an OAuth server answering unprobed fails", () => {
    const { lines, out } = run(FIXER, [
      ...site(OLD_CHUNKS),
      get(CLAIMS, `{"code":"42703","message":"column company_claims.locale does not exist"}`, 400),
      get(DISCOVERY, `{"issuer":"https://p.supabase.co/auth/v1"}`),
    ]);
    const names = fails(lines).map((l) => l.split(" ")[2]);
    expect(names, out).toEqual(["F1", "F1b", "F2", "F3", "F4", "F5", "F6", "company_claims.locale", "the"]);
    expect(fails(lines).at(-1), out).toMatch(/OAuth server's discovery answers 200 and \/auth\/v1\/user is not probed.*S9-001 is open/);
    expect(passes(lines), out).toEqual([]);
  });

  it("a consent page that lists scopes but keeps the old promise still fails", () => {
    const { lines, out } = run(FIXER, [...site({ ...NEW_CHUNKS, OAuthConsent: `"consent-scopes";"It cannot buy anything, change your plan"` }), get(CLAIMS, "[]"), get(DISCOVERY, "", 404)]);
    expect(fails(lines).map((l) => l.split(" ")[2]), out).toEqual(["F3"]);
  });

  it("a key that may not read the table is not judged, and no entry fails every page claim", () => {
    const { lines, out } = run(FIXER, [get(CLAIMS, `{"code":"42501","message":"permission denied"}`, 401), get(DISCOVERY, "", 404)]);
    expect(lines.some((l) => /^INFO {2}company_claims\.locale not judged: .*401 42501/.test(l)), out).toBe(true);
    expect(fails(lines), out).toHaveLength(7);
    expect(fails(lines).every((l) => /names no \w+ chunk/.test(l)), out).toBe(true);
  });

  it("with a connector token: /auth/v1/user answering 200 fails, 401 passes, and the token is never printed", () => {
    const open = run(FIXER, [...good(), get(USER, `{"id":"u"}`)], { RB_CONNECTOR_TOKEN: TOKEN });
    expect(fails(open.lines), open.out).toEqual([expect.stringMatching(/^FAIL {2}\/auth\/v1\/user ANSWERS a connector token \(200\).*S9-001 is open/)]);
    const shut = run(FIXER, [...good(), get(USER, `{"code":403,"msg":"invalid audience"}`, 401)], { RB_CONNECTOR_TOKEN: TOKEN });
    expect(fails(shut.lines), shut.out).toEqual([]);
    expect(shut.lines.some((l) => l.startsWith("PASS  /auth/v1/user refuses a connector token (401)")), shut.out).toBe(true);
    for (const r of [open, shut]) {
      expect(r.out).not.toContain(TOKEN);
      expect(r.out).not.toContain(KEY);
    }
  });

  it("never writes: every call is a GET, and the account endpoint is asked once, only with a token", () => {
    const { calls } = run(FIXER, [...good(), get(USER, "", 401)], { RB_CONNECTOR_TOKEN: TOKEN });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.startsWith("curl\tGET ")), calls.join("\n")).toBe(true);
    expect(calls.filter((c) => c.includes("/auth/v1/user"))).toHaveLength(1);
    const unprobed = run(FIXER, good());
    expect(unprobed.calls.some((c) => c.includes("/auth/v1/user"))).toBe(false);
  });
});

describe("the pages section's P1", () => {
  const pagesRoutes = (successChunk: string): Route[] => [
    get("https://site.test/", `<script type="module" src="/assets/index-main2.js"></script>`),
    get("https://site.test/assets/index-main2.js", `const r=["./Success-s1.js","./ProductSuccess-p1.js"];`),
    get("https://site.test/assets/Success-s1.js", successChunk),
    get("https://site.test/assets/ProductSuccess-p1.js", `"productSuccess.refusal.refunded";"no-purchase-reference"`),
  ];
  const NOTE = `t("success.sharedViewDeleteNote");h("p",{"data-testid":"shared-computer-note"});`;
  const p1 = (lines: string[]) => lines.filter((l) => /published success page/.test(l));

  it("passes a page that sends '<share id>:<purchase>', as a template or a concatenation", () => {
    for (const call of ["await e.rpc(\"delete_analysis_by_share_id\",{p_share_id:`${n}:${a}`})", "e.rpc(\"delete_analysis_by_share_id\",{p_share_id:n+\":\"+a})"]) {
      const { lines, out } = run(PAGES, pagesRoutes(call + NOTE));
      expect(p1(lines), out).toEqual([expect.stringMatching(/^PASS {2}the published success page \(Success-s1\.js\) sends '<share id>:<purchase>'/)]);
    }
  });

  it("fails a page that sends a share id alone, though it carries the note (the old line passed it)", () => {
    const { lines, out } = run(PAGES, pagesRoutes(`e.rpc("delete_analysis_by_share_id",{p_share_id:n});` + NOTE));
    expect(p1(lines), out).toEqual([expect.stringMatching(/^FAIL {2}the published success page \(Success-s1\.js\) does not send '<share id>:<purchase>'/)]);
  });
});
