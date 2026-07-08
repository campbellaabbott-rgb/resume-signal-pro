// Country-specific resume standards, transcribed from the Global Resume/CV
// Standards Report (52 countries, verified July 2026 against current
// recruiting sources incl. native-language ones). Keyed by ISO-3166 alpha-2 —
// deliberately by COUNTRY, not UI language: Spanish (ES vs LatAm), Portuguese
// (PT vs BR), French (FR vs CA) and English (US 1-page vs UK/AU/NZ 2-page)
// all split materially.
//
// Confidence flags come from the report: 'high' = multiple corroborating
// current sources; 'medium' = directionally correct, surfaced to users as
// soft guidance (CL, CO, PE, BE, GR, DK, FI, UA, KE, PK, MY).
//
// Photo norms are the highest-stakes rule (wrong advice actively harms:
// telling a Japanese user to drop the photo, or a US user to add one, are
// both damaging). We CANNOT detect photos from extracted text, so photo
// guidance is always advisory — never claimed as a detected finding.
//
// Pure data + deterministic text checks; no AI. Imported by the scan
// function and unit-tested from the frontend test suite.

export type PhotoNorm = "expected" | "common" | "optional" | "discouraged" | "never";

export interface CountryStandard {
  iso: string;
  name: string;
  confidence: "high" | "medium";
  paper: "Letter" | "A4" | "A4/B5 form";
  docTerm: string;
  lengthNote: string;
  photo: PhotoNorm;
  photoNote: string;
  personalDataNote: string;
  conventions: string[];
  /** MNC vs domestic employers follow different norms — advice shifts one
   *  notch toward Western-minimal for multinationals. */
  splitMarket?: boolean;
  /** Fixed/semi-fixed form markets where free-format resumes are a rejection
   *  risk — free-format scan advice needs this loud caveat. */
  structuredFormNote?: string;
  /** Deterministic boilerplate checks this market needs. */
  checks?: Array<"privacy_consent_it" | "rodo_pl" | "visa_status_gulf" | "references_expected">;
}

export const COUNTRY_STANDARDS: Record<string, CountryStandard> = {
  // ── North America ────────────────────────────────────────────────────────
  US: {
    iso: "US", name: "United States", confidence: "high", paper: "Letter", docTerm: "Resume",
    lengthNote: "1 page strongly preferred (2 max for senior)",
    photo: "never",
    photoNote: "Photos get resumes discarded — EEOC bias-liability practice. Do not include one.",
    personalDataNote: "No date of birth, marital status, nationality, or gender (Title VII / ADEA).",
    conventions: ["Achievement-driven bullets; ATS formatting critical", "'CV' means an academic document only"],
  },
  CA: {
    iso: "CA", name: "Canada", confidence: "high", paper: "Letter", docTerm: "Resume / CV",
    lengthNote: "2 pages is the accepted norm (1 entry-level, up to 3 executive)",
    photo: "never",
    photoNote: "Employers discard resumes with photos (human-rights codes). Do not include one.",
    personalDataNote: "None — Canadian Human Rights Act and provincial codes.",
    conventions: ["US structure but 2 pages accepted", "French required for Quebec employers; Canadian spelling"],
  },
  // ── Latin America ────────────────────────────────────────────────────────
  MX: {
    iso: "MX", name: "Mexico", confidence: "high", paper: "Letter", docTerm: "Curriculum Vitae",
    lengthNote: "1–2 pages",
    photo: "optional",
    photoNote: "Traditionally common; anti-discrimination guidance and tech/multinational employers now recommend none.",
    personalDataNote: "Traditional employers expect DOB/marital status; multinationals expect none. City-level address only.",
    conventions: ["The sharpest split is traditional-domestic vs multinational employer, not geography"],
    splitMarket: true,
  },
  BR: {
    iso: "BR", name: "Brazil", confidence: "high", paper: "A4", docTerm: "Currículo",
    lengthNote: "2–3 pages tolerated",
    photo: "discouraged",
    photoNote: "Recruiters advise against; a growing number of firms refuse photo CVs (exception: appearance-based roles).",
    personalDataNote: "Age/marital/children traditional but fading; never CPF/RG numbers.",
    conventions: ["'Objetivo' (target role) section is a strong convention", "More expressive tone than Portugal"],
  },
  AR: {
    iso: "AR", name: "Argentina", confidence: "high", paper: "A4", docTerm: "Curriculum Vitae",
    lengthNote: "1–2 pages",
    photo: "optional",
    photoNote: "Still habitual in much of the country, but Buenos Aires Law 6471 bars employers from requiring photos (or even name/address) — blind-CV mandate in CABA.",
    personalDataNote: "Trend to minimal: city, phone, email. ID/marital/age get requested later in the process.",
    conventions: ["Norms vary by province; CABA mandates blind-CV-compatible hiring"],
    splitMarket: true,
  },
  CL: {
    iso: "CL", name: "Chile", confidence: "medium", paper: "Letter", docTerm: "Curriculum Vitae",
    lengthNote: "1–2 pages",
    photo: "optional",
    photoNote: "Declining in line with anti-discrimination practice; anonymous CVs gaining ground.",
    personalDataNote: "City-level address, phone, email suffice; no ID/marital/age.",
    conventions: ["Modern Chilean guidance mirrors the international minimal-data format"],
    splitMarket: true,
  },
  CO: {
    iso: "CO", name: "Colombia", confidence: "medium", paper: "Letter", docTerm: "Hoja de vida",
    lengthNote: "1–2 pages",
    photo: "optional",
    photoNote: "Traditional in banking/formal sectors; optional in tech/startups.",
    personalDataNote: "Traditional formats carry personal data; modern guidance drops ID, marital status, age.",
    conventions: ["Called 'hoja de vida' locally", "Public-sector roles may use standardized formats"],
    splitMarket: true,
  },
  PE: {
    iso: "PE", name: "Peru", confidence: "medium", paper: "A4", docTerm: "Curriculum Vitae",
    lengthNote: "1–2 pages",
    photo: "common",
    photoNote: "Traditional employers commonly expect a photo; optional in tech.",
    personalDataNote: "DOB/nationality still common in traditional sectors.",
    conventions: ["'CV documentado' (with certificates attached) used for formal/public applications"],
    splitMarket: true,
  },
  // ── Western Europe ───────────────────────────────────────────────────────
  GB: {
    iso: "GB", name: "United Kingdom", confidence: "high", paper: "A4", docTerm: "CV",
    lengthNote: "2 pages standard",
    photo: "never",
    photoNote: "Not expected; discrimination risk under the Equality Act 2010.",
    personalDataNote: "No DOB — dropped since the Equality Act 2010.",
    conventions: ["'Personal Statement' instead of 'Professional Summary'", "British spelling; optional 'references on request'"],
  },
  IE: {
    iso: "IE", name: "Ireland", confidence: "high", paper: "A4", docTerm: "CV",
    lengthNote: "2 pages (max 3 senior)",
    photo: "never",
    photoNote: "Discouraged; can lead to automatic rejection under employment equality law.",
    personalDataNote: "No DOB, PPS number, marital status, or nationality.",
    conventions: ["UK-style conventions; two A4 pages standard"],
  },
  FR: {
    iso: "FR", name: "France", confidence: "high", paper: "A4", docTerm: "CV",
    lengthNote: "1 page (2 if 8+ years experience)",
    photo: "common",
    photoNote: "A professional headshot in the top corner remains standard, though legally optional.",
    personalDataNote: "État civil block traditional; age/DOB still frequent but optional.",
    conventions: ["'Titre' headline naming the target role", "Hobbies (centres d'intérêt) actually read", "Send PDF + lettre de motivation"],
  },
  DE: {
    iso: "DE", name: "Germany", confidence: "high", paper: "A4", docTerm: "Lebenslauf",
    lengthNote: "1–2 pages, tabular",
    photo: "common",
    photoNote: "Optional since AGG 2006 — employers may not demand one — but ~80% of applicants still include a photo and ~19% of recruiters sort out photo-less applications. Standard in the Mittelstand, fading in tech/startups.",
    personalDataNote: "DOB common; marital status declining.",
    conventions: ["Strict tabular layout; date + signature at the bottom traditional", "All gaps accounted for", "Full Bewerbung = cover letter + CV + Zeugnisse (certificates)"],
    splitMarket: true,
  },
  AT: {
    iso: "AT", name: "Austria", confidence: "high", paper: "A4", docTerm: "Lebenslauf",
    lengthNote: "1–2 pages, tabular",
    photo: "common",
    photoNote: "The DACH region has the strongest photo culture in Europe; nearly all CVs include one.",
    personalDataNote: "DOB commonly listed; conventions track Germany closely.",
    conventions: ["German-style tabular Lebenslauf", "Formal titles (Mag., Dipl.-Ing.) matter more than in Germany"],
  },
  CH: {
    iso: "CH", name: "Switzerland", confidence: "high", paper: "A4", docTerm: "Lebenslauf / CV",
    lengthNote: "1–2 pages",
    photo: "common",
    photoNote: "Photo customary (DACH culture), though international firms in Zurich/Geneva are increasingly neutral.",
    personalDataNote: "DOB, nationality, and work-permit status commonly listed (permit type matters to employers).",
    conventions: ["CV language follows the region (German/French/Italian)", "References/Arbeitszeugnisse valued"],
    splitMarket: true,
  },
  NL: {
    iso: "NL", name: "Netherlands", confidence: "high", paper: "A4", docTerm: "CV",
    lengthNote: "1–2 pages",
    photo: "optional",
    photoNote: "Historically common, now actively discouraged (blind-hiring trend, government guidance).",
    personalDataNote: "DOB declining; never marital status, religion, or BSN.",
    conventions: ["Understatement culture — factual, modest tone", "Hobbies section still fairly common"],
  },
  BE: {
    iso: "BE", name: "Belgium", confidence: "medium", paper: "A4", docTerm: "CV",
    lengthNote: "1–2 pages",
    photo: "common",
    photoNote: "No obligation, but photos are majority practice — a CV without one can look unusual to Belgian employers; both accepted.",
    personalDataNote: "DOB fairly common; other personal data declining.",
    conventions: ["Language choice is strategic: Dutch (Flanders), French (Wallonia), either/English in Brussels"],
  },
  // ── Southern Europe ──────────────────────────────────────────────────────
  ES: {
    iso: "ES", name: "Spain", confidence: "high", paper: "A4", docTerm: "Curriculum Vitae",
    lengthNote: "1–2 pages",
    photo: "common",
    photoNote: "A passport-style photo in the top corner is normal and widely expected; international firms increasingly omit.",
    personalDataNote: "DOB/nationality common; DNI/NIE still listed in formal sectors (public, finance, legal).",
    conventions: ["Languages section with levels (B2/C1) important"],
  },
  PT: {
    iso: "PT", name: "Portugal", confidence: "high", paper: "A4", docTerm: "Currículo",
    lengthNote: "1–2 pages",
    photo: "common",
    photoNote: "Professional headshot customary; declining under EU anti-discrimination practice.",
    personalDataNote: "DOB/nationality customary; marital status fading.",
    conventions: ["Conservative, EU-aligned, outcome-driven", "Europass known but no longer preferred by private-sector recruiters"],
  },
  IT: {
    iso: "IT", name: "Italy", confidence: "high", paper: "A4", docTerm: "Curriculum Vitae",
    lengthNote: "1–2 pages",
    photo: "common",
    photoNote: "Roughly 60–70% of CVs include a photo; common though not strictly required.",
    personalDataNote: "DOB/nationality common on traditional CVs.",
    conventions: ["Privacy-consent line authorizing personal-data processing (GDPR / D.Lgs. 196/2003) at the bottom — CVs without it are often filtered out"],
    checks: ["privacy_consent_it"],
  },
  GR: {
    iso: "GR", name: "Greece", confidence: "medium", paper: "A4", docTerm: "Βιογραφικό (CV)",
    lengthNote: "2+ pages tolerated",
    photo: "optional",
    photoNote: "Optional — skipping it does not hurt the application.",
    personalDataNote: "Personal data (DOB, nationality) still customary on traditional CVs.",
    conventions: ["CVs often run longer than northern-European norms", "Europass format widely recognized"],
  },
  // ── Nordics ──────────────────────────────────────────────────────────────
  SE: {
    iso: "SE", name: "Sweden", confidence: "high", paper: "A4", docTerm: "CV",
    lengthNote: "1–2 pages",
    photo: "optional",
    photoNote: "Becoming less common — anonymous recruitment initiatives have traction.",
    personalDataNote: "DOB/marital typically omitted; never personnummer.",
    conventions: ["Egalitarian tone — accomplishments stated matter-of-factly; overselling is culturally suspect", "Personligt brev (personal letter) usually accompanies"],
  },
  NO: {
    iso: "NO", name: "Norway", confidence: "high", paper: "A4", docTerm: "CV",
    lengthNote: "1–2 pages",
    photo: "optional",
    photoNote: "Not customary (anti-discrimination norms); never penalized if absent.",
    personalDataNote: "DOB sometimes present but declining; never fødselsnummer.",
    conventions: ["Concise, modest, competence-focused", "Short application letter (søknad) expected"],
  },
  DK: {
    iso: "DK", name: "Denmark", confidence: "medium", paper: "A4", docTerm: "CV",
    lengthNote: "1–2 pages",
    photo: "common",
    photoNote: "Danish-market sources report photos are now quite normal and often expected — notably more photo-friendly than Sweden/Norway — but a CV is never rejected for lacking one.",
    personalDataNote: "DOB occasionally present; never CPR number.",
    conventions: ["Danish CVs often open with a short profile", "Informal-but-precise tone typical"],
  },
  FI: {
    iso: "FI", name: "Finland", confidence: "medium", paper: "A4", docTerm: "CV",
    lengthNote: "1–2 pages",
    photo: "optional",
    photoNote: "Optional and declining.",
    personalDataNote: "DOB declining; never henkilötunnus.",
    conventions: ["Concise and factual", "Recruitment increasingly anonymized in the public sector"],
  },
  // ── Central/Eastern Europe ───────────────────────────────────────────────
  PL: {
    iso: "PL", name: "Poland", confidence: "high", paper: "A4", docTerm: "CV",
    lengthNote: "1–2 pages",
    photo: "common",
    photoNote: "Photos widely included — a CV without one can read as unfinished.",
    personalDataNote: "DOB common on traditional CVs.",
    conventions: ["RODO/GDPR data-processing consent clause at the bottom — many employers cannot process applications without it"],
    checks: ["rodo_pl"],
  },
  CZ: {
    iso: "CZ", name: "Czechia", confidence: "high", paper: "A4", docTerm: "Životopis (CV)",
    lengthNote: "1–2 pages",
    photo: "common",
    photoNote: "Customary (ID-style photo, top corner) and helps recruiters, but not mandatory — no application is rejected for lacking one.",
    personalDataNote: "DOB fairly common; other data declining.",
    conventions: ["Structured, tabular European style", "Cover letter customary"],
  },
  UA: {
    iso: "UA", name: "Ukraine", confidence: "medium", paper: "A4", docTerm: "Resume / Europass CV",
    lengthNote: "1–2 pages",
    photo: "optional",
    photoNote: "Optional; EU/international employers recommend omitting to avoid bias.",
    personalDataNote: "DOB common on traditional formats; minimal for international applications.",
    conventions: ["Europass format widely recognized (official Europass Ukraine program)", "English CVs common for international/IT roles"],
    splitMarket: true,
  },
  RU: {
    iso: "RU", name: "Russia", confidence: "high", paper: "A4", docTerm: "Резюме",
    lengthNote: "2 pages max",
    photo: "common",
    photoNote: "A formal head-and-shoulders portrait is customary; hh.ru lists it among recommended resume elements.",
    personalDataNote: "DOB commonly included; marital status voluntary and increasingly advised against; city-level address only.",
    conventions: ["Chronological format standard", "hh.ru template conventions dominate the domestic market"],
  },
  // ── Middle East ──────────────────────────────────────────────────────────
  TR: {
    iso: "TR", name: "Turkey", confidence: "high", paper: "A4", docTerm: "Özgeçmiş (CV)",
    lengthNote: "1–2 pages",
    photo: "common",
    photoNote: "A recent professional photo at the top is common and often expected.",
    personalDataNote: "Nationality, marital status, and age commonly included, unlike most of Europe.",
    conventions: ["Reverse-chronological standard", "Military-service status commonly listed for men"],
  },
  AE: {
    iso: "AE", name: "United Arab Emirates", confidence: "high", paper: "A4", docTerm: "CV",
    lengthNote: "1–2 pages",
    photo: "common",
    photoNote: "Photos expected for customer-facing/hospitality/corporate roles; some recruiters now prefer none.",
    personalDataNote: "Nationality, visa status, and DOB standard; marital status common but optional.",
    conventions: ["Visa status directly under contact info is critical: 'Employment Visa (Transferable)', 'Golden Visa', etc."],
    checks: ["visa_status_gulf"],
    splitMarket: true,
  },
  SA: {
    iso: "SA", name: "Saudi Arabia (GCC)", confidence: "high", paper: "A4", docTerm: "CV",
    lengthNote: "1–2 pages",
    photo: "common",
    photoNote: "Photo standard across the GCC, especially client-facing roles; optional for multinational/technical roles.",
    personalDataNote: "Nationality, Iqama/visa status, and DOB expected; family details common but optional.",
    conventions: ["Work-eligibility status (Iqama type, transferability) is the single most scanned field", "Arabic + English versions valued"],
    checks: ["visa_status_gulf"],
    splitMarket: true,
  },
  IL: {
    iso: "IL", name: "Israel", confidence: "high", paper: "A4", docTerm: "קורות חיים (CV)",
    lengthNote: "1 page (max 2)",
    photo: "optional",
    photoNote: "No legal or professional requirement — purely personal choice; recruiters do not reject CVs lacking one. Safe default: none (tech follows US norms).",
    personalDataNote: "Military service (IDF role/unit) is a standard section; DOB common.",
    conventions: ["Very short CVs prized; directness valued — minimal fluff"],
    splitMarket: true,
  },
  EG: {
    iso: "EG", name: "Egypt", confidence: "high", paper: "A4", docTerm: "CV",
    lengthNote: "1–2 pages",
    photo: "common",
    photoNote: "A professional photo is customary and improves chances per Arabic-language career sources; a minority advise omitting when not requested.",
    personalDataNote: "DOB, nationality, marital status commonly included; military-service status for men.",
    conventions: ["Formal layout", "English CVs standard in multinationals, Arabic for domestic/public roles"],
    splitMarket: true,
  },
  // ── Africa ───────────────────────────────────────────────────────────────
  ZA: {
    iso: "ZA", name: "South Africa", confidence: "high", paper: "A4", docTerm: "CV",
    lengthNote: "2–3 pages (traditional up to 5)",
    photo: "optional",
    photoNote: "Photo common but not universally expected.",
    personalDataNote: "ID number appears on traditional formats but is being phased out (identity-theft concerns); DOB still seen.",
    conventions: ["References listed directly on the CV and may be contacted pre-offer", "Longer CVs tolerated than global norms"],
    checks: ["references_expected"],
  },
  NG: {
    iso: "NG", name: "Nigeria", confidence: "high", paper: "A4", docTerm: "CV",
    lengthNote: "2–3 pages (traditional longer)",
    photo: "discouraged",
    photoNote: "Include only if the posting requests one; photos + DOB/religion now read as outdated.",
    personalDataNote: "DOB, religion, marital status, state of origin were standard historically — no longer expected in professional contexts.",
    conventions: ["References listed on the CV", "Market rapidly converging on international standards"],
    checks: ["references_expected"],
  },
  KE: {
    iso: "KE", name: "Kenya", confidence: "medium", paper: "A4", docTerm: "CV",
    lengthNote: "2 pages (max 3)",
    photo: "optional",
    photoNote: "Not expected in the corporate mainstream.",
    personalDataNote: "Minimal personal data in corporate/MNC applications; traditional formats carry more.",
    conventions: ["Nairobi corporate/tech market has shifted to international 2-page achievement-focused CVs", "References commonly listed"],
    checks: ["references_expected"],
    splitMarket: true,
  },
  // ── South Asia ───────────────────────────────────────────────────────────
  IN: {
    iso: "IN", name: "India", confidence: "high", paper: "A4", docTerm: "Resume / CV",
    lengthNote: "1 page fresher; 2–3 experienced",
    photo: "optional",
    photoNote: "Accepted and common domestically; omit for multinational applications.",
    personalDataNote: "DOB, marital status, sometimes parents' names traditional; fading for MNC roles.",
    conventions: ["'Declaration' + signature/date at bottom is traditional", "Education weighted heavily (percentages/CGPA)", "'Biodata' = older personal-data-heavy format"],
    splitMarket: true,
  },
  PK: {
    iso: "PK", name: "Pakistan", confidence: "medium", paper: "A4", docTerm: "CV / Resume",
    lengthNote: "1–2 pages",
    photo: "optional",
    photoNote: "Traditional CVs carried photos, but current Pakistani guidance advises omitting photo, CNIC, marital status, and religion unless the employer requires them.",
    personalDataNote: "Provide CNIC/domicile/DOB only when required; avoid father's name and religion on modern CVs.",
    conventions: ["Traditional format persists in the public sector", "English is the standard CV language"],
    splitMarket: true,
  },
  BD: {
    iso: "BD", name: "Bangladesh", confidence: "high", paper: "A4", docTerm: "CV / Biodata",
    lengthNote: "2–3 pages",
    photo: "common",
    photoNote: "Photo customary on domestic applications (bdjobs.com conventions).",
    personalDataNote: "DOB, address, family details (parents' names/occupations), signature — the traditional format is data-heavy.",
    conventions: ["Signature and date at the end customary", "English standard for professional CVs"],
    splitMarket: true,
  },
  // ── East Asia ────────────────────────────────────────────────────────────
  CN: {
    iso: "CN", name: "China", confidence: "high", paper: "A4", docTerm: "简历 (jiǎnlì)",
    lengthNote: "1–2 pages",
    photo: "expected",
    photoNote: "A professional headshot in the upper corner is standard across industries — a missing photo reads as incomplete.",
    personalDataNote: "DOB and gender expected; Party membership status relevant for government/SOE roles.",
    conventions: ["Chinese + English versions typically submitted", "Education pedigree heavily weighted"],
  },
  JP: {
    iso: "JP", name: "Japan", confidence: "high", paper: "A4/B5 form", docTerm: "履歴書 + 職務経歴書",
    lengthNote: "Fixed form + 1–3 pages",
    photo: "expected",
    photoNote: "A 4×3 cm photo is required on the rirekisho — applications without one are treated as incomplete.",
    personalDataNote: "Name, DOB, gender, address on the standardized JIS form; consistent calendar (Western or Japanese era) required.",
    conventions: ["Two-document system: rirekisho (standardized facts form) + shokumukeirekisho (free-format career history where achievements go)"],
    structuredFormNote: "Japan uses a government-standardized fixed form (rirekisho). A Western free-format resume is a common rejection cause — this scan's format advice applies to the shokumukeirekisho (career history), not the rirekisho.",
  },
  KR: {
    iso: "KR", name: "South Korea", confidence: "high", paper: "A4", docTerm: "이력서 + 자기소개서",
    lengthNote: "1–2 pages + essay",
    photo: "expected",
    photoNote: "A 3×4 cm photo top-right is standard; international firms may waive it.",
    personalDataNote: "DOB expected (age matters in seniority-driven workplaces); marital status NOT expected.",
    conventions: ["자기소개서 (self-introduction essay) often required alongside", "Education and exact dates emphasized"],
    structuredFormNote: "Korean applications pair the iryeokseo (structured resume) with a self-introduction essay. This scan's free-format advice applies mainly to international-firm applications.",
    splitMarket: true,
  },
  HK: {
    iso: "HK", name: "Hong Kong", confidence: "high", paper: "A4", docTerm: "CV / Resume",
    lengthNote: "2 pages max",
    photo: "optional",
    photoNote: "Not required for most roles — content and formatting matter more.",
    personalDataNote: "Minimal; expected salary and notice period are commonly stated when requested, unlike Western norms.",
    conventions: ["Reverse-chronological, concise; English standard", "Current/expected salary questions are routine in applications"],
  },
  TW: {
    iso: "TW", name: "Taiwan", confidence: "high", paper: "A4", docTerm: "履歷表",
    lengthNote: "1–2 pages",
    photo: "expected",
    photoNote: "Strong domestic norm — a 104 Job Bank survey found resumes with an appropriate photo get roughly 3× the interview chances, and no-photo resumes are often skipped. International firms neutral.",
    personalDataNote: "DOB and personal data common on domestic formats.",
    conventions: ["Distinctive 自傳 (zizhuan, autobiography essay) section expected by domestic employers", "104.com.tw template conventions dominate"],
    structuredFormNote: "Domestic Taiwanese employers expect 104-style templates plus the zizhuan essay — free-format Western resumes fit international firms only.",
    splitMarket: true,
  },
  // ── Southeast Asia ───────────────────────────────────────────────────────
  SG: {
    iso: "SG", name: "Singapore", confidence: "high", paper: "A4", docTerm: "Resume",
    lengthNote: "1–2 pages",
    photo: "never",
    photoNote: "MOM Fair Consideration Framework / TAFEP guidance: no photo, age, marital status, race, or religion.",
    personalDataNote: "Job-relevant information only, per TAFEP fair-hiring guidelines.",
    conventions: ["Most Westernized format in Asia; achievements + metrics valued", "Expected salary sometimes requested in postings"],
  },
  MY: {
    iso: "MY", name: "Malaysia", confidence: "medium", paper: "A4", docTerm: "Resume / CV",
    lengthNote: "1–2 pages",
    photo: "common",
    photoNote: "No legal restriction; photos common in practice and some application systems require one.",
    personalDataNote: "DOB/personal details fairly common but declining in MNCs.",
    conventions: ["JobStreet conventions dominate; English standard"],
    splitMarket: true,
  },
  ID: {
    iso: "ID", name: "Indonesia", confidence: "high", paper: "A4", docTerm: "CV / Daftar Riwayat Hidup",
    lengthNote: "1–2 pages",
    photo: "common",
    photoNote: "Photo still common practice (3×4 or 4×6); red/blue background conventional for formal/state (BUMN) applications, neutral for startups.",
    personalDataNote: "DOB, sometimes religion and marital status on traditional formats; startups/tech minimal.",
    conventions: ["Formal institutions (BUMN/government) keep traditional data-heavy formats; startup sector Westernized"],
    splitMarket: true,
  },
  TH: {
    iso: "TH", name: "Thailand", confidence: "high", paper: "A4", docTerm: "Resume",
    lengthNote: "1–2 pages",
    photo: "common",
    photoNote: "A formal photo in the top corner is customary; some companies may not consider photo-less resumes.",
    personalDataNote: "Age/DOB commonly included; traditional formats may carry more.",
    conventions: ["English resumes standard for professional roles in Bangkok; Thai for domestic/traditional employers"],
    splitMarket: true,
  },
  VN: {
    iso: "VN", name: "Vietnam", confidence: "high", paper: "A4", docTerm: "CV (+ sơ yếu lý lịch)",
    lengthNote: "1–2 pages",
    photo: "common",
    photoNote: "Photo customary; the full application dossier (hồ sơ xin việc) conventionally includes ~4 passport photos.",
    personalDataNote: "DOB and personal data common.",
    conventions: ["Formal employment requires the sơ yếu lý lịch — a notarized personal-history declaration — separate from the CV"],
    structuredFormNote: "Formal Vietnamese employment requires a notarized sơ yếu lý lịch (personal-history declaration stamped by the local People's Committee) alongside the CV — this scan covers only the CV.",
    splitMarket: true,
  },
  PH: {
    iso: "PH", name: "Philippines", confidence: "high", paper: "Letter", docTerm: "Resume",
    lengthNote: "1–2 pages",
    photo: "common",
    photoNote: "A 2×2-inch formal headshot (plain background, business attire) is expected for local applications; omit for international employers.",
    personalDataNote: "Age, civil status, sometimes SSS/TIN on local applications.",
    conventions: ["US-influenced format but retains a personal-data section", "2–3 named character references with contact info expected"],
    checks: ["references_expected"],
    splitMarket: true,
  },
  // ── Oceania ──────────────────────────────────────────────────────────────
  AU: {
    iso: "AU", name: "Australia", confidence: "high", paper: "A4", docTerm: "Resume / CV",
    lengthNote: "2–3 pages (grads 2)",
    photo: "never",
    photoNote: "Photos raise discrimination concerns under Equal Opportunity law; include only if explicitly requested.",
    personalDataNote: "No age, DOB, marital status, or full street address.",
    conventions: ["Longer than US norms", "Selection-criteria responses required for government roles"],
  },
  NZ: {
    iso: "NZ", name: "New Zealand", confidence: "high", paper: "A4", docTerm: "CV",
    lengthNote: "2 pages max (1 early-career)",
    photo: "never",
    photoNote: "Employers generally do not want photos.",
    personalDataNote: "No age, DOB, marital status, health, or nationality.",
    conventions: ["Concise, achievement-focused", "Personal-interests section fairly common"],
  },
};

// Wider-GCC countries follow the Saudi entry per the report ("Saudi Arabia
// and wider GCC").
for (const gcc of ["KW", "QA", "BH", "OM"]) {
  COUNTRY_STANDARDS[gcc] = { ...COUNTRY_STANDARDS.SA, iso: gcc, name: `${gcc === "KW" ? "Kuwait" : gcc === "QA" ? "Qatar" : gcc === "BH" ? "Bahrain" : "Oman"} (GCC)` };
}

// ── Deterministic text checks ───────────────────────────────────────────────
// These detect what text extraction CAN see. Photo presence cannot be
// detected from text, so photo norms surface as advisories only.

export interface CountryAdvisory {
  severity: "critical" | "warning" | "info";
  check: string;
  message: string;
}

export interface CountryStandardsResult {
  iso: string;
  country: string;
  confidence: "high" | "medium";
  docTerm: string;
  paper: string;
  lengthNote: string;
  photoNorm: PhotoNorm;
  photoAdvice: string;
  personalDataNote: string;
  conventions: string[];
  structuredFormNote?: string;
  splitMarketNote?: string;
  advisories: CountryAdvisory[];
}

const DOB_RE = /\b(date of birth|geburtsdatum|fecha de nacimiento|data de nascimento|data di nascita|date de naissance|дата рождения|生年月日|d\.o\.b\.?)\b\s*[:\-]?/i;
const MARITAL_RE = /\b(marital status|estado civil|familienstand|état civil|família:|기혼|未婚|已婚)\b/i;
const NATIONAL_ID_RE = /\b(ssn|social security number|cpf|rg\s*[:#]|dni|nie\s*[:#]|cnic|personnummer|fødselsnummer|henkilötunnus|cpr[-\s]?n|bsn|pps\s?number|aadhaar|national id)\b\s*[:\-]?/i;
const RODO_RE = /(wyrażam zgodę na przetwarzanie|rodo|art\.?\s?6\s?ust)/i;
const IT_CONSENT_RE = /(autorizzo il trattamento|d\.?\s?lgs\.?\s?(n\.?\s?)?196\/2003|gdpr\s?679\/2016|reg\.?\s?ue\s?2016\/679)/i;
const VISA_RE = /(visa status|iqama|work permit|employment visa|golden visa|residence permit|transferable visa|sponsorship status)/i;
const REFERENCES_RE = /(^|\n)\s*(references?|referees?)\s*[:\n]/i;
const PHOTO_MENTION_RE = /\b(photo|photograph|headshot|foto)\b/i;

export function evaluateCountryStandards(resumeText: string, countryCode: string | null): CountryStandardsResult | null {
  if (!countryCode) return null;
  const std = COUNTRY_STANDARDS[countryCode.toUpperCase()];
  if (!std) return null;

  const text = resumeText.slice(0, 60000);
  const advisories: CountryAdvisory[] = [];
  const soft = std.confidence === "medium";
  const softPrefix = soft ? "Directional guidance (fewer sources for this market): " : "";

  // Photo norm — advisory only (text extraction cannot see images).
  const photoSeverity: CountryAdvisory["severity"] =
    std.photo === "never" || std.photo === "expected" ? "critical" : std.photo === "optional" ? "info" : "warning";
  advisories.push({
    severity: soft && photoSeverity === "critical" ? "warning" : photoSeverity,
    check: "photo_norm",
    message: `${softPrefix}Photos on ${std.name} ${std.docTerm.toLowerCase()}s: ${std.photo.toUpperCase()}. ${std.photoNote} (We can't detect photos from extracted text — check your own document.)`,
  });

  // Personal-data leakage where it actively harms (photo-never markets share
  // the minimal-data norm).
  const minimalDataMarket = ["US", "CA", "GB", "IE", "AU", "NZ", "SG"].includes(std.iso);
  if (minimalDataMarket) {
    if (DOB_RE.test(text)) {
      advisories.push({ severity: "critical", check: "dob_present", message: `A date-of-birth line was found. In ${std.name}, DOB on a ${std.docTerm.toLowerCase()} is a discrimination-liability signal — remove it.` });
    }
    if (MARITAL_RE.test(text)) {
      advisories.push({ severity: "critical", check: "marital_present", message: `A marital-status line was found. ${std.name} employers expect no marital status — remove it.` });
    }
  }
  if (NATIONAL_ID_RE.test(text)) {
    advisories.push({ severity: "critical", check: "national_id_present", message: "A national ID / personal number pattern was found. Almost no market expects ID numbers on the document itself anymore (identity-theft risk) — provide them later in the process if asked." });
  }

  // Market-specific boilerplate the report flags as filter criteria.
  for (const check of std.checks ?? []) {
    if (check === "rodo_pl" && !RODO_RE.test(text)) {
      advisories.push({ severity: "critical", check, message: "No RODO/GDPR consent clause found. Many Polish employers legally cannot process applications without it — add the standard consent line at the bottom." });
    }
    if (check === "privacy_consent_it" && !IT_CONSENT_RE.test(text)) {
      advisories.push({ severity: "critical", check, message: "No privacy-consent line found ('Autorizzo il trattamento dei miei dati personali…'). Italian CVs without it are often filtered out — add it at the bottom." });
    }
    if (check === "visa_status_gulf" && !VISA_RE.test(text)) {
      advisories.push({ severity: "warning", check, message: "No visa/work-eligibility status found. In the Gulf, visa status directly under your contact info is the single most scanned field ('Employment Visa (Transferable)', Iqama type, etc.)." });
    }
    if (check === "references_expected" && !REFERENCES_RE.test(text)) {
      advisories.push({ severity: "warning", check, message: `No references section found. In ${std.name}, references are listed directly on the CV (unlike Western norms) and may be contacted before an offer.` });
    }
  }

  // Photo mention on a photo-never market: the one text-visible photo signal.
  if ((std.photo === "never") && PHOTO_MENTION_RE.test(text)) {
    advisories.push({ severity: "warning", check: "photo_mention", message: `The word 'photo' appears in your document. If a photo is attached or referenced: in ${std.name} that's a discard-risk — remove it.` });
  }

  return {
    iso: std.iso,
    country: std.name,
    confidence: std.confidence,
    docTerm: std.docTerm,
    paper: std.paper,
    lengthNote: std.lengthNote,
    photoNorm: std.photo,
    photoAdvice: std.photoNote,
    personalDataNote: std.personalDataNote,
    conventions: std.conventions,
    structuredFormNote: std.structuredFormNote,
    splitMarketNote: std.splitMarket
      ? "This market splits by employer type: multinationals follow Western minimal-data norms; domestic/public-sector employers keep traditional formats. Shift toward minimal if targeting a multinational."
      : undefined,
    advisories,
  };
}
