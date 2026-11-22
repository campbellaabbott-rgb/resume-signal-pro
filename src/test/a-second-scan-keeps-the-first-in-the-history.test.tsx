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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { useScanHistory, type ScanHistory } from "@/hooks/use-scan-history";

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
