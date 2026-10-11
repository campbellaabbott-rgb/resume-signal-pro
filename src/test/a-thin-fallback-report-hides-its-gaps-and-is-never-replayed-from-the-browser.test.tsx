/**
 * A THIN FALLBACK REPORT HIDES ITS GAPS, SAYS SO, AND IS NEVER REPLAYED FROM
 * THE BROWSER (register S11-147).
 *
 * The streaming fallback marks a thin model reply partial with nothing filled
 * in, but the banner said "automated analysis filled them in" and "this
 * version was not saved", while the page showed its hard-coded defaults
 * ("Clear Experience", a 2-year tenure, "steady" progression, an industry
 * average of 72) as that analysis, and the browser cached the report for four
 * hours. Now the fork names its own reason, the banner says the empty
 * sections are hidden, the tiles with no data hide, and a partial report is
 * neither cached nor replayed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createHash } from "node:crypto";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const q = () => chain;
  Object.assign(chain, {
    select: q, eq: q, in: q, order: q, limit: q, gte: q, lte: q, insert: q, upsert: q, update: q,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: vi.fn(async () => ({ data: null, error: null })),
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
      auth: {
        getSession: async () => ({ data: { session: null } }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});

Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import { PartialResultsNotice } from "@/components/PartialResultsNotice";
import { FreeKeywordResults } from "@/components/FreeKeywordResults";
import { useStreamingScan } from "@/hooks/use-streaming-scan";

const RESUME = "Jane Doe\nSenior Analyst, Acme Corp, Jan 2020 - Present\n- Cut vendor spend by $250,000 annually\n- Led a team of five analysts across three regions\nEDUCATION\nBSc Economics, State University\nSKILLS\nExcel, SQL, Tableau";

describe("the banner", () => {
  it("for the fallback's thin reply says the empty sections are hidden, never that analysis filled them", () => {
    const { container } = render(<PartialResultsNotice reason="thin_unfilled" />);
    expect(container.textContent).toMatch(/hidden/);
    expect(container.textContent).not.toMatch(/filled them in|not saved|unavailable/);
  });
});

describe("the report with the fields a thin reply leaves out", () => {
  it("shows no invented strength, tenure, progression, industry average or years", () => {
    const { container } = render(
      <MemoryRouter>
        <FreeKeywordResults
          industry="finance"
          atsScoreEstimate={55}
          formatGrade="B"
          formatIssue="Clean single-column layout"
          resumeLength={undefined as never}
          resumeText={RESUME}
          redFlags={[]}
          keywords={[]}
          onGetFullAnalysis={vi.fn()}
          onGenerateTailoredResume={vi.fn()}
        />
      </MemoryRouter>,
    );
    const text = container.textContent ?? "";
    expect(text).not.toContain("Clear Experience");
    expect(text).not.toContain("3-5 years");
    expect(text).not.toContain("Top 50%");
    expect(text).not.toMatch(/~?2 years/);
  });
});

describe("the browser's copy of a streamed report", () => {
  const KEY = () => "resume_scan_cache_v2_" + createHash("sha256").update(`${RESUME}|JD||TC|`.replace(/\s+/g, " ").trim().toLowerCase()).digest("hex").slice(0, 32);
  const sse = (data: Record<string, unknown>) =>
    new Response(`event: complete\ndata: ${JSON.stringify(data)}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("a partial report is not cached", async () => {
    fetchSpy.mockResolvedValue(sse({ success: true, atsScoreEstimate: 55, partialResults: true, partialReason: "thin_unfilled" }));
    const { result } = renderHook(() => useStreamingScan());
    await act(async () => { await result.current.startStreamingScan(RESUME, { maxRetries: 0 }); });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(KEY())).toBeNull();
  });

  it("a whole report is cached, as before, under the key the test computes", async () => {
    fetchSpy.mockResolvedValue(sse({ success: true, atsScoreEstimate: 55 }));
    const { result } = renderHook(() => useStreamingScan());
    await act(async () => { await result.current.startStreamingScan(RESUME, { maxRetries: 0 }); });
    expect(localStorage.getItem(KEY())).toBeTruthy();
  });

  it("a partial report cached before this rule is not replayed: the scan runs", async () => {
    localStorage.setItem(KEY(), JSON.stringify({ result: { success: true, atsScoreEstimate: 41, partialResults: true, partialReason: "thin" }, timestamp: Date.now() }));
    fetchSpy.mockResolvedValue(sse({ success: true, atsScoreEstimate: 62 }));
    const { result } = renderHook(() => useStreamingScan());
    let out: { atsScoreEstimate?: number } | null = null;
    await act(async () => { out = await result.current.startStreamingScan(RESUME, { maxRetries: 0 }) as never; });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(out!.atsScoreEstimate).toBe(62);
  });
});
