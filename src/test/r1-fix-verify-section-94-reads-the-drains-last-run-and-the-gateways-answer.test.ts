// @vitest-environment node
//
// Node, not jsdom: this file runs verify section 94 in bash, with a stub curl.
/**
 * R1 FIX (review major, decision 5; S12-179): VERIFY SECTION 94 READS THE
 * DRAIN'S LAST RUN AND THE GATEWAY'S ANSWER, NOT ONLY THAT A JOB EXISTS.
 *
 * net.http_post only queues a request, so every run of the drain read
 * 'succeeded' even while each of its posts was refused, and section 94 printed
 * PASS on runs > 0 and failed = 0. The drain now posts no JWT (the function
 * runs with verify_jwt = false and checks the cron key itself) and fails its
 * own run when the drain refused a post. Section 94 here:
 *   - FAILs when no job exists, when a run failed, and when the LAST run did
 *     not succeed;
 *   - proves the gateway no longer asks for a JWT: a post with none must be
 *     refused 403 by the function's own check, naming the drain; a gateway 401
 *     is a FAIL that says what to deploy.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const HELPERS = ["build_ge", "probe"].map((n) => new RegExp(`^${n}\\(\\) \\{[\\s\\S]*?^\\}$|^${n}\\(\\) \\{.*\\}$`, "m").exec(SCRIPT)?.[0] ?? "").join("\n");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/94-r1-mail.sh"), "utf8");

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

type Cfg = { cron: unknown; noJwt: { status: number; body: string } };
const CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let url="",method="GET",out=null,w=null,dump=false;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-o")out=a[++i];else if(x==="-w")w=a[++i];else if(x==="-H")hs.push(a[++i]);
  else if(x==="-D"){i++;dump=true}else if(x==="-d"||x==="-m"||x==="-A")i++;else if(!x.startsWith("-"))url=x;}
const cfg=JSON.parse(fs.readFileSync(process.env.VD_CFG,"utf8"));
fs.appendFileSync(process.env.VD_CALLS,method+" "+url+" auth="+hs.some((h)=>/^authorization:/i.test(h))+"\\n");
let status=200,body="",head="";
const ans=(d)=>JSON.stringify({Status:0,Answer:[{data:d}]});
if(url.includes("dns.google")){
  if(/name=send\\.resumebooster\\.work/.test(url))body=ans("v=spf1 include:amazonses.com ~all");
  else if(/name=amazonses\\.com/.test(url))body=ans("v=spf1 ip4:1.2.3.4 ~all");
  else if(/_domainkey/.test(url))body=ans("p=MIGf");
  else if(/_dmarc/.test(url))body=ans("v=DMARC1; p=none");
  else if(/notify\\./.test(url))body=ans("ns1.lovable.cloud.");
  else body=ans("lovable_verify=abc");
}else if(method==="OPTIONS"){const fn=url.split("/functions/v1/")[1];head="HTTP/2 200\\r\\nx-fn-build: "+fn+".2026-10-14.1\\r\\n\\r\\n";}
else if(url.includes("get_cron_health"))body=JSON.stringify(cfg.cron);
else if(url.includes("/rest/v1/rpc/"))body=JSON.stringify({code:"42501"});
else if(url.includes("resend-webhook")){status=401;body="{}";}
else if(url.includes("process-email-queue")){
  if(hs.some((h)=>/^authorization:/i.test(h))){status=403;body=JSON.stringify({error:"Forbidden",refusedBy:"process-email-queue"});}
  else{status=cfg.noJwt.status;body=cfg.noJwt.body;}
}
if(dump)process.stdout.write(head);
if(out){fs.writeFileSync(out,body)}else if(!dump){process.stdout.write(body)}
if(w)process.stdout.write(w.replace("%{http_code}",String(status)));
`;

function run(cfg: Cfg) {
  const dir = mkdtempSync(join(tmpdir(), "vd-r1-94-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "cfg.json"), JSON.stringify(cfg));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "94.sh"), SECTION.replace(/\/tmp\//g, `${dir}/`));
  writeFileSync(join(dir, "run.sh"), `set -u\nK=pk_test; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${HELPERS}\n. ${JSON.stringify(join(dir, "94.sh"))}\n`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_CFG: join(dir, "cfg.json"), VD_CALLS: join(dir, "calls.log"),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8") };
}
const has = (lines: string[], status: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${status}  `) && re.test(l));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

const job = (o: Record<string, unknown> = {}) => [{ ch_jobname: "process-email-queue", ch_schedule: "10 seconds", ch_active: true, ch_runs: 360, ch_failed: 0, ch_last_status: "succeeded", ...o }];
const REFUSED_HERE = { status: 403, body: JSON.stringify({ error: "Forbidden", refusedBy: "process-email-queue" }) };

describe("the drain job", () => {
  it("PASSes a job whose last run succeeded with no failures (positive control)", () => {
    const { lines } = run({ cron: job(), noJwt: REFUSED_HERE });
    expect(has(lines, "PASS", /process-email-queue cron: .*last run succeeded/), show(lines)).toBe(true);
  });

  it("FAILs a job whose last run failed, though every earlier run succeeded", () => {
    const { lines } = run({ cron: job({ ch_failed: 0, ch_last_status: "failed" }), noJwt: REFUSED_HERE });
    expect(has(lines, "FAIL", /process-email-queue cron: .*last run failed/), show(lines)).toBe(true);
  });

  it("FAILs failed runs, and no job at all", () => {
    expect(has(run({ cron: job({ ch_failed: 3 }), noJwt: REFUSED_HERE }).lines, "FAIL", /process-email-queue cron/)).toBe(true);
    expect(has(run({ cron: [], noJwt: REFUSED_HERE }).lines, "FAIL", /no process-email-queue cron job/)).toBe(true);
  });
});

describe("the gateway's answer to a post with no JWT (the cron sends none)", () => {
  it("PASSes the function's own 403 naming the drain, and sends that post with no Authorization header", () => {
    const { lines, calls } = run({ cron: job(), noJwt: REFUSED_HERE });
    expect(has(lines, "PASS", /a post with no JWT reaches the function \(verify_jwt off\)/), show(lines)).toBe(true);
    expect(calls).toMatch(/POST https:\/\/p\.supabase\.co\/functions\/v1\/process-email-queue auth=false/);
  });

  it("FAILs a gateway 401: verify_jwt is still on and every cron post would be refused unheard", () => {
    const { lines } = run({ cron: job(), noJwt: { status: 401, body: JSON.stringify({ code: 401, message: "Missing authorization header" }) } });
    expect(has(lines, "FAIL", /the gateway refused a post with no JWT \(401\): verify_jwt is still on/), show(lines)).toBe(true);
  });

  it("FAILs a 403 that does not name the drain (someone else's refusal)", () => {
    const { lines } = run({ cron: job(), noJwt: { status: 403, body: "{}" } });
    expect(has(lines, "FAIL", /answered a post with no JWT with HTTP 403/), show(lines)).toBe(true);
  });
});
