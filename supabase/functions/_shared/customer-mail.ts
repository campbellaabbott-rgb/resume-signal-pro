/**
 * A CUSTOMER'S REPLY REACHES A PERSON.
 *
 * Every customer mail says "reply to this email" or "questions? reply", and
 * none set a reply address: a reply went to reports@ or notify@ on our own
 * sending domains, which no one reads, so a complaint that could have been
 * answered became a chargeback (commercial-readiness 2026-10-08, item 3).
 * Every mail to a customer -- purchase, report, digest, pulse, claim, key,
 * affiliate and the queued auth and drip mails -- carries this reply_to.
 * Owner alerts do not need it.
 *
 * Import-free: the Node tests import it directly.
 */
export const CUSTOMER_REPLY_TO = "resumeboostersupp@gmail.com";
