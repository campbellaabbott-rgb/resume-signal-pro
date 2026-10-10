/**
 * WHAT THE ACCOUNT PAGE SAYS WHEN delete-account REFUSES (L6-30, L3-13; wave
 * 3 review).
 *
 * delete-account reads the plans, removes the stored CV, cancels the plans and
 * only then deletes the user, so a refusal can come after something already
 * happened: the CV removed, or a plan cancelled (its answer then carries
 * subscriptionsCancelled). The page used to say "Nothing was deleted" for every
 * refusal, including one after a plan had been cancelled for good.
 */
export type DeleteRefusal = { code?: unknown; subscriptionsCancelled?: unknown } | null | undefined;

/** The i18n key for a refused delete, from the function's own answer. */
export function deleteRefusalKey(body: DeleteRefusal): string {
  const code = typeof body?.code === "string" ? body.code : "";
  const cancelled = Number(body?.subscriptionsCancelled);
  if (code === "subscription_unlinked") return "accountPage.deleteUnlinkedPlan";
  if (Number.isFinite(cancelled) && cancelled > 0) return "accountPage.deletePlanCancelled";
  if (/^(subscription_cancel_failed|billing_unreadable|files_not_deleted)$/.test(code)) return "accountPage.deleteRetry";
  return "accountPage.deleteFailed";
}
