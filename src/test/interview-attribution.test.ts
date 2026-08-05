import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  attributionSummary,
  interviewSignals,
  type TrackedApplication,
} from "@/lib/interviewAttribution";

/**
 * The closure log is the one claim no other job site can make, and it is also
 * the easiest thing here to over-claim with. A takedown is consistent with the
 * candidate being hired, somebody else being hired, and the req being
 * cancelled. Most of this file is about the sentences that must NOT follow.
 */

const NOW = Date.parse("2026-08-05T12:00:00Z");
const d = (iso: string) => iso;

const row = (over: Partial<TrackedApplication> = {}): TrackedApplication => ({
  id: "a1", company: "Acme", role: "Product Manager",
  applied_at: d("2026-06-01T00:00:00Z"),
  interview_at: d("2026-07-01T00:00:00Z"),
  lifecycle_outcome: "still_standing",
  posting_closed_at: null,
  ...over,
});

describe("what the closure log can say about an interview", () => {
  it("reports a posting that came down after the interview", () => {
    const [s] = interviewSignals([row({
      lifecycle_outcome: "came_down",
      posting_closed_at: d("2026-07-12T00:00:00Z"),
    })], NOW);
    expect(s.kind).toBe("closed-after");
    expect(s.days).toBe(11);
    expect(s.closedAt).toBe("2026-07-12T00:00:00Z");
  });

  it("distinguishes a relist, which means the opposite thing", () => {
    // Came down AND went back up: they are still looking. Reporting that as a
    // plain closure would be the most encouraging possible reading of the least
    // encouraging fact.
    const [s] = interviewSignals([row({
      lifecycle_outcome: "came_down_relisted",
      posting_closed_at: d("2026-07-12T00:00:00Z"),
    })], NOW);
    expect(s.kind).toBe("relisted-after");
  });

  it("reports a posting still standing, with how long", () => {
    const [s] = interviewSignals([row()], NOW);
    expect(s.kind).toBe("still-open");
    expect(s.days).toBe(35);
  });
});

describe("what it refuses to say", () => {
  it("never treats an unobserved posting as still open", () => {
    // Employers on windowed or capped feeds log ZERO closures BY DESIGN —
    // truncatedFetch refuses to log them. Folding `not_observed` into "still
    // standing" would turn a property of the feed into a reassurance about the
    // employer, for precisely the employers we can say least about.
    const [s] = interviewSignals([row({ lifecycle_outcome: "not_observed" })], NOW);
    expect(s.kind).toBe("not-observed");
  });

  it("never invents a closure date for an undated closure", () => {
    // The bug get_application_lifecycle was written to end was stamping
    // new Date() — the moment the page was opened — as the closure date.
    const [s] = interviewSignals([row({ lifecycle_outcome: "came_down", posting_closed_at: null })], NOW);
    expect(s.kind).toBe("not-observed");
    expect(s.closedAt).toBeNull();
  });

  it("does not read a closure stamped before the interview as a finding", () => {
    // Far more likely a rescheduled interview or a mistyped date than an
    // employer who pulled the ad before meeting somebody.
    const [s] = interviewSignals([row({
      interview_at: d("2026-07-20T00:00:00Z"),
      lifecycle_outcome: "came_down",
      posting_closed_at: d("2026-07-01T00:00:00Z"),
    })], NOW);
    expect(s.kind).toBe("closed-before");
  });

  it("says nothing about an interview that has not happened yet", () => {
    expect(interviewSignals([row({ interview_at: d("2026-09-01T00:00:00Z") })], NOW)).toEqual([]);
  });

  it("says nothing about a row with no interview date", () => {
    expect(interviewSignals([row({ interview_at: null })], NOW)).toEqual([]);
  });

  it("does not turn an unparseable date into 'today'", () => {
    // Date.parse of junk is NaN, and NaN arithmetic yields 0 days, which would
    // render as an interview that happened this morning.
    expect(interviewSignals([row({ interview_at: "not a date" })], NOW)).toEqual([]);
    const [s] = interviewSignals([row({
      lifecycle_outcome: "came_down", posting_closed_at: "sometime",
    })], NOW);
    expect(s.kind).toBe("not-observed");
  });
});

describe("ordering and the summary", () => {
  it("puts the most recent interview first", () => {
    const out = interviewSignals([
      row({ id: "old", interview_at: d("2026-06-01T00:00:00Z") }),
      row({ id: "new", interview_at: d("2026-07-20T00:00:00Z") }),
    ], NOW);
    expect(out.map((s) => s.application.id)).toEqual(["new", "old"]);
  });

  it("counts only the interviews the log can actually speak to", () => {
    // A denominator padded with rows carrying no evidence deflates the rate
    // while looking rigorous. This platform has already published one figure
    // that counted a requested window as an observed one.
    const out = interviewSignals([
      row({ id: "1", lifecycle_outcome: "came_down", posting_closed_at: d("2026-07-10T00:00:00Z") }),
      row({ id: "2", lifecycle_outcome: "still_standing" }),
      row({ id: "3", lifecycle_outcome: "not_observed" }),
      row({ id: "4", lifecycle_outcome: "came_down_relisted", posting_closed_at: d("2026-07-10T00:00:00Z") }),
    ], NOW);
    const s = attributionSummary(out);
    expect(s.interviews).toBe(4);
    expect(s.observed).toBe(3);
    expect(s.closedAfter).toBe(1);
    expect(s.stillOpen).toBe(1);
    expect(s.relisted).toBe(1);
    expect(s.unobserved).toBe(1);
  });
});

describe("the copy on screen", () => {
  const hub = readFileSync(
    resolve(__dirname, "../components/account/InterviewsHub.tsx"), "utf8");
  // COMMENTS STRIPPED, deliberately. The file's own docstring quotes the
  // forbidden phrases in order to forbid them, and a check that cannot tell a
  // prohibition from a violation would force the reasoning out of the file.
  const copy = hub.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  it("never claims an outcome from a takedown", () => {
    for (const forbidden of [/you got/i, /you were hired/i, /rejected/i, /unsuccessful/i, /they chose/i]) {
      expect(copy, `copy must not imply an outcome: ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it("states where the observation comes from and what it does not mean", () => {
    expect(hub).toMatch(/doesn't tell us who was hired/);
  });

  it("drops the rows that only say 'we do not know' rather than rendering them", () => {
    expect(hub).toMatch(/kind !== "not-observed"/);
  });

  it("uses one grace day, the same as the upcoming list", () => {
    // A row must not be able to sit in "upcoming" and "since your interview"
    // at the same moment, which is what two different cutoffs would allow.
    expect(hub).toMatch(/now = Date\.now\(\) - 86_400_000/);
    const lib = readFileSync(resolve(__dirname, "../lib/interviewAttribution.ts"), "utf8");
    expect(lib).toMatch(/iv > now - DAY/);
  });
});
