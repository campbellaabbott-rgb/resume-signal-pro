/**
 * THE DORMANT APPLY AGENT, SWITCHED ON FOR A TEST.
 *
 * Since 2026-10-11 the server-side apply agent is off and the Agent plan and
 * the Agent Pass are not sold (supabase/functions/_shared/apply-agent-switch.ts).
 * Their code is kept so it can be switched back on, and the suites that
 * prove that code (checkout origins and receipts, the one-trial rule, the
 * renewal terms, the signed-in-owner rule, the agent functions against the
 * real database) keep running
 * it. They load the shipped handler with this stub in place of the switch
 * module, which is the only difference from production; every other import is
 * the real file.
 *
 * The switched-off behaviour, the one that ships, is proved by the suites
 * that load the switch as it is:
 *   the-retired-agent-products-refuse-a-purchase-and-name-applying-yourself
 *   the-server-side-apply-agent-is-switched-off
 */
export const APPLY_AGENT_SWITCH_ON: Record<string, string> = {
  "_shared/apply-agent-switch.ts": "export const APPLY_AGENT_ON = true; export const AGENT_PRODUCTS_ON_SALE = true; export const APPLY_ASSISTANT_ON_SALE = false;",
};

/** Every switch on, the $7 Apply Assistant's included: the dormant purchase path of create-product-checkout. */
export const APPLY_ASSISTANT_SWITCH_ON: Record<string, string> = {
  "_shared/apply-agent-switch.ts": "export const APPLY_AGENT_ON = true; export const AGENT_PRODUCTS_ON_SALE = true; export const APPLY_ASSISTANT_ON_SALE = true;",
};
