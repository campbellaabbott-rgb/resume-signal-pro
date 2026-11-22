/**
 * A SECOND SCAN KEEPS THE FIRST IN THE HISTORY (register S10-056).
 *
 * The report records its scan from an effect on its first render, before the
 * hook's own load from storage has reached its state. addScanEntry built the
 * new history on that empty state and saved it over the stored one, so each
 * report replaced every earlier scan in the browser, with the email and the
 * ticked checklist items: "since your last scan" and the score trend never
 * had a last scan to show. updateChecklist and setUserEmail had the same
 * flaw. Each write now reads the stored history inside the call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useScanHistory, type ScanHistory } from "@/hooks/use-scan-history";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

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

import i18n from "@/i18n";
import { FreeKeywordResults } from "@/components/FreeKeywordResults";

vi.setConfig(MOUNT_TEST_BUDGET);

const KEY = "rb_scan_history";
const stored = (): ScanHistory => JSON.parse(localStorage.getItem(KEY) ?? "null");

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

const entry = (atsScore: number) => ({
  candidateName: "Jordan Probe", currentRole: "Nurse", atsScore, formatGrade: "B",
  industry: "healthcare", experienceLevel: "mid", keywordCount: 4, redFlagCount: 1,
  checklist: [{ id: "quick_win_0", label: "Add numbers", completed: false, category: "quick_win" as const }],
});

// Records its scan the way the report does: in an effect on first render.
function Report({ score, resume, onHook }: { score: number; resume: string; onHook?: (h: ReturnType<typeof useScanHistory>) => void }) {
  const history = useScanHistory();
  onHook?.(history);
  useEffect(() => { history.addScanEntry(entry(score), resume); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

describe("two reports in one browser", () => {
  it("keep both scans, the email and the ticked item", () => {
    let first: ReturnType<typeof useScanHistory> | null = null;
    const a = render(<Report score={58} resume={"Jordan Probe\nNurse\n- Cared for patients\n"} onHook={(h) => { first = h; }} />);
    expect(stored().entries).toHaveLength(1);
    const firstId = stored().entries[0].id;
    act(() => first!.setUserEmail("probe@example.com"));
    act(() => first!.updateChecklist(firstId, "quick_win_0", true));
    a.unmount();

    render(<Report score={71} resume={"Jordan Probe\nNurse\n- Cared for 20 patients a shift on a 30-bed ward\n"} />);
    const after = stored();
    expect(after.entries.map((e) => e.atsScore)).toEqual([71, 58]);
    expect(after.totalScans).toBe(2);
    expect(after.email).toBe("probe@example.com");
    expect(after.entries[1].checklist?.[0].completed).toBe(true);
    expect(after.bestAtsScore).toBe(71);
  });

  it("the second report's own hook offers the first as the previous scan", () => {
    render(<Report score={58} resume={"Jordan Probe\nNurse\n- Cared for patients\n"} />);
    cleanup();
    let hook: ReturnType<typeof useScanHistory> | null = null;
    render(<Report score={66} resume={"Jordan Probe\nNurse\n- Cared for 20 patients a shift\n"} onHook={(h) => { hook = h; }} />);
    expect(hook!.getPreviousScan()?.atsScore).toBe(58);
    expect(hook!.getLatestScan()?.atsScore).toBe(66);
  });

  it("the same report mounted twice is still one scan", () => {
    const resume = "Jordan Probe\nNurse\n- Cared for patients\n";
    render(<Report score={58} resume={resume} />);
    cleanup();
    render(<Report score={58} resume={resume} />);
    expect(stored().entries).toHaveLength(1);
    expect(stored().totalScans).toBe(1);
  });
});

describe("writes made before the load lands", () => {
  function Early({ run }: { run: (h: ReturnType<typeof useScanHistory>) => void }) {
    const history = useScanHistory();
    useEffect(() => { run(history); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
  }

  it("an email set on first render keeps the stored scans", () => {
    render(<Report score={58} resume={"Jordan Probe\n- one\n"} />);
    cleanup();
    render(<Early run={(h) => h.setUserEmail("probe@example.com")} />);
    expect(stored().entries).toHaveLength(1);
    expect(stored().email).toBe("probe@example.com");
  });

  it("a tick made on first render lands on the stored scan", () => {
    render(<Report score={58} resume={"Jordan Probe\n- one\n"} />);
    const id = stored().entries[0].id;
    cleanup();
    render(<Early run={(h) => h.updateChecklist(id, "quick_win_0", true)} />);
    expect(stored().entries[0].checklist?.[0].completed).toBe(true);
    expect(stored().entries[0].checklistCompletedCount).toBe(1);
  });
});

/**
 * THE REPORT TELLS THE EARLIER SCAN ONCE, AND RIGHT. With the history kept,
 * the report's since-last-scan banner has a last scan to show. The
 * returning-reader card beside it read its own copy of the history before
 * the report recorded the scan, so on a third report it said "scan #2" and
 * "+10" beside the banner's 60 -> 75 (+15), in English, for any candidate;
 * the share card's before/after image says, in English, that both scans used
 * the same rubric. Neither is in the report.
 */
describe("three reports for one candidate, read in French", () => {
  const ROOT = resolve(__dirname, "../..");
  const json = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

  const report = (score: number, bullet: string) => render(
    <MemoryRouter>
      <FreeKeywordResults
        industry="general" atsScoreEstimate={score} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
        candidateName="Camille Probe" currentRole="Gestionnaire de paie"
        redFlags={[]} keywords={[]}
        resumeText={`Camille Probe\nGestionnaire de paie\n- ${bullet}\n`.repeat(3)}
        sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
        contactInfo={{ hasEmail: true, hasPhone: true, hasLinkedIn: false, missingItems: [] } as never}
        onGetFullAnalysis={vi.fn()}
      />
    </MemoryRouter>,
  );

  it("the third shows 60 -> 75 (+15) once, and no English card with other numbers", async () => {
    i18n.addResourceBundle("fr", "translation", json("src/i18n/locales/fr.json"), true, true);
    i18n.addResourceBundle("fr", "translation", json("src/i18n/shards/free-scan-page/fr.json"), true, true);
    await i18n.changeLanguage("fr");
    try {
      report(50, "Ran the weekly payroll");
      cleanup();
      report(60, "Ran the weekly payroll for 120 staff");
      cleanup();
      const { container } = report(75, "Ran the weekly payroll for 120 staff with zero late runs in 2025");
      const since = i18n.t("freeScanPage.since.title", { before: 60, after: 75 });
      await waitFor(() => expect(container.textContent).toContain(since), SLOW);
      const text = container.textContent ?? "";
      expect(text).toContain(`${since} (+15)`);
      expect(text.split(since).length - 1, "the banner is shown once").toBe(1);
      for (const english of ["Welcome back", "This is scan #", "vs. last scan", "Great work!", "Share your before/after", "same rubric"]) {
        expect(text, english).not.toContain(english);
      }
      expect(stored().entries.map((e) => e.atsScore)).toEqual([75, 60, 50]);
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
