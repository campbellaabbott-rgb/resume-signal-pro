/**
 * A COPY THE RECOVERY FORM MAKES IS KEPT, RECORDED AND MAILED ONCE (RC-S12-007).
 *
 * A buyer whose checkout bound no résumé gets the product only from the
 * success page's recovery form, which calls the generator from the browser.
 * Nothing saved that copy, recorded it or mailed it: the order stayed
 * undelivered, the owner's "paid, not delivered" alarm kept ringing, and the
 * link in the purchase email showed the form again. Our own servers save and
 * mail what they make themselves, so a generator calls this only for a
 * browser caller that passed its purchase check.
 *
 * Only when no copy is saved yet (save_purchased_content overwrites, and the
 * copy already mailed is the buyer's), only for the product the purchase
 * names, never on a refunded order. The step is recorded only on an order
 * row (log_delivery_step would invent one), and the mail only when that
 * order has an address and none was sent. Best-effort: it never throws.
 */

// deno-lint-ignore no-explicit-any
type Db = { rpc: (n: string, a: Record<string, unknown>) => PromiseLike<{ data: any; error: { message: string } | null }>; from: (t: string) => any };

export type KeptCopy = "kept" | "had" | "skipped" | "failed";

export async function keepPastBuyerCopy(
  db: Db,
  input: { sessionId: unknown; productType: string; productName: string; content: unknown },
): Promise<KeptCopy> {
  const sessionId = typeof input.sessionId === "string" ? input.sessionId : "";
  if (!sessionId || !input.content || typeof input.content !== "object") return "skipped";
  try {
    const { data: saved, error: readError } = await db.rpc("get_purchased_content_by_session", { p_session_id: sessionId });
    if (readError) return "failed";
    if (Array.isArray(saved) && saved.some((r) => r?.generated_content)) return "had";
    const { data: claim } = await db.from("used_stripe_sessions").select("product_type").eq("session_id", sessionId).maybeSingle();
    if (claim?.product_type && claim.product_type !== input.productType) return "skipped";
    const { data: order } = await db.from("product_deliveries")
      .select("status, customer_email, email_sent_at, product_name, metadata").eq("stripe_session_id", sessionId).maybeSingle();
    if (order?.status === "refunded") return "skipped";
    const email = typeof order?.customer_email === "string" ? order.customer_email : "";
    const productName = typeof order?.product_name === "string" && order.product_name ? order.product_name : input.productName;
    const { error: saveError } = await db.rpc("save_purchased_content", {
      p_stripe_session_id: sessionId, p_customer_email: email, p_product_type: input.productType,
      p_product_name: productName, p_generated_content: input.content,
    });
    if (saveError) return "failed";
    if (!order) return "kept";
    await db.rpc("log_delivery_step", { p_stripe_session_id: sessionId, p_step: "generation_completed", p_success: true });
    if (email && !order.email_sent_at) {
      const language = typeof order.metadata?.language === "string" ? order.metadata.language : undefined;
      let ok = false;
      try {
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-product-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({ email, productType: input.productType, productName, generatedContent: input.content, sessionId, language }),
        });
        ok = res.ok;
      } catch { /* recorded as a failed mail below */ }
      await db.rpc("log_delivery_step", {
        p_stripe_session_id: sessionId, p_step: "email_sent", p_success: ok,
        p_error: ok ? null : "send-product-email refused the recovery-form copy",
      });
    }
    return "kept";
  } catch (e) {
    console.error("[PAST-BUYER-COPY] the copy could not be kept:", e instanceof Error ? e.message : String(e));
    return "failed";
  }
}
