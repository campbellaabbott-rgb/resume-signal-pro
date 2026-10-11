/**
 * THE BACKUP SCANNER RAN PAST THE PROMISED WINDOW, UNDER THE MAIN SCANNER'S
 * CLAIMS (sweep S11-150, 2026-10-11).
 *
 * /methodology and the homepage describe free-keyword-scan: an AI score held
 * within a band of a rule-based score, a "Why this score" audit on every
 * report, results within the stated seconds. When that function fails with an
 * outage the page asks the streaming fork, which has no clamp and no audit,
 * and asked it only after the primary had spent up to its 85-second model
 * clock, with two minutes of its own. Now the fork runs only inside the
 * scan's window counted from the press, its report is marked partial with the
 * reason "fallback" and says the backup wrote it, and /methodology says so in
 * all nine locales.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, renderHook, act } from "@testing-library/react";
import { codeOf } from "./helpers/strip-comments";
import { asFallbackReport, STREAM_FALLBACK_MIN_MS, streamFallbackDeadline } from "@/lib/scan-fallback";
import { SCAN_RESULTS_WITHIN_SECONDS } from "@/config/scan-timing";
import { PartialResultsNotice } from "@/components/PartialResultsNotice";
import { useStreamingScan } from "@/hooks/use-streaming-scan";

const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];
const locale = (l: string) => JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales", `${l}.json`), "utf8"));

describe("the backup scanner runs only inside the scan's window", () => {
  const W = SCAN_RESULTS_WITHIN_SECONDS * 1000;
  it("its deadline is the window's end, counted from the press", () => {
    expect(streamFallbackDeadline(1_000, 3_000)).toBe(1_000 + W);
  });
  it("with too little of the window left it is not asked at all", () => {
    expect(streamFallbackDeadline(0, W - STREAM_FALLBACK_MIN_MS)).toBe(W);
    expect(streamFallbackDeadline(0, W - STREAM_FALLBACK_MIN_MS + 1)).toBeNull();
    // the primary spent its whole 85-second model clock
    expect(streamFallbackDeadline(0, 85_000)).toBeNull();
  });
});

describe("the streaming scan keeps the deadline it is given", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  const resume = "Jane Doe\nSoftware Engineer\nExperience\n" + "Built and shipped services used by thousands of customers every day. ".repeat(12);

  it("aborts a stalled request at the deadline, not after two minutes", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      const s = init.signal as AbortSignal;
      signals.push(s);
      s.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })));
    const { result } = renderHook(() => useStreamingScan());
    const t0 = Date.now();
    let out: unknown = "pending";
    await act(async () => { out = await result.current.startStreamingScan(resume, { skipCache: true, deadlineAt: Date.now() + 150 }); });
    expect(out).toBeNull();
    expect(signals.length).toBe(1);
    expect(signals[0].aborted).toBe(true);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("starts no request once the deadline has passed", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useStreamingScan());
    await act(async () => { await result.current.startStreamingScan(resume, { skipCache: true, deadlineAt: Date.now() - 1 }); });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("a report the backup wrote says so", () => {
  it("is marked partial with the reason, and the banner names the backup", () => {
    const r = asFallbackReport({ atsScoreEstimate: 61, partialResults: false as boolean });
    expect(r).toMatchObject({ atsScoreEstimate: 61, partialResults: true, partialReason: "fallback" });
    const { container, rerender } = render(<PartialResultsNotice reason="fallback" />);
    expect(container.textContent).toMatch(/simpler backup wrote this report/);
    expect(container.textContent).toMatch(/no "Why this score" breakdown/);
    rerender(<PartialResultsNotice reason="rule_based" />);
    expect(container.textContent).toMatch(/briefly unavailable/);
  });

  it("the page marks the backup's report and passes it the window's deadline", () => {
    const page = codeOf(readFileSync(resolve(__dirname, "../pages/Index.tsx"), "utf8"));
    expect(page).toMatch(/const scanStartedAt = Date\.now\(\);/);
    expect(page).toMatch(/const fallbackDeadline = streamFallbackDeadline\(scanStartedAt\);/);
    expect(page).toMatch(/deadlineAt: fallbackDeadline,/);
    expect(page).toMatch(/result = asFallbackReport\(streamResult\);/);
    expect(page).not.toMatch(/result = streamResult;/);
  });
});

describe("/methodology says what a backup report lacks, in all nine locales", () => {
  for (const l of LOCALES) {
    it(`${l}: the banner text exists, the scoring step names the backup, the audit line says full reports`, () => {
      const j = locale(l);
      expect(typeof j.homepage.partialResults.fallback, "homepage.partialResults.fallback").toBe("string");
      expect(j.homepage.partialResults.fallback.length).toBeGreaterThan(40);
      const step = j.methodologyPage.steps.scoringAlgorithm.description as string;
      expect(step).toContain("{{band}}");
      const en = locale("en");
      expect(step.length, "the backup sentence was added").toBeGreaterThan((en.methodologyPage.steps.scoringAlgorithm.description as string).length * 0.6);
      expect(j.methodologyPage.scoreCalculatedSubtitle).not.toBe("");
    });
  }
  it("en names the backup scanner and full reports", () => {
    const en = locale("en");
    expect(en.methodologyPage.steps.scoringAlgorithm.description).toMatch(/If the main scanner is down, a simpler backup answers instead: its report says so at the top and has no audit trail\./);
    expect(en.methodologyPage.scoreCalculatedSubtitle).toMatch(/^Every full report's "Why this score"/);
  });
});
