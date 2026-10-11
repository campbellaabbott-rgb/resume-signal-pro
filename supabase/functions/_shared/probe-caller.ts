/**
 * WHO MAY RUN A LIVE HEALTH PROBE (S8-061).
 *
 * health-check and scheduled-health-probe are verify_jwt=false, and every
 * anonymous POST called Stripe's balance endpoint with the live key and the
 * AI gateway, and (the probe) wrote a heartbeat row. Stripe's read limit is
 * account-wide, shared with purchase verification and subscription checks.
 * A live probe, a heartbeat write and provider refusal text are now for the
 * owner's key (x-admin-key), the vault-held cron key (x-email-cron) or the
 * service role only; each function answers anyone else from what it already
 * knows (a cached result, or the database alone).
 */
import { keyMatches } from "./admin-key.ts";
import { isScheduledCaller } from "./email-cron.ts";

type Rpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export async function isProbeOperator(h: Headers, admin: Rpc | null, serviceKey: string, adminKey: string): Promise<boolean> {
  if (keyMatches(h.get("x-admin-key") ?? "", adminKey)) return true;
  if (!admin) return false;
  return isScheduledCaller(h, admin, serviceKey);
}
