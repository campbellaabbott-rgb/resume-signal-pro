// deploy-stamp: 2026-10-04T12:00Z
// Self-serve issuance for the public data API -- behind a mailbox.
//
// THE KEY USED TO BE HANDED TO WHOEVER TYPED AN ADDRESS (defect sweep 1.43).
// Issuance was unauthenticated, the address was checked by a regex, the first
// key for any address came back in the HTTP response, and every mint mailed
// that address. So a script posting made-up addresses received a working key
// per post: N keys, N times the per-key rate and daily quota, which made the
// whole of the metering bound nothing. That is the harvesting door, and it is
// what this file closes.
//
// TWO STEPS NOW, and the key exists only after the second:
//
//   POST {email, name?}            -> a single-use confirmation link is mailed
//                                     to THAT address (only its sha256 is
//                                     stored). No key exists yet; the response
//                                     never carries one.
//   POST {action:"confirm", token} -> the link's page sends this. The token is
//                                     redeemed and the key is minted and shown
//                                     ONCE to whoever clicked -- someone who can
//                                     read that mailbox.
//
// The bounds live in SQL (api_key_request_open, api_key_issue) so they are
// atomic: two confirmation mails per mailbox a day (+tags and Gmail dots are
// one mailbox), five requests an hour per network, 300 confirmation mails a
// day overall; five keys a day per network, five per domain outside the big
// shared providers, forty account-less keys a day overall; three live keys
// per mailbox, and a fourth that its owner confirms retires the one used least
// recently.
//
// The network is the caller's /24 (IPv4) or /48 (IPv6) from the platform's
// address -- never a header the caller writes -- and only a keyed hash of it
// reaches the database.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { networkBucket } from "../_shared/network-bucket.ts";

// Provable from outside without minting anything: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "api-key-request.2026-10-04.1";

const SITE = "https://resumebooster.work";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "x-fn-build": FN_BUILD,
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", ...cors } });
const refuse = (code: string, message: string, status: number) => json({ error: { code, message } }, status);

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

function confirmationHtml(link: string, liveKeys: number): string {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;line-height:1.5">
            <h2 style="margin:0 0 12px">Confirm your Resume Booster API key</h2>
            <p style="margin:0 0 12px">Someone, hopefully you, asked for a free data API key for this address. Open the link below to create it; the key is shown once, on the page the link opens.</p>
            <p style="margin:16px 0"><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">Create my API key</a></p>
            <p style="margin:0 0 12px;color:#52525b;font-size:14px">The link works once and expires in 24 hours.</p>
            ${liveKeys >= 3 ? '<p style="margin:0 0 12px;color:#52525b;font-size:14px">This address already holds three live keys, the most it can hold. Confirming retires the one used least recently.</p>' : ""}
            <p style="margin:16px 0 0;color:#71717a;font-size:13px">If you did not ask for this, ignore this email. No key exists until the link is opened, and nothing else will be sent.</p>
          </div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return refuse("method_not_allowed", "POST an email address.", 405);

  let body: { action?: unknown; email?: unknown; name?: unknown; token?: unknown };
  try { body = await req.json(); } catch { return refuse("bad_json", "Body must be JSON.", 400); }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);
  const net = await networkBucket(req.headers, serviceKey, "api-key");

  // ── Step 2: the link was opened. Redeem the token, mint, show once. ──────
  if (body.action === "confirm") {
    const token = String(body.token ?? "");
    if (!/^[0-9a-f]{64}$/.test(token)) return refuse("invalid_link", "That link is not valid. Request a new one.", 400);

    // 32 bytes of CSPRNG. `rb_live_` is a visible prefix so a leaked key is
    // recognisable as ours in a log or a public repo.
    const rand = crypto.getRandomValues(new Uint8Array(32));
    const raw = "rb_live_" + hex(rand);

    const { data, error } = await client.rpc("api_key_issue", {
      p_token_hash: await sha256Hex(token),
      p_key_hash: await sha256Hex(raw),
      p_key_prefix: raw.slice(0, 16),
      p_net: net,
    }).maybeSingle();
    if (error) {
      console.error("[API-KEY-REQUEST] issue failed:", error.message?.slice(0, 160));
      return refuse("issue_failed", "Could not create the key right now. Open the link again shortly.", 503);
    }
    const d = (data ?? null) as
      | { ik_issued: boolean; ik_reason: string; ik_tier: string; ik_rate: number; ik_quota: number; ik_retired: string[] | null }
      | null;
    if (!d?.ik_issued) {
      switch (d?.ik_reason) {
        case "already_used":
          return refuse("already_used", "This link was already used, and its key was shown then. Request a new link if you did not keep it.", 410);
        case "expired":
          return refuse("expired", "This link has expired (they last 24 hours). Request a new one.", 410);
        case "network_limit":
          return refuse("network_limit", "Several keys were created from your network today. Open the link again tomorrow; it stays valid for 24 hours.", 429);
        case "domain_limit":
          return refuse("domain_limit", "Several keys were created for addresses at this domain today. Open the link again tomorrow, or email us.", 429);
        case "paused":
          console.error("[API-KEY-REQUEST] the daily ceiling on new free keys was reached");
          return refuse("paused", "Free key creation has reached today's limit. Open the link again tomorrow, or email us.", 503);
        default:
          return refuse("invalid_link", "That link is not valid. Request a new one.", 400);
      }
    }
    return json({
      key: raw,
      shownOnce: true,
      tier: d.ik_tier,
      limits: { perMinute: d.ik_rate, perDay: d.ik_quota },
      retiredPrefixes: d.ik_retired ?? [],
      docs: `${SITE}/data-api`,
    });
  }

  // ── Step 1: a request. A link goes to the address; no key exists yet. ────
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 254);
  const name = String(body.name ?? "").trim().slice(0, 80);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return refuse("invalid_email", "Enter a valid email address.", 400);
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return refuse("email_unavailable", "We cannot send the confirmation email right now. Try again shortly.", 503);

  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const { data, error } = await client.rpc("api_key_request_open", {
    p_email: email,
    p_name: name,
    p_token_hash: await sha256Hex(token),
    p_net: net,
  }).maybeSingle();
  if (error) {
    console.error("[API-KEY-REQUEST] request failed:", error.message?.slice(0, 160));
    return refuse("request_failed", "Could not take the request right now. Try again shortly.", 503);
  }
  const d = (data ?? null) as { rq_send: boolean; rq_reason: string; rq_live_keys: number } | null;
  if (!d?.rq_send) {
    switch (d?.rq_reason) {
      case "too_many_requests":
        return refuse("too_many_requests", "We already sent that address two links today. Use the newest one in its inbox, or try again tomorrow.", 429);
      case "network_busy":
        return refuse("network_busy", "Too many key requests from your network. Try again in an hour.", 429);
      case "paused":
        console.error("[API-KEY-REQUEST] the daily ceiling on confirmation mail was reached");
        return refuse("paused", "Key requests are paused for today. Try again tomorrow, or email us.", 503);
      case "undeliverable":
        return refuse("undeliverable", "Mail to that address bounced or was reported before, so we will not send to it. Use another address.", 400);
      default:
        return refuse("invalid_email", "Enter a valid email address.", 400);
    }
  }

  // The link goes ONLY to the address that asked, and the mail carries no text
  // the requester wrote: the name they typed is stored, never sent.
  const link = `${SITE}/data-api#confirm=${token}`;
  let emailed = false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Resume Booster <reports@resumebooster.work>",
        to: [email],
        subject: "Confirm your Resume Booster API key",
        html: confirmationHtml(link, Number(d.rq_live_keys) || 0),
      }),
    });
    emailed = res.ok;
    if (!res.ok) console.error("[API-KEY-REQUEST] resend returned", res.status);
  } catch (e) {
    console.error("[API-KEY-REQUEST] email threw:", e instanceof Error ? e.message.slice(0, 120) : String(e));
  }
  if (!emailed) {
    return refuse("email_failed", "We could not send the confirmation email. Try again shortly.", 502);
  }

  return json({
    requested: true,
    emailed: true,
    expiresInHours: 24,
    message: "Check your inbox: we sent a link to that address. Open it within 24 hours and your key is shown on the page it opens.",
    docs: `${SITE}/data-api`,
  });
});
