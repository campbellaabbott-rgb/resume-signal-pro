-- lovable-cron-fallback-reviewed: no cron; this file schedules nothing (API4 W1 lane A4, Builder grants; reviewed 2026-11-18).
--
-- A BUILDER KEY IS GRANTED BY A WRITTEN REQUEST, AND RECORDED (API4 W1, A4).
--
-- WHAT IS MISSING TODAY. /data-api shows a planned Builder card ($49, 5,000
-- calls a day and 120 a minute) with no checkout behind it: billing is built
-- only once someone asks in writing (src/config/builder-plan.ts). A key's
-- limits are its own row (api_keys.tier, rate_per_min, daily_quota), which
-- api_key_check reads on every keyed call, so the only way to give a requester
-- Builder today is a hand-typed UPDATE: nothing records who asked, who
-- granted it, when, or why, nothing takes it back, and nothing counts the
-- requests that are the price test.
--
-- WHAT THIS ADDS.
--   api_tier_grants: one row per grant, never deleted. It records the key,
--   the limits the grant set, the limits the key had before (so an end puts
--   back exactly what was there), the note saying why, the role that ran the
--   grant, when it was granted, when it expires, and how it ended (revoked
--   or expired, by whom, with what note, and whether the old limits went
--   back). RLS on with no policy; anon and authenticated hold nothing on it;
--   the service role may read it and only the function below writes it.
--
--   api_key_grant_tier(p_key_id, p_tier, p_note), service role only:
--     'builder' moves a live FREE key to the Builder limits for 30 days
--               (OD-A8, pending the owner's answer: docs/builder-grant.md);
--     'free'    revokes the key's open grant and puts its old limits back.
--   It answers jsonb {ok, reason, ...}. Every refusal changes nothing: an
--   unknown key, a revoked key, a key on any tier but free, a key that
--   already holds an open grant, a blank or overlong note, a tier it does
--   not know, and a revoke with no open grant.
--
-- HOW A GRANT EXPIRES WITHOUT A CRON OR A NEW api_key_check. Two places
-- close a grant whose expiry has passed, putting the old limits back:
--   - a BEFORE UPDATE trigger on api_keys that fires only when a key on the
--     Builder tier has its last-used stamp moved, which api_key_check does on
--     every allowed call. The call that crosses the expiry still runs on the
--     limits it read; the next call runs on the old ones;
--   - the start of every api_key_grant_tier call, for grants on keys that made
--     no call since (a rotated or idle key).
--
-- WHAT THIS LEAVES ALONE. No existing function is replaced: api_key_check,
-- api_key_issue and the agent key minter are not redefined here. The trigger's
-- WHEN clause is false for every key that is not on the Builder tier, so a
-- free key's call never enters it, and a Builder key with no grant row (one
-- set by hand) finds no grant and keeps its limits. Nothing moves a key to
-- Builder except a grant, and a grant only ever starts from a free key.
--
-- THE NUMBERS are the card's (BUILDER_PROPOSED in public-api/index.ts);
-- src/test/a-builder-grant-is-the-servers-alone-and-recorded.test.ts holds the
-- two equal and runs this file twice in pglite from Supabase's default grants.
-- A grant never lowers a limit: a key already above a Builder number keeps it.
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, the trigger
-- dropped and made again, REVOKE and GRANT restated. The self-check at the end
-- RAISEs, which rolls the whole file back.

CREATE TABLE IF NOT EXISTS public.api_tier_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  tier text NOT NULL CHECK (tier IN ('builder')),
  rate_per_min integer NOT NULL,
  daily_quota integer NOT NULL,
  prior_tier text NOT NULL,
  prior_rate_per_min integer NOT NULL,
  prior_daily_quota integer NOT NULL,
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 500),
  granted_by text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  end_reason text CHECK (end_reason IN ('revoked', 'expired')),
  ended_by text,
  end_note text,
  restored boolean,
  CONSTRAINT api_tier_grants_expires_after_granted CHECK (expires_at > granted_at),
  CONSTRAINT api_tier_grants_an_end_is_whole CHECK (
    (ended_at IS NULL) = (end_reason IS NULL)
    AND (ended_at IS NULL) = (ended_by IS NULL)
    AND (ended_at IS NULL) = (restored IS NULL)
  )
);

-- One open grant per key; the expiry sweep reads open grants by expiry.
CREATE UNIQUE INDEX IF NOT EXISTS api_tier_grants_one_open_per_key
  ON public.api_tier_grants (key_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS api_tier_grants_open_by_expiry
  ON public.api_tier_grants (expires_at) WHERE ended_at IS NULL;

ALTER TABLE public.api_tier_grants ENABLE ROW LEVEL SECURITY;
-- No policy, deliberately: the table privileges below already refuse the
-- client roles, and RLS with no policy is the second wall.

-- Supabase's default privileges gave anon, authenticated and service_role ALL
-- on the new table. The client roles get nothing; the service role reads, and
-- writes go through api_key_grant_tier and the expiry trigger, both definers.
REVOKE ALL ON TABLE public.api_tier_grants FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.api_tier_grants TO service_role;

COMMENT ON TABLE public.api_tier_grants IS
  'API4 W1 (A4): every Builder grant on a public-API key, who ran it, when, why, its expiry and how it ended. Never deleted; the count of grants is the Builder price-test signal (OD-A8). Written only by api_key_grant_tier and the api_keys expiry trigger. 20261206120000.';

CREATE OR REPLACE FUNCTION public.api_key_grant_tier(
  p_key_id uuid,
  p_tier text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5s'
AS $$
DECLARE
  -- The Builder card's limits (BUILDER_PROPOSED in public-api/index.ts) and
  -- the free grant's length (OD-A8).
  c_builder_rate constant integer := 120;
  c_builder_quota constant integer := 5000;
  c_grant_days constant integer := 30;
  v_actor text := CASE WHEN coalesce(current_setting('role', true), '') IN ('', 'none')
                       THEN session_user::text
                       ELSE current_setting('role', true) END;
  v_tier text := lower(btrim(coalesce(p_tier, '')));
  v_note text := btrim(coalesce(p_note, ''));
  v_lapsed integer := 0;
  v_n integer;
  v_restored boolean;
  v_rate integer;
  v_quota integer;
  v_ends timestamptz;
  v_grant uuid;
  due record;
  k record;
  og record;
BEGIN
  IF v_tier NOT IN ('builder', 'free') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_tier', 'tiers', jsonb_build_array('builder', 'free'));
  END IF;
  IF v_note = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'note_required');
  END IF;
  IF length(v_note) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'note_too_long', 'max', 500);
  END IF;

  -- One grant decision at a time.
  PERFORM pg_advisory_xact_lock(hashtext('api_key_grant_tier'));

  -- THE SWEEP. Grants past their expiry on keys that made no call since are
  -- closed here. The key row is locked before the grant row, the order the
  -- key's own call takes them in (its last-used stamp, then the trigger).
  FOR due IN
    SELECT tg.id, tg.key_id FROM public.api_tier_grants tg
     WHERE tg.ended_at IS NULL AND tg.expires_at <= now()
     ORDER BY tg.expires_at
  LOOP
    PERFORM 1 FROM public.api_keys ak WHERE ak.id = due.key_id FOR UPDATE;
    UPDATE public.api_keys ak
       SET tier = tg.prior_tier, rate_per_min = tg.prior_rate_per_min, daily_quota = tg.prior_daily_quota
      FROM public.api_tier_grants tg
     WHERE tg.id = due.id AND tg.ended_at IS NULL AND ak.id = tg.key_id
       AND ak.tier = tg.tier AND ak.rate_per_min = tg.rate_per_min AND ak.daily_quota = tg.daily_quota;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_restored := v_n > 0;
    UPDATE public.api_tier_grants tg
       SET ended_at = now(), end_reason = 'expired', ended_by = 'expiry',
           end_note = 'closed by a grant call after its expiry (the key made no allowed call since)',
           restored = v_restored
     WHERE tg.id = due.id AND tg.ended_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_lapsed := v_lapsed + v_n;
  END LOOP;

  SELECT ak.id, ak.tier, ak.rate_per_min, ak.daily_quota, ak.revoked_at
    INTO k
    FROM public.api_keys ak
   WHERE ak.id = p_key_id
     FOR UPDATE;
  IF k.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_key', 'lapsed', v_lapsed);
  END IF;

  SELECT tg.id, tg.tier, tg.rate_per_min, tg.daily_quota, tg.prior_tier, tg.prior_rate_per_min,
         tg.prior_daily_quota, tg.expires_at
    INTO og
    FROM public.api_tier_grants tg
   WHERE tg.key_id = k.id AND tg.ended_at IS NULL
     FOR UPDATE;

  IF v_tier = 'builder' THEN
    IF og.id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'already_granted', 'grant_id', og.id,
                                'expires_at', og.expires_at, 'lapsed', v_lapsed);
    END IF;
    IF k.revoked_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'key_revoked', 'lapsed', v_lapsed);
    END IF;
    IF k.tier IS DISTINCT FROM 'free' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_free', 'key_tier', k.tier, 'lapsed', v_lapsed);
    END IF;

    v_rate := greatest(k.rate_per_min, c_builder_rate);
    v_quota := greatest(k.daily_quota, c_builder_quota);
    v_ends := now() + make_interval(days => c_grant_days);

    INSERT INTO public.api_tier_grants (key_id, tier, rate_per_min, daily_quota, prior_tier,
                                        prior_rate_per_min, prior_daily_quota, note, granted_by, expires_at)
    VALUES (k.id, 'builder', v_rate, v_quota, k.tier, k.rate_per_min, k.daily_quota, v_note, v_actor, v_ends)
    RETURNING id INTO v_grant;

    UPDATE public.api_keys ak
       SET tier = 'builder', rate_per_min = v_rate, daily_quota = v_quota
     WHERE ak.id = k.id;

    RETURN jsonb_build_object('ok', true, 'reason', 'granted', 'grant_id', v_grant, 'key_id', k.id,
                              'key_tier', 'builder', 'rate_per_min', v_rate, 'daily_quota', v_quota,
                              'expires_at', v_ends, 'lapsed', v_lapsed);
  END IF;

  -- 'free': the revoke. The old limits go back only while the key still
  -- carries what the grant set; a key changed by anything else is left as it
  -- is, and the record says so (restored = false).
  IF og.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_open_grant', 'key_tier', k.tier, 'lapsed', v_lapsed);
  END IF;

  v_restored := k.tier = og.tier AND k.rate_per_min = og.rate_per_min AND k.daily_quota = og.daily_quota;
  IF v_restored THEN
    UPDATE public.api_keys ak
       SET tier = og.prior_tier, rate_per_min = og.prior_rate_per_min, daily_quota = og.prior_daily_quota
     WHERE ak.id = k.id;
  END IF;

  UPDATE public.api_tier_grants tg
     SET ended_at = now(), end_reason = 'revoked', ended_by = v_actor, end_note = v_note, restored = v_restored
   WHERE tg.id = og.id;

  RETURN jsonb_build_object('ok', true, 'reason', 'revoked', 'grant_id', og.id, 'key_id', k.id,
                            'key_tier', CASE WHEN v_restored THEN og.prior_tier ELSE k.tier END,
                            'rate_per_min', CASE WHEN v_restored THEN og.prior_rate_per_min ELSE k.rate_per_min END,
                            'daily_quota', CASE WHEN v_restored THEN og.prior_daily_quota ELSE k.daily_quota END,
                            'restored', v_restored, 'lapsed', v_lapsed);
END;
$$;

REVOKE ALL ON FUNCTION public.api_key_grant_tier(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_grant_tier(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.api_key_grant_tier(uuid, text, text) IS
  'API4 W1 (A4): builder moves a live free public-API key to the Builder card''s limits for 30 days after a written request (OD-A8); free revokes its open grant and puts the old limits back. Records who, when and why in api_tier_grants and closes expired grants first. service_role only. 20261206120000.';

-- THE EXPIRY ON USE. Runs inside the key's own allowed call (api_key_check's
-- last-used stamp), only for a key on the Builder tier.
CREATE OR REPLACE FUNCTION public.api_tier_grant_lapse()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  og record;
  v_restore boolean;
  v_closed uuid;
BEGIN
  SELECT tg.id, tg.tier, tg.rate_per_min, tg.daily_quota, tg.prior_tier, tg.prior_rate_per_min, tg.prior_daily_quota
    INTO og
    FROM public.api_tier_grants tg
   WHERE tg.key_id = NEW.id AND tg.ended_at IS NULL AND tg.expires_at <= now();
  IF og.id IS NULL THEN
    RETURN NEW;
  END IF;

  v_restore := NEW.tier = og.tier AND NEW.rate_per_min = og.rate_per_min AND NEW.daily_quota = og.daily_quota;

  UPDATE public.api_tier_grants tg
     SET ended_at = now(), end_reason = 'expired', ended_by = 'expiry',
         end_note = 'closed by the key''s first allowed call after its expiry',
         restored = v_restore
   WHERE tg.id = og.id AND tg.ended_at IS NULL
  RETURNING tg.id INTO v_closed;

  IF v_closed IS NOT NULL AND v_restore THEN
    NEW.tier := og.prior_tier;
    NEW.rate_per_min := og.prior_rate_per_min;
    NEW.daily_quota := og.prior_daily_quota;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.api_tier_grant_lapse() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.api_tier_grant_lapse() IS
  'API4 W1 (A4): trigger on api_keys. When a Builder-tier key''s last-used stamp moves and its open grant has expired, closes the grant as expired and puts the key''s old limits back. Never called directly. 20261206120000.';

DROP TRIGGER IF EXISTS api_keys_tier_grant_lapse ON public.api_keys;
CREATE TRIGGER api_keys_tier_grant_lapse
  BEFORE UPDATE OF last_used_at ON public.api_keys
  FOR EACH ROW
  WHEN (OLD.tier = 'builder')
  EXECUTE FUNCTION public.api_tier_grant_lapse();

-- Self-verifying: the walls are up, and a grant, its expiry and a revoke each
-- do what they say on a probe key, inside a block that is then rolled back.
DO $$
DECLARE
  f text;
  v_def boolean;
  v_cfg text[];
  v_role text;
  v_t regclass := to_regclass('public.api_tier_grants');
  v_key uuid;
  v_out jsonb;
  v_row record;
  v_prior record;
BEGIN
  IF v_t IS NULL THEN
    RAISE EXCEPTION 'api_tier_grants was not created';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = v_t) THEN
    RAISE EXCEPTION 'api_tier_grants has row level security off';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = v_t) THEN
    RAISE EXCEPTION 'api_tier_grants has a policy; it should answer only the server';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(v_role, 'public.api_tier_grants', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
      RAISE EXCEPTION 'api_tier_grants grants % a privilege', v_role;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'public.api_tier_grants', 'SELECT') THEN
    RAISE EXCEPTION 'api_tier_grants is not readable by service_role';
  END IF;

  FOREACH f IN ARRAY ARRAY['public.api_key_grant_tier(uuid,text,text)', 'public.api_tier_grant_lapse()'] LOOP
    SELECT p.prosecdef, p.proconfig INTO v_def, v_cfg FROM pg_proc p WHERE p.oid = f::regprocedure;
    IF NOT coalesce(v_def, false) THEN
      RAISE EXCEPTION '% is not a security definer', f;
    END IF;
    IF v_cfg IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(v_cfg) c WHERE c LIKE 'search_path=%') THEN
      RAISE EXCEPTION '% has no fixed search_path', f;
    END IF;
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% is executable by a client role', f;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.api_key_grant_tier(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'api_key_grant_tier is not executable by service_role';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.api_keys'::regclass AND t.tgname = 'api_keys_tier_grant_lapse'
                    AND NOT t.tgisinternal AND t.tgenabled <> 'D') THEN
    RAISE EXCEPTION 'the grant expiry trigger is missing from api_keys';
  END IF;

  BEGIN
    INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier)
    VALUES ('selfcheck-builder-grant', 'rb_live_selfchkb', 'selfcheck', 'grant-probe@example.invalid', 'free')
    RETURNING id INTO v_key;
    SELECT ak.tier, ak.rate_per_min, ak.daily_quota INTO v_prior FROM public.api_keys ak WHERE ak.id = v_key;

    v_out := public.api_key_grant_tier(v_key, 'builder', 'self-check probe');
    SELECT ak.tier, ak.rate_per_min, ak.daily_quota INTO v_row FROM public.api_keys ak WHERE ak.id = v_key;
    IF NOT (v_out->>'ok')::boolean OR v_row.tier <> 'builder'
       OR v_row.rate_per_min IS DISTINCT FROM (v_out->>'rate_per_min')::integer
       OR v_row.daily_quota IS DISTINCT FROM (v_out->>'daily_quota')::integer
       OR v_row.rate_per_min < v_prior.rate_per_min OR v_row.daily_quota < v_prior.daily_quota
       OR NOT EXISTS (SELECT 1 FROM public.api_tier_grants tg
                       WHERE tg.key_id = v_key AND tg.ended_at IS NULL AND tg.note = 'self-check probe'
                         AND tg.expires_at > tg.granted_at) THEN
      RAISE EXCEPTION 'a grant answered % and left the key at %', v_out, v_row;
    END IF;

    UPDATE public.api_tier_grants tg
       SET granted_at = now() - interval '31 days', expires_at = now() - interval '1 day'
     WHERE tg.key_id = v_key;
    UPDATE public.api_keys ak SET last_used_at = now() WHERE ak.id = v_key;
    SELECT ak.tier, ak.rate_per_min, ak.daily_quota INTO v_row FROM public.api_keys ak WHERE ak.id = v_key;
    IF v_row.tier <> v_prior.tier OR v_row.rate_per_min <> v_prior.rate_per_min OR v_row.daily_quota <> v_prior.daily_quota
       OR NOT EXISTS (SELECT 1 FROM public.api_tier_grants tg
                       WHERE tg.key_id = v_key AND tg.end_reason = 'expired' AND tg.restored) THEN
      RAISE EXCEPTION 'an expired grant was not closed on use: the key is at %', v_row;
    END IF;

    v_out := public.api_key_grant_tier(v_key, 'builder', 'self-check probe, again');
    v_out := public.api_key_grant_tier(v_key, 'free', 'self-check probe revoke');
    SELECT ak.tier, ak.rate_per_min, ak.daily_quota INTO v_row FROM public.api_keys ak WHERE ak.id = v_key;
    IF NOT (v_out->>'ok')::boolean OR v_row.tier <> v_prior.tier
       OR NOT EXISTS (SELECT 1 FROM public.api_tier_grants tg
                       WHERE tg.key_id = v_key AND tg.end_reason = 'revoked' AND tg.restored
                         AND tg.end_note = 'self-check probe revoke')
       OR (SELECT count(*) FROM public.api_tier_grants tg WHERE tg.key_id = v_key) <> 2 THEN
      RAISE EXCEPTION 'a revoke answered % and left the key at %', v_out, v_row;
    END IF;

    RAISE EXCEPTION 'builder-grant-selfcheck-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'builder-grant-selfcheck-rollback' THEN
      RAISE;
    END IF;
  END;
END $$;
