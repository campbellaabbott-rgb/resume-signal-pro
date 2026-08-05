/**
 * ONE ROLE AND ONE PLACE WAS NEVER ENOUGH.
 *
 * A mandate stored a single title fragment and a single location, so "product
 * manager OR programme manager" and "London OR Manchester" could not be said at
 * all — people had to pick one and lose the rest of their search. That is not a
 * missing nicety; it is the mandate failing to describe the job hunt it exists
 * to represent.
 *
 * Done WITHOUT a migration, deliberately. Commas separate terms in the columns
 * that already exist, and a value with no comma splits to a single-element list
 * producing exactly the query it produced before — so every mandate already
 * saved keeps behaving identically without being touched, and there is no
 * window where the UI writes a column the runner has not learned to read.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const runner = readFileSync(
  resolve(__dirname, "../../supabase/functions/agent-runner/index.ts"), "utf8");
const panel = readFileSync(
  resolve(__dirname, "../components/account/MorningQueuePanel.tsx"), "utf8");

describe("the runner searches every term, not just the first", () => {
  it("splits both fields and ORs them", () => {
    expect(runner).toMatch(/qb\.or\(orIlike\("location", locTerms\)\)/);
    expect(runner).toMatch(/qb\.or\(orIlike\("title", qTerms\)\)/);
  });

  it("patches BOTH filter sites — the second one is easy to miss", () => {
    // There are two places the mandate becomes a query. Fixing one leaves the
    // other silently single-term, which would look like a partial rollout.
    expect((runner.match(/orIlike\("title"/g) ?? []).length).toBe(2);
    expect((runner.match(/orIlike\("location"/g) ?? []).length).toBe(2);
  });

  it("a single term still produces the old behaviour", () => {
    // The backward-compatibility claim. One element in, one ilike out.
    expect(runner).toMatch(/split\(","\)/);
  });
});

describe("a comma inside a value cannot widen somebody's search", () => {
  it("strips the characters PostgREST's or() treats as syntax", () => {
    // or() is a comma-delimited string. A comma surviving inside a term would
    // be read as a separator and match titles the person never asked for — a
    // filter that quietly matches MORE than requested is worse than one that
    // errors, because nothing looks wrong.
    expect(runner).toMatch(/replace\(\/\[,\(\)\*\]\/g, " "\)/);
  });

  it("bounds the number of terms", () => {
    expect(runner).toMatch(/slice\(0, 12\)/);
  });

  it("drops empty terms, so a trailing comma is harmless", () => {
    expect(runner).toMatch(/filter\(\(t\) => t\.length > 0\)/);
  });
});

describe("the split is visible before it is saved", () => {
  it("shows parsed terms back as chips on both fields", () => {
    expect(panel).toMatch(/<TermChips raw=\{form\.q\}/);
    expect(panel).toMatch(/<TermChips raw=\{form\.location\}/);
  });

  it("the preview uses the SAME rules as the runner", () => {
    // A preview that parses differently from the thing doing the search is a
    // lie with extra steps.
    for (const rule of [/replace\(\/\[,\(\)\*\]\/g, " "\)/, /slice\(0, 12\)/, /t\.length > 0/]) {
      expect(panel, `preview drifted from the runner: ${rule}`).toMatch(rule);
    }
  });

  it("stays quiet for a single term, so nothing changes for existing users", () => {
    expect(panel).toMatch(/if \(terms\.length < 2\) return null;/);
  });

  it("the placeholder teaches the separator", () => {
    // A separator you cannot see is one people get wrong.
    expect(panel).toMatch(/Product Manager, Programme Manager/);
    expect(panel).toMatch(/London, Manchester, Remote/);
  });
});
