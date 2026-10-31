/**
 * THE CURRENCY SIGNAL TURNS AWAY NO BUYER OUTSIDE THE TERRITORY (review of
 * hp/honesty's region line, 2026-10-25).
 *
 * The buy block's region line says checkout turns away buyers it can place in
 * the EU, the EEA, the UK or India, from the currency and the time zone the
 * device reports. The page picks the currency from the time zone
 * (useCurrency), and create-checkout refuses any request priced in a
 * territory currency (TERRITORY_CURRENCIES), whatever the time zone. So a
 * zone outside the territory that the page prices in euros was refused
 * "because of a currency used there" without being there: Montenegro
 * (Europe/Podgorica), which uses the euro and is in neither the VAT
 * territory nor its time-zone list. Kosovo is the same in the map, though no
 * zone sends a browser to it.
 *
 * Every zone the page knows is walked here: one the page prices in a
 * territory currency must be a territory zone, and Montenegro and Kosovo are
 * priced in US dollars, as Ecuador and El Salvador already are.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useCurrency } from "@/hooks/use-currency";
import { TERRITORY_CURRENCIES, TERRITORY_TIME_ZONES } from "../../supabase/functions/_shared/sales-territory-zones";

const SOURCE = readFileSync(resolve(__dirname, "../hooks/use-currency.ts"), "utf8");
/** Every zone in the page's time-zone map, read from the source. */
const ZONES = [...SOURCE.matchAll(/"([A-Z][A-Za-z_]+\/[A-Za-z_/-]+)":\s*"[A-Z]{2}"/g)].map((m) => m[1]);

const RealDTF = Intl.DateTimeFormat;
function inZone(timeZone: string) {
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(((...args: ConstructorParameters<typeof Intl.DateTimeFormat>) => {
    const real = new RealDTF(...args);
    return Object.assign(Object.create(real), { resolvedOptions: () => ({ ...real.resolvedOptions(), timeZone }) });
  }) as unknown as typeof Intl.DateTimeFormat);
}
function currencyIn(timeZone: string): string {
  inZone(timeZone);
  const { result, unmount } = renderHook(() => useCurrency());
  const code = result.current.currency.code;
  unmount();
  vi.restoreAllMocks();
  return code;
}

afterEach(() => vi.restoreAllMocks());

describe("the page never prices a buyer outside the territory in a territory currency", () => {
  it("reads the page's whole zone map", () => {
    expect(ZONES.length).toBeGreaterThan(80);
    expect(ZONES).toContain("Europe/Podgorica");
  });

  it("every zone priced in a territory currency is a territory zone", () => {
    const strays = ZONES.filter((z) => TERRITORY_CURRENCIES.has(currencyIn(z).toLowerCase()) && !TERRITORY_TIME_ZONES.has(z));
    expect(strays).toEqual([]);
  });

  it("Montenegro is priced in US dollars, and Kosovo's entry is too", () => {
    expect(currencyIn("Europe/Podgorica")).toBe("USD");
    expect(SOURCE).toMatch(/XK: \{ code: "USD"/);
  });

  it("control: a territory zone is still priced in its own currency", () => {
    expect(currencyIn("Europe/Paris")).toBe("EUR");
    expect(currencyIn("Asia/Kolkata")).toBe("INR");
  });
});
