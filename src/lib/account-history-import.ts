/**
 * THE SCANS A VISITOR RAN BEFORE THEY HAD AN ACCOUNT, BROUGHT INTO IT ONLY
 * WHEN THEY SAY SO (S12-025, plan CP-H; wave 4 round 2 review).
 *
 * WHAT WAS WRONG.
 *   - First, the import took only each scan's score and industry under one
 *     flag per browser (S12-025).
 *   - Then it ran once per account, silently, carrying each scan's fix-plan
 *     text and matched job: on a shared computer the next person to sign in
 *     inherited the previous visitor's scans into their account for good (an
 *     anonymous visitor's, or those of an account whose session lapsed without
 *     a deliberate sign-out, which is when R1 clears rb_scan_history).
 *   - And the résumé behind the free report was lost at sign-up: the report's
 *     sign-up link lands on /account, which could only import scores.
 *
 * WHAT HOLDS NOW.
 *   - Nothing is imported until the person asks: /account offers "add the N
 *     scans found in this browser" or "not mine" (localScansToOffer,
 *     importLocalScans, declineLocalScans). Each local scan still carries its
 *     checklist, red-flag count and matched job, and a scan the account
 *     already holds (the same second) is skipped.
 *   - Once one account adds this browser's scans, the browser remembers which
 *     scans were claimed (CLAIMED_KEY), so a second account is never offered
 *     them.
 *   - The résumé the person just scanned is still in this tab
 *     (sessionStorage rb_resume_text, use-session-resume.ts); /account offers
 *     to save it to the account as a résumé version (lastScanResumeToOffer,
 *     saveLastScanResume), an explicit opt-in insert into user_scans, the
 *     only place résumé text is ever stored.
 *   - (Recheck.) That version carries the score of the scan of THAT text
 *     only: the local scan whose resumeFingerprint is the tab's text. The
 *     tab's text is also written by an upload before any scan, the résumé
 *     builder and the premium rewrite, and the newest local score could be
 *     another résumé's; a version saved at 0 (user_scans.ats_score is NOT
 *     NULL) read as the latest score, a drop, and a chart falling to 0. With
 *     no scan of that exact text, nothing is offered.
 */
import { resumeFingerprint, type ScanHistory, type ScanHistoryEntry } from "@/hooks/use-scan-history";

/** The local history's key (src/hooks/use-scan-history.ts). */
export const LOCAL_HISTORY_KEY = "rb_scan_history";
/** This account decided about this browser's scans (added or declined). */
export const importFlagKey = (userId: string) => `scan_history_imported:${userId}`;
/** The scans an account added, entry id to account, so no other account is offered them. */
export const CLAIMED_KEY = "rb_scan_history_claimed";
/** The résumé this tab scanned last (use-session-resume.ts SESSION_KEYS.resumeText). */
export const SESSION_RESUME_KEY = "rb_resume_text";
/** This account saved, or declined, this tab's last scanned résumé. */
export const lastResumeFlagKey = (userId: string) => `rb_last_resume_decided:${userId}`;
const MAX_IMPORT = 25;
const MIN_RESUME_CHARS = 200;
const MAX_RESUME_CHARS = 60_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

const second = (iso: string | number | undefined | null): number => {
  const ms = typeof iso === "number" ? iso : Date.parse(String(iso ?? ""));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN;
};

const read = (store: "local" | "session", key: string): string | null => {
  try {
    return (store === "local" ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
};
const write = (store: "local" | "session", key: string, value: string): void => {
  try {
    (store === "local" ? localStorage : sessionStorage).setItem(key, value);
  } catch {
    /* storage blocked: the offer comes back next visit */
  }
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

const claimed = (): Record<string, string> => {
  try {
    const v = JSON.parse(read("local", CLAIMED_KEY) ?? "null") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, string> : {};
  } catch {
    return {};
  }
};

/**
 * The local scans this account may be offered: none once it decided; never
 * a scan another account added; never one it already holds. Reads only.
 */
export function localScansToOffer(userId: string, cloudScans: Array<{ created_at: string }>): ScanHistoryEntry[] {
  if (!userId || read("local", importFlagKey(userId))) return [];
  let entries: ScanHistoryEntry[] = [];
  try {
    const parsed = JSON.parse(read("local", LOCAL_HISTORY_KEY) ?? "null") as Partial<ScanHistory> | null;
    entries = Array.isArray(parsed?.entries) ? parsed!.entries! : [];
  } catch {
    return [];
  }
  const taken = claimed();
  const held = new Set(cloudScans.map((s) => second(s.created_at)));
  return entries
    .filter((e) => e && typeof e.atsScore === "number" && !(taken[String(e.id)] && taken[String(e.id)] !== userId) && !held.has(second(e.timestamp)))
    .slice(0, MAX_IMPORT);
}

/**
 * Add the offered scans to the account, at the person's request. Answers the
 * scans the page should show (refreshed when anything was added), or null
 * when the insert failed (no flag is set, so the offer stays). Never throws.
 */
export async function importLocalScans<T>(
  db: Db,
  userId: string,
  entries: ScanHistoryEntry[],
  mapRow: (row: never) => T,
): Promise<T[] | null> {
  try {
    if (!userId || !entries.length) return null;
    const { error } = await db.from("user_scans").insert(entries.map((e) => rowFromLocal(userId, e)));
    if (error) return null;
    write("local", importFlagKey(userId), "1");
    const taken = claimed();
    for (const e of entries) taken[String(e.id)] = userId;
    write("local", CLAIMED_KEY, JSON.stringify(taken));
    const refreshed = await db.from("user_scans").select("*").order("created_at", { ascending: false }).limit(50);
    const list = (refreshed?.data ?? null) as never[] | null;
    return list ? list.map(mapRow) : [];
  } catch (e) {
    console.warn("[Account] history import failed:", e);
    return null;
  }
}

/** "Not mine": this account is not offered this browser's scans again. */
export function declineLocalScans(userId: string): void {
  if (userId) write("local", importFlagKey(userId), "1");
}

/** The résumé this tab scanned last and that scan's score: an offer only when it is long enough, a local scan of that exact text scored it, and the account has not decided. */
export function lastScanResumeToOffer(userId: string): { text: string; score: number } | null {
  if (!userId || read("session", lastResumeFlagKey(userId))) return null;
  const text = (read("session", SESSION_RESUME_KEY) ?? "").trim();
  if (text.length < MIN_RESUME_CHARS) return null;
  const score = scoreOfThisText(text);
  return score === null ? null : { text: text.slice(0, MAX_RESUME_CHARS), score };
}

/** Save this tab's last scanned résumé as a résumé version, with its own scan's score, at the person's request. true when it was saved. Never throws. */
export async function saveLastScanResume(db: Db, userId: string, text: string, score: number, label: string): Promise<boolean> {
  try {
    if (!Number.isFinite(score)) return false;
    const { error } = await db.from("user_scans").insert({
      user_id: userId,
      ats_score: score,
      label: label.slice(0, 80),
      resume_text: text.slice(0, MAX_RESUME_CHARS),
    });
    if (error) return false;
    write("session", lastResumeFlagKey(userId), "saved");
    return true;
  } catch {
    return false;
  }
}

/** "No thanks": the offer is not made again in this tab. */
export function declineLastScanResume(userId: string): void {
  if (userId) write("session", lastResumeFlagKey(userId), "declined");
}

/** The score of the newest local scan of exactly this text, or null when none scored it. */
export function scoreOfThisText(text: string): number | null {
  try {
    const fp = resumeFingerprint(text);
    const parsed = JSON.parse(read("local", LOCAL_HISTORY_KEY) ?? "null") as Partial<ScanHistory> | null;
    const entries = (Array.isArray(parsed?.entries) ? parsed!.entries! : [])
      .filter((e) => e && typeof e.atsScore === "number" && Number.isFinite(e.atsScore) && e.resumeFingerprint === fp);
    if (!entries.length) return null;
    const newest = entries.reduce((a, b) => (Date.parse(String(b.timestamp)) > Date.parse(String(a.timestamp)) ? b : a));
    return newest.atsScore;
  } catch {
    return null;
  }
}
