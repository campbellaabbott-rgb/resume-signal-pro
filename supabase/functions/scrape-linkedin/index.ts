// deploy-stamp: 2026-10-11T16:00Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * RETIRED (S12-152; owner decision 2026-10-12). Answers every request with 410
 * and calls nothing.
 *
 * This fetched a LinkedIn profile through Firecrawl for the free report's
 * LinkedIn insights. No page has called it since the insights moved to pasted
 * text, and the LinkedIn insights are among the free report extras the owner
 * stopped offering. It was still a live, unauthenticated Firecrawl proxy on
 * the project's key: its address limit read the first forwarded hop, which a
 * caller writes, and a caller rotating through an IPv6 /64 bought a fresh
 * allowance per request -- Firecrawl spend, and requests against LinkedIn's
 * terms, from our account.
 *
 * An endpoint nobody calls is safest when it does nothing: it reads no body,
 * touches no database and reaches no third party. Once this build verifies,
 * the owner revokes FIRECRAWL_API_KEY (no other function reads it).
 * The previous implementation is in git history.
 */

// Provable from outside without a call to anyone: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "scrape-linkedin.2026-10-11.24";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({
      error: "This endpoint has been retired. LinkedIn profiles are no longer fetched.",
      code: "retired",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
