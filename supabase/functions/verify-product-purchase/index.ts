// deploy-stamp: 2026-10-14T11:00Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resumeSessionForCheckout } from "../_shared/checkout-resume-ref.ts";
import { clientAddressOr } from "../_shared/client-address.ts";
import { checkoutSessionSettled } from "../_shared/pass-settlement.ts";
import { buyerEmailOf } from "../_shared/buyer-email.ts";
import { proGrantRefusal } from "../_shared/pro.ts";
import { REFUNDED_PURCHASE_MESSAGE, sessionWasRefunded } from "../_shared/payment-revocation.ts";
import { targetRolesOf } from "../_shared/target-roles.ts";
import { hasMailboxProof, maskEmail } from "../_shared/mailbox-proof.ts";
import { jwtClaims, requireWebsiteSession } from "../_shared/website-session.ts";
import { bearerOf } from "../_shared/service-caller.ts";
// The $7 Apply Assistant is retired (wave 4): a session opened before the
// switch and paid after it is recorded, never generated (S12-169).
import { APPLY_ASSISTANT_ON_SALE } from "../_shared/apply-agent-switch.ts";

// Provable from outside without a purchase: every response, the CORS
// preflight included, carries this in x-fn-build. R1 stamped this function
// 2026-10-14.1 and deploys first, so wave 4 keeps R1's day with a higher
// sequence (docs/deploy-ledger.json, _reservationsNote).
const FN_BUILD = "verify-product-purchase.2026-10-14.22";

/** Why a sale of this product cannot be delivered while it is not sold, or null. */
function retiredReasonOf(productType: string | null | undefined): string | null {
  return productType === "apply_assistant" && !APPLY_ASSISTANT_ON_SALE
    ? "the Apply Assistant is no longer sold; nothing was generated"
    : null;
}

/**
 * THE STRIPE KEY FOR THIS SESSION (CP-033): a cs_test_ session is read with
 * the test-mode key when one is configured (the owner's test rehearsal), and
 * every other session, a test one included when no test key exists, with the
 * live key as before.
 */
function stripeKeyFor(sessionId: unknown): string | undefined {
  const testKey = Deno.env.get("STRIPE_TEST_SECRET_KEY") ?? "";
  if (typeof sessionId === "string" && sessionId.startsWith("cs_test_") && testKey.startsWith("sk_test_")) return testKey;
  return Deno.env.get("STRIPE_SECRET_KEY");
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "x-fn-build": FN_BUILD,
  "Access-Control-Expose-Headers": "x-fn-build",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[VERIFY-PRODUCT-PURCHASE] ${step}`, details ? JSON.stringify(details) : '');
};

/**
 * THE BUYER'S ADDRESS IS SHOWN ONLY TO WHOEVER PROVED THAT MAILBOX (R1,
 * 2026-10-14). A success link carries the Stripe session id, travels in mail
 * and in a host's analytics, and anybody holding it can call this function,
 * so the address in the answer is masked (j***@gmail.com). It is shown in full
 * only to a caller who sent a website session (never a connector's token)
 * whose account has proven that exact address (account_mailbox_proofs). A
 * caller with the publishable key costs no auth round trip; any failure
 * masks.
 */
async function callerProvedMailbox(req: Request, admin: unknown, email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  try {
    const claims = jwtClaims(bearerOf(req.headers));
    if (!claims || claims.role !== "authenticated") return false;
    const anon = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const session = await requireWebsiteSession(req, { auth: anon.auth });
    if (session instanceof Response) return false;
    return await hasMailboxProof(admin as Parameters<typeof hasMailboxProof>[0], session.user.id, email);
  } catch {
    return false;
  }
}

const SCAN_CREDIT_PRODUCT_TYPES = ['scan_pack', 'scan_credits', 'career_bundle'];
// The products this path can generate when asked: the Apply Assistant and
// every case of buildGenerationRequest below.
/** How long a delivery marked generating counts as being made by someone else. */
const GENERATION_IN_PROGRESS_MS = 5 * 60 * 1000;
// HOW LONG THIS PAGE HOLDS AN ORDER IT MAKES (20261011144000, CP-019). The
// lease is what tells the webhook, the sweep and a second tab apart: a row
// whose lease is live is answered inProgress, an expired one is reclaimed,
// and the finish carries the token so a maker that lost the row mails nobody.
const LEASE_MINUTES = 10;

const GENERATED_PRODUCT_TYPES = [
  'apply_assistant', 'basic_keyword_fix', 'cover_letter', 'premium_package', 'graduate_gameplan',
  'career_snapshot', 'ats_defense', 'interview_coach', 'career_path_simulator',
];
/**
 * The products the success page shows from the saved copy (ProductSuccess's
 * SERVER_RENDERED; a test pins the two equal). Interview Coach and the Career
 * Path Simulator are widgets that make their own on the page, so "in
 * progress" means nothing to them: told it, the page waited on "verifying"
 * for up to five minutes and spent up to 14 of its 30 verify calls an hour
 * before showing the widget (review of S11-054).
 */
const SAVED_COPY_PRODUCT_TYPES = GENERATED_PRODUCT_TYPES.filter((t) => t !== 'interview_coach' && t !== 'career_path_simulator');

/**
 * How many credits a scan purchase bought: the metadata, else the line item's
 * quantity (create-scan-pack-checkout), else the product's default. Capped at
 * 500, as the webhook caps it. Read once, so the credit grant and the delivery
 * row the sweeper re-credits from can never disagree.
 */
function creditsBoughtBy(session: {
  metadata: Record<string, string>;
  line_items?: { data?: Array<{ quantity?: number | null }> };
}): number {
  const productType = session.metadata?.product_type;
  const fallback = productType === 'career_bundle' ? 75 : 10;
  let credits = parseInt(session.metadata?.credits || '', 10);
  if (!(credits > 0) && productType !== 'career_bundle') credits = session.line_items?.data?.[0]?.quantity ?? 0;
  return Math.min(credits > 0 ? Math.floor(credits) : fallback, 500);
}

// Maps each content product to its generation endpoint and request body.
// Mirrors stripe-webhook's switch — this is the recovery path used when the
// success page calls verify-product-purchase because the webhook hasn't
// fired yet (or failed). A product missing here means recovery silently does
// nothing for it, even though the customer paid.
function buildGenerationRequest(
  productType: string,
  resumeText: string,
  jobDescriptionText: string,
  jobTitle: string,
  jobCompany: string,
  language: string,
  sessionId: string,
  targetRoles: string[] = []
): { endpoint: string; body: Record<string, unknown> } | null {
  switch (productType) {
    // generate-keyword-fix gates on assertPaidSession too, and this is the path
    // the success page asks to generate the keyword fix on -- without the
    // session it was a 402 every time, rescued only by the browser's own retry.
    case 'basic_keyword_fix':
      return { endpoint: 'generate-keyword-fix', body: { sessionId, resumeText, jobDescription: jobDescriptionText, jobTitle, jobCompany, language } };
    // The free generators (cover letter, coach, career path) read the session
    // to count this purchase's daily allowance -- see generate-cover-letter.
    case 'cover_letter':
      return { endpoint: 'generate-cover-letter', body: { sessionId, resumeText, jobDescription: jobDescriptionText, jobTitle: jobTitle || 'Professional Position', jobCompany, tone: 'professional', language } };
    // These three now gate on assertPaidSession (they are paid-only endpoints —
    // unlike cover_letter, whose generator the public board also calls free).
    // The sessionId is their proof of purchase; omit it and a real buyer 402s.
    case 'premium_package':
      return { endpoint: 'generate-premium-package', body: { sessionId, resumeText, jobDescription: jobDescriptionText, jobTitle: jobTitle || 'Target Position', jobCompany, language } };
    case 'graduate_gameplan':
      return { endpoint: 'generate-graduate-gameplan', body: { sessionId, resumeText, jobDescription: jobDescriptionText, jobTitle, jobCompany, language } };
    case 'career_snapshot':
      return { endpoint: 'generate-career-snapshot', body: { sessionId, resumeText, jobDescription: jobDescriptionText, jobTitle, jobCompany, language } };
    case 'ats_defense':
      // generate-ats-defense independently re-verifies payment via a real
      // Stripe checkout session lookup, so it requires sessionId in the
      // body — unlike every other product here, which trusts this caller
      // implicitly. Without it, this call always 401s.
      return { endpoint: 'generate-ats-defense', body: { sessionId, resumeText, jobDescription: jobDescriptionText, targetRoles, language } };
    case 'interview_coach':
      return { endpoint: 'generate-interview-coach', body: { sessionId, resumeText, isPremium: true, language } };
    case 'career_path_simulator':
      return { endpoint: 'generate-career-path', body: { sessionId, resumeText, isPremium: true, language } };
    default:
      return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // The platform's word for the caller's address, never the first forwarded
  // hop, which the caller writes itself and could rotate per request.
  const clientIp = clientAddressOr(req.headers);
  const supabaseEarly = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  // Only an explicit "no" refuses (L6-19). A counter that errored (a statement
  // timeout, a pool hiccup) used to read as "too many requests" on the page a
  // buyer lands on right after paying.
  const { data: rlAllowed, error: rlError } = await supabaseEarly.rpc("check_rate_limit", { p_function: "verify-product-purchase", p_ip: clientIp, p_max_requests: 30, p_window_minutes: 60 });
  if (rlError) logStep("Rate limit check failed; continuing", { error: rlError.message });
  if (rlAllowed === false) return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { sessionId, generateContent = false } = await req.json();

    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: "Session ID is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Verifying purchase", { sessionId: sessionId.substring(0, 20) + "..." });

    // Initialize Stripe
    const stripeKey = stripeKeyFor(sessionId);
    if (!stripeKey) {
      throw new Error("STRIPE_SECRET_KEY not configured");
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });

    // Pro subscription grants: sessionId "pro_<uuid>" refers to a server-issued
    // row in pro_grants (created by create-product-checkout only when the email
    // has an active Pro subscription). Synthesize the same shape a paid Stripe
    // session would have so the rest of the flow (single-use claim, delivery
    // logging, generation) runs unchanged.
    let session: {
      payment_status: string;
      mode?: string | null;
      customer_email: string | null;
      customer_details?: { email?: string | null } | null;
      amount_total: number | null;
      metadata: Record<string, string>;
      line_items?: { data?: Array<{ quantity?: number | null }> };
    };
    if (typeof sessionId === "string" && sessionId.startsWith("pro_")) {
      const grantId = sessionId.slice(4);
      const supabaseGrant = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      // consumed_at is part of the lookup, not a note written afterwards. A
      // replayed grant id — a bookmarked success URL, a re-sent link — finds
      // nothing here rather than minting the product a second time.
      const { data: unspent } = await supabaseGrant
        .from("pro_grants")
        .select("*")
        .eq("id", grantId)
        .is("consumed_at", null)
        .maybeSingle();
      let grant = unspent;
      if (!grant) {
        // A REFRESH OF A GRANT ALREADY REDEEMED (platform sweep L6-15). The
        // grant is spent when this page first verifies it, before anything
        // is generated, so a reload mid-generation found nothing and showed a
        // verification error, while a Stripe buyer's reload simply continued.
        // A spent grant whose redemption claim exists is answered the way a
        // claimed Stripe session is: verified, isFirstUse false. Nothing is
        // minted again (credits, email and conversion all need a first use,
        // and the claim insert below loses to the existing one); a replayed
        // id with no claim is still refused.
        const { data: spent } = await supabaseGrant
          .from("pro_grants")
          .select("*")
          .eq("id", grantId)
          .not("consumed_at", "is", null)
          .maybeSingle();
        const { data: claim } = spent
          ? await supabaseGrant.from("used_stripe_sessions").select("session_id").eq("session_id", sessionId).maybeSingle()
          : { data: null };
        if (!spent || !claim) {
          return new Response(
            JSON.stringify({ error: "Invalid session" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // A spent grant a refund took back is not refreshed into a delivery.
        if (spent.revoked_at) {
          return new Response(
            JSON.stringify({ error: "This was withdrawn because the subscription payment behind it was refunded." }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        grant = spent;
      } else {
        // Re-verify before honoring the grant, by THE ONE RULE: the ACCOUNT
        // that minted it (never the grant's address) still holds a plan that
        // may mint consumables -- both caches, and not only a trial (L6-08,
        // L6-29) -- and no refund has taken it back.
        const refusal = await proGrantRefusal(supabaseGrant, grant);
        if (refusal) {
          return new Response(
            JSON.stringify({ error: refusal.error }),
            { status: refusal.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // The consume is the claim. Two requests can both pass the SELECT above;
        // only one can win this UPDATE, because the filter and the write are one
        // statement. The loser gets nothing rather than a second copy. This runs
        // after the subscription re-check on purpose: a lapsed subscriber's grant
        // must survive its 402 rather than being burned by it.
        const { data: consumed } = await supabaseGrant
          .from("pro_grants")
          .update({ consumed_at: new Date().toISOString() })
          .eq("id", grantId)
          .is("consumed_at", null)
          .select("id");
        if (!consumed || consumed.length === 0) {
          return new Response(
            JSON.stringify({ error: "Invalid session" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
      session = {
        payment_status: "paid",
        customer_email: grant.email,
        amount_total: 0,
        metadata: {
          product_type: grant.product_type || "",
          product_name: grant.product_name || "",
          customer_email: grant.email,
          session_id: grant.resume_session_id || "",
          credits: grant.credits != null ? String(grant.credits) : "",
          job_title: grant.job_title || "",
          job_company: grant.job_company || "",
          referral_code: "",
          language: grant.language || "en",
          target_roles: grant.target_roles || "",
        },
      };
      logStep("Pro grant verified", { grantId, productType: session.metadata.product_type });
    } else {
      // Retrieve checkout session. A malformed/expired/unknown id makes Stripe
      // throw — return a clean 400 the client can message, not a bare 500
      // (a user reloading a stale success URL would otherwise hit an error page).
      try {
        session = await stripe.checkout.sessions.retrieve(sessionId, {
          expand: ['line_items', 'customer']
        }) as unknown as typeof session;
      } catch (e) {
        logStep("Session retrieve failed", { message: e instanceof Error ? e.message : String(e) });
        return new Response(
          JSON.stringify({ error: "We couldn't find that purchase. If you just paid, wait a moment and refresh; otherwise the link may have expired." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    logStep("Session retrieved", { 
      status: session.payment_status,
      productType: session.metadata?.product_type 
    });

    // 'paid', or a payment-mode session a 100%-off code completed at $0 -- the
    // same rule the webhook applies (L6-10).
    if (!checkoutSessionSettled(session)) {
      return new Response(
        JSON.stringify({
          error: "Payment not completed",
          status: session.payment_status
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // A refunded or disputed payment delivers nothing more (L6-18). Stripe
    // still answers 'paid' for it; the webhook's record is what says so.
    if (await sessionWasRefunded(supabaseEarly, sessionId)) {
      return new Response(
        JSON.stringify({ error: REFUNDED_PURCHASE_MESSAGE, refunded: true }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const productType = session.metadata?.product_type;
    const productName = session.metadata?.product_name;
    // customer_details first: an anonymous buyer's address exists only there (L6-25).
    const customerEmail = buyerEmailOf(session);
    // Looked up by the Stripe session id in checkout_resume_refs: the
    // temporary-store id is no longer written to Stripe (it is a bearer key to
    // the text). A Pro grant's synthetic session, and a session minted before
    // that change, still name it in metadata.
    const resumeSessionId = await resumeSessionForCheckout(supabaseEarly, sessionId, session.metadata);
    // The roles an ATS Defense buyer named at checkout (S11-074).
    const boughtRoles = targetRolesOf(session.metadata?.target_roles);

    // Initialize Supabase to check for duplicate processing
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Atomically claim this session via the table's PRIMARY KEY on session_id.
    // This function and stripe-webhook can both race to verify the same session
    // (e.g. the webhook fires from Stripe while the user's browser hits this
    // function almost simultaneously) — a separate SELECT-then-INSERT would have
    // a window where both reads see "not yet used" and both proceed to credit/
    // generate content. Doing the INSERT first and checking its result makes the
    // claim atomic: only one caller can win the insert.
    const { error: claimError } = await supabase
      .from('used_stripe_sessions')
      // WHICH product, not just that one was bought — see _shared/paid-session.ts.
      .insert({ session_id: sessionId, product_type: productType ?? null });

    let isFirstUse: boolean;
    if (claimError) {
      // Postgres unique_violation — another process already claimed this session.
      if (claimError.code === '23505') {
        isFirstUse = false;
        logStep("Session already claimed by another process (race avoided)", { sessionId });
      } else {
        // Unexpected DB error — fail closed (treat as already-processed) rather
        // than risk double-crediting/double-generating on a transient failure.
        logStep("Error claiming session, treating as not-first-use", { error: claimError.message });
        isFirstUse = false;
      }
    } else {
      isFirstUse = true;
      logStep("Session marked as used");
    }

    const isScanProduct = SCAN_CREDIT_PRODUCT_TYPES.includes(productType ?? '');
    const purchasedCredits = isScanProduct ? creditsBoughtBy(session) : null;

    if (isFirstUse) {
      // Log delivery step: payment received. This is the ONLY delivery record
      // a sale gets when this page claims it first (every Pro grant, and any
      // purchase the webhook was late for) -- the webhook then answers
      // alreadyProcessed. Until 20261005110000 the RPC could not create the
      // row (its INSERT omitted the NOT NULL product_type) and the error was
      // never read, so those sales left no trace for the monitors or the
      // sweeper (L6-26, register 2.04). Read now, and said out loud.
      //
      // The rest of p_metadata is what the retry sweeper needs to finish the
      // sale -- the keys the webhook writes on its own row: the credits
      // bought (or it re-credits its default of 10), and the résumé and job
      // to regenerate from. log_delivery_step keeps them in the row's
      // metadata (20261005110000).
      const { error: trackError } = await supabase.rpc('log_delivery_step', {
        p_stripe_session_id: sessionId,
        p_step: 'payment_received',
        p_metadata: {
          email: customerEmail,
          product_type: productType,
          product_name: productName,
          amount_cents: session.amount_total,
          resume_session_id: resumeSessionId || null,
          job_title: session.metadata?.job_title || null,
          job_company: session.metadata?.job_company || null,
          referral_code: session.metadata?.referral_code || null,
          language: session.metadata?.language || null,
          target_roles: session.metadata?.target_roles || null,
          ...(purchasedCredits != null ? { credits: purchasedCredits } : {}),
          // A test-mode purchase (the owner's rehearsal, CP-033) is tagged as
          // the webhook tags it, so the delivery health count leaves it out
          // (20261011143500).
          ...((session as { livemode?: boolean }).livemode === false ? { livemode: false } : {}),
        }
      });
      if (trackError) logStep("Delivery record could not be written", { error: trackError.message });
      else logStep("Delivery tracking started");
    }

    // A RETIRED PRODUCT'S SALE IS RECORDED, NEVER MADE (S12-169). Claimed
    // here first (the webhook was late), it is a payment taken after the
    // product stopped being sold: the row is closed as undeliverable_retired,
    // a failure no sweep retries, and the webhook, which still receives the
    // event, tells the owner (its door is per session). Claimed by the
    // webhook first, the row it wrote says so. A sale from before the switch
    // (a saved copy, or a row with any other history) is served as it always
    // was.
    const retired = retiredReasonOf(productType);
    let retiredSale = false;
    if (retired) {
      if (isFirstUse) {
        retiredSale = true;
        const { error: closeError } = await supabase.from('product_deliveries')
          .update({ status: 'generation_failed', generation_success: false, max_retries: 0, next_retry_at: null, generation_error: `undeliverable_retired: ${retired}` })
          .eq('stripe_session_id', sessionId);
        if (closeError) logStep("Retired sale could not be recorded", { error: closeError.message });
      } else {
        const { data: row } = await supabase.from('product_deliveries')
          .select('generation_error').eq('stripe_session_id', sessionId).maybeSingle();
        retiredSale = String((row as { generation_error?: unknown } | null)?.generation_error ?? '').startsWith('undeliverable_retired');
      }
    }
    if (retiredSale) {
      logStep("Retired product: recorded, not generated", { sessionId: sessionId.substring(0, 20), productType });
      const showRetiredBuyer = await callerProvedMailbox(req, supabase, customerEmail);
      return new Response(
        JSON.stringify({
          success: true, verified: true, isFirstUse, productType, productName,
          customerEmail: showRetiredBuyer ? customerEmail : maskEmail(customerEmail),
          customerEmailMasked: !!customerEmail && !showRetiredBuyer,
          emailSent: false, generatedContent: null, inProgress: false, hasResumeData: false,
          retired: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If content generation is requested and we have resume data
    let generatedContent: any = null;
    // WHAT THIS REQUEST OWED THE BUYER AND COULD NOT DO: a credit grant or a
    // generation that failed. While it is set the confirmation mail is not
    // sent, because its 'email_sent' step closed the row as 'delivered' over
    // the failure, and the sweeper never looked at it again (2026-10-05
    // review of L6-13 / L6-26). The row is left generation_failed, with the
    // reason, for the sweeper to finish: it re-credits what the row says was
    // bought, or regenerates the product and mails it.
    let undelivered: string | null = null;
    // The lease this page holds on the order while it makes it
    // (20261011144000; taken below, before the generator is called), and how
    // it is given back after a failure recorded through log_delivery_step,
    // which knows nothing of leases: by its token, so a row another maker
    // took meanwhile is left alone.
    let leaseToken: string | null = null;
    const releaseLease = async () => {
      if (!leaseToken) return;
      const token = leaseToken;
      leaseToken = null;
      const { error } = await supabase.rpc('release_delivery_lease', { p_stripe_session_id: sessionId, p_lease_token: token });
      if (error) logStep("The lease could not be given back; it expires on its own", { error: error.message });
    };
    const recordUndelivered = async (reason: string) => {
      undelivered = reason.slice(0, 500);
      await releaseLease();
      if (!isFirstUse) return;
      await supabase.rpc('log_delivery_step', {
        p_stripe_session_id: sessionId,
        p_step: 'generation_completed',
        p_success: false,
        p_error: undelivered
      });
    };
    
    // Idempotency for the (expensive, AI-billed) generation path. The Stripe
    // webhook ALSO generates every product's content, gated on the atomic
    // session claim — and it almost always wins that claim because it fires
    // server-side with no browser round-trip. This browser-side generation is a
    // fallback for when the webhook is slow/fails, but it was gated on NEITHER
    // the claim nor resume consumption (get_temp_resume was changed to a
    // non-consuming read). Result: for products the frontend asks to generate
    // here (e.g. basicKeywordFix) the webhook and this path both generated the
    // same content — double AI spend — and every success-page refresh generated
    // it yet again. Reuse already-saved content when it exists; only fall
    // through to generate if nothing has been produced for this session yet.
    // THE SAVED COPY FIRST, FOR EVERY GENERATED PRODUCT (sweep S8-009). The
    // webhook generates every bound sale from the copy the checkout bound and
    // saves it; the success page used to regenerate from whatever résumé its
    // tab held (an Account apply kit for job X, bought in a tab holding a
    // homepage scan of job Y, showed a kit for Y), and asked for the saved
    // copy only for the keyword fix. It is answered now whenever it exists.
    let inProgress = false;
    // The row's status as this call read it: what the lease is taken against.
    let seenStatus: string | null = null;
    // Set when the bound résumé could not be read: the sweep cannot make it either.
    let resumeUnreadable = false;
    // An Apply Assistant bought with no job posting (S12-054): nothing can
    // make it until the buyer sends the posting, so the page must not say it
    // is on its way. The retry sweep spends the row, asks the buyer for the
    // posting and tells the owner.
    let needsJobPosting = false;
    // Set when THIS call made the product and saved it. Mailed below whoever
    // claimed the session first (CP-021): when the webhook claimed it and its
    // own try failed, the copy this page made was never mailed by anyone.
    let generatedHere = false;
    if (GENERATED_PRODUCT_TYPES.includes(productType ?? '') && !generatedContent) {
      try {
        const { data: priorRows } = await supabase
          .rpc('get_purchased_content_by_session', { p_session_id: sessionId });
        const prior = Array.isArray(priorRows)
          ? priorRows.find((r: { generated_content?: unknown }) => r?.generated_content)?.generated_content
          : null;
        if (prior) {
          generatedContent = prior;
          logStep("Reusing already-generated content — skipping regeneration (idempotent)", { sessionId });
        }
      } catch (e) {
        logStep("Idempotency lookup failed, proceeding to generate", { error: String(e) });
      }
    }

    // ANOTHER DELIVERER IS MAKING IT. The webhook claims the session first and
    // generates for up to a minute; generating here as well was the doubled
    // model spend of every bound sale. A row marked generating in the last
    // few minutes is answered inProgress, and the page asks again: for EVERY
    // generated product without a saved copy, whatever the page asked for
    // (S11-054: the streamed products were never told, and made a second copy).
    if (!generatedContent && !isFirstUse && SAVED_COPY_PRODUCT_TYPES.includes(productType ?? '')) {
      try {
        const { data: row } = await supabase
          .from('product_deliveries')
          .select('status, content_generation_started_at, lease_until')
          .eq('stripe_session_id', sessionId)
          .maybeSingle();
        const r = row as { status?: string; content_generation_started_at?: string; lease_until?: string | null } | null;
        seenStatus = typeof r?.status === 'string' ? r.status : null;
        const started = Date.parse(String(r?.content_generation_started_at ?? ''));
        const leaseUntil = Date.parse(String(r?.lease_until ?? ''));
        // A live lease is another maker's (20261011144000); a row leased by
        // an older build carries no lease, and is judged by its start stamp.
        inProgress = r?.status === 'generating'
          && (Number.isFinite(leaseUntil)
            ? leaseUntil > Date.now()
            : Number.isFinite(started) && Date.now() - started < GENERATION_IN_PROGRESS_MS);
        if (inProgress) logStep("Generation in progress elsewhere; not generating twice", { sessionId });
      } catch (e) {
        logStep("Delivery status unreadable; generating here", { error: String(e) });
      }
    }

    // THE LEASE (20261011144000, CP-019). Before this page makes a product it
    // keeps a copy of, it takes the order: the webhook, the sweep and a second
    // tab are told "in progress" while the lease is live, and a lease that
    // expired (a maker that died) is reclaimed. NULL means another maker took
    // it between the read above and now: it is theirs, and the page waits.
    // The two products made afresh on every visit are not leased (a second
    // tab would be held for ten minutes for nothing).
    if (generateContent && resumeSessionId && !generatedContent && !inProgress && SAVED_COPY_PRODUCT_TYPES.includes(productType ?? '')) {
      const { data: token, error: leaseError } = await supabase.rpc('take_delivery_lease', {
        p_stripe_session_id: sessionId, p_seen_status: seenStatus ?? 'payment_received', p_minutes: LEASE_MINUTES,
        p_product_type: productType ?? 'unknown', p_email: customerEmail,
      });
      if (leaseError) {
        logStep("The delivery lease could not be taken; generating without it", { error: leaseError.message });
      } else if (!token) {
        inProgress = true;
        logStep("Another maker took this order first; not generating twice", { sessionId });
      } else {
        leaseToken = String(token);
      }
    }
    // How this page records that it made the order: with the lease it holds
    // (finish_delivery_generation, status 'generated'), refused when another
    // maker finished first, in which case that maker mails its copy and this
    // page mails nothing; without a lease, the step writer as before.
    const recordMade = async (durationMs: number): Promise<boolean> => {
      if (!leaseToken) {
        await supabase.rpc('log_delivery_step', {
          p_stripe_session_id: sessionId, p_step: 'generation_completed', p_success: true, p_duration_ms: durationMs,
        });
        return true;
      }
      const { data: finished, error: finishError } = await supabase.rpc('finish_delivery_generation', {
        p_stripe_session_id: sessionId, p_lease_token: leaseToken, p_status: 'generated', p_duration_ms: durationMs,
      });
      if (finishError) {
        logStep("The finish could not be recorded; the sweep mails the saved copy once the lease expires", { error: finishError.message });
        return false;
      }
      if (finished !== true) {
        logStep("Another maker finished this order first; it mails its copy, this page mails nothing", { sessionId });
        return false;
      }
      return true;
    };

    if (generateContent && resumeSessionId && !generatedContent && !inProgress) {
      logStep("Content generation requested", { productType, resumeSessionId });

      // Log generation started (the lease above already did, when one was taken)
      if (!leaseToken) {
        await supabase.rpc('log_delivery_step', {
          p_stripe_session_id: sessionId,
          p_step: 'generation_started'
        });
      }

      const generationStartTime = Date.now();
      
      // Get stored resume data
      const { data: resumeData, error: resumeError } = await supabase
        .rpc('get_temp_resume', { p_session_id: resumeSessionId });

      if (resumeError) {
        resumeUnreadable = true;
        logStep("Error fetching resume data", { error: resumeError.message });
      } else if (resumeData && resumeData.length > 0) {
        const { resume_text, job_description_text } = resumeData[0];
        logStep("Resume data found", { 
          resumeLength: resume_text?.length, 
          hasJobDescription: !!job_description_text 
        });

        // Extract job details from job description if available
        // This ensures content generators have proper context
        const jobTitle = session.metadata?.job_title || 'Target Position';
        const jobCompany = session.metadata?.job_company || '';
        // Captured at checkout time (create-product-checkout) since this
        // runs server-side with no access to the browser's i18n state.
        const language = session.metadata?.language || 'en';

        // Generate content based on product type
        if (productType === 'apply_assistant' && resume_text && !job_description_text) {
          needsJobPosting = true;
          logStep("Apply Assistant has no job posting: it cannot be made; the sweep asks the buyer for it", { sessionId: sessionId.substring(0, 20) });
          // generation_failed with the reason, due now: the next sweep spends
          // the row, mails the buyer once for the posting and tells the owner.
          await supabase.rpc('log_delivery_step', {
            p_stripe_session_id: sessionId,
            p_step: 'generation_completed',
            p_success: false,
            p_error: 'job_posting_required: no job posting is attached to this Apply Assistant purchase',
          });
          await supabase.from('product_deliveries').update({ next_retry_at: new Date().toISOString() })
            .eq('stripe_session_id', sessionId).eq('status', 'generation_failed');
          undelivered = 'job_posting_required';
          await releaseLease();
        } else if (productType === 'apply_assistant' && resume_text && job_description_text) {
          logStep("Calling generate-apply-package + generate-cover-letter");
          const [packageResponse, coverLetterResponse] = await Promise.all([
            // The session is the generator's proof of purchase (a cs_ id is
            // re-read from Stripe; a pro_ grant by the claim made above).
            fetch(`${supabaseUrl}/functions/v1/generate-apply-package`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
              body: JSON.stringify({ resumeText: resume_text, jobPostingText: job_description_text, language, sessionId })
            }),
            // The service-role key: the generator's spend gate never counts
            // our own servers by address or against its free ceiling; the
            // session still counts against this purchase's daily allowance,
            // which bounds the regeneration every refresh can trigger here.
            fetch(`${supabaseUrl}/functions/v1/generate-cover-letter`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
              body: JSON.stringify({ resumeText: resume_text, jobDescription: job_description_text, jobTitle, jobCompany, tone: 'professional', language, sessionId })
            })
          ]);

          const applyGenDuration = Date.now() - generationStartTime;

          if (packageResponse.ok) {
            const packageResult = await packageResponse.json();
            const coverLetterResult = coverLetterResponse.ok ? await coverLetterResponse.json() : null;
            generatedContent = {
              jobMetadata: packageResult.jobMetadata,
              tailoredResume: packageResult.tailoredResume,
              skillGaps: packageResult.skillGaps,
              checklist: packageResult.checklist,
              coverLetter: coverLetterResult?.data?.coverLetter || null,
              modelUsed: packageResult.modelUsed,
              // What the fact check removed, shown with the saved copy (S11-055).
              groundingReport: packageResult.groundingReport ?? null,
            };
            logStep("Apply package generated successfully");

            await supabase.rpc('save_purchased_content', {
              p_stripe_session_id: sessionId,
              p_customer_email: customerEmail || '',
              p_product_type: productType,
              p_product_name: productName,
              p_generated_content: generatedContent
            });
            logStep("Content saved for recovery");
            generatedHere = await recordMade(applyGenDuration);
          } else {
            const errorText = await packageResponse.text();
            logStep("Apply package generation failed", { status: packageResponse.status, error: errorText });
            undelivered = `generate-apply-package ${packageResponse.status}: ${errorText}`.slice(0, 500);

            await supabase.rpc('log_delivery_step', {
              p_stripe_session_id: sessionId,
              p_step: 'generation_completed',
              p_success: false,
              p_error: errorText.substring(0, 500),
              p_duration_ms: applyGenDuration
            });
            await releaseLease();
          }
        } else {
          const request = resume_text
            ? buildGenerationRequest(productType, resume_text, job_description_text || '', jobTitle, jobCompany, language, sessionId, boughtRoles)
            : null;

          if (request) {
            logStep(`Calling ${request.endpoint}`);
            // The service-role key, as for the Apply Assistant's letter above.
            const genResponse = await fetch(`${supabaseUrl}/functions/v1/${request.endpoint}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
              },
              body: JSON.stringify(request.body)
            });

            const genDuration = Date.now() - generationStartTime;
            // Every generator answers {success, data}; a 200 without a payload
            // is recorded as the failure it is (L6-02), never as success.
            const genResult = genResponse.ok ? await genResponse.json().catch(() => null) : null;

            if (genResponse.ok && genResult?.data) {
              generatedContent = genResult.data;
              logStep(`${request.endpoint} generated successfully`);

              // Save content permanently for customer recovery
              const { error: saveError } = await supabase.rpc('save_purchased_content', {
                p_stripe_session_id: sessionId,
                p_customer_email: customerEmail || '',
                p_product_type: productType,
                p_product_name: productName,
                p_generated_content: generatedContent
              });
              if (saveError) {
                logStep("Content could NOT be saved for recovery", { error: saveError.message });
                generatedHere = false;
                await supabase.rpc('log_delivery_step', {
                  p_stripe_session_id: sessionId,
                  p_step: 'generation_completed',
                  p_success: false,
                  p_error: `save_purchased_content: ${saveError.message}`.slice(0, 500),
                  p_duration_ms: genDuration
                });
                await releaseLease();
              } else {
                logStep("Content saved for recovery");
                generatedHere = await recordMade(genDuration);
              }
            } else {
              const errorText = genResponse.ok ? `${request.endpoint} answered 200 with no content` : await genResponse.text();
              logStep(`${request.endpoint} generation failed`, { status: genResponse.status, error: errorText });
              undelivered = `${request.endpoint} ${genResponse.status}: ${errorText}`.slice(0, 500);

              await supabase.rpc('log_delivery_step', {
                p_stripe_session_id: sessionId,
                p_step: 'generation_completed',
                p_success: false,
                p_error: errorText.substring(0, 500),
                p_duration_ms: genDuration
              });
              await releaseLease();
            }
          } else {
            logStep("No matching content generator", { productType, hasResumeText: !!resume_text });
          }
        }
      } else {
        resumeUnreadable = true;
        logStep("No resume data found for session", { resumeSessionId });
      }
    } else if (generateContent && !resumeSessionId) {
      logStep("Content generation requested but no resume session ID available");
    }

    // Asked to generate a product this path generates, and nothing came of it
    // without a failure being recorded above (no résumé linked, or the stored
    // one gone): that is a failed delivery too, not a sale to confirm.
    if (generateContent && !generatedContent && !undelivered && !inProgress && GENERATED_PRODUCT_TYPES.includes(productType ?? '')) {
      await recordUndelivered(resumeSessionId
        ? 'The résumé for this purchase could not be read; nothing was generated'
        : 'No résumé is linked to this purchase; nothing was generated');
    }

    // Handle credits for scan pack (used by both create-product-checkout and create-scan-pack-checkout)
    if ((productType === 'scan_pack' || productType === 'scan_credits') && isFirstUse && customerEmail) {
      // Metadata first, then line_items quantity, then 10; capped at 500 --
      // matches stripe-webhook (creditsBoughtBy above).
      const credits = purchasedCredits ?? creditsBoughtBy(session);

      logStep("Adding scan pack credits", { credits, email: maskEmail(customerEmail), productType });

      const { error: creditError } = await supabase.rpc('add_scan_credits', {
        p_email: customerEmail,
        p_credits: credits
      });

      if (creditError) {
        logStep("Error adding scan pack credits", { error: creditError.message });
        await recordUndelivered(`add_scan_credits: ${creditError.message}`);
      } else {
        logStep("Scan pack credits added successfully", { credits, email: maskEmail(customerEmail) });
        generatedContent = { credits, message: `${credits} scan credits added to your account` };
      }
    }

    // Handle credits for career bundle
    if (productType === 'career_bundle' && isFirstUse && customerEmail) {
      const credits = purchasedCredits ?? creditsBoughtBy(session);
      logStep("Adding career bundle credits", { credits, email: maskEmail(customerEmail) });

      const { error: creditError } = await supabase.rpc('add_scan_credits', {
        p_email: customerEmail,
        p_credits: credits // capped at 500 by creditsBoughtBy -- matches stripe-webhook
      });

      if (creditError) {
        logStep("Error adding career bundle credits", { error: creditError.message });
        await recordUndelivered(`add_scan_credits: ${creditError.message}`);
      } else {
        logStep("Career bundle credits added successfully", { credits, email: maskEmail(customerEmail) });
        generatedContent = { credits, message: `${credits} scan credits added to your account` };
      }
    }

    // THE RECEIPT FOR CREDITS THIS PATH ADDED. Since 20261005110000 a sale this
    // page claims first has a delivery row, and the retry sweeper re-credits a
    // scan row it finds undelivered unless a receipt shows the credits landed.
    // Written beside the credit, and the row moved past payment_received, so
    // a buyer is never credited twice for one purchase.
    if (isFirstUse && customerEmail && isScanProduct
        && generatedContent && typeof generatedContent === 'object' && 'credits' in generatedContent) {
      const { error: receiptError } = await supabase.rpc('save_purchased_content', {
        p_stripe_session_id: sessionId,
        p_customer_email: customerEmail,
        p_product_type: productType,
        p_product_name: productName || `${generatedContent.credits} Scan Credits`,
        p_generated_content: generatedContent
      });
      if (receiptError) logStep("Credits added but the receipt was not saved", { error: receiptError.message });
      await supabase.rpc('log_delivery_step', {
        p_stripe_session_id: sessionId,
        p_step: 'generation_completed',
        p_success: true
      });
    }

    // Record affiliate conversion if there was a referral
    const referralCode = session.metadata?.referral_code;
    if (referralCode && isFirstUse && session.amount_total) {
      // Commission rates: $1 for basic products, $5 for premium products.
      // applyAssistant is $7 — without being in this list it defaulted to the $5
      // premium-tier commission, leaving only ~$2 to cover the Stripe fee and two
      // AI generation calls on every affiliate-referred sale.
      const lowCommissionProducts = ['basic_keyword_fix', 'cover_letter', 'scan_pack', 'scan_credits', 'career_bundle', 'interview_coach', 'career_path_simulator', 'apply_assistant'];
      // A checkout the affiliate page promises nothing for marks its referral
      // "none" (_shared/checkout-policy.ts): recorded at $0, never paid. A
      // checkout that names its commission (metadata.referral_commission_cents,
      // written by our checkout code) is paid exactly that, as the webhook
      // pays it (the flat $10 on a referred first Pro month, 2026-10-12).
      const rawNamed = session.metadata?.referral_commission_cents;
      const namedCommission = typeof rawNamed === "string" && /^\d{1,5}$/.test(rawNamed) && Number(rawNamed) <= 10_000 ? Number(rawNamed) : null;
      const commissionCents = session.metadata?.referral_commission === "none" ? 0
        : namedCommission !== null ? namedCommission
        : lowCommissionProducts.includes(productType || '') ? 100 : 500;
      logStep("Recording affiliate conversion", { 
        referralCode, 
        amount: session.amount_total,
        commission: commissionCents,
        productType 
      });
      
      const { error: affiliateError } = await supabase.rpc('record_affiliate_conversion', {
        p_referral_code: referralCode,
        p_stripe_session_id: sessionId,
        p_product_name: productName || productType || 'Product',
        p_sale_amount: session.amount_total,
        p_commission_override: commissionCents
      });

      if (affiliateError) {
        logStep("Affiliate conversion recording failed", { error: affiliateError.message });
      } else {
        logStep("Affiliate conversion recorded successfully");
        
        // Send email notification to affiliate
        try {
          const { data: affiliateData } = await supabase
            .from('affiliates')
            .select('email')
            .eq('referral_code', referralCode)
            .single();
          
          if (affiliateData?.email && commissionCents > 0) {
            const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
            // The service-role key: the commission mailer is internal and
            // refuses the publishable key, which every visitor holds.
            const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-affiliate-commission-email`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
              },
              body: JSON.stringify({
                affiliateEmail: affiliateData.email,
                productName: productName || productType,
                saleAmount: session.amount_total,
                commissionAmount: commissionCents,
                referralCode
              })
            });
            // Previously logged "sent" unconditionally without checking the
            // response — a misconfigured RESEND_API_KEY or a send failure
            // would silently look successful in these logs.
            if (emailResponse.ok) {
              logStep("Affiliate commission email sent", { email: affiliateData.email });
            } else {
              logStep("Affiliate commission email failed", { email: affiliateData.email, status: emailResponse.status });
            }
          }
        } catch (emailErr) {
          logStep("Affiliate email notification failed", { error: String(emailErr) });
          // Don't fail the whole request for email errors
        }
      }
    }
    let emailSent = false;
    if (isFirstUse && customerEmail && undelivered) {
      // Not mailed: the row stays generation_failed with the reason above
      // for the retry sweeper, which mails a product when it has made it.
      logStep("Confirmation mail held back: this delivery failed and is left for the retry sweeper", { reason: undelivered });
    }
    // NEVER "READY" WITH NOTHING BEHIND IT (S8-009). Claiming a generated
    // product without content in hand (the page asked for none, or it is
    // still being made) used to mail "Your X is Ready!" with no content and
    // log email_sent, which closes the delivery row as delivered: if the page
    // then could not generate, the retry sweeper never looked at the row
    // again. The row stays at payment_received; the sweeper makes it and
    // mails it.
    const nothingToSend = GENERATED_PRODUCT_TYPES.includes(productType ?? '') && !generatedContent;
    // A refused mail is the sweep's to resend from the saved copy, at once
    // (CP-021): email_failed, due now, never waiting on an older schedule.
    const dueNowForTheSweep = async () => {
      try {
        await supabase.from('product_deliveries').update({ next_retry_at: new Date().toISOString() })
          .eq('stripe_session_id', sessionId).eq('status', 'email_failed');
      } catch (e) {
        logStep("Could not make the failed mail due now", { error: String(e) });
      }
    };
    if (isFirstUse && customerEmail && !undelivered && nothingToSend) {
      logStep("Confirmation mail held back: nothing has been made yet; the retry sweeper delivers it", { sessionId });
    }
    // Mailed by the call that claimed the session first, or by the call that
    // made the product (CP-021: a non-first call that made it used to save it
    // and mail nobody, leaving a 'generated' row no sweep ever selected).
    const mailsTheBuyer = isFirstUse || generatedHere;
    if (mailsTheBuyer && customerEmail && !undelivered && !nothingToSend) {
      try {
        // The service-role key: send-product-email is internal and refuses
        // the publishable key, which every visitor holds.
        const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-product-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
          },
          body: JSON.stringify({
            email: customerEmail,
            productType,
            productName,
            generatedContent,
            // The link that reopens the purchase, and its id (S8-015).
            sessionId
          })
        });

        if (emailResponse.ok) {
          emailSent = true;
          logStep("Confirmation email sent", { email: maskEmail(customerEmail) });
          
          // Log email sent successfully
          await supabase.rpc('log_delivery_step', {
            p_stripe_session_id: sessionId,
            p_step: 'email_sent',
            p_success: true
          });
        } else {
          logStep("Email send failed", { status: emailResponse.status });
          
          // Log email failed
          await supabase.rpc('log_delivery_step', {
            p_stripe_session_id: sessionId,
            p_step: 'email_sent',
            p_success: false,
            p_error: `Email send failed with status ${emailResponse.status}`
          });
          await dueNowForTheSweep();
        }
      } catch (emailError) {
        logStep("Email error", { error: String(emailError) });
        
        // Log email error
        await supabase.rpc('log_delivery_step', {
          p_stripe_session_id: sessionId,
          p_step: 'email_sent',
          p_success: false,
          p_error: String(emailError).substring(0, 500)
        });
        await dueNowForTheSweep();
        // Don't fail the request if email fails
      }
    }

    // Masked unless this caller's own account proved that mailbox (R1).
    const showBuyerEmail = await callerProvedMailbox(req, supabase, customerEmail);

    return new Response(
      JSON.stringify({
        success: true,
        verified: true,
        isFirstUse,
        productType,
        productName,
        customerEmail: showBuyerEmail ? customerEmail : maskEmail(customerEmail),
        customerEmailMasked: !!customerEmail && !showBuyerEmail,
        // Whether THIS call mailed the confirmation. When the webhook claimed
        // the session first it sends the mail itself, to customerEmail; with
        // no address on the purchase nobody sends anything, and the page must
        // not say otherwise.
        emailSent,
        generatedContent,
        // The webhook is still making it: ask again shortly (S8-009).
        inProgress,
        // A résumé is bound AND readable: the retry sweep can make the product
        // from it, so the page makes nothing of its own (review of S11-054).
        hasResumeData: !!resumeSessionId && !resumeUnreadable && !needsJobPosting,
        // Nothing can make it until the buyer sends the posting (S12-054).
        ...(needsJobPosting ? { needsJobPosting: true } : {}),
        // The ATS Defense roles named at checkout, for the page's own fallback (S11-074).
        ...(productType === 'ats_defense' ? { targetRoles: boughtRoles } : {}),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[VERIFY-PRODUCT-PURCHASE] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: "Failed to verify purchase", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
