// MINT AN ACCOUNT-LINKED AGENT KEY — the credential "Connect your agent" hands
// to a person's AI agent.
//
// The free /v1 keys are deliberately account-less (an email address, no
// login), and account-less is exactly right for read-only data. The MCP apply
// tools act ON an account — entitlement, mandate, and every application are
// keyed to a user id — so the key an agent presents for them must have been
// minted FROM a signed-in session and carry the owner it acts for.
//
// This function therefore runs with verify_jwt (the Supabase default): the
// caller IS the user, user_id comes from the verified token and never from
// the body. That is the lesson agent-entitlement.ts:16-21 records from
// agent-access — an unauthenticated endpoint that took an email from the body
// was enough to mint entitlement rows.
//
// Reuses the api_key_issue RPC verbatim (same hashing, same per-address caps,
// same tier/limits), then stamps user_id with the service role. One
// agent-linked key per account: minting again revokes the previous one and
// says so — rotation, stated, never silent.

//
// AND IT IS BOUNDED (completeness review of PR #13). Every signed-in session
// used to get a key with the free tier's full daily quota, and sign-ups are
// confirmed automatically — so N throwaway accounts were N full-quota keys,
// the pool api-key-request's confirmed-mailbox door was built to retire. The
// RPC now takes the caller's NETWORK (a keyed hash of the platform's address,
// never a header the caller writes) and refuses past five mints a day per
// account, five a day per network, and a daily ceiling — the last two only for
// accounts that pay for nothing (20261005130000).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { networkBucket } from "../_shared/network-bucket.ts";

// Provable from outside without signing in: the preflight carries it.
const FN_BUILD = "agent-connect.2026-10-05.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "x-fn-build": FN_BUILD,
};

/** What each refusal tells the person, and the status it answers with. */
const REFUSALS: Record<string, [number, string]> = {
  account_limit: [429, "This account has minted five agent keys today. Use the newest one, or mint again tomorrow."],
  network_limit: [429, "Several agent keys were minted from your network today. Try again tomorrow, or from another connection."],
  shed: [429, "Agent key minting is busy today and a key was already minted from your network. Try again tomorrow."],
  paused: [503, "Agent key minting has reached today's limit. Try again tomorrow, or email us."],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // The user, from the VERIFIED token — the anon-key client validates the JWT;
  // nothing about identity is read from the body.
  const authClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: userData, error: userErr } = await authClient.auth.getUser();
  const user = userData?.user;
  if (userErr || !user?.id || !user.email) {
    return json({ error: "Sign in to mint an agent key." }, 401);
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const service = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

  // ONE ATOMIC MINT — rotate + insert in a single transaction (api_key_issue_agent).
  //
  // The old flow revoked the working key FIRST and then called a mint that
  // could still be denied, leaving the account keyless (review finding); and it
  // went through api_key_issue's per-EMAIL cap, which a stranger can fill with
  // account-less keys to lock a victim out (DoS finding). This RPC does neither:
  // it revokes only THIS user's prior agent key and inserts the new one
  // together, scoped to user_id, so a failure rolls the revoke back and there
  // is never a keyless window — and account-less keys on the same email are
  // invisible to its ceiling. rb_live_ + 32 CSPRNG bytes hex; only the SHA-256
  // is ever stored, and user_id is set in the same INSERT rather than a
  // follow-up UPDATE that could half-mint.
  const rawKey = "rb_live_" + [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const base = {
    p_user_id: user.id,
    p_email: user.email,
    p_key_hash: await sha256Hex(rawKey),
    p_key_prefix: rawKey.slice(0, 16),
  };
  let { data: issued, error: issueErr } = await service.rpc("api_key_issue_agent", {
    ...base,
    p_net: await networkBucket(req.headers, serviceKey, "agent-key"),
    p_via: "connect",
  }).maybeSingle();
  // DEPLOY ORDER: until 20261005130000 applies, the database holds only the
  // four-argument mint and answers PGRST202 to the six. One retry with the
  // old shape keeps "Connect your agent" working in that window.
  if (issueErr && (issueErr as { code?: string }).code === "PGRST202") {
    ({ data: issued, error: issueErr } = await service.rpc("api_key_issue_agent", base).maybeSingle());
  }
  if (issueErr) {
    console.error("[AGENT-CONNECT] issue failed:", issueErr.message?.slice(0, 160));
    return json({ error: "Key minting is temporarily unavailable. Retry shortly." }, 503);
  }
  const row = issued as { issued_ok?: boolean; deny_reason?: string; issued_key_id?: string; rotated_prior?: boolean } | null;
  if (!row?.issued_ok || !row.issued_key_id) {
    const refusal = REFUSALS[row?.deny_reason ?? ""];
    if (refusal) return json({ error: refusal[1], reason: row?.deny_reason }, refusal[0]);
    return json({ error: `Could not issue a key (${row?.deny_reason ?? "unknown"}).` }, 409);
  }

  return json({
    key: rawKey, // shown exactly once — only the hash is stored
    shownOnce: true,
    rotated: row.rotated_prior === true,
    mcpUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/agent-mcp`,
  });
});
