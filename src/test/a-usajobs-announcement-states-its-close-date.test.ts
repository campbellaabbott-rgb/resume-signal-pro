/**
 * A USAJOBS ANNOUNCEMENT STATES ITS CLOSE DATE (XR-1, the interface half).
 *
 * An agency states the day its announcement closes, and the board kept no
 * place for it: a USAJOBS row stayed open until the feed stopped listing it,
 * however long ago the stated date passed. The ingest half (skip a row already
 * past its date, store the date, close stored rows on it) lives in index.ts and
 * is built in the core lane, which needs a field on the posting to carry the
 * date from the normaliser to the row. This file starts with that field; the
 * normaliser's read of the date is added here when it is built.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import type { JobPosting } from "../../supabase/functions/job-board/normalize";

const NORMALIZE = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/job-board/normalize.ts"), "utf8"));

describe("a posting has a place for the close date its employer states", () => {
  it("JobPosting declares an optional ISO closesAt that may be null", () => {
    const shape = /export interface JobPosting \{[\s\S]*?\n\}/.exec(NORMALIZE)?.[0] ?? "";
    expect(shape, "the JobPosting interface was not found in normalize.ts").toContain("applyUrl: string;");
    expect(shape, "JobPosting has no closesAt field for a stated close date").toMatch(/^\s*closesAt\?: string \| null;$/m);
  });

  it("a posting typed as JobPosting can carry a stated close date, or none", () => {
    // Without the field, this object literal fails the typecheck (an excess property).
    const stated: JobPosting = {
      id: "usajobs:usajobs:812345600", source: "usajobs", token: "usajobs", company: "Department of the Interior",
      title: "Hydrologist", location: "Denver, Colorado", remote: false, workMode: null, department: null,
      postedAt: "2026-11-01T00:00:00.000Z", category: "Science & Research" as JobPosting["category"], salary: null,
      applyUrl: "https://www.usajobs.gov/job/812345600", closesAt: "2026-11-21T00:00:00.000Z",
    };
    const unstated: JobPosting = { ...stated, closesAt: null };
    const { closesAt: _omit, ...absent } = stated;
    expect(stated.closesAt).toBe("2026-11-21T00:00:00.000Z");
    expect(unstated.closesAt).toBeNull();
    expect((absent as JobPosting).closesAt).toBeUndefined();
  });
});
