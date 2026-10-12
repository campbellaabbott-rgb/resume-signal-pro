// THE SERVER-SIDE APPLY AGENT IS SWITCHED OFF, AND ITS PRODUCTS ARE NOT SOLD.
//
// Owner decision 2026-10-11 (the apply pivot, wave 4): the Agent plan and the
// Agent Pass are retired, the apply agent that prepared and sent applications
// for a person is switched off, and the only apply path is the person's own
// AI applying with them (apply_myself), where nothing is ever submitted by us.
// The agent never completed a live submission (released = 0), so nothing that
// worked is taken away.
//
// THE CODE STAYS, DORMANT. Every function keeps its logic and its tests; these
// two values decide whether that logic runs. They are constants, not secrets
// or settings, so the deployed behaviour is readable from the repository and
// changing it is a reviewed commit plus a deploy of the functions that import
// this file. Each value is typed `boolean` rather than its literal, so the
// dormant branches still type-check as reachable. There are three, and each
// names every checkout or function it controls.
//
//   APPLY_AGENT_ON          apply-agent prepares and releases packets,
//                           agent-runner fills the morning queue, apply-broker
//                           hands packets to a worker and records its
//                           heartbeat, and agent-access lets a person release
//                           a waiting packet. Off: each answers that it is
//                           switched off and does no work. The broker still
//                           records the outcome of a packet a worker already
//                           holds, so nothing in flight is lost.
//
//   AGENT_PRODUCTS_ON_SALE  create-agent-checkout and create-pass-checkout
//                           open a Stripe session. Off: both refuse before
//                           identity, the rate limiter or Stripe, with a 410
//                           that names the free way to apply (see
//                           apply-agent-retired.ts). Existing plans and passes
//                           still read correctly (agent-access,
//                           agent-pass-status, stripe-webhook are unchanged in
//                           what they report and grant).
//
//   APPLY_ASSISTANT_ON_SALE create-product-checkout's applyAssistant row (the
//                           $7 Apply Assistant), retired outright with the
//                           other two. Off: a purchase of that row is
//                           refused the same way; every other product in
//                           that function still sells.
//
// They are separate on purpose: switching the agent back on to prove one
// real submission must not put anything back on sale, and putting the Pass or
// the plan back on sale must not quietly reopen the Apply Assistant, which the
// owner retired on its own terms.
//
// Tests that exercise the dormant code stub this module (the edge harness
// replaces `_shared/apply-agent-switch.ts`); the tests of the switched-off
// behaviour load it as it ships.

export const APPLY_AGENT_ON: boolean = false;
export const AGENT_PRODUCTS_ON_SALE: boolean = false;
export const APPLY_ASSISTANT_ON_SALE: boolean = false;
