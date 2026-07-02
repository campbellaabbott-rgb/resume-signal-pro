// Account data for the signed-in user: scan credits and purchase history.
// Both are keyed by email in service-role tables, so this function verifies
// the caller's JWT, extracts their email, and reads on their behalf.
// verify_jwt stays at the default (true) — Supabase rejects anonymous calls.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await anonClient.auth.getUser();
    if (userErr || !user?.email) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const email = user.email.toLowerCase();

    const service = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const [creditsRes, purchasesRes] = await Promise.all([
      service.rpc("get_scan_credits", { p_email: email }),
      service.from("purchased_content")
        .select("product_name, product_type, created_at")
        .eq("customer_email", email)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const credits = typeof creditsRes.data === "number" ? creditsRes.data : 0;
    const purchases = (purchasesRes.data ?? []).map((p: { product_name?: string | null; product_type?: string; created_at: string }) => ({
      product: p.product_name ?? p.product_type ?? "Purchase",
      date: p.created_at,
    }));

    return new Response(JSON.stringify({ credits, purchases }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[GET-ACCOUNT-DATA] Uncaught:", e);
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
