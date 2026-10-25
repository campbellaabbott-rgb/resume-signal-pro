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
export const RESUME_PROMPT = /^\s*(?:(?:approximately|roughly|briefly|in\s+your\s+own\s+words|in\s+(?:a\s+few|one|two|three|\d+(?:\s*[-–]\s*\d+)?)\s+(?:words|sentences))[,:]?\s+)?(?:please\s+)?(?:describe|tell\s+(?:us|me)\s+about|explain|share|walk\s+(?:us|me)\s+through|discuss|elaborate\s+on|outline|give\s+(?:us\s+)?an?\s+example|what\s+(?:is|was)\s+your\s+experience|what\s+experience|how\s+many\s+(?:total\s+)?years\s+(?:of\s+)?(?:[\w/().-]+\s+){0,4}?experience|how\s+much\s+experience)\b/i;
export const ABOUT_WORK_DONE = /\b(?:experience[ds]?|accomplishments?|achievements?|worked|working\s+(?:with|on|in)|handl(?:ed|ing)|process(?:ed|ing)|car(?:ed|ing)\s+for|administer(?:ed|ing)|background\s+in|familiar(?:ity)?\s+with|knowledge\s+of)\b/i;
export const OWN_STATUS = /\b(?:have|has)\s+you\s+(?:ever\s+)?been\b|\bare\s+you\b|\byou\s+(?:have|are|were)\s+(?:ever\s+)?(?:been\s+)?(?:convicted|arrested|charged|pregnant|vaccinated)\b|\byour\s+(?:own\s+)?(?:age|citizenship|immigration\s+status|visa(?:\s+status)?|criminal|convictions?|medical|health|disabilit\w*|pregnan\w*|vaccination\s+status)\b|\bany\s+(?:criminal|convictions?|arrests?|pending\s+charges?|medical|health|disabilit\w*)|\b(?:convictions?|arrests?|criminal\s+(?:record|history|charges?)|(?:medical|health)\s+conditions?|disabilit\w*)\s+(?:that\s+)?you\b|\bconfirm\s+(?:that\s+)?you\b|\bwhether\s+you\b|\b(?:do|will|would)\s+you\s+(?:need|require|hold|submit)\b|\byour\s+(?:own\s+|current\s+|expected\s+|desired\s+)?(?:hourly\s+|day\s+|daily\s+)?(?:rate|wages?|pay|salary|remuneration)\b/i;
/**
 * The person's own history and circumstances, which no CV establishes:
 * termination, reasons for leaving, gaps, references, grades, commuting, days
 * on site, time zone and where they live, prior employment by or a previous
 * application to this employer. Mirrored from PERSONAL_HISTORY.
 */
export const PERSONAL_HISTORY = /(\b(?:been|ever\s+been|were\s+you|was\s+you)\s+(?:terminated|dismissed|fired|discharged|let\s+go|asked\s+to\s+resign|forced\s+to\s+resign)\b|\b(?:termination|dismissal)\s+(?:from|of\s+employment)\b|\breasons?\s+for\s+(?:leaving|departure|wanting\s+to\s+leave|your\s+(?:departure|leaving))\b|\bwhy\s+(?:are|did|do)\s+you\s+(?:want\s+to\s+)?(?:leav\w*|left|looking\s+to\s+leave)\b|\bgaps?\s+in\s+(?:your\s+)?(?:employment|work\s+history|career|cv|resume|résumé)\b|\bemployment\s+gaps?\b|\bcareer\s+(?:gap|break)s?\b|\bexplain\s+any\s+gaps?\b|\breferees?\b|\b(?:professional|personal|employment|work|character|employer)\s+references?\b|\b(?:list|provide|name|give|share|supply|include|add)\b[^?.]{0,40}\breferences?\b|^\s*references?\s*(?:$|[(:*])|\breferences?\s+(?:available|upon\s+request|contact|details|name)\b|\bgpa\b|\bgrade\s+point\s+average\b|\b(?:your|final|overall|average|cumulative|academic|university|college|degree|school)\s+(?:grades?|marks?)\b|\bclass\s+rank\b|\bdegree\s+classification\b|\bcommut\w*|\bon[-\s]?site\s+(?:\w+\s+){0,2}(?:days?|times?)\b|\b(?:\d|one|two|three|four|five)\s+days?\s+(?:a|per|each)\s+week\s+(?:in|at|on)\b|\b(?:work|be)\s+(?:on[-\s]?site|in\s+(?:the|our)\s+office)\b|\breturn\s+to\s+(?:the\s+)?office\b|\b(?:your|which|what)\s+(?:current\s+|home\s+|preferred\s+)?time\s*-?zones?\b|\btime\s*-?zones?\s+(?:are|do|would|will|can|you)\b|^\s*time\s*-?zones?\s*(?:$|[(:*?])|\b(?:in|within|with)\s+(?:the\s+)?(?:[\w-]+\s+){0,3}?time\s*-?zone\b(?!s)|\btime\s*-?zones?\s+(?:hours|overlap)\b|\bwhere\s+(?:are\s+you|do\s+you)\s+(?:currently\s+)?(?:located|based|live|living|reside)\b|\b(?:currently|presently)\s+(?:located|based|living|residing)\b|\b(?:previously|ever)\s+(?:been\s+)?(?:employed\s+by|worked\s+(?:for|at))\b|\bworked\s+(?:for|at|with)\s+(?:us|this\s+(?:company|organi[sz]ation|employer))\b|\b(?:former|previous|past)\s+employee\b|\bre-?hire\b|\beligible\s+for\s+rehire\b|\b(?:previously|ever|already)\s+applied\b|\bapplied\s+(?:(?:to|with)\s+(?:us|this\s+\w+|\w+)\s+|here\s+)?(?:before|previously)\b)/i;
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
export const PERSON_FACT_WORDS = /\bnotice\b(?<!\b(?:short|little|moment's|a\s+moment['’]s)\s+notice)|\byou(?:'re|'ve|'d)?(?:\s+\w+){0,2}?\s+(?:earn(?:s|ed|ing)?|paid)\b|\btake[-\s]?home\b|\btook\s+home\b|\b(?:your|the|what|how\s+much|expected|desired|current|last|previous)\s+(?:\w+\s+){0,2}?pay\b(?![-\w])|\bexpect\s+you\s+to\s+(?:start|begin|join)\b|\btimeline\s+(?:for|to)\s+(?:start|begin|join)\w*|\b(?:start|begin|join)(?:ing)?\s+date\b|\bwhen\s+(?:you|we)\s+(?:could|can|would|will|might)\s+(?:\w+\s+){0,3}(?:start|begin|join)\b|\b(?:someone|anyone|somebody|people|persons?|who|whom)\s+(?:we|i)\s+(?:can|could|may|might|should)\s+(?:call|contact|reach|speak\s+(?:to|with)|talk\s+to|ask)\b|\byou\s+(?:are|'re|would\s+be|will\s+be)\s+(?:\w+\s+)?available\b|\bavailable\s+(?:to\s+(?:start|work|begin|join|relocate|travel|interview)|from|for\s+(?:work|full|part|an?\s+interview|interviews))\b|\byou(?:'re|\s+are|\s+have)?\s+(?:currently\s+)?(?:live|lived|living|reside|resided|residing|located|based)\b|\bwhere\s+(?:do|are|did|were)\s+you\s+(?:currently\s+)?(?:live|living|lived|reside|located|based|from)\b|\b(?:willing|able|open|prepared)\s+to\s+(?:travel|relocate|move|commute)\b|\blooking\s+for\s+(?:a\s+)?(?:new|another|next|different)\s+(?:job|role|position|opportunit\w*)|\bwhy\s+now\b|\badjustments?\s+(?:we|to|for|during|in)\b|\beligib\w*\s+(?:to\s+work|for\s+(?:employment|work|rehire))\b|\b(?:are\s+you|you\s+are|you're)\s+(?:\w+\s+)?eligible\b|\bavailable\s+(?:to\s+mobili[sz]e|for\s+an?\s+(?:[\w-]+\s+){0,2}(?:internship|role|position|job|placement|contract))\b|\bcommit(?:ted)?\s+to\s+working\b|\b(?:go|going|travel\w*)\s+on\s+business\s+trips?\b|\bhours\s+(?:you\s+(?:are|'re)\s+(?:permitted|allowed|able)|per\s+(?:day|week),?\s+\d+\s+days)\b|\b(?:relationship|employment|work|student|family|tax|residency|residence|legal)\s+status\b|\bhave\s+you\s+(?:ever\s+)?been\s+employed\s+by\b/i;
/** A later sentence is its own question; a dotted initialism or "e.g." ends none. */
export const SENTENCE_BREAK = /[?!;]\s+|(?<=[a-z]{3})\.\s+(?=[A-Z])/;
/** Where one clause of a sentence ends and the next begins: a comma, a semicolon, an ampersand, a slash, a plus, a spaced dash, or a joining word. */
export const CLAUSE_BREAK = /(,|;|:|&|\/|\+|\s\(|\s[^\p{L}\p{N}\s]{1,3}\s|\band\b|\bincluding\b|\bas\s+well\s+as\b|\bplus\b|\balong\s+with\b|\btogether\s+with\b|(?<=\S\s)(?<!\b(?:from|of|in|on|at|with|for|to|about|into|by|through|across|over|under|within|and|or)\s)(?=your\b))/iu;
/** A later clause about motivation. Mirrored from the server. */
export const MOTIVE_CLAUSE = /\b(?:excit\w*|interest\w*|attract\w*|appeal\w*|drew|draws|motivat\w*|inspir\w*|passion\w*|love|enjoy\w*|admire|mission|values?|culture|vision|company|our|opportunit\w*|goals?|career|grow\w*|learn\w*|contribut\w*|bring|fits?|fitting|hope|want|wish|join\w*|appl(?:y|ying|ied)|founders?|leaders?|people|story|brand)\b/i;
/** Work done told in the past by "you" (never a pay verb). Mirrored from the server. */
export const WORK_PAST = /\byou(?:'ve|\s+have|\s+had)?\s+(?:\w+ly\s+)?(?:achieved|administered|advised|analy[sz]ed|arranged|assisted|audited|automated|beat|built|cared\s+for|chose|closed|coached|completed|conducted|cooked|coordinated|covered|created|delivered|deployed|designed|developed|did|directed|done|drafted|drove|established|evaluated|exceeded|executed|expanded|facilitated|found|founded|generated|grew(?!\s+up)|guided|handled|hired|hit|implemented|improved|increased|integrated|investigated|kept|launched|learned|learnt|led|looked\s+after|maintained|managed|mentored|met|navigated|negotiated|operated|optimi[sz]ed|organi[sz]ed|overcame|oversaw|owned|performed|planned|prepared|presented|prioriti[sz]ed|processed|produced|published|ran|reconciled|recruited|reduced|opened|repaired|reported|researched|resolved|reviewed|rolled\s+out|scaled|scheduled|secured|served|shipped|sold|solved|sourced|spent|started|streamlined|supervised|supported|surpassed|taught|tested|tracked|trained|traded|treated|tutored|undertook|used|won|worked|wrote)\b/i;
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
export const SECOND_ASK = /\byou(?:rs?|rself)?\b|\b(?:list|provide|name|give|share|state|include|add|supply|tell|explain|describe|confirm|indicate|specify|mention)\b/i;
/** Words that make a protected noun the person's own state, not the work's object (S12-081). Mirrored from the server. */
export const PERSON_STATE = /\b(?:status(?:es)?|expectations?|requirements?|requir(?:ed|ing)|needs?|needed|needing|requested|details|eligibility|availability|preferences?|situation|history|records?|current(?:ly)?|present|expected|desired|minimum|preferred|own)\b/i;
const FACT_LISTS = [FACTUAL, PROTECTED_FACTUAL, PERSONAL_HISTORY, PERSON_ASKS, PERSON_FACT_NOUNS, PERSON_FACT_WORDS];
export const FORMAT_NOTE = /\b(?:\d+(?:\s*[-–]\s*\d+)?\s+(?:words?|sentences?|paragraphs?|characters?|lines?)|(?:a\s+)?few\s+(?:words|sentences|lines)|one\s+(?:sentence|paragraph)|(?:word|character)\s+limit|limit\s*:|max(?:imum)?\s*(?:\d|:|of\b)|optional|briefly|concise|keep\s+(?:it|your\s+(?:answer|response)s?)\s+(?:short|brief))/i;
/** Mirrored from the server (fix 4): the default-deny clause rule's words. */
export const PERSON_LATER_WORDS = /\bhours?\s+(?:per|a|each|every)\s+(?:week|day|month)\b|\bhow\s+many\s+hours\b|\beligib\w*|\bbusiness\s+trips?\b|\bvisas?\b|\b(?:part|full)[-\s]time\b|\byour\s+(?:\w+\s+)?status(?:es)?\b/i;
export const WORK_NOUN = /^(?:projects?|teams?|work|roles?|librar(?:y|ies)|frameworks?|crms?|responsibilit(?:y|ies)|clients?|customers?|tools?|results?|outcomes?|impact|approach(?:es)?|process(?:es)?|strateg(?:y|ies)|skills?|stack|accounts?|pipelines?|quotas?|deals?|campaigns?|products?|achievements?|accomplishments?|metrics?|stakeholders?|lessons?|examples?|challenges?|style|experience|systems?|platforms?|technolog(?:y|ies)|programs?|initiatives?|scope|scale|size|volumes?|budgets?|methods?|methodolog(?:y|ies)|practices?|frameworks?|services?|solutions?|features?|decisions?|research|designs?|code|data|reports?|models?|sales|marketing|engineering|operations|management|leadership|support|analytics|development|interviews?|overtime|answer|response|languages?|environments?|settings?|industr(?:y|ies)|sectors?|wins?|successes|moments?|communication)$/i;
export const TOOL_NOUN = /\b(?:languages?|tools?|products?|crms?|frameworks?|librar(?:y|ies)|platforms?|systems?|stack|software|technolog(?:y|ies)|editors?|ides?)\b/i;
export const PLAIN_WORD = /^(?:a|an|the|your|my|our|their|its|this|that|these|those|some|each|every|all|both|of|in|on|at|for|with|to|from|by|about|into|through|over|across|within|per|via|and|or|but|plus|as|also|well|so|then|than|you|you've|you'd|you're|yourself|we|us|i|me|it|they|them|how|what|which|who|why|there|here|have|has|had|do|does|did|be|been|being|is|are|was|were|will|would|can|could|may|might|should|most|more|much|many|best|better|good|great|key|main|major|biggest|largest|greatest|proudest|recent|relevant|specific|particular|typical|successful|measurable|complex|technical|professional|overall|direct|directly|hands-on|personally|comfortable|like|etc|e\.g|eg|ie|include|including|describe|tell|share|explain|list|mention|add|give|provide|note|please|briefly|elaborate|walk|discuss|highlight|outline|summari[sz]e)$/i;
export const PERSONAL_NOUN = /\b(?:affiliations?|memberships?|personal|private|beliefs?|religio\w*|politic\w*|part(?:y|ies)|family|children|kids|spouse|marri\w*|injur\w*|illness\w*|allerg\w*|disabilit\w*|arrests?|convictions?|citations?|tickets?|violations?|accidents?|judg(?:e)?ments?|liens?|bankruptc\w*|debts?|lawsuits?|grievances?|disciplin\w*|suspensions?|unemployment|gaps?|breaks?|absences?|caregiving|childcare|birth\w*|hometown|address|earnings|income|hobb\w*|native\s+(?:language|tongue|speaker)|social\s+media|handles?|pets?|vacations?|nicknames?|friends?|relationships?|dating|parents?|siblings?|favou?rites?)\b/i;
export const ANY_PHRASE = /\bany\s+((?:[a-z][\w'-]*\s+){0,3}?[a-z][\w'-]*)(?=\s*(?:$|[^\w\s'-]|\s(?:you|that|which|who|whom|we|i|from|for|in|at|on|of|to|with|or|and|affecting|limiting|filed|against)\b))/i;
export const GOVERNOR = /\b(?:processing|handling|drafting|administering|preparing|negotiating|reviewing|filing|coordinating|conducting|collecting|auditing|tracking|investigating|litigating|screening|calculating|reconciling|issuing|verifying|enforcing|documenting|monitoring|analy[sz]ing|interpreting|translating|evaluating|assessing|advising|counsell?ing|giving|performing|payroll)\b/i;
export const WORK_OBJECT_AFTER = /^[\s-]*(?:[\w-]+\s+)?(?:petitions?|applications?|requests?|programs?|casework|cases|processing|filings?|compliance|audits?|records|paperwork|garnishments?|deductions?|screenings?|collections?|trackers?|law|polic(?:y|ies)|administration|claims?|checks|forms?|documentation|plans|reports?|reporting|calls|agreements?|contracts?|clauses?|code)\b/i;
export const PREP_PERSON = /\b(?:as|on)\s+(?:an?\s+)?(?:[\w-]+\s+)?$|\b(?:without|with\s+no|since|during|at\s+an?|while|whilst|under)\s+(?:an?\s+|the\s+)?(?:[\w-]+\s+){0,3}$/i;
export const YEARS_GAP = /\byears\s+(?:of\s+)?((?:[\w/().-]+\s+){1,4}?)experience\b/i;
export const GAP_PERSON = /\b(?:clear(?:ed|ance)|ts\s*\/\s*sci|secret|polygraph|military|active[-\s]duty|veteran|union|citizen\w*|resident|green\s+card|holder|opt|cpt|ead|since|you|age)\b/i;
export const ENDED = /\b(?:leaving|left|(?<!-)ended|moved\s+on|came\s+to\s+an\s+end|quit|resign\w*)\b/i;
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

/** Text that is only plain words, words of work or motivation, and words that describe a noun of work after them. Mirrored from the server. */
export function madeOfWork(text: string): boolean {
  let pending = 0;
  for (const raw of text.toLowerCase().replace(/’/g, "'").match(/[a-z][a-z0-9'.-]*/g) ?? []) {
    const w = raw.replace(/[.']+$/, "");
    if (WORK_NOUN.test(w)) pending = 0;
    else if (!PLAIN_WORD.test(w) && !MOTIVE_CLAUSE.test(w) && !/(?:ing|ed)$/.test(w)) pending++;
    else if (pending && !/^(?:a|an|the|our|their|its|of|in|on|for|to|with|at|by|from|about|across|into|within)$/.test(w)) return false;
  }
  return pending === 0;
}

/** "any" before a noun phrase that does not end on a noun of work asks the person. Mirrored from the server. */
export function anyAsk(text: string): boolean {
  const m = ANY_PHRASE.exec(text);
  return m !== null && !WORK_NOUN.test((m[1] ?? "").split(/\s+/).pop() ?? "");
}

/** Every fact the text names is the work's object. Mirrored from the server. */
export function factIsTheWork(text: string, carried = false): boolean {
  for (const re of [...FACT_LISTS, PERSON_LATER_WORDS]) {
    const m = re.exec(text);
    if (!m) continue;
    const before = text.slice(0, m.index);
    if (PREP_PERSON.test(before) || /^(?:on|as|without|since|during)\b/i.test(m[0]) || /\byour\b/i.test(text) || PERSON_STATE.test(text)) return false;
    if (!(carried || GOVERNOR.test(before) || WORK_PAST.test(text) || WORK_OBJECT_AFTER.test(text.slice(m.index).replace(/^\S+/, "")))) return false;
  }
  return true;
}

/** A later clause, sentence or hint sentence that is visibly work (or motivation). Mirrored from the server. */
export function workClause(clause: string, motive = false, carried = false, inList = false): boolean {
  const c = clause.trim();
  if (!c) return true;
  if (ENDED.test(c) || PERSONAL_HISTORY.test(c) || anyAsk(c) || PERSON_ASKS.test(c)) return false;
  const past = WORK_PAST.test(c);
  if (mentionsLaterFact(c)) return factIsTheWork(c, carried && /^[\w\s-]+$/.test(c.replace(/[()?!.:"“”]/g, "")) && c.split(/\s+/).length <= 3);
  // "the libraries you prefer" names tools; "the shift you prefer" is the person's.
  const tools = /\byou\s+(?:prefer|use|maintain)\b/i.test(c) && TOOL_NOUN.test(c) && madeOfWork(c.replace(/\byou\s+\w+/gi, " "));
  if (PERSON_CIRCUMSTANCE.test(c) && !past && !tools && !(motive && MOTIVE_CLAUSE.test(c))) return false;
  if (past || tools) return true;
  if (/\b(?:whether|when|where|how\s+(?:soon|much|many|long)|we\s+(?:can|could|may|might|should|will|would))\b/i.test(c)) return false;
  // A state of the person ("customers you are restricted from soliciting", "... / required"), unless it is their interest.
  const keen = /\byou(?:\s+are|'re)\s+(?:most\s+|so\s+|really\s+)?(?:interested|excited|passionate|drawn|motivated|inspired)\b/i.test(c);
  // "citation tools" names tools, not a citation of the person's.
  const own = (t: string) => PERSONAL_NOUN.test(t.replace(new RegExp(`${PERSONAL_NOUN.source}(?=\\s+${TOOL_NOUN.source})`, "gi"), ""));
  if ((own(c) && !carried) || (/\byou(?:\s+(?:are|were)|'re)\b/i.test(c) && !keen) || PERSON_STATE.test(c)) return false;
  if (madeOfWork(c)) return true;
  // A bare item of the list the work took ("internal tooling, dashboards, or data visualization views") is its object too, unless it is of the person's life.
  const b = c.replace(/[()?!.:"“”]/g, " ").trim();
  if (inList && /^[\w\s'-]+$/.test(b) && b.split(/\s+/).length <= 4 && !/\b(?:the|your|you|a|an|my|our|their|his|her)\b/i.test(b) && !PERSON_STATE.test(b) && (carried || !own(b))) {
    return carried || ["other", "education_results", "licence"].includes(topicOf(b));
  }
  return false;
}

/**
 * True when a protected word sits in a question about work done, which the model may draft.
 * The exemption covers the work's own object only: history or a protected
 * status before the work words or inside "how many years of ... experience"
 * is not its object, and every later clause and sentence must be work
 * (workClause, default-deny, fix 4). Mirrored from the server.
 */
export function asksAboutWorkDone(label: string): boolean {
  if (!RESUME_PROMPT.test(label) || !ABOUT_WORK_DONE.test(label) || OWN_STATUS.test(label)) return false;
  if (PERSON_ASKS.test(label)) return false;
  const gap = YEARS_GAP.exec(label)?.[1] ?? "";
  if (gap && (GAP_PERSON.test(gap) || ((mentionsPersonFact(gap) || PROTECTED_FACTUAL.test(gap)) && !factIsTheWork(gap)))) return false;
  const [first = "", ...later] = label.split(SENTENCE_BREAK);
  // "Tell us about your experience. Green card holder?" is two questions; "Keep it under 200 words." is none.
  const formatOnly = (s: string) => FORMAT_NOTE.test(s) && !mentionsLaterFact(s) && !/\byour?\b(?!\s+(?:answer|response)s?\b)/i.test(s);
  if (later.some((s) => !formatOnly(s) && s.split(CLAUSE_BREAK).some((c, i) => i % 2 === 0 && !workClause(c)))) return false;
  const work = ABOUT_WORK_DONE.exec(first);
  if (!work) return false;
  // History named before the work words is not the work's object, nor is a protected status.
  const before = first.slice(0, work.index);
  if (PERSONAL_HISTORY.test(before) || PERSON_FACT_WORDS.test(before)) return false;
  if ((PROTECTED_FACTUAL.test(before) || PERSON_FACT_NOUNS.test(before)) && PERSON_STATE.test(before)) return false;
  const rest = first.slice(work.index + work[0].length).replace(QUESTION_AUX, " ");
  const parts = rest.split(CLAUSE_BREAK);
  // parts: [the work's object, joiner, clause, joiner, clause, ...]
  const object = parts[0] ?? "";
  if (anyAsk(object) || ((PERSON_CIRCUMSTANCE.test(object) || /\byou\s+(?:were|are)\b/i.test(object)) && !WORK_PAST.test(object))) return false;
  // A fact in the work's own object is that object ("caring for pregnant patients", "with the US tax code") unless
  // something points it at the person: "your", their state, a question word, an amount, or "as a", "on a",
  // "without", "since", "during" before it ("years of experience on an H-1B visa").
  if (mentionsPersonFact(object) && (NO_OBJECT.test(rest) || pointsAtPerson(object) || /[$€£]\s?\d/.test(object) || !factIsTheWork(object, true))) return false;
  const weak = PERSON_LATER_WORDS.exec(object);
  if (weak && PREP_PERSON.test(object.slice(0, weak.index))) return false;
  const carried = GOVERNOR.test(object);
  // A list after a colon is a new ask ("in sales: employers, dates, and reasons for each move").
  let inList = true;
  for (let i = 2; i < parts.length; i += 2) {
    if (parts[i - 1] === ":") inList = false;
    if (!workClause(parts[i] ?? "", false, carried, inList)) return false;
  }
  return true;
}

/** True when the text names a fact about the person anywhere, in any of the lists' words. Mirrored from the server. */
export function mentionsPersonFact(text: string): boolean {
  return FACT_LISTS.some((re) => re.test(text));
}

/** The same, with the words that are facts only after the opening ask. Mirrored from the server. */
export function mentionsLaterFact(text: string): boolean {
  return mentionsPersonFact(text) || PERSON_LATER_WORDS.test(text);
}

/** True when the text points at the person: "you" or "your", an instruction, a state of theirs, or a question word about them. Mirrored from the server. */
export function pointsAtPerson(text: string): boolean {
  return SECOND_ASK.test(text) || PERSON_STATE.test(text) || ASK_WORDS.test(text);
}

/** True when a prepared (model-written) draft must not answer this label. A line break is a sentence break, and a bracketed format note is no part of the ask, as the server reads them. */
export function isProtectedQuestion(label: string): boolean {
  const l = String(label ?? "").replace(/([^\s.?!:;,])[ \t]*\r?\n\s*(?=\S)/g, "$1; ").replace(/\s+/g, " ").trim()
    .replace(/\s*\(([^()]*)\)/g, (note, inner: string) => (FORMAT_NOTE.test(inner) && !mentionsLaterFact(inner) && !/\byour?\b/i.test(inner) ? "" : note));
  return ((PROTECTED_FACTUAL.test(l) || PERSONAL_HISTORY.test(l) || PERSON_ASKS.test(l) || PERSON_FACT_NOUNS.test(l) || PERSON_FACT_WORDS.test(l)) && !asksAboutWorkDone(l)) || PROTECTED_DEMOGRAPHIC.test(l);
}
