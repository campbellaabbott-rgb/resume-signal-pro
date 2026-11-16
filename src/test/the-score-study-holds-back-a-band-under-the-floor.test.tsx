/**
 * THE SCORE STUDY HOLDS BACK A BAND UNDER THE FLOOR (S14X-193, the page and
 * bake half).
 *
 * /research/ats-score-benchmarks said "minimum 25 scans per bucket" and drew
 * a bar for a band of 2 scans, and "Only 0% scored 80 or higher" from no scan
 * at all (live, 2026-11-15: n 190, bands of 2, 4, 24 and 8). From
 * 20261112195000 the answer holds those bands back and counts them; an answer
 * from before it is held to the same floor by the page and the bake, so the
 * frontend can ship first.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";

const rpcAnswer = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => stub(),
    rpc: async () => ({ data: rpcAnswer.value, error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
function stub() {
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = () => th;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import ScoreStudy from "@/pages/ScoreStudy";
import { scoreBandsOverFloor } from "../../scripts/prerender-seo.mjs";

vi.setConfig({ testTimeout: 30_000 });
afterEach(() => { cleanup(); rpcAnswer.value = null; });

const OVERALL = { n: 190, median: 52, p25: 44, p75: 61, pct_under_50: 41 };
/** The live answer's shape before 20261112195000: every band, and 0% from no scan. */
const BEFORE = {
  as_of: "2026-11-15", window_days: 180,
  overall: { ...OVERALL, pct_80_plus: 0 },
  histogram: [{ bucket: 0, n: 2 }, { bucket: 20, n: 4 }, { bucket: 30, n: 40 }, { bucket: 40, n: 60 },
              { bucket: 50, n: 52 }, { bucket: 60, n: 24 }, { bucket: 70, n: 8 }],
  industries: [], experience: [],
};
/** The same scans as 20261112195000 answers them. */
const AFTER = {
  ...BEFORE,
  overall: { ...OVERALL, pct_80_plus: null },
  histogram: [{ bucket: 30, n: 40 }, { bucket: 40, n: 60 }, { bucket: 50, n: 52 }],
  histogram_hidden_n: 38, band_floor: 25,
};
/** Every band over the floor and 37 scans at 80+. */
const FULL = {
  as_of: "2026-11-15", window_days: 180,
  overall: { n: 412, median: 61, p25: 48, p75: 72, pct_80_plus: 9, pct_under_50: 27 },
  histogram: [{ bucket: 40, n: 100 }, { bucket: 50, n: 150 }, { bucket: 60, n: 125 }, { bucket: 80, n: 37 }],
  histogram_hidden_n: 0, band_floor: 25,
  industries: [], experience: [],
};

const mount = async (answer: unknown) => {
  rpcAnswer.value = answer;
  render(<HelmetProvider><MemoryRouter><ScoreStudy /></MemoryRouter></HelmetProvider>);
  await waitFor(() => expect(screen.getByText(/How real resumes score/)).toBeTruthy());
  return document.body.textContent ?? "";
};

describe("the page", () => {
  for (const [name, answer] of [["an answer from before the floor", BEFORE], ["the answer with the floor", AFTER]] as const) {
    it(`names the scans it held back and states no 80+ share from ${name}`, async () => {
      const text = await mount(answer);
      expect(text).toMatch(/band with at least 25 scans; 38 scans in bands under that floor are held back/);
      expect(text).not.toMatch(/together they show every scan/);
      expect(text).not.toMatch(/Only 0% scored 80/);
      expect(text).toMatch(/Fewer than 25 of them scored 80 or higher, too few to state as a share/);
      expect(text).toMatch(/minimum 25\s+scans per score band, industry and experience level/);
    });
  }

  it("states the 80+ share and says the bands cover every scan when nothing was held back", async () => {
    const text = await mount(FULL);
    expect(text).toMatch(/Only 9% scored 80 or higher/);
    expect(text).toMatch(/together they show every scan logged/);
    expect(text).not.toMatch(/held back/);
  });

  it("its Dataset markup says the floor holds for every band", async () => {
    await mount(AFTER);
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent).join("\n");
    expect(ld).toContain("every score band, industry and experience level published only at n ≥ 25");
  });
});

describe("the bake applies the same floor", () => {
  it("draws only bands at or over it and counts the rest, from either answer", () => {
    for (const answer of [BEFORE, AFTER]) {
      const b = scoreBandsOverFloor(answer);
      expect(b.shown.map((h: { bucket: number }) => h.bucket)).toEqual([30, 40, 50]);
      expect(b.hidden).toBe(38);
      expect(b.pct80).toBeNull();
    }
  });
  it("keeps a share the answer stated over the floor", () => {
    expect(scoreBandsOverFloor(FULL)).toMatchObject({ hidden: 0, pct80: 9 });
    expect(scoreBandsOverFloor({ ...FULL, band_floor: undefined, histogram_hidden_n: undefined }).pct80).toBe(9);
  });
});
