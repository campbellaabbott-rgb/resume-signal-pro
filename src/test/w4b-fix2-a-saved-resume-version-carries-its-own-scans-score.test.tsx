/**
 * A SAVED RÉSUMÉ VERSION CARRIES ITS OWN SCAN'S SCORE, OR IS NOT OFFERED
 * (wave 4 round 2 recheck of 52b326fb).
 *
 * WHAT WAS WRONG. "Save the résumé from your last scan" labelled the version
 * with latestLocalScore(), the newest local-history score, which can belong
 * to a different résumé; with no local history it inserted 0, because
 * user_scans.ats_score is NOT NULL. rb_resume_text is also written by an
 * upload before any scan, by the résumé builder and by the premium rewrite.
 * The saved row became scans[0], so /account showed "latest 0", a negative
 * change and the chart falling to 0.
 *
 * WHAT HOLDS NOW. The local history records each scan's whole-text
 * fingerprint (resumeFingerprint) beside its score. The offer is made only
 * when a local scan of exactly the tab's text scored it, and Save inserts that
 * score; an unscanned upload, a builder draft, an edit after the scan or
 * another résumé's newer score is never offered, and a score that is not a
 * number is never written.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { lastScanResumeToOffer, LOCAL_HISTORY_KEY, saveLastScanResume, SESSION_RESUME_KEY } from "@/lib/account-history-import";
import { LocalHistoryOffer } from "@/components/account/LocalHistoryOffer";
import { resumeFingerprint, useScanHistory } from "@/hooks/use-scan-history";

type Row = Record<string, unknown>;
const fakeDb = () => {
  const inserted: Row[] = [];
  return { inserted, db: { from: () => ({ insert: async (r: Row) => { inserted.push(r); return { error: null }; } }) } };
};

const SCANNED = "Sam Lee. Warehouse supervisor, six years leading a 40-person night crew. ".repeat(6);
const OTHER = "Pat Kim. Registered nurse, ten years in emergency care and triage. ".repeat(6);
const history = (...entries: Array<Record<string, unknown>>) => localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify({ entries }));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(cleanup);

describe("the offer pairs the tab's résumé with its own scan", () => {
  it("an upload never scanned, with no local history, is not offered (it was saved at 0)", () => {
    sessionStorage.setItem(SESSION_RESUME_KEY, SCANNED);
    expect(lastScanResumeToOffer("u-1")).toBeNull();
  });

  it("another résumé's newer score is never this one's", () => {
    sessionStorage.setItem(SESSION_RESUME_KEY, SCANNED);
    history({ id: "o", timestamp: "2026-10-20T10:00:00.000Z", atsScore: 91, resumeFingerprint: resumeFingerprint(OTHER) });
    expect(lastScanResumeToOffer("u-1")).toBeNull();
    history(
      { id: "o", timestamp: "2026-10-20T10:00:00.000Z", atsScore: 91, resumeFingerprint: resumeFingerprint(OTHER) },
      { id: "s", timestamp: "2026-10-19T10:00:00.000Z", atsScore: 64, resumeFingerprint: resumeFingerprint(SCANNED) },
    );
    expect(lastScanResumeToOffer("u-1")).toEqual({ text: SCANNED.trim(), score: 64 });
  });

  it("an edit after the scan (the builder or the rewrite writes the tab's text) is not offered with the old score", () => {
    history({ id: "s", timestamp: "2026-10-19T10:00:00.000Z", atsScore: 64, resumeFingerprint: resumeFingerprint(SCANNED) });
    sessionStorage.setItem(SESSION_RESUME_KEY, `${SCANNED} Added: forklift certified.`);
    expect(lastScanResumeToOffer("u-1")).toBeNull();
  });

  it("a scan recorded by the real history hook is found, and Save inserts its score and says it", async () => {
    const { result } = renderHook(() => useScanHistory());
    act(() => {
      result.current.addScanEntry({
        candidateName: null, currentRole: null, atsScore: 64, industry: "logistics", experienceLevel: null,
        formatGrade: "B", keywordCount: 9, redFlagCount: 1,
      }, SCANNED);
    });
    sessionStorage.setItem(SESSION_RESUME_KEY, SCANNED);
    const offered = lastScanResumeToOffer("u-1");
    expect(offered).toEqual({ text: SCANNED.trim(), score: 64 });
    const { db, inserted } = fakeDb();
    render(<MemoryRouter><LocalHistoryOffer db={db} userId="u-1" offeredScans={[]} offeredResume={offered} mapRow={(r: never) => r} onScans={() => {}} /></MemoryRouter>);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save it" })); });
    expect(inserted).toEqual([expect.objectContaining({ user_id: "u-1", resume_text: SCANNED.trim(), ats_score: 64 })]);
    expect(String(inserted[0].label)).toMatch(/scored 64$/);
  });

  it("a score that is not a number is never written as 0", async () => {
    const { db, inserted } = fakeDb();
    expect(await saveLastScanResume(db, "u-1", SCANNED, Number.NaN, "x")).toBe(false);
    expect(inserted).toEqual([]);
  });
});
