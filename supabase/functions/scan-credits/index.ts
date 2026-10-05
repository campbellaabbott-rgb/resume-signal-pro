// SCAN CREDIT BALANCE FOR A PROVEN IDENTITY.
//   POST { sessions?: string[] }
//     -> { credits, signedIn, mailboxProven, purchases, bought, email }
//
// Replaces the browser's direct call to the credit reader RPC, which the
// publishable key could make for ANY address (defect sweep 1.26): the header
// widget let a visitor type an address and read its balance, and the same RPC
// told a script which addresses had bought. The balance is now answered only
// for
//   - purchases this browser holds: Stripe Checkout session ids it kept from
//     the success redirect. Each is checked once with Stripe and recorded
//     (_shared/scan-credits.ts), and counts only what it has left. A
//     signed-in caller presenting one claims it for their account;
//   - purchases the signed-in account claimed, on any device; and
//   - the account address's whole pool, only when the session has proven its
//     mailbox (_shared/mailbox-proof.ts). Sign-ups are auto-confirmed, so
//     signing up as a buyer's address shows nothing of theirs.
// Nothing about any other address can be learned here.
//
// A request with neither answers zero WITHOUT touching the database, so the
// post-deploy probe of this function is a pure read.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { clientAddressOr } from "../_shared/client-address.ts";
import {
  type CreditDb,
  isAuthUserId,
  normalizeCreditEmail,
  parseCreditSessions,
  resolveCreditSessions,
  scanCreditBalance,
  scanCreditGrantsBought,
} from "../_shared/scan-credits.ts";
import { provenMailbox } from "../_shared/mailbox-proof.ts";

// Provable from outside: every response, the CORS preflight included, carries
// this in x-fn-build.
const FN_BUILD = "scan-credits.2026-10-05.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "x-fn-build": FN_BUILD,
};

/** Balance reads per address per hour. The header asks once per page load at most. */
export const PER_ADDRESS_PER_HOUR = 60;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as { sessions?: unknown };
    const sessionIds = parseCreditSessions(body?.sessions);

    // A user session, or the publishable key. Only a verified user has an address.
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const hasUserToken = !!jwt && jwt !== anonKey;

    if (!hasUserToken && sessionIds.length === 0) {
      return json({ credits: 0, signedIn: false, mailboxProven: false, purchases: 0, bought: 0, email: null });
    }

    const service = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const { data: allowed, error: rlError } = await service.rpc("check_rate_limit", {
      p_ip: clientAddressOr(req.headers, "unknown"),
      p_function: "scan-credits",
      p_max_requests: PER_ADDRESS_PER_HOUR,
      p_window_minutes: 60,
    });
    if (rlError) return json({ error: "Service temporarily unavailable." }, 503);
    if (allowed !== true) return json({ error: "Too many requests. Please try again later." }, 429);

    // The account's own address (shown to its owner, never used as a proof),
    // its user id (spends what it claimed), and the address again only when
    // the session proved its mailbox (spends the address's pool).
    let accountEmail: string | null = null;
    let userId: string | null = null;
    let provenEmail: string | null = null;
    if (hasUserToken) {
      try {
        const { data } = await service.auth.getUser(jwt);
        const user = data?.user ?? null;
        const e = normalizeCreditEmail(user?.email);
        userId = isAuthUserId(user?.id) ? user!.id : null;
        accountEmail = userId && e.includes("@") ? e : null;
        if (userId) {
          provenEmail = await provenMailbox(user, jwt, {
            confirmedSince: Deno.env.get("EMAIL_CONFIRMED_SINCE") ?? null,
            supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
            anonKey,
          });
        }
      } catch { /* an expired or foreign token is simply not a proof */ }
    }

    const db = service as unknown as CreditDb;
    const grants = sessionIds.length > 0
      ? await resolveCreditSessions(db, sessionIds, { stripeKey: Deno.env.get("STRIPE_SECRET_KEY") ?? "", claimFor: userId })
      : [];
    const hashes = grants.map((g) => g.hash);
    const [credits, bought] = await Promise.all([
      scanCreditBalance(db, { provenEmail, userId, sessionHashes: hashes }),
      scanCreditGrantsBought(db, hashes),
    ]);
    if (credits === null) return json({ error: "Could not read credits right now." }, 503);

    // The address shown beside the balance: the account's own, or the one the
    // held purchases were made with when there is exactly one. Both are the
    // caller's own: the session id is the proof of the purchase.
    const purchaseEmails = [...new Set(grants.map((g) => g.email))];
    const email = accountEmail ?? (purchaseEmails.length === 1 ? purchaseEmails[0] : null);
    return json({
      credits,
      signedIn: !!userId,
      mailboxProven: !!provenEmail,
      purchases: grants.length,
      bought: bought ?? 0,
      email,
    });
  } catch (e) {
    console.error("[SCAN-CREDITS] Error:", e instanceof Error ? e.message : String(e));
    return json({ error: "Unexpected error" }, 500);
  }
});
