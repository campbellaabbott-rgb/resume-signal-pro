/**
 * THE 14-DAY WITHDRAWAL FROM A PLAN, FOR EU AND UK BUYERS (owner decision 3,
 * 2026-10-08; Directive 2011/83/EU arts. 9, 13, 14(3); UK CCRs 2013 regs. 29,
 * 34, 36). Behind the EU_UK_SALES switch, which stays off until the owner has
 * registered for VAT: while it is off withdraw-subscription answers 404 and
 * nothing here runs.
 *
 * With it on, a plan bought in the last 14 days by a buyer billed in the EU,
 * the EEA or the UK (WITHDRAWAL_COUNTRIES) can be withdrawn from the account
 * page. A buyer who expressly asked for the service to start inside the
 * period (the checkout's box, art. 7(3)) pays for the days already provided
 * and the rest is refunded: art. 14(3), in proportion to the period paid for.
 * A plan that carries no such request (one bought before the box existed, or
 * not through our checkout) owes nothing for those days, so it is refunded in
 * full: art. 14(4)(a)(ii). A trial that has charged nothing is cancelled with
 * nothing to refund. A one-time product bought with the waiver ticked has no withdrawal
 * once delivered (art. 16(m)).
 *
 * NO IMPORTS: vitest runs this file.
 */

/**
 * WHERE THE RIGHT APPLIES: the EU member states, the rest of the EEA (the
 * Directive applies there too) and the United Kingdom, as ISO 3166-1 alpha-2
 * codes, the way Stripe writes an address's country. A buyer anywhere else
 * has no statutory withdrawal, and the owner's rule is no refunds but where
 * the law requires one.
 */
export const WITHDRAWAL_COUNTRIES: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO",
  "GB",
]);

/** The first well-formed country code among the candidates (most trusted first), or null. */
export function buyerCountryOf(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    const code = typeof c === "string" ? c.trim().toUpperCase() : "";
    if (/^[A-Z]{2}$/.test(code)) return code;
  }
  return null;
}

/** True when a buyer billed in `country` has the 14-day right. No country read: no right assumed. */
export function inWithdrawalTerritory(country: unknown): boolean {
  const code = buyerCountryOf(country);
  return code !== null && WITHDRAWAL_COUNTRIES.has(code);
}

/** The statutory withdrawal period, in days. */
export const WITHDRAWAL_PERIOD_DAYS = 14;

const DAY_S = 86_400;

/** True while a contract concluded at `startSec` (Unix seconds) may still be withdrawn from at `nowSec`. */
export function withinWithdrawalPeriod(startSec: number, nowSec: number): boolean {
  return Number.isFinite(startSec) && startSec > 0 && nowSec >= startSec && nowSec - startSec <= WITHDRAWAL_PERIOD_DAYS * DAY_S;
}

/**
 * True when any of the given metadata (the subscription's, then its checkout
 * session's) records the buyer's request that the plan start inside the
 * period: the checkout writes `service_start_consent` only when the box was
 * ticked with the switch on.
 */
export function serviceStartRequested(...metadata: unknown[]): boolean {
  for (const m of metadata) {
    const v = m && typeof m === "object" ? (m as Record<string, unknown>).service_start_consent : undefined;
    if (typeof v === "string" && v.trim()) return true;
  }
  return false;
}

/**
 * What is refunded of one paid invoice. Without the buyer's request to start
 * early, all of it. With it, all but the share of its period already provided
 * at `nowSec`, rounded down to the cent so rounding never costs the buyer; a
 * period that cannot be read refunds in full rather than guessing a charge.
 */
export function withdrawalRefundCents(amountPaid: number, periodStart: number, periodEnd: number, nowSec: number, startRequested: boolean): number {
  const paid = Math.max(0, Math.floor(Number(amountPaid) || 0));
  if (!paid) return 0;
  if (startRequested !== true) return paid;
  const length = periodEnd - periodStart;
  if (!Number.isFinite(length) || length <= 0) return paid;
  const provided = Math.min(1, Math.max(0, (nowSec - periodStart) / length));
  return paid - Math.floor(paid * provided);
}
