// WHERE THE VAT TERRITORY IS, AS DATA (sales-territory.ts reads it on the
// server; src/lib/checkout-territory.ts reads it in the page, so the notice a
// buyer sees and the refusal the checkout answers use one list).
//
// NO IMPORTS: the frontend and vitest import this file directly.

/** EU-27, the EEA's three, the UK, and two places inside an EU or UK VAT area under their own code. */
export const VAT_TERRITORY: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT",
  "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO",
  "GB",
  "IM", "MC",
]);

/** Currencies only the territory bills in. CHF is Switzerland's (outside), so it is not here. */
export const TERRITORY_CURRENCIES: ReadonlySet<string> = new Set([
  "eur", "gbp", "sek", "dkk", "nok", "isk", "pln", "czk", "huf", "ron", "bgn",
]);

/** IANA zones inside the territory (canonical names and the aliases browsers still report). */
export const TERRITORY_TIME_ZONES: ReadonlySet<string> = new Set([
  "Europe/Amsterdam", "Europe/Athens", "Europe/Berlin", "Europe/Bratislava", "Europe/Brussels",
  "Europe/Bucharest", "Europe/Budapest", "Europe/Copenhagen", "Europe/Dublin",
  "Europe/Helsinki", "Europe/Lisbon", "Europe/Ljubljana", "Europe/London", "Europe/Belfast",
  "Europe/Luxembourg", "Europe/Madrid", "Europe/Malta", "Europe/Monaco", "Europe/Oslo", "Europe/Paris",
  "Europe/Prague", "Europe/Riga", "Europe/Rome", "Europe/Sofia", "Europe/Stockholm", "Europe/Tallinn",
  "Europe/Vaduz", "Europe/Vienna", "Europe/Vilnius", "Europe/Warsaw", "Europe/Zagreb", "Europe/Isle_of_Man",
  "Europe/Nicosia", "Asia/Nicosia", "Asia/Famagusta",
  "Atlantic/Reykjavik", "Atlantic/Canary", "Atlantic/Madeira", "Atlantic/Azores",
]);
