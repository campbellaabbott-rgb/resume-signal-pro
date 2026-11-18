// A PRO GRANT KEEPS THE MONTH THAT PAID FOR IT (S14X-078). The mint stamps
// pro_grants.redeem_until: the end of the paid period it was minted in, plus a
// week. _shared/pro.ts proGrantRefusal honours it. Kept out of _shared, whose
// every byte counts against job-board's upload. Import-free.

export const PRO_GRANT_REDEEM_DAYS = 7;

const ms = (v: unknown): number => v instanceof Date ? v.getTime() : typeof v === "string" ? Date.parse(v) : NaN;

/** The latest period end of the paid ('active') rows pro_entitlement_rows answered; null when none states one. */
export function mintingPeriodEnd(rows: unknown): string | null {
  let best = NaN;
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = r && (r as { status?: unknown }).status === "active" ? ms((r as { current_period_end?: unknown }).current_period_end) : NaN;
    if (Number.isFinite(t) && !(t <= best)) best = t;
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : null;
}

/** redeem_until for a grant minted in a period ending at periodEnd; null when the end is unknown. */
export function grantRedeemUntil(periodEnd: unknown): string | null {
  const t = ms(periodEnd);
  return Number.isFinite(t) ? new Date(t + PRO_GRANT_REDEEM_DAYS * 86_400_000).toISOString() : null;
}
