// Classifier for job-application form questions — the honesty core of the apply
// agent. It decides which questions an AI may draft an answer for (substantive,
// resume-grounded free-text) and which it must NEVER touch:
//   - identity/contact  → autofilled from the user's profile, not written by AI
//   - file uploads       → the resume/cover-letter attachments
//   - demographic/EEO    → the candidate's own to disclose; auto-answering is
//                          inappropriate and can be non-compliant
//   - factual/status     → work authorization, sponsorship, salary, start date,
//                          relocation — NOT derivable from a resume, so an AI would
//                          have to guess. We refuse; the user fills these in.
//   - consent/attestation → "I have read and agree to the privacy notice". A
//                          statement about something THE CANDIDATE DID. See below.
// Only "draftable" questions get a grounded AI draft. Pure + unit-tested.

export type QuestionClass =
  | "identity" | "file" | "demographic" | "factual" | "consent" | "draftable";

export interface AppQuestion {
  label: string;
  required?: boolean;
  /** normalized field type, e.g. "input_text" | "textarea" | "input_file" */
  type?: string;
}

// Unambiguous identity tokens ("Secondary contact number" was a live miss,
// 2026-08-01): nobody writes an essay containing "linkedin" or "postal code".
const IDENTITY = /\b(first\s*name|last\s*name|full\s*name|legal\s*name|preferred\s*name|middle\s*name|e-?mail|phone|mobile|telephone|contact\s*number|street|zip|postal|linkedin|github|portfolio|personal\s*website|twitter|url)\b/i;

/**
 * An IDENTITY token in an essay is not a field (S8-044: "mobile app
 * development" got the phone). contactLabelIsAField decides; the worker's
 * matcher carries the same block, so the sheet and the sender agree.
 */
const SOMEONE_ELSES_CONTACT = /\b(emergency|next\s+of\s+kin|reference|referee|manager|supervisor|spouse|parent|guardian|recruiter|referr\w*)\b/i;
// ── CONTACT FIELD OR ESSAY: one rule, byte-identical in worker/src/questions/match.ts and supabase/functions/_shared/application-questions.ts ──
// A contact pattern is an ordinary word ("address a conflict", "mobile app
// development"), so it counts only on a label that IS a field: one that says
// whose detail it wants, one that opens with the detail and then ends or gives
// a hint ("Phone number (include area code)", "Phone number where we can reach
// you"), or a short label ending on it. Never a question, a prose prompt, or
// somebody else's detail. A long-text control does not make a bare field
// ("Phone", "LinkedIn") prose; on one, only the shortest labels count by their
// last word. Rationale: docs/wave3/agents-api.md.
const CF_PROSE = /^\s*(?:please\s+)?(?:describe|tell|explain|share|walk|discuss|elaborate|outline|how|why|what\s+(?:experience|is\s+your\s+experience))\b/i;
const CF_QUESTION = /^\s*(?:do|does|did|are|is|have|has|can|could|will|would|was|were)\b/i;
const CF_SOMEONE_ELSE = /\b(emergency|next\s+of\s+kin|reference|referee|manager|supervisor|spouse|parent|guardian|recruiter|referr\w*)\b/i;
const CF_OWN =
  /\byour\s+(?:(?:current|home|residential|full|postal|mailing|permanent|primary|personal|mobile|cell|contact|best|preferred)\s+)*(?:e-?mail|phone|mobile|cell|telephone|contact\s+number|address|linkedin|github|twitter|website|portfolio|zip|post(?:al)?\s*code|city|town)\b|linkedin\s+(?:profile\s+)?(?:url|link|profile)|(?:profile|portfolio|website|github)\s+(?:url|link)|\bwhich\s+(?:city|town)\b|(?:city|town)\s+of\s+residence/i;
const CF_HEAD =
  /^\s*(?:(?:home|mobile|cell|primary|secondary|personal|best|preferred|daytime|work|current|permanent|mailing|postal|residential|street|contact|legal)\s+)*(?:e-?mail(?:\s+address)?|phone(?:\s+number)?|mobile(?:\s+(?:phone|number))?|cell(?:\s+phone)?(?:\s+number)?|telephone(?:\s+number)?|contact\s+(?:phone\s+)?number|address(?:\s+(?:line\s*)?\d)?|street|linkedin(?:\s+(?:profile|url|link))*|github(?:\s+(?:profile|url|link))*|twitter(?:\s+handle)?|website|portfolio(?:\s+(?:url|link|website))?|zip(?:\s+code)?|post(?:al)?\s*code|city|(?:(?:full|first|last|middle|given|family|preferred)\s+)+name)\s*(?:$|[(\[:,;*?]|[–—]|\s-\s|\s(?:where|we|for|so|that)\b)/i;
const CF_TAIL = /(?:e-?mail|phone|telephone|number|address|linkedin|github|twitter|website|portfolio|url|link|profile|code|zip|city|town|name|handle)$/i;
export function contactLabelIsAField(label: string, fieldType: string): boolean {
  if (CF_SOMEONE_ELSE.test(label)) return false;
  if (CF_OWN.test(label)) return true;
  if (CF_PROSE.test(label) || CF_QUESTION.test(label)) return false;
  if (CF_HEAD.test(label)) return true;
  const type = fieldType.toLowerCase();
  const most = type.includes("textarea") || type === "longtext" ? 3 : 6;
  const words = label.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);
  return words.length > 0 && words.length <= most && CF_TAIL.test(words[words.length - 1]!);
}
// ── end of the contact-field rule ──

// Ordinary nouns that are identity only on a FIELD: "Describe a time you
// coordinated with ... country partners" once got the profile's country.
const IDENTITY_IF_FIELD = /\b(city|state|province|country|address|website|location)\b/i;
// "your city" is the candidate's own; "country partners" is not.
const OWN_ATTRIBUTE = /\byour\s+(?:current\s+|home\s+|primary\s+)?(?:city|state|province|country|address|website|location)\b/i;
const FILE = /\b(resume|résumé|cv|cover\s*letter|upload|attach|transcript|portfolio\s*file)\b/i;
// Protected/voluntary self-ID — never auto-answered. Stems match suffixed forms
// ("disability", "pronouns") so no trailing word-boundary can slip them through.
const DEMOGRAPHIC = /\b(gender|sex|race|ethnic\w*|hispanic|latin[ox]|veteran|disab\w*|sexual\s+orientation|pronoun\w*|date\s+of\s+birth|marital|religio\w*|nationalit\w*|citizenship|national\s+origin)/i;

/**
 * CONSENT AND ATTESTATION (2026-08-03, measured on live forms): "Please confirm
 * you've read our Privacy Notice" was draftable, so a model was about to
 * attest that the person read a document, a false statement in their name.
 * Every branch is anchored to a harvested label; consent-corpus.test.ts
 * replays them. CONSENT_DOC (a document or data permission) runs EARLY,
 * ahead of file and identity, which stole real consents ("...SMS messages at
 * the phone number provided" got the phone; "...my resume ... true and
 * correct" got the résumé URL).
 */
// "collect" and a bare "my data" / "my information" added 2026-10-11 (wave-4
// review): "I agree that GLG may collect and process my data for recruitment"
// fell through to draftable, so a model was asked to write a consent.
const CONSENT_DOC =
  /(privacy\s*(?:notice|policy|statement|declaration)|privacyverklaring|privacybeleid|datenschutz\w*|pol[ií]tica\s+de\s+privacidad|politique\s+de\s+confidentialit|data\s*protection|\bgdpr\b|\bccpa\b|terms\s*(?:and|&)\s*conditions|terms\s*of\s*(?:use|service)|algemene\s*voorwaarden|arbitration\s*agreement|non-?disclosure|\bnda\b|at[-\s]?will\s*employ\w*|(?:interview|call|meeting)\s*record(?:ing|ed)|notetaker|\bdo\s+you\s+consent\b|\bi\s+(?:hereby\s+)?consent\b|consent\w*\s*(?:to|for)\s*(?:the\s*)?(?:receiv|process|stor|retain|record|use|collect)\w*|(?:process|collect|stor)\w*\s+(?:and\s+\w+\s+)?my\s+(?:personal\s+)?(?:data|information)|persoonsgegevens|\bi\s+attest\b|\battest\s+that\b|accept\s+(?:all\s+)?(?:the\s+)?terms\b|autoriza\w*\s+que\s+seus\s+dados|\blgpd\b|동의|by\s+(?:typing|signing|submitting|selecting|checking|ticking|initial\w*|entering|clicking)\b[\s\S]{0,70}\b(?:i|you)\s+(?:hereby\s+)?(?:acknowledge|confirm|certify|agree|consent)|(?:i|you)\s+(?:hereby\s+)?(?:agree|confirm|certify|acknowledge)\b[\s\S]{0,90}\b(?:true\s+and\s+(?:correct|complete|accurate)|accurate\s+and\s+complete|truthful))/i;

/**
 * CONSENT_ATTEST, a bare first-person attestation, runs LATE, after factual:
 * "I acknowledge that I am at least 18" or "... authorized to work" are
 * standing answers factual fills; what is left ("I confirm to have a valid
 * DNI", "I confirm that I'm based in Madrid") has no answer in our data and
 * blocks. "Please confirm you are comfortable with late-night trade" is a
 * commitment; "Please confirm whether you have 3+ years with ASC 606" is a
 * résumé fact and stays draftable (`you are <state>` vs `you have`).
 */
const CONSENT_ATTEST =
  /(^\s*i\s+(?:hereby\s+)?(?:acknowledge|confirm|certify|agree|consent|understand)\b|^\s*you\s+(?:acknowledge|understand)\b|\byou\s+hereby\s+agree\b|\bdo\s+you\s+agree\s+to\s+this\b|acknowledge?ments?\s*$|\bconsent\s*$|please\s+confirm\b[\s\S]{0,30}\byou\s+are\s+(?:comfortable|available|willing|happy|aware|ok|okay)\b|confirm\s+(?:that\s+)?you\s+(?:have\s+)?read\b|are\s+you\s+comfortable\s+with\s+this\b|you\s+are\s+aware\s+of\s+(?:this|these)\b|confirmas\s+tu\s+disponibilidad|ik\s+heb\b[\s\S]{0,90}\bgelezen\b|ich\s+habe\b[\s\S]{0,90}\bgelesen\b|\bhe\s+le[ií]do\b|j['’]ai\s+lu\b|ga\s+(?:ik\s+)?akkoord|einverstanden|zustimm\w*|acepto\b)/i;
// Facts a resume can't establish. Each branch from `earliest` on is a live label
// that fell through to draftable (Breezy and Pinpoint, 2026-08-01): the earliest
// date you could start, over 18, days available, willing to travel, a licence,
// who referred you, a close relative, how you heard. Deliberately NOT here:
// certification, experience, knowledge, proficiency, which a resume answers.
// Since added: British spellings and -ing forms (S8-007), when could/would/will
// you start and current earnings (review of 9fe3bc0d).
export const FACTUAL = /(authori[sz]\w*\s*to\s*work|work\s*authori[sz]|legal\s*authori[sz]\w*|require\s*(?:visa\s*)?sponsor|sponsorship|need\s*sponsor|work\s*(?:visa|permit)|(?:need|requir|hold|hav)\w*\s*(?:a\s*)?(?:valid\s*)?(?:work\s*|employment\s*)?visa|eligible\s*to\s*work|right\s*to\s*work|employment\s*eligib\w*|salary|compensation|desired\s*pay|expected\s*(?:pay|salary|compensation)|pay\s*expectation|notice\s*period|start\s*date|available\s*to\s*start|when\s*(?:can|could|would|will)\s*you\s*(?:be\s*(?:able\s*to\s*)?)?start|willing\s*to\s*relocate|relocat|able\s*to\s*commute|are\s*you\s*(?:at\s*least\s*)?18|legally\s*(?:eligible|authori[sz]ed)|do\s*you\s*now\s*or\s*in\s*the\s*future|earliest\s*(?:possible\s*)?(?:date|start)|date\s*you\s*(?:could|can|would)\s*start|over\s*18|18\s*(?:years\s*)?(?:or\s*(?:older|above)|of\s*age)|legal\s*working\s*age|days\s*(?:are\s*)?you\s*available|what\s*days\s*[\w\s]{0,24}available|willing\s*to\s*travel|willing\s*to\s*work\s*(?:in|at)\s*(?:another|a\s*different)|licen[sc]e|security\s*clearance|dbs\s*check|background\s*check|criminal\s*(?:record|convict\w*)|referred\s*you|who\s*referred|close\s*relative|family\s*member|related\s*to\s*(?:any\s*)?(?:current\s*)?(?:employee|staff)|how\s*did\s*you\s*(?:hear|learn)\s*about|how\s*you\s*(?:heard|learned)\s*about|name\s*of\s*the\s*[\w\/]{0,24}\s*(?:staff|contractor|consultant|employee|colleague|relative|referrer)|able\s*to\s*start\s*(?:work|by|on)|start\s*working\s*(?:with|for)\s*us|how\s*much\s*(?:do\s*)?you\s*(?:currently\s*)?(?:earn|make)\b|(?:currently|presently)\s*earn)/i;

/**
 * Protected topics FACTUAL missed (sweep S8-008): criminal record, age,
 * citizenship, pay, health, shifts, relatives, tax IDs were `draftable`, so the
 * model answered them. Narrowed to the question's shape ("medical setting"
 * stays draftable). Mirrored in worker/src/questions/protected.ts.
 */
export const PROTECTED_FACTUAL = /(convict\w*|felon\w*|misdemeanou?r|criminal\s+(?:case|charge|investigation|history|offen[cs]e|background|proceeding|record)s?|pending\s+(?:criminal\s+)?(?:charges?|cases?)|(?:been|ever\s+been)\s+(?:arrested|charged|convicted|indicted|cautioned)|plead(?:ed)?\s+guilty|drug\s+(?:test|screen)\w*|(?:at\s+least|over|older\s+than|aged?)\s+(?:1[4-9]|2[0-5])\s*(?:years?\s+(?:of\s+age|old)|yrs?\s+old|\?|\)|$)|how\s+old\b|your\s+age\b|minimum\s+age|legal\s+age|\bcitizen\b|permanent\s+resident|green\s+card|immigration|\bsponsor\w*|visa\s+(?:status|type|holder|category|requirements?|needs?|situation|details)|current\s+visa|\bh-?1b\b|\bf-?1\s+(?:visa|status|student)|\bstem\s+opt\b|\bopt\s+(?:status|extension|ead)|\bon\s+opt\b|\bead\b|passport|right\s+to\s+(?:live\s+(?:and|&)\s+)?work|legally\s+(?:able\s+to\s+)?(?:live\s+(?:and|&)\s+)?work|eligible\s+to\s+(?:live\s+(?:and|&)\s+)?work|work\s+rights|residen(?:cy|ce)\s+(?:status|permit)|settled\s+status|indefinite\s+leave|\bwages?\b|hourly\s+(?:rate|pay)|(?:expected|desired|current|minimum|target)\s+(?:hourly\s+|day\s+|daily\s+|base\s+)?(?:rate|pay|earnings|income)\b|rate\s+expectations?|base\s+pay\b|rate\s+of\s+pay|pay\s+(?:rate|range|requirements?)|day\s+rate|\bote\b|\bctc\b|cost\s+to\s+(?:the\s+)?company|remuneration|medical\s+(?:condition|history|exam\w*|issue|reason|restriction|clearance|certificate|questionnaire|leave|assessment)s?|health\s+(?:condition|issue|problem|declaration|questionnaire|assessment)s?|physical(?:ly)?\s+(?:able|capable|fit|exam\w*|requirements?)|pregnan\w*|(?:need|require|request)\w*\s+(?:any\s+|an?\s+)?(?:reasonable\s+)?accommodat\w*|reasonable\s+accommodat\w*|accommodat\w*\s+(?:needs?|requests?|requirements?|required|needed)\b|interview\s+accommodat\w*|accommodat\w*\s+(?:during|for|in)\s+(?:the\s+)?(?:interview|hiring|application|recruit\w*|selection)|essential\s+functions|vaccinat\w*|immuni[sz]ation\s+(?:status|records?|history)|(?:able|willing|available|open)\s+to\s+work\s+(?:[\w,/-]+\s+){0,4}?(?:weekends?|nights?|evenings?|overtime|shifts?|holidays?|on[-\s]?call|rotating)\b|(?:can|could|will|would)\s+you\s+(?:be\s+(?:able|willing|available)\s+to\s+)?work\s+(?:[\w,/-]+\s+){0,4}?(?:weekends?|nights?|evenings?|overtime|shifts?|holidays?|on[-\s]?call)\b|which\s+shifts?|shift\s+(?:preference|availability|pattern)s?|your\s+(?:\w+\s+)?availability|relatives?\s+(?:who\s+)?(?:work|employed|currently)|know\s+(?:anyone|someone)\s+(?:who\s+)?(?:works?|employed|currently)|tax\s+(?:id|identification|number|file\s+number|code|reference)|\btin\b|\bnif\b|\bdni\b|\bnie\b|\bssn\b|social\s+security|national\s+insurance)/i;
/**
 * THE PERSON'S OWN HISTORY AND CIRCUMSTANCES, which no CV establishes (wave-4
 * review, 2026-10-11): termination, reasons for leaving, gaps, references,
 * grades, commuting, days on site, time zone and where they live, prior
 * employment by or a previous application to this employer ("worked for" or
 * "at"; "worked with" names a tool). It yields to work done only inside the
 * clause that names the work (asksAboutWorkDone): "Describe your experience
 * handling employee terminations" stays draftable. Since fix 3 a time zone is
 * the person's only when the label asks for theirs ("your", "which", "what",
 * "time zone are you"): "work across multiple time zones" is the work.
 */
export const PERSONAL_HISTORY = /(\b(?:been|ever\s+been|were\s+you|was\s+you)\s+(?:terminated|dismissed|fired|discharged|let\s+go|asked\s+to\s+resign|forced\s+to\s+resign)\b|\b(?:termination|dismissal)\s+(?:from|of\s+employment)\b|\breasons?\s+for\s+(?:leaving|departure|wanting\s+to\s+leave|your\s+(?:departure|leaving))\b|\bwhy\s+(?:are|did|do)\s+you\s+(?:want\s+to\s+)?(?:leav\w*|left|looking\s+to\s+leave)\b|\bgaps?\s+in\s+(?:your\s+)?(?:employment|work\s+history|career|cv|resume|résumé)\b|\bemployment\s+gaps?\b|\bcareer\s+(?:gap|break)s?\b|\bexplain\s+any\s+gaps?\b|\breferees?\b|\b(?:professional|personal|employment|work|character|employer)\s+references?\b|\b(?:list|provide|name|give|share|supply|include|add)\b[^?.]{0,40}\breferences?\b|^\s*references?\s*(?:$|[(:*])|\breferences?\s+(?:available|upon\s+request|contact|details|name)\b|\bgpa\b|\bgrade\s+point\s+average\b|\b(?:your|final|overall|average|cumulative|academic|university|college|degree|school)\s+(?:grades?|marks?)\b|\bclass\s+rank\b|\bdegree\s+classification\b|\bcommut\w*|\bon[-\s]?site\s+(?:\w+\s+){0,2}(?:days?|times?)\b|\b(?:\d|one|two|three|four|five)\s+days?\s+(?:a|per|each)\s+week\s+(?:in|at|on)\b|\b(?:work|be)\s+(?:on[-\s]?site|in\s+(?:the|our)\s+office)\b|\breturn\s+to\s+(?:the\s+)?office\b|\b(?:your|which|what)\s+(?:current\s+|home\s+|preferred\s+)?time\s*-?zones?\b|\btime\s*-?zones?\s+(?:are|do|would|will|can|you)\b|^\s*time\s*-?zones?\s*(?:$|[(:*?])|\bwhere\s+(?:are\s+you|do\s+you)\s+(?:currently\s+)?(?:located|based|live|living|reside)\b|\b(?:currently|presently)\s+(?:located|based|living|residing)\b|\b(?:previously|ever)\s+(?:been\s+)?(?:employed\s+by|worked\s+(?:for|at))\b|\bworked\s+(?:for|at|with)\s+(?:us|this\s+(?:company|organi[sz]ation|employer))\b|\b(?:former|previous|past)\s+employee\b|\bre-?hire\b|\beligible\s+for\s+rehire\b|\b(?:previously|ever|already)\s+applied\b|\bapplied\s+(?:(?:to|with)\s+(?:us|this\s+\w+|\w+)\s+|here\s+)?(?:before|previously)\b)/i;
/** Protected self-identification the DEMOGRAPHIC list missed (S8-008). */
export const PROTECTED_DEMOGRAPHIC = /(lgbt\w*|transgender|\btrans\s+(?:man|woman|person)|\bcaste\b|aboriginal|torres\s+strait|\bindigenous\b|first\s+nations|military\s+(?:service|status|spouse|member|background|affiliation)|served\s+in\s+the\s+(?:military|armed\s+forces)|armed\s+forces|\bage\s+(?:range|group|bracket|band))/i;
/**
 * A résumé prompt in a protected topic's words is about work done, not the
 * candidate's status: "Describe your experience with immigration law",
 * "...administering vaccinations", "...processing payroll and wages" stay
 * draftable. Only when it opens as a résumé prompt, names the work, and asks
 * nothing of the candidate's own status. Mirrored in worker/src/questions/protected.ts.
 * Since fix 3 a years-of-experience question may name the kind of experience
 * between the two ("How many total years of hands-on UT experience").
 */
export const RESUME_PROMPT = /^\s*(?:please\s+)?(?:describe|tell\s+(?:us|me)\s+about|explain|share|walk\s+(?:us|me)\s+through|discuss|elaborate\s+on|outline|give\s+(?:us\s+)?an?\s+example|what\s+(?:is|was)\s+your\s+experience|what\s+experience|how\s+many\s+(?:total\s+)?years\s+(?:of\s+)?(?:[\w/-]+\s+){0,4}?experience|how\s+much\s+experience)\b/i;
export const ABOUT_WORK_DONE = /\b(?:experience[ds]?|worked|working\s+(?:with|on|in)|handl(?:ed|ing)|process(?:ed|ing)|car(?:ed|ing)\s+for|administer(?:ed|ing)|background\s+in|familiar(?:ity)?\s+with|knowledge\s+of)\b/i;
export const OWN_STATUS = /\b(?:have|has)\s+you\s+(?:ever\s+)?been\b|\bare\s+you\b|\byou\s+(?:have|are|were)\s+(?:ever\s+)?(?:been\s+)?(?:convicted|arrested|charged|pregnant|vaccinated)\b|\byour\s+(?:own\s+)?(?:age|citizenship|immigration\s+status|visa(?:\s+status)?|criminal|convictions?|medical|health|disabilit\w*|pregnan\w*|vaccination\s+status)\b|\bany\s+(?:criminal|convictions?|arrests?|pending\s+charges?|medical|health|disabilit\w*)|\b(?:convictions?|arrests?|criminal\s+(?:record|history|charges?)|(?:medical|health)\s+conditions?|disabilit\w*)\s+(?:that\s+)?you\b|\bconfirm\s+(?:that\s+)?you\b|\bwhether\s+you\b|\b(?:do|will|would)\s+you\s+(?:need|require|hold|submit)\b|\byour\s+(?:own\s+|current\s+|expected\s+|desired\s+)?(?:hourly\s+|day\s+|daily\s+)?(?:rate|wages?|pay|salary|remuneration)\b/i;
/**
 * A clause or sentence that asks the person for a fact no CV holds, in the
 * words FACTUAL's whole-label patterns miss (review of wave 4 round 2): when
 * they could start, what they expect or were paid, their references, any
 * gaps, where they live (and since the recheck: notice, earliest, earned,
 * who to contact). Always the person's, wherever it sits. Mirrored in
 * worker/src/questions/protected.ts.
 */
export const PERSON_ASKS = /\b(?:your|two|three|four|\d)\s+(?:professional\s+)?references?\b|\breferences?\s+(?:we|that\s+we|i)\s+(?:can|could|may)\s+(?:contact|call|reach)\b|\b(?:who|whom)\s+(?:we|i)\s+(?:can|could|may)\s+(?:contact|call|reach)\b|\bcontact\s+to\s+(?:confirm|verify)\b|\bany\s+(?:employment\s+)?gaps?\b|\bwhere\s+you\s+(?:currently\s+)?(?:live|reside|are\s+(?:based|located))\b|\b(?:how\s+soon|when)\s+(?:you\s+)?(?:could|can|would|will)\s+(?:you\s+)?(?:start|begin|join|be\s+available)\b|\b(?:able|free)\s+to\s+(?:start|begin|join)\b|\bthe\s+date\s+you\s+(?:can|could|would|will)\s+(?:start|begin|join)\b|\bearliest\b|\bhow\s+much\s+notice\b|\bnotice\s+(?:you|period)\b|\bpay\s+you\s+(?:expect|want|need|would\s+(?:accept|expect|want))\b|\bexpect(?:ed)?\s+to\s+(?:earn|make|be\s+paid)\b|\b(?:need|want|expect|like)\s+to\s+be\s+paid\b|\bwhat\s+you\s+(?:were|are|get|got)\s+paid\b|\bhow\s+much\s+(?:did\s+|do\s+)?you\s+(?:made|make|earn(?:ed)?)\b|\bwhat\s+you\s+earn(?:ed)?\b|\bwhat\s+you\s+made\s+(?:last\s+year|per\s+(?:year|hour|month|week)|a\s+(?:year|month|week|hour)|annually|in\s+your\s+(?:last|current|previous|most\s+recent)\s+(?:job|role|position))|\byour\s+(?:\w+\s+)?(?:earnings|income)\b/i;
/**
 * Legal and employment facts that are the person's in a clause of their own
 * ("... and any restrictive covenants") but may be the work's object
 * ("experience drafting restrictive covenants"), so they follow the clause
 * rule PROTECTED_FACTUAL follows. Mirrored in worker/src/questions/protected.ts.
 */
export const PERSON_FACT_NOUNS = /\brestrictive\s+covenants?\b|\bnon-?(?:solicit\w*|compete\w*)\b|\bconflicts?\s+of\s+interest\b/i;
/**
 * Facts about the person in the words the lists above miss (wave 4 fix 3,
 * measured on a 1,536-label corpus): notice in any form, what the person
 * earned or was paid, pay, when they could begin or join, someone to call,
 * their availability, hours a week, eligibility, where they live, willingness
 * to travel or move, visas, a change of job, adjustments to the process.
 * Mirrored in worker/src/questions/protected.ts.
 */
export const PERSON_FACT_WORDS = /\bnotice\b|\byou(?:'re|'ve|'d)?(?:\s+\w+){0,2}?\s+(?:earn(?:s|ed|ing)?|paid)\b|\btake[-\s]?home\b|\btook\s+home\b|\b(?:your|the|what|how\s+much|expected|desired|current|last|previous)\s+(?:\w+\s+){0,2}?pay\b(?![-\w])|\bexpect\s+you\s+to\s+(?:start|begin|join)\b|\btimeline\s+(?:for|to)\s+(?:start|begin|join)\w*|\b(?:start|begin|join)(?:ing)?\s+date\b|\bwhen\s+(?:you|we)\s+(?:could|can|would|will|might)\s+(?:\w+\s+){0,3}(?:start|begin|join)\b|\b(?:someone|anyone|somebody|people|persons?|who|whom)\s+(?:we|i)\s+(?:can|could|may|might|should)\s+(?:call|contact|reach|speak\s+(?:to|with)|talk\s+to|ask)\b|\byou\s+(?:are|'re|would\s+be|will\s+be)\s+(?:\w+\s+)?available\b|\bavailable\s+(?:to\s+(?:start|work|begin|join|relocate|travel|interview)|from|for\s+(?:work|full|part|an?\s+interview|interviews))\b|\bhours?\s+(?:per|a|each|every)\s+(?:week|day|month)\b|\bhow\s+many\s+hours\b|\beligib\w*|\byou(?:'re|\s+are|\s+have)?\s+(?:currently\s+)?(?:live|lived|living|reside|resided|residing|located|based)\b|\bwhere\s+(?:do|are|did|were)\s+you\s+(?:currently\s+)?(?:live|living|lived|reside|located|based|from)\b|\b(?:willing|able|open|prepared)\s+to\s+(?:travel|relocate|move|commute)\b|\bbusiness\s+trips?\b|\bvisas?\b|\blooking\s+for\s+(?:a\s+)?(?:new|another|next|different)\s+(?:job|role|position|opportunit\w*)|\bwhy\s+now\b|\b(?:part|full)[-\s]time\b|\badjustments?\s+(?:we|to|for|during|in)\b|\byour\s+(?:\w+\s+)?status(?:es)?\b/i;
/** True when the text names a fact about the person anywhere, in any of the lists' words. */
export function mentionsPersonFact(text: string): boolean {
  return FACTUAL.test(text) || PROTECTED_FACTUAL.test(text) || PERSONAL_HISTORY.test(text) || PERSON_ASKS.test(text) || PERSON_FACT_NOUNS.test(text) || PERSON_FACT_WORDS.test(text);
}
/** A later sentence is its own question; a dotted initialism or "e.g." ends none. */
export const SENTENCE_BREAK = /[?!;]\s+|(?<=[a-z]{3})\.\s+(?=[A-Z])/;
/** Where one clause of a sentence ends and the next begins: a comma, a semicolon, an ampersand, a slash, a plus, any spaced run of symbols (" - ", " | ", " => ", " · "), or a joining word. */
export const CLAUSE_BREAK = /(,|;|&|\/|\+|\s[^\p{L}\p{N}\s]{1,3}\s|\band\b|\bincluding\b|\bas\s+well\s+as\b|\bplus\b|\balong\s+with\b|\btogether\s+with\b)/iu;
/**
 * A clause about the person's own circumstances, by grammar rather than by
 * topic, so it needs no word list (fix 3's self-break: "... and the hours you
 * can commit", "... and how much you'd want per hour", "... and when your
 * current contract ends", "... and the city you'd be working from"): a modal
 * after "you" (not "you'd like", the extra-box idiom), a plan or a move in
 * progress, or "your" current, expected, next or ideal anything. Work done is
 * told in the past or as a plain noun ("the tools you used", "key accounts"),
 * so a later clause or sentence that reads this way is a second ask, and the
 * person's.
 */
/**
 * THE DEFAULT FOR A LATER CLAUSE (fix 3's second self-break: "... and your
 * political views", "... and your union membership", "... and the region
 * you're in", "... and do you have kids?" carry no word any list holds). A
 * later clause that addresses the person is a second ask, and theirs, unless
 * it is visibly about work done (WORK_CLAUSE: told in the past by "you", or
 * naming the work) or about motivation (MOTIVE_CLAUSE). A clause about their
 * circumstances (PERSON_CIRCUMSTANCE) is theirs unless it tells work done in
 * the past (WORK_PAST): "the clients you'd bring from your current employer"
 * names clients and is still a covenant question. Pay verbs ("received",
 * "earned", "made") never count as work done. The default is the person, so a
 * new kind of personal question needs no new word.
 */
export const ADDRESSES_PERSON = /\byou(?:rs?|rself)?\b/i;
export const WORK_PAST = /\byou(?:'ve|\s+have|\s+had)?\s+(?:\w+ly\s+)?(?:(?!(?:receiv|earn|pai|ow|offer|promis|award|grant|need|want|requir|expect|prefer|plann|intend)ed\b)\w+(?<!e)ed|built|led|ran|did|done|drove|grew|won|wrote|taught|sold|brought|kept|met|spent|oversaw|overcame|undertook|saw|found|chose|became|began|knew)\b/i;
export const WORK_CLAUSE = new RegExp(WORK_PAST.source + /|\b(?:projects?|teams?|work|roles?|responsibilit\w*|clients?|customers?|tools?|results?|outcomes?|impact|approach|process(?:es)?|strateg\w*|skills?|stack|accounts?|pipeline|quotas?|deals?|campaigns?|products?|achievements?|accomplishments?|metrics|stakeholders|lessons?|examples?|challenges?|style|answer|response)\b|\byour\s+(?:biggest|greatest|proudest|best|most\s+\w+)\b/.source, "i");
export const MOTIVE_CLAUSE = /\b(?:excit\w*|interest\w*|attract\w*|appeal\w*|drew|draws|motivat\w*|inspir\w*|passion\w*|love|enjoy\w*|admire|mission|values?|culture|vision|company|our|opportunit\w*|goals?|career|grow\w*|learn\w*|contribut\w*|bring|fit)\b/i;
export const PERSON_CIRCUMSTANCE = /\byou(?:'d\s+(?!like\b|love\b|enjoy\b)|'ll\b|(?:'re|\s+are)\s+(?:able|willing|available|leaving|moving|looking|planning|considering|expecting|currently)\b|\s+(?:would|could|can|will|might|may|should|must|shall|need|expect|require|prefer|plan|intend)\b(?!\s+(?:like|love|enjoy)\b))|\byour\s+(?:current|expected|desired|preferred|next|ideal|future|minimum|target)\b/i;
/** Text after the work words that begins with a joiner: the work took no object of its own. */
export const NO_OBJECT = /^\s*(?:[^\p{L}\p{N}\s("'“‘[]|(?:and|or|plus|including|as\s+well\s+as|along\s+with|together\s+with)\b|$)/iu;
/** The question's own "do you have" or "you have" right after the work words ("What experience do you have with ...", "Describe any experience you have with ..."), which asks about the work. */
export const QUESTION_AUX = /^\s*(?:(?:do|did|would|will|can)\s+you\s+(?:have|had|bring|hold|possess)|(?:that\s+)?you(?:'ve|\s+have|\s+had))\b/i;
/** Words that point a clause at the person: a question word about them, "any", or what we may do ("someone we may call"). */
export const ASK_WORDS = /\b(?:any|whether|when|where|who|whom|how\s+(?:soon|much|many|long)|we\s+(?:can|could|may|might|should|will|would))\b/i;
/** A clause that asks something of the person: it names them, or tells them to do something. */
export const SECOND_ASK = /\byou(?:rs?)?\b|\b(?:list|provide|name|give|share|state|include|add|supply|tell|explain|describe|confirm|indicate|specify|mention)\b/i;
/**
 * Words that make a protected noun the person's own state rather than the
 * work's object (sweep S12-081): "current visa status", "expected hourly
 * rate", "accommodations needed", "vaccination history", "passport details".
 */
export const PERSON_STATE = /\b(?:status(?:es)?|expectations?|requirements?|requir(?:ed|ing)|needs?|needed|needing|requested|details|eligibility|availability|preferences?|situation|history|records?|current(?:ly)?|present|expected|desired|minimum|preferred|own)\b/i;
/** A factual question's topic, for self-apply.ts and the clause rule. Mirrored in the worker. */
export const TOPICS: ReadonlyArray<readonly [string, RegExp]> = [
  ["sponsorship", /sponsor|visa/i],
  ["work_authorisation", /authori[sz]|eligib\w*\s+to\s+work|right\s+to\s+(?:live\s+(?:and|&)\s+)?work|work\s+permit|legally|citizen|permanent\s+resident|green\s+card|immigration|residen(?:cy|ce)\s+(?:status|permit)/i],
  ["salary", /salary|compensation|pay\b|wages?|remuneration|rate\b|\bote\b|\bctc\b|\byour\s+(?:\w+\s+)?(?:earnings|income)\b|\bhow\s+much\s+(?:did\s+|do\s+)?you\s+(?:made|make|earn(?:ed)?)\b|\bwhat\s+you\s+earn(?:ed)?\b|\b(?:currently|presently)\s+(?:earn|make)\b/i],
  ["start_date", /\bstart\b(?!-)|\bstart(?:ing)?\s+date|\bnotice\b|available\s+(?:to|from)|earliest|(?:able|free)\s+to\s+(?:begin|join)|date\s+you\s+(?:can|could|would|will)\s+(?:begin|join)|when\s+you\s+(?:can|could|would|will)\s+(?:begin|join)/i],
  ["relocation", /relocat/i],
  ["on_site", /on[-\s]?site|in\s+(?:the\s+)?office|hybrid|days?\s+(?:a|per)\s+week/i],
  ["commute", /commut/i],
  ["location", /time\s*-?zone|located|based\s+in|where\s+(?:are\s+you|do\s+you\s+live|you\s+(?:live|reside))/i],
  ["travel", /travel/i],
  ["schedule", /shift|weekend|night|overtime|on[-\s]?call|availability|days\s+(?:are\s+)?you\s+available/i],
  ["age", /\bage\b|18|years\s+old|of\s+age/i],
  ["criminal_history", /convict|criminal|felon|arrest|misdemean|charge/i],
  ["background_check", /background\s+check|dbs|clearance|drug\s+(?:test|screen)/i],
  ["licence", /licen[sc]e|certif/i],
  ["references", /referees?|references?|contact\s+to\s+(?:confirm|verify)|(?:who|whom)\s+(?:we|i)\s+(?:can|could|may)\s+(?:contact|call|reach)/i],
  ["employment_history", /terminat|dismiss|fired|let\s+go|resign|leaving|left\s+your|gaps?|career\s+break|employed\s+by|worked\s+(?:for|at)|former\s+employee|previous\s+employee|rehire/i],
  ["education_results", /\bgpa\b|grade|marks?\b|class\s+rank|classification/i],
  ["relations", /relative|family|related\s+to|know\s+(?:anyone|someone)/i],
  ["referral_source", /hear|learn\s+about|referr|who\s+referred/i],
  ["health", /medical|health|disab|accommodat|vaccin|pregnan|physical/i],
  ["tax_id", /\btax\b|\bssn\b|social\s+security|national\s+insurance|\bnie\b|\bdni\b|\bnif\b|\btin\b/i],
];

/** What a factual question asks about, or "other" when no topic names it. */
export function topicOf(label: string): string {
  for (const [topic, re] of TOPICS) if (re.test(label)) return topic;
  return "other";
}

/**
 * True when a protected word sits in a question about work done, which the model may draft.
 *
 * The exemption covers the work's own object only ("your experience handling
 * employee terminations", "processing payroll and wages"). A later sentence
 * is its own question. History or a protected status named before the work
 * words is not the work's object. Sweep S12-081 and two rounds after it
 * found the clause rule worked on spelling: a status, pay, a start date or a
 * referee asked after "and", then after "&" or "/", then in new words, was
 * drafted. Fix 3 (a 1,536-label corpus) makes the first test independent of
 * joiners: PERSON_ASKS anywhere is the person's, and any fact about the person
 * (mentionsPersonFact) after the work words is the work's object only when
 * the work took an object first and nothing after it points at the person
 * (pointsAtPerson). The clause loop still reads each later clause, split at
 * every joiner, against the topics too, and a later clause or sentence about
 * the person's circumstances (PERSON_CIRCUMSTANCE) is theirs whatever its
 * words. Mirrored in worker/src/questions/protected.ts.
 */
export function asksAboutWorkDone(label: string): boolean {
  if (!RESUME_PROMPT.test(label) || !ABOUT_WORK_DONE.test(label) || OWN_STATUS.test(label)) return false;
  if (PERSON_ASKS.test(label)) return false;
  const [first, ...later] = label.split(SENTENCE_BREAK);
  // "Tell us about your experience. Green card holder?" is two questions.
  if (later.some((s) => mentionsPersonFact(s) || topicOf(s) !== "other" || PERSON_CIRCUMSTANCE.test(s))) return false;
  const work = ABOUT_WORK_DONE.exec(first);
  if (!work) return false;
  // History named before the work words is not the work's object, nor is a protected status.
  const before = first.slice(0, work.index);
  if (PERSONAL_HISTORY.test(before) || PERSON_FACT_WORDS.test(before)) return false;
  if ((PROTECTED_FACTUAL.test(before) || PERSON_FACT_NOUNS.test(before)) && PERSON_STATE.test(before)) return false;
  const rest = first.slice(work.index + work[0].length).replace(QUESTION_AUX, " ");
  const tookObject = !NO_OBJECT.test(rest);
  if (mentionsPersonFact(rest) && (!tookObject || pointsAtPerson(rest))) return false;
  const parts = rest.split(CLAUSE_BREAK);
  // parts: [the work's object, joiner, clause, joiner, clause, ...]
  for (let i = 2; i < parts.length; i += 2) {
    const clause = parts[i];
    if (PERSONAL_HISTORY.test(clause)) return false;
    if ((mentionsPersonFact(clause) || topicOf(clause) !== "other") && (!tookObject || pointsAtPerson(clause))) return false;
    if (PERSON_CIRCUMSTANCE.test(clause) && !WORK_PAST.test(clause)) return false;
    if (ADDRESSES_PERSON.test(clause) && !WORK_CLAUSE.test(clause) && !MOTIVE_CLAUSE.test(clause)) return false;
  }
  return true;
}

/** True when the text points at the person: "you" or "your", an instruction, a state of theirs, or a question word about them. */
export function pointsAtPerson(text: string): boolean {
  return SECOND_ASK.test(text) || PERSON_STATE.test(text) || ASK_WORDS.test(text);
}

/**
 * Labels as text: 2 of 127 live Recruitee labels arrived as HTML, which renders
 * as tag soup and defeats the matchers (a consent link inside <a> must still
 * classify as consent). Entities are decoded after tags are stripped, so an
 * escaped tag in real text cannot become one.
 */
export function cleanQuestionLabel(raw: unknown): string {
  return String(raw ?? "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;|&rsquo;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * THE HONESTY CLASSES IN OTHER LANGUAGES (measured 2026-08-03): a Dutch date of
 * birth, a Swedish personnummer, a German gender and seven more all came back
 * draftable, so a model would have invented them on live Dutch, Swedish,
 * Norwegian and Italian forms. Each pattern is OR'd with its English original,
 * so English behaviour is unchanged. No \b around accented terms: it is ASCII-only.
 */
const DEMOGRAPHIC_INTL =
  /(geboorte\w*|geburts\w*|date\s+de\s+naissance|fecha\s+de\s+nacimiento|data\s+di\s+nascita|data\s+de\s+nascimento|födelsedatum|fødselsdato|syntymäaika|data\s+urodzenia|personnummer|fødselsnummer|\bbsn\b|geslacht|geschlecht|\bsexe\b|\bgénero\b|\bgenere\b|\bsesso\b|\bkön\b|kjønn|sukupuoli|\bpłeć\b|nationaliteit|staatsangehörigkeit|nationalité|nacionalidad|nazionalità|nacionalidade|nationalitet|kansalaisuus|obywatelstwo|burgerlijke\s+staat|familienstand|état\s+civil|estado\s+civil|stato\s+civile|civilstånd|handicap|behinderung|discapacidad|disabilità|deficiência|funktionsnedsättning|funksjonsnedsettelse|etnische|ethnische|origine\s+ethnique|origen\s+étnico)/i;

const IDENTITY_INTL =
  /(adresgegevens|\badres\b|anschrift|\badresse\b|dirección|indirizzo|endereço|\badress\b|osoite|telefoonnummer|telefoon|telefonnummer|téléphone|teléfono|telefono|telefone|puhelin|postcode|postleitzahl|\bplz\b|code\s+postal|código\s+postal|postnummer|postinumero|kod\s+pocztowy|voornaam|achternaam|vorname|nachname|prénom|apellido|cognome|sobrenome|förnamn|efternamn|etunimi|sukunimi)/i;

const FACTUAL_INTL =
  /(salaris\w*|gehalt\w*|prétentions\s+salariales|\bsalaire\b|expectativa\s+salarial|pretensión\s+salarial|\bsueldo\b|stipendio|salário|löne\w*|\blön\b|lønn\w*|palkka\w*|wynagrodzenie|opzegtermijn|kündigungsfrist|préavis|preaviso|preavviso|uppsägningstid|oppsigelsestid|startdatum|beschikbaar\s+vanaf|verfügbar\s+ab|date\s+de\s+début|fecha\s+de\s+inicio|data\s+di\s+inizio|tillträde|werkvergunning|arbeitserlaubnis|aufenthaltstitel|permis\s+de\s+travail|permiso\s+de\s+trabajo|permesso\s+di\s+lavoro|arbetstillstånd|arbeidstillatelse|verklaring\s+omtrent\s+gedrag|\bvog\b|führungszeugnis|casier\s+judiciaire|antecedentes\s+penales|belastningsregister|politiattest|rijbewijs|führerschein|permis\s+de\s+conduire|carnet\s+de\s+conducir|patente\s+di\s+guida|körkort)/i;

const FILE_INTL =
  /(curriculum\s+vitae|lebenslauf|motivatiebrief|motivationsschreiben|anschreiben|lettre\s+de\s+motivation|carta\s+de\s+presentación|lettera\s+di\s+presentazione|carta\s+de\s+apresentação|personlig\w*\s+brev|søknadsbrev|hakemuskirje|bijlage|anhang|pièce\s+jointe|ladda\s+upp|hochladen|télécharger|subir\s+(?:tu|su|el)|caricare|carregar|last\s+opp|lataa\s+tiedosto)/i;

export function classifyQuestion(label: string, fieldType?: string): QuestionClass {
  const l = cleanQuestionLabel(label);
  const t = (fieldType ?? "").toLowerCase();
  // Protected self-ID wins over everything — even if phrased oddly.
  if (DEMOGRAPHIC.test(l) || DEMOGRAPHIC_INTL.test(l) || PROTECTED_DEMOGRAPHIC.test(l)) return "demographic";
  // BEFORE `file` AND `identity`, deliberately — see CONSENT_DOC. Both of those
  // classes were measured stealing real consent questions and answering them
  // with a phone number and a résumé URL respectively.
  if (CONSENT_DOC.test(l)) return "consent";
  if (t.includes("file") || FILE.test(l) || FILE_INTL.test(l)) return "file";
  // Structured contact/location field types (Ashby: Email/Phone/Location) are
  // identity regardless of label — "Where do you plan on working from?" has no
  // identity keyword but is the candidate's own to fill.
  if (t === "email" || t === "phone" || t === "location" || t.includes("email") || t.includes("phone")) return "identity";
  // A label that IS just "name" (live Ashby forms use a bare "Name" field) is
  // identity — but only as the whole label, so "Name a project you're proud
  // of" stays draftable.
  const bare = l.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (bare === "name" || bare === "your name" || bare === "confirm your name") return "identity";
  // A SHORT label ENDING in "name" is a name box: "Candidate name", "Applicant
  // name", "Employee name". Found while wiring the packet builder — these fell
  // through to `draftable`, which meant the agent would try to GENERATE A
  // SENTENCE where a person's name belongs.
  //
  // Both halves of the rule earn their place. "Ends with" keeps the deliberate
  // guard above intact, because "Name a project you're proud of" uses name as a
  // verb and ends on "of". The three-word cap stops a long prompt that happens
  // to trail off on the word name from being autofilled.
  if (/\bname$/.test(bare) && bare.split(" ").length <= 3) return "identity";
  if (IDENTITY.test(l)) {
    // Somebody else's phone or email is not the candidate's to fill, and not
    // the model's to invent: it stops for the candidate, like a referrer's name.
    if (SOMEONE_ELSES_CONTACT.test(l)) return "factual";
    if (contactLabelIsAField(l, t)) return "identity";
  }
  if (IDENTITY_INTL.test(l)) return "identity";
  // Geographic/contact words that are also ordinary English. Identity only when
  // the label reads as a FIELD — a short one ("Country", "Current City, State")
  // or one that says whose it is ("What is your country of residence?"). In a
  // long sentence with no "your", the word is doing prose work and the question
  // belongs to the drafter.
  //
  // FACTUAL is checked FIRST so that "Are you willing to work in another
  // location?" stays a refusal rather than being autofilled with a home city.
  if (FACTUAL.test(l) || FACTUAL_INTL.test(l)) return "factual";
  // AFTER factual, so "I acknowledge that I am at least 18 years of age" keeps
  // the standing answer it already has instead of becoming a blocker.
  if (CONSENT_ATTEST.test(l)) return "consent";
  // After the attestations: "I confirm to have a valid DNI" is the candidate's
  // own declaration either way, and stays one.
  if (PROTECTED_FACTUAL.test(l) && !asksAboutWorkDone(l)) return "factual";
  // The person's own history and circumstances (2026-10-11), and since fix 3
  // the asks and facts the lists missed, under the same work-done exemption.
  if ((PERSONAL_HISTORY.test(l) || PERSON_ASKS.test(l) || PERSON_FACT_NOUNS.test(l) || PERSON_FACT_WORDS.test(l)) && !asksAboutWorkDone(l)) return "factual";
  if (IDENTITY_IF_FIELD.test(l) && (bare.split(" ").length <= 4 || OWN_ATTRIBUTE.test(l))) {
    return "identity";
  }
  return "draftable";
}

/** The subset an AI should draft grounded answers for (everything else stays with
 *  the candidate or is autofilled). */
export function selectDraftable(questions: readonly AppQuestion[]): AppQuestion[] {
  return questions.filter((q) => classifyQuestion(q.label ?? "", q.type) === "draftable");
}

export type ShapedAnswer = { question: string; answer: string; supported: boolean; note: string; anticipated: boolean };

/**
 * The model's reply as answers (S8-008): support is a literal true (a missing
 * flag counted as true), and in inferred mode each invented question is
 * classified, a non-draftable one going to `skipped`.
 */
export function shapeModelAnswers(
  raw: unknown,
  opts: { inferred: boolean; askedLabels: ReadonlySet<string>; limit?: number },
): { answers: ShapedAnswer[]; skipped: Array<{ question: string; class: QuestionClass }> } {
  const skipped: Array<{ question: string; class: QuestionClass }> = [];
  const answers: ShapedAnswer[] = [];
  for (const a of Array.isArray(raw) ? raw : []) {
    if (!a || typeof a !== "object") continue;
    const r = a as { question?: unknown; answer?: unknown; supported?: unknown; note?: unknown };
    if (typeof r.answer !== "string" || !r.answer.trim() || typeof r.question !== "string" || !r.question.trim()) continue;
    const question = r.question.trim();
    // Explicit mode: only what we asked (which was classified on the way in).
    if (!opts.inferred && !opts.askedLabels.has(question)) continue;
    if (opts.inferred) {
      const cls = classifyQuestion(question);
      if (cls !== "draftable") { skipped.push({ question, class: cls }); continue; }
    }
    const supported = r.supported === true;
    answers.push({
      question,
      answer: r.answer.trim(),
      supported,
      note: supported ? "" : String(r.note ?? "Add specifics from your own experience.").trim(),
      anticipated: opts.inferred,
    });
  }
  return { answers: answers.slice(0, opts.limit ?? 12), skipped };
}

// ── Role-aware drafting guidance ────────────────────────────────────────────
// What "a good answer" emphasizes differs by field: a hiring manager reading a
// nurse's screening answers wants licenses and patient populations; one reading
// a sales answer wants quota facts. Every line is fenced with "as stated in the
// resume" — this steers emphasis, it never licenses invention. Keys are the
// board's category slugs (categories.ts); unknown/absent categories get "".

const ROLE_EMPHASIS: Record<string, string> = {
  engineering: "Name the candidate's actual languages, systems, and scale from the resume; a linked portfolio/GitHub only if the resume lists one.",
  data_ai: "Emphasize the datasets, models, tools, and measurable analyses the resume actually describes.",
  design: "Lead with the portfolio if the resume lists one, and the shipped work/design process it actually describes.",
  product: "Emphasize shipped products, user/business outcomes, and cross-functional scope exactly as the resume states them.",
  marketing: "Emphasize channels, campaigns, and measurable results exactly as stated in the resume.",
  sales: "Quota, attainment, deal size, and book-of-business figures ONLY as literally stated in the resume — these are the most-verified claims in hiring.",
  customer: "Emphasize volumes handled, tools/CRMs used, satisfaction outcomes, and languages spoken as the resume states them.",
  finance: "Credentials (CPA, CFA…) exactly as held; emphasize regulatory scope, reporting cadence, and systems from the resume.",
  legal: "Bar admissions and jurisdictions exactly as held; practice areas and matter types from the resume only.",
  people_hr: "Emphasize programs run, headcount supported, and HRIS tooling as the resume states them.",
  operations: "Emphasize process scope, volumes, safety/quality certifications, and systems exactly as the resume states them.",
  healthcare: "Licenses, certifications, and patient populations EXACTLY as held per the resume — never imply a credential it doesn't state.",
  science: "Techniques, instruments, and publications exactly as the resume lists them.",
  education: "Teaching certifications, grade levels, and subjects exactly as held per the resume.",
  hospitality_retail: "Emphasize service volumes, POS/systems, and scheduling/leadership scope as the resume states them.",
  security: "Clearances and security certifications EXACTLY as held per the resume — never imply a clearance it doesn't state.",
  admin: "Emphasize the tools, calendars/logistics scope, and stakeholders supported as the resume states them.",
};

/**
 * Optional prompt block steering answer emphasis by role category and
 * seniority. Returns "" when there's nothing useful to add.
 */
export function roleGuidance(category?: string | null, experienceBand?: string | null): string {
  const parts: string[] = [];
  const emphasis = ROLE_EMPHASIS[(category ?? "").toLowerCase()];
  if (emphasis) parts.push(emphasis);
  const band = (experienceBand ?? "").toLowerCase();
  if (band === "entry") {
    parts.push("Entry-level posting: internships, coursework, and transferable experience the resume actually lists are fair material — never inflate them into professional experience.");
  } else if (band === "senior" || band === "lead" || band === "executive") {
    parts.push("Senior posting: emphasize ownership, scope, and leadership the resume actually states — team sizes and budgets only if written there.");
  }
  return parts.length ? `ROLE FOCUS: ${parts.join(" ")}` : "";
}
