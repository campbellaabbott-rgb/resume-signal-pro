// Pure, dependency-free helper shared by every generate-* edge function that
// calls the AI gateway. No imports on purpose — importable both by the Deno
// edge functions (relative import) and by Node/vitest regression tests, so
// the logic under test is the literal logic running in production.
//
// This exact "if (!response.ok) { ...429 check...; throw }" block was
// duplicated across 7 functions, and that duplication is exactly how 3 of
// them silently missed the 429-specific branch while the other 4 had it —
// the same drift pattern that's hit several other parts of this codebase
// (product-type switches, commission lists). Centralizing it means a future
// fix here applies everywhere at once instead of needing to be copied by hand
// into every file again.

/**
 * A gateway 402 is the AI provider out of credits: our outage, never the
 * caller's purchase, so it is a retryable 503 (S14X-109). 402 stays for our
 * own purchase refusals.
 */
export function aiUnavailable(corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: "The AI service can't take requests right now. Try again in a few minutes.", code: "ai_unavailable", retryable: true }),
    { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "300" } },
  );
}

/**
 * Checks an AI gateway fetch response: a ready Response for 429 (rate
 * limited) and 402 (see aiUnavailable), null when ok, and a throw for any
 * other status (the caller's own try/catch logs it).
 */
export async function checkAiGatewayResponse(
  response: Response,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  if (response.ok) return null;

  if (response.status === 429) {
    return new Response(
      JSON.stringify({ error: "Rate limited, please try again shortly." }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (response.status === 402) return aiUnavailable(corsHeaders);

  const errorText = await response.text();
  throw new Error(`AI API error: ${response.status} - ${errorText}`);
}
