// Executes the access-token hook migration (20260917130000) in pglite and
// proves what the OAuth lane relies on:
//   * it applies, and applies again unchanged (idempotent);
//   * a website sign-in event (claims without a client_id) comes back
//     byte-identical — the hook is a no-op for every ordinary session;
//   * an event whose claims carry a client_id comes back with its audience
//     rewritten to the MCP server's URL, every other claim untouched, and the
//     top-level keys (user_id, authentication_method) preserved;
//   * an empty or null client_id is treated as absent;
//   * a malformed event (claims not an object) is returned as received rather
//     than raising — the guarantee that a bug here never blocks sign-in;
//   * the URL the hook writes is the server module's constant, read from
//     supabase/functions/agent-mcp/oauth.ts (the triple-mirror guard reads the
//     same two spellings; this run proves the SQL side executes to it);
//   * anon, authenticated and a PUBLIC-only role cannot execute it; the auth
//     server's role can; exactly one signature exists.
// Usage: node scripts/verify-migration-20260917130000.mjs   (from the repo root)
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

const DIR = "supabase/migrations";
const file = readdirSync(DIR).find((n) => n.startsWith("20260917130000_"));
if (!file) throw new Error("no migration with stamp 20260917130000");
const MIG = readFileSync(`${DIR}/${file}`, "utf8");

const oauthTs = readFileSync("supabase/functions/agent-mcp/oauth.ts", "utf8").replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
const MCP_URL = /export const MCP_URL = "([^"]+)";/.exec(oauthTs)?.[1];
if (!MCP_URL) throw new Error("oauth.ts no longer declares MCP_URL as a plain string");

let failures = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`); if (!ok) failures++; };

// jsonb normalises key order, so equality is structural, never textual.
const canon = (v) => v && typeof v === "object" && !Array.isArray(v)
  ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}"
  : Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : JSON.stringify(v);
const same = (a, b) => canon(a) === canon(b);

const db = new PGlite();
const one = async (q, params) => (await db.query(q, params)).rows[0];
const fails = async (q, params) => { try { await db.query(q, params); return null; } catch (e) { return e; } };

await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE supabase_auth_admin; CREATE ROLE nobody_probe;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, nobody_probe;
`);

await db.exec(MIG);
check("migration applies", true);
await db.exec(MIG);
check("migration applies a second time unchanged", true);

const sigs = await db.query(`SELECT pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'custom_access_token_hook'`);
check("exactly one signature", sigs.rows.length === 1 && sigs.rows[0].args === "event jsonb", JSON.stringify(sigs.rows));

const session = {
  user_id: "11111111-1111-4111-8111-111111111111",
  authentication_method: "password",
  claims: { iss: "https://example.test/auth/v1", aud: "authenticated", sub: "11111111-1111-4111-8111-111111111111", exp: 1900000000, role: "authenticated", email: "one@example.com", aal: "aal1", session_id: "s1", is_anonymous: false },
};
const hook = async (event) => (await one(`SELECT public.custom_access_token_hook($1::jsonb) AS out`, [JSON.stringify(event)])).out;

const sessionOut = await hook(session);
check("a website session (no client_id) is returned byte-identical", same(sessionOut, session), JSON.stringify(sessionOut));

const oauthIn = { ...session, authentication_method: "oauth", claims: { ...session.claims, client_id: "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d", scope: "email" } };
const oauthOut = await hook(oauthIn);
check("an OAuth-client token gets aud = the MCP server URL", oauthOut?.claims?.aud === MCP_URL, String(oauthOut?.claims?.aud));
const { aud: _inAud, ...inRest } = oauthIn.claims;
const { aud: _outAud, ...outRest } = oauthOut.claims;
check("every other claim is untouched", same(inRest, outRest));
check("top-level keys survive", oauthOut.user_id === oauthIn.user_id && oauthOut.authentication_method === "oauth");
check("the audience is the server's own constant, not a second spelling", oauthOut.claims.aud === MCP_URL && MCP_URL.endsWith("/agent-mcp") && !MCP_URL.endsWith("/"));

for (const [label, cid] of [["empty client_id", ""], ["null client_id", null]]) {
  const ev = { ...session, claims: { ...session.claims, client_id: cid } };
  const out = await hook(ev);
  check(`${label} is treated as absent (aud stays authenticated)`, out?.claims?.aud === "authenticated" && same(out, ev));
}

const malformed = { user_id: session.user_id, claims: "not-an-object" };
const malformedOut = await hook(malformed);
check("a malformed event is returned as received, never raised", same(malformedOut, malformed), JSON.stringify(malformedOut));
const arrayClaims = { user_id: session.user_id, claims: [1, 2] };
check("array claims are returned as received", same(await hook(arrayClaims), arrayClaims));
check("a null event returns null rather than raising", (await one(`SELECT public.custom_access_token_hook(NULL::jsonb) AS out`)).out === null);

const asRole = async (role, q, params) => {
  await db.exec(`SET ROLE ${role}`);
  const e = await fails(q, params);
  await db.exec(`RESET ROLE`);
  return e;
};
for (const role of ["anon", "authenticated", "nobody_probe"]) {
  const e = await asRole(role, `SELECT public.custom_access_token_hook($1::jsonb)`, [JSON.stringify(session)]);
  check(`${role} cannot execute the hook`, e !== null && /permission denied/i.test(String(e?.message)), String(e?.message ?? "no error"));
}
const authAdmin = await asRole("supabase_auth_admin", `SELECT public.custom_access_token_hook($1::jsonb)`, [JSON.stringify(oauthIn)]);
check("supabase_auth_admin can execute the hook", authAdmin === null, String(authAdmin?.message ?? ""));

await db.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
