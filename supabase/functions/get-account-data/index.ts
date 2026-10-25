// deploy-stamp: 2026-10-09T13:00Z
// Account data for the signed-in user: scan credits and purchase history.
// Both are keyed by email in service-role tables, so this function verifies
// the caller's JWT and reads on their behalf.
// verify_jwt stays at the default (true) — Supabase rejects anonymous calls.
//
// AN ADDRESS ON THE SESSION IS NOT PROOF (review of claude/w1-scan-ai,
// 2026-10-05). Sign-ups are auto-confirmed (mailer_autoconfirm = true), so
// anybody can sign up as a buyer's address and hold a session for it. This
// function used to answer that session with the address's whole credit
// balance and its purchase history (defect sweep 1.26 through the JWT). Now:
//   - credits: what the account's user id claimed (purchases a signed-in
//     browser holding their Stripe session presented), plus the address's
//     pool ONLY when the session proved its mailbox (_shared/mailbox-proof.ts:
//     a verified Google/Apple sign-in today);
//   - purchases by address: only for a proven mailbox, else none, with
//     mailboxProven: false so the page can say why;
//   - the account's Agent Passes (agent_passes, by the verified user id): a
//     pass is never a purchased_content row, so the Purchases box said "No
//     purchases yet" to a $29 buyer (platform sweep L6-12).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { provenMailbox } from "../_shared/mailbox-proof.ts";
import { isAuthUserId, scanCreditBalance, type CreditDb } from "../_shared/scan-credits.ts";

// Provable from outside: every response, the CORS preflight included, carries
// this in x-fn-build.
// 2026-10-14.1 (R1 integration): _shared/mailbox-proof.ts gained the proof-row
// readers and maskEmail; provenMailbox, the one import here, is unchanged.
const FN_BUILD = "get-account-data.2026-10-14.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const service = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const { data: { user }, error: userErr } = await service.auth.getUser(jwt);
    if (userErr || !user?.email || !isAuthUserId(user.id)) return json({ error: "Not authenticated" }, 401);

    // The switch is the mailbox_proof_settings row; the secret only answers
    // when that row cannot be read.
    const provenEmail = await provenMailbox(user, jwt, {
      db: service,
      confirmedSince: Deno.env.get("EMAIL_CONFIRMED_SINCE") ?? null,
      supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
      anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    });

    const [credits, purchasesRes, passesRes] = await Promise.all([
      scanCreditBalance(service as unknown as CreditDb, { provenEmail, userId: user.id, sessionHashes: [] }),
      provenEmail
        ? service.from("purchased_content")
          .select("product_name, product_type, created_at")
          .eq("customer_email", provenEmail)
          .order("created_at", { ascending: false })
          .limit(50)
        : Promise.resolve({ data: [] as unknown[] }),
      service.from("agent_passes")
        .select("purchased_at, shelf_expires_at, activated_at, expires_at, closed_at")
        .eq("user_id", user.id)
        .order("purchased_at", { ascending: false })
        .limit(20),
    ]);

    const purchases = ((purchasesRes as { data?: unknown[] | null }).data ?? []).map((row) => {
      const p = row as { product_name?: string | null; product_type?: string; created_at: string };
      return { product: p.product_name ?? p.product_type ?? "Purchase", date: p.created_at };
    });

    // State from the timestamps, as agent-pass-status derives it (its lazy
    // close may not have run yet).
    const now = Date.now();
    const passes = ((passesRes as { data?: unknown[] | null }).data ?? []).map((row) => {
      const p = row as { purchased_at: string; shelf_expires_at?: string | null; activated_at?: string | null; expires_at?: string | null; closed_at?: string | null };
      const ended = !!p.closed_at
        || (p.activated_at ? !!p.expires_at && Date.parse(p.expires_at) <= now : !!p.shelf_expires_at && Date.parse(p.shelf_expires_at) <= now);
      return { date: p.purchased_at, state: ended ? "closed" : p.activated_at ? "live" : "unactivated" };
    });

    return json({ credits: credits ?? 0, purchases, passes, mailboxProven: !!provenEmail });
  } catch (e) {
    console.error("[GET-ACCOUNT-DATA] Uncaught:", e instanceof Error ? e.message : String(e));
    return json({ error: "Unexpected error" }, 500);
  }
});
