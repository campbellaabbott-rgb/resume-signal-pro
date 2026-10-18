/**
 * THE SCANS A VISITOR RAN BEFORE THEY HAD AN ACCOUNT, BROUGHT INTO IT
 * (S12-025, plan CP-H).
 *
 * WHAT WAS WRONG. The free report says "don't lose this score: create a free
 * account", and the account then imported only each scan's score and
 * industry, under ONE flag per browser: the fix checklist the report built was
 * dropped, a second person signing up on the same browser imported nothing,
 * and an account that already held one scan never received the rest.
 *
 * WHAT HOLDS NOW. The import runs once per ACCOUNT (its own flag), brings
 * each local scan's checklist as the scan's fix plan (with what was already
 * ticked), its red-flag count and the job it was matched to, and skips any
 * scan the account already holds (the same second). A failed insert sets no
 * flag, so the next visit tries again. The résumé text itself is never in the
 * local history, so nothing of it is uploaded here.
 */
import type { ScanHistory, ScanHistoryEntry } from "@/hooks/use-scan-history";

/** The local history's key (src/hooks/use-scan-history.ts). */
export const LOCAL_HISTORY_KEY = "rb_scan_history";
/** Once per account, never once per browser. */
export const importFlagKey = (userId: string) => `scan_history_imported:${userId}`;
const MAX_IMPORT = 25;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

const second = (iso: string | number | undefined | null): number => {
  const ms = typeof iso === "number" ? iso : Date.parse(String(iso ?? ""));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN;
};

/** One local scan as the user_scans row the account keeps. */
export function rowFromLocal(userId: string, e: ScanHistoryEntry): Record<string, unknown> {
  const checklist = Array.isArray(e.checklist) ? e.checklist.filter((c) => c && typeof c.label === "string" && c.label.trim()) : [];
  const job = [e.jobTitle, e.jobCompany].filter((v) => typeof v === "string" && v.trim()).join(" @ ").slice(0, 60);
  const ms = Date.parse(String(e.timestamp ?? ""));
  return {
    user_id: userId,
    ats_score: e.atsScore,
    industry: e.industry ?? null,
    red_flag_count: typeof e.redFlagCount === "number" ? e.redFlagCount : null,
    fix_plan: checklist.length ? checklist.slice(0, 20).map((c) => ({ step: c.label.slice(0, 300), done: c.completed === true })) : null,
    label: job || null,
    created_at: Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString(),
  };
}

/**
 * Bring this browser's local scans into the account, once per account.
 * Answers the scans the page should show (refreshed when anything was added).
 * Never throws.
 */
export async function importLocalHistory<T extends { created_at: string }>(
  db: Db,
  userId: string,
  cloudScans: T[],
  mapRow: (row: never) => T,
): Promise<T[]> {
  try {
    if (!userId || localStorage.getItem(importFlagKey(userId))) return cloudScans;
    const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ScanHistory> | null) : null;
    const entries = Array.isArray(parsed?.entries) ? parsed!.entries! : [];
    const held = new Set(cloudScans.map((s) => second(s.created_at)));
    const rows = entries
      .filter((e) => e && typeof e.atsScore === "number" && !held.has(second(e.timestamp)))
      .slice(0, MAX_IMPORT)
      .map((e) => rowFromLocal(userId, e));
    if (!rows.length) {
      localStorage.setItem(importFlagKey(userId), "1");
      return cloudScans;
    }
    const { error } = await db.from("user_scans").insert(rows);
    if (error) return cloudScans; // no flag: the next visit tries again
    localStorage.setItem(importFlagKey(userId), "1");
    const refreshed = await db.from("user_scans").select("*").order("created_at", { ascending: false }).limit(50);
    const list = (refreshed?.data ?? null) as never[] | null;
    return list ? list.map(mapRow) : cloudScans;
  } catch (e) {
    console.warn("[Account] history import skipped:", e);
    return cloudScans;
  }
}
