// Rationale: docs/job-board-index-notes.md#n1549-export-experience_bands-from-_shared-boa

// Shared with public-api via ../_shared/board-domains.ts — see that file.
export { EXPERIENCE_BANDS } from "../_shared/board-domains.ts";
import { EXPERIENCE_BANDS } from "../_shared/board-domains.ts";
export type ExperienceBand = typeof EXPERIENCE_BANDS[number];

export function isExperienceBand(x: string): x is ExperienceBand {
  return (EXPERIENCE_BANDS as readonly string[]).includes(x);
}

// Rationale: docs/job-board-index-notes.md#n1550-export-function-bandfromyears-minyears-n
export function bandFromYears(minYears: number): ExperienceBand {
  if (minYears <= 2) return "entry";
  if (minYears <= 5) return "mid";
  if (minYears <= 9) return "senior";
  return "expert";
}

// Rationale: docs/job-board-index-notes.md#n1551-const-wish_words-preferred-preferably-a
const WISH_WORDS = "preferred|preferably|a plus|nice[- ]to[- ]have|desired|desirable|ideally|is an asset|an advantage";
const WISH_ONLY = new RegExp(`^\\(\\s*(?:strongly\\s+|highly\\s+)?(?:${WISH_WORDS})\\s*\\)?$`);
const WISH_FIRST = new RegExp(`^\\s*(?:(?:of\\s+)?(?:[\\w&/'-]+\\s+){0,3}?experience\\s+)?(?:(?:in|within|of)\\s+(?:[\\w&/'-]+\\s+){1,3}?)?\\(?\\s*(?:(?:is|are)\\s+)?(?:strongly\\s+|highly\\s+)?(${WISH_WORDS})\\b`);
const WISH_BEFORE = /\b(?:preferably|ideally)\s+(?:at\s+least\s+|a\s+minimum\s+of\s+)?$|^\s*(?:[-*\u2022\u00b7]\s*)?preferred\s*:?\s*$/;
/** The wish word is followed by where or in what: it names a setting, not the years. */
const ON_A_SETTING = /^\s+(?:in|within|at|on|with|from)\s+\S/;
const BINDS = /\b(?:required|must|mandatory)\b/;
const NOT_REQUIRED = /\b(?:but\s+)?not\s+(?:required|mandatory|a\s+must)\b/g;
const WISH_HEADING = /\b(?:preferred|desired|nice[- ]to[- ]have|bonus)[^\S\n]+(?:qualifications|skills|experience|requirements)\b|^[^\S\n]*(?:preferred|nice[- ]to[- ]have)[^\S\n]*:?[^\S\n]*$/gm;
const NEED_HEADING = /\b(?:required|minimum|basic|essential)[^\S\n]+(?:qualifications|skills|experience|requirements)\b|\brequirements[^\S\n]*:|^[^\S\n]*(?:minimum[^\S\n]+)?(?:requirements|required|qualifications)[^\S\n]*:?[^\S\n]*$/gm;
const lastIndexOf = (re: RegExp, s: string): number => {
  let at = -1;
  re.lastIndex = 0;
  for (let m = re.exec(s); m !== null; m = re.exec(s)) at = m.index;
  return at;
};
function notBinding(t: string, at: number, end: number, before: string): boolean {
  const line = before.slice(before.lastIndexOf("\n") + 1);
  if (/\bor\s+(?:an?\s+)?(?:equivalent\s+(?:of\s+)?)?(?:at\s+least\s+|minimum\s+(?:of\s+)?)?$/.test(line) && !/\d\s*or\s+$/.test(line)) return true;
  const s0 = Math.max(t.lastIndexOf(".", at), t.lastIndexOf(";", at), t.lastIndexOf(",", at), t.lastIndexOf("\n", at), t.lastIndexOf("!", at), t.lastIndexOf("?", at)) + 1;
  const cut = t.slice(end).search(/[.;,!?\n]/);
  const tail = t.slice(end, cut < 0 ? t.length : end + cut).slice(0, 40).split(/\b(?:and|with)\b/)[0];
  const lead = t.slice(Math.max(s0, at - 30), at);
  if (BINDS.test(tail.replace(NOT_REQUIRED, " ")) || BINDS.test(lead.slice(-16).replace(NOT_REQUIRED, " "))) return false;
  const own = tail.replace(/\([^)]*(?:\)|$)/g, (p) => (WISH_ONLY.test(p) ? p : " "));
  const head = t.slice(Math.max(0, at - 3000), at);
  const need = lastIndexOf(NEED_HEADING, head);
  const wish = lastIndexOf(WISH_HEADING, head);
  const binding = need > wish || (wish < 0 && /^\s*(?:[-*\u2022\u00b7]\s*)?(?:required|minimum)\b/.test(t.slice(t.lastIndexOf("\n", at) + 1, at)));
  const first = WISH_FIRST.exec(own);
  if (first) {
    const onSetting = ON_A_SETTING.test(own.slice(first.index + first[0].length));
    if (!onSetting) return true;
    // Rationale: docs/job-board-index-notes.md#n1552-if-preferably-ideally-test-first-return
    if (!/^(?:preferably|ideally)$/.test(first[1])) return !binding;
  }
  if (WISH_BEFORE.test(lead)) return true;
  if (binding) return false;
  return wish > need;
}

// What follows a 16-21 year figure when it is work, not an age (n1420).
const AGE_FOLLOWS_WORK = /^[^.;!?\n]*?\b(?:experience|exp|work|industry|professional|relevant|related|progressive|in\s+(?!age\b)\w|as\s+an?\s)/;

// Rationale: docs/job-board-index-notes.md#n1553-export-function-parseminyears-text-strin
export function parseMinYears(text: string): number | null {
  const t = text.toLowerCase().replace(/[–—]/g, "-"); // en/em dash → hyphen
  const nums: number[] = [];
  // Rationale: docs/job-board-index-notes.md#n1554-const-forward-d-d-s-s
  const forward = /(?<!\d)(\d{1,2})\s*\+?\s*(?:or\s+more\s+)?(?:-\s*\d{1,2}\s*)?years?\b((?:(?!\d{1,2}\s*\+?\s*(?:-\s*\d{1,2}\s*)?years?\b)[^.?!\n]){0,30}?)(?:experience|exp\b|(?<!\bto\s)work|professional|industry|hands-on)/g;
  // "(experience|minimum|at least|requires)[ :of] <n> year(s)"
  const backward = /(?:experience|minimum|at least|requires?|require)\s*(?:of|:|is)?\s*(?<!\d)(\d{1,2})\s*\+?\s*(?:or\s+more\s+)?years?/g;
  for (const re of [forward, backward]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      const n = Number(m[1]);
      const at = m.index + m[0].indexOf(m[1]);
      const end = m.index + m[0].length;
      const before = t.slice(Math.max(0, at - 24), at);
      const gap = m[2] ?? "";
      const after = t.slice(end, end + 16);
      if (notBinding(t, at, end, before)) continue;
      if ((/\bor\s+more\b/.test(m[0]) && /\d\s*to\s*$/.test(before)) || /\bsubstitute\s+for\s+$/.test(before)) continue;
      // Rationale: docs/job-board-index-notes.md#n1555-if-b-of-s-age-old
      if (/\b(?:of\s+age|old|older)\b/.test(gap) || /^\s*-?\s*(?:of\s+age|old\b|or\s+older)/.test(after) || /\b(?:age|aged)\s*(?:of\s*)?$/.test(before)) continue;
      // Rationale: docs/job-board-index-notes.md#n1420-an-age-a-story-and-a-rung
      if (/^\s*ago\b/.test(gap) || (re === backward && /^(?:1[6-9]|2[01])$/.test(m[1]) && !m[0].startsWith("exp") && !AGE_FOLLOWS_WORK.test(t.slice(end, end + 50)))) continue;
      // Rationale: docs/job-board-index-notes.md#n1556-if-b-for-over-nearly-almost
      if (/\b(?:for|over|nearly|almost)\s+(?:more\s+than\s+|over\s+|nearly\s+|almost\s+)?$/.test(before) && !/^\s*of\b/.test(gap)) {
        const s0 = Math.max(t.lastIndexOf(".", at), t.lastIndexOf("!", at), t.lastIndexOf("?", at), t.lastIndexOf("\n", at)) + 1;
        const sentence = t.slice(s0, end);
        if (/^\s*,/.test(gap) || /\b(?:we've|we have|we're|has been|have been|had been|founded|established|in business|since \d{4})\b/.test(sentence)) continue;
      }
      // Rationale: docs/job-board-index-notes.md#n1557-if-number-isfinite-n-n-n
      if (Number.isFinite(n) && n >= 0 && n <= 20) nums.push(n);
    }
  }
  return nums.length ? Math.max(...nums) : null;
}

// Rationale: docs/job-board-index-notes.md#n1558-const-staff_tech-software-data-machine-l
const STAFF_TECH = "software|data|machine learning|ml|ai|product|security|application|applications|site reliability|reliability|platform|backend|back-end|frontend|front-end|full[- ]?stack|systems?|infrastructure|cloud|devops|mobile|ios|android|web|database|research|applied|hardware|firmware|network|engineering|technical|program|ux|ui|qa|quality|test|automation|solutions|embedded|graphics|game|gameplay|compiler|distributed|analytics|performance";
const STAFF_RUNG = new RegExp(`\\bstaff\\s+(?:(?:${STAFF_TECH})\\s+)*(?:engineer|scientist|developer|designer|architect|analyst|researcher|swe|sre)\\b|\\bstaff\\s+(?:(?:${STAFF_TECH})\\s+)+manager\\b`);
const LEAD_NOT_A_RUNG = /\b(?:shift|team|crew|store|line|floor|cashier|sales|retail|warehouse|production|area|key|front end|front desk|kitchen|cook|bar|server)\s+lead\b|\blead\s+(?:cashier|teller|associate|server|cook|host|clerk|driver|custodian|housekeeper|caregiver|cleaner|picker|packer|sales associate)\b/;
const FIRM_PARTNER = /\b(?:managing|equity|senior|founding|general|named)\s+partner\b|\bpartner\s*,\s*(?:law|legal|litigation|corporate|tax|audit|advisory|consulting)\b/;
// Rationale: docs/job-board-index-notes.md#n1559-const-clientele-bsenior-s-living-cent
const CLIENTELE = /\bsenior\s+(?:living|cent(?:er|re)s?|housing|citizens?|residences?|apartments?|day\s+(?:program|services))\b|\bsenior\s+care\b(?!\s*(?:-\s*)?(?:assistant|worker|manager|supervisor|lead|practitioner|officer|coordinator|carer|support worker))|\bsenior\s+(?:communit(?:y|ies)(?!\s+(?:manager|support\s+worker|associate)s?\b)|services)\b/g;
const withoutClientele = (t: string): string =>
  t.replace(CLIENTELE, (m, at: number) => (/^senior\s+(?:communit|services)/.test(m) && at === 0 ? m : " "));

export function bandFromTitle(title: string): ExperienceBand | null {
  const t = withoutClientele(title.toLowerCase());
  if (/\b(chief|ceo|cfo|coo|cto|ciso|cmo|cro|c-level|vp|svp|evp|vice president|head of|director|managing director)\b/.test(t) || FIRM_PARTNER.test(t)) return "expert";
  if (/\b(senior|sr\.?|principal|architect|distinguished)\b/.test(t) || STAFF_RUNG.test(t)) return "senior";
  if (/\blead\b/.test(t) && !LEAD_NOT_A_RUNG.test(t)) return "senior";
  if (/\b(intern|internship|trainee|apprentice|entry[ -]?level|junior|jr\.?|graduate|new grad|early career)\b/.test(t)) return "entry";
  return null;
}

/** A level the employer picked in its ATS (n1421): it fills only what the posting's words leave unsaid. */
export type StatedLevel = { band: ExperienceBand | null; minYears: number | null };
export function detectExperience(
  title: string,
  description?: string | null,
  stated?: StatedLevel | null,
): { band: ExperienceBand | null; minYears: number | null } {
  const rung = bandFromTitle(title);
  const minYears = parseMinYears(`${title}\n${description ?? ""}`);
  // Rationale: docs/job-board-index-notes.md#n1420-an-age-a-story-and-a-rung
  if (minYears != null) return { band: bandFromYears(minYears), minYears };
  const s = stated?.minYears ?? null;
  return { band: rung ?? (s != null ? bandFromYears(s) : stated?.band ?? null), minYears: s };
}
