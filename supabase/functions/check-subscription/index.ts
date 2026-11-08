// deploy-stamp: 2026-10-08T13:00Z
// Returns the caller's OWN Resume Booster Pro status.
//
// WHO IS ASKED ABOUT. This used to answer for whatever address the request
// body named, for anyone: an unauthenticated oracle for "does this person pay
// us", which also spent two or more unmetered Stripe calls per new address
// and wrote a pro_subscribers row for each (2026-10-04 completeness review).
// It now answers only about:
//   1. the signed-in caller (the auth server's word for their address), or
//   2. the address bound to a completed subscription checkout whose Stripe
//      session id the caller holds (the id is in the success URL Stripe
//      redirected them to; holding it is the proof).
// Anything else -- an address in the body included -- gets
// { active: false, status: "sign_in_required" } with no lookup at all.
//
// A live Stripe check is rate-limited per network address -- every live
// check, a signed-in one holding a session id included. A cached row saying
// the plan is live is served for an hour; a row saying it is NOT live only
// for five minutes, because a buyer who just paid must not be told "Go Pro"
// for an hour (the webhook now writes the row on payment; this is the bound
// for when it is late), and never to a caller holding the checkout they just
// completed.
//
// "NOT SUBSCRIBED" IS CACHED TOO, for the signed-in caller. checkProByEmail
// no longer creates a row for an address Stripe has no subscription for (the
// checkout's pre-check wrote one minutes before every first purchase -- L6-28),
// so without a row written here every page view by a signed-in non-subscriber
// was a fresh Stripe lookup, up to the per-address allowance (2026-10-05
// review). The row is written only when none exists (a row the webhook wrote
// first is left alone) and is trusted for the same five minutes.
//
// WHAT "active" MEANS FOR A SIGNED-IN CALLER (wave 2, L6-08 / L6-29). The
// address work above keeps the cache fresh, but the answer is the ACCOUNT's,
// by the one rule every gate applies (_shared/pro-standing.ts): both caches,
// bound to this account or on a mailbox it proved; a trial is live but mints
// no consumables (`trialing`, `consumablesIncluded`). This page used to call
// a trialing or address-only plan "every tool unlocked" while the gates
// behind it refused. `linkPending` says the address holds a live plan this
// account cannot use yet (bought before plans named their account, and the
// mailbox not proven). If the account's plan cannot be read, the address
// answer is served only when the address's plan is bound to this account.
//
// WHICH PLAN IS DESCRIBED (sweep S14, M-S14-006 and C-S14-004; the rule is
// _shared/pro-answer.ts). The address's status, period, cancellation and
// failed payment are said only when the address's plan is this account's
// own. Otherwise the account's own rows are described, so a member whose
// address changed is shown their plan's renewal, end date or failed payment
// rather than "Go Pro", and an account on someone else's address learns
// only that a plan there is not linked to it. On a live check, the rows the
// account is bound to are asked of Stripe by the customers they name (an
// address that changed no longer finds them).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { checkProByEmail, isStripeCustomerId, PRO_ENTITLEMENT_RPC, proRowIsLive, proStandingFrom, refreshCustomerRows, type ProRow } from "../_shared/pro.ts";
import { isOwingStatus } from "../_shared/subscription-standing.ts";
import { signedInUser } from "../_shared/signed-in-email.ts";
import { buyerEmailOf } from "../_shared/buyer-email.ts";
import { clientAddressOr } from "../_shared/client-address.ts";
import { cacheCancelFlag, cancelFlagFrom, recordingSubscriptions } from "../_shared/pro-cancel.ts";
import { accountAnswer, addressOwnerOf, type AddressOwner, type PlanRow } from "../_shared/pro-answer.ts";

// Provable from outside without an account: every response, the CORS
// preflight included, carries this in x-fn-build.
// 2026-10-11.23 (wave 4 round 2, checkout-catalogue): the answer says when a
// live plan was cancelled at its period end (cancelAtPeriodEnd, S12-076) and
// which plan a signed-in account's standing rests on (planTier, S12-168: a
// retired Agent plan is not shown as Pro); a caller just back from Stripe's
// billing portal (fresh: true) is answered from Stripe, not a cached row.
// 2026-10-11.30 (wave 4 round 2 fixes): an account that is not Pro, on an
// address whose plan is live, is told only that the address has a plan to
// link (linkPending), never that plan's status, renewal date or cancellation:
// sign-ups are auto-confirmed, so anyone can sign up as a stranger's address
// (D8).
// 2026-11-03.1 (S9-001, fix/audit-rest-abuse): _shared/signed-in-email.ts reads only a website session, so a connected app's token is an anonymous request and never reads the person's plan.
// 2026-11-10.1 (hotfix lane pro, sweep S14: M-S14-002, M-S14-006, C-S14-004):
// an address's plan is described only to the account it is bound to; a
// member whose address changed is described their own plan (renewal, end
// date, failed payment) from the rows bound to the account, and on a live
// check those rows are asked of Stripe by customer; _shared/pro.ts no longer
// nulls a row's customer when the address search finds nothing.
const FN_BUILD = "check-subscription.2026-11-10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

const LIVE_CACHE_MS = 3600 * 1000;
const NOT_LIVE_CACHE_MS = 5 * 60 * 1000;
const LIVE_CHECKS_PER_HOUR = 30;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const body = await req.json().catch(() => ({})) as { sessionId?: unknown; fresh?: unknown };
    // BACK FROM STRIPE'S BILLING PORTAL (S12-076): a cancel or a card change
    // made there is newer than any cached row, so the cache is skipped once.
    // The live check is still counted against the per-address allowance.
    const fresh = body.fresh === true;

    const caller = await signedInUser(supabase.auth, req.headers, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const signedIn = caller?.email ?? null;
    let email = signedIn;

    // The account's own Pro rows (bound to it), as stored: what they name and
    // whether a live one is set to end. null when they cannot be read.
    type BoundRow = { status: string | null; current_period_end: string | null; cancel_at_period_end?: boolean | null; stripe_customer_id: string | null };
    const boundRows = async (userId: string): Promise<BoundRow[] | null> => {
      const read = (cols: string) =>
        supabase.from("pro_subscribers").select(cols).eq("user_id", userId).limit(20) as unknown as Promise<{ data: BoundRow[] | null; error: { code?: string } | null }>;
      try {
        let { data, error } = await read("status, current_period_end, cancel_at_period_end, stripe_customer_id");
        // A database without the column yet (20261011150000 not applied).
        if (error && (error.code === "42703" || error.code === "PGRST204")) ({ data, error } = await read("status, current_period_end, stripe_customer_id"));
        return error || !Array.isArray(data) ? null : data;
      } catch (_) {
        return null;
      }
    };

    // The address answer, turned into the ACCOUNT's for a signed-in caller
    // (_shared/pro-answer.ts). `liveRow` is a plan Stripe just answered for,
    // bound to THIS caller: it counts even if writing it to the cache failed
    // a moment ago. `owner` is whose plan the address answer rests on.
    const answer = async (
      addressAnswer: Record<string, unknown>,
      status = 200,
      liveRow: ProRow | null = null,
      owner: AddressOwner = "unbound",
    ): Promise<Response> => {
      if (!caller || status !== 200) return json(addressAnswer, status);
      let rows: PlanRow[] = [];
      try {
        const { data, error } = await supabase.rpc(PRO_ENTITLEMENT_RPC, { p_user_id: caller.id });
        if (error) return json(accountAnswer({ address: addressAnswer, owner, rows: [], rowsUnread: true }).body, status);
        rows = Array.isArray(data) ? data as PlanRow[] : [];
      } catch (_) {
        return json(accountAnswer({ address: addressAnswer, owner, rows: [], rowsUnread: true }).body, status);
      }
      const all: PlanRow[] = liveRow ? [...rows, { tier: "pro", bound: true, ...liveRow }] : rows;
      const told = accountAnswer({ address: addressAnswer, owner, rows: all });
      // The account's own live Pro plan, described from its rows: whether it
      // is set to end is on the bound row (pro_entitlement_rows does not say).
      if (told.basis === "account" && told.plan?.tier === "pro" && told.plan.bound !== false && proRowIsLive(told.plan)) {
        const own = await boundRows(caller.id);
        const ends = !!own?.some((r) => r.status === told.plan?.status && r.cancel_at_period_end === true && proRowIsLive(r));
        if (ends) return json(accountAnswer({ address: addressAnswer, owner, rows: all, ownEnds: true }).body, status);
      }
      return json(told.body, status);
    };
    const heldSession = typeof body.sessionId === "string" && /^cs_[A-Za-z0-9_]{8,250}$/.test(body.sessionId)
      ? body.sessionId : null;
    if (!email && !heldSession) {
      // No lookup, no Stripe call, no row: the same answer for every address.
      return json({ active: false, status: "sign_in_required" });
    }

    let stripe: Stripe | null = null;
    const stripeClient = () => {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
      return (stripe ??= new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" }));
    };
    // Fail open: a counter that cannot be read must not hide a paying
    // subscriber's plan. Only an explicit "no" refuses. Counted once per
    // request, whichever path asks first.
    let liveCheckCounted = false;
    const liveCheckAllowed = async (): Promise<boolean> => {
      liveCheckCounted = true;
      const { data } = await supabase.rpc("check_rate_limit", {
        p_function: "check-subscription",
        p_ip: clientAddressOr(req.headers),
        p_max_requests: LIVE_CHECKS_PER_HOUR,
        p_window_minutes: 60,
      });
      return data !== false;
    };

    if (!email && heldSession) {
      if (!(await liveCheckAllowed())) return json({ active: false, status: "rate_limited" }, 429);
      try {
        const session = await stripeClient().checkout.sessions.retrieve(heldSession);
        if (session.mode === "subscription" && session.status === "complete") email = buyerEmailOf(session);
      } catch (_) {
        // An unknown or malformed id proves nothing.
      }
      if (!email) return json({ active: false, status: "sign_in_required" });
    }
    const who = email as string;

    // Cache-first. This endpoint fires on every /pricing, /account and /jobs
    // view for a signed-in visitor.
    let cachedAnswer: Record<string, unknown> | null = null;
    // The row's updated_at as read, null for no row, undefined when the read
    // failed: checkProByEmail downgrades only the row seen, and "not
    // subscribed" is written only where there was none.
    let seenUpdatedAt: string | null | undefined;
    // The account the address's row is bound to, as read (S14: whose plan it is).
    let seenUserId: string | null = null;
    try {
      type CacheRow = { status: string; current_period_end: string | null; updated_at: string; cancel_at_period_end?: boolean | null; user_id?: string | null };
      const read = (cols: string) =>
        supabase.from("pro_subscribers").select(cols).eq("email", who).maybeSingle() as unknown as Promise<{ data: CacheRow | null; error: { code?: string; message?: string } | null }>;
      let { data: row, error: readError } = await read("status, current_period_end, updated_at, cancel_at_period_end, user_id");
      // A database without the column yet (20261011150000 not applied).
      if (readError && (readError.code === "42703" || readError.code === "PGRST204")) {
        ({ data: row, error: readError } = await read("status, current_period_end, updated_at, user_id"));
      }
      if (readError) throw readError;
      seenUpdatedAt = row ? String(row.updated_at) : null;
      seenUserId = typeof row?.user_id === "string" && row.user_id ? row.user_id : null;
      if (row) {
        // The one rule's live test (one grace), over the address's row.
        const live = proStandingFrom([row]).pro;
        cachedAnswer = {
          active: live,
          status: row.status,
          currentPeriodEnd: row.current_period_end,
          cancelAtPeriodEnd: live && row.cancel_at_period_end === true,
          needsPaymentUpdate: isOwingStatus(row.status),
          cached: true,
        };
        const age = Date.now() - new Date(row.updated_at).getTime();
        // A caller holding the checkout they just completed is told the live
        // answer, never a not-live row written before they paid; a caller
        // back from the billing portal likewise.
        const notLiveFor = heldSession ? 0 : NOT_LIVE_CACHE_MS;
        if (!fresh && age < (live ? LIVE_CACHE_MS : notLiveFor)) {
          return await answer(cachedAnswer, 200, null, caller ? addressOwnerOf(caller.id, null, seenUserId) : "unbound");
        }
      }
    } catch (_) {
      // Fall through to the live check; the row as read is unknown.
      seenUpdatedAt = undefined;
      seenUserId = null;
    }

    // A session id in the body is not a pass: an invented cs_... string from a
    // signed-in caller used to skip this allowance on every request.
    if (!liveCheckCounted && !(await liveCheckAllowed())) {
      // Over the live-check allowance: the last known answer, said to be old,
      // rather than a "not subscribed" that may be false.
      return cachedAnswer
        ? await answer({ ...cachedAnswer, stale: true }, 200, null, caller ? addressOwnerOf(caller.id, null, seenUserId) : "unbound")
        : json({ active: false, status: "rate_limited" }, 429);
    }
    // CANCELLED IN THE PORTAL, STILL LIVE TO ITS END (S12-076): read from the
    // same Stripe answer the one rule's lookup gets (no second call), and kept
    // on the cache row the cached answer reads. Nothing listed for the plan's
    // customer keeps the row's flag as it was.
    const recorder = recordingSubscriptions(stripeClient());
    const status = await checkProByEmail(recorder.stripe, supabase, who, { seenUpdatedAt });
    const ends = status.active ? cancelFlagFrom(recorder.seen, status.stripeCustomerId) : false;
    if (ends !== null && status.stripeCustomerId) await cacheCancelFlag(supabase, who, ends);
    if (signedIn && seenUpdatedAt === null && !status.stripeCustomerId) {
      // Stripe has no subscription for this address, and checkProByEmail
      // wrote nothing: remember that for five minutes. An insert, never an
      // upsert, so a row the webhook wrote in the meantime wins (23505).
      try {
        await supabase.from("pro_subscribers").insert({
          email: who,
          stripe_customer_id: null,
          status: "inactive",
          current_period_end: null,
          updated_at: new Date().toISOString(),
        });
      } catch (_) { /* best-effort; the next view looks again */ }
    }
    const owner: AddressOwner = caller ? addressOwnerOf(caller.id, status.boundUserId, seenUserId) : "unbound";
    if (caller && !(owner === "caller" && status.active)) {
      // THE ACCOUNT'S OWN PLAN, ASKED OF STRIPE BY ITS CUSTOMER (S14). The
      // address no longer finds a plan whose billing email changed in
      // Stripe's portal, or one bought before a sign-in email change; the
      // rows bound to this account name its customer. Each is refreshed (and
      // its cancel flag with it) before the account's rows are read, unless
      // the address already answered with this account's own live plan.
      const own = await boundRows(caller.id);
      const customers = [...new Set((own ?? []).map((r) => r.stripe_customer_id).filter(isStripeCustomerId))]
        .filter((c) => c !== status.stripeCustomerId).slice(0, 3);
      for (const c of customers) await refreshCustomerRows(recorder.stripe, supabase, c);
    }
    return await answer({
      active: status.active,
      status: status.status,
      currentPeriodEnd: status.currentPeriodEnd,
      cancelAtPeriodEnd: status.active && ends === true,
      needsPaymentUpdate: isOwingStatus(status.status),
    }, 200, owner === "caller" && status.stripeCustomerId ? { tier: "pro", status: status.status, current_period_end: status.currentPeriodEnd } : null, owner);
  } catch (error) {
    console.error("[CHECK-SUBSCRIPTION] Error:", error);
    return json({ active: false, error: "Could not check the subscription just now." }, 500);
  }
});
