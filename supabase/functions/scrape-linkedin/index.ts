// deploy-stamp: 2026-10-11T00:00Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { stamped } from "../_shared/fn-build.ts";

// The build every response names (x-fn-build); see _shared/fn-build.ts.
//
// 2026-10-11.23 (wave 4 round 2, checkout-catalogue; the product line's cut
// of the free report extras, owner decision 2026-10-12): SWITCHED OFF.
//
// This function fetched a LinkedIn profile through Firecrawl for the LinkedIn
// insights card, one of the free report extras the product line cut. The card
// is no longer mounted (src/pages/Index.tsx), so nothing on the site calls
// this. It was unauthenticated (verify_jwt false, supabase/config.toml) and
// the only user of FIRECRAWL_API_KEY, so without this stub it would have
// stayed a paid, open scraper with no caller. Every request now answers
// before a rate limiter, a database client or Firecrawl: nothing is counted,
// read or fetched. The owner revokes the Firecrawl key once the verifier
// (section 92) shows this build serving; the simplify wave deletes the
// function and its config.toml entry.
const FN_BUILD = "scrape-linkedin.2026-10-11.23";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(stamped(FN_BUILD, (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({
      success: false,
      retired: true,
      reason: "linkedin_import_cut",
      error: "LinkedIn profile import is no longer offered. Paste your profile text instead; nothing was charged.",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}));
