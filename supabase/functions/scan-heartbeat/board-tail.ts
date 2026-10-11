/**
 * THREE AGES NOTHING WATCHED (S11-001).
 *
 * The job board's pass-end tail died at the gateway's 150 s idle timeout on
 * every pass from 2026-10-09 15:51Z. For two days the board served company,
 * category and vendor counts more than 35 hours old, the filter audit was
 * dark, and the aged tail was never swept. This heartbeat stayed at its usual
 * 'degraded' the whole time, because it read none of the rows the tail
 * writes. These are the three it now reads, as pure decisions over rows the
 * caller fetched:
 *
 *   job_board_refresh_head  refresh_head.v.refreshedAt older than 3 h. The
 *                           tail writes it once per pass, and a pass takes
 *                           about 50 minutes.
 *   job_board_filter_audit  filter_audit.updated_at older than 12 h. The
 *                           tail kicks the audit when it is 6 h old.
 *   job_board_pass_end      a pass_end row whose startedAt is more than 30
 *                           minutes old with no doneAt at or after it: a tail
 *                           that started and never finished. slice_trace keeps
 *                           only its latest mark and the next chain overwrites
 *                           it, so this receipt is the only place that death
 *                           stays visible.
 *
 * A row that is missing is skipped with its reason, never passed: until the
 * job-board build that writes pass_end is live there is nothing to judge.
 */

export const REFRESH_HEAD_MAX_MIN = 180;
export const FILTER_AUDIT_MAX_MIN = 12 * 60;
export const PASS_END_GRACE_MIN = 30;

export type BoardTailRows = {
  now: number;
  /** refresh_head's v.refreshedAt, read by JSON path. */
  refreshedAt: string | null | undefined;
  /** filter_audit's updated_at. */
  filterAuditAt: string | null | undefined;
  /** pass_end's v. */
  passEnd: { startedAt?: unknown; doneAt?: unknown } | null | undefined;
};

export type BoardTailVerdict =
  | { name: string; skipped: true; reason: string }
  | { name: string; skipped: false; passed: boolean; error?: string };

const ageMin = (now: number, iso: unknown): number | null => {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.round((now - t) / 60_000) : null;
};

export function boardTailChecks(rows: BoardTailRows): BoardTailVerdict[] {
  const out: BoardTailVerdict[] = [];

  const headAge = ageMin(rows.now, rows.refreshedAt);
  if (headAge === null) {
    out.push({ name: "job_board_refresh_head", skipped: true, reason: "refresh_head carries no refreshedAt" });
  } else {
    const stale = headAge > REFRESH_HEAD_MAX_MIN;
    out.push({
      name: "job_board_refresh_head",
      skipped: false,
      passed: !stale,
      ...(stale ? { error: `the board's served counts are ${Math.round(headAge / 60)}h old (refresh_head.refreshedAt ${rows.refreshedAt}; ${REFRESH_HEAD_MAX_MIN / 60}h bound): the pass-end tail is not reaching its refresh write` } : {}),
    });
  }

  const auditAge = ageMin(rows.now, rows.filterAuditAt);
  if (auditAge === null) {
    out.push({ name: "job_board_filter_audit", skipped: true, reason: "filter_audit row missing" });
  } else {
    const stale = auditAge > FILTER_AUDIT_MAX_MIN;
    out.push({
      name: "job_board_filter_audit",
      skipped: false,
      passed: !stale,
      ...(stale ? { error: `the board's filter audit last ran ${Math.round(auditAge / 60)}h ago (${FILTER_AUDIT_MAX_MIN / 60}h bound): the pass-end tail kicks it every 6h` } : {}),
    });
  }

  const pe = rows.passEnd;
  const startAge = ageMin(rows.now, pe?.startedAt);
  if (!pe || startAge === null) {
    out.push({ name: "job_board_pass_end", skipped: true, reason: "pass_end row missing (written by job-board .92 and later)" });
  } else {
    const started = Date.parse(String(pe.startedAt));
    const done = typeof pe.doneAt === "string" ? Date.parse(pe.doneAt) : NaN;
    const finished = Number.isFinite(done) && done >= started;
    const dead = !finished && startAge > PASS_END_GRACE_MIN;
    out.push({
      name: "job_board_pass_end",
      skipped: false,
      passed: !dead,
      ...(dead ? { error: `the pass-end tail started ${startAge} min ago (${String(pe.startedAt)}) and never finished: refresh, the kicks or the freshness sweep died; check job-board logs for 'pass-end tail'` } : {}),
    });
  }
  return out;
}
