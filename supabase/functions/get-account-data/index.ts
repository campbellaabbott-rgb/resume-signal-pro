// deploy-stamp: 2026-10-11T17:00Z
// Account data for the signed-in user: scan credits, orders and passes.
// Credits and one-off purchases are keyed by email in service-role tables, so
// this function verifies the caller's website session and reads on their
// behalf. verify_jwt stays at the default (true).
//
// AN ADDRESS ON THE SESSION IS NOT PROOF (review of claude/w1-scan-ai,
// 2026-10-05). Sign-ups are auto-confirmed, so anybody can sign up as a
// buyer's address and hold a session for it. So:
//   - credits: what the account's user id claimed, plus the address's pool
//     ONLY when the account has proven that mailbox;
//   - orders by address: only for a proven mailbox, with mailboxProven false
//     so the page can say why;
//   - the account's Agent Passes and Pro grants, by the verified user id.
//
// A PROOF RECORDED ONCE KEEPS COUNTING (S12-002, plan CP-047). The only proof
// this read accepted was a Google sign-in made in THIS session, and no Google
// button existed, so every account saw an empty Purchases box and copy telling
// it to "sign in with Google". It now reads _shared/account-proof.ts: a
// provider sign-in, confirmation once required, or R1's account_mailbox_proofs
// row written when a fresh emailed code proved the address.
//
// ORDERS, NOT JUST NAMES (plan CP-022, CP-050). Each row now says what it is,
// when it was bought, its status (preparing, ready, needs your résumé,
// couldn't be made, refunded, included with Pro), the amount when we hold it,
// and the Stripe session the page links to. A one-off bought while signed in
// is joined by its checkout_buyers row when that table exists (the checkout
// writes it), with no proof needed.
//
// A WEBSITE SESSION ONLY (plan CP-J): a token minted for a connected app is
// refused (_shared/website-session.ts).
//
// THE ACCOUNT GUARD AS A BACKSTOP (plan CP-H). The site asks auth-signed-in
// to run R1's guard once per sign-in; when that call failed (a network drop,
// a 503), a fresh code sign-in left no proof and the account page showed no
// orders by the address. While the account's address is unproven and the
// session's newest sign-in is an emailed code, link or provider sign-in made
// in the last 15 minutes, this read runs the same guard
// (_shared/mailbox-guard.ts): it records the proof and clears a password set
// before it exactly as auth-signed-in would, once per session (the guard's
// per-session claim and the proof row's key keep a concurrent run single),
// and says passwordCleared so the page can tell the person.
//
// HOW THE ADDRESS WAS PROVEN, AND WHEN (Account UX spec 6, Security). A proven
// address now comes with mailboxProof {how, at}: from R1's proof row (an
// emailed code, an emailed link, a password reset, a provider sign-in or a
// confirmation, at the sign-in that proved it), else from the provider
// identity or the confirmation that proved it by the session rule. A failed
// read of the row says nothing (null) rather than guess.
//
// A PRO INCLUSION IS ONE ORDER (S14X-108). analyze-resume writes a delivered
// row and the saved pointer under pro_<grant id> when a grant runs, and this
// read also listed the grant itself as "grant:<id>" with no link, so a used
// inclusion showed twice. Each of the account's grants is now one order whose
// reference is pro_<grant id> (the one /success and account-order accept): the
// run's status when it has run, refunded when revoked, else included. The
// run's rows are read by that reference, since the grant is the account's by
// its user id; a pro_ row of a grant the account does not hold is not listed.
//
// THE STATUSES THE WRITERS STORE (S14X-221). stripe-webhook, analyze-resume and
// retry-failed-deliveries store payment_received, content_generated,
// email_failed, generation_failed, delivered and refunded/refund_due; the old
// rule read failed/permanently_failed/expired, which none of them writes, so a
// dead order read "Preparing" forever and an un-run Full Analysis whose mail
// failed read "Ready". orderStatusOf now reads what they store, and a product
// the buyer runs on its own page after paying reads open_to_run until it has.
//
// AN AGENT PASS IS SHOWN WHERE PASSES ARE (S14X-223). A granted pass's delivery
// (delivered) leaves the orders list, as the plans do; the passes list shows
// it. A pass whose grant failed (money taken, no pass) stays, as failed.
//
// THE SERVER'S SHARE OF "DOWNLOAD ALL MY DATA" (S14X-100). POST
// {action:"export"} answers serverRecords: the rows only the service role can
// read, by the account's user id and, only once the address is proven, by
// that address. It is the same table set account_erase_personal_data deletes,
// so what deleting the account removes, the download shows. Each table is
// read a page at a time; a table that fails is named {error}, never an empty
// list; an api key is listed by its prefix, never its hash.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { accountProvenEmail } from "../_shared/account-proof.ts";
import { FRESH_SESSION_MS, GUARD_METHODS, type GuardAdmin, newestSignIn, runMailboxGuard, sessionPasswordRotator } from "../_shared/mailbox-guard.ts";
import type { MailboxEnv } from "../_shared/mailbox-proof.ts";
import { isAuthUserId, scanCreditBalance, type CreditDb } from "../_shared/scan-credits.ts";
import { requireWebsiteSession } from "../_shared/website-session.ts";

// Provable from outside: every response, the CORS preflight included, carries
// this in x-fn-build. It imports _shared/mailbox-proof.ts, which R1 stamped
// 2026-10-14.1, so this build sorts after that day.
// 2026-10-14.25 (wave 4 round 2): the account proof rule, orders with status,
// amount and link, a website session only, and the account guard as a
// backstop for a fresh sign-in the guard never answered; how and when the
// address was proven.
// 2026-10-14.29 (wave 4 round 2 integration): carries account-compliance's
// 2026-10-14.25 and payments-delivery's 2026-10-14.22 (_shared/scan-credits.ts
// lists a claimed purchase only for the account that claimed it).
// 2026-10-14.30 (wave 4 round 2 fixes): a plan is not an order (Pro and the
// agent plan leave the orders list), and an order's price carries the currency
// the buyer paid in, or no price.
// 2026-11-09.1 (cost wave, lane ci-edge, cost audit 2026-11-08 Do first #10): the CORS answer says Access-Control-Max-Age 7200, so a browser asks the preflight once per two hours instead of before every call.
// Also (Worth doing, small sequential hops): the checkout_buyers read starts with the mailbox proof, right after the session is accepted, instead of after the proof and the proof row.
// 2026-11-12.1 (bug round of 2026-11-08, part A, account lane, S14X-108, S14X-221, S14X-223, S14X-100; auth-signin lane, S14X-228, through the shared mailbox guard): each order is listed once under the reference it opens by, statuses are the ones the writers store, a granted agent product is no order, the export holds what only the server can read, and proving the address revokes keys made before it.
const FN_BUILD = "get-account-data.2026-11-12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Max-Age": "7200",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export type OrderStatus = "preparing" | "ready" | "needs_resume" | "failed" | "refunded" | "included" | "open_to_run";

export type AccountOrder = {
  /** The Stripe session for a one-off; the grant id for a Pro inclusion. */
  id: string;
  sessionId: string | null;
  product: string;
  productType: string | null;
  date: string;
  status: OrderStatus;
  amountCents: number | null;
  currency: string | null;
};

type DeliveryRow = {
  stripe_session_id: string; product_name?: string | null; product_type?: string | null; status?: string | null;
  amount_cents?: number | null; created_at: string; payment_completed_at?: string | null;
  generation_error?: string | null; last_retry_error?: string | null; metadata?: Record<string, unknown> | null;
  retry_count?: number | null; max_retries?: number | null;
};

/**
 * Subscriptions are plans, not orders: their delivery row is the entitlement,
 * with no receipt on the session, no saved copy and no page to open. The plan
 * card shows them.
 */
export const PLAN_PRODUCT_TYPES: ReadonlySet<string> = new Set(["pro_subscription", "apply_agent"]);

/** A granted Agent Pass is listed with the passes, not as an order. */
const PASS_PRODUCT_TYPE = "agent_pass";

/** The reference a Pro inclusion is opened by (/success, account-order). */
export const proReference = (grantId: string) => `pro_${grantId}`;

/** A three-letter currency code, lower case, or null. */
export function currencyCodeOf(v: unknown): string | null {
  return typeof v === "string" && /^[a-z]{3}$/i.test(v.trim()) ? v.trim().toLowerCase() : null;
}
type ContentRow = { stripe_session_id?: string | null; product_name?: string | null; product_type?: string | null; created_at: string };
type GrantRow = { id: string; product_name?: string | null; product_type?: string | null; created_at: string; revoked_at?: string | null };

/** How the account's address was proven, as the Security card says it. */
export type ProofHow = "code" | "link" | "reset" | "provider" | "confirmation";
export type MailboxProofSummary = { how: ProofHow; at: string | null };

/** account_mailbox_proofs.method, as the card words it. */
const PROOF_HOW: Record<string, ProofHow> = { otp: "code", magiclink: "link", recovery: "reset", oauth: "provider", email_confirm: "confirmation" };
const isoOrNull = (v: unknown): string | null => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null);

type ProofUser = {
  email_confirmed_at?: unknown;
  identities?: Array<{ provider?: unknown; created_at?: unknown; identity_data?: { email?: unknown } | null; email?: unknown }> | null;
};

/**
 * How a PROVEN address was proven, and when. The proof row decides when there
 * is one; otherwise the session rule proved it, by a Google or Apple identity
 * for that address or by a confirmation. Called only for a proven address.
 */
export function proofSummaryOf(
  row: { method?: unknown; amr_at?: unknown; created_at?: unknown } | null | undefined,
  user: ProofUser | null | undefined,
  provenEmail: string,
): MailboxProofSummary {
  const how = row && typeof row.method === "string" ? PROOF_HOW[row.method] : undefined;
  if (how) return { how, at: isoOrNull(row?.amr_at) ?? isoOrNull(row?.created_at) };
  const address = provenEmail.trim().toLowerCase();
  const identity = (Array.isArray(user?.identities) ? user!.identities! : []).find((i) =>
    (i?.provider === "google" || i?.provider === "apple")
    && String(i?.identity_data?.email ?? i?.email ?? "").trim().toLowerCase() === address);
  if (identity) return { how: "provider", at: isoOrNull(identity.created_at) };
  return { how: "confirmation", at: isoOrNull(user?.email_confirmed_at) };
}

const RESUME_MISSING = /r[eé]sum[eé][^.]{0,40}(expired|linked|missing|required|gone)|no r[eé]sum[eé]/i;

/**
 * Products the buyer runs on their own page after paying (the Full Analysis,
 * both Freelance Boost tiers): the payment is the delivery, and stripe-webhook
 * parks the row at payment_received until the page runs it.
 */
const RUNS_ON_ITS_PAGE: ReadonlySet<string> = new Set(["full_analysis", "freelance_boost", "freelance_transition_pro"]);
/** generation_failed reasons that wait on the buyer, as retry-failed-deliveries writes them. */
const WAITS_ON_THE_BUYER = /^(resume_missing|resume_expired|job_posting_required):/i;
/** generation_failed reasons no retry will ever make (stripe-webhook). */
const NEVER_MADE = /^(undeliverable_retired|agent_pass_grant):/i;

/** A delivery row's status, as the buyer reads it, from the statuses the writers store. */
export function orderStatusOf(
  d: Pick<DeliveryRow, "status" | "product_type" | "generation_error" | "last_retry_error" | "retry_count" | "max_retries">,
  hasContent: boolean,
): OrderStatus {
  const s = String(d.status ?? "").toLowerCase();
  const why = `${d.generation_error ?? ""} ${d.last_retry_error ?? ""}`;
  if (s === "refunded" || s === "refund_due") return "refunded";
  if (hasContent || s === "delivered" || s === "content_generated" || s === "generated") return "ready";
  const runsOnItsPage = RUNS_ON_ITS_PAGE.has(String(d.product_type ?? "").toLowerCase());
  if (s === "email_failed") return runsOnItsPage ? "open_to_run" : "ready";
  if (s === "payment_received" && runsOnItsPage) return "open_to_run";
  if (s === "generation_failed") {
    const reason = String(d.generation_error ?? "").trim();
    if (WAITS_ON_THE_BUYER.test(reason) || RESUME_MISSING.test(why)) return "needs_resume";
    const cap = typeof d.max_retries === "number" ? d.max_retries : null;
    const tries = typeof d.retry_count === "number" ? d.retry_count : 0;
    if (NEVER_MADE.test(reason) || cap === 0 || (cap !== null && tries >= cap)) return "failed";
    return "preparing";
  }
  // Names no writer stores today, kept for rows written before them.
  if (s === "failed" || s === "permanently_failed" || s === "expired") {
    return RESUME_MISSING.test(why) ? "needs_resume" : "failed";
  }
  return "preparing";
}

/**
 * May the guard act for this session at all? Only when its newest sign-in is
 * one the guard acts on, made within the guard's own freshness window: a
 * password session, or one older than 15 minutes, never reaches it.
 */
export function guardMayAct(jwt: string, now = Date.now()): boolean {
  const newest = newestSignIn(jwt);
  return !!newest && GUARD_METHODS.has(newest.method) && newest.atMs != null && now - newest.atMs <= FRESH_SESSION_MS;
}

/** A read that found the table missing is no rows; any other failure is an error. */
const missingTable = (e: unknown) => {
  const code = String((e as { code?: unknown } | null)?.code ?? "");
  return code === "42P01" || code === "PGRST205" || /does not exist|schema cache/i.test(String((e as { message?: unknown } | null)?.message ?? ""));
};

/** What one table gives the export: its rows, or that it could not be read. */
export type ExportRows = Array<Record<string, unknown>> | { error: string };
type Row = Record<string, unknown>;
type PageQuery = { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }> };

/** A page of the export, as the browser half (src/lib/account-export.ts) reads its tables. */
export const EXPORT_PAGE = 1000;
const EXPORT_MAX_PAGES = 10;
/** A stored credential is never exported, even hashed. */
const CREDENTIAL_FIELD = /hash|token/i;
/** An api key is exported by what identifies it to its owner. */
const API_KEY_COLS = "id, key_prefix, name, tier, rate_per_min, daily_quota, created_at, last_used_at, revoked_at";

const withoutCredentials = (row: Row): Row => Object.fromEntries(Object.entries(row).filter(([k]) => !CREDENTIAL_FIELD.test(k)));

/** Every page of one read; a missing table is no rows, any other failure names itself. */
async function readEveryPage(make: () => PageQuery): Promise<ExportRows> {
  const out: Row[] = [];
  for (let page = 0; page < EXPORT_MAX_PAGES; page++) {
    const { data, error } = await make().range(page * EXPORT_PAGE, (page + 1) * EXPORT_PAGE - 1);
    if (error) return missingTable(error) ? out : { error: "could not be read" };
    const rows = (Array.isArray(data) ? data : []) as Row[];
    out.push(...rows.map(withoutCredentials));
    if (rows.length < EXPORT_PAGE) break;
  }
  return out;
}

/** One table's rows from several reads, each row once; any failed read fails the table. */
function unionRows(key: string, ...parts: ExportRows[]): ExportRows {
  const failed = parts.find((p) => !Array.isArray(p));
  if (failed) return failed;
  const rows = new Map<string, Row>();
  for (const part of parts as Row[][]) for (const r of part) rows.set(r[key] == null ? JSON.stringify(r) : String(r[key]), r);
  return [...rows.values()];
}

const shareIdOf = (content: unknown): string | null => {
  const id = content && typeof content === "object" ? (content as { shareId?: unknown }).shareId : null;
  return typeof id === "string" && id.trim() && id.length <= 200 ? id.trim() : null;
};

type ServiceDb = { from: (table: string) => { select: (cols: string) => { eq: (c: string, v: string) => PageQuery; in: (c: string, v: string[]) => PageQuery } } };

/**
 * The rows "Download all my data" cannot read from the browser: the same
 * tables account_erase_personal_data deletes, by the account's user id and,
 * only for a proven address, by that address.
 */
export async function serverRecordsOf(db: ServiceDb, userId: string, provenEmail: string | null): Promise<Record<string, ExportRows>> {
  const read = (table: string, cols: string, col: string, val: string) => readEveryPage(() => db.from(table).select(cols).eq(col, val));
  const byAddress = (table: string, cols: string, col: string): Promise<ExportRows> => (provenEmail ? read(table, cols, col, provenEmail) : Promise.resolve([]));
  const readIn = async (table: string, col: string, vals: string[], key: string): Promise<ExportRows> => {
    const parts: ExportRows[] = [];
    for (let i = 0; i < vals.length; i += 100) parts.push(await readEveryPage(() => db.from(table).select("*").in(col, vals.slice(i, i + 100))));
    return unionRows(key, ...parts);
  };

  const [grantsById, grantsByAddress, keysById, keysByAddress, apiKeyRequests, mailboxProofs, writingToolUses, checkoutBuyers, marketPulse, freeScanLeads] = await Promise.all([
    read("pro_grants", "*", "user_id", userId),
    byAddress("pro_grants", "*", "email"),
    read("api_keys", API_KEY_COLS, "user_id", userId),
    byAddress("api_keys", API_KEY_COLS, "owner_email"),
    byAddress("api_key_requests", "*", "email"),
    read("account_mailbox_proofs", "*", "user_id", userId),
    read("writing_tool_uses", "*", "user_id", userId),
    read("checkout_buyers", "*", "user_id", userId),
    byAddress("market_pulse_subscribers", "*", "email"),
    byAddress("free_scan_leads", "*", "email"),
  ]);
  const proGrants = unionRows("id", grantsById, grantsByAddress);

  // The documents made for the account's purchases: its bound checkouts, its
  // grants' references and, once proven, its address. Without the grants or
  // the bound checkouts the list would be short without saying so.
  let purchasedContent: ExportRows;
  let fullAnalyses: ExportRows = [];
  if (!Array.isArray(proGrants) || !Array.isArray(checkoutBuyers)) {
    purchasedContent = { error: "could not be read" };
    fullAnalyses = { error: "could not be read" };
  } else {
    const sessions = [...new Set([
      ...checkoutBuyers.map((b) => b.stripe_session_id).filter((v): v is string => typeof v === "string" && !!v),
      ...proGrants.map((g) => proReference(String(g.id))),
    ])];
    purchasedContent = unionRows("id",
      sessions.length ? await readIn("purchased_content", "stripe_session_id", sessions, "id") : [],
      await byAddress("purchased_content", "*", "customer_email"));
    if (Array.isArray(purchasedContent)) {
      const shares = [...new Set(purchasedContent.map((c) => shareIdOf(c.generated_content)).filter((v): v is string => !!v))];
      if (shares.length) fullAnalyses = await readIn("resume_analyses", "share_id", shares, "share_id");
    } else {
      fullAnalyses = { error: "could not be read" };
    }
  }

  return {
    purchasedContent,
    fullAnalyses,
    proGrants,
    apiKeys: unionRows("id", keysById, keysByAddress),
    apiKeyRequests,
    mailboxProofs,
    writingToolUses,
    checkoutBuyers,
    marketPulseSubscriptions: marketPulse,
    freeScanLeads,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", { auth: { persistSession: false } });
    const session = await requireWebsiteSession(req, { auth: anon.auth, headers: corsHeaders });
    if (session instanceof Response) return session;
    const user = session.user;
    if (!user?.email || !isAuthUserId(user.id)) return json({ error: "Not authenticated" }, 401);
    const asked = await req.json().catch(() => null) as { action?: unknown } | null;
    const wantsExport = asked?.action === "export";

    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    const proofEnv: MailboxEnv = {
      db: service,
      confirmedSince: Deno.env.get("EMAIL_CONFIRMED_SINCE") ?? null,
      supabaseUrl: url,
      anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    };
    // A one-off bought while signed in: its session is bound to this account.
    // It depends on the account alone, so it is asked for now, alongside the
    // mailbox proof below, instead of after it; it is judged where it was.
    const boundRead = Promise.resolve(service.from("checkout_buyers").select("stripe_session_id").eq("user_id", user.id).limit(100));
    // A request that fails before the judgement below still answers 500 from
    // the catch at the bottom; this only keeps that early rejection handled.
    boundRead.catch(() => {});
    let provenEmail = await accountProvenEmail(user, session.jwt, proofEnv);

    // The guard as a backstop (see the header): a fresh mailbox sign-in the
    // guard never answered is proven here. Its failure is never this read's.
    let passwordCleared = false;
    let signedOut = false;
    if (!provenEmail && guardMayAct(session.jwt)) {
      try {
        const guard = await runMailboxGuard({
          admin: service as unknown as GuardAdmin,
          rotateAsSession: sessionPasswordRotator(url, Deno.env.get("SUPABASE_ANON_KEY") ?? ""),
          log: (step, details) => console.log(`[GET-ACCOUNT-DATA] guard: ${step}`, details ? JSON.stringify(details) : ""),
        }, session);
        passwordCleared = guard.body.passwordCleared === true;
        signedOut = guard.body.signedOut === true;
        if (guard.body.proven) provenEmail = String(user.email).trim().toLowerCase();
      } catch (e) {
        console.warn("[GET-ACCOUNT-DATA] guard backstop threw:", e instanceof Error ? e.message : String(e));
      }
    }

    // The server's share of "Download all my data": nothing else is read.
    if (wantsExport) {
      const serverRecords = await serverRecordsOf(service as unknown as ServiceDb, user.id, provenEmail);
      return json({ serverRecords, mailboxProven: !!provenEmail });
    }

    // How the proven address was proven, and when (the Security card).
    let mailboxProof: MailboxProofSummary | null = null;
    if (provenEmail) {
      try {
        const proofRow = await service.from("account_mailbox_proofs")
          .select("method, amr_at, created_at")
          .eq("user_id", user.id)
          .eq("email", provenEmail)
          .maybeSingle();
        mailboxProof = proofRow.error ? null : proofSummaryOf(proofRow.data as Record<string, unknown> | null, user as ProofUser, provenEmail);
      } catch {
        mailboxProof = null;
      }
    }

    const boundRes = await boundRead;
    if (boundRes.error && !missingTable(boundRes.error)) throw new Error(`checkout_buyers: ${String(boundRes.error.message ?? "").slice(0, 120)}`);
    const boundSessions = ((boundRes.data ?? []) as Array<{ stripe_session_id?: unknown }>)
      .map((r) => r.stripe_session_id).filter((v): v is string => typeof v === "string" && !!v);

    const DELIVERY_COLS = "stripe_session_id, product_name, product_type, status, amount_cents, created_at, payment_completed_at, generation_error, last_retry_error, retry_count, max_retries, metadata";
    const CONTENT_COLS = "stripe_session_id, product_name, product_type, created_at";
    const none = Promise.resolve({ data: [] as unknown[], error: null });
    const [credits, deliveriesByAddress, deliveriesBound, contentByAddress, contentBound, grantsRes, passesRes] = await Promise.all([
      scanCreditBalance(service as unknown as CreditDb, { provenEmail, userId: user.id, sessionHashes: [] }),
      provenEmail ? service.from("product_deliveries").select(DELIVERY_COLS).eq("customer_email", provenEmail).order("created_at", { ascending: false }).limit(50) : none,
      boundSessions.length ? service.from("product_deliveries").select(DELIVERY_COLS).in("stripe_session_id", boundSessions).limit(100) : none,
      provenEmail ? service.from("purchased_content").select(CONTENT_COLS).eq("customer_email", provenEmail).order("created_at", { ascending: false }).limit(50) : none,
      boundSessions.length ? service.from("purchased_content").select(CONTENT_COLS).in("stripe_session_id", boundSessions).limit(100) : none,
      service.from("pro_grants").select("id, product_name, product_type, created_at, revoked_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
      service.from("agent_passes")
        .select("purchased_at, shelf_expires_at, activated_at, expires_at, closed_at")
        .eq("user_id", user.id)
        .order("purchased_at", { ascending: false })
        .limit(20),
    ]);
    for (const r of [deliveriesByAddress, deliveriesBound, contentByAddress, contentBound, grantsRes] as Array<{ error?: unknown }>) {
      if (r.error && !missingTable(r.error)) throw new Error(`orders read: ${String((r.error as { message?: string }).message ?? "").slice(0, 120)}`);
    }

    // The account's Pro grants, each listed once under its pro_<id> reference.
    // A grant that ran has its rows under that reference; those not already
    // read by the address are read by the reference, since the grant is the
    // account's by its user id.
    const grants = (grantsRes.data ?? []) as GrantRow[];
    const grantRefs = new Set(grants.map((g) => proReference(g.id)));
    const fetchedDeliveries = [...((deliveriesByAddress.data ?? []) as DeliveryRow[]), ...((deliveriesBound.data ?? []) as DeliveryRow[])];
    const fetchedContent = [...((contentByAddress.data ?? []) as ContentRow[]), ...((contentBound.data ?? []) as ContentRow[])];
    const unread = [...grantRefs].filter((ref) => !fetchedDeliveries.some((d) => d.stripe_session_id === ref));
    if (unread.length) {
      const refs = unread.slice(0, 100);
      const [runs, saved] = await Promise.all([
        service.from("product_deliveries").select(DELIVERY_COLS).in("stripe_session_id", refs).limit(100),
        service.from("purchased_content").select(CONTENT_COLS).in("stripe_session_id", refs).limit(100),
      ]);
      for (const r of [runs, saved] as Array<{ error?: unknown }>) {
        if (r.error && !missingTable(r.error)) throw new Error(`grant runs read: ${String((r.error as { message?: string }).message ?? "").slice(0, 120)}`);
      }
      fetchedDeliveries.push(...((runs.data ?? []) as DeliveryRow[]));
      fetchedContent.push(...((saved.data ?? []) as ContentRow[]));
    }
    // A pro_ reference is an order only through a grant this account holds.
    const isGrantRun = (sid: string | null | undefined) => typeof sid === "string" && sid.startsWith("pro_");
    const grantDelivery = new Map<string, DeliveryRow>();
    const grantContent = new Map<string, ContentRow>();

    // One row per Stripe session: the delivery row decides the status, the
    // saved copy proves it is ready.
    const contentBySession = new Map<string, ContentRow>();
    const orphanContent: ContentRow[] = [];
    for (const c of fetchedContent) {
      if (isGrantRun(c.stripe_session_id)) {
        if (grantRefs.has(c.stripe_session_id!)) grantContent.set(c.stripe_session_id!, c);
      } else if (c.stripe_session_id) contentBySession.set(c.stripe_session_id, c);
      else orphanContent.push(c);
    }
    const allDeliveries: DeliveryRow[] = [];
    for (const d of fetchedDeliveries) {
      if (!isGrantRun(d.stripe_session_id)) allDeliveries.push(d);
      else if (grantRefs.has(d.stripe_session_id) && !grantDelivery.has(d.stripe_session_id)) grantDelivery.set(d.stripe_session_id, d);
    }
    // Plans, and a granted Agent Pass, are shown on their own cards.
    const planSessions = new Set(allDeliveries.filter((d) =>
      PLAN_PRODUCT_TYPES.has(String(d.product_type ?? ""))
      || (d.product_type === PASS_PRODUCT_TYPE && orderStatusOf(d, false) === "ready")).map((d) => d.stripe_session_id));
    const deliveries = allDeliveries.filter((d) => !planSessions.has(d.stripe_session_id));
    // The amount is Stripe's amount_total in the buyer's currency: the
    // checkout's own record of it decides, then the delivery row's; with
    // neither, no price is shown rather than a guessed one.
    const currencyBySession = new Map<string, string>();
    const priced = [...new Set(deliveries.filter((d) => typeof d.amount_cents === "number" && d.stripe_session_id).map((d) => d.stripe_session_id))];
    if (priced.length) {
      const starts = await service.from("checkout_starts").select("stripe_session_id, currency").in("stripe_session_id", priced.slice(0, 150));
      for (const r of ((starts.error ? [] : starts.data) ?? []) as Array<{ stripe_session_id?: unknown; currency?: unknown }>) {
        const code = currencyCodeOf(r.currency);
        if (code && typeof r.stripe_session_id === "string") currencyBySession.set(r.stripe_session_id, code);
      }
    }
    const orders = new Map<string, AccountOrder>();
    for (const d of deliveries) {
      if (!d.stripe_session_id || orders.has(d.stripe_session_id)) continue;
      const c = contentBySession.get(d.stripe_session_id);
      const amount = typeof d.amount_cents === "number" ? d.amount_cents : null;
      const currency = amount === null ? null : currencyBySession.get(d.stripe_session_id) ?? currencyCodeOf(d.metadata?.currency);
      orders.set(d.stripe_session_id, {
        id: d.stripe_session_id,
        sessionId: d.stripe_session_id,
        product: d.product_name ?? c?.product_name ?? d.product_type ?? "Purchase",
        productType: d.product_type ?? c?.product_type ?? null,
        date: d.payment_completed_at ?? d.created_at,
        status: orderStatusOf(d, !!c),
        amountCents: currency ? amount : null,
        currency,
      });
    }
    for (const [sid, c] of contentBySession) {
      if (orders.has(sid) || planSessions.has(sid) || PLAN_PRODUCT_TYPES.has(String(c.product_type ?? ""))) continue;
      orders.set(sid, { id: sid, sessionId: sid, product: c.product_name ?? c.product_type ?? "Purchase", productType: c.product_type ?? null, date: c.created_at, status: "ready", amountCents: null, currency: null });
    }
    // A grant not yet run has no purchase behind it in the plain list below.
    const notRun = new Set<string>();
    for (const g of grants) {
      const ref = proReference(g.id);
      const run = grantDelivery.get(ref);
      const saved = grantContent.get(ref);
      const status: OrderStatus = g.revoked_at ? "refunded" : run ? orderStatusOf(run, !!saved) : saved ? "ready" : "included";
      if (!run && !saved) notRun.add(ref);
      orders.set(ref, {
        id: ref, sessionId: ref,
        product: g.product_name ?? run?.product_name ?? saved?.product_name ?? g.product_type ?? "Included with Pro",
        productType: g.product_type ?? run?.product_type ?? saved?.product_type ?? null,
        date: g.created_at, status, amountCents: 0, currency: null,
      });
    }
    const orderList = [...orders.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 100);

    // The plain list the export and older pages read.
    const purchases = [
      ...orderList.filter((o) => o.sessionId && !notRun.has(o.id)).map((o) => ({ product: o.product, date: o.date })),
      ...orphanContent.map((c) => ({ product: c.product_name ?? c.product_type ?? "Purchase", date: c.created_at })),
    ];

    // State from the timestamps, as agent-pass-status derives it (its lazy
    // close may not have run yet).
    const now = Date.now();
    const passes = ((passesRes as { data?: unknown[] | null }).data ?? []).map((row) => {
      const p = row as { purchased_at: string; shelf_expires_at?: string | null; activated_at?: string | null; expires_at?: string | null; closed_at?: string | null };
      const ended = !!p.closed_at
        || (p.activated_at ? !!p.expires_at && Date.parse(p.expires_at) <= now : !!p.shelf_expires_at && Date.parse(p.shelf_expires_at) <= now);
      return { date: p.purchased_at, state: ended ? "closed" : p.activated_at ? "live" : "unactivated" };
    });

    return json({
      credits: credits ?? 0, purchases, orders: orderList, passes, mailboxProven: !!provenEmail, mailboxProof,
      ...(passwordCleared ? { passwordCleared: true } : {}),
      ...(signedOut ? { signedOut: true } : {}),
    });
  } catch (e) {
    console.error("[GET-ACCOUNT-DATA] Uncaught:", e instanceof Error ? e.message : String(e));
    return json({ error: "Unexpected error" }, 500);
  }
});
