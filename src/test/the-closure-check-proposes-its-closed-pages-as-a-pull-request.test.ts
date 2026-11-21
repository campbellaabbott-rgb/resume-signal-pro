// @vitest-environment node
/**
 * THE CLOSURE CHECK PROPOSES ITS CLOSED PAGES AS A PULL REQUEST (SEO audit
 * 2026-11-18, STRUCTURED-B1 part 2 and B2; owner yes, 2026-11-19).
 *
 * Posting-closure run 44431382185 found 7 live posting pages closed at their
 * employer and put them in a standing issue; the bake never heard, so all 7
 * kept index, follow and JobPosting until a person pasted the lines in. The
 * workflow now commits them to one standing branch, posting-closure/next-
 * publish, rebuilt on main each run with the earlier unmerged lines carried,
 * together with what each employer stated (scripts/seo-seed/employer-
 * stated.txt), and opens or updates one pull request. It writes nothing to
 * the site and never pushes main: a person merges.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as check from "../../scripts/posting-closure-check.mjs";
import * as statements from "../../scripts/employer-statements.mjs";

const C = check as unknown as {
  withClosedLines?: (seed: string, lines: string[], o?: { runLabel?: string }) => string;
  closedListPaths?: (t: string) => string[];
  employerStatedFileText?: (reads: Map<string, { state: string; stated: unknown }>, at: string) => string;
  runClosureCheck: (o: unknown) => Promise<{ code: number; reads?: Map<string, { state: string; stated: unknown }> }>;
};
const S = statements as unknown as { employerStatedList: (t: string, now: number) => Map<string, { state: string; stated: unknown }> };
const WORKFLOW = readFileSync(resolve(__dirname, "../../.github/workflows/posting-closure.yml"), "utf8");
const SEED = readFileSync(resolve(__dirname, "../../scripts/seo-seed/closed-at-employer.txt"), "utf8");
const A = "/jobs/posting/workday/pnc~wd5~External/R217438-1";
const B = "/jobs/posting/workday/gdit~wd5~External_Career_Site/RQ230851-1";
const N = "/jobs/posting/greenhouse/acme/999";

describe("the closed lines", () => {
  it("appends only the paths the file does not list, once each, under a dated comment", () => {
    expect(typeof C.withClosedLines).toBe("function");
    const seed = `# header\n${A} 2026-11-19 employer\n`;
    const next = C.withClosedLines!(seed, [`${A} 2026-11-21 employer`, `${N} 2026-11-21 employer`, `${N} 2026-11-21 employer`, "not a line", `${B} 2026-11-20 employer # a note`], { runLabel: "run 1" });
    expect(next.startsWith(seed)).toBe(true);
    expect(C.closedListPaths!(next)).toEqual([A, N, B]);
    expect(next).toMatch(/# Proposed by the daily closure check \(run 1\): 2 page\(s\) closed at the employer\./);
    expect(C.withClosedLines!(next, [`${N} 2026-11-21 employer`])).toBe(next);
  });

  it("keeps every line the committed list already holds", () => {
    const next = C.withClosedLines!(SEED, [`${N} 2026-11-21 employer`]);
    expect(C.closedListPaths!(next)).toEqual([...C.closedListPaths!(SEED), N]);
  });
});

describe("what each employer stated", () => {
  it("is written for the open and stating pages, never a closed one, and the bake reads it back", () => {
    expect(typeof C.employerStatedFileText).toBe("function");
    const reads = new Map([
      [A, { state: "open", stated: { employerValidThrough: "2026-11-30", employmentType: "Full time" } }],
      [B, { state: "closed", stated: {} }],
      [N, { state: "unknown", stated: {} }],
      ["/jobs/posting/workday/x~wd1~S/R-2", { state: "unknown", stated: { employmentType: "Part time" } }],
    ]);
    const text = C.employerStatedFileText!(reads, "2026-11-21T10:12:44.000Z");
    const back = S.employerStatedList(text, Date.parse("2026-11-21T12:00:00Z"));
    expect([...back.keys()].sort()).toEqual([A, "/jobs/posting/workday/x~wd1~S/R-2"].sort());
    expect(back.get(A)).toMatchObject({ state: "open", stated: { employerValidThrough: "2026-11-30", employmentType: "Full time" } });
  });

  it("comes out of a measuring run beside its record", async () => {
    const sitemap = `<urlset><url><loc>https://resumebooster.work${A}</loc></url></urlset>`;
    const ledger = JSON.stringify({ postings: { [A]: { state: "live", applyUrl: "https://pnc.wd5.myworkdayjobs.com/en-US/External/job/Pittsburgh-PA/Branch-Banker_R217438-1" } } });
    const fetchImpl = async (url: string) => {
      const body = url.endsWith("/sitemap.xml") ? sitemap : url.endsWith("/prerender-ledger.json") ? ledger : JSON.stringify({ jobPostingInfo: { endDate: "2026-11-30", timeType: "Full time" } });
      return { status: 200, url, text: async () => body, headers: { get: () => null } };
    };
    const out = await C.runClosureCheck({ date: "2026-11-21", fetchImpl, budgetMs: 10_000 });
    expect(out.reads?.get(A)).toMatchObject({ state: "open", stated: { employerValidThrough: "2026-11-30", employmentType: "Full time" } });
  });
});

describe("the workflow", () => {
  it("may write the repository and open pull requests, and nothing else new", () => {
    expect(WORKFLOW).toMatch(/permissions:\n\s+contents: write\n\s+issues: write\n\s+pull-requests: write\n/);
  });

  it("writes the statements, rebuilds one standing branch on main, carries the unmerged lines, and opens or updates one pull request", () => {
    expect(WORKFLOW).toMatch(/--stated-out \.posting-closure\/employer-stated\.txt/);
    expect(WORKFLOW).toMatch(/BRANCH=posting-closure\/next-publish/);
    expect(WORKFLOW).toMatch(/git checkout -B "\$BRANCH" origin\/main/);
    expect(WORKFLOW).toMatch(/git show "origin\/\$BRANCH:scripts\/seo-seed\/closed-at-employer\.txt" > "\$EARLIER"/);
    expect(WORKFLOW).toMatch(/node scripts\/posting-closure-check\.mjs --propose --closed-today "\$CLOSED" --stated-today "\$STATED" --earlier-closed "\$EARLIER"/);
    expect(WORKFLOW).toMatch(/git push -q --force origin "HEAD:refs\/heads\/\$BRANCH"/);
    expect(WORKFLOW).toMatch(/gh pr create --repo "\$GITHUB_REPOSITORY" --base main --head "\$BRANCH"/);
  });

  it("never pushes main and changes no git configuration", () => {
    const pushes = [...WORKFLOW.matchAll(/git push[^\n]*/g)].map((m) => m[0]);
    expect(pushes.length).toBe(1);
    for (const p of pushes) expect(p).not.toMatch(/\bmain\b/);
    expect(WORKFLOW).not.toMatch(/git config /);
  });
});
