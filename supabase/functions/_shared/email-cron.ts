/**
 * THE BATCH MAILERS ANSWER THE SCHEDULER AND OUR OWN SERVERS, NOBODY ELSE.
 *
 * send-market-pulse, send-search-digest and send-agent-digest each run a
 * batch send on {"action":"send"}. All three are verify_jwt=false so pg_cron
 * can reach them, which means anyone could post that body: N concurrent posts
 * mailed every due recipient N times (defect sweep 2.23, and the same shape in
 * both digests). The crons now send x-email-cron, a key held in the vault
 * (email_cron_key, migration 20261004100000) and checked by
 * email_cron_key_matches, which answers a boolean and never the key. The
 * service-role bearer is accepted too, for an operator running a batch by hand.
 */
import { isServiceRoleCaller } from "./service-caller.ts";

type Rpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

/** True only for the service-role bearer or the vault-held cron key. A check that errors is a no. */
export async function isScheduledCaller(h: Headers, admin: Rpc, serviceKey: string): Promise<boolean> {
  if (isServiceRoleCaller(h, serviceKey)) return true;
  const offered = h.get("x-email-cron") ?? "";
  if (offered.length < 32 || offered.length > 256) return false;
  try {
    const { data, error } = await admin.rpc("email_cron_key_matches", { p_key: offered });
    return !error && data === true;
  } catch {
    return false;
  }
}
