CREATE OR REPLACE FUNCTION public.bootstrap_queue_take(
  p_n integer,
  p_skip text[],
  p_version text,
  p_stamp_version boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     jsonb;
  v_queue   jsonb;
  v_taken   text[];
  v_rest    jsonb;
  v_len     integer;
  v_drained integer;
  v_now     text := to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  SELECT v INTO v_row FROM public.job_board_meta WHERE k = 'bootstrap' FOR UPDATE;
  IF v_row IS NULL THEN v_row := '{}'::jsonb; END IF;
  v_queue := coalesce(v_row->'queue', '[]'::jsonb);
  IF jsonb_typeof(v_queue) <> 'array' THEN v_queue := '[]'::jsonb; END IF;

  v_len     := jsonb_array_length(v_queue);
  v_drained := least(greatest(coalesce(p_n, 0), 0), v_len);

  -- The first p_n tokens, minus those already in this slice. Removed either way.
  SELECT coalesce(array_agg(t ORDER BY ord), '{}'::text[]) INTO v_taken
  FROM (
    SELECT e.value #>> '{}' AS t, e.ord
    FROM jsonb_array_elements(v_queue) WITH ORDINALITY AS e(value, ord)
    WHERE e.ord <= v_drained
  ) s
  WHERE NOT (s.t = ANY (coalesce(p_skip, '{}'::text[])));

  SELECT coalesce(jsonb_agg(e.value ORDER BY e.ord), '[]'::jsonb) INTO v_rest
  FROM jsonb_array_elements(v_queue) WITH ORDINALITY AS e(value, ord)
  WHERE e.ord > v_drained;

  v_row := v_row || jsonb_build_object(
    'queue', v_rest,
    'lastSlice', jsonb_build_object('at', v_now, 'drained', v_drained, 'selected', NULL)
  );
  IF p_stamp_version THEN
    v_row := v_row || jsonb_build_object('version', p_version);
  END IF;

  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('bootstrap', v_row, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now();

  RETURN jsonb_build_object(
    'taken', to_jsonb(v_taken),
    'drained', v_drained,
    'remaining', jsonb_array_length(v_rest)
  );
END
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_queue_append(p_tokens text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row   jsonb;
  v_queue jsonb;
  v_new   jsonb;
BEGIN
  SELECT v INTO v_row FROM public.job_board_meta WHERE k = 'bootstrap' FOR UPDATE;
  IF v_row IS NULL THEN v_row := '{}'::jsonb; END IF;
  v_queue := coalesce(v_row->'queue', '[]'::jsonb);
  IF jsonb_typeof(v_queue) <> 'array' THEN v_queue := '[]'::jsonb; END IF;

  -- Input order preserved, duplicates within the input collapsed to their
  -- first occurrence, anything already queued dropped.
  SELECT coalesce(jsonb_agg(to_jsonb(x.t) ORDER BY x.ord), '[]'::jsonb) INTO v_new
  FROM (
    SELECT u.t, u.ord, row_number() OVER (PARTITION BY u.t ORDER BY u.ord) AS rn
    FROM unnest(coalesce(p_tokens, '{}'::text[])) WITH ORDINALITY AS u(t, ord)
  ) x
  WHERE x.rn = 1
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_queue) q WHERE q = x.t);

  v_row := v_row || jsonb_build_object('queue', v_queue || v_new);

  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('bootstrap', v_row, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now();

  RETURN jsonb_array_length(v_queue || v_new);
END
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_queue_stamp(p_selected integer)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.job_board_meta
  SET v = jsonb_set(v, '{lastSlice,selected}', to_jsonb(p_selected), true),
      updated_at = now()
  WHERE k = 'bootstrap' AND v ? 'lastSlice';
$$;

REVOKE EXECUTE ON FUNCTION public.bootstrap_queue_take(integer, text[], text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bootstrap_queue_append(text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bootstrap_queue_stamp(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_queue_take(integer, text[], text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.bootstrap_queue_append(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.bootstrap_queue_stamp(integer) TO service_role;