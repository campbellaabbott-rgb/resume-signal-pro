/**
 * WHAT AN EMPLOYER'S OWN POSTING SAYS IT OFFERS, READ LINE BY LINE.
 *
 * The perk extractor behind company profiles (plan 2026-10-11, section 3).
 * It finds benefits sections from headings in twelve languages, matches 22
 * perk keys by pattern, vetoes duty contexts ("insurance verification",
 * "work nights, weekends and holidays"), and reads each hit as Y (offered),
 * Q (hedged or eligibility-limited) or N (explicitly not offered).
 *
 * PORTED UNCHANGED from the frozen prototype (sha1 c9c0cf6f, measured
 * 2026-10-11). Every decision below -- the patterns, the vetoes, the
 * negation and qualifier rules, the aggregation -- is the prototype's,
 * byte for byte. The port adds only:
 *   - two fields on each mention, `sentence` (the whole sentence the hit was
 *     found in) and `at` (where the hit starts in it), so a quote can be cut
 *     around the hit instead of at the sentence's first 200 characters;
 *   - the encoding the employer-profiles sweep stores (below `extract`):
 *     the bit order, the per-posting bitmasks, the quoted line per perk, the
 *     franchise-wording detector, and the publish rule's constants.
 *
 * MEASURED, on 99 held-out postings from 24 employers the prototype never saw
 * while it was tuned: micro precision 93% (272 of 293), recall 86% (272 of
 * 318). src/test/the-perk-reader-keeps-the-precision-it-was-measured-at.test.ts
 * pins those counts on the same postings, so a change here that moves any of
 * them fails by name.
 *
 * WHO MAY IMPORT IT: the employer-profiles function only. It never reaches
 * job-board, a description, a salary or a search field: benefit amounts are
 * not pay (Ramp's fertility HRA line reads as "$10,000 per year" to the
 * salary parser), and a perk list is not a search match. The same test file
 * holds that no other file imports this module.
 */

export type Status = "Y" | "Q" | "N";
export type PerkKey =
  | "health" | "dental" | "vision" | "life_dis" | "retire" | "pto" | "parental"
  | "flex" | "learning" | "equity" | "bonus" | "wellness" | "mental" | "childcare"
  | "relocation" | "visa" | "fourday" | "sabbatical" | "meals" | "commute"
  | "discount" | "generic";

export interface Mention {
  perk: PerkKey; status: Status; inSection: boolean; line: number; text: string; value?: number;
  /** The whole sentence the hit was read in (port addition; decides nothing). */
  sentence: string;
  /** Where the hit starts inside `sentence` (port addition; decides nothing). */
  at: number;
}
export interface Extraction { perks: Partial<Record<PerkKey, Status>>; values: Partial<Record<string, number>>; mentions: Mention[]; sectionLines: number[] }

// ── Section headings ────────────────────────────────────────────────────────
const BENEFIT_HEAD = new RegExp([
  String.raw`\bbenefits?\b`, String.raw`\bperks?\b`, String.raw`what we offer`, String.raw`we offer\b`, String.raw`our offer\b`,
  String.raw`offer you`, String.raw`in it for you`, String.raw`what you.ll (get|gain|receive|enjoy)`, String.raw`you.ll (get|enjoy)\b`,
  String.raw`why (join|work|you.ll love)`, String.raw`love (it )?(working )?here`, String.raw`total rewards`, String.raw`\brewards?\b`,
  String.raw`compensation\s*(&|and)\s*(benefits|perks)`, String.raw`(this|the) (role|position|job) offers`, String.raw`\bincentives\b`, String.raw`you.ll love working`, String.raw`how we.ll (help|support) you`,
  // DE
  String.raw`wir bieten`, String.raw`bieten wir`, String.raw`was wir (dir|ihnen) bieten`, String.raw`deine vorteile`, String.raw`ihre vorteile`,
  String.raw`unser angebot`, String.raw`das erwartet dich`, String.raw`was dich erwartet`, String.raw`darauf kannst du dich freuen`,
  // FR / ES / PT / IT / NL / Nordic / PL / LT
  String.raw`avantages`, String.raw`nous (vous )?offrons`, String.raw`ce que nous (vous )?offrons`, String.raw`ofrecemos`, String.raw`beneficios`,
  String.raw`oferecemos`, String.raw`benefícios`, String.raw`offriamo`, String.raw`cosa offriamo`, String.raw`wat (bieden )?wij( jou)?( bieden)?`,
  String.raw`wij bieden`, String.raw`arbeidsvoorwaarden`, String.raw`vi erbjuder`, String.raw`förmåner`, String.raw`vi tilbyr`, String.raw`vi tilbyder`,
  String.raw`oferujemy`, String.raw`benefity`, String.raw`mes siūlome`, String.raw`siūlome`,
].join("|"), "i");

const OTHER_HEAD = /^(requirements?|qualifications?|responsibilit|key responsibilities|duties|about (you|the role|us|the team|company)|who you are|your profile|what you.ll do|what you will do|the role|role|skills|essential|desirable|nice to have|how to apply|application|dein profil|ihr profil|deine aufgaben|ihre aufgaben|das bringst du mit|profil|missions?|tes missions|votre profil|requisitos|funciones|tus funciones|wat ga je doen|wie ben jij|om dig|om tjänsten|om oss|kvalifikationer|wymagania|obowiązki|zadania|equal opportunit|eeo|diversity|reasonable accommodation|recruitment process|our interview process|interview process)\b/i;

// ── Cues ────────────────────────────────────────────────────────────────────
const OFFER_CUE = /\b(apostamos|available|this role offers|profitier\w*|erhältst|bekommst|möglichkeit|genie(ß|ss)\w*|nutze|inklusive|freu dich|disfrut\w*|bénéfici\w*|we offer|offer(s|ed)?\b|offering|provid(e|es|ed|ing)|includ(e|es|ing)|enjoy|receive|eligible|eligibility|access to|you.ll (get|have|receive)|you will (get|have|receive)|benefits?|perks?|package|plus\b|generous|competitive|company.(paid|sponsored|funded)|employer.(paid|funded|sponsored)|paid by|subsidi[sz]ed|reimburse|stipend|allowance|match|contribution|bieten|erhältst|profitier|zuschuss|vergünstigt|gibt es|bekommst|offrons|bénéficie|ofrecemos|disfrut|oferecemos|offriamo|bieden|krijg|erbjud|förmån|oferujemy|zapewniamy|siūlome)\b/i;

// Context that marks a hit as part of the JOB, not the package.
const DUTY_CTX = /\b(experience (with|in)|knowledge of|familiar(ity)? with|understanding of|responsible for|process(es|ing)?\b(?! (of|for) (paid|parental))|verif(y|ication)|authori[sz]ation|claims?|billing|bills insurance|payer|health plan benefits|utili[sz]ation|members?\b|patients?\b|customers?\b|clients?\b|guests?\b|sell(ing)?|sales of|products?\b|policyholders?|underwrit|actuar|carrier|broker|enrol(l)?ment specialist|benefits? (analyst|administrat|specialist|manager|coordinator)|administer|administration of|hris|workday modules?|configuration|compliance with|in accordance with|regulations?|hipaa|medicare|medicaid|insurance (verification|companies|industry|domain)|pharmacy|clinical|prescri(be|ption authority)|training (material|session|sessions|program design|delivery)|deliver(ing)? training|develop(ing)? training|provide training|conduct(s)? training|coach(ing)? and train|attend(s)? (staff )?training|complete (all )?(required|assigned|mandatory|periodic)|mandatory .*training|certif(ied|ication) (required|preferred|in\b|as\b|by\b)|must (be|have|hold|obtain|possess)|required\b|preferred\b|ability to|able to|willing(ness)? to (relocate|travel|work)|should (have|be)|you have\b|you are\b|you bring|we are looking for|ideal candidate|candidates? (must|should|will))/i;

const NEG = /\b(no|not|non|never|without|unable|cannot|can.t|won.t|will not|does not|do not|don.t|isn.t|ineligible|unavailable|excluded|kein(e|en)?|nicht|ohne|pas de|n.est pas|ne .* pas|sin\b|não|nie\b|ingen|inte)\b/i;
const QUAL = /\b(may|might|could|eligible (full.time )?employees|for eligible|eligible full.time|based on eligibility|subject to|where (applicable|possible|appropriate)|if applicable|when possible|wherever possible|depending on|depends on|dependent on|varies|vary|certain (roles|positions|locations|employees)|some (locations|sites|roles|positions)|in some|full.time (employees|positions|roles|only|team members)|for full.time|part.time (employees|team members)|generally include|options? for|for those working|for most positions|t&cs|terms and conditions|selon|según|je nach|ggf\.|gegebenenfalls|nach vereinbarung|by arrangement|if needed|eligible)\b/i;

// ── Perk patterns ───────────────────────────────────────────────────────────
type Pat = { re: RegExp; strong?: boolean };
const P: Record<Exclude<PerkKey, "generic">, Pat[]> = {
  health: [
    { re: /\b(medical|health(care)?|hospital(i[sz]ation)?|prescription|rx)\s*(,|\/|&|and|\+)?\s*(dental|vision|insurance|coverage|plan|plans|benefits?|care plan|cover\b|premiums?)/i, strong: true },
    { re: /\b(private (medical|health)|health insurance|medical insurance|medical coverage|health coverage|health benefits|healthcare (plan|coverage|benefits|premiums?)|medical plans?|health plans?\b(?! benefits)|health cash plan|health savings account|\bhsa\b|\bfsa\b|flexible spending|health care plan|comprehensive health|medical, dental|medical and dental|telehealth|one medical membership|virtual gp|health packages)/i, strong: true },
    { re: /\b(krankenversicherung|krankenzusatzversicherung|zusatzversicherung|mutuelle|seguro (médico|de salud|de saúde)|plano de saúde|assicurazione sanitaria|zorgverzekering|sjukvårdsförsäkring|prywatna opieka medyczna|opieka medyczna|pakiet medyczny)/i, strong: true },
  ],
  dental: [{ re: /\b(dental|dentaire|dentist|tandvård|stomatolog)/i }],
  vision: [{ re: /\b(vision|optical|eye ?care|glasses|eyewear)\b(?!ary| statement|\s+(and|&)\s+strategy|\s+for\b|\s+of\b)/i }],
  life_dis: [{ re: /\b(life (insurance|assurance|cover)|ad&d|accident(al)? (insurance|death)|disability (insurance|coverage|benefits?)|(short|long).term disability|std\/ltd|income protection|critical illness|group insurance|ubezpieczenie (grupowe|na życie|od następstw)|lebensversicherung|unfallversicherung|seguro de vida|seguro de accidentes|prévoyance|försäkring(ar|slösningar)?|kollektivavtalade försäkringar|draudimą)/i }],
  retire: [
    { re: /\b(401\s?\(?k\)?|403\s?\(?b\)?|457\s?\(?b\)?|pension|retirement|superannuation|kiwisaver|provident fund|rrsp|dpsp|altersvorsorge|betriebsrente|bav\b|retraite|plan de pensiones|previdência|fondo pensione|pensioen|tjänstepension|pensjon|emerytal|\bppk\b|krankenkasse)/i },
  ],
  pto: [
    { re: /\b(paid time off|\bpto\b|vacation|annual leave|holiday(s)? (allowance|entitlement|pay)?|paid holidays?|days? off|time off|paid (sick|leave|days)|sick (leave|days|time|pay)|personal days|leave entitlement|days of leave|days.? holiday|urlaub(stage)?|freie tage|congés|\brtt\b|vacaciones|días libres|férias|ferie\b|vakantiedagen|vakantie|semester(rätt|dagar|trappa)?|give-me-a-break|urlop|birthday (off|is a holiday)|paid birthday|bereavement)/i },
  ],
  parental: [{ re: /\b(parental|maternity|paternity|family leave|new parent|bonding leave|caregiver leave|elternzeit|elterngeld|congé (parental|maternité|paternité)|permiso (de )?(maternidad|paternidad)|licença (maternidade|paternidade)|ouderschapsverlof|föräldraledig|urlop rodzicielski)/i }],
  flex: [
    { re: /\b(work(ing)? remotely|flexibilidad|flexibilität|von zu hause|flexible (working|work|hours|schedul\w*|arrangements?|time|start|part.time|environment)|flexi.?time|flextime|flextid|gleitzeit|flexible arbeitszeit\w*|flexibility (in|to|that works)|hybrid( (work|working|model|schedule|arrangement|policy|role))?\b|remote(-| )?(first|friendly|work(ing)?|option|role|position|employment|opportunit\w*)?|work(ing)? from (home|anywhere)|\bwfh\b|telework|homeoffice|home.office|mobiles? arbeiten|mobile working|workation|télétravail|teletrabajo|smart working|thuiswerk|distansarbete|praca (zdalna|hybrydowa)|shift.trade|compressed (work )?week|job ?sharing)/i },
  ],
  learning: [
    { re: /\b(learning\s*:|sprachkurse|language courses|tuition|education(al)? (assistance|reimbursement|support)|continuing education|professional development (budget|allowance|stipend|support|fund)|learning (budget|allowance|stipend|platform|and development|& development|opportunit\w*)|training (budget|programs?|provided|days)|paid training|full training|(training|coaching) and (mentorship|support|development)|we (provide|offer) (training|coaching)|study (grants?|leave)|scholarships?|cpd\b|ceus?\b|\bcme\b|certification (support|reimbursement)|support for .*certification|weiterbildung\w*|fortbildung\w*|schulungen|academy|formation(s)? (continue|professionnelle)?|formación|itinerario formativo|formazione|opleiding\w*|kompetensutveckling|szkolenia|upskilling|apprenticeship training|in-service training|e-?learning|udemy|linkedin learning|coursera)/i },
  ],
  equity: [{ re: /\b(equity|stock options?|share options?|stock (purchase|plan|award)|\brsus?\b|\bespp\b|\bvsop\b|esop|employee stock|shares?\b(?! (with|of|in|our|your|the|their|knowledge|ideas|best))|aktienoptionen|mitarbeiteraktien|mitarbeiterbeteiligung|compra de acciones|actions gratuites|azioni)/i }],
  bonus: [{ re: /\b(bonus(es)?|profit.?shar\w*|incentive (comp\w*|plan|program|bonus)|short.term incentive|annual incentive|performance (rewards?|pay|bonus)|sign.?on|signing bonus|retention (bonus|payment)|golden hello|(bonus|sales|uncapped|plus|base \+|eligible for|incentive|variable) commissions?\b|commissions? (plan|structure|earnings|on sales|or short.term|program)|variable (pay|compensation|commission)|13th (month|salary)|13\.? monatsgehalt|weihnachtsgeld|urlaubsgeld|sonderzahlung\w*|prämie\w*|prime(s)? (annuelle|de|d.)|intéressement|reparto de beneficios|participação nos lucros|premi(a|e) (świąteczne|roczna|kwartalna)?|dodatek urlopowy|dertiende maand|13e maand|bonuspolicy|årlig bonus|ote\b|on.target earnings)/i }],
  wellness: [{ re: /\b(wellness|well-?being (support|allowance|programs?|stipend|budget|days?|benefits?|platform|initiatives|resources|challenges)|gym|fitness|sport(s)? (club|plan|membership)|urban sports|egym|wellpass|hansefit|multisport|friskvård\w*|chiropract\w*|massage|masaże|health (and|&) wellness|health programs?|gesundheitsprogramm\w*|firmenfitness|betriebliches gesundheitsmanagement|sportplan|gimnasio|palestra)/i }],
  mental: [{ re: /\b(mental health|employee assistance|\beap\b|counsel(l)?ing|therapy|therapist|psycholog\w*|nilo\.health|headspace|calm app|spring health|lyra|modern health\b(?!care)|wellbeing support)/i }],
  childcare: [{ re: /\b(child ?care|daycare|day care|kindergarten|kita\b|kita-|crèche|creche|guardería|nursery|caregiving|kinderbetreuung|backup care|childcare (discount|subsidy))/i }],
  relocation: [{ re: /\b(relocation (support|package|assistance|expense|bonus|allowance|coverage)?|relocate|umzug(skosten|shilfe)|déménagement|reubicación|verhuiskosten)/i }],
  visa: [{ re: /\b(visa|sponsor(ship|ed|ing)?|work permit|work authori[sz]ation|immigration|right to work|aufenthaltstitel)/i }],
  fourday: [{ re: /\b(4.day (work ?)?week|four.day (work ?)?week|4.tage.woche|32.hour week|semaine de (4|quatre) jours)/i }],
  sabbatical: [{ re: /\b(sabbatical|career break|auszeit|sabbat)/i }],
  meals: [{ re: /\b(company restaurants?|betriebsrestaurant|meals?|lunch(es)?|snacks?|canteen|cafeteria|kantine|food (allowance|stipend)|catered|breakfast|essens.?zuschuss|essenszuschuss|verpflegung|tickets? restaurant|titres?.restaurant|ticket restaurante|buoni pasto|vale.(refeição|alimentação)|comedor|lunchvergoeding|obiad|maitinimą|free (fruit|drinks|beverages|coffee)|obst|getränke|coffee stipend)/i }],
  commute: [{ re: /\b(commut\w*|transit (pass|benefit|subsidy)|public transport\w*|transportation (benefit|subsidy|allowance)?|parking|bike (to work|leasing|scheme)|cycle to work|jobrad|dienstrad|fahrrad\w*|leasefiets|fietsplan|jobticket|deutschlandticket|öpnv|nahverkehr\w*|navigo|car (leasing|allowance)|company car|firmenwagen|dienstwagen|auto leasing|fuel (card|compensation)|mileage|septa|orca|travel loans?|season ticket|reiskosten\w*|kuro kompensacij\w*|įmonės transportu|collective transport|transport service)/i }],
  discount: [{ re: /\b(discount(s|ed)?|employee (pricing|deals|offers)|staff (discount|rates)|special (rates|conditions|offers)|corporate benefits|mitarbeiter(rabatt|vorteile|angebote)|rabatt\w*|sonderkonditionen|personalrabatt\w*|zniżk\w*|korting|futurebens|flight (privileges|benefits)|travel (perks|privileges)|free deliveroo|tickets at work|perks (program|platform)|condiciones especiales)/i }],
};

const GENERIC = /\b(benefits? (package|program|plan|page|summary|overview|available)|comprehensive (benefits|package)|competitive benefits|great benefits|our benefits|excellent benefits|range of benefits|employee benefits|voluntary benefits|benefits (and|&) (resources|perks)|attractive benefits|benefit(s)? (include|offered)|full benefits|benefits eligible|sozialleistungen|avantages sociaux|beneficios sociales|secundaire arbeidsvoorwaarden|förmånspaket)\b/i;

// Things that look like perks but are not (per taxonomy).
const VETO: Partial<Record<PerkKey, RegExp>> = {
  vision: /\b(eine vision|unsere vision|vision\s*:|vision (is|and|of|for|to|statement)|our vision|the vision|product vision|technical vision|long.term vision|clear vision|visionary|television|computer vision|vision ?language|visionstrategie)\b/i,
  equity: /\b(equity,? (diversity|inclusion)|diversity,? equity|equity (and|&) inclusion|health equity|equity research|private equity|equity (capital|markets?|analyst|investor|sponsor)|equitable|home equity|brand equity|pay equity|internal equity|equity considerations|i\.d\.e\.a|dei\b)/i,
  bonus: /\b(is a bonus|a bonus,? but|would be a bonus|bonus (points?|if)|nice.to.have|plus but|referral bonus|refer a friend|find your own job|empfehlung|mitarbeiter-bonus)\b/i,
  relocation: /\b(willing(ness)? to relocate|must (be willing to )?relocate|live near or be willing|open to (future )?relocation conversations|relocation (is )?(not )?required)\b/i,
  visa: /\b(visa (card|cards|network|inc)|visa\b.*\b(payments?|network|merchant)|form i-9|employment eligibility verification|immigration law|immigration (status|services) (client|case)|eligible to work in the uk|eligibility to gain|security clearance)\b/i,
  flex: /\b(remote (deployed|systems?|monitoring|patient|sites?|locations?|access|support|troubleshoot\w*|team members?)|hybrid (vehicles?|cloud|electric|publishers?|approach(es)?|project|model of care|set.?ups?)|flexib(le|ility) (qualifications|to work (different|any|nights|weekends|overtime|evenings))|must be flexible|be(ing)? flexible|flexible schedule, including|requires a flexible schedule|flexible hours, including|work flexible hours|flexible (warehouse|capacity)|remain flexible|ability to (work|be) flexib\w*|flexibility (to work|is important)|schedule flexibility to work|flexibel inzetbaar|prior remote work experience|remote (work )?experience|fully remote role)\b/i,
  learning: /\b(training (material|materials|sessions?|program design|delivery|content|coordinator|records|requirements)|trainer|attend (staff )?training|complete (all )?(required|assigned|mandatory|periodic)|mandatory .*training|security trainings|on the job training|knowledge is gained|training on (employee|the)|provide training (and|to)|deliver(ing)? (internal )?training|develop(ing)? training|coach and train|train (new employees|business teams|suppliers)|trains new|cross-training|training to the corresponding|training of basic|fellowship training|advanced training in|safety training required|cpr|scholarship prospects|licensing and training requirements|machine learning|deep learning|learning curves?|learning methods|learning experiences|student learning|learning disabilities|e.g\. trainings|trainings? (where|and when) required)\b/i,
  meals: /\b(meals?,? (and )?(naps|times|with young people|on wheels)|including meals|food (handling|service|safety|storage)|nutritious meals|prepare (meals|food))\b/i,
  commute: /\b(department of transportation|commuting distance|parking (lots?|areas?|garage operations)|transport(ation)? (of|for|industry|planning|logistics)|inbound\/outbound transport|reliable transportation|dependable transportation|own transport|public transportation (system|agency)|mileage (log|records))\b/i,
  discount: /\b((meal|food|childcare|child care|tuition|canteen|restaurant)s? (tuition )?discounts?|discounts? (in|at) (our )?(company )?(restaurants?|canteens?)|discount(ed)? (medical plan|rates? to (customers|guests))|price conflicts|discounted travel on available|discounts? (to|for) (customers|clients))\b/i,
  pto: /\b(work(ing)? (nights|weekends|evenings),? (and )?holidays|holidays? (coverage|shifts?)|public holidays\) \(e\)|available to work .*holidays|work .*holidays on a regular basis|including .*holidays,? as needed|split shifts|holiday (season|rush)|saving for a holiday|no (call|nights)|time off (requests|programs?) (management|administration)|absence (management|modules?)|vacations, and paid time off, telecommuting|maintains employee work schedules)\b/i,
  health: /\b(health (and|&) safety|health plan benefits|healthcare (organization|provider|industry|environment|delivery|utilization|experience|administration)|health (records?|information|needs|outcomes|system)|mental health (care|services|needs|social care|outcomes|conditions|service|nurse)|medical (equipment|records?|terminology|necessity|directors?|devices?|affairs|degree|license|office staff|care|tests|information|staff|technologies|patients)|insurance (verification|paperwork|processes)|health ?care (provider|center|organization)|occupational health|environmental health)\b/i,
  retire: /\b(retirement (communities|living|homes?|planning services for clients)|planning for retirement|pension (funds?|scheme) (clients|administration|industry)|super funds?)\b/i,
  childcare: /\b(childcare (provision|providers?|program administration|disqualification|setting|education)|licensed childcare|early childhood|nursery (practitioner|and reception|classes)|harlands primary school and nursery)\b/i,
  wellness: /\b(team member well-?being|guest and team member|financial well-?being|promoting independence, recovery, and wellbeing|emotional wellbeing|welfare of children|wellbeing of (children|patients|clients|residents)|physical wellness|wellness coaching)\b/i,
  mental: /\b(mental health (care|services|needs|social|outcomes|conditions|service|nurse|practitioner|centers?)|psychotherapy and counseling services|counseling services using|crisis counselor|counsel(l)?or\b|therapy (sessions|modalities|integrat)|behavior(al)? therapy \(cbt\) and|expert counsel)\b/i,
  parental: /\b(parental status|parental leave (policy|administration) for clients)\b/i,
  life_dis: /\b(disability (status|confident|or long-term|or special|discrimination)|insurance (claims|carrier|industry))\b/i,
};

function splitLines(text: string): string[] {
  return text.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}
function sentences(line: string): string[] {
  if (line.length < 260) return [line];
  return line.split(/(?<=[.!?;•])\s+(?=[A-Z0-9ÄÖÜÉ•\-–])/u).filter(Boolean);
}

function findSections(lines: string[]): Set<number> {
  const inSec = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const headingLike = l.length <= 90 && BENEFIT_HEAD.test(l) && !/[.!]$/.test(l.replace(/[:\s]+$/, "")) || /^(benefits?|perks|what we offer|we offer|wir bieten|oferujemy)\s*:?\s*$/i.test(l);
    // Inline "Benefits: x, y, z" also counts for that one line.
    if (/^(benefits?|perks|what we offer|we offer|compensation (&|and) benefits)\s*[:–-]\s*\S/i.test(l)) inSec.add(i);
    if (!headingLike) continue;
    inSec.add(i);
    for (let k = i + 1; k < Math.min(lines.length, i + 26); k++) {
      const m = lines[k];
      if (m.length <= 70 && OTHER_HEAD.test(m)) break;
      if (m.length <= 60 && /:\s*$/.test(m) && !BENEFIT_HEAD.test(m) && k > i + 1 && !/^(health|dental|vision|retirement|pto|time off|family|financial|wellness|work.?life|learning|perks|other|plus|and more)/i.test(m)) break;
      inSec.add(k);
    }
  }
  return inSec;
}

const PTO_DAYS = /(\d{1,2}(?:[.,]\d+)?)\s*(?:\+\s*)?(?:paid\s+)?(?:working\s+)?(days?|tage|dagen|dagar|días|jours|dni|giorni|weeks?)\b[^.\n]{0,40}?\b(vacation|holiday|annual leave|pto|paid time off|time off|leave|urlaub|vakantie|semester|vacaciones|congés|urlopu|ferie)|(?:vacation|annual leave|holiday|pto|urlaub)[^.\n]{0,25}?(\d{1,2})\s*(days?|tage|weeks?)/i;
const PARENTAL_WEEKS = /(\d{1,2})\s*weeks?[^.\n]{0,60}?(parental|maternity|paternity|primary caregiver|new parent|bonding)|(parental|maternity|paternity|new parent)[^.\n]{0,60}?(?:up to\s*)?(\d{1,2})\s*weeks?/i;
const RETIRE_PCT = /(\d{1,2}(?:[.,]\d+)?)\s?%[^.\n]{0,60}?(match|matching|pension|employer contribution|401|retire|emerytaln|składki)|(match\w*|contribution)[^.\n]{0,40}?(\d{1,2}(?:[.,]\d+)?)\s?%/i;

export function extract(title: string, description: string): Extraction {
  const lines = splitLines(`${title}\n${description}`);
  const sec = findSections(lines);
  const mentions: Mention[] = [];
  const leadQual = (i: number) => {
    // a hedge in the section lead-in ("Eligible full-time employees may receive:")
    for (let k = i - 1; k >= Math.max(0, i - 14); k--) {
      if (!sec.has(k)) break;
      if (lines[k].length < 200 && QUAL.test(lines[k]) && /:\s*$|include|receive|offer/i.test(lines[k])) return true;
    }
    return false;
  };
  for (let i = 0; i < lines.length; i++) {
    const inSection = sec.has(i);
    if (inSection && /^\W*(medical|health|healthcare|medical insurance)\W*$/i.test(lines[i])) mentions.push({ perk: "health", status: leadQual(i) ? "Q" : "Y", inSection, line: i, text: lines[i], sentence: lines[i], at: Math.max(0, lines[i].search(/medical|health/i)) });
    for (const s of sentences(lines[i])) {
      // split list-like sentences into clauses for negation scoping
      const clauses = s.split(/(?<=[;•·|])\s*|,\s+(?=(?:and |or )?[a-z])/i);
      for (const [perk, pats] of Object.entries(P) as [Exclude<PerkKey, "generic">, Pat[]][]) {
        for (const pat of pats) {
          const m = pat.re.exec(s);
          if (!m) continue;
          const veto = VETO[perk];
          if (veto && veto.test(s)) continue;
          // the clause holding the hit
          const clause = clauses.find((c) => pat.re.test(c)) ?? s;
          const pre = s.slice(Math.max(0, m.index - 28), m.index);
          const localNeg = /\b(no|not|without|non|kein\w*|sin|sans)\b[\s\w-]{0,14}$/i.test(pre);
          const negated = negationFor(perk, clause, s) || (localNeg && perk !== "visa");
          if (perk === "visa") {
            // visa is ONLY ever a negation or an explicit offer
            if (negated) { mentions.push({ perk, status: "N", inSection, line: i, text: s.slice(0, 200), sentence: s, at: m.index }); }
            else if (/\b(eligible for (visa )?sponsorship|(visa|sponsorship) (is )?(available|offered|provided|support)|will sponsor|we (can|do|will) sponsor|support (visa|sponsorship)|visa support)\b/i.test(s)) mentions.push({ perk, status: "Y", inSection, line: i, text: s.slice(0, 200), sentence: s, at: m.index });
            break;
          }
          if (negated) { if (perk === "flex" || perk === "relocation" || perk === "equity" || perk === "bonus") mentions.push({ perk, status: "N", inSection, line: i, text: s.slice(0, 200), sentence: s, at: m.index }); break; }
          // outside a benefits section a hit needs an offer cue and no duty context
          if (!inSection) {
            const listCluster = lines[i].length < 220 && countPerkHits(lines[i]) >= 2;
            const labelItem = /^[^:.!?]{2,42}\s?:\s+\S/.test(lines[i]) && !DUTY_CTX.test(lines[i]);
            if (DUTY_CTX.test(s) && !/\b(we offer|benefits (include|for this)|eligible for|you.ll (get|receive|enjoy)|offers? a|includes? (medical|health|a 401|paid))/i.test(s)) break;
            if (!OFFER_CUE.test(s) && !listCluster && !labelItem && !isShortListItem(lines, i)) break;
          }
          const q = QUAL.test(clause) || QUAL.test(s.slice(0, Math.max(0, s.search(pat.re)))) || leadQual(i);
          mentions.push({ perk, status: q ? "Q" : "Y", inSection, line: i, text: s.slice(0, 200), sentence: s, at: m.index });
          break;
        }
      }
    }
  }
  // aggregate: N wins only if there is no positive mention; Y beats Q.
  const perks: Partial<Record<PerkKey, Status>> = {};
  for (const m of mentions) {
    const cur = perks[m.perk];
    if (!cur) perks[m.perk] = m.status;
    else if (cur === "N" && m.status !== "N") perks[m.perk] = m.status;
    else if (cur === "Q" && m.status === "Y") perks[m.perk] = "Y";
  }
  const positives = Object.entries(perks).filter(([k, v]) => k !== "visa" && v !== "N").length;
  if (!positives && lines.some((l) => GENERIC.test(l) && !/\b(compensation, promotion, benefits|hiring, job assignment, compensation|benefits? (analyst|administrator|specialist|manager|coordinator)|health plan benefits|benefit risk|benefits everyone|realize benefits|benefit from|benefits, training|terms, conditions|benefits of|associated benefits|their benefits are received)\b/i.test(l))) perks.generic = "Y";
  const values: Partial<Record<string, number>> = {};
  const all = lines.join("\n");
  const pd = PTO_DAYS.exec(all); if (pd && perks.pto) { const n = parseFloat((pd[1] ?? pd[4] ?? "").replace(",", ".")); const unit = (pd[2] ?? pd[5] ?? "").toLowerCase(); if (n) values.pto_days = unit.startsWith("week") ? n * 5 : n; }
  const pw = PARENTAL_WEEKS.exec(all); if (pw && perks.parental) values.parental_weeks = parseInt(pw[1] ?? pw[4]);
  const rp = RETIRE_PCT.exec(all); if (rp && perks.retire) values.retire_pct = parseFloat((rp[1] ?? rp[4]).replace(",", "."));
  return { perks, values, mentions, sectionLines: [...sec] };
}

function countPerkHits(line: string): number {
  let n = 0;
  for (const [perk, pats] of Object.entries(P)) {
    if (perk === "visa") continue;
    if (pats.some((p) => p.re.test(line))) n++;
  }
  return n;
}
function isShortListItem(lines: string[], i: number): boolean {
  // a short bullet among neighbouring short bullets that also carry perk hits
  if (lines[i].length > 120) return false;
  let near = 0;
  for (let k = Math.max(0, i - 3); k <= Math.min(lines.length - 1, i + 3); k++) {
    if (k !== i && lines[k].length <= 140 && countPerkHits(lines[k]) >= 1) near++;
  }
  return near >= (lines[i].length < 90 ? 1 : 2);
}

function negationFor(perk: PerkKey, clause: string, sentence: string): boolean {
  if (perk === "visa") {
    return /\b(not (eligible for|available for|able to|provide|offer|sponsor)|(unable|cannot|can.t|won.t|will not|does not|do not|doesn.t|don.t) (to )?(provide |offer |support |take over )?(sponsor|visa)|without (the )?(need (for|of) )?(\w+ )?(visa |employment )?sponsorship|no (visa )?sponsorship|sponsorship (is )?(not|unavailable)|unavailable|not (be )?(able|provid)|must be (legally )?authori[sz]ed to work|authori[sz]ed to work (in|for) .*without|does not provide (any )?(such )?sponsorship|not require sponsorship|now or in the future (require|need)|eligible to work in)\b/i.test(sentence)
      && !/\beligible for visa sponsorship\b/i.test(sentence.replace(/not eligible for visa sponsorship/i, ""));
  }
  if (perk === "flex") return /\b(no remote|not (eligible for )?(a )?(fully )?(remote|hybrid)|not a remote|non.remote|do not offer remote|remote.only roles|telework is not|not guaranteed|fully on.?site|100% on.?site|on.?site only|in.?person only|no (remote|hybrid) (work )?opportunit|kein homeoffice|pas de télétravail)\b/i.test(sentence);
  if (perk === "relocation") return /\b(relocation (is )?not (available|offered|provided)|no relocation|not (eligible for|offering) relocation)\b/i.test(sentence);
  if (perk === "equity") return /\b(not eligible for (consideration for )?(an )?equity|no equity)\b/i.test(sentence);
  if (perk === "bonus") return /\b(not (eligible for|bonus.eligible)|no bonus)\b/i.test(clause);
  // generic: an explicit "not eligible for benefits"
  return /\b(not eligible for (any )?(benefits|insurance|medical|health|pto|paid time off|401)|no benefits|benefits (are )?not (offered|available|provided)|without benefits|ineligible for benefits)\b/i.test(clause);
}

// ── What the employer-profiles sweep stores (port addition) ─────────────────
//
// Nothing below changes what `extract` decides. It turns one extraction into
// the row the sweep writes: three bitmasks, one quoted line per perk, and two
// flags. The SQL side (migration 20261012110000) reads the same bit order from
// employer_profile_perk_publish, and a test holds the two lists equal.

/**
 * Bumped whenever a change in this file could change what a posting reads
 * as. The sweep re-reads every row stored under an older version.
 */
export const EXTRACTOR_VERSION = 1;

/** The bit each key occupies in the stored masks. Append only: a stored row is decoded by position. */
export const PERK_KEYS: readonly PerkKey[] = [
  "health", "dental", "vision", "life_dis", "retire", "pto", "parental", "flex", "learning", "equity", "bonus",
  "wellness", "mental", "childcare", "relocation", "visa", "meals", "commute", "discount", "sabbatical", "fourday", "generic",
];
export const PERK_BIT = Object.fromEntries(PERK_KEYS.map((k, i) => [k, i])) as Record<PerkKey, number>;

/**
 * The rows a rollup can carry: every positive key counted on its Y and Q
 * masks, and one stated limit counted on its N mask ("no visa sponsorship").
 */
export const ROLLUP_KEYS: ReadonlyArray<{ perk: string; bit: number; counts: "positive" | "negation" }> = [
  ...PERK_KEYS.map((k) => ({ perk: k as string, bit: PERK_BIT[k], counts: "positive" as const })),
  { perk: "visa_not_offered", bit: PERK_BIT.visa, counts: "negation" as const },
];

/**
 * The only keys a profile may ever show, each still only after it passes the
 * row audit (60 drawn rows, at least 57 right) and only for 45 days after its
 * last audit. Held-out precision on the labelled test split: health, dental,
 * vision, life/disability, retirement, parental leave and equity 100%, paid
 * time off 97%; the visa limit 9 of 10 (the tenth is a labelling error: that
 * posting does say it is not eligible for sponsorship).
 */
export const CANDIDATE_KEYS = ["health", "dental", "vision", "life_dis", "retire", "pto", "parental", "equity", "visa_not_offered"] as const;

/**
 * Withheld by name: never publishable, whatever an audit says. Flexible
 * working (69% held-out precision, and it would contradict the stated work
 * mode), mental health (63%), childcare (67%), discounts (75%), commuting
 * (82%), meals, bonus and learning (taken off the v1 list by review), the
 * "benefits exist" line, and positive visa offers (one example in the set).
 * The keys outside both lists (wellness, relocation, sabbatical, four-day
 * week) cannot publish either: only CANDIDATE_KEYS can.
 */
export const WITHHELD_KEYS = ["flex", "mental", "childcare", "discount", "commute", "meals", "bonus", "learning", "generic", "visa"] as const;

/** A country group needs minReadable readable postings; a perk row needs minStated of them, and a share of at least minShare. */
export const PERK_THRESHOLDS = { minReadable: 5, minStated: 2, minShare: 0.1 } as const;
/** A board whose readable postings carry franchise wording this often shows no perks at all. */
export const FRANCHISE_BOARD_SHARE = 0.3;
/** A publish flag older than this (since its last audit) is read as unpublished. */
export const PUBLISH_EXPIRY_DAYS = 45;
/** Shorter descriptions are "could not read", never "states nothing". */
export const READABLE_MIN_CHARS = 200;
/** The longest quoted line a row carries. */
export const QUOTE_MAX_CHARS = 200;

/**
 * Franchise wording, read per posting: each franchisee sets its own pay and
 * benefits, so a franchisee's posting says nothing about the brand. Hand
 * lists miss most franchise boards (they sit behind payroll-vendor ids), so
 * the posting's own words decide. "Independently owned" alone is not one:
 * an airline can be "the largest independently owned regional airline".
 */
const FRANCHISE_WORDING: RegExp[] = [
  /\bindependently owned (and|&) operated\b/i,
  /\bfranchise[- ]owned\b/i,
  /\bfranchisee\b[^.\n]{0,80}?\b(is|will be)\s+(your|the)\s+(only|sole)\s+employer\b/i,
  /\b(applying|apply) (for (work|a job|employment) )?(with|to) an? (independent )?franchisee\b/i,
  /\b(owned and operated|operated) by an? (independent )?franchisee\b/i,
  /\bfranchisees? (are|is) (an? )?independent (business )?(owners?|operators?|employers?)\b/i,
];

export function isFranchisePosting(text: string): boolean {
  return FRANCHISE_WORDING.some((re) => re.test(text));
}

/**
 * The quoted line for one mention: its whole sentence when that fits, else a
 * window around the hit cut at word boundaries, with an ellipsis where the
 * sentence goes on. Whitespace is already collapsed by the line splitter, so
 * what remains is the employer's own words in their own order.
 */
export function quoteOf(m: Mention, max = QUOTE_MAX_CHARS): string {
  const s = m.sentence;
  if (s.length <= max) return s;
  const at = Math.min(Math.max(0, m.at), s.length - 1);
  let start = Math.max(0, Math.min(at - 60, s.length - (max - 2)));
  let end = Math.min(s.length, start + max - 2);
  if (start > 0) {
    const sp = s.indexOf(" ", start);
    if (sp >= 0 && sp < at) start = sp + 1;
  }
  if (end < s.length) {
    const sp = s.lastIndexOf(" ", end);
    if (sp > at) end = sp;
  }
  return `${start > 0 ? "…" : ""}${s.slice(start, end).trim()}${end < s.length ? "…" : ""}`;
}

export interface PostingRead {
  /** The description was long enough to read (READABLE_MIN_CHARS). */
  readable: boolean;
  /** The posting carries franchise wording. */
  franchise: boolean;
  /** Bit i set: PERK_KEYS[i] read as Y / Q / N. A key carries at most one of the three. */
  y: number;
  q: number;
  n: number;
  /** One quoted line per bit, for the key's final status; null where the key was not read. */
  quotes: Array<string | null>;
}

/** One posting, read: what the sweep stores for it. */
export function readPosting(title: string, description: string | null | undefined): PostingRead {
  const text = description ?? "";
  const quotes: Array<string | null> = PERK_KEYS.map(() => null);
  const franchise = isFranchisePosting(`${title}\n${text}`);
  if (text.trim().length < READABLE_MIN_CHARS) return { readable: false, franchise, y: 0, q: 0, n: 0, quotes };
  const e = extract(title, text);
  let y = 0, q = 0, n = 0;
  for (const key of PERK_KEYS) {
    const status = e.perks[key];
    if (!status) continue;
    const bit = PERK_BIT[key];
    if (status === "Y") y |= 1 << bit;
    else if (status === "Q") q |= 1 << bit;
    else n |= 1 << bit;
    // The first mention carrying the final status, a benefits-section one first.
    const same = e.mentions.filter((m) => m.perk === key && m.status === status);
    const pick = same.find((m) => m.inSection) ?? same[0];
    if (pick) quotes[bit] = quoteOf(pick);
  }
  return { readable: true, franchise, y, q, n, quotes };
}
