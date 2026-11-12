// @vitest-environment node
/**
 * THE STOP RULE FIRES ON TWO DAILY CHECKS IN A ROW (owner decision 2026-11-07,
 * option A; SEO/GEO audit 2026-11-07, B01).
 *
 * The owner kept JobPosting markup on the condition of a daily check of the
 * closed-but-baked share and a STOP rule; neither existed. The rule, made
 * exact: "twice" is two consecutive daily checks over 5%, counting only
 * postings with a definite employer answer, and a run with more than 20% of
 * its answers unknown is not judged. scripts/posting-closure-check.mjs keeps
 * one record per UTC date and exits 3 when the rule fires;
 * .github/workflows/posting-closure.yml runs it daily and raises an issue.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDocument } from "yaml";
import { closureRecord, runClosureCheck, stopRuleVerdict, withRecord } from "../../scripts/posting-closure-check.mjs";

/** A judged record with `closed` of `definite` closed and `unknown` more unknown. */
const rec = (date: string, closed: number, definite: number, unknown = 0) => {
  const answers = new Map<string, { vendor: string; state: string }>();
  for (let i = 0; i < definite; i++) answers.set(`/jobs/posting/workday/t~wd1~S/R${date}${i}`, { vendor: "workday", state: i < closed ? "closed" : "open" });
  for (let i = 0; i < unknown; i++) answers.set(`/jobs/posting/adp/x/${date}${i}`, { vendor: "adp", state: "unknown" });
  return closureRecord(date, answers);
};

describe("the owner's STOP rule on the daily records", () => {
  it("fires on 5.2% and then 6%: two consecutive daily checks over 5%", () => {
    const history = [rec("2026-11-08", 26, 500), rec("2026-11-09", 30, 500)];
    expect(history[0].closedShare).toBeCloseTo(0.052, 4);
    const v = stopRuleVerdict(history, "2026-11-09");
    expect(v.code).toBe(3);
    expect(v.fired).toBe(true);
    expect(v.message).toMatch(/JOB_POSTING_MARKUP to false/);
  });

  it("does not fire on 6% and then 3%", () => {
    const v = stopRuleVerdict([rec("2026-11-08", 30, 500), rec("2026-11-09", 15, 500)], "2026-11-09");
    expect(v.code).toBe(0);
    expect(v.fired).toBe(false);
  });

  it("does not fire on one day over the line with no earlier check", () => {
    expect(stopRuleVerdict([rec("2026-11-09", 40, 500)], "2026-11-09").code).toBe(0);
  });

  it("does not judge a run where a quarter of the answers are unknown, whatever its closed share", () => {
    const today = rec("2026-11-09", 40, 375, 125);
    expect(today.unknownShare).toBeCloseTo(0.25, 4);
    const v = stopRuleVerdict([rec("2026-11-08", 40, 500), today], "2026-11-09");
    expect(v.code).toBe(4);
    expect(v.fired).toBe(false);
  });

  it("reads the previous JUDGED check, so an unjudged day neither fires nor clears the rule", () => {
    const history = [rec("2026-11-07", 30, 500), rec("2026-11-08", 30, 300, 200), rec("2026-11-09", 30, 500)];
    const v = stopRuleVerdict(history, "2026-11-09");
    expect(v.previous?.date).toBe("2026-11-07");
    expect(v.code).toBe(3);
  });

  it("counts only postings with a definite answer in the share", () => {
    const r = rec("2026-11-09", 6, 100, 10);
    expect(r.closedShare).toBeCloseTo(0.06, 4);
    expect(r.checked).toBe(110);
    expect(r.wilson95[0]).toBeGreaterThan(0);
    expect(r.wilson95[1]).toBeLessThan(0.2);
  });

  it("keeps one record per UTC date, and a judged one over a later unjudged run of the same date", () => {
    const judgedRun = rec("2026-11-09", 10, 500);
    const unjudged = rec("2026-11-09", 10, 300, 200);
    const h1 = withRecord([rec("2026-11-08", 5, 500)], judgedRun);
    expect(h1.map((r) => r.date)).toEqual(["2026-11-08", "2026-11-09"]);
    const h2 = withRecord(h1, unjudged);
    expect(h2.filter((r) => r.date === "2026-11-09")).toEqual([judgedRun]);
  });
});

describe("the daily check reads the live sitemap and ledger and asks each employer", () => {
  it("measures the live posting pages the sitemap names and fires on the second day over the line", async () => {
    const SITE = "https://site.test";
    const live = Array.from({ length: 20 }, (_, i) => `/jobs/posting/greenhouse/acme/${1000 + i}`);
    const sitemap = `<urlset>${[...live, "/jobs/posting/greenhouse/acme/9999", "/jobs"].map((p) => `<url><loc>${SITE}${p}</loc></url>`).join("")}</urlset>`;
    const ledger = { postings: Object.fromEntries([...live.map((p) => [p, { state: "live", applyUrl: `https://job-boards.greenhouse.io/acme/jobs/${p.split("/").pop()}` }]), ["/jobs/posting/greenhouse/acme/9999", { state: "gone" }]]) };
    const asked: string[] = [];
    const fetchImpl = async (url: string) => {
      asked.push(url);
      const text = async () => (url.endsWith("/sitemap.xml") ? sitemap : url.endsWith("/prerender-ledger.json") ? JSON.stringify(ledger) : "{}");
      if (url.startsWith(SITE)) return { status: 200, url, text };
      // Two of the twenty are closed at the employer: 10%.
      const id = url.split("/").pop();
      return { status: id === "1003" || id === "1007" ? 404 : 200, url, text };
    };
    const day1 = await runClosureCheck({ site: SITE, date: "2026-11-08", history: [], fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(day1.record).toMatchObject({ checked: 20, open: 18, closed: 2, unknown: 0, closedShare: 0.1 });
    expect(day1.record!.closedPaths).toEqual(["/jobs/posting/greenhouse/acme/1003", "/jobs/posting/greenhouse/acme/1007"]);
    expect(day1.code).toBe(0);
    expect(asked.some((u) => u.endsWith("/9999"))).toBe(false);
    const day2 = await runClosureCheck({ site: SITE, date: "2026-11-09", history: day1.history, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(day2.code).toBe(3);
  });

  it("exits 2 when the live sitemap or ledger cannot be read", async () => {
    const fetchImpl = async (url: string) => ({ status: 503, url, text: async () => "" });
    expect((await runClosureCheck({ site: "https://site.test", fetchImpl: fetchImpl as unknown as typeof fetch })).code).toBe(2);
  });
});

describe("the daily workflow is one GitHub can run, and it runs the check with its records", () => {
  const doc = parseDocument(readFileSync(resolve(__dirname, "../../.github/workflows/posting-closure.yml"), "utf8"));
  const wf = doc.toJS() as { on: { schedule: Array<{ cron: string }>; workflow_dispatch?: unknown }; jobs: { check: { steps: Array<{ name?: string; run?: string; uses?: string; with?: Record<string, string> }> } } };

  it("parses, runs on a daily schedule and by hand", () => {
    expect(doc.errors.map((e) => e.message)).toEqual([]);
    const cron = wf.on.schedule[0].cron.split(" ");
    expect(cron[2]).toBe("*");
    expect(cron[1].split(",").length).toBeGreaterThanOrEqual(1);
    expect("workflow_dispatch" in wf.on).toBe(true);
  });

  it("measures with the kept daily records, keeps them, and raises the alarm on a fired rule", () => {
    const steps = wf.jobs.check.steps;
    const run = steps.map((s) => s.run ?? "").join("\n");
    expect(run).toMatch(/node scripts\/posting-closure-check\.mjs --history \.posting-closure\/history\.json/);
    expect(steps.some((s) => s.uses?.startsWith("actions/cache/restore@") && s.with?.path === ".posting-closure")).toBe(true);
    expect(steps.some((s) => s.uses?.startsWith("actions/cache/save@") && s.with?.path === ".posting-closure")).toBe(true);
    expect(run).toMatch(/3\) echo "failed=fired"/);
    expect(run).toMatch(/gh issue create/);
  });
});
