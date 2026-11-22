// @vitest-environment node
/**
 * A CHECK FILE OLDER THAN A DAY AND A HALF WITHHOLDS NO JOB MARKUP (review of
 * 2026-11-21, on the owner's unread-Workday rule of 2026-11-19).
 *
 * The owner said yes to withholding JobPosting on a Workday page that neither
 * the bake nor a daily check in the last 36 hours read as open, on the
 * premise that the check reads nearly every Workday page, "so this withholds
 * only a handful", and said to keep today's default until then. The bake
 * switched the rule on whenever scripts/seo-seed/employer-stated.txt held any
 * line, and a line is kept for 14 days while its "open" counts for 36 hours.
 * A person merges the check's pull request and a publish comes days later:
 * a file read open on 2026-11-20 at 00:44 and baked on 2026-11-21 at 18:00
 * (41 hours on) cleared no page, so every Workday page whose own bake read
 * failed lost its job markup (the bake read 39 of 297 on 2026-11-18: about
 * half of all posting pages), with nothing said but a count in a long line.
 *
 * Now the rule stands only while the file's newest line is within the 36
 * hours; otherwise every page keeps the markup it had before the rule and
 * the bake says so at the WARN tier.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as bakeModule from "../../scripts/prerender-seo.mjs";
import * as statements from "../../scripts/employer-statements.mjs";
import * as postingPage from "@/components/jobs/posting-page";
import * as companyDisplay from "@/lib/company-display";

type Reads = Map<string, { at: number; state: string; stated: unknown }>;
const B = bakeModule as unknown as {
  askEmployersAbout: (list: unknown[], o: unknown) => Promise<{ keep: Array<{ job: Record<string, unknown>; unread?: boolean; read?: string }> }>;
  unreadRuleOffNotice?: (reads: Reads, nowMs: number) => string | null;
};
const S = statements as unknown as {
  employerStatedList: (t: string, now: number) => Reads;
  checkReadsFreshness?: (reads: Reads, nowMs: number) => { newest: number | null; fresh: boolean };
};
const D = { ...companyDisplay, ...postingPage };
const BAKE = Date.parse("2026-11-21T18:00:00Z");
const TODAY = "2026-11-21";

const WD = {
  id: "workday:pnc~wd5~External:R217438-1", source: "workday", token: "pnc~wd5~External",
  title: "Branch Banker", company: "PNC", location: "Pittsburgh, PA", country: "US",
  postedAt: "2026-11-12T00:00:00.000Z",
  applyUrl: "https://pnc.wd5.myworkdayjobs.com/en-US/External/job/Pittsburgh-PA/Branch-Banker_R217438-1",
};
const WD_PATH = "/jobs/posting/workday/pnc~wd5~External/R217438-1";
const WD2 = { ...WD, id: "workday:gdit~wd5~External_Career_Site:RQ230851-1", token: "gdit~wd5~External_Career_Site", title: "Systems Engineer", company: "GDIT", applyUrl: "https://gdit.wd5.myworkdayjobs.com/en-US/External_Career_Site/job/Remote/Systems-Engineer_RQ230851-1" };
const WD2_PATH = "/jobs/posting/workday/gdit~wd5~External_Career_Site/RQ230851-1";
const DESCRIPTION = "Serve customers at the branch: open accounts, answer questions about products and services, and help clients with their everyday banking needs while keeping every transaction accurate and compliant.";
// Every line read open, 41 hours before the bake.
const STALE = `${WD_PATH} 2026-11-20T00:44Z open -\n${WD2_PATH} 2026-11-20T00:44Z open -\n`;

const refused = async (url: string) => ({ status: 429, url, text: async () => "", headers: { get: () => null } });

async function ask(rows: Array<Record<string, unknown>>, checkText: string, nowMs = BAKE) {
  const checkReads = S.employerStatedList(checkText, nowMs);
  const out = await B.askEmployersAbout(rows.map((r) => ({ job: { ...r }, description: DESCRIPTION, carried: true, first: "2026-11-12" })), {
    D, deadline: Date.now() + 10_000, today: TODAY, nowMs, readOpts: { fetchImpl: refused, retryDelayMs: 1 }, carriedOf: () => null, checkReads,
  });
  return out.keep;
}

describe("a check file whose every line is older than 36 hours", () => {
  it("still reaches the bake: its lines are within the two weeks it keeps them", () => {
    expect(S.employerStatedList(STALE, BAKE).size).toBe(2);
  });

  it("marks no Workday page unread, though the bake's own reads were refused", async () => {
    const keep = await ask([WD, WD2], STALE);
    expect(keep).toHaveLength(2);
    expect(keep.map((d) => d.read)).toEqual(["unknown", "unknown"]);
    expect(keep.map((d) => !!d.unread)).toEqual([false, false]);
  });

  it("is named stale, with the time of its newest line", () => {
    expect(typeof S.checkReadsFreshness).toBe("function");
    expect(S.checkReadsFreshness!(S.employerStatedList(STALE, BAKE), BAKE)).toEqual({ newest: Date.parse("2026-11-20T00:44:00Z"), fresh: false });
  });

  it("makes the bake say at the WARN tier that the rule is off and why", () => {
    expect(typeof B.unreadRuleOffNotice).toBe("function");
    const notice = B.unreadRuleOffNotice!(S.employerStatedList(STALE, BAKE), BAKE);
    expect(notice).toMatch(/^the unread-Workday rule is OFF for this bake: /);
    expect(notice).toContain("2026-11-20T00:44Z, 41 h before the bake");
    expect(notice).toContain("every Workday page keeps the job markup it had before the rule");
    const src = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    expect(src).toMatch(/const off = unreadRuleOffNotice\(CHECK_READS, CHECK_READS_AT\);\n\s+if \(off\) console\.warn\(`\[prerender-seo\] WARN \$\{off\}`\);/);
    expect(src).toMatch(/checkReads: CHECK_READS,\n\s+nowMs: CHECK_READS_AT,/);
  });
});

describe("a check file whose newest line is within 36 hours", () => {
  // One page read open 8 hours ago; the other's own line is the stale one.
  const FRESH = `${WD_PATH} 2026-11-21T10:00Z open -\n${WD2_PATH} 2026-11-20T00:44Z open -\n`;

  it("keeps the rule: a page it read open keeps its markup, a page nobody read open lately loses it", async () => {
    const keep = await ask([WD, WD2], FRESH);
    expect(keep.map((d) => !!d.unread)).toEqual([false, true]);
  });

  it("says nothing at the WARN tier, and neither does an empty file", () => {
    expect(B.unreadRuleOffNotice!(S.employerStatedList(FRESH, BAKE), BAKE)).toBeNull();
    expect(B.unreadRuleOffNotice!(S.employerStatedList("# header only\n", BAKE), BAKE)).toBeNull();
  });

  it("counts a newest line exactly 36 hours old as fresh, and one a minute older as stale", () => {
    const at = (iso: string) => S.checkReadsFreshness!(S.employerStatedList(`${WD_PATH} ${iso} open -\n`, BAKE), BAKE).fresh;
    expect(at("2026-11-20T06:00Z")).toBe(true);
    expect(at("2026-11-20T05:59Z")).toBe(false);
  });
});
