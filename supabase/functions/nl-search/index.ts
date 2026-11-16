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
import { modelSpendGate } from "../_shared/model-spend-gate.ts";
import { UnusableModelOutput, callAIForUsableReply, chainRanOutOfTime } from "../_shared/ai-fallback.ts";
import { ParseMemo, normaliseQuery } from "./memo.ts";

// Provable from outside without a model call: every response, the CORS
// preflight included, carries this in x-fn-build.
// 2026-10-09.6 (S11-026): pay figures are read in the currency the user named and converted to the dollars the board compares; one above $2M or in a currency the board cannot rank is dropped and named, never clamped.
// 2026-10-09.7 (wave-3 fix round integration): carries .6 above and the parsers-scan group's model-spend-gate change (S11-083's proven-caller rule), which that group stamped .2.
// 2026-11-09.1 (cost audit 2026-11-08, lane ai): the parse is asked through
// the shared chain inside eight seconds, today's model first and gpt-5-mini
// only when it fails; past eight seconds the page gets the answer it already
// shows for a failed parse (its own filters) at once, not after the
// platform's 150 s. A sentence asked twice is parsed once per isolate
// (memo.ts). Browsers keep the preflight for two hours. The usage line of
// every reply is logged (numbers only).
// 2026-11-12.1 (bug round of 2026-11-08, part A, board-ui lane, S14X-293, NB-23, NB-24): an unreadable reply goes down the chain, an empty answer is not remembered, and no upstream text reaches the reader.
const FN_BUILD = "nl-search.2026-11-12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  // One preflight per browser per two hours, not one before every search.
  "Access-Control-Max-Age": "7200",
  "x-fn-build": FN_BUILD,
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// One model call per typed query on the public board: an address allowance
// plus a function-wide ceiling (see _shared/model-spend-gate.ts).
const NL_SEARCH_LIMITS = { perAddress: 40, globalPerHour: 600 };
// The tool call is a handful of filters (~200 tokens); the rest is headroom
// for the model's thinking, which counts against the same cap.
const MAX_OUTPUT_TOKENS = 2000;
// The model the parse has always used comes first. The second is asked only
// when the first fails (a refusal, a server error, a reply with no tool
// call), so a retired preview model no longer takes the feature down.
const NL_MODELS = ["google/gemini-3-flash-preview", "openai/gpt-5-mini"];
// The reader is waiting on the board for this, and the page already has an
// answer for a parse that does not come: its own filters. Eight seconds,
// then that answer.
const NL_PARSE_BUDGET_MS = 8_000;

const memo = new ParseMemo<string>();

/**
 * The tool call's arguments, or null when the reply made no tool call or its
 * arguments do not parse as an object. Null sends the chain to the next
 * model, and past the last one the page gets 502 "No parse" (NB-23): an
 * unreadable reply used to read as {}, which validated to no filters at all,
 * so the board cleared every filter the reader had set.
 */
function readToolArguments(data: unknown): Record<string, unknown> | null {
  const toolCall = (data as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: unknown } }> } }> } | null)
    ?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) return null;
  try {
    const args = JSON.parse(String(toolCall.function?.arguments ?? ""));
    return args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** No parse inside the budget: the page shows its "try the filters below" note, as for any failed parse. */
const tooSlow = () => json({ error: "Parse unavailable", timedOut: true }, 504);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "AI service not configured" }, 500);

    const { query } = await req.json();
    const raw = String(query ?? "").trim().slice(0, 300);
    if (raw.length < 3) return json({ error: "Query too short" }, 400);

    // A sentence this isolate already parsed costs no model call, so it
    // spends nothing from the gate either.
    const memoKey = normaliseQuery(raw);
    const kept = memo.get(memoKey);
    if (kept !== undefined) {
      return new Response(kept, { headers: { ...corsHeaders, "Content-Type": "application/json", "x-nl-memo": "hit" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const refused = await modelSpendGate(supabase, req, "nl-search", NL_SEARCH_LIMITS, corsHeaders);
    if (refused) return refused;

    const stop = AbortSignal.timeout(NL_PARSE_BUDGET_MS);
    const outOfTime = new Promise<"out of time">((done) => stop.addEventListener("abort", () => done("out of time"), { once: true }));
    const asked = callAIForUsableReply(LOVABLE_API_KEY, {
      models: NL_MODELS,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: raw },
      ],
      maxTokens: MAX_OUTPUT_TOKENS,
      tools: [{
        type: "function",
        function: {
          name: "apply_search",
          description: "Apply the parsed job search",
          parameters: TOOL_PARAMETERS,
        },
      }],
      toolChoice: { type: "function", function: { name: "apply_search" } },
      context: "NL-SEARCH",
      deadlineMs: NL_PARSE_BUDGET_MS,
      signal: stop,
      read: readToolArguments,
    });
    // A chain still reading a reply when the budget ends is left to finish
    // on its own; its outcome is no longer anyone's answer.
    asked.catch(() => undefined);

    let reply: Awaited<typeof asked>;
    try {
      const first = await Promise.race([asked, outOfTime]);
      if (first === "out of time") return tooSlow();
      reply = first;
    } catch (e) {
      if (e instanceof UnusableModelOutput) return json({ error: "No parse" }, 502);
      if (stop.aborted || chainRanOutOfTime(e) || (e instanceof Error && e.name === "ChainStopped")) return tooSlow();
      throw e;
    }

    if (!reply.ok) {
      const errText = await reply.response.text().catch(() => "");
      console.error("[NL-SEARCH] gateway error:", reply.response.status, errText.slice(0, 300));
      const status = reply.response.status === 429 ? 429 : 502;
      // The gateway's own text stays in the log above (NB-24): an anonymous
      // caller gets the status and a fixed reason, never the upstream body.
      return json({ error: "Parse unavailable", gatewayStatus: reply.response.status, reason: status === 429 ? "busy" : "unavailable" }, status);
    }
    const parsed = reply.value;

    // Validate/sanitize against the real vocabulary — the client trusts only
    // what we return, so anything off-contract is dropped here, not there.
    //
    // `applied` names every filter that survived, by the board's own wire name,
    // so the interpretation line can be rendered from what the board will
    // actually bind instead of from the model's prose. The chips in
    // `interpreted` are still the model's words (they carry the reader's own
    // language); `applied` is what makes them checkable.
    const { filters, applied, dropped, interpreted, notMapped } = validateParse(parsed);

    const answer = JSON.stringify({ filters, applied, dropped, interpreted, notMapped });
    // An answer that binds nothing is not remembered (NB-23): the next ask
    // of the same sentence goes to the model again instead of being told
    // "no filters" for six hours.
    if (Object.keys(filters).length > 0) memo.set(memoKey, answer);
    return new Response(answer, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[NL-SEARCH] parse failed:", String(e).slice(0, 300));
    return json({ error: "Parse failed", reason: "unavailable" }, 500);
  }
});
