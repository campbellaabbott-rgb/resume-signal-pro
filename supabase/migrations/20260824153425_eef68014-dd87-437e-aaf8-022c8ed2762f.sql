UPDATE public.job_board_meta
SET v = jsonb_set(v, '{size}', to_jsonb(LEAST((v->>'size')::int, 31708))),
    updated_at = now()
WHERE k = 'catalog_highwater';