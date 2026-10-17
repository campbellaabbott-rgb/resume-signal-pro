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
// backstop for a fresh sign-in the guard never answered.
const FN_BUILD = "get-account-data.2026-10-14.25";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export type OrderStatus = "preparing" | "ready" | "needs_resume" | "failed" | "refunded" | "included";

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
  generation_error?: string | null; last_retry_error?: string | null;
};
type ContentRow = { stripe_session_id?: string | null; product_name?: string | null; product_type?: string | null; created_at: string };
type GrantRow = { id: string; product_name?: string | null; product_type?: string | null; created_at: string; revoked_at?: string | null };

const RESUME_MISSING = /r[eé]sum[eé][^.]{0,40}(expired|linked|missing|required|gone)|no r[eé]sum[eé]/i;

/** A delivery row's status, as the buyer reads it. */
export function orderStatusOf(d: Pick<DeliveryRow, "status" | "generation_error" | "last_retry_error">, hasContent: boolean): OrderStatus {
  const s = String(d.status ?? "").toLowerCase();
  if (s === "refunded" || s === "refund_due") return "refunded";
  if (hasContent || s === "delivered" || s === "content_generated" || s === "generated" || s === "email_failed") return "ready";
  if (s === "failed" || s === "permanently_failed" || s === "expired") {
    return RESUME_MISSING.test(`${d.generation_error ?? ""} ${d.last_retry_error ?? ""}`) ? "needs_resume" : "failed";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", { auth: { persistSession: false } });
    const session = await requireWebsiteSession(req, { auth: anon.auth, headers: corsHeaders });
    if (session instanceof Response) return session;
    const user = session.user;
    if (!user?.email || !isAuthUserId(user.id)) return json({ error: "Not authenticated" }, 401);

    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    const proofEnv: MailboxEnv = {
      db: service,
      confirmedSince: Deno.env.get("EMAIL_CONFIRMED_SINCE") ?? null,
      supabaseUrl: url,
      anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    };
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

    // A one-off bought while signed in: its session is bound to this account.
    const boundRes = await service.from("checkout_buyers").select("stripe_session_id").eq("user_id", user.id).limit(100);
    if (boundRes.error && !missingTable(boundRes.error)) throw new Error(`checkout_buyers: ${String(boundRes.error.message ?? "").slice(0, 120)}`);
    const boundSessions = ((boundRes.data ?? []) as Array<{ stripe_session_id?: unknown }>)
      .map((r) => r.stripe_session_id).filter((v): v is string => typeof v === "string" && !!v);

    const DELIVERY_COLS = "stripe_session_id, product_name, product_type, status, amount_cents, created_at, payment_completed_at, generation_error, last_retry_error";
    const none = Promise.resolve({ data: [] as unknown[], error: null });
    const [credits, deliveriesByAddress, deliveriesBound, contentByAddress, contentBound, grantsRes, passesRes] = await Promise.all([
      scanCreditBalance(service as unknown as CreditDb, { provenEmail, userId: user.id, sessionHashes: [] }),
      provenEmail ? service.from("product_deliveries").select(DELIVERY_COLS).eq("customer_email", provenEmail).order("created_at", { ascending: false }).limit(50) : none,
      boundSessions.length ? service.from("product_deliveries").select(DELIVERY_COLS).in("stripe_session_id", boundSessions).limit(100) : none,
      provenEmail ? service.from("purchased_content").select("stripe_session_id, product_name, product_type, created_at").eq("customer_email", provenEmail).order("created_at", { ascending: false }).limit(50) : none,
      boundSessions.length ? service.from("purchased_content").select("stripe_session_id, product_name, product_type, created_at").in("stripe_session_id", boundSessions).limit(100) : none,
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

    // One row per Stripe session: the delivery row decides the status, the
    // saved copy proves it is ready.
    const contentBySession = new Map<string, ContentRow>();
    const orphanContent: ContentRow[] = [];
    for (const c of [...((contentByAddress.data ?? []) as ContentRow[]), ...((contentBound.data ?? []) as ContentRow[])]) {
      if (c.stripe_session_id) contentBySession.set(c.stripe_session_id, c);
      else orphanContent.push(c);
    }
    const orders = new Map<string, AccountOrder>();
    for (const d of [...((deliveriesByAddress.data ?? []) as DeliveryRow[]), ...((deliveriesBound.data ?? []) as DeliveryRow[])]) {
      if (!d.stripe_session_id || orders.has(d.stripe_session_id)) continue;
      const c = contentBySession.get(d.stripe_session_id);
      orders.set(d.stripe_session_id, {
        id: d.stripe_session_id,
        sessionId: d.stripe_session_id,
        product: d.product_name ?? c?.product_name ?? d.product_type ?? "Purchase",
        productType: d.product_type ?? c?.product_type ?? null,
        date: d.payment_completed_at ?? d.created_at,
        status: orderStatusOf(d, !!c),
        amountCents: typeof d.amount_cents === "number" ? d.amount_cents : null,
        currency: typeof d.amount_cents === "number" ? "usd" : null,
      });
    }
    for (const [sid, c] of contentBySession) {
      if (orders.has(sid)) continue;
      orders.set(sid, { id: sid, sessionId: sid, product: c.product_name ?? c.product_type ?? "Purchase", productType: c.product_type ?? null, date: c.created_at, status: "ready", amountCents: null, currency: null });
    }
    for (const g of (grantsRes.data ?? []) as GrantRow[]) {
      orders.set(`grant:${g.id}`, {
        id: `grant:${g.id}`, sessionId: null,
        product: g.product_name ?? g.product_type ?? "Included with Pro", productType: g.product_type ?? null,
        date: g.created_at, status: g.revoked_at ? "refunded" : "included", amountCents: 0, currency: null,
      });
    }
    const orderList = [...orders.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 100);

    // The plain list the export and older pages read.
    const purchases = [
      ...orderList.filter((o) => o.sessionId).map((o) => ({ product: o.product, date: o.date })),
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
      credits: credits ?? 0, purchases, orders: orderList, passes, mailboxProven: !!provenEmail,
      ...(passwordCleared ? { passwordCleared: true } : {}),
      ...(signedOut ? { signedOut: true } : {}),
    });
  } catch (e) {
    console.error("[GET-ACCOUNT-DATA] Uncaught:", e instanceof Error ? e.message : String(e));
    return json({ error: "Unexpected error" }, 500);
  }
});
