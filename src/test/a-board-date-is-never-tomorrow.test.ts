// @vitest-environment node
/**
 * BB-10 (board .102): a Workday or Oracle feed in a zone ahead of ours states
 * tomorrow's date for a posting made today, and isoDateOnly stored it as
 * tomorrow, so the board's newest sort led with postings dated in the future.
 * A date up to 24 hours ahead is now clamped to the moment it is read; one
 * further ahead, or more than 400 days old, is still refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";

const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const i = RAW.indexOf("\nfunction isoDateOnly(");
const isoDateOnly = new Function(`${transformSync(RAW.slice(i + 1, RAW.indexOf("\n}\n", i) + 2), { loader: "ts" }).code}\nreturn isoDateOnly;`)() as (v: unknown) => string | null;

describe("a board date is never tomorrow", () => {
  const NOW = Date.parse("2026-11-15T18:30:00Z");
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it("tomorrow's date from a feed ahead of us is stored as now, not tomorrow", () => {
    expect(isoDateOnly("2026-11-16")).toBe(new Date(NOW).toISOString());
    expect(isoDateOnly("2026-11-16T08:00:00+12:00")).toBe(new Date(NOW).toISOString());
  });

  it("today and every earlier date inside the window are stored as stated", () => {
    expect(isoDateOnly("2026-11-15")).toBe("2026-11-15T00:00:00.000Z");
    expect(isoDateOnly("2026-10-01T09:00:00Z")).toBe("2026-10-01T09:00:00.000Z");
  });

  it("a date more than a day ahead, or more than 400 days old, or not a date, is still refused", () => {
    expect(isoDateOnly("2026-11-17")).toBeNull();
    expect(isoDateOnly("2025-09-01")).toBeNull();
    expect(isoDateOnly("soon")).toBeNull();
    expect(isoDateOnly("")).toBeNull();
    expect(isoDateOnly(20261116)).toBeNull();
  });
});
