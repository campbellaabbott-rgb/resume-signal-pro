/**
 * THE PARTIAL BANNER CALLED A THIN REPLY AN OUTAGE, AND THE CRASH NOTICE
 * REPLAYED THE CRASH.
 *
 * - Since S8-067 a report is partial when the model's reply is thin as well
 *   as when no reply came, but the banner said "our AI reviewer was briefly
 *   unavailable" for both: false for a reply the model did write.
 * - The report's crash notice told the reader to scan again because "a
 *   rescan of the same file is served from the saved report". A crash caused
 *   by the report's own data replays from that 7-day cache, so following the
 *   advice showed the same crash. It now offers Re-analyze, which skips it.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PartialResultsNotice } from "@/components/PartialResultsNotice";
import { ReportBoundary } from "@/components/ReportBoundary";

describe("the partial-results banner", () => {
  it("says the AI was unavailable only when it was", () => {
    const { container, rerender } = render(<PartialResultsNotice reason="rule_based" />);
    expect(container.textContent).toMatch(/briefly unavailable/);
    rerender(<PartialResultsNotice reason="thin" />);
    expect(container.textContent).not.toMatch(/unavailable/);
    expect(container.textContent).toMatch(/left some sections empty/);
  });
});

describe("the report's crash notice", () => {
  const Boom = (): JSX.Element => { throw new Error("card shape drift"); };

  it("offers Re-analyze, which runs the scan past the saved report, and never promises the saved copy", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onReanalyze = vi.fn();
    render(<ReportBoundary resultKey={1} onReanalyze={onReanalyze}><Boom /></ReportBoundary>);
    expect(document.body.textContent).not.toMatch(/saved report/i);
    fireEvent.click(screen.getByRole("button", { name: /re-analy[sz]e/i }));
    expect(onReanalyze).toHaveBeenCalledTimes(1);
  });
});
