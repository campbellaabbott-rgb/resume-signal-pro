-- Security hardening: restrict direct access to lead emails + strengthen share link entropy

-- 1) free_scan_leads: remove public INSERT access (leads are saved only via backend RPC using service privileges)
ALTER TABLE public.free_scan_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can submit their email" ON public.free_scan_leads;
DROP POLICY IF EXISTS "Service role can read leads" ON public.free_scan_leads;

-- With RLS enabled and no policies, direct SELECT/INSERT/UPDATE/DELETE from client roles is denied by default.


-- 2) resume_analyses: strengthen share_id entropy for newly created share links
ALTER TABLE public.resume_analyses
ALTER COLUMN share_id
SET DEFAULT encode(extensions.gen_random_bytes(16), 'hex'::text);


-- 3) Allow both legacy (24 hex) and new (32 hex) share_id formats in RPCs
CREATE OR REPLACE FUNCTION public.get_analysis_by_share_id(share_id_param text)
RETURNS TABLE(
  id uuid,
  analysis_result jsonb,
  created_at timestamp with time zone,
  share_id text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Validate share_id format (legacy 24-hex or new 32-hex)
  IF share_id_param IS NULL OR share_id_param !~ '^([a-f0-9]{24}|[a-f0-9]{32})$' THEN
    RAISE EXCEPTION 'Invalid share_id format';
  END IF;

  RETURN QUERY
  SELECT 
    ra.id, ra.analysis_result, ra.created_at, ra.share_id
  FROM resume_analyses ra
  WHERE ra.share_id = share_id_param;
END;
$function$;


CREATE OR REPLACE FUNCTION public.delete_analysis_by_share_id(p_share_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Validate share_id format (legacy 24-hex or new 32-hex)
  IF p_share_id IS NULL OR p_share_id !~ '^([a-f0-9]{24}|[a-f0-9]{32})$' THEN
    RAISE EXCEPTION 'Invalid share_id format';
  END IF;

  DELETE FROM resume_analyses WHERE share_id = p_share_id;
  RETURN FOUND;
END;
$function$;