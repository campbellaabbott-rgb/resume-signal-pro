// Salary mining: extract a pay range from a posting's own description text.
// Pay-transparency laws mean many postings embed the range as prose even when
// the ATS feed has no structured salary field — this recovers it HONESTLY: the
// returned string is the company's own verbatim text (whitespace-collapsed),
// never a reformatting or an estimate, and extraction is deliberately
// conservative (clear ranges, or a single figure tied to a pay period) so a
// bonus/stipend figure is never presented as compensation.

const K = 1_000;

// "$120,000", "$120k", "€50.000", "£45,000", "$55.50"
const MONEY = String.raw`[$€£]\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?\s?[kK]?`;
// dash/to between two figures
const RANGE_SEP = String.raw`\s*(?:-|–|—|to|through)\s*`;
// pay-period wording that ties a figure to compensation
const PERIOD = String.raw`(?:per\s+(?:hour|year|annum|month|week)|an?\s+(?:hour|year)|hourly|annually|yearly|monthly|\/\s?(?:hr|hour|yr|year|mo|month|wk|week))`;

const RANGE_RE = new RegExp(`(${MONEY})${RANGE_SEP}(${MONEY})(\\s*${PERIOD})?`, "i");
const SINGLE_RE = new RegExp(`(${MONEY})(\\s*${PERIOD})`, "i");

// Figures near these words are one-offs, not compensation.
const NOT_PAY = /bonus|sign[- ]?on|stipend|reimburse|referral|allowance|credit|deposit|discount|401|gift/i;

function parseMoney(raw: string): number | null {
  const k = /k\s*$/i.test(raw.trim());
  const digits = raw.replace(/[^0-9.,]/g, "");
  // Disambiguate thousand vs decimal separators: a trailing group of 1-2 digits
  // after . or , is decimal; groups of 3 are thousands ("50.000" = 50000).
  let normalized = digits;
  const m = digits.match(/^(\d{1,3}(?:[.,]\d{3})*)(?:[.,](\d{1,2}))?$/);
  if (m) normalized = m[1].replace(/[.,]/g, "") + (m[2] ? `.${m[2]}` : "");
  else normalized = digits.replace(/,/g, "");
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return k ? n * K : n;
}

function plausible(lo: number, hi: number, hourly: boolean): boolean {
  if (lo <= 0 || hi < lo) return false;
  if (hi / Math.max(lo, 1) > 5) return false; // absurd spread = not a pay range
  if (hourly) return lo >= 7 && hi <= 500;
  // annual/monthly/unlabeled magnitudes: a real salary figure
  return lo >= 10_000 && hi <= 2_000_000;
}

/** Extract the posting's own pay text, or null when nothing clearly stated. */
export function extractSalary(text: string | null | undefined): string | null {
  if (!text) return null;
  const hay = text.slice(0, 12_000).replace(/\s+/g, " ");

  const range = hay.match(RANGE_RE);
  if (range && range.index !== undefined) {
    const ctx = hay.slice(Math.max(0, range.index - 40), range.index + range[0].length + 20);
    if (!NOT_PAY.test(ctx)) {
      const lo = parseMoney(range[1]);
      const hi = parseMoney(range[2]);
      const hourly = /hour|hr|hourly/i.test(range[3] ?? "") ||
        (lo !== null && hi !== null && lo < 1_000 && hi < 1_000 && !/[kK]\s*$/.test(range[1] + range[2]));
      if (lo !== null && hi !== null && plausible(lo, hi, hourly)) {
        return range[0].replace(/\s+/g, " ").trim().slice(0, 200);
      }
    }
    // A money range matched but failed the pay guards (bonus context, absurd
    // spread, wage-floor). The text is ambiguous — do NOT let the single-figure
    // fallback cherry-pick one end of a rejected range. Conservative null.
    return null;
  }

  // Single figure only when explicitly tied to a pay period ("$95,000 per year").
  const single = hay.match(SINGLE_RE);
  if (single && single.index !== undefined) {
    const ctx = hay.slice(Math.max(0, single.index - 40), single.index + single[0].length + 20);
    if (!NOT_PAY.test(ctx)) {
      const v = parseMoney(single[1]);
      const hourly = /hour|hr|hourly/i.test(single[2]);
      if (v !== null && plausible(v, v, hourly)) {
        return single[0].replace(/\s+/g, " ").trim().slice(0, 200);
      }
    }
  }
  return null;
}
