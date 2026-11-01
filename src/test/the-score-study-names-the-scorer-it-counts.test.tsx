/**
 * THE SCORE STUDY NAMES THE SCORER IT COUNTS (register S13-050, the page half).
 *
 * 20261101100000 counts only the primary scanner's model-written reports and
 * answers how many it left out (`excluded`) and which scorer it counts
 * (`scorer: 'primary'`). /research/ats-score-benchmarks printed neither: its
 * subline and its FAQ described every scan as in the sample, and the page
 * said "completed scans" where the crawler copy said "scans logged"
 * (S13-087). The page and the bake now print one text from
 * src/lib/score-study.ts, and name the primary scanner only once the
 * response itself does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const rpcAnswer = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => stub(),
    rpc: async () => ({ data: rpcAnswer.value, error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
// The page's charts measure their box; jsdom has no ResizeObserver.
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
import { studyBasisLine, studyFaqs, studyScoredByPrimary } from "@/lib/score-study";

vi.setConfig({ testTimeout: 30_000 });
afterEach(() => { cleanup(); rpcAnswer.value = null; });

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const BASE = {
  as_of: "2026-11-01", window_days: 180,
  overall: { n: 412, median: 61, p25: 48, p75: 72, pct_80_plus: 9, pct_under_50: 27 },
  histogram: [{ bucket: 60, n: 120 }], industries: [], experience: [],
};
const source = (faqs: Array<{ q: string; a: string }>) => faqs.find((f) => f.q === "Where do these numbers come from?")!.a;

describe("the basis, as the response states it", () => {
  it("names the primary scanner and the counts left out, once the response says so", () => {
    const line = studyBasisLine({ scorer: "primary", excluded: { fallback_scanner: 1204, rule_based_report: 37 } });
    expect(line).toBe("Every figure is scored by our primary scanner. Left out: 1,204 scans the fallback scanner answered and 37 reports our rules wrote when the AI could not.");
    expect(studyBasisLine({ scorer: "primary", excluded: { fallback_scanner: 1, rule_based_report: 1 } })).toContain("1 scan the fallback scanner answered and 1 report our rules wrote");
    expect(studyBasisLine({ scorer: "primary" })).toBe("Every figure is scored by our primary scanner.");
  });
  it("says nothing of a scorer before the migration answers one", () => {
    for (const ins of [null, undefined, {}, { scorer: "both" }, { excluded: { fallback_scanner: 3, rule_based_report: 0 } }]) {
      expect(studyBasisLine(ins as never), JSON.stringify(ins)).toBeNull();
      expect(studyScoredByPrimary(ins as never)).toBe(false);
    }
  });
  it("the source answer names the primary scanner only then, and both say scans logged", () => {
    const blended = source(studyFaqs(null));
    const primary = source(studyFaqs({ scorer: "primary" }));
    expect(blended).not.toMatch(/primary scanner/);
    expect(primary).toMatch(/each scored by our primary scanner/);
    expect(primary).toMatch(/fallback scanner answered/);
    for (const a of [blended, primary]) {
      expect(a).toMatch(/scans logged/);
      expect(a).not.toMatch(/completed scans/i);
    }
  });
});

describe("the page prints it", () => {
  const mount = () => render(
    <HelmetProvider>
      <MemoryRouter initialEntries={["/research/ats-score-benchmarks"]}>
        <ScoreStudy />
      </MemoryRouter>
    </HelmetProvider>,
  );
  it("a primary-scored response: the basis line and the FAQ answer", async () => {
    rpcAnswer.value = { ...BASE, scorer: "primary", excluded: { fallback_scanner: 88, rule_based_report: 4 } };
    const { container } = mount();
    await waitFor(() => expect(container.querySelector("[data-study-basis]")).not.toBeNull());
    expect(container.querySelector("[data-study-basis]")?.textContent).toBe(studyBasisLine(rpcAnswer.value as never));
    expect(screen.getByText(source(studyFaqs({ scorer: "primary" })))).toBeTruthy();
    expect(container.textContent).toMatch(/412 scans logged/);
    expect(container.textContent).not.toMatch(/completed scans?/i);
  });
  it("an older response: no basis line, the blended answer", async () => {
    rpcAnswer.value = { ...BASE };
    const { container } = mount();
    await waitFor(() => expect(container.textContent).toMatch(/412 scans logged/));
    expect(container.querySelector("[data-study-basis]")).toBeNull();
    expect(screen.getByText(source(studyFaqs(null)))).toBeTruthy();
  });
});

describe("the bake prints the same text", () => {
  it("reads the questions and the basis line from the shared module, typing none of its own", () => {
    const bake = codeOf(read("scripts/prerender-seo.mjs"));
    expect(bake).toContain('export { studyBasisLine, studyFaqs } from "../src/lib/score-study";');
    expect(bake).toContain("const studyFaqs = D.studyFaqs(ins);");
    expect(bake).toContain("const studyBasis = D.studyBasisLine(ins);");
    expect(bake).not.toMatch(/q: "Where do these numbers come from\?"/);
    const page = codeOf(read("src/pages/ScoreStudy.tsx"));
    expect(page).not.toMatch(/const FAQS = \[/);
    expect(page).toContain("studyFaqs(insights)");
  });
});
