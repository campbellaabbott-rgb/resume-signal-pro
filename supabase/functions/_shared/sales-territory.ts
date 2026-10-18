// NO SALE INTO THE EU, THE EEA, THE UK OR INDIA UNTIL OUR TAX REGISTRATION
// THERE IS SETTLED (owner decisions 2026-10-12 and 2026-10-17; S12-059,
// critical-path CP-037).
//
// With the EU/UK switch off (EU_UK_SALES, checkout-policy.ts), a buyer there
// used to check out in euros or pounds with no VAT charged and no withdrawal
// information: the switch only added the waiver and tax when it was on, and
// refused nobody while it was off. India joined the list on 2026-10-17, until
// an accountant rules on GST. Every checkout that still sells (the Full
// Analysis, Pro) now asks this module first, and while the switch is off it
// refuses a buyer the evidence places there, before a Pro grant is refused
// or Stripe is asked for anything. The evidence, in the order it is read:
//
//   - a currency only those places bill in (the page picks it from the
//     buyer's time zone): EUR, GBP, the other EEA currencies and INR;
//   - the page's own time zone (body.timeZone), when it is one of theirs;
//   - a country header the platform set (cf-ipcountry), if one ever arrives;
//   - the trusted address (clientAddressOr), looked up the way the free scan
//     and the lead form already look it up (ipinfo.io with IPINFO_API_KEY),
//     once per /24 (an IPv6 /64) per isolate, with a short timeout.
//
// Every signal can ADD a refusal and none can lift one. A lookup that cannot
// answer refuses nobody. Stripe collects the billing address on every session
// these checkouts mint (withBillingAddress, below), but nothing here reads it:
// it is the record of where a buyer really was, and what the owner's Radar
// rule on the card's country reads. So the refusal names only what this code
// checked (the currency, the time zone, the address lookup), never the
// billing address. Nothing is refunded after the fact (refunds: never, owner
// decision 2026-10-12).
//
// The answer says why in the buyer's language: sales there wait for the tax
// registration, which signal placed the buyer there, and that nothing was
// charged.

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

type Sentences = { lead: string; currency: string; time_zone: string; address: string; tail: string };

const EN: Sentences = {
  lead: "We don't sell to buyers in the EU, the EEA, the UK or India yet: sales there wait until our tax registration there is settled.",
  currency: "This checkout was priced in a currency used there.",
  time_zone: "Your browser's time zone is one of theirs.",
  address: "A lookup of your internet address places you there.",
  tail: "Nothing was charged.",
};

/** Each language's sentences: why, then the one signal that placed the buyer there. */
export const TERRITORY_SENTENCES: Readonly<Record<CheckoutLanguage, Sentences>> = {
  en: EN,
  "en-GB": EN,
  de: {
    lead: "Wir verkaufen noch nicht an Käufer in der EU, im EWR, im Vereinigten Königreich oder in Indien: Verkäufe dort warten, bis unsere steuerliche Registrierung dort geklärt ist.",
    currency: "Dieser Kauf war in einer dort verwendeten Währung ausgepreist.",
    time_zone: "Die Zeitzone deines Browsers liegt dort.",
    address: "Eine Abfrage deiner Internetadresse ordnet dich dort ein.",
    tail: "Dir wurde nichts berechnet.",
  },
  es: {
    lead: "Todavía no vendemos a compradores de la UE, el EEE, el Reino Unido ni la India: las ventas allí esperan a que nuestro registro fiscal allí esté resuelto.",
    currency: "Este pago tenía el precio en una moneda que se usa allí.",
    time_zone: "La zona horaria de tu navegador es de allí.",
    address: "Una consulta de tu dirección de internet te sitúa allí.",
    tail: "No se te ha cobrado nada.",
  },
  fr: {
    lead: "Nous ne vendons pas encore aux acheteurs de l'UE, de l'EEE, du Royaume-Uni ou de l'Inde : les ventes y attendent que notre immatriculation fiscale y soit réglée.",
    currency: "Ce paiement était affiché dans une devise utilisée là-bas.",
    time_zone: "Le fuseau horaire de votre navigateur s'y trouve.",
    address: "Une recherche sur votre adresse internet vous y situe.",
    tail: "Rien ne vous a été facturé.",
  },
  hi: {
    lead: "हम अभी EU, EEA, UK या भारत के खरीदारों को नहीं बेचते: वहाँ बिक्री तब तक रुकी है जब तक वहाँ हमारा कर पंजीकरण तय नहीं हो जाता।",
    currency: "यह भुगतान वहाँ इस्तेमाल होने वाली मुद्रा में था।",
    time_zone: "आपके ब्राउज़र का समय क्षेत्र वहीं का है।",
    address: "आपके इंटरनेट पते की जाँच आपको वहीं बताती है।",
    tail: "आपसे कोई शुल्क नहीं लिया गया।",
  },
  nl: {
    lead: "We verkopen nog niet aan kopers in de EU, de EER, het VK of India: verkoop daar wacht tot onze belastingregistratie daar geregeld is.",
    currency: "Deze betaling was geprijsd in een munt die daar wordt gebruikt.",
    time_zone: "De tijdzone van je browser ligt daar.",
    address: "Een opzoeking van je internetadres plaatst je daar.",
    tail: "Er is niets in rekening gebracht.",
  },
  pt: {
    lead: "Ainda não vendemos para compradores na UE, no EEE, no Reino Unido ou na Índia: as vendas lá aguardam a regularização do nosso registro fiscal lá.",
    currency: "Este pagamento estava com preço numa moeda usada lá.",
    time_zone: "O fuso horário do seu navegador é de lá.",
    address: "Uma consulta do seu endereço de internet indica que você está lá.",
    tail: "Nada foi cobrado de você.",
  },
  tl: {
    lead: "Hindi pa kami nagbebenta sa mga mamimili sa EU, EEA, UK o India: hinihintay ng benta roon na maayos ang aming tax registration doon.",
    currency: "Ang bayad na ito ay nakapresyo sa currency na ginagamit doon.",
    time_zone: "Nasa isa sa mga lugar na iyon ang time zone ng browser mo.",
    address: "Ayon sa pagtingin sa internet address mo, nandoon ka.",
    tail: "Walang siningil sa iyo.",
  },
};

/** The whole sentence for one refusal: why, which signal, nothing charged. */
export function territorySentence(signal: TerritorySignal, language: CheckoutLanguage): string {
  const l = TERRITORY_SENTENCES[language] ?? EN;
  const placed = signal === "currency" ? l.currency : signal === "time_zone" ? l.time_zone : l.address;
  return `${l.lead} ${placed} ${l.tail}`;
}

/** HTTP 451: refused for a legal reason, not because anything failed. */
export const TERRITORY_STATUS = 451;

/**
 * THE BILLING ADDRESS, ON EVERY SESSION A SELLING CHECKOUT MINTS (S12-059).
 * checkout-policy.ts sessionPolicy asks for it only with the EU/UK switch on,
 * for tax. With the switch off it is the record of where a buyer the signals
 * above could not place really is, and what the owner's Radar rule reads;
 * this module never reads it back. Applied by the checkouts that import this
 * module (the Full Analysis and Pro), over sessionPolicy's answer, so the
 * shared policy module and every other function that bundles it are
 * unchanged.
 */
export function withBillingAddress<T extends object>(policy: T): T & { billing_address_collection: "required" } {
  return { ...policy, billing_address_collection: "required" };
}

export function territoryAnswer(refusal: TerritoryRefusal, opts: { body?: unknown; acceptLanguage?: string | null }): {
  status: typeof TERRITORY_STATUS;
  body: { error: string; territoryRefused: true; reason: "tax_territory"; signal: TerritorySignal; language: CheckoutLanguage };
} {
  const language = retiredLanguageOf(opts.body ?? null, opts.acceptLanguage);
  return {
    status: TERRITORY_STATUS,
    body: { error: territorySentence(refusal.signal, language), territoryRefused: true, reason: "tax_territory", signal: refusal.signal, language },
  };
}
