/**
 * DOES A BULLET CARRY A NUMBER THAT MEASURES SOMETHING? (register S10-006)
 *
 * The scan's QUANT_PATTERN wanted the unit pressed against the digits and a
 * word character after it: "40%", "25 hours", "team of 12", "50+ clients" and
 * "15 employees" all read as having no number. The strongest résumés got the
 * most wrong advice: a low quantification rate in the prompt, their best
 * metric bullets listed as unquantified, and the "add numbers" quick win.
 *
 * A bullet counts when a number in it measures something:
 *   - a percentage: "40%", "40 %", "30 percent";
 *   - money: "$2M", "£40,000", "€1.2 million", "USD 500";
 *   - a scale: "3 million", "1bn", and "10k"/"2.5M" beside what they size
 *     ("10k followers", "a 2M budget", "1M+");
 *   - a floor: "50+ clients";
 *   - a multiplier: "3x pipeline" (not "4x4");
 *   - a group size: "team of 12", "staff of 6", "12-person team";
 *   - a count or a span: a number followed, within two words, by what it
 *     counts ("25 hours", "15 employees", "12 direct reports", "200 orders").
 * What is not a measurement stays out: a year ("since 2019"), a product
 * version ("Office 365", "Windows 10"), a schedule ("24/7"), a standard
 * ("ISO 9001"). When unsure, a bullet is not called quantified: that would
 * hide the advice it needs.
 */

const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
// Where a measuring number may start: not glued to a word or a decimal ("H1",
// "v2.5"), and not after a letter and a hyphen, which makes it part of a name
// ("DD-214 Member-4 Form", "EEO-2", "COVID-19").
const EDGE = String.raw`(?<![\p{L}\p{N}.])(?<!\p{L}-)`;

const PERCENT = new RegExp(String.raw`${EDGE}${NUM}\s?(?:%|percent\b|per cent\b|pct\b)`, 'iu');
const MONEY = new RegExp(String.raw`(?:[$£€¥₹]\s?${NUM}|\b(?:usd|eur|gbp|cad|aud|inr)\s?${NUM}|${EDGE}${NUM}\s?(?:usd|eur|gbp|dollars|euros|pounds)\b)`, 'iu');
const SCALE_WORD = new RegExp(String.raw`${EDGE}${NUM}\s?(?:million|billion|thousand|trillion|mn|bn)\b`, 'iu');
// "10k", "2.5M": a letter scale counts beside what it measures ("10k
// followers", "a 2M budget") or with a "+" ("1M+"). Alone it is as often a
// name ("3M", "401k", "4K") as a size.
const SCALE_LETTER = new RegExp(String.raw`${EDGE}${NUM}(?:k|m|b)(?:\+|\s+(?:[\p{L}][\p{L}'-]*\s+){0,2}?(?:__UNITS__|revenue|arr|mrr|sales|savings|funding|pipeline|budget|bookings|gmv|aum|assets|spend|costs?|value)(?:e?s)?(?![\p{L}\p{N}]))`, 'iu');
const FLOOR = new RegExp(String.raw`${EDGE}${NUM}\+`, 'u');
const MULTIPLIER = new RegExp(String.raw`${EDGE}${NUM}\s?x(?![\p{L}\p{N}])`, 'iu');
const GROUP = new RegExp(String.raw`\b(?:team|staff|group|crew|department|portfolio|caseload|book|pipeline|network|fleet|base)\s+of\s+(?:over\s+|more than\s+|about\s+|nearly\s+|almost\s+|~)?${NUM}\b|${EDGE}${NUM}[-\s](?:person|member|people|strong|seat|bed|store|site|location)\b`, 'iu');

// What a number can count or span. Plurals are matched with an optional "s";
// the list is the things résumé bullets measure, not every noun.
const UNITS = [
  'employee', 'people', 'person', 'staff', 'member', 'report', 'hire', 'intern', 'volunteer',
  'engineer', 'developer', 'designer', 'analyst', 'nurse', 'agent', 'rep', 'representative', 'associate',
  'manager', 'technician', 'teacher', 'tutor', 'contractor', 'consultant', 'specialist', 'worker', 'driver',
  'user', 'customer', 'client', 'account', 'patient', 'student', 'learner', 'guest', 'visitor', 'attendee',
  'participant', 'subscriber', 'follower', 'member', 'lead', 'prospect', 'buyer', 'seller', 'tenant', 'family', 'families',
  'deal', 'project', 'program', 'programme', 'campaign', 'product', 'feature', 'release', 'launch', 'initiative',
  'order', 'transaction', 'ticket', 'case', 'claim', 'call', 'request', 'application', 'contract', 'proposal', 'grant',
  'store', 'site', 'location', 'branch', 'office', 'region', 'country', 'countries', 'state', 'city', 'cities', 'market',
  'vendor', 'supplier', 'partner', 'brand', 'sku', 'unit', 'item', 'shipment', 'delivery', 'deliveries', 'route', 'truck', 'vehicle',
  'server', 'microservice', 'endpoint', 'api', 'database', 'pipeline', 'dashboard',
  'page', 'article', 'post', 'video', 'email', 'newsletter', 'event', 'workshop', 'session', 'course', 'class', 'classes', 'lesson',
  'bed', 'room', 'property', 'properties', 'home', 'building', 'facility', 'facilities', 'school', 'hospital', 'clinic', 'department',
  'download', 'install', 'visit', 'view', 'impression', 'click', 'signup', 'sign-up', 'conversion', 'booking', 'reservation',
  'hour', 'hr', 'day', 'week', 'wk', 'month', 'year', 'yr', 'minute', 'min', 'second', 'sec', 'quarter', 'shift', 'semester',
  'sale', 'dollar', 'point', 'basis point', 'bps', 'language', 'team', 'mile', 'kilometre', 'kilometer', 'km', 'pound', 'lb', 'kg', 'ton', 'tonne', 'credit', 'unit',
];
const UNIT_ALT = [...new Set(UNITS)].sort((a, b) => b.length - a.length).map(u => u.replace(/[-]/g, '[-\\s]?')).join('|');
const SCALE_LETTER_RE = new RegExp(SCALE_LETTER.source.replace('__UNITS__', UNIT_ALT), SCALE_LETTER.flags);
// A number, then up to two words (an adjective or two: "12 direct reports",
// "15 full-time employees", "4 or more years"), then what it counts. A bare
// 19xx/20xx is a year, not a count, unless a comma marks it as a quantity.
const COUNT = new RegExp(
  String.raw`(?<![\p{L}\p{N}.,/#])(?<![\p{L}]-)(?!(?:19|20)\d\d(?![\d,]))(${NUM})\)?(?![\d/])(?:\s+((?:[\p{L}][\p{L}'-]*\s+){0,2}?)|())(${UNIT_ALT})(?:e?s)?(?![\p{L}\p{N}])`,
  'giu',
);
// The words between a number and its unit may not be glue ("3.0 and Point",
// "6988 or via email"), except "or more" and its kin.
const GLUE = /^(?:and|or|of|in|for|to|the|a|an|with|at|on|by|from|per|as|via|than|is|are|was|were)$/i;
// A number right after one of these names a level or a label, it counts
// nothing: "Tier 2 analysts", "Title 5 service", "Level 3 support".
const LABEL_WORD = /^(?:tier|level|grade|title|step|phase|section|chapter|version|gen|generation|series|type|stage|rank|no|number|route|room|suite|floor|gate|exit|page|band|class|category|unit|building|highway|interstate|lot)$/i;
const isCapitalised = (w: string) => /^\p{Lu}\p{Ll}/u.test(w);
const isAcronym = (w: string) => /^\p{Lu}{2,}$/u.test(w);

function countEvidence(text: string): string | null {
  const shouting = text === text.toUpperCase();
  COUNT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COUNT.exec(text)) !== null) {
    const before = text.slice(0, m.index);
    const prevWord = before.match(/([\p{L}][\p{L}'.-]*)\s*$/u)?.[1] ?? '';
    const sentenceStart = !/[\p{L}\p{N}]/u.test(before.replace(/[\p{L}][\p{L}'.-]*\s*$/u, '').split(/[.!?;:•\n]\s*/u).pop() ?? '');
    // A number right after a name is part of the name: "Fortune 500",
    // "Office 365", "Top 50", "ISO 9001", "SB 1162". The first word of a
    // sentence is capitalised for another reason ("Managed 15 employees").
    if (prevWord && LABEL_WORD.test(prevWord.replace(/\.$/, ''))) continue;
    if (!shouting && prevWord && !sentenceStart && (isCapitalised(prevWord) || isAcronym(prevWord))) continue;
    // Pressed against the digits only a short unit reads ("4hrs", "6wk",
    // "25kg"); "5G" or "4K" is not a count.
    if (m[3] !== undefined && !/^(?:hrs?|wks?|yrs?|mins?|secs?|kg|km|lbs?)$/i.test(m[4])) continue;
    // A singular possessive names a kind, not a count: "a valid 5 driver's
    // licence" is a licence class.
    if (/^['’]s\b/u.test(text.slice(m.index + m[0].length))) continue;
    const between = (m[2] ?? '').trim() ? m[2].trim().split(/\s+/) : [];
    const orMore = /^or\s+(?:more|fewer|less)$/i.test(between.join(' '));
    if (!orMore && between.some(w => GLUE.test(w))) continue;
    // Capitalised words around it are a name too: "301 West State Street".
    if (!shouting && [...between, m[4]].some(isCapitalised)) continue;
    return m[0];
  }
  return null;
}

/** Which rule found a measurement, and the words it read (for the corpus and tests). */
export function metricEvidence(text: string): { rule: string; match: string } | null {
  for (const [rule, re] of [['percent', PERCENT], ['money', MONEY], ['scale', SCALE_WORD], ['scale', SCALE_LETTER_RE], ['floor', FLOOR], ['multiplier', MULTIPLIER], ['group', GROUP]] as const) {
    const m = text.match(re);
    if (m) return { rule, match: m[0] };
  }
  const count = countEvidence(text);
  return count ? { rule: 'count', match: count } : null;
}

/** True when the text carries a number that measures something (see above). */
export function hasMetric(text: string): boolean {
  return metricEvidence(text) !== null;
}
