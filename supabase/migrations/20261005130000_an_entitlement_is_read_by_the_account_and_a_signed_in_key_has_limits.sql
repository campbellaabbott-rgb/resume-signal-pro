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
--    WHAT THIS DOES NOT PROVE: that the account's address belongs to the
--    person. Sign-ups are confirmed automatically today, so the address on an
--    account is a claim too. It is no longer a claim anyone can change on an
--    existing account through RLS, and it is unique across accounts, but the
--    complete fix binds the Stripe subscription to the user id at checkout
--    (create-agent-checkout and stripe-webhook, outside this change).
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
--      a soft ceiling of 20 a day past which only networks that have not
--      minted today are served, and a hard one of 60 that stops it — again
--      for accounts that pay for nothing.
--    An account with an open Agent Pass or a live agent subscription is held
--    only to the per-account limit: it paid, and its key is what it bought.
--    The OAuth path (agent-mcp/oauth.ts) mints only when an account holds no
--    key, passes no network (its caller is a chat service's server), and is
--    bounded by the same per-account and daily ceilings.
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
  c_per_user_day integer := 5;
  c_per_net_day integer := 5;
  c_global_soft integer := 20;
  c_global_day integer := 60;
  c_net_share integer := 1;
BEGIN
  IF p_user_id IS NULL OR coalesce(btrim(p_email), '') = ''
     OR coalesce(length(p_key_hash), 0) <> 64 OR coalesce(length(p_key_prefix), 0) = 0 THEN
    RETURN QUERY SELECT false, 'bad_request'::text, NULL::uuid, false; RETURN;
  END IF;

  -- Every count below and the insert after them are one decision.
  PERFORM pg_advisory_xact_lock(hashtext('api_key_agent_issuance'));

  -- Paying: an open Agent Pass, or a live agent subscription on the
  -- account's own address (the caller passes the address of the VERIFIED
  -- user, never a typed one).
  v_paying := EXISTS (
      SELECT 1 FROM public.agent_passes ap
       WHERE ap.user_id = p_user_id AND ap.closed_at IS NULL
    ) OR EXISTS (
      SELECT 1 FROM public.agent_subscribers s
       WHERE s.email = lower(btrim(p_email))
         AND s.status IN ('active', 'trialing')
         AND (s.current_period_end IS NULL OR s.current_period_end > now())
    );

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
    SELECT count(*) INTO v_n FROM public.api_key_agent_mints am
     WHERE NOT am.paying AND am.created_at > now() - interval '24 hours';
    IF v_n >= c_global_day THEN
      RETURN QUERY SELECT false, 'paused'::text, NULL::uuid, false; RETURN;
    END IF;
    IF v_n >= c_global_soft AND (p_net IS NULL OR v_net_day >= c_net_share) THEN
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
  VALUES (p_user_id, p_net, left(coalesce(nullif(btrim(p_via), ''), 'connect'), 24), v_paying);

  RETURN QUERY SELECT true, NULL::text, v_new_id, (v_rotated > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.api_key_issue_agent(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_issue_agent(uuid, text, text, text, text, text) TO service_role;

COMMENT ON FUNCTION public.api_key_issue_agent(uuid, text, text, text, text, text) IS
  'Mints the one live account-linked agent key for a VERIFIED user (agent-connect, or the OAuth path), rotating any prior one in the same transaction. Bounded: five mints a day per account; for accounts paying for nothing also five a day per network and 20 (soft) / 60 (hard) a day overall. service_role only.';

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
  SELECT q.pass_id INTO v_pass
    FROM public.agent_queue q
   WHERE q.id = p_row_id
     AND q.status IN ('ready', 'approved')
     AND q.pass_id IS NOT NULL
     AND q.pass_refunded_at IS NULL
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
    to_regprocedure('public.agent_queue_enqueue(uuid,text,jsonb,boolean)')
  ]) LOOP
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'self-check: agent_queue_refuse or agent_queue_enqueue is missing';
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) THEN
      RAISE EXCEPTION 'self-check: % is not SECURITY DEFINER', v_fn::regprocedure;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'self-check: % is executable by a client role', v_fn::regprocedure;
    END IF;
  END LOOP;
  IF (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.agent_queue_enqueue(uuid,text,jsonb,boolean)'))
     NOT LIKE '%requeued%' THEN
    RAISE EXCEPTION 'self-check: agent_queue_enqueue still calls every existing row a duplicate';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'agent_queue' AND column_name = 'pass_refunded_at') THEN
    RAISE EXCEPTION 'self-check: agent_queue.pass_refunded_at is missing';
  END IF;
  IF has_column_privilege('authenticated', 'public.agent_queue', 'pass_refunded_at', 'UPDATE') THEN
    RAISE EXCEPTION 'self-check: the owner can write agent_queue.pass_refunded_at';
  END IF;
END $$;
