// deploy-stamp: 2026-10-08T12:00Z
// Claim-your-profile: employers prove they work at a company on the board by
// verifying a work email. Two actions:
//   { action: "request", companyToken, workEmail, contactName?, website? }
//     -> stores a claim row + emails a verification link to the work address.
//   { action: "verify", token }
//     -> link click. Domain-matching claims verify fully; others become
//        email_confirmed for manual owner review.
// Badge reads go through the public RPC get_company_claim_status, not here.
// Verification is identity only — it never changes any computed data; that
// fence (stated on /trust) is why this function has no write path to any
// posting or hiring-health table.
//
// IT WAS A MAIL RELAY (2026-10-04). Anyone could POST a request with no key
// and choose the recipient (any non-freemail address), the company name (up to
// 200 characters, printed RAW into the subject and the HTML body), and a fresh
// limiter bucket on every request (it was keyed on the FIRST x-forwarded-for
// hop, which the caller writes). Rotating company tokens re-mailed the same
// victim, and every request mailed the owner too. So a script could send
// "Verify your claim of </b><a href=evil>Confirm your payroll change</a>" from
// reports@resumebooster.work, passing SPF and DKIM, as often as it liked.
//
// What holds now:
//   - THE MAIL CARRIES NOTHING THE CALLER WROTE. The company named in both
//     mails is the board's own name for the token (job_board_postings.company),
//     never the request's companyName, and every value is escaped. The board's
//     name is also what the domain match compares against, so a caller can no
//     longer pass their own domain label off as the company's name.
//   - IT COUNTS THE NETWORK, THE INBOX AND THE DAY: 10 calls an hour and 10
//     requests a day per network (the platform's address via networkBucket,
//     never a header the caller writes), 2 verification mails a day per inbox
//     however many companies are named, and 200 a day overall (reaching it
//     tells the owner). The owner's own heads-up stops after 20 a day; the
//     claims are all on /admin/claims regardless.
//   - The admin key is compared in constant time.
//
// A CHEAP DOMAIN NO LONGER MAKES ITS OWNER AN EMPLOYER (2026-10-08, register
// L13-06). The match was a two-way substring test between the email domain's
// label and the board's token or name, so x@nth.io verified as Anthropic and
// hr@dbank.xyz as TD Bank. It is now an exact registrable-domain match against
// a host the board itself links to for the company (domain-proof.ts); anything
// else waits for the owner. The claimant's website is shown on the company page
// only after the owner approves the claim (owner_approved_at, 20261008122000).
// And a repeat request re-sends only after 10 minutes from the LAST send
// (last_sent_at): the guard keyed on created_at, so after a row's first 10
// minutes every request re-sent (L10-12).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { networkBucket } from "../_shared/network-bucket.ts";
import { sameSecret } from "../_shared/service-caller.ts";
import { alertOwnerOnce } from "../_shared/owner-alert.ts";
import { domainProven, employerDomains } from "./domain-proof.ts";

// Provable from outside without sending anything: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "company-claim.2026-10-08.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "x-fn-build": FN_BUILD,
};

// Email links always point at production — never trust the request origin
// inside an email we send on an anonymous caller's behalf.
const SITE = "https://resumebooster.work";
const FROM = "Resume Booster <reports@resumebooster.work>";
const OWNER_EMAIL = Deno.env.get("OWNER_NOTIFY_EMAIL") ?? "resumeboostersupp@gmail.com";

const PER_NETWORK_PER_HOUR = 10;
const REQUESTS_PER_NETWORK_PER_DAY = 10;
const MAILS_PER_INBOX_PER_DAY = 2;
const MAILS_PER_DAY = 200;
const OWNER_NOTES_PER_DAY = 20;
/** No second verification mail to the same (company, address) inside this. */
const RESEND_AFTER_MS = 10 * 60_000;
/** Apply URLs read per company to learn the employer's own domains. */
const APPLY_HOSTS_READ = 50;

// A claim needs a WORK email — the whole point is domain ownership.
const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "live.com", "aol.com", "icloud.com", "me.com", "proton.me", "protonmail.com",
  "gmx.com", "mail.com", "yandex.com", "zoho.com",
]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function escapeHtml(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return "";
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/** One line for a subject: no control characters, no line breaks, clipped. */
const subjectSafe = (s: string, max = 80): string =>
  s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

// deno-lint-ignore no-explicit-any
type Admin = any;

/** One count at a mail door (mail_door_take, 20261004100000). "ok" only when the database said yes. */
async function take(admin: Admin, door: string, bucket: string, max: number, windowMinutes: number): Promise<"ok" | "full" | "error"> {
  const { data, error } = await admin.rpc("mail_door_take", {
    p_door: door, p_bucket: bucket, p_max: max, p_window_minutes: windowMinutes,
  });
  if (error) {
    console.error(`[COMPANY-CLAIM] ${door} count failed:`, error.message?.slice(0, 160));
    return "error";
  }
  return data === true ? "ok" : "full";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      serviceKey,
      { auth: { persistSession: false } },
    );

    const body = await req.json().catch(() => ({}));
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

    // Admin review actions — gated by ADMIN_API_KEY (same x-admin-key pattern
    // as the analytics/error dashboards), and exempt from the public limits so
    // reviewing a batch of claims can't lock the owner out.
    if (body.action === "admin-list" || body.action === "admin-decide") {
      const adminApiKey = Deno.env.get("ADMIN_API_KEY") ?? "";
      const provided = req.headers.get("x-admin-key") ?? "";
      if (!adminApiKey || !sameSecret(provided, adminApiKey)) {
        return json({ error: "Unauthorized." }, 401);
      }

      if (body.action === "admin-list") {
        const { data, error } = await supabase
          .from("company_claims")
          .select("id, company_token, company_name, work_email, contact_name, website, domain_match, status, created_at, verified_at, owner_approved_at")
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
        .select("id, status, work_email, company_name, company_token, verified_at")
        .eq("id", id).maybeSingle();
      if (!claim) return json({ error: "Claim not found." }, 404);

      // The owner's approval is what shows the claimant's website on the
      // company page; a revoke withdraws it.
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("company_claims")
        .update({
          status: decision,
          verified_at: decision === "verified" ? (claim.status === "verified" ? claim.verified_at ?? now : now) : null,
          owner_approved_at: decision === "verified" ? now : null,
        })
        .eq("id", id);
      if (updateError) {
        console.error("[COMPANY-CLAIM] admin-decide failed:", updateError);
        return json({ error: "Could not update the claim." }, 500);
      }

      // Tell the claimant when they're approved (best effort — the decision
      // stands even if the email fails). Rejections stay silent. A row
      // written before 2026-10-04 may hold a caller's company name, so the
      // name is escaped here too.
      if (decision === "verified" && claim.status !== "verified" && RESEND_API_KEY) {
        const displayName = String(claim.company_name || claim.company_token);
        const pageUrl = `${SITE}/jobs/company/${encodeURIComponent(claim.company_token)}`;
        await new Resend(RESEND_API_KEY).emails.send({
          from: FROM,
          to: [claim.work_email],
          subject: `Your claim of ${subjectSafe(displayName)} is verified`,
          html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#111;max-width:520px">
            <p>Your claim of <b>${escapeHtml(displayName)}</b> on resumebooster.work has been reviewed and verified. The company page now shows a Verified employer badge:</p>
            <p><a href="${escapeHtml(pageUrl)}">${escapeHtml(pageUrl)}</a></p>
            <p style="font-size:12px;color:#64748b">Verification confirms identity only — the hiring data shown is computed from public postings and is not editable by anyone, including verified employers.</p>
          </div>`,
        }).catch((e) => console.error("[COMPANY-CLAIM] approval notify failed:", e));
      }

      console.log(`[COMPANY-CLAIM] admin decision: claim ${id} -> ${decision}`);
      return json({ status: decision });
    }

    // THE NETWORK, from the platform's address (never the first forwarded
    // hop, which the caller writes). A count that cannot be taken keeps the
    // door shut.
    const net = await networkBucket(req.headers, serviceKey, "company-claim");
    const atNet = await take(supabase, "company-claim", net, PER_NETWORK_PER_HOUR, 60);
    if (atNet === "error") return json({ error: "Please try again in a moment." }, 503);
    if (atNet === "full") return json({ error: "Rate limit exceeded." }, 429);

    if (body.action === "verify") {
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: "Invalid verification token." }, 400);

      const { data: claim } = await supabase
        .from("company_claims").select("id, status, company_token, work_email")
        .eq("verify_token", token).maybeSingle();
      if (!claim) return json({ error: "Verification link not recognized." }, 404);

      if (claim.status === "verified" || claim.status === "email_confirmed") {
        return json({ status: claim.status });
      }
      if (claim.status === "rejected") return json({ error: "This claim was declined." }, 410);

      // The proof is taken again at the click, never read from the row: a
      // claim still pending from before 2026-10-08 carries the old substring
      // rule's domain_match = true (x@nth.io for Anthropic).
      const { data: hostRows, error: hErr } = await supabase
        .from("job_board_postings").select("apply_url")
        .eq("company_token", String(claim.company_token ?? "")).limit(APPLY_HOSTS_READ);
      if (hErr) return json({ error: "We could not check this claim right now. Please try the link again in a moment." }, 503);
      const proven = domainProven(String(claim.work_email ?? ""),
        employerDomains((hostRows ?? []).map((r: { apply_url?: string | null }) => r.apply_url)));
      const next = proven ? "verified" : "email_confirmed";
      await supabase.from("company_claims")
        .update({ status: next, domain_match: proven, verified_at: next === "verified" ? new Date().toISOString() : null })
        .eq("id", claim.id);
      console.log(`[COMPANY-CLAIM] claim ${claim.id} -> ${next}`);
      return json({ status: next });
    }

    if (body.action === "request") {
      const companyToken = typeof body.companyToken === "string" ? body.companyToken.trim().slice(0, 120) : "";
      const workEmail = typeof body.workEmail === "string" ? body.workEmail.trim().toLowerCase().slice(0, 200) : "";
      const contactName = typeof body.contactName === "string" ? body.contactName.trim().slice(0, 200) : null;
      const website = typeof body.website === "string" ? body.website.trim().slice(0, 300) : null;
      // body.companyName is NOT read: the name in the mail is the board's.

      if (!companyToken) return json({ error: "Missing company." }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) return json({ error: "A valid email is required." }, 400);
      const domain = workEmail.split("@")[1] ?? "";
      if (FREE_MAIL.has(domain)) {
        return json({ error: "Please use your work email — claims need an address at the company's own domain." }, 400);
      }

      // The claimed company must actually exist on the board, and the board's
      // row is where its name comes from.
      // "We could not check" is not "you are not here". Telling a real employer
      // their company is absent because our own query failed sends them away
      // for good; a 503 invites the retry that actually works.
      const { data: boardRows, error: cErr } = await supabase
        .from("job_board_postings").select("company, apply_url")
        .eq("company_token", companyToken).limit(APPLY_HOSTS_READ);
      if (cErr) return json({ error: "We could not verify that company right now. Please try again in a moment." }, 503);
      if (!Array.isArray(boardRows) || boardRows.length === 0) return json({ error: "Company not found on the board." }, 404);
      const boardName = typeof boardRows[0]?.company === "string" ? boardRows[0].company.trim().slice(0, 200) : "";
      const displayName = boardName || companyToken;

      // Exact registrable domain of a host the board links to for this
      // company, never an ATS's; nothing the caller wrote takes part.
      const match = domainProven(workEmail, employerDomains(boardRows.map((r: { apply_url?: string | null }) => r.apply_url)));

      // Dedupe: same company+email keeps its row (and verify token). A repeat
      // within 10 minutes of the LAST send doesn't re-send.
      const { data: existing } = await supabase
        .from("company_claims").select("id, status, verify_token, created_at, last_sent_at")
        .eq("company_token", companyToken).eq("work_email", workEmail).maybeSingle();
      if (existing?.status === "verified") return json({ status: "verified" });
      const lastSent = existing ? Date.parse(String(existing.last_sent_at ?? existing.created_at)) : NaN;
      if (existing && Number.isFinite(lastSent) && Date.now() - lastSent < RESEND_AFTER_MS) {
        return json({ status: "sent" });
      }

      // THE COUNTS, before anything is written or sent: this network's day,
      // this inbox's day (whatever company is named), and everyone's day.
      const atNetDay = await take(supabase, "company-claim:request", net, REQUESTS_PER_NETWORK_PER_DAY, 1440);
      if (atNetDay === "error") return json({ error: "Please try again in a moment." }, 503);
      if (atNetDay === "full") return json({ error: "Too many claim requests from your network today. Please try again tomorrow." }, 429);
      const inbox = (await sha256Hex(`${serviceKey}:company-claim-recipient:${workEmail}`)).slice(0, 32);
      const atInbox = await take(supabase, "company-claim:recipient", inbox, MAILS_PER_INBOX_PER_DAY, 1440);
      if (atInbox === "error") return json({ error: "Please try again in a moment." }, 503);
      if (atInbox === "full") return json({ error: "That address was already sent verification links today. Use the newest one, or try again tomorrow." }, 429);
      const ownerMail = async (m: { to: string[]; subject: string; html: string }) => {
        if (RESEND_API_KEY) await new Resend(RESEND_API_KEY).emails.send({ from: FROM, ...m });
      };
      const atAll = await take(supabase, "company-claim:all", "all", MAILS_PER_DAY, 1440);
      if (atAll !== "ok") {
        if (atAll === "full") await alertOwnerOnce(supabase, "company-claim:all", "reached its daily ceiling", ownerMail);
        return json({ error: "Claim requests are paused for today. Please try again tomorrow." }, 503);
      }

      let verifyToken = existing?.verify_token as string | undefined;
      if (existing) {
        // The board's name stays what it was when the claim was made.
        await supabase.from("company_claims")
          .update({ contact_name: contactName, website, domain_match: match })
          .eq("id", existing.id);
      } else {
        const { data: inserted, error } = await supabase.from("company_claims")
          .insert({
            company_token: companyToken, company_name: boardName || null,
            work_email: workEmail, contact_name: contactName, website, domain_match: match,
          })
          .select("verify_token").single();
        if (error || !inserted) {
          console.error("[COMPANY-CLAIM] insert failed:", error);
          return json({ error: "Could not record the claim. Please try again." }, 500);
        }
        verifyToken = inserted.verify_token as string;
      }

      if (!RESEND_API_KEY) return json({ error: "Email is not configured." }, 503);
      const resend = new Resend(RESEND_API_KEY);

      const verifyUrl = `${SITE}/jobs/company/${encodeURIComponent(companyToken)}?claim_verify=${encodeURIComponent(String(verifyToken))}`;
      const { error: sendError } = await resend.emails.send({
        from: FROM,
        to: [workEmail],
        subject: `Verify your claim of ${subjectSafe(displayName)} on Resume Booster`,
        html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#111;max-width:520px">
          <p>Someone (hopefully you) asked to claim the <b>${escapeHtml(displayName)}</b> company profile on resumebooster.work using this address.</p>
          <p><a href="${escapeHtml(verifyUrl)}" style="display:inline-block;padding:10px 18px;background:#0ea5e9;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Verify this claim</a></p>
          <p style="font-size:12px;color:#64748b">Verification confirms your identity as an employer contact. It never changes the hiring data we show — fills, re-listing patterns, and badges are computed from public postings and are not editable by anyone, including verified employers.</p>
          <p style="font-size:12px;color:#64748b">If you didn't request this, ignore this email — nothing happens without the click.</p>
        </div>`,
      });
      if (sendError) {
        console.error("[COMPANY-CLAIM] verification send failed:", sendError);
        return json({ error: "Could not send the verification email. Please try again." }, 502);
      }
      // The resend cooldown runs from here (L10-12).
      const { error: stampErr } = await supabase.from("company_claims")
        .update({ last_sent_at: new Date().toISOString() })
        .eq("company_token", companyToken).eq("work_email", workEmail);
      if (stampErr) console.error("[COMPANY-CLAIM] last_sent_at stamp failed:", stampErr);

      // Owner heads-up (best effort — the claim stands even if this fails),
      // at most OWNER_NOTES_PER_DAY a day: every claim is on /admin/claims.
      // The fields a caller typed (address, contact name, website) are escaped.
      if ((await take(supabase, "company-claim:owner", "all", OWNER_NOTES_PER_DAY, 1440)) === "ok") {
        await resend.emails.send({
          from: FROM,
          to: [OWNER_EMAIL],
          subject: `Company claim request: ${subjectSafe(displayName)}`,
          html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#111">
            <p><b>${escapeHtml(displayName)}</b> (token: ${escapeHtml(companyToken)})</p>
            <p>From: ${escapeHtml(workEmail)}${contactName ? ` (${escapeHtml(contactName)})` : ""}${website ? ` · ${escapeHtml(website)}` : ""}</p>
            <p>Domain match: <b>${match ? "yes, the address is at a domain the board links to for this company: verifies on click (its website shows only after you approve)" : "NO, needs manual review after email confirm"}</b></p>
            <p><a href="${SITE}/admin/claims">Review claims</a></p>
          </div>`,
        }).catch((e) => console.error("[COMPANY-CLAIM] owner notify failed:", e));
      }

      console.log(`[COMPANY-CLAIM] request stored for ${companyToken}, domain_match=${match}`);
      return json({ status: "sent" });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error("[COMPANY-CLAIM] Uncaught:", e);
    return json({ error: "Unexpected error." }, 500);
  }
});
