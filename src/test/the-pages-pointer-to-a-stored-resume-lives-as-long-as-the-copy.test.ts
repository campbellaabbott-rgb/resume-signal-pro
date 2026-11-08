/**
 * THE PAGE'S POINTER TO A STORED RÉSUMÉ LIVES AS LONG AS THE COPY (hotfix
 * 2026-11-10: H4, C-S14-010).
 *
 * The browser kept the id of the stored résumé, posting and LinkedIn text for
 * one hour while the server kept the text for 24 (temp_resume_storage). A
 * buyer who paid and came back later the same day had lost the pointer to a
 * copy the server still held, and the analysis ran without the posting it
 * was bought against. The pointer now lives as long as the copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPIRY_MS, getResumeData, setResumeData, clearAllResumeData } from "@/hooks/use-resume-storage";
import { TEMP_RESUME_HOURS } from "@/lib/resume-retention";

const HOUR = 60 * 60 * 1000;
let now = 0;

beforeEach(() => {
  clearAllResumeData();
  now = Date.UTC(2026, 10, 10, 9, 0, 0);
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => { vi.restoreAllMocks(); clearAllResumeData(); });

describe("the stored-résumé pointer", () => {
  it("is kept exactly as long as the server keeps the copy", () => {
    expect(EXPIRY_MS).toBe(TEMP_RESUME_HOURS * HOUR);
    expect(TEMP_RESUME_HOURS).toBe(24);
  });

  it("still names the copy five hours after checkout, and is gone after a day", () => {
    setResumeData("tempSessionId:cs_live_later_today", "7c9e6679-7425-40de-944b-e07fc1f90ae7");
    now += 5 * HOUR;
    expect(getResumeData("tempSessionId:cs_live_later_today"), "the pointer lapsed while the copy was still kept").toBe("7c9e6679-7425-40de-944b-e07fc1f90ae7");
    now += 20 * HOUR;
    expect(getResumeData("tempSessionId:cs_live_later_today")).toBeNull();
  });
});
