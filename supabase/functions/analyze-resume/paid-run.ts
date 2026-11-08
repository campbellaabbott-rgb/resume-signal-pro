// THE PAID RUN'S DOORS (hotfix 2026-11-10: H3, H4, M-S14-005, C-S14-010).
//
// Pure helpers analyze-resume calls before it spends anything: which
// purchase reference a request names, the posting and LinkedIn caps (text
// past them is read up to the cap, and the report says so, never refused
// after payment), the one-run-at-a-time lease, and the inputs a purchase was
// bought against, read back from the temporary store by the purchase.
//
// No imports but analysis-parts' budget, so vitest runs them directly and the
// handler tests run them inside the bundle.
import { ANALYSIS_BUDGET_MS } from "./analysis-parts.ts";

// ── Which purchase a request names ─────────────────────────────────────────

/**
 * A Stripe Checkout session id, as checkout_resume_refs accepts one. Loose on
 * purpose: the shape check only keeps junk ("x", a URL, a 10 kB string) away
 * from Stripe. A caller can always invent a well-formed id, so what bounds
 * the Stripe reads is the per-network count taken before each one.
 */
const CHECKOUT_SESSION = /^cs_[A-Za-z0-9_]{1,250}$/;
const PRO_GRANT = /^pro_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export type PurchaseRef =
  | { kind: "checkout"; id: string }
  | { kind: "pro"; id: string; grantId: string };

/** The purchase a request names, or null for anything that cannot be one. */
export function purchaseRefOf(value: unknown): PurchaseRef | null {
  if (typeof value !== "string") return null;
  if (CHECKOUT_SESSION.test(value)) return { kind: "checkout", id: value };
  const pro = PRO_GRANT.exec(value);
  return pro ? { kind: "pro", id: value, grantId: pro[1] } : null;
}

// ── The caps ───────────────────────────────────────────────────────────────

export const MAX_JOB_DESCRIPTION_LENGTH = 20_000;
export const MAX_LINKEDIN_LENGTH = 30_000;

export type Clip = { from: number; to: number };

/**
 * The text cut to `max` characters, never inside a surrogate pair, and what
 * was cut (null when it fitted).
 */
export function clipText(text: string, max: number): { text: string; clip: Clip | null } {
  if (text.length <= max) return { text, clip: null };
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { text: text.slice(0, end), clip: { from: text.length, to: end } };
}

// ── The Stripe reads ───────────────────────────────────────────────────────

/** The rate_limits bucket name analyze-resume counts its Stripe reads under. */
export const STRIPE_READ_COUNTER = "analyze-resume";
/**
 * Stripe reads per caller network per hour. A buyer's page asks once per
 * visit (a delivered analysis is answered from our own rows, with no read),
 * so this leaves room for a household or an office of buyers and none for a
 * loop that would spend the account's shared read limit.
 */
export const STRIPE_READS_PER_NETWORK_PER_HOUR = 30;

// ── One run at a time ──────────────────────────────────────────────────────

export const RUN_LEASE_TABLE = "analysis_run_leases";
/** Past the analysis's own budget plus the delivery after it: a run killed mid-way frees its session by then. */
export const RUN_LEASE_MS = ANALYSIS_BUDGET_MS + 60_000;

/**
 * "claimed": this request makes the analysis. "busy": another request is
 * making it now. "unavailable": the lease could not be read or written (the
 * table not there yet, a database error). The caller goes on without a lease
 * then: the purchase is redeemed once either way, and a buyer is never
 * refused for our bookkeeping.
 */
export type LeaseOutcome = "claimed" | "busy" | "unavailable";

// deno-lint-ignore no-explicit-any
export type LeaseDb = { from: (table: string) => any };

/**
 * Claims the session's run. A lease past its time (a run the platform
 * killed) is taken over; two takers race on the primary key, and one wins.
 */
export async function claimRunLease(
  db: LeaseDb,
  sessionId: string,
  holder: string,
  ttlMs: number = RUN_LEASE_MS,
  now: number = Date.now(),
): Promise<LeaseOutcome> {
  const row = { session_id: sessionId, holder, expires_at: new Date(now + ttlMs).toISOString() };
  try {
    const first = await db.from(RUN_LEASE_TABLE).insert(row);
    if (!first.error) return "claimed";
    if (first.error.code !== "23505") return "unavailable";
    const stale = await db
      .from(RUN_LEASE_TABLE)
      .delete()
      .eq("session_id", sessionId)
      .lt("expires_at", new Date(now).toISOString())
      .select("session_id");
    if (stale.error) return "unavailable";
    if (!Array.isArray(stale.data) || stale.data.length === 0) return "busy";
    const second = await db.from(RUN_LEASE_TABLE).insert(row);
    if (!second.error) return "claimed";
    return second.error.code === "23505" ? "busy" : "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * Whether another request holds a live lease on the session now: read before
 * the Stripe read, so a page asking again while the run works costs no read.
 * False when it cannot tell (the claim before the model call decides then).
 */
export async function runLeaseHeld(db: LeaseDb, sessionId: string, now: number = Date.now()): Promise<boolean> {
  try {
    const { data, error } = await db
      .from(RUN_LEASE_TABLE)
      .select("session_id")
      .eq("session_id", sessionId)
      .gt("expires_at", new Date(now).toISOString())
      .maybeSingle();
    return !error && !!data;
  } catch {
    return false;
  }
}

/** Frees the session for the next request: only this holder's lease is removed. Never throws. */
export async function releaseRunLease(db: LeaseDb, sessionId: string, holder: string): Promise<void> {
  try {
    const { error } = await db.from(RUN_LEASE_TABLE).delete().eq("session_id", sessionId).eq("holder", holder);
    if (error) console.error(`[ANALYZE-RESUME] Could not release the run lease (it lapses on its own): ${error.message}`);
  } catch (e) {
    console.error(`[ANALYZE-RESUME] Could not release the run lease (it lapses on its own): ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── What the purchase was bought against ───────────────────────────────────

export type StoredInputs = { resume: string; linkedIn: string; jobDescription: string };

// deno-lint-ignore no-explicit-any
export type StoreDb = { from: (table: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * The résumé, LinkedIn text and posting stored at checkout, while the store
 * keeps them (24 hours), read through the id create-checkout recorded beside
 * the Stripe session (checkout_resume_refs) or the Pro grant
 * (pro_grants.resume_session_id). Null when none is recorded, the copy has
 * expired, or anything fails: the request is then answered as before.
 */
export async function storedInputsFor(db: StoreDb, ref: PurchaseRef): Promise<StoredInputs | null> {
  try {
    let tempId: unknown = null;
    if (ref.kind === "checkout") {
      const { data, error } = await db.from("checkout_resume_refs").select("resume_session_id").eq("stripe_session_id", ref.id).maybeSingle();
      if (error) return null;
      tempId = data?.resume_session_id;
    } else {
      const { data, error } = await db.from("pro_grants").select("resume_session_id").eq("id", ref.grantId).maybeSingle();
      if (error) return null;
      tempId = data?.resume_session_id;
    }
    if (typeof tempId !== "string" || !UUID.test(tempId)) return null;
    const { data, error } = await db.rpc("get_temp_resume", { p_session_id: tempId.toLowerCase() });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    const resume = text(row?.resume_text);
    if (!resume.trim()) return null;
    return { resume, linkedIn: text(row?.linkedin_text), jobDescription: text(row?.job_description_text) };
  } catch {
    return null;
  }
}

/**
 * Whether the checkout recorded that it was bought against a posting
 * (create-checkout writes hasPosting into its checkout_starts row): true,
 * false, or null when nothing says. It outlives the stored copy, so the page
 * can still ask for the posting after the 24 hours.
 */
export async function checkoutHadPosting(db: StoreDb, ref: PurchaseRef): Promise<boolean | null> {
  if (ref.kind !== "checkout") return null;
  try {
    const { data, error } = await db.from("checkout_starts").select("metadata").eq("stripe_session_id", ref.id).maybeSingle();
    if (error) return null;
    const flag = (data?.metadata as Record<string, unknown> | null | undefined)?.hasPosting;
    return typeof flag === "boolean" ? flag : null;
  } catch {
    return null;
  }
}
