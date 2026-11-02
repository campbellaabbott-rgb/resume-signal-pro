/**
 * A TRACKED APPLICATION QUOTES NO COUNT THE EMPLOYER PAGE WITHHOLDS (S12-185).
 *
 * The board's cards, detail pane and compare drawer ask hiringRecordGate
 * before they print an employer's ninety-day role counts, and the employer
 * page withholds them on a board read in laps (Domino's logged 23,594 down
 * and none back on 2026-10-18), on a board whose re-post test reads another
 * location's posting as a re-post (Centria Autism: 2,967 "came back" against
 * 43 down), and on a board we have not proven we read to its end. The
 * account tracker's chip applied only its two count thresholds, so the same
 * employer printed "we watched 23594 of its roles come off the board and
 * stay off" on /account. The chip, and the reply-window share beside it, now
 * ask the same gate.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { trackedEmployerChip } from "@/lib/tracked-employer-chip";
import { hiringRecordGate } from "@/lib/hiring-record-gate";

const READ = { observability_bucket: "full_read", watched_from: "2026-08-01", multi_site_title_share: 0.02, tracking_days: 60 };

describe("the tracker's employer chip asks the employer page's gate", () => {
  it("a board read in laps (Domino's) gets no 'stayed off' chip, whatever its count", () => {
    const dominos = { observability_bucket: "lap_pending", tracking_days: 30, filled_roles_90d: 23594, relisted_roles_90d: 0 };
    expect(hiringRecordGate(dominos).counts90.ok).toBe(false);
    expect(trackedEmployerChip(dominos)).toBeNull();
    expect(trackedEmployerChip({ ...dominos, observability_bucket: "lap_proven" })).toBeNull();
  });

  it("a board whose re-post test reads other sites (Centria) gets no churn chip", () => {
    const centria = { ...READ, multi_site_title_share: 0.97, filled_roles_90d: 43, relisted_roles_90d: 2967 };
    expect(trackedEmployerChip(centria)).toBeNull();
  });

  it("a board we have not proven we read, or one watched too briefly, says nothing", () => {
    expect(trackedEmployerChip({ filled_roles_90d: 120, relisted_roles_90d: 6 })).toBeNull();
    expect(trackedEmployerChip({ ...READ, tracking_days: 9, filled_roles_90d: 120, relisted_roles_90d: 6 })).toBeNull();
  });

  it("a board the employer page prints keeps both chips", () => {
    expect(trackedEmployerChip({ ...READ, filled_roles_90d: 120, relisted_roles_90d: 6 })).toEqual({ kind: "stayed-down", n: 120 });
    expect(trackedEmployerChip({ ...READ, filled_roles_90d: 4, relisted_roles_90d: 30 })).toEqual({ kind: "churn", n: 30 });
  });

  it("the account page keeps the gate's fields on each row and asks the gate before the reply-window share", () => {
    const src = readFileSync(resolve(__dirname, "../pages/Account.tsx"), "utf8");
    // The row is kept whole, so observability_bucket and watched_from reach the gate.
    expect(src).toMatch(/const \{ company_token: _token, \.\.\.row \} = r;\s*map\[r\.company_token\] = row;/);
    expect(src).toMatch(/if \(!hiringRecordGate\(hh\)\.share14\.ok\) return null;/);
  });
});
