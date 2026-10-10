/**
 * A RESCANNED SCORE REPEATS ONLY WITHIN THE REPORT CACHE.
 *
 * The free scan's score is drawn by a model; what makes a rescan return the
 * same score is the report cache, kept REPORT_CACHE_DAYS (7) days. The
 * homepage's "Why not ChatGPT" card promised a score "reproducible on
 * rescan" with no window, as the prerendered homepage's "Same document, same
 * score, every time" and llms.txt's "reproducible (same document -> same
 * report ID)" did before 94778203. Every reproducibility claim the homepage
 * renders now names the cache window.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { WhyNotChatGPT } from "@/components/WhyNotChatGPT";
import { REPORT_CACHE_DAYS } from "@/lib/resume-retention";

describe("the homepage's reproducibility claims", () => {
  it("every sentence that says a rescan repeats the score names the cache window", () => {
    const text = render(<WhyNotChatGPT />).container.textContent ?? "";
    const sentences = text.split(/(?<=[.!?])\s*/).filter((s) => /reproduc|same (report|score)|rescan of the same/i.test(s));
    expect(sentences.length).toBeGreaterThan(0);
    for (const s of sentences) expect(s).toContain(`within ${REPORT_CACHE_DAYS} days`);
  });
});
