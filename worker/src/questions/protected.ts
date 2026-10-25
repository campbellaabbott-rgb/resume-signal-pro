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
 * MIRRORED, character for character, from PROTECTED_FACTUAL,
 * PROTECTED_DEMOGRAPHIC and (since the review of 9fe3bc0d, 2026-10-12)
 * PERSONAL_HISTORY, with the work-done exemption's FACTUAL, CLAUSE_BREAK,
 * SECOND_ASK, (since sweep S12-081) PERSON_STATE, (since the recheck of
 * wave 4 round 2) TOPICS and (since fix 3) PERSON_FACT_WORDS, NO_OBJECT,
 * QUESTION_AUX, ASK_WORDS, PERSON_CIRCUMSTANCE, ADDRESSES_PERSON, WORK_PAST, WORK_CLAUSE and MOTIVE_CLAUSE, in supabase/functions/_shared/application-questions.ts.
 * The worker builds from worker/src alone, so it cannot import that file; a
 * cross-runtime test holds the two sources equal and replays one corpus
 * through both.
 */
export const PROTECTED_FACTUAL = /(convict\w*|felon\w*|misdemeanou?r|criminal\s+(?:case|charge|investigation|history|offen[cs]e|background|proceeding|record)s?|pending\s+(?:criminal\s+)?(?:charges?|cases?)|(?:been|ever\s+been)\s+(?:arrested|charged|convicted|indicted|cautioned)|plead(?:ed)?\s+guilty|drug\s+(?:test|screen)\w*|(?:at\s+least|over|older\s+than|aged?)\s+(?:1[4-9]|2[0-5])\s*(?:years?\s+(?:of\s+age|old)|yrs?\s+old|\?|\)|$)|how\s+old\b|your\s+age\b|minimum\s+age|legal\s+age|\bcitizen\b|permanent\s+resident|green\s+card|immigration|\bsponsor\w*|visa\s+(?:status|type|holder|category|requirements?|needs?|situation|details)|current\s+visa|\bh-?1b\b|\bf-?1\s+(?:visa|status|student)|\bstem\s+opt\b|\bopt\s+(?:status|extension|ead)|\bon\s+opt\b|\bead\b|passport|right\s+to\s+(?:live\s+(?:and|&)\s+)?work|legally\s+(?:able\s+to\s+)?(?:live\s+(?:and|&)\s+)?work|eligible\s+to\s+(?:live\s+(?:and|&)\s+)?work|work\s+rights|residen(?:cy|ce)\s+(?:status|permit)|settled\s+status|indefinite\s+leave|\bwages?\b|hourly\s+(?:rate|pay)|(?:expected|desired|current|minimum|target)\s+(?:hourly\s+|day\s+|daily\s+|base\s+)?(?:rate|pay|earnings|income)\b|rate\s+expectations?|base\s+pay\b|rate\s+of\s+pay|pay\s+(?:rate|range|requirements?)|day\s+rate|\bote\b|\bctc\b|cost\s+to\s+(?:the\s+)?company|remuneration|medical\s+(?:condition|history|exam\w*|issue|reason|restriction|clearance|certificate|questionnaire|leave|assessment)s?|health\s+(?:condition|issue|problem|declaration|questionnaire|assessment)s?|physical(?:ly)?\s+(?:able|capable|fit|exam\w*|requirements?)|pregnan\w*|(?:need|require|request)\w*\s+(?:any\s+|an?\s+)?(?:reasonable\s+)?accommodat\w*|reasonable\s+accommodat\w*|accommodat\w*\s+(?:needs?|requests?|requirements?|required|needed)\b|interview\s+accommodat\w*|accommodat\w*\s+(?:during|for|in)\s+(?:the\s+)?(?:interview|hiring|application|recruit\w*|selection)|essential\s+functions|vaccinat\w*|immuni[sz]ation\s+(?:status|records?|history)|(?:able|willing|available|open)\s+to\s+work\s+(?:[\w,/-]+\s+){0,4}?(?:weekends?|nights?|evenings?|overtime|shifts?|holidays?|on[-\s]?call|rotating)\b|(?:can|could|will|would)\s+you\s+(?:be\s+(?:able|willing|available)\s+to\s+)?work\s+(?:[\w,/-]+\s+){0,4}?(?:weekends?|nights?|evenings?|overtime|shifts?|holidays?|on[-\s]?call)\b|which\s+shifts?|shift\s+(?:preference|availability|pattern)s?|your\s+(?:\w+\s+)?availability|relatives?\s+(?:who\s+)?(?:work|employed|currently)|know\s+(?:anyone|someone)\s+(?:who\s+)?(?:works?|employed|currently)|tax\s+(?:id|identification|number|file\s+number|code|reference)|\btin\b|\bnif\b|\bdni\b|\bnie\b|\bssn\b|social\s+security|national\s+insurance)/i;
export const PROTECTED_DEMOGRAPHIC = /(lgbt\w*|transgender|\btrans\s+(?:man|woman|person)|\bcaste\b|aboriginal|torres\s+strait|\bindigenous\b|first\s+nations|military\s+(?:service|status|spouse|member|background|affiliation)|served\s+in\s+the\s+(?:military|armed\s+forces)|armed\s+forces|\bage\s+(?:range|group|bracket|band))/i;

/**
 * A résumé prompt in a protected topic's words is about work done, not the
 * candidate's status: "Describe your experience with immigration law",
 * "...administering vaccinations", "...processing payroll and wages" stay
 * draftable. Only when it opens as a résumé prompt, names the work, and asks
 * nothing of the candidate's own status. Mirrored from supabase/functions/_shared/application-questions.ts.
 */
export const RESUME_PROMPT = /^\s*(?:please\s+)?(?:describe|tell\s+(?:us|me)\s+about|explain|share|walk\s+(?:us|me)\s+through|discuss|elaborate\s+on|outline|give\s+(?:us\s+)?an?\s+example|what\s+(?:is|was)\s+your\s+experience|what\s+experience|how\s+many\s+(?:total\s+)?years\s+(?:of\s+)?(?:[\w/-]+\s+){0,4}?experience|how\s+much\s+experience)\b/i;
export const ABOUT_WORK_DONE = /\b(?:experience[ds]?|worked|working\s+(?:with|on|in)|handl(?:ed|ing)|process(?:ed|ing)|car(?:ed|ing)\s+for|administer(?:ed|ing)|background\s+in|familiar(?:ity)?\s+with|knowledge\s+of)\b/i;
export const OWN_STATUS = /\b(?:have|has)\s+you\s+(?:ever\s+)?been\b|\bare\s+you\b|\byou\s+(?:have|are|were)\s+(?:ever\s+)?(?:been\s+)?(?:convicted|arrested|charged|pregnant|vaccinated)\b|\byour\s+(?:own\s+)?(?:age|citizenship|immigration\s+status|visa(?:\s+status)?|criminal|convictions?|medical|health|disabilit\w*|pregnan\w*|vaccination\s+status)\b|\bany\s+(?:criminal|convictions?|arrests?|pending\s+charges?|medical|health|disabilit\w*)|\b(?:convictions?|arrests?|criminal\s+(?:record|history|charges?)|(?:medical|health)\s+conditions?|disabilit\w*)\s+(?:that\s+)?you\b|\bconfirm\s+(?:that\s+)?you\b|\bwhether\s+you\b|\b(?:do|will|would)\s+you\s+(?:need|require|hold|submit)\b|\byour\s+(?:own\s+|current\s+|expected\s+|desired\s+)?(?:hourly\s+|day\s+|daily\s+)?(?:rate|wages?|pay|salary|remuneration)\b/i;
/**
 * The person's own history and circumstances, which no CV establishes:
 * termination, reasons for leaving, gaps, references, grades, commuting, days
 * on site, time zone and where they live, prior employment by or a previous
 * application to this employer. Mirrored from PERSONAL_HISTORY.
 */
export const PERSONAL_HISTORY = /(\b(?:been|ever\s+been|were\s+you|was\s+you)\s+(?:terminated|dismissed|fired|discharged|let\s+go|asked\s+to\s+resign|forced\s+to\s+resign)\b|\b(?:termination|dismissal)\s+(?:from|of\s+employment)\b|\breasons?\s+for\s+(?:leaving|departure|wanting\s+to\s+leave|your\s+(?:departure|leaving))\b|\bwhy\s+(?:are|did|do)\s+you\s+(?:want\s+to\s+)?(?:leav\w*|left|looking\s+to\s+leave)\b|\bgaps?\s+in\s+(?:your\s+)?(?:employment|work\s+history|career|cv|resume|résumé)\b|\bemployment\s+gaps?\b|\bcareer\s+(?:gap|break)s?\b|\bexplain\s+any\s+gaps?\b|\breferees?\b|\b(?:professional|personal|employment|work|character|employer)\s+references?\b|\b(?:list|provide|name|give|share|supply|include|add)\b[^?.]{0,40}\breferences?\b|^\s*references?\s*(?:$|[(:*])|\breferences?\s+(?:available|upon\s+request|contact|details|name)\b|\bgpa\b|\bgrade\s+point\s+average\b|\b(?:your|final|overall|average|cumulative|academic|university|college|degree|school)\s+(?:grades?|marks?)\b|\bclass\s+rank\b|\bdegree\s+classification\b|\bcommut\w*|\bon[-\s]?site\s+(?:\w+\s+){0,2}(?:days?|times?)\b|\b(?:\d|one|two|three|four|five)\s+days?\s+(?:a|per|each)\s+week\s+(?:in|at|on)\b|\b(?:work|be)\s+(?:on[-\s]?site|in\s+(?:the|our)\s+office)\b|\breturn\s+to\s+(?:the\s+)?office\b|\b(?:your|which|what)\s+(?:current\s+|home\s+|preferred\s+)?time\s*-?zones?\b|\btime\s*-?zones?\s+(?:are|do|would|will|can|you)\b|^\s*time\s*-?zones?\s*(?:$|[(:*?])|\bwhere\s+(?:are\s+you|do\s+you)\s+(?:currently\s+)?(?:located|based|live|living|reside)\b|\b(?:currently|presently)\s+(?:located|based|living|residing)\b|\b(?:previously|ever)\s+(?:been\s+)?(?:employed\s+by|worked\s+(?:for|at))\b|\bworked\s+(?:for|at|with)\s+(?:us|this\s+(?:company|organi[sz]ation|employer))\b|\b(?:former|previous|past)\s+employee\b|\bre-?hire\b|\beligible\s+for\s+rehire\b|\b(?:previously|ever|already)\s+applied\b|\bapplied\s+(?:(?:to|with)\s+(?:us|this\s+\w+|\w+)\s+|here\s+)?(?:before|previously)\b)/i;
/** The server's factual list, read here only for a later sentence of a work-done prompt. */
export const FACTUAL = /(authori[sz]\w*\s*to\s*work|work\s*authori[sz]|legal\s*authori[sz]\w*|require\s*(?:visa\s*)?sponsor|sponsorship|need\s*sponsor|work\s*(?:visa|permit)|(?:need|requir|hold|hav)\w*\s*(?:a\s*)?(?:valid\s*)?(?:work\s*|employment\s*)?visa|eligible\s*to\s*work|right\s*to\s*work|employment\s*eligib\w*|salary|compensation|desired\s*pay|expected\s*(?:pay|salary|compensation)|pay\s*expectation|notice\s*period|start\s*date|available\s*to\s*start|when\s*(?:can|could|would|will)\s*you\s*(?:be\s*(?:able\s*to\s*)?)?start|willing\s*to\s*relocate|relocat|able\s*to\s*commute|are\s*you\s*(?:at\s*least\s*)?18|legally\s*(?:eligible|authori[sz]ed)|do\s*you\s*now\s*or\s*in\s*the\s*future|earliest\s*(?:possible\s*)?(?:date|start)|date\s*you\s*(?:could|can|would)\s*start|over\s*18|18\s*(?:years\s*)?(?:or\s*(?:older|above)|of\s*age)|legal\s*working\s*age|days\s*(?:are\s*)?you\s*available|what\s*days\s*[\w\s]{0,24}available|willing\s*to\s*travel|willing\s*to\s*work\s*(?:in|at)\s*(?:another|a\s*different)|licen[sc]e|security\s*clearance|dbs\s*check|background\s*check|criminal\s*(?:record|convict\w*)|referred\s*you|who\s*referred|close\s*relative|family\s*member|related\s*to\s*(?:any\s*)?(?:current\s*)?(?:employee|staff)|how\s*did\s*you\s*(?:hear|learn)\s*about|how\s*you\s*(?:heard|learned)\s*about|name\s*of\s*the\s*[\w\/]{0,24}\s*(?:staff|contractor|consultant|employee|colleague|relative|referrer)|able\s*to\s*start\s*(?:work|by|on)|start\s*working\s*(?:with|for)\s*us|how\s*much\s*(?:do\s*)?you\s*(?:currently\s*)?(?:earn|make)\b|(?:currently|presently)\s*earn)/i;
/**
 * A clause or sentence that asks the person for a fact no CV holds, in the
 * words FACTUAL's whole-label patterns miss (review of wave 4 round 2): when
 * they could start, what they expect or were paid, their references, any
 * gaps, where they live. Always the person's, wherever it sits. Mirrored from the
 * server.
 */
export const PERSON_ASKS = /\b(?:your|two|three|four|\d)\s+(?:professional\s+)?references?\b|\breferences?\s+(?:we|that\s+we|i)\s+(?:can|could|may)\s+(?:contact|call|reach)\b|\b(?:who|whom)\s+(?:we|i)\s+(?:can|could|may)\s+(?:contact|call|reach)\b|\bcontact\s+to\s+(?:confirm|verify)\b|\bany\s+(?:employment\s+)?gaps?\b|\bwhere\s+you\s+(?:currently\s+)?(?:live|reside|are\s+(?:based|located))\b|\b(?:how\s+soon|when)\s+(?:you\s+)?(?:could|can|would|will)\s+(?:you\s+)?(?:start|begin|join|be\s+available)\b|\b(?:able|free)\s+to\s+(?:start|begin|join)\b|\bthe\s+date\s+you\s+(?:can|could|would|will)\s+(?:start|begin|join)\b|\bearliest\b|\bhow\s+much\s+notice\b|\bnotice\s+(?:you|period)\b|\bpay\s+you\s+(?:expect|want|need|would\s+(?:accept|expect|want))\b|\bexpect(?:ed)?\s+to\s+(?:earn|make|be\s+paid)\b|\b(?:need|want|expect|like)\s+to\s+be\s+paid\b|\bwhat\s+you\s+(?:were|are|get|got)\s+paid\b|\bhow\s+much\s+(?:did\s+|do\s+)?you\s+(?:made|make|earn(?:ed)?)\b|\bwhat\s+you\s+earn(?:ed)?\b|\bwhat\s+you\s+made\s+(?:last\s+year|per\s+(?:year|hour|month|week)|a\s+(?:year|month|week|hour)|annually|in\s+your\s+(?:last|current|previous|most\s+recent)\s+(?:job|role|position))|\byour\s+(?:\w+\s+)?(?:earnings|income)\b/i;
/**
 * Legal and employment facts that are the person's in a clause of their own
 * ("... and any restrictive covenants") but may be the work's object
 * ("experience drafting restrictive covenants"), so they follow the clause
 * rule PROTECTED_FACTUAL follows. Mirrored from the server.
 */
export const PERSON_FACT_NOUNS = /\brestrictive\s+covenants?\b|\bnon-?(?:solicit\w*|compete\w*)\b|\bconflicts?\s+of\s+interest\b/i;
/** Facts about the person in the words the lists miss (fix 3): notice, earned or paid, pay, begin or join, someone to call, availability, hours, eligibility, where they live, travel, visas. Mirrored from the server. */
export const PERSON_FACT_WORDS = /\bnotice\b|\byou(?:'re|'ve|'d)?(?:\s+\w+){0,2}?\s+(?:earn(?:s|ed|ing)?|paid)\b|\btake[-\s]?home\b|\btook\s+home\b|\b(?:your|the|what|how\s+much|expected|desired|current|last|previous)\s+(?:\w+\s+){0,2}?pay\b(?![-\w])|\bexpect\s+you\s+to\s+(?:start|begin|join)\b|\btimeline\s+(?:for|to)\s+(?:start|begin|join)\w*|\b(?:start|begin|join)(?:ing)?\s+date\b|\bwhen\s+(?:you|we)\s+(?:could|can|would|will|might)\s+(?:\w+\s+){0,3}(?:start|begin|join)\b|\b(?:someone|anyone|somebody|people|persons?|who|whom)\s+(?:we|i)\s+(?:can|could|may|might|should)\s+(?:call|contact|reach|speak\s+(?:to|with)|talk\s+to|ask)\b|\byou\s+(?:are|'re|would\s+be|will\s+be)\s+(?:\w+\s+)?available\b|\bavailable\s+(?:to\s+(?:start|work|begin|join|relocate|travel|interview)|from|for\s+(?:work|full|part|an?\s+interview|interviews))\b|\bhours?\s+(?:per|a|each|every)\s+(?:week|day|month)\b|\bhow\s+many\s+hours\b|\beligib\w*|\byou(?:'re|\s+are|\s+have)?\s+(?:currently\s+)?(?:live|lived|living|reside|resided|residing|located|based)\b|\bwhere\s+(?:do|are|did|were)\s+you\s+(?:currently\s+)?(?:live|living|lived|reside|located|based|from)\b|\b(?:willing|able|open|prepared)\s+to\s+(?:travel|relocate|move|commute)\b|\bbusiness\s+trips?\b|\bvisas?\b|\blooking\s+for\s+(?:a\s+)?(?:new|another|next|different)\s+(?:job|role|position|opportunit\w*)|\bwhy\s+now\b|\b(?:part|full)[-\s]time\b|\badjustments?\s+(?:we|to|for|during|in)\b|\byour\s+(?:\w+\s+)?status(?:es)?\b/i;
/** A later sentence is its own question; a dotted initialism or "e.g." ends none. */
export const SENTENCE_BREAK = /[?!;]\s+|(?<=[a-z]{3})\.\s+(?=[A-Z])/;
/** Where one clause of a sentence ends and the next begins: a comma, a semicolon, an ampersand, a slash, a plus, a spaced dash, or a joining word. */
export const CLAUSE_BREAK = /(,|;|&|\/|\+|\s[^\p{L}\p{N}\s]{1,3}\s|\band\b|\bincluding\b|\bas\s+well\s+as\b|\bplus\b|\balong\s+with\b|\btogether\s+with\b)/iu;
/** A later clause about motivation. Mirrored from the server. */
export const MOTIVE_CLAUSE = /\b(?:excit\w*|interest\w*|attract\w*|appeal\w*|drew|draws|motivat\w*|inspir\w*|passion\w*|love|enjoy\w*|admire|mission|values?|culture|vision|company|our|opportunit\w*|goals?|career|grow\w*|learn\w*|contribut\w*|bring|fit)\b/i;
/** Work done told in the past by "you" (never a pay verb). Mirrored from the server. */
export const WORK_PAST = /\byou(?:'ve|\s+have|\s+had)?\s+(?:\w+ly\s+)?(?:(?!(?:receiv|earn|pai|ow|offer|promis|award|grant|need|want|requir|expect|prefer|plann|intend)ed\b)\w+(?<!e)ed|built|led|ran|did|done|drove|grew|won|wrote|taught|sold|brought|kept|met|spent|oversaw|overcame|undertook|saw|found|chose|became|began|knew)\b/i;
export const WORK_CLAUSE = new RegExp(WORK_PAST.source + /|\b(?:projects?|teams?|work|roles?|responsibilit\w*|clients?|customers?|tools?|results?|outcomes?|impact|approach|process(?:es)?|strateg\w*|skills?|stack|accounts?|pipeline|quotas?|deals?|campaigns?|products?|achievements?|accomplishments?|metrics|stakeholders|lessons?|examples?|challenges?|style|answer|response)\b|\byour\s+(?:biggest|greatest|proudest|best|most\s+\w+)\b/.source, "i");
/** A later clause that addresses the person is theirs unless it is visibly about work done (WORK_CLAUSE) or motivation (MOTIVE_CLAUSE). Mirrored from the server. */
export const ADDRESSES_PERSON = /\byou(?:rs?|rself)?\b/i;
/** A clause about the person's own circumstances, by grammar: a modal or a want after "you", a plan in progress, "your" current or expected anything. Mirrored from the server. */
export const PERSON_CIRCUMSTANCE = /\byou(?:'d\s+(?!like\b|love\b|enjoy\b)|'ll\b|(?:'re|\s+are)\s+(?:able|willing|available|leaving|moving|looking|planning|considering|expecting|currently)\b|\s+(?:would|could|can|will|might|may|should|must|shall|need|expect|require|prefer|plan|intend)\b(?!\s+(?:like|love|enjoy)\b))|\byour\s+(?:current|expected|desired|preferred|next|ideal|future|minimum|target)\b/i;
/** The question's own "do you have" right after the work words. Mirrored from the server. */
export const QUESTION_AUX = /^\s*(?:(?:do|did|would|will|can)\s+you\s+(?:have|had|bring|hold|possess)|(?:that\s+)?you(?:'ve|\s+have|\s+had))\b/i;
/** Words that point a clause at the person. Mirrored from the server. */
export const ASK_WORDS = /\b(?:any|whether|when|where|who|whom|how\s+(?:soon|much|many|long)|we\s+(?:can|could|may|might|should|will|would))\b/i;
/** Text after the work words that begins with a joiner: the work took no object of its own. Mirrored from the server. */
export const NO_OBJECT = /^\s*(?:[^\p{L}\p{N}\s("'“‘[]|(?:and|or|plus|including|as\s+well\s+as|along\s+with|together\s+with)\b|$)/iu;
/** A clause that asks something of the person: it names them, or tells them to do something. */
export const SECOND_ASK = /\byou(?:rs?)?\b|\b(?:list|provide|name|give|share|state|include|add|supply|tell|explain|describe|confirm|indicate|specify|mention)\b/i;
/** Words that make a protected noun the person's own state, not the work's object (S12-081). Mirrored from the server. */
export const PERSON_STATE = /\b(?:status(?:es)?|expectations?|requirements?|requir(?:ed|ing)|needs?|needed|needing|requested|details|eligibility|availability|preferences?|situation|history|records?|current(?:ly)?|present|expected|desired|minimum|preferred|own)\b/i;
/** What a factual question asks about, by topic. Mirrored from the server's TOPICS (self-apply.ts names the topic; the clause rule reads it). */
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
 * The exemption covers the work's own object only: a later sentence is read
 * against every factual list, history named before the work words is not the
 * work's object, nor is history in a later clause, nor a protected word in a
 * later clause that asks the person something. Since sweep S12-081 a
 * protected later clause also refuses after work words that took no object of
 * their own, or when it names the person's state (PERSON_STATE), and a
 * protected status named before the work words is not its object. Since the
 * recheck a later sentence naming any factual topic (topicOf) is its own
 * question, and a later clause naming one follows the clause rule. Since fix
 * 3 the first test does not depend on where a clause starts: PERSON_ASKS
 * anywhere is the person's, and a fact anywhere after the work words is the
 * work's object only when the work took an object first and nothing after it
 * points at the person. Mirrored from the server.
 */
export function asksAboutWorkDone(label: string): boolean {
  if (!RESUME_PROMPT.test(label) || !ABOUT_WORK_DONE.test(label) || OWN_STATUS.test(label)) return false;
  if (PERSON_ASKS.test(label)) return false;
  const [first, ...later] = label.split(SENTENCE_BREAK);
  // "Tell us about your experience. Green card holder?" is two questions.
  if (later.some((s) => mentionsPersonFact(s) || topicOf(s) !== "other" || PERSON_CIRCUMSTANCE.test(s))) return false;
  const work = ABOUT_WORK_DONE.exec(first!);
  if (!work) return false;
  const before = first!.slice(0, work.index);
  if (PERSONAL_HISTORY.test(before) || PERSON_FACT_WORDS.test(before)) return false;
  if ((PROTECTED_FACTUAL.test(before) || PERSON_FACT_NOUNS.test(before)) && PERSON_STATE.test(before)) return false;
  const rest = first!.slice(work.index + work[0].length).replace(QUESTION_AUX, " ");
  const tookObject = !NO_OBJECT.test(rest);
  if (mentionsPersonFact(rest) && (!tookObject || pointsAtPerson(rest))) return false;
  const parts = rest.split(CLAUSE_BREAK);
  for (let i = 2; i < parts.length; i += 2) {
    const clause = parts[i]!;
    if (PERSONAL_HISTORY.test(clause)) return false;
    if ((mentionsPersonFact(clause) || topicOf(clause) !== "other") && (!tookObject || pointsAtPerson(clause))) return false;
    if (PERSON_CIRCUMSTANCE.test(clause) && !WORK_PAST.test(clause)) return false;
    if (ADDRESSES_PERSON.test(clause) && !WORK_CLAUSE.test(clause) && !MOTIVE_CLAUSE.test(clause)) return false;
  }
  return true;
}

/** True when the text names a fact about the person anywhere, in any of the lists' words. Mirrored from the server. */
export function mentionsPersonFact(text: string): boolean {
  return FACTUAL.test(text) || PROTECTED_FACTUAL.test(text) || PERSONAL_HISTORY.test(text) || PERSON_ASKS.test(text) || PERSON_FACT_NOUNS.test(text) || PERSON_FACT_WORDS.test(text);
}

/** True when the text points at the person: "you" or "your", an instruction, a state of theirs, or a question word about them. Mirrored from the server. */
export function pointsAtPerson(text: string): boolean {
  return SECOND_ASK.test(text) || PERSON_STATE.test(text) || ASK_WORDS.test(text);
}

/** True when a prepared (model-written) draft must not answer this label. */
export function isProtectedQuestion(label: string): boolean {
  const l = String(label ?? "").replace(/\s+/g, " ").trim();
  return ((PROTECTED_FACTUAL.test(l) || PERSONAL_HISTORY.test(l) || PERSON_ASKS.test(l) || PERSON_FACT_NOUNS.test(l) || PERSON_FACT_WORDS.test(l)) && !asksAboutWorkDone(l)) || PROTECTED_DEMOGRAPHIC.test(l);
}
