-- A KEY THAT MAY ACT MUST NAME ITS OWNER.
--
-- api_keys was built deliberately account-less: the free data tier hands a
-- key to an email address, no login required, and nothing a key can do
-- touches a person's account. "Connect your agent" changes the second half:
-- an agent holding a key may now REQUEST APPLICATIONS on a user's behalf,
-- and every gate that authorizes an application (paid entitlement, mandate,
-- the honesty classifier) is keyed to a user id. So a key that wants the
-- apply tools must be minted FROM a signed-in session and carry the owner it
-- acts for; keys without one keep exactly the read-only powers they had.
--
-- A nullable column, not a new table: the identity is per-key, the read path
-- (api_key_check) is untouched, and NULL means what account-less always
-- meant. No RPC changes — the mint path stamps user_id with the service role
-- after api_key_issue, and the MCP server reads it by api_key_id (also
-- service role; the table has RLS with zero policies, which stays true).
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS user_id uuid;

-- ONE LIVE AGENT KEY PER USER, ENFORCED BY THE DATABASE — not merely claimed.
-- The first draft here was a NON-unique index with a comment asserting
-- uniqueness the index did not provide (review finding): the lookup was fast
-- but two live agent keys for one user were possible. A partial UNIQUE index
-- makes the claim true. Revoked keys are excluded so a rotation (revoke old +
-- insert new) never trips it, and account-less keys (user_id NULL) are outside
-- it entirely. The mint RPC (api_key_issue_agent, next migration) rotates
-- inside one transaction, so it never even approaches the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_one_live_agent_key_per_user
  ON public.api_keys (user_id)
  WHERE user_id IS NOT NULL AND revoked_at IS NULL;
