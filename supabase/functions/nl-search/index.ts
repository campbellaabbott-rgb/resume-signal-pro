// Natural-language search parser. Turns a conversational query — "remote
// product roles at startups over 150k, no degree" — into the board's OWN
// structured filters plus a residual keyword string, via one fast LLM call.
//
// Honesty rules baked into the contract:
// - The model may ONLY use filters the board actually has, with the exact
//   enum values in parse.ts. It cannot invent a filter, and a value the
//   validator does not recognise is DROPPED here rather than forwarded.
// - Concepts with no matching filter (company size, "no degree", "startup")
//   are NOT silently dropped or faked — they go in `notMapped` so the UI can
//   say "couldn't filter by: startups" plainly.
// - A filter the model asked for and validation REFUSED (an unknown category,
//   a pay band that closes below its own floor) goes in `dropped`. Those used
//   to vanish between here and the client while the model's chip went on
//   claiming them.
// - Role/skill/title words become the `q` keyword search, ranked as usual.
// The client shows exactly how the query was interpreted and lets the user
// edit — the parse is a convenience, never an authority.
//
// The prompt's filter list, the tool schema and the validator are all DERIVED
// from one table in ./parse.ts. They used to be three hand-maintained lists
// that agreed with each other on eleven filters and with the board on none —
// see that file's header.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { SYSTEM_PROMPT, TOOL_PARAMETERS, validateParse } from "./parse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: allowed } = await supabase.rpc("check_rate_limit", { p_function: "nl-search", p_ip: clientIp, p_max_requests: 40, p_window_minutes: 60 });
  if (!allowed) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return new Response(JSON.stringify({ error: "AI service not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { query } = await req.json();
    const raw = String(query ?? "").trim().slice(0, 300);
    if (raw.length < 3) return new Response(JSON.stringify({ error: "Query too short" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: raw },
        ],
        tools: [{
          type: "function",
          function: {
            name: "apply_search",
            description: "Apply the parsed job search",
            parameters: TOOL_PARAMETERS,
          },
        }],
        tool_choice: { type: "function", function: { name: "apply_search" } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("[NL-SEARCH] gateway error:", response.status, errText.slice(0, 300));
      const status = response.status === 429 ? 429 : 502;
      // Surface the gateway status so failures are diagnosable from the client
      // (the detail is a status code + short reason, never sensitive).
      return new Response(JSON.stringify({ error: "Parse unavailable", gatewayStatus: response.status, detail: errText.slice(0, 200) }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) return new Response(JSON.stringify({ error: "No parse" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(toolCall.function.arguments); } catch { parsed = {}; }

    // Validate/sanitize against the real vocabulary — the client trusts only
    // what we return, so anything off-contract is dropped here, not there.
    //
    // `applied` names every filter that survived, by the board's own wire name,
    // so the interpretation line can be rendered from what the board will
    // actually bind instead of from the model's prose. The chips in
    // `interpreted` are still the model's words (they carry the reader's own
    // language); `applied` is what makes them checkable.
    const { filters, applied, dropped, interpreted, notMapped } = validateParse(parsed);

    return new Response(JSON.stringify({ filters, applied, dropped, interpreted, notMapped }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Parse failed", detail: String(e).slice(0, 200) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
