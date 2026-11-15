// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz (BUG ROUND, PRIVACY-RETENTION) CAN FAIL EVERY CLAIM.
 *
 * `scripts/verify-deploy.d/99zzzzzzz-bugs-privacy-retention.sh` is the
 * post-deploy proof of the round's privacy-retention lane: the nightly purge
 * runs (PR1), the four log writers are shut to anon (PR2), and the served
 * /privacy says what the lane shipped (PR3, six sub-claims, two of them
 * owner-gated). A PASS is worth something only if a regression could have made
 * it a FAIL (verify-deploy.d/README.md), so the section runs here against a
 * fake curl answering from routes.
 *
 * It also pins the two things this section exists to get right:
 *   - the sign-in processor check is SCOPED to that sentence. "Resend" already
 *     appears twice on the live page, so a page-wide grep would pass while the
 *     processor line stayed wrong.
 *   - an owner-gated line judges NOTHING until the reservation records the
 *     answer, and is judged from then on.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

vi.setConfig({ testTimeout: 300_000 });

const ROOT = resolve(__dirname, "../..");
const SECTION = "scripts/verify-deploy.d/99zzzzzzz-bugs-privacy-retention.sh";
const PR3 = "scripts/verify-deploy.d/99zzzzzzz-bugs-privacy-retention.pr3.mjs";

type Route = { match: string; body?: string; status?: number };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let url="",o=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-o")o=a[++i];else if(x==="-d"||x==="--data")data=a[++i];
  else if(x==="-H"||x==="-A"||x==="-X")i++;else if(["-m","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const key=url+(data!==null?"\\t"+data:"");
const r=routes.find((x)=>new RegExp(x.match).test(key))||{body:""};
const body=r.body??"";
if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else process.stdout.write(body);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

/** A /privacy page. Every sub-claim's phrase is a parameter, so each can be broken alone. */
function privacyPage(o: Partial<{
  updated: string; aiModels: boolean; signinResend: boolean; resendElsewhere: boolean;
  ipinfoReport: boolean; browserSignOut: boolean; affiliate: boolean; shortlist: "A" | "B" | "none";
}> = {}): string {
  const p = { updated: "2026-11-12", aiModels: false, signinResend: true, resendElsewhere: true,
    ipinfoReport: true, browserSignOut: true, affiliate: true, shortlist: "A" as const, ...o };
  const parts = [`<p>Last updated: ${p.updated}</p>`, "<p>".padEnd(2100, "x") + "</p>"];
  if (p.aiModels) parts.push("<p>We use Google for AI models and fonts.</p>");
  else parts.push("<p>Section 11: Google (AI models, reached through Lovable's AI gateway).</p>");
  parts.push(p.signinResend
    ? "<p>A sign-in email Lovable cannot send goes through Resend from the United States.</p>"
    : "<p>A sign-in email is sent by our mail processor from the United States.</p>");
  if (p.resendElsewhere) parts.push("<p>Our processors include Stripe, Lovable and Resend.</p>");
  parts.push(p.ipinfoReport
    ? "<p>We use ipinfo to place the emailed report's market figures.</p>"
    : "<p>We use ipinfo to place market figures.</p>");
  parts.push(p.browserSignOut
    ? "<p>In Your Browser: the builder résumé and scan history stay here, and signing out on this device clears them.</p>"
    : "<p>In Your Browser: the builder résumé and scan history stay here.</p>");
  if (p.affiliate) parts.push("<p>Affiliate program: a referral link's code is stored as the affiliate_ref cookie for 30 days.</p>");
  if (p.shortlist === "A") parts.push("<p>Shortlist: an employer can delete a role or a candidate, and we purge records after four years.</p>");
  else if (p.shortlist === "B") parts.push("<p>Shortlist: records are kept until the employer deletes the account.</p>");
  return `<html><body>${parts.join("")}</body></html>`;
}

const closed = (fn: string) => ({ match: `rpc/${fn}\\?`, body: '{"code":"42501","message":"permission denied"}' });
const open_ = (fn: string) => ({ match: `rpc/${fn}\\?`, body: '{"code":"25006","message":"cannot execute INSERT in a read-only transaction"}' });
const census = (n: number) => ({ match: "rpc/client_callable_census", body: `[{"unlisted_client_callable":${n}}]` });
const cronJob = (o: Partial<{ active: boolean; timeout: string | null; runs: number; failed: number; timeouts: number }> = {}) => {
  const j = { active: true, timeout: "10min", runs: 1, failed: 0, timeouts: 0, ...o };
  return { match: "rpc/get_cron_health", body: JSON.stringify([{ ch_jobname: "privacy-retention-nightly",
    ch_active: j.active, ch_timeout: j.timeout, ch_runs: j.runs, ch_failed: j.failed, ch_timeouts: j.timeouts, ch_last_status: "succeeded" }]) };
};
const cronMissing = { match: "rpc/get_cron_health", body: JSON.stringify(Array.from({ length: 60 }, (_, i) => ({ ch_jobname: `other-${i}`, ch_active: true, ch_timeout: null, ch_runs: 1, ch_failed: 0, ch_timeouts: 0 }))) };

function run(routes: Route[], ledger: unknown): string[] {
  const dir = mkdtempSync(join(tmpdir(), "vdbpr-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  mkdirSync(join(dir, "scripts", "verify-deploy.d"), { recursive: true });
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, SECTION), readFileSync(resolve(ROOT, SECTION), "utf8"));
  writeFileSync(join(dir, PR3), readFileSync(resolve(ROOT, PR3), "utf8"));
  writeFileSync(join(dir, "docs/deploy-ledger.json"), JSON.stringify(ledger));
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  const out = execFileSync("bash", [SECTION], {
    cwd: dir, encoding: "utf8",
    env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      VD_ROUTES: join(dir, "routes.json"), K: "k", B: "https://x.supabase.co",
      SITE: "https://site.test", UA: "TestBot" },
  });
  return out.split("\n").filter((l) => /^(PR[123]|==)/.test(l));
}

const NO_RESERVATION = { reservations: [{ name: "seo-connect" }] };
const DECIDED = { reservations: [{ name: "bug-round", ownerDecided: { "S14X-021": { choice: "approved-full" }, "S14X-073": { choice: "A" } } }] };
const line = (ls: string[], id: string) => ls.find((l) => l.includes(id)) ?? "";

describe("PR2, the log writers", () => {
  it("FAILs a writer anon can call, naming 25006 as the reason a POST would write", () => {
    const ls = run([open_("log_scan_metric"), closed("log_heartbeat_result"), census(2), cronMissing,
      { match: "/privacy", body: privacyPage() }], NO_RESERVATION);
    expect(line(ls, "log_scan_metric")).toMatch(/^PR2 FAIL/);
    expect(line(ls, "log_scan_metric")).toMatch(/25006/);
    expect(line(ls, "log_heartbeat_result")).toMatch(/^PR2 PASS/);
  });

  it("FAILs a probe that no longer matches an overload, rather than reading it as closed", () => {
    const ls = run([{ match: "rpc/log_scan_metric\\?", body: '{"code":"PGRST202"}' },
      closed("log_heartbeat_result"), census(0), cronJob(), { match: "/privacy", body: privacyPage() }], NO_RESERVATION);
    expect(line(ls, "log_scan_metric")).toMatch(/^PR2 FAIL/);
    expect(line(ls, "log_scan_metric")).toMatch(/proves nothing/);
  });

  it("PASSes the census only at zero, and FAILs a leftover once the probes are closed", () => {
    const ok = run([closed("log_scan_metric"), closed("log_heartbeat_result"), census(0), cronJob(),
      { match: "/privacy", body: privacyPage() }], NO_RESERVATION);
    expect(line(ok, "unlisted_client_callable = 0")).toMatch(/^PR2 PASS/);
    const left = run([closed("log_scan_metric"), closed("log_heartbeat_result"), census(3), cronJob(),
      { match: "/privacy", body: privacyPage() }], NO_RESERVATION);
    expect(line(left, "still counts 3")).toMatch(/^PR2 FAIL/);
  });
});

describe("PR1, the nightly purge, judged against PR2 as its stamp signal", () => {
  const privacy = { match: "/privacy", body: privacyPage() };
  it("is INFO when the job is absent and the writers are still open", () => {
    const ls = run([open_("log_scan_metric"), open_("log_heartbeat_result"), census(2), cronMissing, privacy], NO_RESERVATION);
    expect(line(ls, "privacy-retention-nightly is not scheduled")).toMatch(/^PR1 INFO/);
  });

  it("FAILs when the writers are closed — the migration applied — and the job is still absent", () => {
    const ls = run([closed("log_scan_metric"), closed("log_heartbeat_result"), census(0), cronMissing, privacy], NO_RESERVATION);
    expect(line(ls, "privacy-retention-nightly is not scheduled")).toMatch(/^PR1 FAIL/);
    expect(line(ls, "privacy-retention-nightly is not scheduled")).toMatch(/WITHOUT its cron/);
  });

  it.each([
    ["inactive", { active: false }, /ch_active is false/],
    ["timeout-less", { timeout: null }, /no statement_timeout/],
    ["a failed run", { failed: 1 }, /failed 1 of/],
    ["a timed-out run", { timeouts: 1 }, /timed out on 1 of/],
  ])("FAILs a %s job", (_what, over, re) => {
    const ls = run([closed("log_scan_metric"), closed("log_heartbeat_result"), census(0), cronJob(over), privacy], NO_RESERVATION);
    expect(line(ls, "privacy-retention-nightly")).toMatch(/^PR1 FAIL/);
    expect(line(ls, "privacy-retention-nightly")).toMatch(re);
  });

  it("PASSes a scheduled, active, timeout-carrying job with clean runs", () => {
    const ls = run([closed("log_scan_metric"), closed("log_heartbeat_result"), census(0), cronJob(), privacy], NO_RESERVATION);
    expect(line(ls, "privacy-retention-nightly active")).toMatch(/^PR1 PASS/);
  });
});

describe("PR3, the served Privacy page", () => {
  const base: Route[] = [closed("log_scan_metric"), closed("log_heartbeat_result"), census(0), cronJob()];
  const withPage = (o: Parameters<typeof privacyPage>[0]) => [...base, { match: "/privacy", body: privacyPage(o) }];

  it("judges nothing while the page predates the round, and says which claims already hold", () => {
    const ls = run(withPage({ updated: "2026-11-06" }), DECIDED);
    for (const id of ["S14X-181a", "S14X-181b", "S14X-181c", "S14X-097"]) {
      expect(line(ls, id), id).toMatch(/^PR3 INFO/);
    }
    expect(line(ls, "S14X-181a")).toMatch(/already true|not yet true/);
  });

  it("FAILs a page served with no Last-updated date at all", () => {
    const ls = run([...base, { match: "/privacy", body: "<html><body>" + "x".repeat(2200) + "</body></html>" }], DECIDED);
    expect(line(ls, "no Last-updated date")).toMatch(/^PR3 FAIL/);
  });

  it("FAILs a truncated page rather than reading claims off it", () => {
    const ls = run([...base, { match: "/privacy", body: "<html></html>" }], DECIDED);
    expect(line(ls, "cannot be judged")).toMatch(/^PR3 FAIL/);
  });

  it.each([
    ["S14X-181a", { aiModels: true }],
    ["S14X-181c", { ipinfoReport: false }],
    ["S14X-097", { browserSignOut: false }],
  ] as const)("FAILs %s when its phrase is missing after the publish", (id, over) => {
    const ls = run(withPage(over), DECIDED);
    expect(line(ls, id)).toMatch(/^PR3 FAIL/);
  });

  it("scopes the Resend check to the sign-in sentence: the word elsewhere does not rescue it", () => {
    // THE TRAP. Resend appears in the processors paragraph, as it does live
    // today. A page-wide grep would PASS this page.
    const ls = run(withPage({ signinResend: false, resendElsewhere: true }), DECIDED);
    expect(line(ls, "S14X-181b")).toMatch(/^PR3 FAIL/);
    const page = privacyPage({ signinResend: false, resendElsewhere: true });
    expect(page).toMatch(/Resend/);
  });

  it("PASSes every sub-claim on a page that says all of it", () => {
    const ls = run(withPage({}), DECIDED);
    for (const id of ["S14X-181a", "S14X-181b", "S14X-181c", "S14X-097", "S14X-021", "S14X-073"]) {
      expect(line(ls, id), id).toMatch(/^PR3 PASS/);
    }
  });
});

describe("the owner gate", () => {
  const base: Route[] = [closed("log_scan_metric"), closed("log_heartbeat_result"), census(0), cronJob()];

  it("judges nothing while the reservation records no answer, even on a page that would fail", () => {
    const ls = run([...base, { match: "/privacy", body: privacyPage({ affiliate: false, shortlist: "none" }) }], NO_RESERVATION);
    expect(line(ls, "S14X-021")).toMatch(/^PR3 INFO/);
    expect(line(ls, "S14X-021")).toMatch(/owner pending/);
    expect(line(ls, "S14X-073")).toMatch(/owner pending/);
  });

  it("judges from the moment the answer is recorded", () => {
    const ls = run([...base, { match: "/privacy", body: privacyPage({ affiliate: false, shortlist: "none" }) }], DECIDED);
    expect(line(ls, "S14X-021")).toMatch(/^PR3 FAIL/);
    expect(line(ls, "S14X-073")).toMatch(/^PR3 FAIL/);
  });

  it("judges rule B against rule B's sentence, not rule A's", () => {
    const B = { reservations: [{ name: "bug-round", ownerDecided: { "S14X-073": "B" } }] };
    const asB = run([...base, { match: "/privacy", body: privacyPage({ shortlist: "B" }) }], B);
    expect(line(asB, "S14X-073")).toMatch(/^PR3 PASS/);
    // Rule A's sentence does not satisfy a recorded B.
    const aUnderB = run([...base, { match: "/privacy", body: privacyPage({ shortlist: "A" }) }], B);
    expect(line(aUnderB, "S14X-073")).toMatch(/^PR3 FAIL/);
  });

  it("ignores another reservation's ownerDecided", () => {
    const other = { reservations: [{ name: "seo-connect", ownerDecided: { "S14X-073": "A" } }] };
    const ls = run([...base, { match: "/privacy", body: privacyPage({ shortlist: "none" }) }], other);
    expect(line(ls, "S14X-073")).toMatch(/owner pending/);
  });
});
