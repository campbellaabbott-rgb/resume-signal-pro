/**
 * THE INTERVIEWS CARD CALLED TOMORROW "TODAY" AFTER MIDDAY (platform sweep
 * L3-17).
 *
 * interview_at is a date the member picks, stored as UTC midnight. The card
 * rounded the hours between now and that instant, so late in the day an
 * interview tomorrow was a few hours away and read "Today", and one two days
 * out read "Tomorrow". Account's "Do next" list already compared calendar
 * days; the card now does too.
 *
 * The clock is set to 23:00 local, when the old arithmetic is wrong in every
 * zone from UTC-12 to UTC+11. At that hour west of UTC, today's interview had
 * also left the card (its cutoff was 24 hours before the instant now).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { InterviewsHub } from "@/components/account/InterviewsHub";

const row = (id: string, interview_at: string) => ({
  id, company: `Company ${id}`, role: "Analyst", interview_at,
  applied_at: "2026-10-01T00:00:00Z", lifecycle_outcome: null, posting_closed_at: null,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 10, 23, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("the interviews card", () => {
  it("names tomorrow's interview Tomorrow late in the evening", () => {
    render(<InterviewsHub applications={[row("a", "2026-10-11T00:00:00+00:00")]} />);
    const item = screen.getByText("Company a").closest("li")!;
    expect(item.textContent).toContain("Tomorrow");
    expect(item.textContent).not.toContain("Today");
  });

  it("names an interview two days out In 2 days, not Tomorrow", () => {
    render(<InterviewsHub applications={[row("b", "2026-10-12T00:00:00+00:00")]} />);
    const item = screen.getByText("Company b").closest("li")!;
    expect(item.textContent).toContain("In 2 days");
    expect(item.textContent).not.toContain("Tomorrow");
  });

  it("keeps today's interview listed as Today until local midnight, not as past", () => {
    render(<InterviewsHub applications={[
      { ...row("c", "2026-10-10T00:00:00+00:00"), lifecycle_outcome: "still_standing" },
    ]} />);
    expect(screen.getByText("Company c").closest("li")!.textContent).toContain("Today");
    expect(screen.queryByText("Since your interview")).toBeNull();
  });
});
