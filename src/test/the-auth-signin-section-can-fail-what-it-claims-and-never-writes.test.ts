// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz-bugs-auth-signin CAN FAIL WHAT IT CLAIMS, NEVER
 * FAILS ON TODAY'S PRODUCTION, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-auth-signin.sh judges the bug
 * round's auth-signin lane: A1-A9 read the published Account and Auth chunks,
 * the entry and the auth strings; F reads the two builds that carry the
 * mailbox guard. Run here against a fake curl, with chunk text cut from the
 * real minified output (production's on 2026-11-15, and a vite build of this
 * branch):
 *   - production as it is today prints INFO and no FAIL;
 *   - a good deploy prints PASS for every claim and no FAIL;
 *   - the frontend published before the paste, or the paste before the
 *     frontend, judges what shipped and leaves the rest INFO;
 *   - each regression prints FAIL;
 *   - every request is a GET or an OPTIONS, and no key is sent or printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-auth-signin.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_bas";
const P = "https://p\\.supabase\\.co";
const S = "https://site\\.test";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,data=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];
  else if(x==="-d"||x==="--data")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(["-m","-A","--max-time","-w"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\theaders:"+hs.join("|")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const key=method+" "+url+(data!==null?"\\t"+data:"");
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbas-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

// The pieces below are cut from production's chunks of 2026-11-15
// (index-psPxJH_H.js, Account-g0tNFsUF.js, Auth-_0yMpa2O.js, en-TEXb77yQ.js)
// and from a vite build of this branch the same day.
const LOADERS = 'const Pg={en:()=>O(()=>import("./en-P1.js"),[]),"en-GB":()=>O(()=>import("./en-GB-P1.js"),[])};const Au={en:()=>O(()=>import("./en-S1.js"),[]),"en-GB":()=>O(()=>import("./en-GB-S1.js"),[])};';
const CHUNKS = 'const m=["assets/Index-Q.js","assets/Account-A1.js","assets/Auth-U1.js","assets/AdminAuthGate-G1.js"];';
const OLD_ADOPT = "const Z=k.useCallback(async(R,M)=>{M!=null&&M.recovery&&(m.current=!0);try{const{error:$}=await _t.auth.setSession({access_token:R.session.access_token,refresh_token:R.session.refresh_token});return $?!1:!0}catch{return!1}},[_]);";
const NEW_ADOPT = 'const Z=k.useCallback(async(C,N)=>{var M,B,me,Q;N!=null&&N.recovery&&(m.current=!0);try{let fe=null;try{fe=((me=(B=(M=await ut.auth.getSession())==null?void 0:M.data)==null?void 0:B.session)==null?void 0:me.user)??null}catch{}const ae=(Q=C.session.user)==null?void 0:Q.id;fe&&(ae?fe.id!==ae:(fe.email??"").toLowerCase()!==C.email)&&(Si(Li),Td());const{error:Ge}=await ut.auth.setSession({access_token:C.session.access_token,refresh_token:C.session.refresh_token});return Ge?Jy(Ge)?"transient":"refused":"ok"}catch{return"transient"}},[_]);';
const OLD_SIGNOUT = 'const so=async M=>{try{await _t.auth.signOut({scope:M})}finally{Iy(),c({kind:"none"})}};';
const NEW_SIGNOUT = 'const so=async M=>{const{error:e}=await ut.auth.signOut({scope:M});e&&nr({title:Ot("auth.signOut.offlineTitle","Signed out on this device"),description:Ot("auth.signOut.offlineEverywhere","You\'re signed out on this device, but we couldn\'t reach the server, so your other devices may still be signed in.")})};';
const KEYS_NOTE = 'ae.keysRevoked.length&&nr({description:Ot("auth.guard.keysRevoked","We also turned off the API and connector keys made on this account before you proved the address ({{keys}}).",{keys:at})});';
const OLD_ENTRY = CHUNKS + LOADERS + OLD_ADOPT + OLD_SIGNOUT;
const NEW_ENTRY = CHUNKS + LOADERS + NEW_ADOPT + NEW_SIGNOUT + KEYS_NOTE;

const OLD_ACCOUNT = "const r=await T.auth.reauthenticate();const{error:A}=await T.auth.updateUser(P.trim()&&!p?{password:j,nonce:P.trim()}:{password:j});const{error:D}=await T.auth.updateUser({email:O});";
const SIGN_OUT_QUESTION = 'i("auth.signOut.builder","Your builder résumé is saved only in this browser, and signing out deletes it.")';
const NEW_RESET_MAIL = "await T.auth.resetPasswordForEmail(A,{redirectTo:`${window.location.origin}/auth?mode=reset${Us()}`});";
const NEW_VERIFY = 'const{data:J,error:oe}=await T.auth.verifyOtp({email:A,token:v.trim(),type:"recovery"});';
const NEW_PASSWORD = "const{error:A}=await T.auth.updateUser({password:w});";
const NEW_EMAIL = 'const{error:D}=await T.auth.updateUser({email:A},{emailRedirectTo:Bs("/account")});';
const NEW_ACCOUNT = NEW_RESET_MAIL + NEW_VERIFY + NEW_PASSWORD + NEW_EMAIL + SIGN_OUT_QUESTION;

const MISMATCH_OFFER = 'w(b=>b("auth.mismatch","We couldn\'t sign you in with that email and password.")),G(a);return}';
const REMEMBERED = 'if(n){const f=we(m);u(!1),j(""),w(q=>q("auth.email.rememberedMismatch","We couldn\'t sign you in as {{email}}. Type your address to try again.",{email:f}));return}';
const OLD_EXPIRED = 's("auth.reset.expired","This reset link has expired or was already used, so no password was set. Ask for a new one.")';
const NEW_EXPIRED = 's("auth.reset.expired","This reset link has expired or was already used. If you already chose a new password with this email\'s code, sign in with it; otherwise ask for a new link.")';
const BLIP = 's("auth.confirm.adoptFailed","We verified your link but couldn\'t finish signing in. Check your connection and try again.")';
const OLD_AUTH = `if(/invalid login credentials|invalid_credentials/i.test(n.error)){${MISMATCH_OFFER}${OLD_EXPIRED}`;
const NEW_AUTH = `if(/invalid login credentials|invalid_credentials/i.test(i.error)){${REMEMBERED}${MISMATCH_OFFER}${NEW_EXPIRED}${BLIP}`;

const PAGE_EN = 'const e={home:{title:"Jobs"}};export{e as default};';
const OLD_EN = 'const e={mismatch:"We couldn\'t sign you in with that email and password.",reset:{expired:"This reset link has expired or was already used, so no password was set. Ask for a new one."}};export{e as default};';
const NEW_EN = 'const e={mismatch:"We couldn\'t sign you in with that email and password.",reset:{expired:"This reset link has expired or was already used. If you already chose a new password with this email\'s code, sign in with it; otherwise ask for a new link."}};export{e as default};';

type Over = { home?: string; entry?: string; account?: string | null; auth?: string; en?: string; builds?: Record<string, string | null> };
/** Production with this lane's frontend published (front) and its functions pasted (fns). */
function routes(o: Over = {}, front = true, fns = true): Route[] {
  const builds: Record<string, string | null> = {
    "auth-signed-in": fns ? "auth-signed-in.2026-11-12.1" : "auth-signed-in.2026-11-09.1",
    "get-account-data": fns ? "get-account-data.2026-11-12.1" : "get-account-data.2026-11-09.1",
    ...o.builds,
  };
  const account = o.account === undefined ? (front ? NEW_ACCOUNT : OLD_ACCOUNT) : o.account;
  return [
    { match: `^GET ${S}/$`, body: o.home ?? '<html><head><script type="module" crossorigin src="/assets/index-E1.js"></script></head></html>' },
    { match: `^GET ${S}/assets/index-E1\\.js$`, body: o.entry ?? (front ? NEW_ENTRY : OLD_ENTRY) },
    ...(account === null ? [] : [{ match: `^GET ${S}/assets/Account-A1\\.js$`, body: account }]),
    { match: `^GET ${S}/assets/Auth-U1\\.js$`, body: o.auth ?? (front ? NEW_AUTH : OLD_AUTH) },
    { match: `^GET ${S}/assets/en-P1\\.js$`, body: PAGE_EN },
    { match: `^GET ${S}/assets/en-S1\\.js$`, body: o.en ?? (front ? NEW_EN : OLD_EN) },
    ...Object.entries(builds).map(([fn, b]) => ({ match: `^OPTIONS ${P}/functions/v1/${fn}$`, headers: b ? { "x-fn-build": b } : {} })),
  ];
}
const has = (lines: string[], verdict: string, re: RegExp) => lines.some((l) => l.startsWith(verdict) && re.test(l));
const show = (lines: string[]) => lines.join("\n");
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const CLAIMS = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"];

describe("today's production, before the merge and the paste", () => {
  it("prints no FAIL: every claim not yet shipped is INFO, and says what production does today", () => {
    const { lines, out } = run(routes({}, false, false));
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of [...CLAIMS, "F"]) expect(has(lines, "INFO", new RegExp(`^INFO {2}${c} `)), `${c}\n${show(lines)}`).toBe(true);
    expect(has(lines, "INFO", /^INFO {2}A1 .*unchecked nonce/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /^INFO {2}A5 .*nothing cleared/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /^INFO {2}A6 .*says no password was set/), show(lines)).toBe(true);
    expect(lines.every((l) => /^(PASS|FAIL|INFO) /.test(l) || /^== 99zzzzzzz\. /.test(l)), show(lines)).toBe(true);
    expect(out).not.toContain(KEY);
  });
});

describe("a good deploy", () => {
  it("prints PASS for every claim and no FAIL", () => {
    const { lines } = run(routes());
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of [...CLAIMS, "F"]) expect(has(lines, "PASS", new RegExp(`^PASS {2}${c} `)), `${c}\n${show(lines)}`).toBe(true);
    expect(has(lines, "INFO", /^INFO {2}A6 |^INFO {2}A0 .*auth strings en-S1\.js/), show(lines)).toBe(true);
  });

  it("asks only with GET and OPTIONS, and sends no key: nothing is posted", () => {
    const { calls, out } = run(routes());
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c, c).toMatch(/^curl\t(GET|OPTIONS) /);
    for (const c of calls) expect(c, c).not.toContain(KEY);
    expect(calls.filter((c) => /^curl\tOPTIONS /.test(c))).toHaveLength(2);
    expect(out).not.toContain(KEY);
  });

  it("the frontend first: A1-A9 judged, F INFO until the paste", () => {
    const { lines } = run(routes({}, true, false));
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of CLAIMS) expect(has(lines, "PASS", new RegExp(`^PASS {2}${c} `)), `${c}\n${show(lines)}`).toBe(true);
    expect(lines.filter((l) => /^INFO {2}F /.test(l)), show(lines)).toHaveLength(2);
  });

  it("the paste first: F judged, A1-A9 INFO until the merge publishes", () => {
    const { lines } = run(routes({}, false, true));
    expect(fails(lines), show(lines)).toEqual([]);
    expect(has(lines, "PASS", /^PASS {2}F /), show(lines)).toBe(true);
    for (const c of CLAIMS) expect(has(lines, "INFO", new RegExp(`^INFO {2}${c} `)), `${c}\n${show(lines)}`).toBe(true);
  });
});

describe("each regression prints FAIL once the lane's frontend is live", () => {
  it("A0: no entry, or an entry that names no Account chunk", () => {
    expect(has(run(routes({ home: "<html></html>" })).lines, "FAIL", /^FAIL {2}A0 the homepage names no/)).toBe(true);
    expect(has(run(routes({ account: null })).lines, "FAIL", /^FAIL {2}A0 .*no readable Account and Auth chunks/)).toBe(true);
    expect(has(run(routes({ account: null }, false, false)).lines, "FAIL", /^FAIL {2}A0 /)).toBe(true);
  });

  it("A1: the nonce back, the code no longer checked by the auth server, or a reauthentication mail", () => {
    const nonce = run(routes({ account: NEW_ACCOUNT.replace("{password:w}", "{password:w,nonce:v.trim()}") })).lines;
    expect(has(nonce, "FAIL", /^FAIL {2}A1 .*nonce sent with the password change yes/), show(nonce)).toBe(true);
    expect(has(run(routes({ account: NEW_ACCOUNT.replace(NEW_VERIFY, "") })).lines, "FAIL", /^FAIL {2}A1 .*verifyOtp type recovery no/)).toBe(true);
    const reauth = run(routes({ account: NEW_ACCOUNT + "await T.auth.reauthenticate();" })).lines;
    expect(has(reauth, "FAIL", /^FAIL {2}A1 .*reauthenticate called yes/), show(reauth)).toBe(true);
    expect(has(reauth, "FAIL", /^FAIL {2}A2 /), show(reauth)).toBe(true);
  });

  it("A2: an address change with no redirect, or a reset mail not sent to the reset step", () => {
    const bare = run(routes({ account: NEW_ACCOUNT.replace(NEW_EMAIL, "const{error:D}=await T.auth.updateUser({email:A});") })).lines;
    expect(has(bare, "FAIL", /^FAIL {2}A2 .*address change with no redirect yes, with one no/), show(bare)).toBe(true);
    expect(has(run(routes({ account: NEW_ACCOUNT.replace("mode=reset", "mode=signin") })).lines, "FAIL", /^FAIL {2}A2 .*redirected to the reset step no/)).toBe(true);
  });

  it("A3: the sign-out question gone", () => {
    const { lines } = run(routes({ account: NEW_ACCOUNT.replace(SIGN_OUT_QUESTION, "") }));
    expect(has(lines, "FAIL", /^FAIL {2}A3 .*saved only in this browser/), show(lines)).toBe(true);
  });

  it("A4: the sign-out result thrown away again, or the notice gone", () => {
    const unread = run(routes({ entry: NEW_ENTRY.replace(NEW_SIGNOUT, OLD_SIGNOUT + 'const z="may still be signed in";') })).lines;
    expect(has(unread, "FAIL", /^FAIL {2}A4 .*try\/finally yes/), show(unread)).toBe(true);
    const quiet = run(routes({ entry: NEW_ENTRY.replace("may still be signed in", "may be signed in") })).lines;
    expect(has(quiet, "FAIL", /^FAIL {2}A4 .*notice present no/), show(quiet)).toBe(true);
  });

  it("A5: a session handed over with no look at the account here, or no adoptSession to read", () => {
    const blind = run(routes({ entry: NEW_ENTRY.replace(NEW_ADOPT, OLD_ADOPT) })).lines;
    expect(has(blind, "FAIL", /^FAIL {2}A5 .*no look at the account this browser holds/), show(blind)).toBe(true);
    const gone = run(routes({ entry: NEW_ENTRY.replace(NEW_ADOPT, "") })).lines;
    expect(has(gone, "FAIL", /^FAIL {2}A5 S14X-099 no adoptSession .*cannot be judged/), show(gone)).toBe(true);
  });

  it("A6: the old wording in the page or in the strings, or no auth strings to read", () => {
    expect(has(run(routes({ auth: NEW_AUTH.replace(NEW_EXPIRED, OLD_EXPIRED) })).lines, "FAIL", /^FAIL {2}A6 .*'so no password was set' present yes/)).toBe(true);
    expect(has(run(routes({ en: OLD_EN })).lines, "FAIL", /^FAIL {2}A6 .*'so no password was set' present yes/)).toBe(true);
    const lost = run(routes({ entry: NEW_ENTRY.replace(LOADERS, "") })).lines;
    expect(has(lost, "FAIL", /^FAIL {2}A6 S14X-206 the entry names no auth strings chunk/), show(lost)).toBe(true);
  });

  it("A7: the masked refusal that falls through to the offer, or none at all", () => {
    const through = run(routes({ auth: NEW_AUTH.replace("{email:f}));return}", "{email:f}));") })).lines;
    expect(has(through, "FAIL", /^FAIL {2}A7 .*does not return before the offer/), show(through)).toBe(true);
    const none = run(routes({ auth: NEW_AUTH.replace(REMEMBERED, "") })).lines;
    expect(has(none, "FAIL", /^FAIL {2}A7 .*no masked refusal/), show(none)).toBe(true);
  });

  it("A8: a blip after a verified link called expired again", () => {
    const { lines } = run(routes({ auth: NEW_AUTH.replace(BLIP, "") }));
    expect(has(lines, "FAIL", /^FAIL {2}A8 /), show(lines)).toBe(true);
  });

  it("A9: the revoked-keys notice gone", () => {
    const { lines } = run(routes({ entry: NEW_ENTRY.replace(KEYS_NOTE, "") }));
    expect(has(lines, "FAIL", /^FAIL {2}A9 .*auth\.guard\.keysRevoked/), show(lines)).toBe(true);
  });

  it("F: a partial paste, or a function with no build header", () => {
    const part = run(routes({ builds: { "get-account-data": "get-account-data.2026-11-09.1" } })).lines;
    expect(has(part, "FAIL", /^FAIL {2}F S14X-228 get-account-data serves get-account-data\.2026-11-09\.1 while auth-signed-in=.*a partial paste/), show(part)).toBe(true);
    expect(has(part, "PASS", /^PASS {2}F /), show(part)).toBe(false);
    const bare = run(routes({ builds: { "auth-signed-in": null } }, false, false)).lines;
    expect(has(bare, "FAIL", /^FAIL {2}F S14X-228 auth-signed-in preflight carries no x-fn-build/), show(bare)).toBe(true);
  });
});
