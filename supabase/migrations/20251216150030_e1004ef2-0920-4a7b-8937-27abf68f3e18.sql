-- Drop the old UUID-based function to resolve overloading
DROP FUNCTION IF EXISTS public.get_temp_resume(uuid);

-- The text-based version from the previous migration is already in place