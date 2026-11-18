// affiliate-account: what an affiliate does to their own account from /affiliates.
//
// WHY THIS EXISTS (S14X-115, S14X-093, S14X-021). An affiliate who forgot the
// password had no way back in; no account ever proved it owned its address;
// a stolen session could not be ended from elsewhere; and nobody could
// download or erase what the program holds about them.
//
// POST { action, ... }. Every call is bounded per network first (the same
// door affiliate-payout-request uses), then:
//   reset-request { email }            mails a single-use 30-minute reset link
//                                      when the address has an active account;
//                                      the answer is the same either way.
//   reset { token, password }          sets the password, ends every session,
//                                      clears the failed-sign-in count and
//                                      proves the address.
//   confirm-request { sessionToken }   mails a confirmation link to the
//                                      account's address.
//   confirm { token }                  proves the address.
//   email-change-request { sessionToken, newEmail }
//                                      mails a link to the NEW address; an
//                                      address another affiliate holds gets
//                                      nothing, and the same answer. An
//                                      address gets three an hour, whoever
//                                      asks, and an affiliate asks five a day.
//   email-confirm { token }            changes the address and proves it.
//   sign-out-everywhere { sessionToken }
//   export { sessionToken }            what the program holds about them.
//   erase { sessionToken, confirm: "ERASE" }
//
// The SQL does the work (20261112120000, 20261112121000): every helper is
// service_role only and stores links and sessions as sha256. Mail goes
// through _shared/send-mail.ts, which logs each try.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { networkBucket } from "../_shared/network-bucket.ts";
import { sendMail } from "../_shared/send-mail.ts";
import { CUSTOMER_REPLY_TO } from "../_shared/customer-mail.ts";

const FN_BUILD = "affiliate-account.2026-11-12.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Max-Age": "7200",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

const SITE = "https://resumebooster.work";
const FROM = "Resume Booster <reports@resumebooster.work>";
const PER_NETWORK_PER_HOUR = 20;
const PER_ADDRESS_PER_HOUR = 3;
const CHANGES_PER_AFFILIATE_PER_DAY = 5;
const TOKEN = /^[0-9a-f]{64}$/;
const SESSION = /^[0-9a-f]{32,128}$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Admin = any;

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/** One link mail: what it does, the link, and what to do if it was not you. */
function linkMail(kind: "reset" | "confirm" | "email", token: string): { subject: string; html: string; text: string } {
  const url = `${SITE}/affiliates#${kind}=${token}`;
  const what = {
    reset: { subject: "Reset your affiliate password", line: "Someone asked to reset the password of the Resume Booster affiliate account at this address. Use this link within 30 minutes to choose a new one. It signs out every device." },
    confirm: { subject: "Confirm your affiliate address", line: "Confirm that this address belongs to your Resume Booster affiliate account. Commissions are held for review, and payouts wait, until it is confirmed. The link works once, within 30 minutes." },
    email: { subject: "Confirm your new affiliate address", line: "Someone asked to move a Resume Booster affiliate account to this address. Use this link within 30 minutes to confirm the change." },
  }[kind];
  const tail = "If this was not you, ignore this mail: nothing changes. Questions: reply to this mail.";
  return {
    subject: what.subject,
    text: `${what.line}\n\n${url}\n\n${tail}\n`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#111">
      <p>${escapeHtml(what.line)}</p>
      <p><a href="${url}">${url}</a></p>
      <p style="font-size:12px;color:#64748b">${escapeHtml(tail)}</p>
    </div>`,
  };
}

async function mailLink(admin: Admin, kind: "reset" | "confirm" | "email", to: string, token: string): Promise<boolean> {
  const m = linkMail(kind, token);
  const sent = await sendMail({
    cls: "transactional", kind: `affiliate-${kind}`, to, from: FROM, subject: m.subject, html: m.html, text: m.text,
    replyTo: CUSTOMER_REPLY_TO, idempotencyKey: `affiliate-${kind}:${(await sha256Hex(token)).slice(0, 32)}`,
  }, { admin });
  if (!sent.ok) console.error(`[AFFILIATE-ACCOUNT] ${kind} mail not sent (${sent.status}): ${sent.error ?? "refused"}`);
  return sent.ok;
}

/** The affiliate a live session token names, or null; throws on a database error. */
async function owner(admin: Admin, token: unknown): Promise<string | null> {
  if (typeof token !== "string" || !SESSION.test(token)) return null;
  const { data, error } = await admin.rpc("affiliate_session_owner", { p_token: token });
  if (error) throw new Error(`affiliate_session_owner: ${error.message}`);
  return typeof data === "string" && data ? data : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, { auth: { persistSession: false } });

    const net = await networkBucket(req.headers, serviceKey, "affiliate-account");
    const { data: underLimit, error: doorErr } = await admin.rpc("mail_door_take", {
      p_door: "affiliate-account", p_bucket: net, p_max: PER_NETWORK_PER_HOUR, p_window_minutes: 60,
    });
    if (doorErr) return json({ error: "Please try again in a moment." }, 503);
    if (underLimit !== true) return json({ error: "Too many requests. Please try again later." }, 429);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";

    // ── by mailed link ──────────────────────────────────────────────────────
    if (action === "reset-request") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!email || email.length > 254 || !email.includes("@")) return json({ error: "Enter the address you signed up with." }, 400);
      // A few a hour per address from anywhere, so the box is not flooded.
      const { data: perAddress } = await admin.rpc("mail_door_take", {
        p_door: "affiliate-reset-address", p_bucket: (await sha256Hex(`${serviceKey}:affiliate-reset:${email}`)).slice(0, 32),
        p_max: PER_ADDRESS_PER_HOUR, p_window_minutes: 60,
      });
      if (perAddress === true) {
        const { data: link, error } = await admin.rpc("affiliate_link_mint", { p_purpose: "reset", p_email: email });
        if (error) console.error("[AFFILIATE-ACCOUNT] reset mint failed:", error.message);
        else if (link && typeof link.token === "string") await mailLink(admin, "reset", String(link.to), link.token);
      }
      // The same answer whether or not the address has an account.
      return json({ status: "sent" });
    }

    if (action === "reset" || action === "confirm" || action === "email-confirm") {
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (!TOKEN.test(token)) return json({ status: "expired" }, 400);
      const purpose = action === "email-confirm" ? "email" : action;
      const password = action === "reset" ? (typeof body.password === "string" ? body.password : "") : null;
      if (action === "reset" && (password!.length < 8 || password!.length > 200)) {
        return json({ status: "weak_password", error: "Choose a password of 8 to 200 characters." }, 400);
      }
      const { data, error } = await admin.rpc("affiliate_link_use", { p_token: token, p_purpose: purpose, p_new_password: password });
      if (error) return json({ error: "Please try again in a moment." }, 503);
      if (!data || data.ok !== true) {
        const why = data?.error === "taken" ? "taken" : data?.error === "weak-password" ? "weak_password" : "expired";
        return json({ status: why }, 400);
      }
      return json({ status: action === "reset" ? "reset" : action === "confirm" ? "confirmed" : "changed" });
    }

    // ── signed in ───────────────────────────────────────────────────────────
    const signedIn = ["confirm-request", "email-change-request", "sign-out-everywhere", "export", "erase"];
    if (!signedIn.includes(action)) return json({ error: "Unknown action." }, 400);
    const affiliateId = await owner(admin, body.sessionToken);
    if (!affiliateId) return json({ error: "Your session has expired. Please sign in again." }, 401);

    if (action === "confirm-request" || action === "email-change-request") {
      const purpose = action === "confirm-request" ? "confirm" : "email";
      const newEmail = purpose === "email" && typeof body.newEmail === "string" ? body.newEmail.trim().toLowerCase() : null;
      if (purpose === "email" && (!newEmail || newEmail.length > 254 || !newEmail.includes("@"))) {
        return json({ error: "Enter the new address." }, 400);
      }
      // A CHANGE LINK GOES TO AN ADDRESS NOBODY HAS PROVED (S14X-115). Sign-up
      // is open, so without these doors any account could mail a stranger a
      // link twenty times an hour from each network. The affiliate's own day
      // first, then the address's hour, the same three reset-request allows.
      if (purpose === "email") {
        const { data: perAccount, error: accountErr } = await admin.rpc("mail_door_take", {
          p_door: "affiliate-email-change-account", p_bucket: affiliateId.slice(0, 64),
          p_max: CHANGES_PER_AFFILIATE_PER_DAY, p_window_minutes: 1440,
        });
        if (accountErr) return json({ error: "Please try again in a moment." }, 503);
        if (perAccount !== true) return json({ error: "Too many address changes today. Please try again tomorrow." }, 429);
        const { data: perAddress, error: addressErr } = await admin.rpc("mail_door_take", {
          p_door: "affiliate-email-change-address", p_bucket: (await sha256Hex(`${serviceKey}:affiliate-email-change:${newEmail}`)).slice(0, 32),
          p_max: PER_ADDRESS_PER_HOUR, p_window_minutes: 60,
        });
        if (addressErr) return json({ error: "Please try again in a moment." }, 503);
        if (perAddress !== true) return json({ error: "Too many requests for this address. Please try again later." }, 429);
      }
      const { data: link, error } = await admin.rpc("affiliate_link_mint", {
        p_purpose: purpose, p_affiliate_id: affiliateId, p_new_email: newEmail,
      });
      if (error) return json({ error: "Please try again in a moment." }, 503);
      if (link && typeof link.token === "string") await mailLink(admin, purpose, String(link.to), link.token);
      return json({ status: "sent" });
    }

    if (action === "sign-out-everywhere") {
      const { data, error } = await admin.rpc("affiliate_sign_out_everywhere", { p_affiliate_id: affiliateId });
      if (error) return json({ error: "Please try again in a moment." }, 503);
      return json({ status: "signed_out", sessions: Number(data) || 0 });
    }

    if (action === "export") {
      const { data, error } = await admin.rpc("affiliate_export", { p_affiliate_id: affiliateId });
      if (error || !data) return json({ error: "Please try again in a moment." }, 503);
      return json({ status: "ok", export: data });
    }

    // erase
    if (body.confirm !== "ERASE") return json({ status: "confirm_required", error: "Type ERASE to confirm." }, 400);
    const { data: erased, error: eErr } = await admin.rpc("affiliate_erase", { p_affiliate_id: affiliateId });
    if (eErr) return json({ error: "Please try again in a moment." }, 503);
    if (erased !== true) return json({ error: "This account is already erased." }, 409);
    return json({ status: "erased" });
  } catch (e) {
    console.error("[AFFILIATE-ACCOUNT] Uncaught:", e);
    return json({ error: "Unexpected error." }, 500);
  }
});
