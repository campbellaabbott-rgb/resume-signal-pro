/**
 * THE HIRING RECORD LEADS WITH ONE LINE (audit CP17, CP1, CP22, plan D10).
 *
 * The Hiring Health card was three italic paragraphs around one fact, and the
 * shared gate's refusals made it longer. Held here, by rendering:
 *   - one plain lead line: the gated verdict as a sentence, or "No reliable
 *     hiring signal yet";
 *   - each refusal folded behind its own "Why?" (a real button, collapsed),
 *     in the gate's own words, keeping the data-hh-gate attribute the page's
 *     guards read;
 *   - a lap board prints no fourteen-day share or median, a zero-relist board
 *     no ninety-day counts (the gate decides, this card asks it);
 *   - each count is one plural sentence with "taken down (not relisted)",
 *     never "filled";
 *   - the footnote is xs in the subtle token, never a 10px opacity grey.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HiringRecordCard, type HiringRecordInput, type RecordCurve } from "@/components/jobs/company/HiringRecordCard";
import { codeOf } from "./helpers/strip-comments";

const BARS = { growthMinRatePct: 25, growthWindowDays: 7, closedWindowDays: 90, shareDays: 14, supportDays: 30 };
const FULL: RecordCurve = {
  open_roles: 12, filled_roles_90d: 20, relisted_roles_90d: 7, tracking_days: 90, observability_bucket: "full_read",
  watched_from: "2026-08-01", multi_site_title_share: 0,
  sufficient: true, dated_coverage: 0.8, fill_rate_14: 0.62, fill_rate_14_lo: 0.55, fill_rate_14_hi: 0.69, dated_n: 40,
  median_days_to_fill: 11, median_censored: false,
};
const LAP_ZERO_RELIST: RecordCurve = {
  open_roles: 21_067, filled_roles_90d: 20_767, relisted_roles_90d: 0, tracking_days: 11, observability_bucket: "lap_proven",
  sufficient: true, dated_coverage: 0.9, fill_rate_14: 0.0053, fill_rate_14_lo: 0.004, fill_rate_14_hi: 0.007, dated_n: 15_000,
  median_days_to_fill: 25, median_censored: false,
};
const rec = (o: Partial<HiringRecordInput> = {}): HiringRecordInput => ({
  curve: FULL, gated: { verdict: "closes", withheld: null }, actively: "positive", admitted: "closes", relistCaution: false,
  growth: { verdict: "unknown", row: null, why: "our own daily series has a gap inside the window" }, bars: BARS, ...o,
});

describe("one plain lead line", () => {
  it("a readable record leads with the gated verdict as a sentence, then the figures the gate allows", () => {
    const { container } = render(<HiringRecordCard input={rec()} />);
    expect(container.querySelector("[data-record-lead]")?.textContent).toBe("We watched 20 of its roles come off the board and stay off in the last 90 days.");
    expect(container.querySelector("[data-record='counts']")?.textContent).toBe("20 roles taken down (not relisted) in 90 days of tracking");
    expect(container.querySelector("[data-record='pace']")?.textContent).toContain("Up to 62% of its roles come down for good within 14 days (55–69% either way)");
    expect(container.querySelector("[data-record='pace']")?.textContent).toContain("Half of these roles were taken down by day 11.");
    expect(container.textContent).not.toMatch(/\bfilled\b/i);
    // The card does not repeat the open-roles figure: the header owns it.
    expect(container.textContent).not.toMatch(/\b12 open roles?\b/);
  });

  it("a withheld record leads with 'No reliable hiring signal yet' and folds every refusal behind its own Why?", () => {
    const { container } = render(<HiringRecordCard input={rec({ curve: LAP_ZERO_RELIST, gated: { verdict: "unknown", withheld: "relist detection unproven" }, actively: "unknown", admitted: null })} />);
    expect(container.querySelector("[data-record-lead]")?.textContent).toBe("No reliable hiring signal yet");
    expect(screen.getByText("Closure record withheld")).toBeInTheDocument();
    // Lap: no fourteen-day share and no median. Zero relists on 20,767: no ninety-day count.
    expect(container.querySelector("[data-record='pace']")).toBeNull();
    expect(container.querySelector("[data-record='counts']")).toBeNull();
    expect(container.textContent).not.toMatch(/0\.53%|Up to \d+%|by day 25/);
    const counts = container.querySelector<HTMLElement>("[data-hh-gate='relist detection unproven']")!;
    const pace = container.querySelector<HTMLElement>("[data-hh-gate='lap']")!;
    for (const why of [counts, pace]) {
      const button = within(why).getByRole("button", { name: /Why\?/ });
      expect(button).toHaveAttribute("aria-expanded", "false");
      const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
      expect(panel).not.toBeVisible();
      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-expanded", "true");
      expect(panel).toBeVisible();
    }
    expect(counts.textContent).toContain("We logged 20,767 roles taken down on this board over 11 days of watching and not one that came back");
    expect(pace.textContent).toContain("We confirm a takedown on this board only by re-reading the whole board");
  });

  it("a record read both ways and empty both ways says so in one sentence", () => {
    const { container } = render(<HiringRecordCard input={rec({ gated: { verdict: "no-pattern", withheld: null }, actively: "negative", admitted: null, growth: { verdict: "no-growth", row: { baseline_day: "2026-10-04", baseline_served: 69, latest_day: "2026-10-11", latest_served: 72, rate: 0.043 }, why: null } })} />);
    expect(container.querySelector("[data-record-lead]")?.textContent).toBe("We read this board and saw neither a rise of 25% or more in roles served nor a pattern of roles taken down and left down.");
  });
});

describe("counts are single plural sentences", () => {
  it("one role is 'role', many are 'roles', and the figure is grouped", () => {
    const one = render(<HiringRecordCard input={rec({ curve: { ...FULL, filled_roles_90d: 1, relisted_roles_90d: 0, tracking_days: 30 } })} />);
    expect(one.container.querySelector("[data-record='counts']")?.textContent).toBe("1 role taken down (not relisted) in 30 days of tracking");
    one.unmount();
    const many = render(<HiringRecordCard input={rec({ curve: { ...FULL, filled_roles_90d: 1294, relisted_roles_90d: 300, tracking_days: 88 } })} />);
    expect(many.container.querySelector("[data-record='counts']")?.textContent).toBe("1,294 roles taken down (not relisted) in 88 days of tracking");
  });
});

describe("the footnote and the source", () => {
  it("the footnote is xs in the subtle token, with no opacity on its text", () => {
    const { container } = render(<HiringRecordCard input={rec({ computedAt: "2026-10-12T09:00:00Z" })} />);
    const foot = Array.from(container.querySelectorAll("p")).find((p) => (p.textContent ?? "").startsWith("Computed from the full lifecycle"))!;
    expect(foot.className).toContain("text-xs");
    expect(foot.className).toContain("text-subtle-foreground");
    expect(foot.className).not.toMatch(/text-\[\d+px\]|\/\d{2}\b/);
    expect(foot.textContent).toMatch(/Figures as of /);
  });

  it("the card asks the shared gate, reads no layoff filing, and re-derives no verdict", () => {
    const src = codeOf(readFileSync(resolve(__dirname, "../components/jobs/company/HiringRecordCard.tsx"), "utf8"));
    expect(src).toMatch(/hiringRecordGate\(c\)/);
    expect(src).not.toMatch(/layoff/i);
    expect(src).not.toMatch(/\bhiringRecordVerdict\(|\bactivelyHiringVerdict\(|\bgrowthVerdict\(/);
    expect(src).not.toMatch(/@\/pages\/Jobs/);
  });

  it("renders nothing without a curve row", () => {
    expect(render(<HiringRecordCard input={rec({ curve: null })} />).container).toBeEmptyDOMElement();
    expect(render(<HiringRecordCard input={null} />).container).toBeEmptyDOMElement();
  });
});
