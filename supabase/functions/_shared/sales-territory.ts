// NO SALE INTO THE EU, THE EEA OR THE UK UNTIL WE ARE REGISTERED FOR VAT
// (owner decision 2026-10-12; S12-059, critical-path CP-037).
//
// With the EU/UK switch off (EU_UK_SALES, checkout-policy.ts), a buyer there
// used to check out in euros or pounds with no VAT charged and no withdrawal
// information: the switch only added the waiver and tax when it was on, and
// refused nobody while it was off. Every checkout that still sells (the Full
// Analysis, Freelance Boost, Pro) now asks this module first, and while the
// switch is off it refuses a buyer the evidence places in the territory,
// before the rate limiter's purchase path, a Pro grant or Stripe:
//
//   - a currency only the territory bills in (the page picks it from the
//     buyer's time zone): EUR, GBP and the other EEA currencies;
//   - the page's own time zone (body.timeZone), when it is one of the
//     territory's;
//   - a country header the platform set (cf-ipcountry), if one ever arrives;
//   - the trusted address (clientAddressOr), looked up the way the free scan
//     and the lead form already look it up (ipinfo.io with IPINFO_API_KEY),
//     once per /24 (an IPv6 /64) per isolate, with a short timeout.
//
// Every signal can ADD a refusal and none can lift one. A lookup that cannot
// answer refuses nobody: the billing address Stripe now always collects
// (sessionPolicy) and the owner's Radar rule on the card's country are the
// backstop for a buyer no signal placed. Nothing is refunded after the fact
// (refunds: never, owner decision 2026-10-12).
//
// The answer says why in the buyer's language: sales there wait for the VAT
// registration, and nothing was charged.

import { type CheckoutLanguage, euUkSalesOn } from "./checkout-policy.ts";
import { retiredLanguageOf } from "./apply-agent-retired.ts";

import { TERRITORY_CURRENCIES, TERRITORY_TIME_ZONES, VAT_TERRITORY } from "./sales-territory-zones.ts";

export { TERRITORY_CURRENCIES, TERRITORY_TIME_ZONES, VAT_TERRITORY };

export type TerritorySignal = "currency" | "time_zone" | "header" | "address";

export interface TerritoryRefusal {
  signal: TerritorySignal;
  country: string | null;
}

type Env = (name: string) => string | undefined;
type Lookup = (address: string) => Promise<string | null>;

const cc = (v: unknown): string | null => {
  const s = String(v ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) && s !== "XX" && s !== "T1" ? s : null;
};

/** The block an address is cached under: its /24, or its /64. */
export function addressBlock(address: string): string {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(address);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  const words = address.toLowerCase().split(":");
  return words.length > 2 ? `${words.slice(0, 4).join(":")}::/64` : address;
}

const LOOKUP_TTL_MS = 6 * 3600 * 1000;
const cache = new Map<string, { country: string | null; at: number }>();

/** The address's country from ipinfo.io, or null when it cannot say (no key, a timeout, a refusal). */
export function ipinfoLookup(env: Env, fetchImpl: typeof fetch = fetch, timeoutMs = 1500): Lookup {
  return async (address: string) => {
    const key = env("IPINFO_API_KEY");
    if (!key || !address || address === "unknown") return null;
    const block = addressBlock(address);
    const hit = cache.get(block);
    if (hit && Date.now() - hit.at < LOOKUP_TTL_MS) return hit.country;
    try {
      const res = await fetchImpl(`https://ipinfo.io/${encodeURIComponent(address)}?token=${encodeURIComponent(key)}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null) as { country?: unknown } | null;
      const country = cc(data?.country);
      cache.set(block, { country, at: Date.now() });
      return country;
    } catch {
      return null;
    }
  };
}

/** For tests: forget every cached lookup. */
export function clearTerritoryCache(): void {
  cache.clear();
}

/**
 * Why this buyer may not be sold to while the switch is off, or null. The
 * cheap signals are read first, so a refusal they decide costs no lookup.
 */
export async function territoryRefusal(opts: {
  env?: Env;
  headers: Headers;
  body?: unknown;
  currency?: string | null;
  address?: string | null;
  lookup?: Lookup | null;
}): Promise<TerritoryRefusal | null> {
  if (euUkSalesOn(opts.env)) return null;
  const currency = String(opts.currency ?? "").trim().toLowerCase();
  if (currency && TERRITORY_CURRENCIES.has(currency)) return { signal: "currency", country: null };
  const b = opts.body && typeof opts.body === "object" ? (opts.body as Record<string, unknown>) : {};
  const zone = typeof b.timeZone === "string" ? b.timeZone.trim() : "";
  if (zone && TERRITORY_TIME_ZONES.has(zone)) return { signal: "time_zone", country: null };
  const header = cc(opts.headers.get("cf-ipcountry"));
  if (header && VAT_TERRITORY.has(header)) return { signal: "header", country: header };
  if (opts.lookup && opts.address) {
    const country = await opts.lookup(opts.address);
    if (country && VAT_TERRITORY.has(country)) return { signal: "address", country };
  }
  return null;
}

/** What the page may know before any press: whether the territory is refused now. */
export function territoryPolicy(env?: Env): { territoryRefused: boolean } {
  return { territoryRefused: !euUkSalesOn(env) };
}

const SENTENCE: Readonly<Record<CheckoutLanguage, string>> = {
  en: "We can't sell to buyers in the EU, the EEA or the UK yet: sales there wait until we are registered for VAT. Nothing was charged.",
  "en-GB": "We can't sell to buyers in the EU, the EEA or the UK yet: sales there wait until we are registered for VAT. Nothing was charged.",
  de: "Wir können an Käufer in der EU, im EWR und im Vereinigten Königreich noch nicht verkaufen: Verkäufe dort warten auf unsere Umsatzsteuer-Registrierung. Dir wurde nichts berechnet.",
  es: "Todavía no podemos vender a compradores de la UE, el EEE ni el Reino Unido: las ventas allí esperan a nuestro registro del IVA. No se te ha cobrado nada.",
  fr: "Nous ne pouvons pas encore vendre aux acheteurs de l'UE, de l'EEE ou du Royaume-Uni : les ventes y attendent notre immatriculation à la TVA. Rien ne vous a été facturé.",
  hi: "हम अभी EU, EEA या UK के खरीदारों को नहीं बेच सकते: वहाँ बिक्री हमारे VAT पंजीकरण तक रुकी है। आपसे कोई शुल्क नहीं लिया गया।",
  nl: "We kunnen nog niet verkopen aan kopers in de EU, de EER of het VK: verkoop daar wacht tot we voor de btw zijn geregistreerd. Er is niets in rekening gebracht.",
  pt: "Ainda não podemos vender para compradores na UE, no EEE ou no Reino Unido: as vendas lá aguardam nosso registro de IVA. Nada foi cobrado de você.",
  tl: "Hindi pa kami makapagbenta sa mga mamimili sa EU, EEA o UK: hinihintay ng benta roon ang aming VAT registration. Walang siningil sa iyo.",
};

/** HTTP 451: refused for a legal reason, not because anything failed. */
export const TERRITORY_STATUS = 451;

export function territoryAnswer(refusal: TerritoryRefusal, opts: { body?: unknown; acceptLanguage?: string | null }): {
  status: typeof TERRITORY_STATUS;
  body: { error: string; territoryRefused: true; reason: "vat_territory"; signal: TerritorySignal; language: CheckoutLanguage };
} {
  const language = retiredLanguageOf(opts.body ?? null, opts.acceptLanguage);
  return {
    status: TERRITORY_STATUS,
    body: { error: SENTENCE[language] ?? SENTENCE.en, territoryRefused: true, reason: "vat_territory", signal: refusal.signal, language },
  };
}
