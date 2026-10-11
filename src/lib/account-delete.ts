/**
 * WHAT THE ACCOUNT PAGE SAYS WHEN delete-account REFUSES (L6-30, L3-13; wave
 * 3 review).
 *
 * delete-account reads the plans, cancels them, switches the apply agent off,
 * removes the stored CV and only then deletes the user, so a refusal can come
 * after something already happened: a plan cancelled (subscriptionsCancelled),
 * the agent switched off (agentStopped), the CV removed (cvRemoved). The page
 * used to say "Nothing was deleted" for every refusal, including one after a
 * plan had been cancelled for good.
 */
export type DeleteRefusal = { code?: unknown; subscriptionsCancelled?: unknown; agentStopped?: unknown; cvRemoved?: unknown } | null | undefined;

/** The i18n key for a refused delete, from the function's own answer. */
export function deleteRefusalKey(body: DeleteRefusal): string {
  const code = typeof body?.code === "string" ? body.code : "";
  const cancelled = Number(body?.subscriptionsCancelled);
  if (code === "subscription_unlinked") return "accountPage.deleteUnlinkedPlan";
  if (Number.isFinite(cancelled) && cancelled > 0) return "accountPage.deletePlanCancelled";
  if (/^(subscription_cancel_failed|billing_unreadable|files_not_deleted)$/.test(code)) return "accountPage.deleteRetry";
  return "accountPage.deleteFailed";
}

/** The refusal's message keys: the main one, then what had already changed. */
export function deleteRefusalKeys(body: DeleteRefusal): string[] {
  const keys = [deleteRefusalKey(body)];
  if (body?.agentStopped === true) keys.push("accountPage.deleteAgentStopped");
  if (body?.cvRemoved === true) keys.push("accountPage.deleteCvRemoved");
  return keys;
}
