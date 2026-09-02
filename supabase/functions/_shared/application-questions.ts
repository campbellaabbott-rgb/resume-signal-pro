export type QuestionClass =
  | "identity" | "file" | "demographic" | "factual" | "consent" | "draftable";
export interface AppQuestion {
  label: string;
  required?: boolean;
  type?: string;
}
const IDENTITY = /\b(first\s*name|last\s*name|full\s*name|legal\s*name|preferred\s*name|middle\s*name|e-?mail|phone|mobile|telephone|contact\s*number|street|zip|postal|linkedin|github|portfolio|personal\s*website|twitter|url)\b/i;
const IDENTITY_IF_FIELD = /\b(city|state|province|country|address|website|location)\b/i;
const OWN_ATTRIBUTE = /\byour\s+(?:current\s+|home\s+|primary\s+)?(?:city|state|province|country|address|website|location)\b/i;
const FILE = /\b(resume|résumé|cv|cover\s*letter|upload|attach|transcript|portfolio\s*file)\b/i;
const DEMOGRAPHIC = /\b(gender|sex|race|ethnic\w*|hispanic|latin[ox]|veteran|disab\w*|sexual\s+orientation|pronoun\w*|date\s+of\s+birth|marital|religio\w*|nationalit\w*|citizenship|national\s+origin)/i;
const CONSENT_DOC =
  /(privacy\s*(?:notice|policy|statement|declaration)|privacyverklaring|privacybeleid|datenschutz\w*|pol[ií]tica\s+de\s+privacidad|politique\s+de\s+confidentialit|data\s*protection|\bgdpr\b|\bccpa\b|terms\s*(?:and|&)\s*conditions|terms\s*of\s*(?:use|service)|algemene\s*voorwaarden|arbitration\s*agreement|non-?disclosure|\bnda\b|at[-\s]?will\s*employ\w*|(?:interview|call|meeting)\s*record(?:ing|ed)|notetaker|\bdo\s+you\s+consent\b|\bi\s+(?:hereby\s+)?consent\b|consent\w*\s*(?:to|for)\s*(?:the\s*)?(?:receiv|process|stor|retain|record|use)\w*|(?:process|collect|stor)\w*\s+(?:and\s+\w+\s+)?my\s+personal\s+(?:data|information)|persoonsgegevens|\bi\s+attest\b|\battest\s+that\b|accept\s+(?:all\s+)?(?:the\s+)?terms\b|autoriza\w*\s+que\s+seus\s+dados|\blgpd\b|동의|by\s+(?:typing|signing|submitting|selecting|checking|ticking|initial\w*|entering|clicking)\b[\s\S]{0,70}\b(?:i|you)\s+(?:hereby\s+)?(?:acknowledge|confirm|certify|agree|consent)|(?:i|you)\s+(?:hereby\s+)?(?:agree|confirm|certify|acknowledge)\b[\s\S]{0,90}\b(?:true\s+and\s+(?:correct|complete|accurate)|accurate\s+and\s+complete|truthful))/i;
const CONSENT_ATTEST =
  /(^\s*i\s+(?:hereby\s+)?(?:acknowledge|confirm|certify|agree|consent|understand)\b|^\s*you\s+(?:acknowledge|understand)\b|\byou\s+hereby\s+agree\b|\bdo\s+you\s+agree\s+to\s+this\b|acknowledge?ments?\s*$|\bconsent\s*$|please\s+confirm\b[\s\S]{0,30}\byou\s+are\s+(?:comfortable|available|willing|happy|aware|ok|okay)\b|confirm\s+(?:that\s+)?you\s+(?:have\s+)?read\b|are\s+you\s+comfortable\s+with\s+this\b|you\s+are\s+aware\s+of\s+(?:this|these)\b|confirmas\s+tu\s+disponibilidad|ik\s+heb\b[\s\S]{0,90}\bgelezen\b|ich\s+habe\b[\s\S]{0,90}\bgelesen\b|\bhe\s+le[ií]do\b|j['’]ai\s+lu\b|ga\s+(?:ik\s+)?akkoord|einverstanden|zustimm\w*|acepto\b)/i;
const FACTUAL = /(authoriz\w*\s*to\s*work|work\s*authoriz|legal\s*authoriz\w*|require\s*(?:visa\s*)?sponsor|sponsorship|need\s*sponsor|work\s*(?:visa|permit)|(?:need|require|hold|have)\s*(?:a\s*)?(?:valid\s*)?(?:work\s*|employment\s*)?visa|eligible\s*to\s*work|right\s*to\s*work|employment\s*eligib\w*|salary|compensation|desired\s*pay|expected\s*(?:pay|salary|compensation)|pay\s*expectation|notice\s*period|start\s*date|available\s*to\s*start|when\s*can\s*you\s*start|willing\s*to\s*relocate|relocat|able\s*to\s*commute|are\s*you\s*(?:at\s*least\s*)?18|legally\s*(?:eligible|authorized)|do\s*you\s*now\s*or\s*in\s*the\s*future|earliest\s*(?:possible\s*)?(?:date|start)|date\s*you\s*(?:could|can|would)\s*start|over\s*18|18\s*(?:years\s*)?(?:or\s*(?:older|above)|of\s*age)|legal\s*working\s*age|days\s*(?:are\s*)?you\s*available|what\s*days\s*[\w\s]{0,24}available|willing\s*to\s*travel|willing\s*to\s*work\s*(?:in|at)\s*(?:another|a\s*different)|licen[sc]e|security\s*clearance|dbs\s*check|background\s*check|criminal\s*(?:record|convict\w*)|referred\s*you|who\s*referred|close\s*relative|family\s*member|related\s*to\s*(?:any\s*)?(?:current\s*)?(?:employee|staff)|how\s*did\s*you\s*(?:hear|learn)\s*about|how\s*you\s*(?:heard|learned)\s*about|name\s*of\s*the\s*[\w\/]{0,24}\s*(?:staff|contractor|consultant|employee|colleague|relative|referrer)|able\s*to\s*start\s*(?:work|by|on)|start\s*working\s*(?:with|for)\s*us)/i;
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
  if (DEMOGRAPHIC.test(l) || DEMOGRAPHIC_INTL.test(l)) return "demographic";
  if (CONSENT_DOC.test(l)) return "consent";
  if (t.includes("file") || FILE.test(l) || FILE_INTL.test(l)) return "file";
  if (t === "email" || t === "phone" || t === "location" || t.includes("email") || t.includes("phone")) return "identity";
  const bare = l.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (bare === "name" || bare === "your name" || bare === "confirm your name") return "identity";
  if (/\bname$/.test(bare) && bare.split(" ").length <= 3) return "identity";
  if (IDENTITY.test(l) || IDENTITY_INTL.test(l)) return "identity";
  if (FACTUAL.test(l) || FACTUAL_INTL.test(l)) return "factual";
  if (CONSENT_ATTEST.test(l)) return "consent";
  if (IDENTITY_IF_FIELD.test(l) && (bare.split(" ").length <= 4 || OWN_ATTRIBUTE.test(l))) {
    return "identity";
  }
  return "draftable";
}
export function selectDraftable(questions: readonly AppQuestion[]): AppQuestion[] {
  return questions.filter((q) => classifyQuestion(q.label ?? "", q.type) === "draftable");
}
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
