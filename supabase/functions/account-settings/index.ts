// THE CONNECTED AIS AND THE MAIL AN ACCOUNT GETS, READ AND SWITCHED OFF BY THE
// ACCOUNT ITSELF (plan CP-H, Account UX spec sections 6 "Connected AIs" and
// "Email preferences"; decision D12; wave 4 round 2, account-compliance).
//
// A key minted for a person's AI (agent-connect) could only be replaced, by
// minting another, and nothing on the account page said one existed. The
// market pulse could only be left from a link in one of its mails. Three
// actions, each for the caller's own account only:
//
//   POST {action:"read"} -> {connectors, mail, mailboxProven}
//        connectors: the account's live keys (api_keys bound to its user id):
//        id, prefix, name, created and last-used dates. Never the key.
//        mail: the market pulse rows under the account's PROVEN address
//        (_shared/account-proof.ts), or null while the address is unproven:
//        an auto-confirmed sign-up must not read or change a stranger's list.
//   POST {action:"revoke_connector", keyId} -> {revoked:true}: that key stops
//        working now (revoked_at). A key of another account, or one already
//        revoked, answers 404, the same as no key at all.
//   POST {action:"pulse_off"} -> {unsubscribed:n}: every market pulse row under
//        the proven address stops (unsubscribed_at), as its mail's own link
//        does. 403 address_unproven while the address is unproven.
//
// A WEBSITE SESSION ONLY (plan CP-J, _shared/website-session.ts): a token
// minted for a connected app can neither list nor revoke the keys.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { accountProvenEmail } from "../_shared/account-proof.ts";
import type { MailboxEnv } from "../_shared/mailbox-proof.ts";
import { requireWebsiteSession } from "../_shared/website-session.ts";

// Provable from outside without signing in: every response, the CORS
// preflight included, carries this in x-fn-build. It imports
// _shared/mailbox-proof.ts, which R1 stamped 2026-10-14.1, as account-order does.
const FN_BUILD = "account-settings.2026-10-14.25";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Connector = { id: string; prefix: string; name: string; createdAt: string; lastUsedAt: string | null };
export type PulseRow = { industry: string | null; state: "subscribed" | "awaiting_confirmation" | "off" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST an action." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const session = await requireWebsiteSession(req, { auth: anon.auth, headers: corsHeaders });
    if (session instanceof Response) return session;
    const user = session.user;

    const body = await req.json().catch(() => ({})) as { action?: unknown; keyId?: unknown };
    const action = body.action === "read" || body.action === "revoke_connector" || body.action === "pulse_off" ? body.action : null;
    if (!action) return json({ error: "Name what you want to do." }, 400);

    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });

    if (action === "revoke_connector") {
      const keyId = typeof body.keyId === "string" && UUID_RE.test(body.keyId) ? body.keyId : null;
      if (!keyId) return json({ error: "Name the key to revoke." }, 400);
      const { data, error } = await service.from("api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", keyId).eq("user_id", user.id).is("revoked_at", null)
        .select("id");
      if (error) return json({ error: "Could not revoke it right now. Try again in a minute." }, 503);
      if (!Array.isArray(data) || data.length === 0) return json({ error: "No such key on this account." }, 404);
      return json({ revoked: true });
    }

    const proofEnv: MailboxEnv = {
      db: service,
      confirmedSince: Deno.env.get("EMAIL_CONFIRMED_SINCE") ?? null,
      supabaseUrl: url,
      anonKey,
    };
    const provenEmail = await accountProvenEmail(user, session.jwt, proofEnv);

    if (action === "pulse_off") {
      if (!provenEmail) {
        return json({ error: "Prove this address first by signing in with an emailed code. The link in any market pulse mail also stops it.", code: "address_unproven" }, 403);
      }
      const { data, error } = await service.from("market_pulse_subscribers")
        .update({ unsubscribed_at: new Date().toISOString() })
        .eq("email", provenEmail).is("unsubscribed_at", null)
        .select("email");
      if (error) return json({ error: "Could not change it right now. Try again in a minute." }, 503);
      return json({ unsubscribed: Array.isArray(data) ? data.length : 0 });
    }

    // read
    const [keys, pulse] = await Promise.all([
      service.from("api_keys").select("id, key_prefix, name, created_at, last_used_at")
        .eq("user_id", user.id).is("revoked_at", null).order("created_at", { ascending: false }).limit(20),
      provenEmail
        ? service.from("market_pulse_subscribers").select("industry, confirmed_at, unsubscribed_at").eq("email", provenEmail).limit(20)
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (keys.error || pulse.error) return json({ error: "Could not read your settings right now. Try again in a minute." }, 503);
    const connectors: Connector[] = ((keys.data ?? []) as Array<Record<string, unknown>>).map((k) => ({
      id: String(k.id),
      prefix: String(k.key_prefix ?? ""),
      name: String(k.name ?? ""),
      createdAt: String(k.created_at ?? ""),
      lastUsedAt: typeof k.last_used_at === "string" ? k.last_used_at : null,
    }));
    const mail = provenEmail
      ? {
        marketPulse: ((pulse.data ?? []) as Array<Record<string, unknown>>).map((p): PulseRow => ({
          industry: typeof p.industry === "string" ? p.industry : null,
          state: p.unsubscribed_at ? "off" : p.confirmed_at ? "subscribed" : "awaiting_confirmation",
        })),
      }
      : null;
    return json({ connectors, mail, mailboxProven: !!provenEmail });
  } catch (e) {
    console.error("[ACCOUNT-SETTINGS] Uncaught:", e instanceof Error ? e.message : String(e));
    return json({ error: "Unexpected error" }, 500);
  }
});
