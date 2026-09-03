-- A QUEUE THAT WAS READ WHOLE, AND WRITTEN WHOLE, EVERY SLICE.
--
-- The bootstrap lane keeps its queue of never-yet-fetched boards as a JSON
-- array inside one job_board_meta row. Every refresh slice loaded the ENTIRE
-- array into the edge function, took ten to twenty-five tokens off the front,
-- and wrote the entire remainder back. Harmless at a few hundred tokens. On
-- every deploy the version-change re-append refills it with every board that
-- holds zero rows — 8,453 tokens on 2026-09-03, roughly half a megabyte parsed
-- and re-serialised per slice, in the same invocation that is fetching up to
-- eighty employer feeds.
--
-- Measured: after .27 capped per-board fetch size, twelve slices completed in
-- the window between deploy and that re-append, and then none did — `works`
-- froze while the cursor kept advancing, the signature of an invocation dying
-- inside its fetch loop. The queue is the strongest remaining correlate.
--
-- So the array stays where it is — status still reads its length as `pending`,
-- nothing else changes shape — but the edge never loads it again. Taking from
-- the front, appending to the back and stamping the outcome all happen here,
-- inside one row lock, and the function receives only what it asked for.
--
-- Semantics are copied from the edge code they replace, not improved:
--   * take() removes the first p_n tokens whether or not they are also in the
--     current slice (p_skip) — that is what queue.slice(0, n) did — and returns
--     only the ones that are not, which is what was fetched. lastSlice.drained
--     is therefore the count removed, and lastSlice.selected is written back
--     by stamp() AFTER the edge has resolved tokens to boards, because a token
--     that resolves to no board is exactly the fork the lane's own comment says
--     it has guessed at twice and needs to see.
--   * append() drops tokens already present and APPENDS the rest, preserving
--     both the queue's drain position and the input order — the re-append rule
--     that stops a merge's boards being reordered or a restart pathology.
--
-- Returns jsonb rather than OUT parameters: this schema has already lost an
-- afternoon, twice, to an OUT parameter that shadowed a real column (42702).
-- SECURITY DEFINER with the same lockdown as get_empty_boards, its sibling —
-- callable by service_role only. The edge falls back to its old in-process
-- path when these do not exist yet, so the function may deploy before this
-- migration is applied without changing behaviour.

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
