/**
 * THE BROWSER'S COPIES OF A RÉSUMÉ ARE LISTED, AND THE BUTTON THAT SAYS IT
 * CLEARS THEM DOES.
 *
 * WHAT WAS WRONG. /trust said the only copy in the browser was the résumé text
 * in a tab's session storage, "until you close the tab". But the builder keeps
 * the whole résumé it is building in local storage (resumeBuilderDraft), as
 * does Freelance Boost (its intake), and scan history, cached reports and the
 * AI summary sit there too -- all of it surviving the tab and the browser. The
 * paid results page's "Clear Data" button told the buyer "All locally stored
 * resume data has been removed from this device" and removed only the
 * temporary-session id.
 *
 * NOW: src/lib/local-resume-copies.ts names every such key, /trust lists them
 * as their own row, and the button clears them. This file holds each listed
 * key equal to the key its writer actually uses (so a renamed key cannot slip
 * out of the clear), and runs the clear.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { LOCAL_RESUME_COPY_KEYS, LOCAL_RESUME_COPY_PREFIXES, clearLocalResumeCopies } from "@/lib/local-resume-copies";

const ROOT = resolve(__dirname, "../..");
const code = (rel: string) => codeOf(readFileSync(resolve(ROOT, rel), "utf8"));

describe("every listed key is the key its writer uses", () => {
  it("the builder's draft", () => {
    const src = code("src/pages/ResumeBuilder.tsx");
    expect(src).toContain(`const DRAFT_STORAGE_KEY = "${LOCAL_RESUME_COPY_KEYS.builderDraft}"`);
    expect(src).toMatch(/localStorage\.setItem\(DRAFT_STORAGE_KEY,/);
  });

  it("Freelance Boost's intake", () => {
    const src = code("src/pages/FreelanceBoost.tsx");
    expect(src).toContain(`const DRAFT_KEY = "${LOCAL_RESUME_COPY_KEYS.freelanceDraft}"`);
    expect(src).toMatch(/localStorage\.setItem\(DRAFT_KEY,/);
  });

  it("scan history and the personalisation profile", () => {
    expect(code("src/hooks/use-scan-history.ts")).toContain(`const STORAGE_KEY = '${LOCAL_RESUME_COPY_KEYS.scanHistory}'`);
    expect(code("src/hooks/use-personalization.ts")).toContain(`const STORAGE_KEY = '${LOCAL_RESUME_COPY_KEYS.personalization}'`);
  });

  it("the cached reports and AI summaries, by prefix", () => {
    const scan = /const CLIENT_CACHE_KEY_PREFIX = '([^']+)'/.exec(code("src/hooks/use-streaming-scan.ts"));
    expect(scan, "the report cache's key prefix moved -- point this guard at it").toBeTruthy();
    expect(scan![1].startsWith(LOCAL_RESUME_COPY_PREFIXES.scanReport)).toBe(true);
    expect(code("src/components/AISummary.tsx")).toContain("`" + LOCAL_RESUME_COPY_PREFIXES.aiSummary + "${resumeHash}");
  });
});

describe("clearLocalResumeCopies", () => {
  beforeEach(() => localStorage.clear());

  it("removes every copy and nothing else", () => {
    localStorage.setItem("resumeBuilderDraft", JSON.stringify({ name: "Jordan Probe", email: "jordan@example.com" }));
    localStorage.setItem("freelanceBoostIntake", JSON.stringify({ employmentTimeline: "2019-2026 Example Corp" }));
    localStorage.setItem("rb_scan_history", JSON.stringify({ entries: [{ candidateName: "Jordan Probe" }] }));
    localStorage.setItem("rb_personalization_profile", "{}");
    localStorage.setItem("resume_scan_cache_v2_0123abcd", "{}");
    localStorage.setItem("ai_summary_9f8e_tech", JSON.stringify({ summary: "Jordan, your bullets..." }));
    // Not résumé copies: the language, the visitor id, a dismissed job.
    localStorage.setItem("i18nextLng", "en");
    localStorage.setItem("rb_visitor_id", "v_12345678");
    localStorage.setItem("rb_dismissed_jobs", "[]");

    expect(clearLocalResumeCopies()).toBe(6);
    const left = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).sort();
    expect(left).toEqual(["i18nextLng", "rb_dismissed_jobs", "rb_visitor_id"]);
    expect(JSON.stringify({ ...localStorage })).not.toContain("Jordan");
  });

  it("is safe on an empty store", () => {
    expect(clearLocalResumeCopies()).toBe(0);
  });
});

describe("the button /trust names is the one that runs it", () => {
  it("the paid results page's clear-browser-data handler clears every local copy", () => {
    const src = code("src/pages/Success.tsx");
    const start = src.indexOf("const handleClearLocalData = () => {");
    expect(start, "the clear handler moved -- point this guard at it").toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf("};", start));
    expect(body).toContain("clearLocalResumeCopies()");
    expect(body).toContain("sessionStorage.clear()");
  });

  it("the unload clean-up does NOT clear them, so a builder draft survives leaving the page", () => {
    const src = code("src/hooks/use-resume-storage.ts");
    expect(src).not.toContain("clearLocalResumeCopies");
  });
});
