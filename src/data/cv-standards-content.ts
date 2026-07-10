// CV-standards SEO pages: per-country resume/CV norms, generated from the SAME
// COUNTRY_STANDARDS data the scanner applies when it evaluates a resume against
// a target market (supabase/functions/free-keyword-scan/country-standards.ts).
// English pages exist for every country; localized pages exist only for
// locale×country pairs listed in CV_LOCALES, with notes hand-translated from
// the English source (never machine-carpeted — quality gates indexation).
//
// Consumed by BOTH the React routes (src/pages/CvStandards.tsx) and the
// build-time prerender (scripts/prerender-seo.mjs), so keep it pure data.

export const COUNTRY_SLUGS: Record<string, string> = {
  US: "united-states", CA: "canada", MX: "mexico", BR: "brazil", AR: "argentina",
  CL: "chile", CO: "colombia", PE: "peru", GB: "united-kingdom", IE: "ireland",
  FR: "france", DE: "germany", AT: "austria", CH: "switzerland", NL: "netherlands",
  BE: "belgium", ES: "spain", PT: "portugal", IT: "italy", GR: "greece",
  SE: "sweden", NO: "norway", DK: "denmark", FI: "finland", PL: "poland",
  CZ: "czechia", UA: "ukraine", RU: "russia", TR: "turkey", AE: "united-arab-emirates",
  SA: "saudi-arabia", IL: "israel", EG: "egypt", ZA: "south-africa", NG: "nigeria",
  KE: "kenya", IN: "india", PK: "pakistan", BD: "bangladesh", CN: "china",
  JP: "japan", KR: "south-korea", HK: "hong-kong", TW: "taiwan", SG: "singapore",
  MY: "malaysia", ID: "indonesia", TH: "thailand", VN: "vietnam", PH: "philippines",
  AU: "australia", NZ: "new-zealand", KW: "kuwait", QA: "qatar", BH: "bahrain",
  OM: "oman",
};

export interface CvTemplateStrings {
  title: string; // {name}, {docTerm}
  metaDescription: string; // {name}, {docTerm}
  h1: string; // {name}
  intro: string; // {name}, {docTerm}
  docTermLabel: string;
  paperLabel: string;
  lengthLabel: string;
  photoLabel: string;
  personalLabel: string;
  conventionsLabel: string;
  photoNorms: Record<"expected" | "common" | "optional" | "discouraged" | "never", string>;
  faqPhoto: string; // {name}
  faqLength: string; // {name}
  ctaTitle: string;
  ctaText: string; // {name}
  ctaButton: string;
  sourceNote: string;
}

export interface LocalizedCountryContent {
  countryName: string;
  lengthNote: string;
  photoNote: string;
  personalDataNote: string;
  conventions: string[];
}

export interface CvLocaleConfig {
  htmlLang: string;
  pathBase: string; // URL prefix, e.g. "es/normas-cv"
  slugs: Record<string, string>; // ISO → localized country slug
  t: CvTemplateStrings;
  content: Record<string, LocalizedCountryContent>;
}

export const EN_TEMPLATE: CvTemplateStrings = {
  title: "CV Rules in {name}: Photo, Length, Format",
  metaDescription:
    "Photo norms, expected length, and personal-data rules for a {docTerm} in {name} — the live standards our resume scanner applies for that market.",
  h1: "CV & resume standards in {name}",
  intro:
    "This is the live market data our scanner applies when a resume targets {name} — not an opinion piece. The local document is the {docTerm}; here is what employers there actually expect.",
  docTermLabel: "What the document is called",
  paperLabel: "Paper size",
  lengthLabel: "Expected length",
  photoLabel: "Photo on the CV?",
  personalLabel: "Personal data conventions",
  conventionsLabel: "Market conventions",
  photoNorms: {
    expected: "Expected — omitting one hurts",
    common: "Common — most applicants include one",
    optional: "Optional — either is accepted",
    discouraged: "Discouraged — most advice says omit",
    never: "Never — including one can disqualify you",
  },
  faqPhoto: "Should a CV in {name} include a photo?",
  faqLength: "How long should a CV be in {name}?",
  ctaTitle: "Check your resume against these standards",
  ctaText:
    "The free scan evaluates your resume against {name}'s norms automatically — photo expectations, personal-data conventions, length, and the keywords your industry expects.",
  ctaButton: "Scan my resume free",
  sourceNote:
    "Source: the country-standards engine of this site's resume scanner. When the engine's data improves, this page updates with it.",
};

const ES_T: CvTemplateStrings = {
  title: "Normas de CV en {name}: foto, extensión y formato",
  metaDescription:
    "Normas de foto, extensión y datos personales para un {docTerm} en {name} — los estándares reales que aplica nuestro escáner.",
  h1: "Normas de currículum en {name}",
  intro:
    "Estos son los datos reales que nuestro escáner aplica cuando un currículum apunta a {name} — no es un artículo de opinión. El documento local es el {docTerm}; esto es lo que los empleadores esperan.",
  docTermLabel: "Cómo se llama el documento",
  paperLabel: "Tamaño de papel",
  lengthLabel: "Extensión esperada",
  photoLabel: "¿Foto en el CV?",
  personalLabel: "Datos personales",
  conventionsLabel: "Convenciones del mercado",
  photoNorms: {
    expected: "Esperada — omitirla perjudica",
    common: "Común — la mayoría la incluye",
    optional: "Opcional — ambas opciones se aceptan",
    discouraged: "Desaconsejada — la recomendación general es omitirla",
    never: "Nunca — incluirla puede descalificarte",
  },
  faqPhoto: "¿Debe llevar foto un CV en {name}?",
  faqLength: "¿Cuánto debe medir un CV en {name}?",
  ctaTitle: "Comprueba tu currículum contra estas normas",
  ctaText:
    "El escaneo gratuito evalúa tu currículum según las normas de {name} automáticamente — expectativas de foto, datos personales, extensión y las palabras clave de tu sector.",
  ctaButton: "Escanear mi currículum gratis",
  sourceNote:
    "Fuente: el motor de normas por país del escáner de esta web. Cuando los datos del motor mejoran, esta página se actualiza.",
};

const FR_T: CvTemplateStrings = {
  title: "Normes de CV en {name} : photo, longueur, format",
  metaDescription:
    "Photo, longueur et données personnelles pour un {docTerm} en {name} — les normes réelles qu'applique notre scanner.",
  h1: "Normes de CV en {name}",
  intro:
    "Ce sont les données réelles que notre scanner applique quand un CV vise {name} — pas un article d'opinion. Le document local est le {docTerm} ; voici ce que les employeurs attendent.",
  docTermLabel: "Nom du document",
  paperLabel: "Format papier",
  lengthLabel: "Longueur attendue",
  photoLabel: "Photo sur le CV ?",
  personalLabel: "Données personnelles",
  conventionsLabel: "Conventions du marché",
  photoNorms: {
    expected: "Attendue — l'omettre pénalise",
    common: "Courante — la plupart des candidats en mettent une",
    optional: "Optionnelle — les deux sont acceptés",
    discouraged: "Déconseillée — la recommandation générale est de l'omettre",
    never: "Jamais — en inclure une peut vous disqualifier",
  },
  faqPhoto: "Faut-il une photo sur un CV en {name} ?",
  faqLength: "Quelle longueur pour un CV en {name} ?",
  ctaTitle: "Vérifiez votre CV contre ces normes",
  ctaText:
    "Le scan gratuit évalue votre CV selon les normes de {name} automatiquement — photo, données personnelles, longueur et les mots-clés de votre secteur.",
  ctaButton: "Scanner mon CV gratuitement",
  sourceNote:
    "Source : le moteur de normes par pays du scanner de ce site. Quand les données du moteur s'améliorent, cette page se met à jour.",
};

const DE_T: CvTemplateStrings = {
  title: "Lebenslauf in {name}: Foto, Länge, Format",
  metaDescription:
    "Foto-Normen, Länge und persönliche Daten für einen {docTerm} in {name} — die realen Standards unseres Scanners.",
  h1: "Lebenslauf-Standards in {name}",
  intro:
    "Das sind die echten Marktdaten, die unser Scanner anwendet, wenn ein Lebenslauf auf {name} zielt — kein Meinungsartikel. Das lokale Dokument ist der {docTerm}; das erwarten Arbeitgeber dort.",
  docTermLabel: "Name des Dokuments",
  paperLabel: "Papierformat",
  lengthLabel: "Erwartete Länge",
  photoLabel: "Foto im Lebenslauf?",
  personalLabel: "Persönliche Daten",
  conventionsLabel: "Marktkonventionen",
  photoNorms: {
    expected: "Erwartet — Weglassen schadet",
    common: "Üblich — die meisten Bewerber fügen eines bei",
    optional: "Optional — beides wird akzeptiert",
    discouraged: "Nicht empfohlen — die gängige Empfehlung ist, es wegzulassen",
    never: "Niemals — ein Foto kann zur Aussortierung führen",
  },
  faqPhoto: "Braucht ein Lebenslauf in {name} ein Foto?",
  faqLength: "Wie lang sollte ein Lebenslauf in {name} sein?",
  ctaTitle: "Prüfen Sie Ihren Lebenslauf gegen diese Standards",
  ctaText:
    "Der kostenlose Scan bewertet Ihren Lebenslauf automatisch nach den Normen von {name} — Foto-Erwartungen, persönliche Daten, Länge und die Keywords Ihrer Branche.",
  ctaButton: "Lebenslauf kostenlos scannen",
  sourceNote:
    "Quelle: die Länder-Standards-Engine des Scanners dieser Website. Verbessern sich die Daten der Engine, aktualisiert sich diese Seite mit.",
};

const PT_T: CvTemplateStrings = {
  title: "Currículo em {name}: foto, extensão e formato",
  metaDescription:
    "Normas de foto, extensão e dados pessoais para um {docTerm} em {name} — os padrões reais do nosso scanner.",
  h1: "Padrões de currículo em {name}",
  intro:
    "Estes são os dados reais que nosso scanner aplica quando um currículo mira {name} — não é um artigo de opinião. O documento local é o {docTerm}; isto é o que os empregadores esperam.",
  docTermLabel: "Como o documento se chama",
  paperLabel: "Tamanho do papel",
  lengthLabel: "Extensão esperada",
  photoLabel: "Foto no currículo?",
  personalLabel: "Dados pessoais",
  conventionsLabel: "Convenções do mercado",
  photoNorms: {
    expected: "Esperada — omitir prejudica",
    common: "Comum — a maioria inclui",
    optional: "Opcional — ambas as opções são aceitas",
    discouraged: "Desaconselhada — a recomendação geral é omitir",
    never: "Nunca — incluir pode desqualificar",
  },
  faqPhoto: "Um currículo em {name} deve ter foto?",
  faqLength: "Qual o tamanho ideal de um currículo em {name}?",
  ctaTitle: "Verifique seu currículo contra esses padrões",
  ctaText:
    "O escaneamento gratuito avalia seu currículo pelas normas de {name} automaticamente — expectativas de foto, dados pessoais, extensão e as palavras-chave do seu setor.",
  ctaButton: "Escanear meu currículo grátis",
  sourceNote:
    "Fonte: o motor de padrões por país do scanner deste site. Quando os dados do motor melhoram, esta página é atualizada.",
};

const NL_T: CvTemplateStrings = {
  title: "CV-normen in {name}: foto, lengte, format",
  metaDescription:
    "Fotonormen, lengte en persoonsgegevens voor een {docTerm} in {name} — de echte standaarden van onze scanner.",
  h1: "CV-normen in {name}",
  intro:
    "Dit zijn de echte marktgegevens die onze scanner toepast wanneer een cv op {name} mikt — geen opinieartikel. Het lokale document is het {docTerm}; dit verwachten werkgevers daar.",
  docTermLabel: "Naam van het document",
  paperLabel: "Papierformaat",
  lengthLabel: "Verwachte lengte",
  photoLabel: "Foto op het cv?",
  personalLabel: "Persoonsgegevens",
  conventionsLabel: "Marktconventies",
  photoNorms: {
    expected: "Verwacht — weglaten schaadt",
    common: "Gebruikelijk — de meeste kandidaten voegen er een toe",
    optional: "Optioneel — beide worden geaccepteerd",
    discouraged: "Afgeraden — het gangbare advies is weglaten",
    never: "Nooit — een foto kan tot afwijzing leiden",
  },
  faqPhoto: "Moet een cv in {name} een foto hebben?",
  faqLength: "Hoe lang moet een cv in {name} zijn?",
  ctaTitle: "Toets je cv aan deze normen",
  ctaText:
    "De gratis scan beoordeelt je cv automatisch volgens de normen van {name} — fotoverwachtingen, persoonsgegevens, lengte en de trefwoorden van jouw sector.",
  ctaButton: "Scan mijn cv gratis",
  sourceNote:
    "Bron: de landnormen-engine van de scanner van deze site. Als de data van de engine verbetert, verbetert deze pagina mee.",
};

export const CV_LOCALES: Record<string, CvLocaleConfig> = {
  es: {
    htmlLang: "es",
    pathBase: "es/normas-cv",
    slugs: { ES: "espana", MX: "mexico", AR: "argentina", CL: "chile", CO: "colombia", PE: "peru" },
    t: ES_T,
    content: {
      ES: {
        countryName: "España",
        lengthNote: "1–2 páginas",
        photoNote: "Una foto tipo carné en la esquina superior es normal y ampliamente esperada; las empresas internacionales tienden a omitirla.",
        personalDataNote: "Fecha de nacimiento y nacionalidad comunes; el DNI/NIE aún se indica en sectores formales (público, finanzas, legal).",
        conventions: ["La sección de idiomas con niveles (B2/C1) es importante"],
      },
      MX: {
        countryName: "México",
        lengthNote: "1–2 páginas",
        photoNote: "Tradicionalmente común; las guías antidiscriminación y las multinacionales/tecnológicas ahora recomiendan no incluirla.",
        personalDataNote: "Los empleadores tradicionales esperan fecha de nacimiento y estado civil; las multinacionales, ninguno. Dirección solo a nivel ciudad.",
        conventions: ["La división más marcada es empleador tradicional vs multinacional, no la geografía"],
      },
      AR: {
        countryName: "Argentina",
        lengthNote: "1–2 páginas",
        photoNote: "Aún habitual en gran parte del país, pero la Ley 6471 de Buenos Aires prohíbe a los empleadores exigir foto (incluso nombre/dirección) — CV ciego obligatorio en CABA.",
        personalDataNote: "Tendencia al mínimo: ciudad, teléfono y correo. DNI, estado civil y edad se piden más adelante en el proceso.",
        conventions: ["Las normas varían por provincia; CABA exige contratación compatible con CV ciego"],
      },
      CL: {
        countryName: "Chile",
        lengthNote: "1–2 páginas",
        photoNote: "En declive según la práctica antidiscriminación; los CV anónimos ganan terreno.",
        personalDataNote: "Basta ciudad, teléfono y correo; sin RUT, estado civil ni edad.",
        conventions: ["Las guías chilenas modernas siguen el formato internacional de datos mínimos"],
      },
      CO: {
        countryName: "Colombia",
        lengthNote: "1–2 páginas",
        photoNote: "Tradicional en banca y sectores formales; opcional en tecnología y startups.",
        personalDataNote: "Los formatos tradicionales llevan datos personales; la guía moderna elimina cédula, estado civil y edad.",
        conventions: ["Localmente se llama 'hoja de vida'", "Los cargos públicos pueden usar formatos estandarizados"],
      },
      PE: {
        countryName: "Perú",
        lengthNote: "1–2 páginas",
        photoNote: "Los empleadores tradicionales suelen esperar foto; opcional en tecnología.",
        personalDataNote: "Fecha de nacimiento y nacionalidad aún comunes en sectores tradicionales.",
        conventions: ["El 'CV documentado' (con certificados adjuntos) se usa en postulaciones formales y públicas"],
      },
    },
  },
  fr: {
    htmlLang: "fr",
    pathBase: "fr/normes-cv",
    slugs: { FR: "france", BE: "belgique", CH: "suisse" },
    t: FR_T,
    content: {
      FR: {
        countryName: "France",
        lengthNote: "1 page (2 à partir de 8 ans d'expérience)",
        photoNote: "Une photo professionnelle en haut du CV reste la norme, bien que légalement facultative.",
        personalDataNote: "Bloc état civil traditionnel ; l'âge/date de naissance reste fréquent mais facultatif.",
        conventions: ["Un 'Titre' nommant le poste visé", "Les centres d'intérêt sont réellement lus", "Envoyer PDF + lettre de motivation"],
      },
      BE: {
        countryName: "Belgique",
        lengthNote: "1–2 pages",
        photoNote: "Aucune obligation, mais la photo reste majoritaire — un CV sans photo peut paraître inhabituel aux employeurs belges ; les deux sont acceptés.",
        personalDataNote: "Date de naissance assez courante ; les autres données personnelles déclinent.",
        conventions: ["Le choix de la langue est stratégique : néerlandais (Flandre), français (Wallonie), l'un ou l'anglais à Bruxelles"],
      },
      CH: {
        countryName: "Suisse",
        lengthNote: "1–2 pages",
        photoNote: "Photo habituelle (culture DACH), mais les entreprises internationales de Zurich/Genève sont de plus en plus neutres.",
        personalDataNote: "Date de naissance, nationalité et type de permis de travail couramment indiqués (le permis compte pour les employeurs).",
        conventions: ["La langue du CV suit la région (allemand/français/italien)", "Références et certificats de travail valorisés"],
      },
    },
  },
  de: {
    htmlLang: "de",
    pathBase: "de/lebenslauf-standards",
    slugs: { DE: "deutschland", AT: "oesterreich", CH: "schweiz" },
    t: DE_T,
    content: {
      DE: {
        countryName: "Deutschland",
        lengthNote: "1–2 Seiten, tabellarisch",
        photoNote: "Seit dem AGG 2006 optional — Arbeitgeber dürfen kein Foto verlangen — aber ~80% der Bewerber fügen eines bei und ~19% der Recruiter sortieren Bewerbungen ohne Foto aus. Standard im Mittelstand, rückläufig in Tech/Startups.",
        personalDataNote: "Geburtsdatum üblich; Familienstand rückläufig.",
        conventions: ["Strikt tabellarischer Aufbau; Datum + Unterschrift unten traditionell", "Alle Lücken erklärt", "Vollständige Bewerbung = Anschreiben + Lebenslauf + Zeugnisse"],
      },
      AT: {
        countryName: "Österreich",
        lengthNote: "1–2 Seiten, tabellarisch",
        photoNote: "Die DACH-Region hat die stärkste Foto-Kultur Europas; fast alle Lebensläufe enthalten eines.",
        personalDataNote: "Geburtsdatum üblich; die Konventionen folgen eng dem deutschen Vorbild.",
        conventions: ["Tabellarischer Aufbau wie in Deutschland", "Zeugnisse werden erwartet"],
      },
      CH: {
        countryName: "Schweiz",
        lengthNote: "1–2 Seiten",
        photoNote: "Foto üblich (DACH-Kultur), internationale Firmen in Zürich/Genf werden jedoch zunehmend neutral.",
        personalDataNote: "Geburtsdatum, Nationalität und Bewilligungsstatus werden üblicherweise angegeben (die Bewilligungsart ist für Arbeitgeber relevant).",
        conventions: ["Die Sprache des Lebenslaufs folgt der Region (Deutsch/Französisch/Italienisch)", "Referenzen/Arbeitszeugnisse werden geschätzt"],
      },
    },
  },
  pt: {
    htmlLang: "pt",
    pathBase: "pt/padroes-cv",
    slugs: { BR: "brasil", PT: "portugal" },
    t: PT_T,
    content: {
      BR: {
        countryName: "Brasil",
        lengthNote: "2–3 páginas toleradas",
        photoNote: "Recrutadores desaconselham; um número crescente de empresas recusa currículos com foto (exceção: funções baseadas em aparência).",
        personalDataNote: "Idade/estado civil/filhos são tradicionais mas em declínio; nunca inclua CPF/RG.",
        conventions: ["A seção 'Objetivo' (cargo-alvo) é uma convenção forte", "Tom mais expressivo que em Portugal"],
      },
      PT: {
        countryName: "Portugal",
        lengthNote: "1–2 páginas",
        photoNote: "Foto profissional habitual; em declínio com a prática antidiscriminação da UE.",
        personalDataNote: "Data de nascimento/nacionalidade habituais; estado civil em desuso.",
        conventions: ["Conservador, alinhado com a UE, orientado a resultados", "O Europass é conhecido mas já não é o preferido dos recrutadores do setor privado"],
      },
    },
  },
  nl: {
    htmlLang: "nl",
    pathBase: "nl/cv-normen",
    slugs: { NL: "nederland", BE: "belgie" },
    t: NL_T,
    content: {
      NL: {
        countryName: "Nederland",
        lengthNote: "1–2 pagina's",
        photoNote: "Van oudsher gebruikelijk, nu actief afgeraden (blind-hiring-trend, overheidsadvies).",
        personalDataNote: "Geboortedatum in afname; nooit burgerlijke staat, religie of BSN.",
        conventions: ["Understatement-cultuur — feitelijk en bescheiden", "Een hobbysectie is nog vrij gebruikelijk"],
      },
      BE: {
        countryName: "België",
        lengthNote: "1–2 pagina's",
        photoNote: "Geen verplichting, maar een foto is de meerderheidspraktijk — een cv zonder foto kan Belgische werkgevers ongebruikelijk voorkomen; beide worden geaccepteerd.",
        personalDataNote: "Geboortedatum vrij gebruikelijk; andere persoonsgegevens in afname.",
        conventions: ["Taalkeuze is strategisch: Nederlands (Vlaanderen), Frans (Wallonië), of Engels in Brussel"],
      },
    },
  },
};

/** Fill {placeholders} in a template string. */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/** ISO code for an English country slug, or null. */
export function isoFromSlug(slug: string): string | null {
  const hit = Object.entries(COUNTRY_SLUGS).find(([, s]) => s === slug);
  return hit ? hit[0] : null;
}

/** Every locale (incl. en) that has a page for this ISO → its path. */
export function hreflangCluster(iso: string): Record<string, string> {
  const cluster: Record<string, string> = { en: `/cv-standards/${COUNTRY_SLUGS[iso]}` };
  for (const [locale, cfg] of Object.entries(CV_LOCALES)) {
    if (cfg.slugs[iso]) cluster[locale] = `/${cfg.pathBase}/${cfg.slugs[iso]}`;
  }
  return cluster;
}
