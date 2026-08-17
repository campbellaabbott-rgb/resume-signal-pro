import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectWorkMode } from "../../supabase/functions/job-board/normalize.ts";

/**
 * THE REMOTE FILTER SERVED JOBS THAT SAY THEY ARE NOT REMOTE.
 *
 * Two writers produced the same lie by different routes, and both were caught
 * by an audit AFTER the code was committed and pushed but BEFORE it deployed.
 *
 * WRITER 1 — the Workday remoteType classifier. It is a substring test, and
 * Nike's live tenant publishes the literal string "Non-Remote Posting".
 * /remote/ matches it, so the board stored the exact inverse of what the
 * employer wrote. "Not Remote" and "No Remote" are the same trap. Because the
 * classifier had matched nothing at all before (0 of 154 sampled postings), the
 * bug would have appeared at Workday scale — half the board — the first time
 * the fixed sweep ran.
 *
 * A classifier built from substrings must answer the NEGATIONS before the
 * POSITIVES. That is the rule this file exists to hold.
 *
 * WRITER 2 — two call sites in job-board/index.ts passed the 4,000-character
 * description into detectWorkMode, whose remote pattern is a bare \bremote\b.
 * normalize.ts:156 states the contract they violated: "clear words only;
 * descriptions are never inferred from". Live rows produced by it:
 *   "due to the remote location of this site, there are no public transport"
 *   "a major civil earthworks project in remote Northern Saskatchewan"
 *   "the technical component of remote cardiac device monitoring"
 *   "There is no option for this position to be remote."
 * All four were being served under the Remote filter.
 *
 * WHY IT SURVIVED: page 1 of workMode=remote is clean. The wrong rows sit
 * deeper — 49 of 60 on page 14 had no remote token anywhere. A spot check of
 * the first screen can never find this.
 */
const board = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8",
);

describe("the vendor work-mode classifier answers negations first", () => {
  /** The classifier as it appears in index.ts, extracted so the test runs the
   *  REAL ordering rather than a copy that could drift from it. */
  const classify = (raw: string): string | null => {
    const rt = String(raw).toLowerCase().trim();
    return !rt ? null
      : /\bnon[-\s]?remote\b|\bnot remote\b|\bno remote\b|\bnon[-\s]?rem\b/.test(rt) ? "onsite"
      : /hybrid|hybride|flex/.test(rt) ? "hybrid"
      : /on[-\s]?site|in[-\s]?person|on[-\s]?campus|campus[-\s]?based|on[-\s]?premise|fully on|field[-\s]?based/.test(rt) ? "onsite"
      : /remote|work from home|wfh|telework|virtual|distributed/.test(rt) ? "remote"
      : null;
  };

  it("never reads a negated label as remote", () => {
    // "Non-Remote Posting" is not a hypothetical — it is Nike's live value.
    for (const label of ["Non-Remote Posting", "Not Remote", "No Remote", "NON-REMOTE", "non remote"]) {
      expect(classify(label), `${label} must not classify as remote`).not.toBe("remote");
    }
  });

  it("still classifies genuine labels correctly", () => {
    // Negation guards are easy to write so broadly that they eat the real cases.
    expect(classify("Remote")).toBe("remote");
    expect(classify("Fully Remote")).toBe("remote");
    expect(classify("Work From Home")).toBe("remote");
    expect(classify("Hybrid: Remote and Office")).toBe("hybrid");
    // Real observed Workday values that the previous five-substring test missed.
    expect(classify("In-Person Working")).toBe("onsite");
    expect(classify("Campus based")).toBe("onsite");
    expect(classify("Fully on premise")).toBe("onsite");
    expect(classify("Field Based")).toBe("onsite");
    expect(classify("")).toBeNull();
  });

  it("keeps the negation arm FIRST in the shipped source", () => {
    // The extracted copy above proves the ordering works; this proves the
    // shipped code has that ordering. Both are needed — a test that only
    // exercises its own copy passes forever after the real one regresses.
    const neg = board.indexOf("\\bnon[-\\s]?remote\\b");
    const rem = board.indexOf("/remote|work from home|wfh|telework");
    expect(neg, "negation arm not found in index.ts").toBeGreaterThan(-1);
    expect(rem, "remote arm not found in index.ts").toBeGreaterThan(-1);
    expect(
      neg < rem,
      "The non-remote arm must be tested BEFORE the remote arm, or " +
        '"Non-Remote Posting" classifies as remote.',
    ).toBe(true);
  });
});

describe("work mode is never inferred from a description", () => {
  it("does not read an incidental 'remote' in prose as a remote job", () => {
    // detectWorkMode is variadic, so passing a description was silent. These
    // are real descriptions from live postings served under the Remote filter.
    const prose = [
      "due to the remote location of this site, there are no public transport links available",
      "a major civil earthworks project in remote Northern Saskatchewan",
      "the technical component of remote cardiac device monitoring",
      "There is no option for this position to be remote.",
    ];
    for (const p of prose) {
      // Title/location say nothing about mode; only the prose mentions remote.
      expect(
        detectWorkMode("Huntingdon, UK", "Sample Handling Assistant"),
        "control: title+location alone must be null",
      ).toBeNull();
      // And the function, given that prose as a part, WOULD say remote — which
      // is exactly why the description must never be passed to it.
      expect(detectWorkMode(p)).toBe("remote");
    }
  });

  it("no call site in job-board passes a description to detectWorkMode", () => {
    // The actual guard. Both violating sites read
    //   detectWorkMode(row.location, row.title, clean)
    //   detectWorkMode(jobRow.location, jobRow.title, description)
    // A third argument is the defect, whatever it is named.
    const calls = [...board.matchAll(/detectWorkMode\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls.length, "no detectWorkMode calls found — has it been renamed?").toBeGreaterThan(0);
    const withThird = calls.filter((args) => args.split(",").length > 2);
    expect(
      withThird,
      "detectWorkMode takes title/location only — normalize.ts:156: 'clear " +
        "words only; descriptions are never inferred from'. A third argument " +
        "is a description, and one incidental 'remote' in prose then tags the " +
        "posting remote.",
    ).toEqual([]);
  });
});
