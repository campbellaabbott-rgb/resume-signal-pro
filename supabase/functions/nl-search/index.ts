// Natural-language search parser. Turns a conversational query — "remote
// product roles at startups over 150k, no degree" — into the board's OWN
// structured filters plus a residual keyword string, via one fast LLM call.
//
// Honesty rules baked into the contract:
// - The model may ONLY use filters the board actually has, with the exact
//   enum values below. It cannot invent a filter.
// - Concepts with no matching filter (company size, "no degree", "startup")
//   are NOT silently dropped or faked — they go in `notMapped` so the UI can
//   say "couldn't filter by: startups" plainly.
// - Role/skill/title words become the `q` keyword search, ranked as usual.
// The client shows exactly how the query was interpreted and lets the user
// edit — the parse is a convenience, never an authority.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CATEGORIES = [
  "engineering", "data_ai", "design", "product", "marketing", "sales",
  "customer", "finance", "legal", "people_hr", "operations", "healthcare",
  "science", "education", "hospitality_retail", "security", "admin", "other",
] as const;
const EXPERIENCE = ["entry", "mid", "senior", "expert"] as const;

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

    const systemPrompt = `You convert a job seeker's plain-language search into structured filters for a job board. Output ONLY via the tool call.

The board has EXACTLY these filters — never invent others:
- q: the role/title/skill keywords to search (e.g. "product manager", "kubernetes"). Put here anything that describes the JOB itself. Required unless the query is purely filters.
- category: one of [${CATEGORIES.join(", ")}]. Map only when the field is unambiguous.
- experience: one of [${EXPERIENCE.join(", ")}]. "entry"=junior/new-grad, "senior"=6-9y, "expert"=10y+/principal.
- remote: true only if the user clearly wants remote.
- salaryFloor: a number (annual, no currency symbol) when the user states a minimum pay.
- country: a 2-letter ISO code only if a country is named (US, GB, CA, DE...).
- location: a city/region string if a specific place is named (not a country).
- maxAgeDays: 1 for "today", 7 for "this week"/"recent"/"new".

RULES:
- Only set a filter when the query clearly implies it. When unsure, leave it out and let it fall into q or notMapped.
- Concepts the board CANNOT filter (company size, "startup", "no degree required", industry-of-company, benefits, seniority of company) must go in notMapped as short phrases — never faked into a filter.
- interpreted: 2-6 short human-readable chips describing what you understood (e.g. "Remote", "Product", "$150k+ minimum"). This is shown to the user.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: raw },
        ],
        tools: [{
          type: "function",
          function: {
            name: "apply_search",
            description: "Apply the parsed job search",
            parameters: {
              type: "object",
              properties: {
                q: { type: "string", description: "Role/title/skill keywords" },
                category: { type: "string", enum: [...CATEGORIES] },
                experience: { type: "string", enum: [...EXPERIENCE] },
                remote: { type: "boolean" },
                salaryFloor: { type: "number" },
                country: { type: "string", description: "2-letter ISO code" },
                location: { type: "string" },
                maxAgeDays: { type: "number", enum: [1, 7] },
                interpreted: { type: "array", items: { type: "string" }, description: "2-6 short chips of what was understood" },
                notMapped: { type: "array", items: { type: "string" }, description: "Concepts with no matching filter" },
              },
              required: ["interpreted"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "apply_search" } },
      }),
    });

    if (!response.ok) {
      const status = response.status === 429 ? 429 : 502;
      return new Response(JSON.stringify({ error: "Parse unavailable" }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) return new Response(JSON.stringify({ error: "No parse" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(toolCall.function.arguments); } catch { parsed = {}; }

    // Validate/sanitize against the real vocabulary — the client trusts only
    // what we return, so anything off-contract is dropped here, not there.
    const filters: Record<string, unknown> = {};
    if (typeof parsed.q === "string" && parsed.q.trim()) filters.q = parsed.q.trim().slice(0, 120);
    if (typeof parsed.category === "string" && (CATEGORIES as readonly string[]).includes(parsed.category)) filters.category = parsed.category;
    if (typeof parsed.experience === "string" && (EXPERIENCE as readonly string[]).includes(parsed.experience)) filters.experience = parsed.experience;
    if (parsed.remote === true) filters.remote = true;
    if (typeof parsed.salaryFloor === "number" && parsed.salaryFloor > 0) filters.salaryFloor = Math.min(Math.round(parsed.salaryFloor), 2_000_000);
    if (typeof parsed.country === "string" && /^[A-Za-z]{2}$/.test(parsed.country)) filters.country = parsed.country.toUpperCase();
    if (typeof parsed.location === "string" && parsed.location.trim()) filters.location = parsed.location.trim().slice(0, 80);
    if (parsed.maxAgeDays === 1 || parsed.maxAgeDays === 7) filters.maxAgeDays = parsed.maxAgeDays;

    const interpreted = Array.isArray(parsed.interpreted) ? parsed.interpreted.filter((x): x is string => typeof x === "string").slice(0, 6) : [];
    const notMapped = Array.isArray(parsed.notMapped) ? parsed.notMapped.filter((x): x is string => typeof x === "string").slice(0, 4) : [];

    return new Response(JSON.stringify({ filters, interpreted, notMapped }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Parse failed", detail: String(e).slice(0, 200) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
