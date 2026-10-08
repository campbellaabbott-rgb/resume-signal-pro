/**
 * Protected questions: the model never answers these, whatever it drafted.
 *
 * Sweep S8-008. The server's classifier called criminal-history, age,
 * citizenship, salary and medical questions `draftable`, apply-agent had the
 * model draft them, and this worker filled a supported draft into a REQUIRED
 * box because its own patterns did not recognise the label either. The
 * classifier is widened; this is the worker's half, so a packet prepared before
 * that fix (or by a classifier that drifts) still stops here for the candidate.
 *
 * MIRRORED, character for character, from PROTECTED_FACTUAL and
 * PROTECTED_DEMOGRAPHIC in supabase/functions/_shared/application-questions.ts.
 * The worker builds from worker/src alone, so it cannot import that file; a
 * cross-runtime test holds the two sources equal and replays one corpus
 * through both.
 */
export const PROTECTED_FACTUAL = /(convict\w*|felon\w*|misdemeanou?r|criminal\s+(?:case|charge|investigation|history|offen[cs]e|background|proceeding|record)s?|pending\s+(?:criminal\s+)?(?:charges?|cases?)|(?:been|ever\s+been)\s+(?:arrested|charged|convicted|indicted|cautioned)|plead(?:ed)?\s+guilty|drug\s+(?:test|screen)\w*|(?:at\s+least|over|older\s+than|aged?)\s+(?:1[4-9]|2[0-5])\s*(?:years?\s+(?:of\s+age|old)|yrs?\s+old|\?|\)|$)|how\s+old\b|your\s+age\b|minimum\s+age|legal\s+age|\bcitizen\b|permanent\s+resident|green\s+card|immigration|visa\s+(?:status|type|holder|category)|current\s+visa|\bh-?1b\b|\bf-?1\s+(?:visa|status|student)|\bstem\s+opt\b|\bopt\s+(?:status|extension|ead)|\bon\s+opt\b|\bead\b|passport|right\s+to\s+(?:live\s+(?:and|&)\s+)?work|legally\s+(?:able\s+to\s+)?(?:live\s+(?:and|&)\s+)?work|eligible\s+to\s+(?:live\s+(?:and|&)\s+)?work|work\s+rights|residen(?:cy|ce)\s+(?:status|permit)|settled\s+status|indefinite\s+leave|\bwages?\b|hourly\s+(?:rate|pay)|rate\s+of\s+pay|pay\s+(?:rate|range|requirements?)|day\s+rate|\bote\b|\bctc\b|cost\s+to\s+(?:the\s+)?company|remuneration|medical\s+(?:condition|history|exam\w*|issue|reason|restriction|clearance|certificate|questionnaire|leave|assessment)s?|health\s+(?:condition|issue|problem|declaration|questionnaire|assessment)s?|physical(?:ly)?\s+(?:able|capable|fit|exam\w*|requirements?)|pregnan\w*|(?:need|require|request)\w*\s+(?:any\s+|an?\s+)?(?:reasonable\s+)?accommodat\w*|reasonable\s+accommodat\w*|accommodat\w*\s+(?:during|for|in)\s+(?:the\s+)?(?:interview|hiring|application|recruit\w*|selection)|essential\s+functions|vaccinat\w*|(?:able|willing|available|open)\s+to\s+work\s+(?:[\w,/-]+\s+){0,4}?(?:weekends?|nights?|evenings?|overtime|shifts?|holidays?|on[-\s]?call|rotating)\b|(?:can|could|will|would)\s+you\s+(?:be\s+(?:able|willing|available)\s+to\s+)?work\s+(?:[\w,/-]+\s+){0,4}?(?:weekends?|nights?|evenings?|overtime|shifts?|holidays?|on[-\s]?call)\b|which\s+shifts?|shift\s+(?:preference|availability|pattern)s?|your\s+availability|relatives?\s+(?:who\s+)?(?:work|employed|currently)|know\s+(?:anyone|someone)\s+(?:who\s+)?(?:works?|employed|currently)|tax\s+(?:id|identification|number|file\s+number|code|reference)|\btin\b|\bnif\b|\bdni\b|\bnie\b|\bssn\b|social\s+security|national\s+insurance)/i;
export const PROTECTED_DEMOGRAPHIC = /(lgbt\w*|transgender|\btrans\s+(?:man|woman|person)|\bcaste\b|aboriginal|torres\s+strait|\bindigenous\b|first\s+nations|military\s+(?:service|status|spouse|member|background|affiliation)|served\s+in\s+the\s+(?:military|armed\s+forces)|armed\s+forces|\bage\s+(?:range|group|bracket|band))/i;

/** True when a prepared (model-written) draft must not answer this label. */
export function isProtectedQuestion(label: string): boolean {
  const l = String(label ?? "").replace(/\s+/g, " ").trim();
  return PROTECTED_FACTUAL.test(l) || PROTECTED_DEMOGRAPHIC.test(l);
}
