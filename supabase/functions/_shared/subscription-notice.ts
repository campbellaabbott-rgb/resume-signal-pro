/**
 * THE MAIL A NEW SUBSCRIBER IS OWED (wave 3 payments-account; commercial-
 * readiness plan 2026-10-08, item 11; Cal. Bus. & Prof. Code 17602).
 *
 * A new Pro or agent subscriber got nothing from us: no terms, no
 * cancellation policy, no way to cancel, and a trial subscriber was not told
 * when the first charge falls. stripe-webhook now sends two notices, each once
 * per subscription (subscription_notices, 20261009130000):
 *   - "confirmation" on the checkout that created the plan: what it costs,
 *     that it renews every month until cancelled, when a trial ends, what
 *     cancelling does and how to do it;
 *   - "trial_ending" on Stripe's customer.subscription.trial_will_end, which
 *     Stripe sends three days before a trial ends (an event the owner adds to
 *     the endpoint): the date and amount of the first charge and how to
 *     cancel before it. Not sent for a trial already set to cancel.
 * Both go through the existing transactional queue (enqueue_email_delayed,
 * process-email-queue), like the fix-plan drip.
 *
 * Every figure is read from the subscription Stripe holds, never typed. No
 * refund is promised (owner decision). NO IMPORTS: vitest runs this file.
 */

export type NoticeKind = "confirmation" | "trial_ending" | "withdrawal";

export type NoticeFacts = {
  planName: string;
  /** The recurring amount in the smallest unit, and its currency, as Stripe holds them. */
  amount: number;
  currency: string;
  interval: string;
  /** ISO time the trial ends, when the plan is trialing. */
  trialEnd: string | null;
  /** Where cancelling is done: the account page, and Stripe's emailed portal sign-in when the owner set one. */
  accountUrl: string;
  portalLoginUrl?: string | null;
  /** With the EU/UK switch on: the last day of the 14-day withdrawal period, and where to write. */
  withdrawal?: { until: string; contact: string } | null;
};

export const NOTICE_FROM = "Resume Booster <billing@resumebooster.work>";
/** The statutory withdrawal period the EU/UK paragraph names (Directive 2011/83/EU art. 9). */
export const WITHDRAWAL_DAYS = 14;
export const NOTICE_SENDER_DOMAIN = "notify.resumebooster.work";

const esc = (v: string) => v.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]!));

/** An amount as a buyer reads it: $45.00, €45.00, 45.00 SEK. */
export function money(amount: number, currency: string): string {
  const c = currency.toLowerCase();
  const major = (amount / (c === "jpy" || c === "krw" ? 1 : 100)).toFixed(c === "jpy" || c === "krw" ? 0 : 2);
  const sym: Record<string, string> = { usd: "$", eur: "€", gbp: "£", cad: "CA$", aud: "A$" };
  return sym[c] ? `${sym[c]}${major}` : `${major} ${c.toUpperCase()}`;
}

/** A date as a buyer reads it, in UTC so the mail says one day whatever the server's zone. */
export function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** The notice's subject, text and HTML. */
export function noticeMail(kind: NoticeKind, f: NoticeFacts): { subject: string; text: string; html: string } {
  const price = `${money(f.amount, f.currency)} every ${f.interval}`;
  const cancelHow = f.portalLoginUrl
    ? `To cancel, open ${f.accountUrl} and choose "Manage subscription", or sign in to Stripe's billing page at ${f.portalLoginUrl}.`
    : `To cancel, open ${f.accountUrl} and choose "Manage subscription".`;
  const paras: string[] = [];
  let subject: string;
  if (kind === "confirmation") {
    subject = `Your ${f.planName} subscription`;
    paras.push(`Thank you for subscribing to ${f.planName}.`);
    if (f.trialEnd) {
      paras.push(`Your free trial ends on ${day(f.trialEnd)}. Unless you cancel before then, you will be charged ${money(f.amount, f.currency)} on ${day(f.trialEnd)}, and then ${price}, renewing automatically until you cancel.`);
      paras.push(`Cancel before ${day(f.trialEnd)} and you will not be charged.`);
    } else {
      paras.push(`You are charged ${price}. The subscription renews automatically until you cancel.`);
    }
    paras.push(`You can cancel at any time. Cancelling stops all future charges. ${cancelHow}`);
  } else {
    subject = `Your ${f.planName} trial ends on ${f.trialEnd ? day(f.trialEnd) : "soon"}`;
    paras.push(`Your free trial of ${f.planName} ends on ${f.trialEnd ? day(f.trialEnd) : "its end date"}.`);
    paras.push(`If you keep the subscription, you will be charged ${money(f.amount, f.currency)} on that day, and then ${price} until you cancel.`);
    paras.push(`If you do not want to be charged, cancel before the trial ends. ${cancelHow}`);
  }
  if (f.withdrawal) {
    paras.push(`You may withdraw from this contract within ${WITHDRAWAL_DAYS} days, until ${day(f.withdrawal.until)}, without giving a reason: on your account page (${f.accountUrl}, "Withdraw within ${WITHDRAWAL_DAYS} days"), or by writing to ${f.withdrawal.contact}. If you asked for the service to start during that time, you pay for the days already used.`);
  }
  paras.push(`The Terms of Service you agreed to are at https://resumebooster.work/terms.`);
  const text = paras.join("\n\n");
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#0f172a">${
    paras.map((p) => `<p style="font-size:14px;line-height:1.5">${esc(p)}</p>`).join("")
  }</div>`;
  return { subject, text, html };
}

/**
 * THE ACKNOWLEDGEMENT OF A WITHDRAWAL (EU/UK switch only; _shared/withdrawal.ts).
 * A withdrawal made on our site is acknowledged on a durable medium without
 * delay (Directive 2011/83/EU art. 11(3)): when it was received, that the plan
 * is cancelled and charges stop, and what is refunded, computed, never typed.
 */
export function withdrawalMail(f: {
  planName: string;
  withdrawnAt: string;
  refund: { amount: number; currency: string } | null;
  accountUrl: string;
}): { subject: string; text: string; html: string } {
  const paras = [
    `We received your withdrawal from ${f.planName} on ${day(f.withdrawnAt)}.`,
    `The subscription is cancelled and will not charge you again.`,
    f.refund && f.refund.amount > 0
      ? `${money(f.refund.amount, f.refund.currency)}, what you paid less the days already provided, is being refunded to the card you paid with, within ${WITHDRAWAL_DAYS} days of your withdrawal.`
      : `Nothing was charged for it, so there is nothing to refund.`,
    `Your account is at ${f.accountUrl}.`,
  ];
  const text = paras.join("\n\n");
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#0f172a">${
    paras.map((p) => `<p style="font-size:14px;line-height:1.5">${esc(p)}</p>`).join("")
  }</div>`;
  return { subject: `Your withdrawal from ${f.planName}`, text, html };
}

/** The idempotency key the queue and the ledger share. */
export const noticeKey = (subscriptionId: string, kind: NoticeKind) => `sub-notice:${subscriptionId}:${kind}`;
