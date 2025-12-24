-- Drop the restrictive SELECT policy
DROP POLICY IF EXISTS "Service role only read heartbeat results" ON heartbeat_results;

-- Create a permissive policy to allow reading heartbeat results
CREATE POLICY "Allow public read of heartbeat results"
ON heartbeat_results
FOR SELECT
USING (true);