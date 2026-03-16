CREATE OR REPLACE FUNCTION public.log_error_telemetry(
  p_error_code text,
  p_error_type text,
  p_error_message text DEFAULT NULL::text,
  p_http_status integer DEFAULT NULL::integer,
  p_function_name text DEFAULT NULL::text,
  p_context jsonb DEFAULT NULL::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.error_telemetry (error_code, error_type, error_message, http_status, function_name, context, visitor_id)
  VALUES (
    p_error_code,
    p_error_type,
    p_error_message,
    p_http_status,
    p_function_name,
    p_context,
    p_context->>'visitor_id'
  );
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$function$;