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

REVOKE ALL ON FUNCTION public.agent_queue_enqueue(uuid, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_queue_enqueue(uuid, text, jsonb, boolean) TO service_role;