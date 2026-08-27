// Self-serve issuance for the public data API.
//
// The API has worked since it deployed and nobody could use it, because a key
// only existed if someone wrote SQL. For a product whose first job is to be
// TRIED, that is the wrong shape.
//
// THE KEY IS RETURNED AND EMAILED, and both halves are deliberate. Returning it
// means a developer can paste it into a terminal in the next ten seconds, which
// is the whole point of self-serve; emailing it means they still have it
// tomorrow, and it puts a real address behind every key so there is someone to
// talk to when one outgrows the free tier. It is shown ONCE — only sha256 is
// stored, so there is no path that can show it again, and the honest answer to
// "I lost it" is to issue another (which revokes the old one).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", ...cors } });

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: { code: "method_not_allowed", message: "POST an email address." } }, 405);

  let body: { email?: unknown; name?: unknown };
  try { body = await req.json(); } catch { return json({ error: { code: "bad_json", message: "Body must be JSON." } }, 400); }

  const email = String(body.email ?? "").trim().slice(0, 200);
  const name = String(body.name ?? "").trim().slice(0, 80);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: { code: "invalid_email", message: "Enter a valid email address." } }, 400);
  }

  // 32 bytes of CSPRNG. `rb_live_` is a visible prefix so a leaked key is
  // recognisable as ours in a log or a public repo — the reason every vendor
  // that has been through a credential-leak incident prefixes their keys.
  const rand = crypto.getRandomValues(new Uint8Array(32));
  const raw = "rb_live_" + [...rand].map((b) => b.toString(16).padStart(2, "0")).join("");
  const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  const { data, error } = await client.rpc("api_key_issue", {
    p_email: email,
    p_name: name,
    p_key_hash: await sha256Hex(raw),
    p_key_prefix: raw.slice(0, 16),
  }).maybeSingle();

  if (error) {
    console.error("[API-KEY-REQUEST] issue failed:", error.message?.slice(0, 160));
    return json({ error: { code: "issue_failed", message: "Could not issue a key right now. Try again shortly." } }, 503);
  }
  // Names mirror the RPC's OUT parameters, renamed in 20260826161200 so that
  // none of them collides with a real column of api_keys.
  const d = (data ?? null) as
    | { issued: boolean; deny_reason: string; key_tier: string; rate_limit: number; quota_limit: number; had_active: boolean }
    | null;
  if (!d?.issued) {
    if (d?.deny_reason === "too_many_active_keys") {
      return json({ error: { code: "too_many_active_keys", message: "That address already has the maximum number of active keys. Use one you already have, or revoke one first." } }, 409);
    }
    if (d?.deny_reason === "too_many_requests") {
      return json({ error: { code: "too_many_requests", message: "That address has requested several keys today. Use the most recent one, or try again tomorrow." } }, 429);
    }
    return json({ error: { code: d?.deny_reason ?? "issue_failed", message: "Could not issue a key for that address." } }, 400);
  }

  // Email is BEST EFFORT and never blocks the response. The key is already
  // valid; failing the request because a mail provider was slow would refuse a
  // developer the credential they just successfully created.
  const resendKey = Deno.env.get("RESEND_API_KEY");
  let emailed = false;
  if (resendKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Resume Booster <onboarding@resend.dev>",
          to: [email],
          subject: "Your Resume Booster data API key",
          html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;line-height:1.5">
            <h2 style="margin:0 0 12px">Your API key</h2>
            <p style="margin:0 0 12px">Here is your key. We store only a hash of it, so this email is the only copy — keep it somewhere safe.</p>
            <pre style="background:#f4f4f5;padding:12px 14px;border-radius:8px;overflow-x:auto;font-size:13px"><code>${raw}</code></pre>
            <p style="margin:12px 0"><strong>Free tier:</strong> ${d.rate_limit} requests/minute, ${d.quota_limit}/day.</p>
            <pre style="background:#f4f4f5;padding:12px 14px;border-radius:8px;overflow-x:auto;font-size:12px"><code>curl https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/public-api/v1/jobs?limit=5 \\
  -H "Authorization: Bearer ${raw}"</code></pre>
            <p style="margin:12px 0">Docs: <a href="https://resumebooster.work/data-api">resumebooster.work/data-api</a></p>
            ${d.had_active ? '<p style="margin:12px 0;color:#71717a">This address already had a key; the previous one still works. You can have up to three at a time.</p>' : ""}
            <p style="margin:16px 0 0;color:#71717a;font-size:13px">If you did not request this, you can ignore it — the key is useless without the request you did not make, and it will simply go unused.</p>
          </div>`,
        }),
      });
      emailed = res.ok;
      if (!res.ok) console.error("[API-KEY-REQUEST] resend returned", res.status);
    } catch (e) {
      console.error("[API-KEY-REQUEST] email threw:", e instanceof Error ? e.message.slice(0, 120) : String(e));
    }
  }

  // THE KEY IS WITHHELD FROM THE RESPONSE WHEN THE ADDRESS ALREADY HAD ONE.
  //
  // This endpoint is unauthenticated by necessity — it is where a developer
  // with no account gets their first credential — so anything it returns, it
  // returns to whoever typed the address. Handing back a working key for an
  // address the requester may not own was the other half of the revocation
  // hole: a stranger got a live credential attached to your email.
  //
  // First request for an address: shown on screen, because frictionless is the
  // entire point of self-serve. Any request after that: the inbox only, so
  // holding a key for an address means being able to read its mail. If the
  // email could not be sent we say so rather than silently stranding them.
  const withhold = d.had_active;
  return json({
    ...(withhold ? {} : { key: raw }),
    shownOnce: !withhold,
    emailed,
    ...(withhold
      ? {
        message: emailed
          ? "This address already has a key, so the new one has been emailed rather than shown here."
          : "This address already has a key, so the new one is emailed rather than shown — but the email could not be sent. Use a key you already have, or contact us.",
      }
      : {}),
    tier: d.key_tier,
    limits: { perMinute: d.rate_limit, perDay: d.quota_limit },
    hadActiveKey: d.had_active,
    docs: "https://resumebooster.work/data-api",
  });
});
