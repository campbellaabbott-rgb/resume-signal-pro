/**
 * THE MARKETS THE SCANNER HAS STANDARDS FOR (S14X-032), as {iso, name}.
 *
 * The "Applying in" select offered 24 hand-picked countries while the scanner
 * keeps CV standards for every market in COUNTRY_STANDARDS
 * (supabase/functions/free-keyword-scan/country-standards.ts), so a reader
 * from a CV standards page for Peru, Kenya or Vietnam could not pick their
 * own market. This list names every one of them; the select shows each name
 * in the reader's language (Intl.DisplayNames) with the English name as the
 * fallback. It is a list of its own, not an import of the standards file, so
 * the scanner page does not ship that file; a test holds the two equal.
 */
export interface ScanMarket { iso: string; name: string }

const MARKETS: ReadonlyArray<readonly [string, string]> = [
  ["US", "United States"],
  ["CA", "Canada"],
  ["MX", "Mexico"],
  ["BR", "Brazil"],
  ["AR", "Argentina"],
  ["CL", "Chile"],
  ["CO", "Colombia"],
  ["PE", "Peru"],
  ["GB", "United Kingdom"],
  ["IE", "Ireland"],
  ["FR", "France"],
  ["DE", "Germany"],
  ["AT", "Austria"],
  ["CH", "Switzerland"],
  ["NL", "Netherlands"],
  ["BE", "Belgium"],
  ["ES", "Spain"],
  ["PT", "Portugal"],
  ["IT", "Italy"],
  ["GR", "Greece"],
  ["SE", "Sweden"],
  ["NO", "Norway"],
  ["DK", "Denmark"],
  ["FI", "Finland"],
  ["PL", "Poland"],
  ["CZ", "Czechia"],
  ["UA", "Ukraine"],
  ["RU", "Russia"],
  ["TR", "Turkey"],
  ["AE", "United Arab Emirates"],
  ["SA", "Saudi Arabia (GCC)"],
  ["IL", "Israel"],
  ["EG", "Egypt"],
  ["ZA", "South Africa"],
  ["NG", "Nigeria"],
  ["KE", "Kenya"],
  ["IN", "India"],
  ["PK", "Pakistan"],
  ["BD", "Bangladesh"],
  ["CN", "China"],
  ["JP", "Japan"],
  ["KR", "South Korea"],
  ["HK", "Hong Kong"],
  ["TW", "Taiwan"],
  ["SG", "Singapore"],
  ["MY", "Malaysia"],
  ["ID", "Indonesia"],
  ["TH", "Thailand"],
  ["VN", "Vietnam"],
  ["PH", "Philippines"],
  ["AU", "Australia"],
  ["NZ", "New Zealand"],
];

export const SCAN_MARKETS: ReadonlyArray<ScanMarket> = MARKETS.map(([iso, name]) => ({ iso, name }));

/** The ISO code when it is one of the scanner's markets (any case), else null. */
export function scanMarketFor(code: string | null | undefined): string | null {
  const iso = String(code ?? "").trim().toUpperCase();
  return SCAN_MARKETS.some((m) => m.iso === iso) ? iso : null;
}

/** A market's name in the reader's language, or its English name. */
export function scanMarketName(iso: string, lang: string): string {
  const english = SCAN_MARKETS.find((m) => m.iso === iso)?.name ?? iso;
  try {
    const said = new Intl.DisplayNames([lang, "en"], { type: "region" }).of(iso);
    return said && said !== iso ? said : english;
  } catch {
    return english;
  }
}

/** The select's options in the reader's language, sorted by what they read. */
export function scanMarketOptions(lang: string): Array<{ value: string; label: string }> {
  const options = SCAN_MARKETS.map((m) => ({ value: m.iso, label: scanMarketName(m.iso, lang) }));
  let collator: Intl.Collator | null = null;
  try { collator = new Intl.Collator(lang); } catch { collator = null; }
  return options.sort((a, b) => (collator ? collator.compare(a.label, b.label) : a.label.localeCompare(b.label)));
}
