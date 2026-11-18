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
 *
 * S14X-230. A plan billed to the address but not linked to the account
 * refuses the delete with "cancel it from Stripe's billing page first", and
 * delete-account already answers that page's address (portalLoginUrl). The
 * page dropped it, so the sentence named a page with no way to reach it. The
 * view now carries the address when, and only when, it is Stripe's own
 * billing host.
 */
export type DeleteRefusal = { code?: unknown; subscriptionsCancelled?: unknown; agentStopped?: unknown; cvRemoved?: unknown; portalLoginUrl?: unknown } | null | undefined;

/** What the account page shows for a refusal: its message keys, and Stripe's billing page when the refusal names it. */
export type DeleteRefusalView = { keys: string[]; billingUrl: string | null };

const STRIPE_BILLING = /^https:\/\/billing\.stripe\.com\//;

/** The i18n key for a refused delete, from the function's own answer. */
export function deleteRefusalKey(body: DeleteRefusal): string {
  const code = typeof body?.code === "string" ? body.code : "";
  const cancelled = Number(body?.subscriptionsCancelled);
  if (code === "subscription_unlinked") return "accountPage.deleteUnlinkedPlan";
  if (Number.isFinite(cancelled) && cancelled > 0) return "accountPage.deletePlanCancelled";
  if (/^(subscription_cancel_failed|billing_unreadable|files_not_deleted|keys_not_revoked)$/.test(code)) return "accountPage.deleteRetry";
  return "accountPage.deleteFailed";
}

/** The refusal's message keys: the main one, then what had already changed. */
export function deleteRefusalKeys(body: DeleteRefusal): string[] {
  const keys = [deleteRefusalKey(body)];
  if (body?.agentStopped === true) keys.push("accountPage.deleteAgentStopped");
  if (body?.cvRemoved === true) keys.push("accountPage.deleteCvRemoved");
  return keys;
}

/** Stripe's billing page from a refusal, only when it is on Stripe's own billing host. */
export function stripeBillingUrl(body: DeleteRefusal): string | null {
  const url = typeof body?.portalLoginUrl === "string" ? body.portalLoginUrl.trim() : "";
  return STRIPE_BILLING.test(url) ? url : null;
}

/** The refusal as the page shows it: the keys, plus the billing page an unlinked plan is cancelled from. */
export function deleteRefusalView(body: DeleteRefusal): DeleteRefusalView {
  const keys = deleteRefusalKeys(body);
  return { keys, billingUrl: keys[0] === "accountPage.deleteUnlinkedPlan" ? stripeBillingUrl(body) : null };
}
