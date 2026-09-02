type SessionLookupClient = { from: (table: string) => any };
export async function assertPaidSession(
  supabase: SessionLookupClient,
  sessionId: unknown,
  allowed?: readonly string[],
): Promise<string | null> {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return "This content requires a completed purchase.";
  }
  const { data, error } = await supabase
    .from("used_stripe_sessions")
    .select("session_id, product_type")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) return "We couldn't verify your purchase just now — please refresh to try again.";
  if (!data) return "We couldn't confirm a completed purchase for this session.";
  const bought = (data as { product_type?: string | null }).product_type ?? null;
  if (allowed && allowed.length > 0 && bought !== null && !allowed.includes(bought)) {
    return "That purchase does not include this tool.";
  }
  return null;
}
