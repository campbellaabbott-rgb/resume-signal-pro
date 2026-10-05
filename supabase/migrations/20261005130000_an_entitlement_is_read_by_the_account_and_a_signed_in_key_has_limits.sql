-- AN ENTITLEMENT IS READ BY THE ACCOUNT, AND A SIGNED-IN KEY HAS LIMITS.
--
-- Two holes in the agent's paid half, both of the shape "a value the caller
-- writes is trusted as if the server had written it".
--
-- 1. THE MANDATE'S EMAIL WAS THE ENTITLEMENT KEY, AND ITS OWNER WROTE IT
--    (defect sweep 1.07). agent_mandates_owner is FOR ALL USING (auth.uid() =
--    user_id), so a signed-in account could PATCH its own mandate's `email` to
--    any address — a paying subscriber's, or the comped support address the
--    site prints in its footer. agent-runner, apply-agent, apply-broker and
--    send-agent-digest then looked the subscription up by that column and ran
--    the $99 agent for a non-payer, with the claimed address on every form.
--
--    The column is now the ACCOUNT's address, always: a BEFORE INSERT/UPDATE
--    trigger sets it from auth.users by user_id, whatever the writer sent. The
--    one browser writer (MorningQueuePanel) already sends the account's
--    address, so nothing it does changes. Every existing row is re-derived
--    here. The edge functions this file ships with also stop reading the
--    column for entitlement and resolve the account's address themselves;
--    this trigger is what covers every reader they do not (send-agent-digest).
--
--    That alone does not prove the account's address belongs to the person:
--    sign-ups are confirmed automatically today, so registering a subscriber's
--    address (one with no account yet) made that subscription answer for the
--    new account. Section 1b closes it.
--
-- 1b. THE SUBSCRIPTION BELONGS TO THE ACCOUNT THAT BOUGHT IT (review of this
--    file; 1.07 completed, 2.09's tail). agent_subscribers gains user_id, and
--    every gate reads the subscription through agent_subscription_rows(user
--    ids), which answers a row only when
--      - it is BOUND to that account: create-agent-checkout (signed in) stamps
--        the buyer's user id on the Stripe subscription's metadata, and the
--        one shared Stripe reader (_shared/agent.ts checkAgentByEmail, which
--        the webhook calls on purchase) copies it onto the row; or
--      - it is unbound, its address is the account's, AND the account has
--        proven that mailbox: a Google or Apple sign-in whose identity says
--        the address is verified, or a confirmation made after the owner
--        recorded, in mailbox_proof_settings, when sign-up confirmation was
--        switched on (and more than five seconds after the account was made,
--        so an address confirmed by nobody at sign-up never counts).
--    While confirmation is automatic the second arm is open only to verified
--    Google and Apple identities. THE OWNER'S CLOSING STEP: switch email
--    confirmation on for sign-ups, then
--      UPDATE public.mailbox_proof_settings SET confirmation_required_since = now();
--    Rows that exist when this file runs are bound once to the account that
--    holds their address now — exactly what every gate already served — so no
--    paying customer is dropped; from here on an address alone binds nothing.
--
-- 2. AN ACCOUNT-LINKED AGENT KEY HAD NO MINT LIMIT (completeness review of
--    PR #13). api-key-request's free keys now sit behind a confirmed mailbox,
--    per-network and daily ceilings. agent-connect mints a key with the same
--    1,000-call daily quota for any signed-in session, and sign-ups are
--    confirmed automatically — so one script with N throwaway accounts held N
--    full-quota keys, the exact pool 20261004100000 retired. The mint now
--    takes the caller's network (a keyed hash, never the address) and is
--    bounded the way the free door is:
--      five mints a day per ACCOUNT (a rotation is a mint);
--      five a day per NETWORK, among accounts that pay for nothing;
--      api-key-request's own ceilings, a soft 150 a day past which only
--      networks that have not minted today are served and a hard 600 that
--      stops it — again for accounts that pay for nothing.
--    An account with an open Agent Pass or a live agent subscription is held
--    only to the per-account limit: it paid, and its key is what it bought.
--    The OAuth path (agent-mcp/oauth.ts) mints only when an account holds no
--    key and passes no network (its caller is a chat service's server). Its
--    mints are counted against their OWN daily ceiling and the soft shed does
--    not apply to them — a caller with no network cannot be told apart from
--    any other, so a shed there refused every first-time OAuth connection,
--    and four throwaway accounts on four networks were enough to trigger it
--    while the ceilings were 20/60 and shared (review of this file).
--
--    The old four-argument signature is dropped by catalogue lookup and the
--    new one keeps those four names first with the rest defaulted, so a
--    deployed caller that sends four named arguments still resolves.
--
-- And the paid queue, because what a pass buys is decided here too:
--
-- 3. A REFUSED PAID ROW GIVES ITS APPLICATION BACK (L6-07). A pass-funded
--    queue row that a gate refuses at preparation (a blocked employer, the
--    cooldown, a posting already handled) was skipped with no packet, so the
--    refund trigger on agent_submissions never fired and the application was
--    spent for nothing, against the pass page's own promise.
--    agent_queue_refuse decides the row and gives the application back once;
--    agent_queue.pass_refunded_at is the receipt, and the owner cannot write
--    it (their column grant is status and decided_at).
--
-- 4. A REQUEST THAT CHANGES NOTHING IS THE ONLY ONE CALLED A DUPLICATE (L9-01).
--    agent_queue_enqueue answered already_queued for ANY existing row — a
--    dismissed one, an expired pick, a runner pick the review-mode preparer
--    never reads, an unfunded row on an account that has since bought a pass
--    — and nothing happened, while the agent told its user the application was
--    queued. A row in any of those states is now approved and re-dated, and
--    stamped with (and charged to) the pass only when no pass already paid for
--    it; only an approved, paid-for row answers already_queued.

-- ── 1. the mandate's address is the account's ───────────────────────────────

CREATE OR REPLACE FUNCTION public.agent_mandate_email_is_the_accounts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.email := coalesce(
    (SELECT lower(btrim(u.email)) FROM auth.users u WHERE u.id = NEW.user_id),
    ''
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_mandate_email_is_the_accounts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_mandate_email_is_the_accounts() TO service_role;

DROP TRIGGER IF EXISTS agent_mandates_email_is_the_accounts ON public.agent_mandates;
CREATE TRIGGER agent_mandates_email_is_the_accounts
  BEFORE INSERT OR UPDATE ON public.agent_mandates
  FOR EACH ROW
  EXECUTE FUNCTION public.agent_mandate_email_is_the_accounts();

COMMENT ON COLUMN public.agent_mandates.email IS
  'The ACCOUNT''s address, set from auth.users by the agent_mandates_email_is_the_accounts trigger on every write. Never the writer''s choice: it was the entitlement join key, and its owner could write it (defect sweep 1.07).';

-- Every existing row, re-derived. The trigger fires on this UPDATE too, so the
-- value written is the trigger's, not this statement's.
UPDATE public.agent_mandates m
   SET email = coalesce((SELECT lower(btrim(u.email)) FROM auth.users u WHERE u.id = m.user_id), '')
 WHERE m.email IS DISTINCT FROM coalesce((SELECT lower(btrim(u.email)) FROM auth.users u WHERE u.id = m.user_id), '');

-- ── 1b. the subscription belongs to the account that bought it ─────────────

ALTER TABLE public.agent_subscribers ADD COLUMN IF NOT EXISTS user_id uuid;
CREATE INDEX IF NOT EXISTS agent_subscribers_user_idx
  ON public.agent_subscribers (user_id) WHERE user_id IS NOT NULL;
COMMENT ON COLUMN public.agent_subscribers.user_id IS
  'The account this subscription belongs to: the user id create-agent-checkout stamped on the Stripe subscription (copied here by checkAgentByEmail), or the account that held the address when 20261005130000 ran. Read through agent_subscription_rows; an unbound row answers only for an account that has proven its mailbox.';

-- The owner's record of when sign-up confirmation became real. One row.
CREATE TABLE IF NOT EXISTS public.mailbox_proof_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  confirmation_required_since timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mailbox_proof_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mailbox_proof_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mailbox_proof_settings TO service_role;
INSERT INTO public.mailbox_proof_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
COMMENT ON TABLE public.mailbox_proof_settings IS
  'confirmation_required_since: when the owner switched sign-up email confirmation on. NULL while sign-ups are confirmed automatically, which makes a confirmed address prove nothing (account_mailbox_proven). Set it, after switching confirmation on, with UPDATE public.mailbox_proof_settings SET confirmation_required_since = now().';

CREATE OR REPLACE FUNCTION public.account_mailbox_proven(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
     WHERE u.id = p_user_id
       AND coalesce(btrim(u.email), '') <> ''
       AND (
         -- A confirmation made while confirmation was required, and not in
         -- the instant the account was created (which is what an automatic
         -- confirmation looks like).
         EXISTS (
           SELECT 1 FROM public.mailbox_proof_settings s
            WHERE s.id
              AND s.confirmation_required_since IS NOT NULL
              AND u.email_confirmed_at IS NOT NULL
              AND u.email_confirmed_at >= s.confirmation_required_since
              AND u.email_confirmed_at > coalesce(u.created_at, u.email_confirmed_at) + interval '5 seconds'
         )
         -- Or a sign-in provider that verified this very address.
         OR EXISTS (
           SELECT 1 FROM auth.identities i
            WHERE i.user_id = u.id
              AND i.provider IN ('google', 'apple')
              AND lower(btrim(coalesce(i.identity_data->>'email', ''))) = lower(btrim(u.email))
              AND lower(coalesce(i.identity_data->>'email_verified', '')) = 'true'
         )
       )
  );
$$;

REVOKE ALL ON FUNCTION public.account_mailbox_proven(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_mailbox_proven(uuid) TO service_role;

-- THE ONE READ OF "WHICH SUBSCRIPTION IS THIS ACCOUNT'S". One row per account
-- at most: a bound row, or an unbound row on the account's own address when
-- the account has proven that mailbox; a live row before a lapsed one.
CREATE OR REPLACE FUNCTION public.agent_subscription_rows(p_user_ids uuid[])
RETURNS TABLE (
  user_id uuid,
  email text,
  status text,
  current_period_end timestamptz,
  updated_at timestamptz,
  bound boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (u.id)
         u.id, a.email, a.status, a.current_period_end, a.updated_at, (a.user_id IS NOT NULL)
    FROM auth.users u
    JOIN public.agent_subscribers a
      ON a.user_id = u.id
      OR (a.user_id IS NULL
          AND a.email = lower(btrim(u.email))
          AND public.account_mailbox_proven(u.id))
   WHERE u.id = ANY (coalesce(p_user_ids, '{}'::uuid[]))
   ORDER BY u.id,
            (a.status IN ('active', 'trialing')
             AND (a.current_period_end IS NULL OR a.current_period_end > now())) DESC,
            (a.user_id IS NOT NULL) DESC,
            a.updated_at DESC;
$$;

REVOKE ALL ON FUNCTION public.agent_subscription_rows(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_subscription_rows(uuid[]) TO service_role;

COMMENT ON FUNCTION public.agent_subscription_rows(uuid[]) IS
  'The agent subscription each account may use: a row bound to it (user_id), or an unbound row on its own address when account_mailbox_proven. Every entitlement gate reads this, never agent_subscribers by an address. service_role only.';

CREATE OR REPLACE FUNCTION public.agent_subscription_live(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agent_subscription_rows(ARRAY[p_user_id]) r
     WHERE r.status IN ('active', 'trialing')
       AND (r.current_period_end IS NULL OR r.current_period_end > now())
  );
$$;

REVOKE ALL ON FUNCTION public.agent_subscription_live(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_subscription_live(uuid) TO service_role;

-- Every row that exists now, bound to the account that holds its address now:
-- the state every gate already served, so nobody who pays is dropped. Rows
-- with no account yet stay unbound, and answer only a proven mailbox.
UPDATE public.agent_subscribers a
   SET user_id = u.id
  FROM auth.users u
 WHERE a.user_id IS NULL
   AND coalesce(btrim(u.email), '') <> ''
   AND lower(btrim(u.email)) = a.email;

-- ── 2. a signed-in key has limits ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.api_key_agent_mints (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  mint_net text,
  via text NOT NULL DEFAULT 'connect',
  paying boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.api_key_agent_mints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.api_key_agent_mints FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.api_key_agent_mints TO service_role;
CREATE INDEX IF NOT EXISTS api_key_agent_mints_user_idx ON public.api_key_agent_mints (user_id, created_at);
CREATE INDEX IF NOT EXISTS api_key_agent_mints_net_idx ON public.api_key_agent_mints (mint_net, created_at);
CREATE INDEX IF NOT EXISTS api_key_agent_mints_day_idx ON public.api_key_agent_mints (created_at);
CREATE INDEX IF NOT EXISTS api_key_agent_mints_via_idx ON public.api_key_agent_mints (via, created_at);
COMMENT ON TABLE public.api_key_agent_mints IS
  'One row per account-linked agent key minted (agent-connect, or the OAuth path). Counts the per-account, per-network and daily mint limits of api_key_issue_agent. mint_net is a keyed hash of the caller''s network, never an address. Service-role only.';

-- The signature every migration so far wrote, by name; then any overload no
-- migration wrote, by catalogue lookup — so exactly one survives.
DROP FUNCTION IF EXISTS public.api_key_issue_agent(uuid, text, text, text);
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = 'api_key_issue_agent'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;

CREATE FUNCTION public.api_key_issue_agent(
  p_user_id uuid,
  p_email text,
  p_key_hash text,
  p_key_prefix text,
  p_net text DEFAULT NULL,
  p_via text DEFAULT 'connect'
)
RETURNS TABLE (
  issued_ok boolean,
  deny_reason text,
  issued_key_id uuid,
  rotated_prior boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  v_new_id uuid;
  v_rotated integer;
  v_n integer;
  v_net_day integer := 0;
  v_paying boolean;
  v_via text := left(coalesce(nullif(btrim(p_via), ''), 'connect'), 24);
  c_per_user_day integer := 5;
  c_per_net_day integer := 5;
  -- api-key-request's ceilings (20261004100000), counted per door below.
  c_global_soft integer := 150;
  c_global_day integer := 600;
  c_net_share integer := 1;
BEGIN
  IF p_user_id IS NULL OR coalesce(btrim(p_email), '') = ''
     OR coalesce(length(p_key_hash), 0) <> 64 OR coalesce(length(p_key_prefix), 0) = 0 THEN
    RETURN QUERY SELECT false, 'bad_request'::text, NULL::uuid, false; RETURN;
  END IF;

  -- Every count below and the insert after them are one decision.
  PERFORM pg_advisory_xact_lock(hashtext('api_key_agent_issuance'));

  -- Paying: an open Agent Pass, or a live agent subscription that is this
  -- ACCOUNT's (agent_subscription_live: bound to it, or on a mailbox it has
  -- proven) — never one found by the address alone.
  v_paying := EXISTS (
      SELECT 1 FROM public.agent_passes ap
       WHERE ap.user_id = p_user_id AND ap.closed_at IS NULL
    ) OR public.agent_subscription_live(p_user_id);

  SELECT count(*) INTO v_n FROM public.api_key_agent_mints am
   WHERE am.user_id = p_user_id AND am.created_at > now() - interval '24 hours';
  IF v_n >= c_per_user_day THEN
    RETURN QUERY SELECT false, 'account_limit'::text, NULL::uuid, false; RETURN;
  END IF;

  IF NOT v_paying THEN
    IF p_net IS NOT NULL THEN
      SELECT count(*) INTO v_net_day FROM public.api_key_agent_mints am
       WHERE am.mint_net = p_net AND NOT am.paying AND am.created_at > now() - interval '24 hours';
      IF v_net_day >= c_per_net_day THEN
        RETURN QUERY SELECT false, 'network_limit'::text, NULL::uuid, false; RETURN;
      END IF;
    END IF;
    -- Each door has its own day: a flood through agent-connect cannot close
    -- the OAuth connection, and the reverse.
    SELECT count(*) INTO v_n FROM public.api_key_agent_mints am
     WHERE NOT am.paying AND am.via = v_via AND am.created_at > now() - interval '24 hours';
    IF v_n >= c_global_day THEN
      RETURN QUERY SELECT false, 'paused'::text, NULL::uuid, false; RETURN;
    END IF;
    -- The soft shed favours networks that have not minted today. The OAuth
    -- door names no network, so it cannot favour anyone there: only its hard
    -- ceiling and the per-account limit hold it.
    IF v_via <> 'oauth' AND v_n >= c_global_soft AND (p_net IS NULL OR v_net_day >= c_net_share) THEN
      RETURN QUERY SELECT false, 'shed'::text, NULL::uuid, false; RETURN;
    END IF;
  END IF;

  -- Rotate and insert in one transaction, as before: a failure anywhere rolls
  -- the revoke back, so there is never a keyless window.
  UPDATE public.api_keys
     SET revoked_at = now(), notes = 'rotated by api_key_issue_agent'
   WHERE user_id = p_user_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_rotated = ROW_COUNT;

  INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier, user_id)
  VALUES (p_key_hash, p_key_prefix, 'agent-mcp', lower(btrim(p_email)), 'free', p_user_id)
  RETURNING id INTO v_new_id;

  INSERT INTO public.api_key_agent_mints (user_id, mint_net, via, paying)
  VALUES (p_user_id, p_net, v_via, v_paying);

  RETURN QUERY SELECT true, NULL::text, v_new_id, (v_rotated > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.api_key_issue_agent(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_issue_agent(uuid, text, text, text, text, text) TO service_role;

COMMENT ON FUNCTION public.api_key_issue_agent(uuid, text, text, text, text, text) IS
  'Mints the one live account-linked agent key for a VERIFIED user (agent-connect, or the OAuth path), rotating any prior one in the same transaction. Bounded: five mints a day per account; for accounts paying for nothing also five a day per network and 150 (soft) / 600 (hard) a day per door (connect, oauth), the soft shed only where a network is named. service_role only.';

-- ── 3. a refused paid row gives its application back ───────────────────────

ALTER TABLE public.agent_queue ADD COLUMN IF NOT EXISTS pass_refunded_at timestamptz;
COMMENT ON COLUMN public.agent_queue.pass_refunded_at IS
  'Set when a pass-funded row was refused before preparation and its application given back (agent_queue_refuse). Not writable by the owner (column grant: status, decided_at).';

CREATE OR REPLACE FUNCTION public.agent_queue_refuse(p_row_id bigint, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass uuid;
BEGIN
  -- NEVER A ROW A PACKET WAS PREPARED FROM. That packet carries this row's
  -- pass_id, and the refund trigger on agent_submissions gives the same
  -- application back if the packet ends blocked or stale — so refusing the
  -- row as well would refund it twice, or hand back an application the packet
  -- is still spending. A prepared posting is the paid work, not a refusal.
  SELECT q.pass_id INTO v_pass
    FROM public.agent_queue q
   WHERE q.id = p_row_id
     AND q.status IN ('ready', 'approved')
     AND q.pass_id IS NOT NULL
     AND q.pass_refunded_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.agent_submissions s
        WHERE s.user_id = q.user_id AND s.posting_id = q.posting_id
     )
   FOR UPDATE;
  IF v_pass IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.agent_queue
     SET status = 'dismissed', decided_at = now(), pass_refunded_at = now()
   WHERE id = p_row_id;
  UPDATE public.agent_passes ap
     SET applications_used = greatest(ap.applications_used - 1, 0)
   WHERE ap.id = v_pass;
  RAISE LOG 'agent_queue_refuse: row % refused (%) and its pass application returned', p_row_id, left(coalesce(p_reason, ''), 60);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_queue_refuse(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_queue_refuse(bigint, text) TO service_role;

-- ── 4. a request that changes nothing is the only one called a duplicate ───

CREATE OR REPLACE FUNCTION public.agent_queue_enqueue(
  p_user_id uuid,
  p_posting_id text,
  p_row jsonb,
  p_pass_funded boolean
)
RETURNS TABLE (
  enqueued_ok boolean,
  enqueue_reason text,
  queued_row_id bigint,
  pass_apps_left integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass_id uuid;
  v_left integer;
  v_row_id bigint;
  v_row jsonb := coalesce(p_row, '{}'::jsonb);
  v_posting text := btrim(coalesce(p_posting_id, ''));
  e record;
  v_charge boolean := false;
BEGIN
  IF p_user_id IS NULL OR v_posting = '' THEN
    RETURN QUERY SELECT false, 'bad_request'::text, NULL::bigint, NULL::integer; RETURN;
  END IF;

  IF p_pass_funded THEN
    UPDATE public.agent_passes ap
       SET closed_at = now(),
           close_reason = CASE WHEN ap.activated_at IS NULL THEN 'shelf_expired' ELSE 'session_ended' END
     WHERE ap.user_id = p_user_id
       AND ap.closed_at IS NULL
       AND coalesce(ap.expires_at, ap.shelf_expires_at) <= now();

    SELECT ap.id, ap.applications_total - ap.applications_used
      INTO v_pass_id, v_left
      FROM public.agent_passes ap
     WHERE ap.user_id = p_user_id
       AND ap.closed_at IS NULL
       AND ap.activated_at IS NOT NULL
       AND ap.expires_at > now()
     FOR UPDATE;

    IF v_pass_id IS NULL THEN
      RETURN QUERY SELECT false, 'pass_not_live'::text, NULL::bigint, NULL::integer; RETURN;
    END IF;
  END IF;

  SELECT q.id AS qid, q.status AS qstatus, q.pass_id AS qpass, q.pass_refunded_at AS qrefunded
    INTO e
    FROM public.agent_queue q
   WHERE q.user_id = p_user_id AND q.posting_id = v_posting
   FOR UPDATE;

  -- A NEW ROW: inserted and, when a pass funds it, paid for in the same
  -- transaction. The row exists before anything is charged.
  IF e.qid IS NULL THEN
    IF p_pass_funded AND v_left <= 0 THEN
      RETURN QUERY SELECT false, 'pass_exhausted'::text, NULL::bigint, 0; RETURN;
    END IF;

  INSERT INTO public.agent_queue (
    user_id, posting_id, title, company, company_token, location, apply_url,
    salary, category, posted_at, fit_pct, reasons, status, search_id, search_label, pass_id
  ) VALUES (
    p_user_id,
    v_posting,
    coalesce(v_row->>'title', ''),
    coalesce(v_row->>'company', ''),
    coalesce(v_row->>'company_token', ''),
    coalesce(v_row->>'location', ''),
    coalesce(v_row->>'apply_url', ''),
    coalesce(v_row->>'salary', ''),
    coalesce(nullif(v_row->>'category', ''), 'other'),
    (v_row->>'posted_at')::timestamptz,
    (v_row->>'fit_pct')::integer,
    CASE WHEN jsonb_typeof(v_row->'reasons') = 'array' THEN v_row->'reasons' ELSE '[]'::jsonb END,
    coalesce(nullif(v_row->>'status', ''), 'approved'),
    (v_row->>'search_id')::bigint,
    coalesce(v_row->>'search_label', ''),
    CASE WHEN p_pass_funded THEN v_pass_id ELSE NULL END
  )
  ON CONFLICT (user_id, posting_id) DO NOTHING
  RETURNING id INTO v_row_id;

    IF v_row_id IS NULL THEN
      -- A concurrent request inserted it between the read and the insert;
      -- that one paid, this one is the duplicate.
      RETURN QUERY SELECT true, 'already_queued'::text, NULL::bigint, v_left; RETURN;
    END IF;

    IF p_pass_funded THEN
      UPDATE public.agent_passes ap
         SET applications_used = ap.applications_used + 1
       WHERE ap.id = v_pass_id
      RETURNING ap.applications_total - ap.applications_used INTO v_left;
    END IF;

    RETURN QUERY SELECT true, 'queued'::text, v_row_id, v_left; RETURN;
  END IF;

  -- AN EXISTING ROW. Approved and paid for already: the request changes
  -- nothing and costs nothing.
  IF e.qstatus = 'approved'
     AND (NOT p_pass_funded OR (e.qpass IS NOT NULL AND e.qrefunded IS NULL)) THEN
    RETURN QUERY SELECT true, 'already_queued'::text, e.qid, v_left; RETURN;
  END IF;
  v_charge := p_pass_funded AND (e.qpass IS NULL OR e.qrefunded IS NOT NULL);
  IF v_charge AND v_left <= 0 THEN
    RETURN QUERY SELECT false, 'pass_exhausted'::text, NULL::bigint, 0; RETURN;
  END IF;
  -- A dismissed or expired row, a runner pick the preparer would not read, an
  -- unfunded row: the user's agent has now asked for it, so it is approved,
  -- re-dated (so retention and the newest-first read treat it as the request
  -- it is), and stamped with the pass that pays for it — the row first, the
  -- charge after it.
  UPDATE public.agent_queue q
     SET status = 'approved', decided_at = now(), created_at = now(),
         pass_id = CASE WHEN v_charge THEN v_pass_id ELSE q.pass_id END,
         pass_refunded_at = CASE WHEN v_charge THEN NULL ELSE q.pass_refunded_at END
   WHERE q.id = e.qid;
  IF v_charge THEN
    UPDATE public.agent_passes ap
       SET applications_used = ap.applications_used + 1
     WHERE ap.id = v_pass_id
    RETURNING ap.applications_total - ap.applications_used INTO v_left;
  END IF;
  RETURN QUERY SELECT true, 'requeued'::text, e.qid, v_left;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_queue_enqueue(uuid, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_queue_enqueue(uuid, text, jsonb, boolean) TO service_role;

-- ── self-check ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_n integer;
  v_fn oid := to_regprocedure('public.api_key_issue_agent(uuid,text,text,text,text,text)');
  v_trg oid := to_regprocedure('public.agent_mandate_email_is_the_accounts()');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.agent_mandates'::regclass
       AND t.tgname = 'agent_mandates_email_is_the_accounts' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'self-check: the trigger that pins agent_mandates.email to the account is missing';
  END IF;
  IF v_trg IS NULL OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_trg) THEN
    RAISE EXCEPTION 'self-check: agent_mandate_email_is_the_accounts is missing or not SECURITY DEFINER';
  END IF;

  SELECT count(*) INTO v_n
    FROM public.agent_mandates m
   WHERE m.email IS DISTINCT FROM coalesce((SELECT lower(btrim(u.email)) FROM auth.users u WHERE u.id = m.user_id), '');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'self-check: % mandate(s) still carry an address that is not their account''s', v_n;
  END IF;

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'api_key_issue_agent';
  IF v_n <> 1 OR v_fn IS NULL THEN
    RAISE EXCEPTION 'self-check: api_key_issue_agent has % overload(s), want exactly the six-argument one', v_n;
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) THEN
    RAISE EXCEPTION 'self-check: api_key_issue_agent is not SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: api_key_issue_agent is executable by a client role';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: service_role cannot execute api_key_issue_agent';
  END IF;
  IF has_function_privilege('anon', v_trg, 'EXECUTE')
     OR has_function_privilege('authenticated', v_trg, 'EXECUTE') THEN
    RAISE EXCEPTION 'self-check: agent_mandate_email_is_the_accounts is executable by a client role';
  END IF;

  IF to_regclass('public.api_key_agent_mints') IS NULL THEN
    RAISE EXCEPTION 'self-check: api_key_agent_mints is missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.api_key_agent_mints'::regclass) THEN
    RAISE EXCEPTION 'self-check: api_key_agent_mints has row level security off';
  END IF;
  IF has_table_privilege('anon', 'public.api_key_agent_mints', 'SELECT')
     OR has_table_privilege('authenticated', 'public.api_key_agent_mints', 'SELECT') THEN
    RAISE EXCEPTION 'self-check: api_key_agent_mints is readable by a client role';
  END IF;

  FOR v_fn IN SELECT unnest(ARRAY[
    to_regprocedure('public.agent_queue_refuse(bigint,text)'),
    to_regprocedure('public.agent_queue_enqueue(uuid,text,jsonb,boolean)'),
    to_regprocedure('public.account_mailbox_proven(uuid)'),
    to_regprocedure('public.agent_subscription_rows(uuid[])'),
    to_regprocedure('public.agent_subscription_live(uuid)')
  ]) LOOP
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'self-check: one of agent_queue_refuse, agent_queue_enqueue, account_mailbox_proven, agent_subscription_rows, agent_subscription_live is missing';
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) THEN
      RAISE EXCEPTION 'self-check: % is not SECURITY DEFINER', v_fn::regprocedure;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: % is executable by a client role', v_fn::regprocedure;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'agent_queue' AND column_name = 'pass_refunded_at') THEN
    RAISE EXCEPTION 'self-check: agent_queue.pass_refunded_at is missing';
  END IF;
  IF has_column_privilege('authenticated', 'public.agent_queue', 'pass_refunded_at', 'UPDATE') THEN
    RAISE EXCEPTION 'self-check: the owner can write agent_queue.pass_refunded_at';
  END IF;
  IF has_table_privilege('anon', 'public.mailbox_proof_settings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.mailbox_proof_settings', 'UPDATE') THEN
    RAISE EXCEPTION 'self-check: a client role can read or move mailbox_proof_settings';
  END IF;
END $$;

-- ── self-check, exercised ───────────────────────────────────────────────────
--
-- Every claim above, RUN against the real tables, triggers and functions with
-- one existing account, inside a block that always ends by raising RB000 — so
-- every row it writes is rolled back, and any assertion that fails raises
-- something else and stops this file. Nothing here survives the block.
DO $$
DECLARE
  v_uid uuid;
  v_email text;
  v_tag text := replace(gen_random_uuid()::text, '-', '');
  v_stranger uuid := gen_random_uuid();
  v_pass uuid;
  v_row bigint;
  v_prepared bigint;
  v_used integer;
  r record;
  i integer;
  v_proven_by_identity boolean;
BEGIN
  SELECT u.id, lower(btrim(u.email)) INTO v_uid, v_email
    FROM auth.users u
   WHERE coalesce(btrim(u.email), '') <> ''
   ORDER BY u.created_at NULLS LAST, u.id
   LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE 'self-check: no account exists to exercise these paths against; the catalogue checks above are all that ran';
    RETURN;
  END IF;

  BEGIN
    -- As the pipeline: service_role, which the refund and wake gates read.
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);

    -- 1. A mandate written with another address carries the account's.
    --    last_prepare_kick_at keeps the on-save kick from firing.
    INSERT INTO public.agent_mandates (user_id, email, active, last_prepare_kick_at)
    VALUES (v_uid, 'someone-else-' || v_tag || '@self-check.invalid', false, now())
    ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, last_prepare_kick_at = now();
    IF (SELECT m.email FROM public.agent_mandates m WHERE m.user_id = v_uid) IS DISTINCT FROM v_email THEN
      RAISE EXCEPTION 'self-check: a mandate written with another address kept it';
    END IF;

    -- 2. The subscription is the account's only when bound to it, or on a
    --    mailbox it proved. Everything this account holds is lapsed first.
    UPDATE public.agent_subscribers a SET status = 'canceled'
     WHERE a.user_id = v_uid OR a.email = v_email;
    UPDATE public.mailbox_proof_settings SET confirmation_required_since = NULL;
    v_proven_by_identity := EXISTS (
      SELECT 1 FROM auth.identities i JOIN auth.users u ON u.id = i.user_id
       WHERE i.user_id = v_uid AND i.provider IN ('google', 'apple')
         AND lower(btrim(coalesce(i.identity_data->>'email', ''))) = lower(btrim(u.email))
         AND lower(coalesce(i.identity_data->>'email_verified', '')) = 'true');
    IF public.account_mailbox_proven(v_uid) IS DISTINCT FROM v_proven_by_identity THEN
      RAISE EXCEPTION 'self-check: with confirmation recorded as off, only a verified provider identity proves a mailbox';
    END IF;
    IF public.agent_subscription_live(v_uid) THEN
      RAISE EXCEPTION 'self-check: an account whose every subscription lapsed still reads as subscribed';
    END IF;

    -- 2a. Bound to this account, under any address: it is the account's.
    INSERT INTO public.agent_subscribers (email, status, current_period_end, user_id)
    VALUES ('bound-' || v_tag || '@self-check.invalid', 'active', now() + interval '20 days', v_uid);
    SELECT * INTO r FROM public.agent_subscription_rows(ARRAY[v_uid]);
    IF r.bound IS DISTINCT FROM true OR r.status IS DISTINCT FROM 'active' OR NOT public.agent_subscription_live(v_uid) THEN
      RAISE EXCEPTION 'self-check: a live subscription bound to the account does not answer for it';
    END IF;
    DELETE FROM public.agent_subscribers WHERE email = 'bound-' || v_tag || '@self-check.invalid';

    -- 2b. On the account's own address but bound to ANOTHER account: never.
    INSERT INTO public.agent_subscribers (email, status, current_period_end, user_id)
    VALUES (v_email, 'active', now() + interval '20 days', v_stranger)
    ON CONFLICT (email) DO UPDATE SET status = 'active', current_period_end = EXCLUDED.current_period_end, user_id = v_stranger;
    IF public.agent_subscription_live(v_uid) THEN
      RAISE EXCEPTION 'self-check: a subscription bound to another account answers for whoever holds its address';
    END IF;

    -- 2c. On the account's own address and unbound: only a proven mailbox.
    UPDATE public.agent_subscribers SET user_id = NULL WHERE email = v_email;
    IF public.agent_subscription_live(v_uid) IS DISTINCT FROM v_proven_by_identity THEN
      RAISE EXCEPTION 'self-check: an unbound subscription answered for an address nobody proved (or refused a proven one)';
    END IF;
    UPDATE public.agent_subscribers a SET status = 'canceled' WHERE a.email = v_email;

    -- 3. The mint ledger: five a day per account, then account_limit, each
    --    mint rotating the last. A random account id: no key table names it.
    FOR i IN 1..5 LOOP
      SELECT * INTO r FROM public.api_key_issue_agent(v_stranger, 'mint-' || v_tag || '@self-check.invalid',
        encode(sha256(convert_to(v_tag || 'a' || i, 'UTF8')), 'hex'), 'rb_live_sc', 'sc-net-a-' || v_tag || i, 'connect');
      IF r.issued_ok IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'self-check: mint % of five for one account was refused (%)', i, r.deny_reason;
      END IF;
    END LOOP;
    SELECT * INTO r FROM public.api_key_issue_agent(v_stranger, 'mint-' || v_tag || '@self-check.invalid',
      encode(sha256(convert_to(v_tag || 'a6', 'UTF8')), 'hex'), 'rb_live_sc', 'sc-net-a6-' || v_tag, 'connect');
    IF r.issued_ok OR r.deny_reason IS DISTINCT FROM 'account_limit' THEN
      RAISE EXCEPTION 'self-check: a sixth mint in a day for one account was not refused account_limit';
    END IF;
    IF (SELECT count(*) FROM public.api_keys k WHERE k.user_id = v_stranger AND k.revoked_at IS NULL) <> 1 THEN
      RAISE EXCEPTION 'self-check: rotation left more than one live key on one account';
    END IF;

    -- 3a. Five a day per network among accounts paying for nothing.
    FOR i IN 1..5 LOOP
      SELECT * INTO r FROM public.api_key_issue_agent(gen_random_uuid(), 'net-' || v_tag || '@self-check.invalid',
        encode(sha256(convert_to(v_tag || 'n' || i, 'UTF8')), 'hex'), 'rb_live_sc', 'sc-net-shared-' || v_tag, 'connect');
      IF r.issued_ok IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'self-check: network mint % of five was refused (%)', i, r.deny_reason;
      END IF;
    END LOOP;
    SELECT * INTO r FROM public.api_key_issue_agent(gen_random_uuid(), 'net-' || v_tag || '@self-check.invalid',
      encode(sha256(convert_to(v_tag || 'n6', 'UTF8')), 'hex'), 'rb_live_sc', 'sc-net-shared-' || v_tag, 'connect');
    IF r.issued_ok OR r.deny_reason IS DISTINCT FROM 'network_limit' THEN
      RAISE EXCEPTION 'self-check: a sixth free mint from one network was not refused network_limit';
    END IF;

    -- 3b. Each door keeps its own day. 150 connect mints shed a network that
    --     already minted, and do not touch the OAuth door, which names no
    --     network and is never shed; 600 OAuth mints pause the OAuth door.
    INSERT INTO public.api_key_agent_mints (user_id, mint_net, via, paying)
    SELECT gen_random_uuid(), 'sc-flood-' || v_tag || g, 'connect', false FROM generate_series(1, 150) g;
    SELECT * INTO r FROM public.api_key_issue_agent(gen_random_uuid(), 'door-' || v_tag || '@self-check.invalid',
      encode(sha256(convert_to(v_tag || 'd1', 'UTF8')), 'hex'), 'rb_live_sc', 'sc-flood-' || v_tag || '1', 'connect');
    IF r.issued_ok OR r.deny_reason IS DISTINCT FROM 'shed' THEN
      RAISE EXCEPTION 'self-check: past 150 free connect mints a network that already minted was not shed (%)', r.deny_reason;
    END IF;
    SELECT * INTO r FROM public.api_key_issue_agent(gen_random_uuid(), 'door-' || v_tag || '@self-check.invalid',
      encode(sha256(convert_to(v_tag || 'd2', 'UTF8')), 'hex'), 'rb_live_sc', NULL, 'oauth');
    IF r.issued_ok IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'self-check: a connect flood closed the OAuth door (%)', r.deny_reason;
    END IF;
    -- Past the soft ceiling on its OWN door, an OAuth first mint (no network
    -- to favour) is still served: only the hard ceiling holds that door.
    INSERT INTO public.api_key_agent_mints (user_id, mint_net, via, paying)
    SELECT gen_random_uuid(), NULL, 'oauth', false FROM generate_series(1, 150);
    SELECT * INTO r FROM public.api_key_issue_agent(gen_random_uuid(), 'door-' || v_tag || '@self-check.invalid',
      encode(sha256(convert_to(v_tag || 'd2b', 'UTF8')), 'hex'), 'rb_live_sc', NULL, 'oauth');
    IF r.issued_ok IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'self-check: past 150 OAuth mints the OAuth door shed a first-time connection (%)', r.deny_reason;
    END IF;
    INSERT INTO public.api_key_agent_mints (user_id, mint_net, via, paying)
    SELECT gen_random_uuid(), NULL, 'oauth', false FROM generate_series(1, 450);
    SELECT * INTO r FROM public.api_key_issue_agent(gen_random_uuid(), 'door-' || v_tag || '@self-check.invalid',
      encode(sha256(convert_to(v_tag || 'd3', 'UTF8')), 'hex'), 'rb_live_sc', NULL, 'oauth');
    IF r.issued_ok OR r.deny_reason IS DISTINCT FROM 'paused' THEN
      RAISE EXCEPTION 'self-check: 600 free OAuth mints in a day did not pause the OAuth door (%)', r.deny_reason;
    END IF;
    -- ...and that pause is the OAuth door's alone: a network that has not
    -- minted today still gets a connect key.
    SELECT * INTO r FROM public.api_key_issue_agent(gen_random_uuid(), 'door-' || v_tag || '@self-check.invalid',
      encode(sha256(convert_to(v_tag || 'd4', 'UTF8')), 'hex'), 'rb_live_sc', 'sc-fresh-net-' || v_tag, 'connect');
    IF r.issued_ok IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'self-check: an OAuth flood paused the connect door (%)', r.deny_reason;
    END IF;

    -- 3c. An account with an open pass is held only to its own limit.
    UPDATE public.agent_passes SET closed_at = now(), close_reason = 'session_ended'
     WHERE user_id = v_uid AND closed_at IS NULL;
    DELETE FROM public.api_key_agent_mints WHERE user_id = v_uid;
    -- Placeholder numbers, never the pass's own (those are declared once, in
    -- supabase/functions/_shared/pass.ts): three applications are all the
    -- paid-queue checks below spend.
    INSERT INTO public.agent_passes (user_id, stripe_session_id, amount_cents, session_hours, applications_total,
                                     applications_used, rate_per_min, daily_quota, shelf_expires_at, activated_at, expires_at)
    VALUES (v_uid, 'cs_self_check_' || v_tag, 1, 1, 3, 0, 1, 1, now() + interval '1 day', now(), now() + interval '1 hour')
    RETURNING id INTO v_pass;
    SELECT * INTO r FROM public.api_key_issue_agent(v_uid, v_email,
      encode(sha256(convert_to(v_tag || 'p1', 'UTF8')), 'hex'), 'rb_live_sc', 'sc-net-shared-' || v_tag, 'connect');
    IF r.issued_ok IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'self-check: a paying account was refused by a network limit (%)', r.deny_reason;
    END IF;

    -- 4. The paid queue. A new pass-funded row is charged once; asking again
    --    costs nothing; a dismissed row is approved again, not a duplicate.
    SELECT * INTO r FROM public.agent_queue_enqueue(v_uid, 'self-check:' || v_tag || ':1', '{"title":"t","company":"Self-check Co"}'::jsonb, true);
    IF r.enqueue_reason IS DISTINCT FROM 'queued' THEN
      RAISE EXCEPTION 'self-check: a new pass-funded request was not queued (%)', r.enqueue_reason;
    END IF;
    SELECT * INTO r FROM public.agent_queue_enqueue(v_uid, 'self-check:' || v_tag || ':1', '{}'::jsonb, true);
    SELECT ap.applications_used INTO v_used FROM public.agent_passes ap WHERE ap.id = v_pass;
    IF r.enqueue_reason IS DISTINCT FROM 'already_queued' OR v_used <> 1 THEN
      RAISE EXCEPTION 'self-check: asking twice for one posting changed or cost something (%, used %)', r.enqueue_reason, v_used;
    END IF;
    INSERT INTO public.agent_queue (user_id, posting_id, status) VALUES (v_uid, 'self-check:' || v_tag || ':2', 'dismissed');
    SELECT * INTO r FROM public.agent_queue_enqueue(v_uid, 'self-check:' || v_tag || ':2', '{}'::jsonb, true);
    SELECT ap.applications_used INTO v_used FROM public.agent_passes ap WHERE ap.id = v_pass;
    IF r.enqueue_reason IS DISTINCT FROM 'requeued' OR v_used <> 2 THEN
      RAISE EXCEPTION 'self-check: a dismissed row was called a duplicate, or not paid for (%, used %)', r.enqueue_reason, v_used;
    END IF;

    -- 4a. A refused pass row gives its application back exactly once...
    SELECT q.id INTO v_row FROM public.agent_queue q WHERE q.user_id = v_uid AND q.posting_id = 'self-check:' || v_tag || ':1';
    IF NOT public.agent_queue_refuse(v_row, 'self-check') THEN
      RAISE EXCEPTION 'self-check: a refused pass-funded row was not refunded';
    END IF;
    IF public.agent_queue_refuse(v_row, 'self-check') THEN
      RAISE EXCEPTION 'self-check: one refused row was refunded twice';
    END IF;
    SELECT ap.applications_used INTO v_used FROM public.agent_passes ap WHERE ap.id = v_pass;
    IF v_used <> 1 THEN
      RAISE EXCEPTION 'self-check: a refusal returned % applications, want exactly one', 2 - v_used;
    END IF;

    -- 4b. ...and never for a row a packet was prepared from: that packet is
    --     the paid work, and the refund trigger answers for it.
    SELECT q.id INTO v_prepared FROM public.agent_queue q WHERE q.user_id = v_uid AND q.posting_id = 'self-check:' || v_tag || ':2';
    INSERT INTO public.agent_submissions (user_id, posting_id, company, status, pass_id)
    VALUES (v_uid, 'self-check:' || v_tag || ':2', 'Self-check Co', 'ready', v_pass);
    IF public.agent_queue_refuse(v_prepared, 'already-prepared') THEN
      RAISE EXCEPTION 'self-check: a row with a prepared packet was refunded as a refusal';
    END IF;
    SELECT ap.applications_used INTO v_used FROM public.agent_passes ap WHERE ap.id = v_pass;
    IF v_used <> 1 THEN
      RAISE EXCEPTION 'self-check: refusing a prepared row moved the pass to % used', v_used;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'RB000', MESSAGE = 'self-check passed; its rows are rolled back';
  EXCEPTION WHEN SQLSTATE 'RB000' THEN
    NULL;
  END;
END $$;
