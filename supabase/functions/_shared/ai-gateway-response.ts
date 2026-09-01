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
 * Checks an AI gateway fetch response. Returns a ready-to-return Response for
 * the two recoverable cases the gateway can signal — 429 (rate limited) and
 * 402 (out of credits/payment required) — or null if the response was ok.
 * Throws for any other non-ok status, matching every generate-* function's
 * existing "throw on real failure" convention — the caller's own try/catch
 * and error logging stays unchanged. Two of seven functions already handled
 * 402 distinctly before this was centralized; the other five didn't, so a
 * gateway billing issue fell through to a generic 500 for those — bringing
 * everyone to the same standard now that this is one shared place to fix.
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

  if (response.status === 402) {
    return new Response(
      JSON.stringify({ error: "Service temporarily unavailable." }),
      { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const errorText = await response.text();
  throw new Error(`AI API error: ${response.status} - ${errorText}`);
}
