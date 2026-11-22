// @vitest-environment node
/**
 * A CLOUDFLARE CHALLENGE IS NAMED, AND NEVER RETRIED (SEO audit 2026-11-18,
 * STRUCTURED-M2).
 *
 * From 2026-11-17 Workday's edge answered the bake's Node fetch with a
 * Cloudflare challenge: HTTP 429, server cloudflare, a "Security Check" page
 * whose script sets window._cf_chl_opt and whose noscript says "Enable
 * JavaScript and cookies to continue". The reader treated it as a busy
 * server: it waited 1.5 s, asked again, met the same page and recorded
 * "HTTP 429". About 300 Workday rows each paid that, the shared budget ran
 * out, and nothing in the log said "challenge".
 *
 * The challenge page below is BUILT from the recorded shape (verify-
 * structured.md: "429 ... server cloudflare: 'Security Check Enable
 * JavaScript and cookies to continue (function(){window._cf_chl_opt = ...'");
 * no request was sent to provoke one. A challenge is answered once and named
 * "challenge"; after CHALLENGES_BEFORE_STOP (3) from one vendor in a run, its
 * remaining rows are "vendor challenged" and are not requested at all. A plain
 * 429 is still asked once more, and Workday's 403 S22 JSON still reads closed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import * as reads from "../../scripts/employer-reads.mjs";
import { closureVendorLines } from "../../scripts/posting-closure-check.mjs";

const FIX = resolve(__dirname, "fixtures/employer-reads");
const rec = (name: string) => readFileSync(resolve(FIX, name), "utf8");
const CHALLENGE = rec("workday-challenge-429.html");

type Reply = { status: number; body: string; headers?: Record<string, string> };
/** A fetch that answers every URL with `reply(url)`, and counts the requests. */
function counting(reply: (url: string) => Reply) {
  const asked: string[] = [];
  const fetchImpl = async (url: string) => {
    asked.push(url);
    await new Promise((r) => setTimeout(r, 2));
    const a = reply(url);
    const h = a.headers ?? {};
    return { status: a.status, url, text: async () => a.body, headers: { get: (k: string) => h[k.toLowerCase()] ?? null } };
  };
  return { fetchImpl, asked };
}

const workdayRow = (n: number) => ({
  id: `workday:example${n}~wd1~Careers:R-00000${n}`,
  applyUrl: `https://example${n}.wd1.myworkdayjobs.com/en-US/Careers/job/US-Remote/Analyst_R-00000${n}`,
});

describe("a Cloudflare challenge is a refusal, named once", () => {
  it("one challenged answer is requested once and named 'challenge', not 'HTTP 429'", async () => {
    const f = counting(() => ({ status: 429, body: CHALLENGE }));
    const out = await reads.readEmployers([workdayRow(1)], { fetchImpl: f.fetchImpl, budgetMs: 5_000, retryDelayMs: 1, concurrency: 1 });
    expect(f.asked).toHaveLength(1);
    const r = out.get(workdayRow(1).id);
    expect(r.state).toBe("unknown");
    expect(r.why).toBe("challenge");
  });

  it("five challenged Workday rows: one request each for the first three, none for the other two", async () => {
    const rows = [1, 2, 3, 4, 5].map(workdayRow);
    const f = counting(() => ({ status: 429, body: CHALLENGE }));
    const out = await reads.readEmployers(rows, { fetchImpl: f.fetchImpl, budgetMs: 5_000, retryDelayMs: 1, concurrency: 1 });
    expect(f.asked).toHaveLength(3);
    expect(f.asked.every((u) => !u.includes("example4") && !u.includes("example5"))).toBe(true);
    expect(rows.map((r) => out.get(r.id).why)).toEqual(["challenge", "challenge", "challenge", "vendor challenged", "vendor challenged"]);
    const s = reads.summarizeEmployerReads(out);
    expect(s.unknown).toBe(5);
    expect(s.why).toEqual({ challenge: 3, "vendor challenged": 2 });
    expect(s.byVendor.workday.why).toEqual({ challenge: 3, "vendor challenged": 2 });
    // The closure check's output names them per vendor.
    const lines = closureVendorLines({ byVendor: s.byVendor });
    expect(lines.join("\n")).toMatch(/workday.*challenge 3, vendor challenged 2/);
  });

  it("at the default concurrency the rows already in flight are the only ones asked", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => workdayRow(i + 1));
    const f = counting(() => ({ status: 429, body: CHALLENGE }));
    const out = await reads.readEmployers(rows, { fetchImpl: f.fetchImpl, budgetMs: 5_000, retryDelayMs: 1 });
    expect(f.asked.length).toBeLessThanOrEqual(reads.CHALLENGES_BEFORE_STOP + reads.EMPLOYER_READ_CONCURRENCY - 1);
    expect([...out.values()].filter((r) => r.why === "vendor challenged").length).toBe(12 - f.asked.length);
  });

  it("Cloudflare's cf-mitigated header names a challenge with any body", async () => {
    const f = counting(() => ({ status: 403, body: "", headers: { "cf-mitigated": "challenge" } }));
    const out = await reads.readEmployers([workdayRow(1)], { fetchImpl: f.fetchImpl, budgetMs: 5_000, retryDelayMs: 1 });
    expect(out.get(workdayRow(1).id).why).toBe("challenge");
    expect(f.asked).toHaveLength(1);
  });

  it("another vendor keeps being read while Workday is challenged", async () => {
    const rows = [1, 2, 3, 4].map(workdayRow).concat([{ id: "lever:americaatwork:a02cac51-7ee4-4e6e-8d5c-6acfa515ae25", applyUrl: "https://jobs.lever.co/americaatwork/a02cac51-7ee4-4e6e-8d5c-6acfa515ae25" }]);
    const f = counting((u) => (u.includes("lever.co") ? { status: 200, body: rec("lever-americaatwork-200.json") } : { status: 429, body: CHALLENGE }));
    const out = await reads.readEmployers(rows, { fetchImpl: f.fetchImpl, budgetMs: 5_000, retryDelayMs: 1, concurrency: 1 });
    expect(out.get(rows[4].id).state).toBe("open");
    expect(out.get(rows[3].id).why).toBe("vendor challenged");
  });
});

describe("never worse: what was not a challenge reads as it did", () => {
  it("a plain 429 with no challenge marker is still asked once more", async () => {
    const f = counting(() => ({ status: 429, body: "" }));
    const out = await reads.readEmployers([workdayRow(1)], { fetchImpl: f.fetchImpl, budgetMs: 5_000, retryDelayMs: 1 });
    expect(f.asked).toHaveLength(2);
    expect(out.get(workdayRow(1).id).why).toBe("HTTP 429");
  });

  it("Workday's 403 S22 JSON still reads closed", async () => {
    const row = { id: "workday:sanford~wd5~SanfordHealth:R-0278723", applyUrl: "https://sanford.wd5.myworkdayjobs.com/en-US/SanfordHealth/job/SD-Watertown/Medication-Assistant--Certified--Assisted-Living_R-0278723" };
    const f = counting(() => ({ status: 403, body: rec("workday-sanford-403-s22.json") }));
    const out = await reads.readEmployers([row], { fetchImpl: f.fetchImpl, budgetMs: 5_000, retryDelayMs: 1 });
    expect(out.get(row.id).state).toBe("closed");
  });

  it("none of the 30 recorded employer answers is read as a challenge", () => {
    const files = readdirSync(FIX).filter((n) => n !== "workday-challenge-429.html");
    expect(files.length).toBeGreaterThanOrEqual(30);
    const statusOf = (n: string) => Number(/-(\d{3})(?:-|\.)/.exec(n)?.[1] ?? 200);
    for (const n of files) {
      for (const status of [statusOf(n), 403, 429, 503]) expect(reads.isChallenge(status, rec(n)), `${n} at ${status}`).toBe(false);
    }
    expect(reads.isChallenge(429, CHALLENGE)).toBe(true);
    expect(reads.isChallenge(200, CHALLENGE)).toBe(false);
  });
});
