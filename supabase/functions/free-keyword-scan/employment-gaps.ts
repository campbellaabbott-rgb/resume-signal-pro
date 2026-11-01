/**
 * EMPLOYMENT GAPS AND RÉSUMÉ RECENCY, READ FROM THE DATES (register S10-007).
 *
 * The scan's pre-check sorted the date ranges newest-first (its comparator
 * returned b − a), took the earliest end date as "the most recent", and
 * compared each role with the one after it in that order. Someone laid off
 * two months ago was told "most recent role ended ~117 months ago", a real
 * 19-month gap went unreported, and the prompt was told both were
 * "confirmed from resume dates". "To date", "Till date", "Présent", "heute",
 * "actualidad" and "attuale" were not read as a current role at all, and
 * "05/2019 - 08/2022" was not read as a range.
 *
 * Here:
 *   - every dated range on the page counts as time accounted for, a degree
 *     or a course as much as a job: a recruiter does not call study a gap,
 *     and a new graduate is not "stale";
 *   - ranges are sorted oldest-first and a gap is measured from the latest
 *     end seen so far, so an overlapping role cannot open a false gap;
 *   - a year without a month starts in January and ends in December, so
 *     "2015 – 2017" then "2018 – 2020" is no gap: the page does not say;
 *   - a range that ends in the future ("Expected 2027") ends today.
 * When the dates do not say, nothing is claimed.
 */

export interface DatePoint { year: number; month: number }

export interface EmploymentGap {
  startDate: string;   // e.g. "Jan 2022"
  endDate: string;     // e.g. "Mar 2023"
  gapMonths: number;
  between: [string, string]; // the lines on each side
}

export interface GapAnalysis {
  gaps: EmploymentGap[];
  mostRecentEndYear: number | null;
  mostRecentEndMonth: number | null;
  isStale: boolean;       // the latest range ended > 18 months ago and none is current
  staleDuration: string;  // e.g. "~26 months"
}

export interface DatedRange { start: DatePoint; end: DatePoint | 'present'; line: string }

// Month names in the languages the scan reads (en, es, fr, de, pt, nl, it),
// keyed by a prefix long enough to be unambiguous.
const MONTHS: Array<[RegExp, number]> = [
  [/^(?:jan(?:uary|vier|eiro|uari|uar)?|ene(?:ro)?|gen(?:naio)?|janv)$/, 0],
  [/^(?:feb(?:ruary|rero|braio|ruari|ruar)?|f[ée]v(?:rier)?|fev(?:ereiro)?)$/, 1],
  [/^(?:mar(?:ch|zo|ço|s)?|m[äa]r(?:z)?|maart)$/, 2],
  [/^(?:apr(?:il|ile)?|abr(?:il)?|avr(?:il)?)$/, 3],
  [/^(?:may|mayo|mai|maio|mei|mag(?:gio)?)$/, 4],
  [/^(?:jun(?:e|io|i|ho)?|juin|giu(?:gno)?)$/, 5],
  [/^(?:jul(?:y|io|i|ho)?|juil(?:let)?|lug(?:lio)?)$/, 6],
  [/^(?:aug(?:ust|ustus)?|ago(?:sto)?|ao[uû]t?|août)$/, 7],
  [/^(?:sep(?:t|tember|tiembre|tembre)?|set(?:embro|tembre)?)$/, 8],
  [/^(?:oct(?:ober|ubre|obre)?|okt(?:ober)?|out(?:ubro)?|ott(?:obre)?)$/, 9],
  [/^(?:nov(?:ember|iembre|embre|embro)?)$/, 10],
  [/^(?:dec(?:ember)?|dic(?:iembre|embre)?|d[ée]c(?:embre)?|dez(?:ember|embro)?)$/, 11],
];
const MONTH_WORD = String.raw`[A-Za-zÀ-ÿ]{3,10}\.?`;

// A month and year ("Jan 2020", "janvier 2020", "Sept. 2019"), a numeric month
// and year ("05/2019", "05-2019", "05.2019"), year then month ("2019-05",
// "2019/05"), or a bare year. A two-digit year is never read: "05/19" could be
// May 2019 or the 19th of May.
const TOKEN = String.raw`(?:${MONTH_WORD}\s+(?:de\s+)?(?:19|20)\d\d|\d{1,2}[\/.\-](?:19|20)\d\d|(?:19|20)\d\d[\/\-]\d{1,2}(?![\d\/.]|-(?!(?:19|20)\d\d|\p{L}))|(?:19|20)\d\d)`;
// Words for "still in this role", in the languages the scan reads.
const PRESENT = String.raw`(?:present|current(?:ly)?|now|today|to\s+date|till\s+date|until\s+now|ongoing|pr[ée]sent|aujourd['’]hui|heute|aktuell|actualidad|actual|actualmente|presente|attuale|atual|atualmente|heden)`;
const SEP = String.raw`\s*(?:[–—−-]+|to|until|till|bis|au|à|a|al|hasta|tot)\s*`;
// A degree still under way: "May 2025 – Expected Jun 2027".
const EXPECTED = String.raw`(?:(?:expected|anticipated|exp\.|est\.|pr[ée]vu|voraussichtlich|previsto|prevista)\s+)?`;
const RANGE_RE = new RegExp(String.raw`(?<![\p{L}\p{N}\/.])(${TOKEN})${SEP}${EXPECTED}(${TOKEN}|${PRESENT})(?![\p{L}\p{N}])`, 'giu');
const PRESENT_ONLY = new RegExp(String.raw`^${PRESENT}$`, 'iu');

function monthOf(word: string): number | undefined {
  const w = word.toLowerCase().replace(/\.$/, '');
  for (const [re, n] of MONTHS) if (re.test(w)) return n;
  return undefined;
}

/** One date token, read as the start (`edge: 'start'`) or end of a range. */
export function parseDateToken(raw: string, edge: 'start' | 'end'): DatePoint | null {
  const t = raw.trim();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^([A-Za-zÀ-ÿ]{3,10})\.?\s+(?:de\s+)?((?:19|20)\d\d)$/))) {
    const month = monthOf(m[1]);
    if (month === undefined) return null; // "Summer 2019", "Class 2019": not a month
    return { year: Number(m[2]), month };
  }
  if ((m = t.match(/^(\d{1,2})[\/.\-]((?:19|20)\d\d)$/))) {
    const month = Number(m[1]) - 1;
    return month >= 0 && month < 12 ? { year: Number(m[2]), month } : null;
  }
  if ((m = t.match(/^((?:19|20)\d\d)[\/\-](\d{1,2})$/))) {
    const month = Number(m[2]) - 1;
    return month >= 0 && month < 12 ? { year: Number(m[1]), month } : null;
  }
  if ((m = t.match(/^((?:19|20)\d\d)$/))) return { year: Number(m[1]), month: edge === 'start' ? 0 : 11 };
  return null;
}

const key = (d: DatePoint) => d.year * 12 + d.month;
const monthsBetween = (a: DatePoint, b: DatePoint) => key(b) - key(a);
const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const formatDatePoint = (d: DatePoint) => `${NAMES[d.month]} ${d.year}`;

/** Every "start – end" range on the page, with the line it sits on. */
export function extractDateRanges(resumeText: string): DatedRange[] {
  const ranges: DatedRange[] = [];
  for (const rawLine of resumeText.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    RANGE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RANGE_RE.exec(line)) !== null) {
      const start = parseDateToken(m[1], 'start');
      // "Summer 2019 – 2020": no month in "Summer"; read on from the next
      // character so "2019 – 2020" is still found.
      if (!start) { RANGE_RE.lastIndex = m.index + 1; continue; }
      if (PRESENT_ONLY.test(m[2].trim())) { ranges.push({ start, end: 'present', line: line.slice(0, 60) }); continue; }
      const end = parseDateToken(m[2], 'end');
      if (!end || key(end) < key(start)) continue; // an end before its start is not a range we can read
      ranges.push({ start, end, line: line.slice(0, 60) });
    }
  }
  return ranges;
}

export function detectEmploymentGaps(resumeText: string, now: Date = new Date()): GapAnalysis {
  const today: DatePoint = { year: now.getFullYear(), month: now.getMonth() };
  const none: GapAnalysis = { gaps: [], mostRecentEndYear: null, mostRecentEndMonth: null, isStale: false, staleDuration: '' };
  const ranges = extractDateRanges(resumeText);
  if (ranges.length < 2) return none;

  const entries = ranges
    .filter(r => key(r.start) <= key(today)) // a range that has not started yet accounts for nothing
    .map(r => {
      const isPresent = r.end === 'present' || key(r.end) > key(today);
      return { start: r.start, end: isPresent ? today : r.end as DatePoint, isPresent, line: r.line };
    })
    .sort((a, b) => key(a.start) - key(b.start) || key(a.end) - key(b.end));
  if (entries.length < 2) return none;

  let latest = entries[0];
  for (const e of entries) if (key(e.end) > key(latest.end)) latest = e;
  const hasPresent = entries.some(e => e.isPresent);

  let isStale = false;
  let staleDuration = '';
  if (!hasPresent) {
    const staleMonths = monthsBetween(latest.end, today);
    if (staleMonths > 18) { isStale = true; staleDuration = `~${staleMonths} months`; }
  }

  // Oldest first, against the latest end so far: a role that overlaps another
  // cannot open a gap the other one covers.
  const gaps: EmploymentGap[] = [];
  let cover = entries[0];
  for (const next of entries.slice(1)) {
    const gapMonths = monthsBetween(cover.end, next.start);
    if (gapMonths > 6) {
      gaps.push({ startDate: formatDatePoint(cover.end), endDate: formatDatePoint(next.start), gapMonths, between: [cover.line, next.line] });
    }
    if (key(next.end) > key(cover.end)) cover = next;
  }

  return { gaps, mostRecentEndYear: latest.end.year, mostRecentEndMonth: latest.end.month, isStale, staleDuration };
}
