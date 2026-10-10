/**
 * THE HOMEPAGE TOLD FOUR DIFFERENT TIMES TO RESULTS (commercial-readiness
 * "one honest time-to-results claim").
 *
 * The same free scan was "~10 sec" (How it works), "30 seconds" (the trust
 * strip), "about 60 seconds" (the hero) and "~90 seconds" (under the scan
 * button). What the code guarantees is a bound: free-keyword-scan stops
 * waiting for the model AI_DEADLINE_MS after the request starts and serves
 * its rule-based report. Every sentence now states that one bound,
 * SCAN_RESULTS_WITHIN_SECONDS, and the scanning screen counts down from it.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: null, error: null })),
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

import { SCAN_RESULTS_WITHIN_SECONDS } from "@/config/scan-timing";
import { HowItWorks } from "@/components/HowItWorks";
import { TrustIndicators } from "@/components/TrustIndicators";
import { ResumeUploader } from "@/components/ResumeUploader";
import { ScanProgressStages } from "@/components/ScanProgressStages";
import { ValueComparison } from "@/components/ValueComparison";

const root = resolve(__dirname, "../..");

/** Every duration a rendered page states, in seconds ("~10 sec", "1m 30s", "30 seconds"). */
function statedSeconds(text: string): number[] {
  const out: number[] = [];
  const clock = /(\d+)m\s*(\d+)s/g;
  for (const m of text.matchAll(clock)) out.push(Number(m[1]) * 60 + Number(m[2]));
  // textContent runs words together ("90 seconds100% private"), so the unit
  // is matched by its spelling, not by a word boundary.
  for (const m of text.replace(clock, " ").matchAll(/(\d+)\s*(?:seconds?|secs?\.?)/gi)) out.push(Number(m[1]));
  return out;
}

describe("the homepage states one time to results", () => {
  it("every section that states a time states the same bound", () => {
    const pages = [
      render(<MemoryRouter><HowItWorks /></MemoryRouter>).container.textContent ?? "",
      render(<MemoryRouter><TrustIndicators /></MemoryRouter>).container.textContent ?? "",
      render(
        <MemoryRouter>
          <ResumeUploader onFileSelect={vi.fn()} onTextSubmit={vi.fn()} onCheckout={vi.fn()} onFreeScan={vi.fn()} isLoading={false} />
        </MemoryRouter>,
      ).container.textContent ?? "",
      render(<ScanProgressStages />).container.textContent ?? "",
      render(<MemoryRouter><ValueComparison /></MemoryRouter>).container.textContent ?? "",
    ];
    const stated = pages.flatMap(statedSeconds);
    expect(stated.length).toBeGreaterThanOrEqual(6);
    expect(new Set(stated)).toEqual(new Set([SCAN_RESULTS_WITHIN_SECONDS]));
  });

  it("no language types its own number into a time-to-results sentence", () => {
    const keys: Array<[string, (d: Record<string, any>) => string]> = [
      ["hero.socialFirst.joinThousands", (d) => d.hero.socialFirst.joinThousands],
      ["howItWorks.footer.results", (d) => d.howItWorks.footer.results],
      ["uploader.scanFooter", (d) => String(d.uploader.scanFooter).split("•")[0]],
      ["trustIndicators.badges.instant.description", (d) => d.trustIndicators.badges.instant.description],
      ["howItWorks.steps.analysis.description", (d) => String(d.howItWorks.steps.analysis.description).replace("{{checks}}", "")],
      ["hero.benefitLed.solutionHeadingSuffix", (d) => d.hero.benefitLed.solutionHeadingSuffix],
      ["valueComparison.rows.timeToResults.us", (d) => d.valueComparison.rows.timeToResults.us],
    ];
    const dir = resolve(root, "src/i18n/locales");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const d = JSON.parse(readFileSync(resolve(dir, file), "utf8"));
      for (const [key, get] of keys) {
        const v = get(d);
        expect(v.split("{{seconds}}").length - 1, `${file} ${key}`).toBe(1);
        expect(v.replace("{{seconds}}", ""), `${file} ${key} types a number`).not.toMatch(/\d/);
      }
    }
  });

  it("the stated bound covers the server's model deadline", () => {
    const src = readFileSync(resolve(root, "supabase/functions/free-keyword-scan/index.ts"), "utf8");
    const m = src.match(/const AI_DEADLINE_MS = ([\d_]+);/);
    expect(m, "AI_DEADLINE_MS not found").toBeTruthy();
    const deadlineMs = Number(m![1].replace(/_/g, ""));
    expect(SCAN_RESULTS_WITHIN_SECONDS * 1000).toBeGreaterThan(deadlineMs);
  });
});
