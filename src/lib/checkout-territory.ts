/**
 * IS THIS BROWSER IN THE VAT TERRITORY? (S12-059, wave 4 round 2)
 *
 * While the EU/UK switch is off, every checkout that still sells refuses a
 * buyer in the EU, the EEA or the UK (supabase/functions/_shared/
 * sales-territory.ts). The page reads the same zone list, so a buyer there
 * is told before pressing, instead of after, and every checkout body carries
 * the browser's time zone, which the server may use to ADD a refusal (never
 * to lift one). The zone is a hint the buyer controls; the server's other
 * signals and the billing address do not depend on it.
 */
import { TERRITORY_TIME_ZONES } from "../../supabase/functions/_shared/sales-territory-zones";

/** The browser's IANA time zone, or "" when it cannot say. */
export function buyerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

/** True when this browser's time zone is one of the territory's. */
export function inSalesTerritory(zone: string = buyerTimeZone()): boolean {
  return TERRITORY_TIME_ZONES.has(zone);
}

/** The field every checkout body carries. */
export function territoryHint(): { timeZone?: string } {
  const zone = buyerTimeZone();
  return zone ? { timeZone: zone } : {};
}
