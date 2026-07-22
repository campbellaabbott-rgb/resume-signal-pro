// Claim-your-profile: employers prove they work at a company on the board by
// verifying a work email. Two actions:
//   { action: "request", companyToken, companyName?, workEmail, contactName?, website? }
//     -> stores a claim row + emails a verification link to the work address.
//   { action: "verify", token }
//     -> link click. Domain-matching claims verify fully; others become
//        email_confirmed for manual owner review.
// Badge reads go through the public RPC get_company_claim_status, not here.
// Verification is identity only — it never changes any computed data; that
// fence (stated on /trust) is why this function has no write path to any
// posting or hiring-health table.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Email links always point at production — never trust the request origin
// inside an email we send on an anonymous caller's behalf.
const SITE = "https://resumebooster.work";
const OWNER_EMAIL = Deno.env.get("OWNER_NOTIFY_EMAIL") ?? "resumeboostersupp@gmail.com";

// A claim needs a WORK email — the whole point is domain ownership.
const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "live.com", "aol.com", "icloud.com", "me.com", "proton.me", "protonmail.com",
  "gmx.com", "mail.com", "yandex.com", "zoho.com",
]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Does the work-email domain plausibly belong to this company? Compares the
    domain's registrable label against the board token and stated name. */
function domainMatches(email: string, companyToken: string, companyName: string): boolean {
  const domain = email.split("@")[1] ?? "";
  const label = normalize(domain.split(".").slice(0, -1).join(""));
  if (label.length < 3) return false;
  const token = normalize(companyToken);
  const name = normalize(companyName);
  return (token.length >= 3 && (label.includes(token) || token.includes(label)))
      || (name.length >= 3 && (label.includes(name) || name.includes(label)));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const body = await req.json().catch(() => ({}));

    // Admin review actions — gated by ADMIN_API_KEY (same x-admin-key pattern
    // as the analytics/error dashboards), and exempt from the public IP rate
    // limit so reviewing a batch of claims can't lock the owner out.
    if (body.action === "admin-list" || body.action === "admin-decide") {
      const adminApiKey = Deno.env.get("ADMIN_API_KEY");
      const provided = req.headers.get("x-admin-key");
      if (!adminApiKey || provided !== adminApiKey) {
        return json({ error: "Unauthorized." }, 401);
      }

      if (body.action === "admin-list") {
        const { data, error } = await supabase
          .from("company_claims")
          .select("id, company_token, company_name, work_email, contact_name, website, domain_match, status, created_at, verified_at")
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) {
          console.error("[COMPANY-CLAIM] admin-list failed:", error);
          return json({ error: "Could not load claims." }, 500);
        }
        return json({ claims: data ?? [] });
      }

      // admin-decide
      const id = typeof body.id === "string" ? body.id : "";
      const decision = body.decision;
      if (!/^[0-9a-f-]{36}$/i.test(id) || (decision !== "verified" && decision !== "rejected")) {
        return json({ error: "Need a claim id and a decision of verified or rejected." }, 400);
      }
      const { data: claim } = await supabase
        .from("company_claims")
        .select("id, status, work_email, company_name, company_token")
        .eq("id", id).maybeSingle();
      if (!claim) return json({ error: "Claim not found." }, 404);

      const { error: updateError } = await supabase
        .from("company_claims")
        .update({ status: decision, verified_at: decision === "verified" ? new Date().toISOString() : null })
        .eq("id", id);
      if (updateError) {
        console.error("[COMPANY-CLAIM] admin-decide failed:", updateError);
        return json({ error: "Could not update the claim." }, 500);
      }

      // Tell the claimant when they're approved (best effort — the decision
      // stands even if the email fails). Rejections stay silent.
      if (decision === "verified") {
        const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
        if (RESEND_API_KEY) {
          const displayName = claim.company_name || claim.company_token;
          await new Resend(RESEND_API_KEY).emails.send({
            from: "Resume Booster <reports@resumebooster.work>",
            to: [claim.work_email],
            subject: `Your claim of ${displayName} is verified`,
            html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#111;max-width:520px">
              <p>Your claim of <b>${displayName}</b> on resumebooster.work has been reviewed and verified. The company page now shows a Verified employer badge:</p>
              <p><a href="${SITE}/jobs/company/${encodeURIComponent(claim.company_token)}">${SITE}/jobs/company/${claim.company_token}</a></p>
              <p style="font-size:12px;color:#64748b">Verification confirms identity only — the hiring data shown is computed from public postings and is not editable by anyone, including verified employers.</p>
            </div>`,
          }).catch((e) => console.error("[COMPANY-CLAIM] approval notify failed:", e));
        }
      }

      console.log(`[COMPANY-CLAIM] admin decision: claim ${id} -> ${decision}`);
      return json({ status: decision });
    }

    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
    const { data: allowed } = await supabase.rpc("check_rate_limit", {
      p_function: "company-claim", p_ip: clientIp, p_max_requests: 10, p_window_minutes: 60,
    });
    if (!allowed) return json({ error: "Rate limit exceeded." }, 429);

    if (body.action === "verify") {
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: "Invalid verification token." }, 400);

      const { data: claim } = await supabase
        .from("company_claims").select("id, status, domain_match")
        .eq("verify_token", token).maybeSingle();
      if (!claim) return json({ error: "Verification link not recognized." }, 404);

      if (claim.status === "verified" || claim.status === "email_confirmed") {
        return json({ status: claim.status });
      }
      if (claim.status === "rejected") return json({ error: "This claim was declined." }, 410);

      const next = claim.domain_match ? "verified" : "email_confirmed";
      await supabase.from("company_claims")
        .update({ status: next, verified_at: next === "verified" ? new Date().toISOString() : null })
        .eq("id", claim.id);
      console.log(`[COMPANY-CLAIM] claim ${claim.id} -> ${next}`);
      return json({ status: next });
    }

    if (body.action === "request") {
      const companyToken = typeof body.companyToken === "string" ? body.companyToken.trim().slice(0, 120) : "";
      const companyName = typeof body.companyName === "string" ? body.companyName.trim().slice(0, 200) : "";
      const workEmail = typeof body.workEmail === "string" ? body.workEmail.trim().toLowerCase().slice(0, 200) : "";
      const contactName = typeof body.contactName === "string" ? body.contactName.trim().slice(0, 200) : null;
      const website = typeof body.website === "string" ? body.website.trim().slice(0, 300) : null;

      if (!companyToken) return json({ error: "Missing company." }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) return json({ error: "A valid email is required." }, 400);
      const domain = workEmail.split("@")[1] ?? "";
      if (FREE_MAIL.has(domain)) {
        return json({ error: "Please use your work email — claims need an address at the company's own domain." }, 400);
      }

      // The claimed company must actually exist on the board.
      const { count } = await supabase
        .from("job_board_postings").select("id", { count: "exact", head: true })
        .eq("company_token", companyToken).limit(1);
      if (!count) return json({ error: "Company not found on the board." }, 404);

      const match = domainMatches(workEmail, companyToken, companyName);

      // Dedupe: same company+email keeps its row (and verify token). A fresh
      // request within 10 minutes doesn't re-send — bounds email abuse.
      const { data: existing } = await supabase
        .from("company_claims").select("id, status, verify_token, created_at")
        .eq("company_token", companyToken).eq("work_email", workEmail).maybeSingle();
      if (existing?.status === "verified") return json({ status: "verified" });
      if (existing && Date.now() - new Date(existing.created_at).getTime() < 10 * 60_000) {
        return json({ status: "sent" });
      }

      let verifyToken = existing?.verify_token as string | undefined;
      if (existing) {
        await supabase.from("company_claims")
          .update({ contact_name: contactName, website, company_name: companyName || null, domain_match: match })
          .eq("id", existing.id);
      } else {
        const { data: inserted, error } = await supabase.from("company_claims")
          .insert({
            company_token: companyToken, company_name: companyName || null,
            work_email: workEmail, contact_name: contactName, website, domain_match: match,
          })
          .select("verify_token").single();
        if (error || !inserted) {
          console.error("[COMPANY-CLAIM] insert failed:", error);
          return json({ error: "Could not record the claim. Please try again." }, 500);
        }
        verifyToken = inserted.verify_token as string;
      }

      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      if (!RESEND_API_KEY) return json({ error: "Email is not configured." }, 503);
      const resend = new Resend(RESEND_API_KEY);

      const displayName = companyName || companyToken;
      const verifyUrl = `${SITE}/jobs/company/${encodeURIComponent(companyToken)}?claim_verify=${verifyToken}`;
      const { error: sendError } = await resend.emails.send({
        from: "Resume Booster <reports@resumebooster.work>",
        to: [workEmail],
        subject: `Verify your claim of ${displayName} on Resume Booster`,
        html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#111;max-width:520px">
          <p>Someone (hopefully you) asked to claim the <b>${displayName}</b> company profile on resumebooster.work using this address.</p>
          <p><a href="${verifyUrl}" style="display:inline-block;padding:10px 18px;background:#0ea5e9;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Verify this claim</a></p>
          <p style="font-size:12px;color:#64748b">Verification confirms your identity as an employer contact. It never changes the hiring data we show — fills, re-listing patterns, and badges are computed from public postings and are not editable by anyone, including verified employers.</p>
          <p style="font-size:12px;color:#64748b">If you didn't request this, ignore this email — nothing happens without the click.</p>
        </div>`,
      });
      if (sendError) {
        console.error("[COMPANY-CLAIM] verification send failed:", sendError);
        return json({ error: "Could not send the verification email. Please try again." }, 502);
      }

      // Owner heads-up (best effort — the claim stands even if this fails).
      await resend.emails.send({
        from: "Resume Booster <reports@resumebooster.work>",
        to: [OWNER_EMAIL],
        subject: `🏢 Company claim request: ${displayName}`,
        html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#111">
          <p><b>${displayName}</b> (token: ${companyToken})</p>
          <p>From: ${workEmail}${contactName ? ` (${contactName})` : ""}${website ? ` · ${website}` : ""}</p>
          <p>Domain match: <b>${match ? "yes — auto-verifies on click" : "NO — needs manual review after email confirm"}</b></p>
          <p><a href="${SITE}/admin/claims">Review claims</a></p>
        </div>`,
      }).catch((e) => console.error("[COMPANY-CLAIM] owner notify failed:", e));

      console.log(`[COMPANY-CLAIM] request stored for ${companyToken} (${workEmail}), domain_match=${match}`);
      return json({ status: "sent" });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error("[COMPANY-CLAIM] Uncaught:", e);
    return json({ error: "Unexpected error." }, 500);
  }
});
