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
 * SENT DIRECTLY, RECORDED ONLY AFTER RESEND ACCEPTED IT (S11-053; owner
 * decision 2026-10-11). They went through the transactional queue and the
 * ledger row was written when the mail was QUEUED. Production had no drain,
 * a restored drain dead-letters a mail after 60 minutes or five failures, and
 * the queue's sender domain had no DNS: the notices were lost for good while
 * the ledger said each went once. Now sendLegalNotice (below) sends each
 * through Resend, the path and key paid deliveries use, with an idempotency
 * key, and writes sent_at only after a 2xx. A send that fails records
 * nothing: the webhook answers 500 and Stripe redelivers the event, and
 * Resend's idempotency key keeps a redelivery from mailing twice.
 *
 * Every figure is read from the subscription Stripe holds, never typed. A
 * promotion code (the plan checkouts allow them) changes what the buyer pays:
 * the notice then states the discounted charge Stripe computed, how long it
 * lasts, and the list price after it. No refund is promised (owner
 * decision). NO IMPORTS: vitest runs this file.
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
  /**
   * A promotion on the plan: the discounted charge Stripe computed (smallest
   * unit), and when the list price resumes: `until` (ISO) for a discount that
   * lasts some months, `forever` for one that never ends, neither for one
   * that covers only the first charge.
   */
  promo?: { amount: number; until: string | null; forever: boolean } | null;
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
  const list = `${money(f.amount, f.currency)} every ${f.interval}`;
  const p = f.promo ?? null;
  // The first charge, and what is charged after it.
  const first = money(p ? p.amount : f.amount, f.currency);
  const price = !p ? list
    : p.forever ? `${money(p.amount, f.currency)} every ${f.interval} (your promotion)`
    : p.until ? `${money(p.amount, f.currency)} every ${f.interval} with your promotion until ${day(p.until)}, then ${list}`
    : list;
  const cancelHow = f.portalLoginUrl
    ? `To cancel, open ${f.accountUrl} and choose "Manage subscription", or sign in to Stripe's billing page at ${f.portalLoginUrl}.`
    : `To cancel, open ${f.accountUrl} and choose "Manage subscription".`;
  const paras: string[] = [];
  let subject: string;
  if (kind === "confirmation") {
    subject = `Your ${f.planName} subscription`;
    paras.push(`Thank you for subscribing to ${f.planName}.`);
    if (f.trialEnd) {
      paras.push(`Your free trial ends on ${day(f.trialEnd)}. Unless you cancel before then, you will be charged ${first}${p ? " with your promotion" : ""} on ${day(f.trialEnd)}, and then ${price}, renewing automatically until you cancel.`);
      paras.push(`Cancel before ${day(f.trialEnd)} and you will not be charged.`);
    } else if (p) {
      paras.push(`Your first charge, with your promotion, is ${first}. After it you are charged ${price}. The subscription renews automatically until you cancel.`);
    } else {
      paras.push(`You are charged ${price}. The subscription renews automatically until you cancel.`);
    }
    paras.push(`You can cancel at any time. Cancelling stops all future charges. ${cancelHow}`);
  } else {
    subject = `Your ${f.planName} trial ends on ${f.trialEnd ? day(f.trialEnd) : "soon"}`;
    paras.push(`Your free trial of ${f.planName} ends on ${f.trialEnd ? day(f.trialEnd) : "its end date"}.`);
    paras.push(`If you keep the subscription, you will be charged ${first}${p ? " with your promotion" : ""} on that day, and then ${price} until you cancel.`);
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

/** The idempotency key Resend and the ledger share. */
export const noticeKey = (subscriptionId: string, kind: NoticeKind) => `sub-notice:${subscriptionId}:${kind}`;

/** The cancellation comment a 14-day withdrawal leaves on the plan (withdraw-subscription). */
export const WITHDRAWAL_CANCEL_COMMENT = "EU/UK 14-day withdrawal";

/** The label each notice is logged under (email_send_log.template_name). */
export const NOTICE_LABEL: Readonly<Record<NoticeKind, string>> = {
  confirmation: "subscription-confirmation",
  trial_ending: "trial-ending",
  withdrawal: "subscription-withdrawal",
};

/** Where Resend takes a mail: the same API and key send-product-email uses for paid deliveries. */
export const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 15_000;

export type LegalNoticeOutcome =
  | { outcome: "sent"; id: string | null }
  | { outcome: "already" }
  | { outcome: "suppressed"; reason: string }
  | { outcome: "failed"; status: number; error: string };

type NoticeDb = {
  // deno-lint-ignore no-explicit-any
  from: (t: string) => any;
};

/**
 * SEND ONE LEGAL NOTICE NOW, AND RECORD IT ONLY AFTER RESEND ACCEPTED IT.
 *
 *   1. A notice the ledger already records as sent is not sent again.
 *   2. A bounced or complained address gets nothing (as the queue did); an
 *      unsubscribe from the drip does not stop a notice the law requires.
 *   3. Resend is called with the notice's idempotency key, so a retry of a
 *      send that went through (its record failed, or Stripe redelivered)
 *      returns the first answer instead of a second mail.
 *   4. Only a 2xx writes sent_at. A row a withdrawal left waiting (its mail in
 *      pending_mail) is stamped; otherwise one is inserted.
 * Never throws: every failure is an outcome the caller acts on.
 */
export async function sendLegalNotice(
  db: NoticeDb,
  n: {
    subscriptionId: string;
    kind: NoticeKind;
    to: string;
    mail: { subject: string; html: string; text: string };
    apiKey: string | undefined;
    replyTo: string;
    fetchImpl?: typeof fetch;
  },
): Promise<LegalNoticeOutcome> {
  const to = n.to.trim().toLowerCase();
  const label = NOTICE_LABEL[n.kind];
  try {
    const { data: prior, error: readError } = await db.from("subscription_notices")
      .select("sent_at").eq("subscription_id", n.subscriptionId).eq("kind", n.kind).maybeSingle();
    if (readError) return { outcome: "failed", status: 0, error: `subscription_notices read: ${String(readError.message ?? readError).slice(0, 160)}` };
    if (prior?.sent_at) return { outcome: "already" };

    const { data: suppressed } = await db.from("suppressed_emails").select("reason").eq("email", to).maybeSingle();
    if (suppressed && suppressed.reason !== "unsubscribe") {
      await db.from("email_send_log").insert({ message_id: noticeKey(n.subscriptionId, n.kind), template_name: label, recipient_email: to, status: "suppressed" });
      return { outcome: "suppressed", reason: String(suppressed.reason ?? "suppressed") };
    }

    if (!n.apiKey) return { outcome: "failed", status: 0, error: "RESEND_API_KEY is not set" };
    let res: Response;
    try {
      res = await (n.fetchImpl ?? fetch)(RESEND_EMAILS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${n.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": noticeKey(n.subscriptionId, n.kind),
        },
        body: JSON.stringify({ from: NOTICE_FROM, to: [to], reply_to: n.replyTo, subject: n.mail.subject, html: n.mail.html, text: n.mail.text }),
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });
    } catch (e) {
      return { outcome: "failed", status: 0, error: `resend unreachable: ${String(e instanceof Error ? e.message : e).slice(0, 160)}` };
    }
    const body = await res.json().catch(() => null) as { id?: unknown; message?: unknown; name?: unknown } | null;
    if (res.status < 200 || res.status >= 300) {
      return { outcome: "failed", status: res.status, error: String(body?.message ?? body?.name ?? `resend answered ${res.status}`).slice(0, 200) };
    }
    const id = typeof body?.id === "string" ? body.id : null;
    const stamp = { sent_at: new Date().toISOString(), provider_message_id: id };
    const { error: recordError } = prior
      ? await db.from("subscription_notices").update({ ...stamp, pending_mail: null }).eq("subscription_id", n.subscriptionId).eq("kind", n.kind)
      : await db.from("subscription_notices").insert({ subscription_id: n.subscriptionId, kind: n.kind, email: to, ...stamp });
    // 23505: a concurrent delivery recorded the same send (Resend answered
    // both from one idempotency key). Anything else is retried, and the
    // retry's send is answered from that key, not mailed again.
    if (recordError && recordError.code !== "23505") {
      return { outcome: "failed", status: res.status, error: `sent but not recorded: ${String(recordError.message ?? recordError).slice(0, 160)}` };
    }
    await db.from("email_send_log").insert({ message_id: noticeKey(n.subscriptionId, n.kind), template_name: label, recipient_email: to, status: "sent" });
    return { outcome: "sent", id };
  } catch (e) {
    return { outcome: "failed", status: 0, error: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
}
