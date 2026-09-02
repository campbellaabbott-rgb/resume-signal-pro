export const ACTIVE_SUBSCRIBER_STATUSES = new Set(["active", "trialing"]);
export const ENTITLEMENT_COLUMNS = "email, status, current_period_end";
export type SubscriberRow = {
  email?: string | null;
  status?: string | null;
  current_period_end?: string | null;
};
export const normalizeEmail = (email: unknown): string =>
  typeof email === "string" ? email.trim().toLowerCase() : "";
export function rowIsEntitled(row: SubscriberRow | null | undefined, now: number = Date.now()): boolean {
  if (!row) return false;
  if (!ACTIVE_SUBSCRIBER_STATUSES.has(String(row.status ?? ""))) return false;
  if (row.current_period_end) {
    const ends = new Date(row.current_period_end).getTime();
    if (!Number.isFinite(ends) || ends <= now) return false;
  }
  return true;
}
export function entitledFromRows(rows: SubscriberRow[] | null | undefined, now: number = Date.now()): Set<string> {
  const out = new Set<string>();
  for (const row of rows ?? []) {
    if (rowIsEntitled(row, now)) {
      const email = normalizeEmail(row.email);
      if (email) out.add(email);
    }
  }
  return out;
}
export const TIER_SEND_CEILING: Readonly<Record<string, number>> = {
  active: 20,
  trialing: 5,
};
export function tierCeiling(status: unknown): number {
  return TIER_SEND_CEILING[String(status ?? "")] ?? 0;
}
export function effectiveDailyCap(chosen: unknown, status: unknown): number {
  const n = Number(chosen);
  const want = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return Math.min(want, tierCeiling(status));
}
export const isEntitled = (entitled: Set<string>, email: unknown): boolean => {
  const normalized = normalizeEmail(email);
  return normalized !== "" && entitled.has(normalized);
};
