/**
 * THE FIX-PLAN SEQUENCE IS WITHDRAWN (S14X-012, the owner's option B,
 * 2026-11-15). Its four mails were queued on transactional_emails, which no
 * job drains, so every "Done. The first email arrives in two days" was a
 * promise nothing kept. The owner chose to withdraw the promise rather than
 * drain the queue: while this is false, a report mail carries no button, and
 * a button from a mail already sent answers queued: false with the reason
 * "withdrawn" and queues nothing. The sequence's code stays in index.ts, so
 * offering it again is this constant together with a drain for the queue.
 *
 * Its own module so a test can run the sequence's code with it switched on.
 */
export const FIX_PLAN_SEQUENCE_OFFERED = false;
