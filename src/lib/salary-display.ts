// Display-tidying for company-stated salary text. Feeds ship pay strings in
// wildly mixed shapes ("$85,000.00 per year", "$562k–572k/per-year-salary",
// "USD 105,000-135,000 annually"). We NEVER change the numbers — the cleanup
// is purely notational (drop ".00" cents, normalize dash + period wording,
// collapse doubled whitespace) so cards scan consistently. The original text
// stays available for the tooltip.
export function displaySalary(raw: string): string {
  let s = raw.trim();
  // ".00" cents on whole amounts are noise at card size.
  s = s.replace(/(\d),?\.00\b/g, "$1");
  // Feed-specific period suffixes → plain words.
  s = s
    .replace(/\/\s*per[-\s]?year[-\s]?salary\b/gi, "/year")
    .replace(/\/\s*per[-\s]?month[-\s]?salary\b/gi, "/month")
    .replace(/\/\s*per[-\s]?hour[-\s]?(salary|rate)\b/gi, "/hour")
    .replace(/\bper\s+annum\b/gi, "per year")
    .replace(/\bannually\b/gi, "per year")
    .replace(/\bp\.?a\.?\b/g, "per year");
  // Range separators: any dash variant with optional spaces → en dash.
  s = s.replace(/(\d|\bk\b)\s*(?:-|–|—|to)\s*(?=[$€£]?\d)/gi, "$1–");
  // Doubled currency marker ("USD $85,000") — keep the symbol.
  s = s.replace(/\b(USD|EUR|GBP|CAD|AUD)\s*([$€£])/g, "$2");
  return s.replace(/\s{2,}/g, " ").trim();
}
