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
