/**
 * THE PROGRESS BAR STARTS WHEN GENERATION STARTS (S10-151, bug reconcile of
 * 2026-11-19, lane paid-results).
 *
 * WHAT WAS WRONG. AIGenerationProgress set its clock when it mounted. The
 * purchase page keeps it mounted, hidden, for the whole recovery form, so a
 * buyer who spent more than about 14 seconds on the form saw 95% and
 * "Finalizing" the instant they pressed generate, and then waited the whole
 * generation on a bar that said it was nearly done.
 *
 * NOW the clock starts each time the overlay is shown: mounted 20 seconds
 * early, it starts near 0%, walks its steps from the first, and starts again
 * from 0% the next time it is shown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import i18n from "@/i18n";
import { AIGenerationProgress } from "@/components/AIGenerationProgress";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The percentage the overlay prints. */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const percent = (root: HTMLElement): number => {
  const [before, after] = i18n.t("aiGenerationProgress.complete", { progress: "NNN" }).split("NNN");
  const m = new RegExp(`${escape(before)}(\\d+)${escape(after ?? "")}`).exec(root.textContent ?? "");
  if (!m) throw new Error(`no percentage in: ${(root.textContent ?? "").slice(0, 200)}`);
  return Number(m[1]);
};

describe("the generation overlay's clock", () => {
  it("mounted hidden 20 s before generation, it starts near 0%, not at 95%", () => {
    const view = render(<AIGenerationProgress isVisible={false} productName="Interview Coach" />);
    act(() => { vi.advanceTimersByTime(20_000); });
    view.rerender(<AIGenerationProgress isVisible productName="Interview Coach" />);
    act(() => { vi.advanceTimersByTime(300); });
    expect(percent(view.container), "the bar jumped to where the mount time put it").toBeLessThanOrEqual(5);
    expect(view.container.textContent).toContain(i18n.t("aiGenerationProgress.steps.analyzingTitle"));
    expect(view.container.textContent).not.toContain(i18n.t("aiGenerationProgress.steps.finalizingDesc"));
  });

  it("then walks forward from the moment it was shown", () => {
    const view = render(<AIGenerationProgress isVisible={false} productName="Interview Coach" />);
    act(() => { vi.advanceTimersByTime(30_000); });
    view.rerender(<AIGenerationProgress isVisible productName="Interview Coach" />);
    act(() => { vi.advanceTimersByTime(7_100); });
    const p = percent(view.container);
    expect(p).toBeGreaterThan(40);
    expect(p).toBeLessThan(60);
  });

  it("shown a second time, it starts again from 0%", () => {
    const view = render(<AIGenerationProgress isVisible productName="Interview Coach" />);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(percent(view.container)).toBe(95);
    view.rerender(<AIGenerationProgress isVisible={false} productName="Interview Coach" />);
    act(() => { vi.advanceTimersByTime(15_000); });
    view.rerender(<AIGenerationProgress isVisible productName="Interview Coach" />);
    act(() => { vi.advanceTimersByTime(300); });
    expect(percent(view.container)).toBeLessThanOrEqual(5);
  });
});
