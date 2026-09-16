-- AN APPLICATION IS PAID FOR WHEN IT IS QUEUED — in one statement, or not at all.
--
-- The pass is consumed at accepted: true, which is the moment a new
-- agent_queue row exists. That accept and the increment of the pass's
-- applications_used happen together, inside this one function, so there is
-- no ordering to get wrong and nothing to refund on an enqueue that half
-- happened. A separate counter RPC was refuted: request_application's old
-- upsert (ignoreDuplicates, no select) could not tell a fresh accept from a
-- duplicate, so a counter beside it over-consumed on a duplicate race.
--
-- ONE RPC FOR BOTH FUNDING SOURCES. A subscription-funded request passes
-- p_pass_funded = false and lands with pass_id NULL; a pass-funded one
-- passes true and is stamped with the pass that paid. Which of the two
-- applies is decided in Deno from the subscriber row it already reads
-- (NOT rowIsEntitled(sub)); the numbers never pass through here.
--
-- ORDER, AND WHY.
--   1. If pass-funded: close any pass that has run out (the shared lazy
--      close), then lock the user's live pass FOR UPDATE. The row lock
--      serialises concurrent requests for one user: the second caller waits,
--      then re-reads the count the first one left. No live pass ->
--      pass_not_live; no applications left -> pass_exhausted; in both cases
--      NOTHING is written.
--   2. INSERT the queue row ON CONFLICT (user_id, posting_id) DO NOTHING.
--      No row -> already_queued, enqueued_ok stays true (the request IS in
--      the queue), and the pass is NOT incremented — a duplicate costs
--      nothing, which is the property the old upsert could not give.
--   3. Row inserted and pass-funded -> applications_used + 1 on the locked
--      row; the applications left after that are returned.
--
-- The row's fields arrive as jsonb from the caller (the same shape
-- request_application built before: title, company, company_token, location,
-- apply_url, salary, category, posted_at, fit_pct, reasons, status,
-- search_id, search_label). user_id and posting_id are taken from the
-- parameters, never from the jsonb, so the row can only ever land on the
-- account the caller named.
--
-- queued_row_id is bigint because agent_queue.id is an identity bigint, not
-- a uuid. OUT names are prefixed so none is a column of agent_queue or
-- agent_passes (the 42702 trap).

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
BEGIN
  IF p_user_id IS NULL OR coalesce(btrim(p_posting_id), '') = '' THEN
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
    IF v_left <= 0 THEN
      RETURN QUERY SELECT false, 'pass_exhausted'::text, NULL::bigint, 0; RETURN;
    END IF;
  END IF;

  INSERT INTO public.agent_queue (
    user_id, posting_id, title, company, company_token, location, apply_url,
    salary, category, posted_at, fit_pct, reasons, status, search_id, search_label, pass_id
  ) VALUES (
    p_user_id,
    btrim(p_posting_id),
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
    RETURN QUERY SELECT true, 'already_queued'::text, NULL::bigint, v_left; RETURN;
  END IF;

  IF p_pass_funded THEN
    UPDATE public.agent_passes ap
       SET applications_used = ap.applications_used + 1
     WHERE ap.id = v_pass_id
    RETURNING ap.applications_total - ap.applications_used INTO v_left;
  END IF;

  RETURN QUERY SELECT true, 'queued'::text, v_row_id, v_left;
END;
$$;

-- SERVICE ROLE ONLY: this function spends a paid application and writes a
-- queue row on any account it is handed. REVOKE by name from PUBLIC, anon
-- and authenticated in the same file (project_definer_exposure).
REVOKE ALL ON FUNCTION public.agent_queue_enqueue(uuid, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_queue_enqueue(uuid, text, jsonb, boolean) TO service_role;
