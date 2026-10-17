// @vitest-environment node
//
// Node, not jsdom: this file runs verify section 94 in bash, with a stub curl.
/**
 * R1 FIX (review major, decision 5; S12-179; lead decision B of the third
 * fixer round): VERIFY SECTION 94 READS OUR DRAIN'S LAST RUN AND THE GATEWAY'S
 * ANSWER, NOT ONLY THAT A JOB EXISTS.
 *
 * net.http_post only queues a request, so every run of the drain read
 * 'succeeded' even while each of its posts was refused, and section 94 printed
 * PASS on runs > 0 and failed = 0. Our drain is now its own job,
 * rb-auth-mail-drain (a job named process-email-queue is Lovable's and is only
 * reported), it posts the vault bearer and the cron key through the gateway's
 * JWT check, and fails its own run when a post of its own was refused.
 * Section 94 here:
 *   - FAILs when our job is missing, when a run failed, and when the LAST run
 *     did not succeed; a Lovable job of the other name is INFO, never judged;
 *   - proves the gateway still asks for a JWT: a post with none must be
 *     refused 401 BY THE GATEWAY; a 403 naming the drain means verify_jwt is
 *     off and the role claim the function reads is unverified, a FAIL that
 *     says what to deploy;
 *   - the publishable key is refused by the function's own check, 403 naming
 *     the drain with cronKey false.
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

type Cfg = { cron: unknown; noJwt: { status: number; body: string }; anonKey?: { status: number; body: string } };
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
  if(hs.some((h)=>/^authorization:/i.test(h))){const k=cfg.anonKey||{status:403,body:JSON.stringify({error:"Forbidden",refusedBy:"process-email-queue",cronKey:false})};status=k.status;body=k.body;}
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

const job = (o: Record<string, unknown> = {}) => [{ ch_jobname: "rb-auth-mail-drain", ch_schedule: "10 seconds", ch_active: true, ch_runs: 360, ch_failed: 0, ch_last_status: "succeeded", ...o }];
const GATEWAY_401 = { status: 401, body: JSON.stringify({ code: 401, message: "Missing authorization header" }) };
const REFUSED_HERE = { status: 403, body: JSON.stringify({ error: "Forbidden", refusedBy: "process-email-queue", cronKey: false }) };

describe("our drain job", () => {
  it("PASSes a job whose last run succeeded with no failures (positive control)", () => {
    const { lines } = run({ cron: job(), noJwt: GATEWAY_401 });
    expect(has(lines, "PASS", /rb-auth-mail-drain cron: .*last run succeeded/), show(lines)).toBe(true);
  });

  it("FAILs a job whose last run failed, though every earlier run succeeded", () => {
    const { lines } = run({ cron: job({ ch_failed: 0, ch_last_status: "failed" }), noJwt: GATEWAY_401 });
    expect(has(lines, "FAIL", /rb-auth-mail-drain cron: .*last run failed/), show(lines)).toBe(true);
  });

  it("FAILs failed runs, and no job of ours at all, even when Lovable's own job runs", () => {
    expect(has(run({ cron: job({ ch_failed: 3 }), noJwt: GATEWAY_401 }).lines, "FAIL", /rb-auth-mail-drain cron/)).toBe(true);
    const lovableOnly = run({ cron: [{ ch_jobname: "process-email-queue", ch_schedule: "5 seconds", ch_active: true, ch_runs: 700, ch_failed: 0, ch_last_status: "succeeded" }], noJwt: GATEWAY_401 }).lines;
    expect(has(lovableOnly, "FAIL", /no rb-auth-mail-drain cron job/), show(lovableOnly)).toBe(true);
    expect(has(lovableOnly, "INFO", /Lovable's own process-email-queue job: .*left as it is/), show(lovableOnly)).toBe(true);
    expect(lovableOnly.some((l) => /^PASS .*process-email-queue cron/.test(l)), "Lovable's job was judged as ours").toBe(false);
  });
});

describe("the gateway's answer to a post with no JWT (ours and Lovable's both post the vault bearer)", () => {
  it("PASSes the gateway's 401, and sends that post with no Authorization header", () => {
    const { lines, calls } = run({ cron: job(), noJwt: GATEWAY_401 });
    expect(has(lines, "PASS", /the gateway refuses a post with no JWT \(401, verify_jwt on\)/), show(lines)).toBe(true);
    expect(calls).toMatch(/POST https:\/\/p\.supabase\.co\/functions\/v1\/process-email-queue auth=false/);
  });

  it("FAILs a 403 naming the drain: verify_jwt is off, so the role claim the function trusts is unverified", () => {
    const { lines } = run({ cron: job(), noJwt: REFUSED_HERE });
    expect(has(lines, "FAIL", /a post with no JWT reached the function \(403 from its own check\): verify_jwt is OFF/), show(lines)).toBe(true);
  });

  it("FAILs any other answer", () => {
    const { lines } = run({ cron: job(), noJwt: { status: 200, body: JSON.stringify({ processed: 0 }) } });
    expect(has(lines, "FAIL", /answered a post with no JWT with HTTP 200/), show(lines)).toBe(true);
  });
});

describe("the publishable key", () => {
  it("PASSes a 403 naming the drain with cronKey false", () => {
    const { lines } = run({ cron: job(), noJwt: GATEWAY_401 });
    expect(has(lines, "PASS", /refuses the publishable key without the cron key \(403 naming the drain, cronKey false/), show(lines)).toBe(true);
  });

  it("FAILs a refusal that does not say whether a cron key was offered (the old build's body): the cron could not tell its own refusals apart", () => {
    const { lines } = run({ cron: job(), noJwt: GATEWAY_401, anonKey: { status: 403, body: JSON.stringify({ error: "Forbidden", refusedBy: "process-email-queue" }) } });
    expect(has(lines, "FAIL", /answered the publishable key with HTTP 403/), show(lines)).toBe(true);
  });
});
