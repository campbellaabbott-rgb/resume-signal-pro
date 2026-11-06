// @vitest-environment node
/**
 * THE CHANGELOG OF 2 NOVEMBER SAYS ONLY WHAT WAS READ LIVE.
 *
 * Seven entries for the deploy whose functions went live on 2 November, written
 * after it verified, each claim read against the live site on 5 November. The
 * review of that deploy set limits on them, because some of what its notes said
 * was false or was never observed. Those limits are held here in all nine
 * languages, along with what the entries owe the reader: the correction of the
 * 31 October sentence that became false, and Portuguese that is Brazilian.
 *
 * It also holds what publishing them must not break in the verifier. The crawler
 * copy of /changelog lists only the newest 30 entries, so seven new ones push
 * section 52's titles off that page. Section 52 read that as a prerender that did
 * not rebuild and printed twelve FAILs on a healthy site. It now passes a title
 * only when the page really lists 30 entries that are all at least as new, so a
 * stale bake and a lost title still FAIL. Section 52c judges the seven themselves.
 * Sections run here in bash against a fake curl, as section 52b's test does.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { changelog } from "../data/changelog";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Text = { title: string; description: string };
const shard = (l: string) => (JSON.parse(readFileSync(resolve(ROOT, `src/i18n/changelog/${l}.json`), "utf8")) as { changelogEntries: Record<string, Text> }).changelogEntries;
const IDS = [
  "truistGeicoAndNordstromJoinTheBoard",
  "takenDownJobsLeaveOurBiggestBoards",
  "searchesThatReadWhatYouTyped",
  "jobDetailsFromWhatTheEmployerStated",
  "searchResultsCarryTheEmployersNewNames",
  "theBoardStaysPutWhileYouRead",
  "theFreeReportsNumbersNowAgree",
];
const NAMES = "searchResultsCarryTheEmployersNewNames";
const SEARCH = "searchesThatReadWhatYouTyped";
const EN = shard("en");
const texts = () => LOCALES.flatMap((l) => IDS.map((id) => ({ where: `${l} ${id}`, l, id, text: `${shard(l)[id].title} ${shard(l)[id].description}` })));

describe("the seven entries", () => {
  it("sit on top of the changelog, in this order, dated the day the functions went live", () => {
    expect(changelog.slice(0, 7).map((e) => e.id)).toEqual(IDS);
    for (const e of changelog.slice(0, 7)) expect(e.date, e.id).toBe("2026-11-02");
    expect(changelog[7].date <= "2026-11-02").toBe(true);
  });

  it("carry text in all nine languages, with no placeholder, and no translation is the English copied", () => {
    for (const { where, text } of texts()) expect(text, where).not.toMatch(/\{\{|DATE_OF_DEPLOY/);
    for (const l of LOCALES.filter((x) => x !== "en" && x !== "en-GB")) {
      for (const id of IDS) {
        expect(shard(l)[id].title, `${l} ${id} title`).not.toBe(EN[id].title);
        expect(shard(l)[id].description, `${l} ${id} description`).not.toBe(EN[id].description);
      }
    }
  });

  it("British English says CV and colour on the free report, and US English says résumé and color", () => {
    const report = "theFreeReportsNumbersNowAgree";
    expect(shard("en-GB")[report].description).toMatch(/\bCV\b/);
    expect(shard("en-GB")[report].description).toMatch(/colour/);
    expect(shard("en-GB")[report].description).not.toMatch(/résumé|\bcolor\b/);
    expect(EN[report].description).toMatch(/résumé/);
    expect(EN[report].description).toMatch(/\bcolor\b/);
  });
});

describe("the limits the review of this deploy set, in every language", () => {
  // Each of these was false, or was never observed, when the entries were written.
  const REFUSED: Array<[string, RegExp]> = [
    ["a city the fix does not hold for", /Firenze|Florenz|Florencia|Florence|Warszawa|Geneve|Napoli/i],
    ["a counter that did not step", /fills_90d|fills 90/i],
    ["a product no delivery of which has been observed", /Full Analysis|Análisis completo|Analyse complète|Vollanalyse/i],
    ["pay annualised, which holds only for most rows", /annuali[sz]|annualisé|hochgerechnet/i],
    ["routing the review found dead", /\bHP\b|\bWM\b/],
    ["keyed behaviour nobody exercised", /\bAPI\b/],
    ["a claim about search rankings", /back in search results/i],
    ["an audit id", /\bS\d{1,2}-\d{2,3}\b|\b(?:FA|PD)-\d{2}\b/],
    ["an internal name", /job-board\.|job_board_|lap_backfill|\bTDZ\b|c4a29736/],
  ];
  it.each(REFUSED)("no entry states %s", (_what, re) => {
    for (const { where, text } of texts()) expect(text, where).not.toMatch(re);
  });

  it("the search entry says remote is judged by the title, and names the limit", () => {
    expect(EN[SEARCH].description).toMatch(/leaves out titles that say remote, but a remote job whose title does not say remote still appears/);
  });

  it("no entry calls the report translated: it names the parts and says the rest is still in English", () => {
    expect(EN.theFreeReportsNumbersNowAgree.description).toMatch(/Other parts of the report, such as industry labels, are still in English\./);
    for (const { where, text } of texts()) expect(text, where).not.toMatch(/the report is translated|whole report|entire report/i);
  });

  it("the sentence about Personalized Tips stays beside the one about Industry & Role Keywords, because only one was fixed", () => {
    expect(EN.theFreeReportsNumbersNowAgree.description).toMatch(/“Personalized Tips” section can still do this/);
  });

  it("Martin Brower is open to search engines again, which is what we can prove", () => {
    expect(EN[NAMES].description).toMatch(/open to search engines again/);
  });

  it("the search phrases stay as typed in every language, since those are what the board reads", () => {
    const LITERALS = ["Austin, TX 78701", "New York NY", "teacher in Spanish", "nurse in Northern Ireland", "nurse 94105", "ISO 13485", "jobs near me", 'supervisor -"team lead"', "nurse not requiring travel", "no remote nurse", "Wien"];
    for (const l of LOCALES) for (const q of LITERALS) expect(shard(l)[SEARCH].description, `${l}: ${q}`).toContain(q);
  });
});

describe("what the last read of these entries found false, held in every language", () => {
  const REACH = "truistGeicoAndNordstromJoinTheBoard";
  const TAKEN = "takenDownJobsLeaveOurBiggestBoards";
  const DETAILS = "jobDetailsFromWhatTheEmployerStated";
  const BOARD = "theBoardStaysPutWhileYouRead";
  const REPORT = "theFreeReportsNumbersNowAgree";
  type Pins = {
    /** The word that made the title promise every large board. */ biggest: RegExp;
    /** A capped read counts only while the jobs past the cap are older than 30 days. */ window: string; close: string;
    /** Accenture and USAJOBS are larger and cannot be read to the end yet. */ others: string;
    /**
     * The location box gets the two forms read, and no class of place: a class fails on what people type.
     * Read live 6 November, against 4,309 for the comma form: lower case "austin tx" 158 and "seattle wa 98101" 0; abroad "Berlin Germany" 0.
     */ field: string; place: string; oldPlace: RegExp; mainBox: string;
    /** "such as" states a class, and hp, wm and gm do not route. */ shortClass: RegExp; shortLimit: string;
    /** Only a city plus a two-letter code needs the comma: "nurse in Austin" and "nurse in Austin Texas" work without one. */ city: string; oldBox: RegExp;
    /** Two Vienna, Virginia rows with no country on file still appear under Wien. */ wien: string; oldWien: RegExp;
    /**
     * The one search read, and no rule about ZIP codes. Nothing emptied before: "nurse 94105" served nurses from anywhere
     * with the number unnamed. What changed is the notice, and a kept ZIP still gets none ("nurse 98101").
     */ zip: string; oldZip: RegExp;
    /** What we served from the 52 boards on 5 November (11,948), not the 52 of the 53 serving rows (12,582), nor the employers' own totals (21,269). */ reach: string; oldReach: RegExp;
    /** Greece, New York has at least four rows still filed abroad, so its half is cut and Lake Wales stands alone. */ lake: string; still: string; greece: RegExp;
    /** The renamed boards, not an employer's boards: LCS has a second, and two renamed. So no count of boards, and none the page can differ from on publish day. */ boards: string; oldBoards: RegExp; lcs: string;
    /** PwC's page pools three of its four boards. */ pool: string; allOf: RegExp;
    /** A stored description is never rewritten: rows posted before the deploy still repeat, so only new rows are claimed. */ lever: string; oldLever: RegExp;
    /** "cvs in Austin, TX" reaches no CVS job, so the claim is the name alone and never "every search". */ short: string; oldShort: RegExp;
    /** A part-time intern or temp stays part-time, 208 of 760 read live, so the claim is most of them. */ personio: string; oldPersonio: RegExp;
    /** Only rewrites whose bullet is in the draft land. */ report: string; oldReport: RegExp;
  };
  const EN_PINS: Pins = {
    biggest: /biggest/, window: "older than 30 days", close: "Marriott is close to that line", others: "Other large boards, such as Accenture and USAJOBS",
    field: "In the location box", place: "and now they do", oldPlace: /a place typed with a ZIP|a US city and state/, mainBox: "In the main search box", shortClass: /such as CVS/, shortLimit: "Other short employer names may still search as plain words",
    city: "a city with a two-letter state code still needs its comma", oldBox: /still needs its comma and no ZIP/,
    wien: "almost none in Vienna, Virginia", oldWien: /and not in Vienna, Virginia/,
    zip: "shows nurse jobs from anywhere, and the page now says it ignored the number", oldZip: /A ZIP code|no longer empties/,
    reach: "we showed about 12,000 jobs from these 52 boards", oldReach: /listed about|12,600/,
    lake: "Jobs in Lake Wales, Florida are now filed under the United States", still: "such as Turkey, Texas", greece: /Greece/,
    boards: "the boards we renamed for them", oldBoards: /these four employers' boards|four boards/, lcs: "counts only its own board's roles",
    pool: "(three of PwC's four)", allOf: /lists and counts all of them/,
    report: "the bullets your draft already has", oldReport: /applied to it and are not lost/,
    lever: "New Lever job descriptions no longer repeat their opening", oldLever: /(?<!New )Lever job descriptions no longer repeat/,
    short: "A search for CVS, UPS or 3M alone now goes to that employer's jobs", oldShort: /on every search/,
    personio: "Most Personio internships and temporary jobs are now", oldPersonio: /(?<!Most )Personio internships and temporary jobs are now/,
  };
  const PINS: Record<(typeof LOCALES)[number], Pins> = {
    en: EN_PINS,
    "en-GB": EN_PINS,
    de: {
      biggest: /größten/, window: "älter als 30 Tage", close: "Marriott ist nah an dieser Linie", others: "Andere große Boards, etwa Accenture und USAJOBS",
      field: "Im Ortsfeld", place: "jetzt finden sie welche", oldPlace: /ein Ort mit US-Postleitzahl/, mainBox: "Im Hauptsuchfeld", shortClass: /wie CVS/, shortLimit: "Andere kurze Arbeitgebernamen",
      city: "braucht eine Stadt mit zweistelligem Bundesstaat-Kürzel weiter ihr Komma", oldBox: /braucht ein Ort weiter sein Komma/,
      wien: "fast keine mehr in Vienna, Virginia", oldWien: /nicht mehr in Vienna, Virginia/,
      zip: "zeigt Pflegestellen von überall, und die Seite sagt jetzt, dass sie die Zahl ignoriert hat", oldZip: /Eine US-Postleitzahl|leert die Ergebnisse/,
      reach: "zeigten wir etwa 12.000 Stellen von diesen 52 Boards", oldReach: /listeten|12\.600/,
      lake: "Stellen in Lake Wales, Florida, stehen jetzt unter den USA", still: "etwa Turkey, Texas", greece: /Greece|Griechenland/,
      boards: "auf den Boards gelesen, die wir für sie umbenannt haben", oldBoards: /auf den Boards dieser vier Arbeitgeber|vier Boards/, lcs: "nur die Stellen ihres eigenen Boards",
      pool: "(drei von vier bei PwC)", allOf: /listet und zählt jetzt alle\./,
      report: "die dein Entwurf schon hat", oldReport: /gehen nicht verloren/,
      lever: "Beschreibungen neuer Lever-Stellen wiederholen ihren Anfang nicht mehr", oldLever: /Stellenbeschreibungen von Lever/,
      short: "Eine Suche nur nach CVS, UPS oder 3M führt jetzt zu den Stellen dieses Arbeitgebers", oldShort: /bei jeder Suche/,
      personio: "Die meisten Praktika und befristeten Stellen von Personio", oldPersonio: /Praktika und befristete Stellen von Personio/,
    },
    es: {
      biggest: /más grandes/, window: "más de 30 días", close: "Marriott está cerca de esa línea", others: "Otros tablones grandes, como Accenture y USAJOBS",
      field: "En el campo de ubicación", place: "antes no encontraban ningún empleo y ahora sí", oldPlace: /un lugar escrito con código postal/, mainBox: "En el cuadro principal de búsqueda", shortClass: /como CVS/, shortLimit: "Otros nombres cortos de empleadores",
      city: "una ciudad con un código de estado de dos letras sigue necesitando su coma", oldBox: /un lugar sigue necesitando su coma/,
      wien: "casi ninguno en Vienna, Virginia", oldWien: /ya no en Vienna, Virginia/,
      zip: "muestra empleos de enfermería de cualquier lugar, y la página ahora dice que ignoró el número", oldZip: /Un código postal|ya no deja vacía/,
      reach: "mostrábamos unos 12.000 empleos de estos 52 tablones", oldReach: /12\.600/,
      lake: "Los empleos en Lake Wales, Florida, ahora están clasificados en Estados Unidos", still: "como Turkey, Texas", greece: /Greece|Grecia/,
      boards: "de los tablones que renombramos", oldBoards: /los tablones de estos cuatro empleadores|cuatro tablones/, lcs: "solo los puestos de su propio tablón",
      pool: "(tres de los cuatro de PwC)", allOf: /los muestra y los cuenta todos/,
      report: "las viñetas que tu borrador ya tiene", oldReport: /se aplican a él y no se pierden/,
      lever: "Las descripciones de los empleos nuevos de Lever ya no repiten su comienzo", oldLever: /Las descripciones de empleo de Lever/,
      short: "Una búsqueda solo de CVS, UPS o 3M ahora lleva a los empleos de ese empleador", oldShort: /en cada búsqueda/,
      personio: "La mayoría de las prácticas y los empleos temporales de Personio", oldPersonio: /Las prácticas y los empleos temporales de Personio/,
    },
    fr: {
      biggest: /plus grands/, window: "plus de 30 jours", close: "Marriott est proche de cette ligne", others: "D'autres grands tableaux, comme Accenture et USAJOBS",
      field: "Dans le champ du lieu", place: "ils en trouvent désormais", oldPlace: /un lieu tapé avec un code postal/, mainBox: "Dans le champ de recherche principal", shortClass: /comme CVS/, shortLimit: "D'autres noms courts d'employeurs",
      city: "une ville suivie d'un code d'État à deux lettres a toujours besoin de sa virgule", oldBox: /un lieu a toujours besoin de sa virgule/,
      wien: "presque aucune à Vienna, en Virginie", oldWien: /non plus à Vienna/,
      zip: "affiche des postes infirmiers de partout, et la page dit désormais qu'elle a ignoré le nombre", oldZip: /Un code postal|ne vide plus/,
      reach: "nous affichions environ 12 000 offres de ces 52 tableaux", oldReach: /listaient|12 600/,
      lake: "Les offres à Lake Wales, en Floride, sont désormais classées aux États-Unis", still: "comme Turkey, au Texas", greece: /Greece|Grèce/,
      boards: "sur les tableaux que nous avons renommés", oldBoards: /les tableaux de ces quatre employeurs|quatre tableaux/, lcs: "seulement les postes de son propre tableau",
      pool: "(trois des quatre de PwC)", allOf: /les liste et les compte désormais tous/,
      report: "aux puces que votre brouillon contient déjà", oldReport: /y sont appliquées et ne sont pas perdues/,
      lever: "Les descriptions des nouvelles offres Lever ne répètent plus leur début", oldLever: /Les descriptions de poste de Lever/,
      short: "Une recherche portant uniquement sur CVS, UPS ou 3M mène désormais aux offres de cet employeur", oldShort: /à chaque recherche/,
      personio: "La plupart des stages et des emplois temporaires de Personio", oldPersonio: /Les stages et les emplois temporaires de Personio/,
    },
    hi: {
      biggest: /सबसे बड़े/, window: "30 दिन से पुरानी", close: "Marriott इस रेखा के क़रीब है", others: "दूसरे बड़े बोर्ड, जैसे Accenture और USAJOBS",
      field: "लोकेशन बॉक्स में", place: "अब ढूँढते हैं", oldPlace: /ZIP कोड के साथ या बिना कॉमा/, mainBox: "मुख्य खोज बॉक्स में", shortClass: /3M जैसे/, shortLimit: "दूसरे छोटे नियोक्ता नाम",
      city: "दो अक्षरों वाले राज्य कोड के साथ लिखे शहर को अब भी कॉमा चाहिए", oldBox: /जगह को अब भी कॉमा चाहिए/,
      wien: "Vienna, Virginia की लगभग कोई नहीं", oldWien: /Vienna, Virginia की नहीं/,
      zip: "कहीं की भी नर्स की नौकरियाँ दिखाता है, और पेज अब बताता है कि उसने वह संख्या छोड़ दी", oldZip: /ZIP कोड|ख़ाली नहीं करता/,
      reach: "इन 52 बोर्ड की लगभग 12,000 नौकरियाँ दिखाईं", oldReach: /12,600/,
      lake: "Lake Wales, Florida की नौकरियाँ अब ब्रिटेन में नहीं, अमेरिका में दर्ज हैं", still: "जैसे Turkey, Texas", greece: /Greece|ग्रीस/,
      boards: "उन बोर्ड की हर पोस्टिंग", oldBoards: /इन चार नियोक्ताओं के बोर्ड|चार बोर्ड/, lcs: "सिर्फ़ अपने बोर्ड के रोल गिनता है",
      pool: "(PwC के चार में से तीन)", allOf: /उन सभी को दिखाता और गिनता है/,
      report: "जो आपके ड्राफ़्ट में पहले से हैं", oldReport: /उसी पर लागू होते हैं और खोते नहीं/,
      lever: "Lever की नई नौकरियों के विवरण अब अपनी शुरुआत नहीं दोहराते", oldLever: /Lever के नौकरी विवरण/,
      short: "सिर्फ़ CVS, UPS या 3M की खोज अब उसी नियोक्ता की नौकरियों पर ले जाती है", oldShort: /हर खोज में/,
      personio: "Personio की ज़्यादातर इंटर्नशिप और अस्थायी नौकरियाँ", oldPersonio: /Personio की इंटर्नशिप/,
    },
    nl: {
      biggest: /grootste/, window: "ouder is dan 30 dagen", close: "Marriott zit dicht bij die lijn", others: "Andere grote borden, zoals Accenture en USAJOBS",
      field: "In het locatieveld", place: "en nu wel", oldPlace: /een plaats met een Amerikaanse postcode/, mainBox: "In het hoofdzoekvak", shortClass: /zoals CVS/, shortLimit: "Andere korte werkgeversnamen",
      city: "een stad met een staatcode van twee letters nog steeds een komma nodig", oldBox: /heeft een plaats nog steeds een komma nodig/,
      wien: "bijna geen meer in Vienna, Virginia", oldWien: /niet meer in Vienna, Virginia/,
      zip: "toont vacatures voor verpleegkundigen van overal, en de pagina zegt nu dat het getal is genegeerd", oldZip: /Een Amerikaanse postcode|niet meer leeg/,
      reach: "toonden we ongeveer 12.000 vacatures van deze 52 borden", oldReach: /12\.600/,
      lake: "Vacatures in Lake Wales, Florida, staan nu onder de Verenigde Staten", still: "zoals Turkey, Texas", greece: /Greece|Griekenland/,
      boards: "op de borden die we voor hen hebben hernoemd", oldBoards: /op de borden van deze vier werkgevers|vier borden/, lcs: "alleen de functies van zijn eigen bord",
      pool: "(drie van de vier van PwC)", allOf: /toont en telt ze nu allemaal/,
      report: "die je concept al heeft", oldReport: /erop toegepast en gaan ze niet verloren/,
      lever: "Beschrijvingen van nieuwe Lever-vacatures herhalen hun begin niet meer", oldLever: /Functiebeschrijvingen van Lever/,
      short: "Een zoekopdracht op alleen CVS, UPS of 3M leidt nu naar de vacatures van die werkgever", oldShort: /bij elke zoekopdracht/,
      personio: "De meeste stages en tijdelijke banen van Personio", oldPersonio: /Stages en tijdelijke banen van Personio/,
    },
    pt: {
      biggest: /maiores/, window: "mais de 30 dias", close: "A Marriott está perto dessa linha", others: "Outros quadros grandes, como Accenture e USAJOBS",
      field: "No campo de local", place: "e agora encontram", oldPlace: /um local digitado com código ZIP/, mainBox: "Na caixa principal de busca", shortClass: /como CVS/, shortLimit: "Outros nomes curtos de empregadores",
      city: "uma cidade com código de estado de duas letras ainda precisa da vírgula", oldBox: /um local ainda precisa da vírgula/,
      wien: "quase nenhuma em Vienna, na Virgínia", oldWien: /não mais em Vienna/,
      zip: "mostra vagas de enfermagem de qualquer lugar, e a página agora diz que ignorou o número", oldZip: /Um código ZIP|não esvazia mais/,
      reach: "mostrávamos cerca de 12.000 vagas desses 52 quadros", oldReach: /listavam|12\.600/,
      lake: "As vagas em Lake Wales, na Flórida, agora estão registradas nos Estados Unidos", still: "como Turkey, no Texas", greece: /Greece|Grécia/,
      boards: "nos quadros que renomeamos", oldBoards: /nos quadros desses quatro empregadores|quatro quadros/, lcs: "só as vagas do próprio quadro",
      pool: "(três dos quatro da PwC)", allOf: /lista e conta todos eles/,
      report: "aos tópicos que seu rascunho já tem", oldReport: /são aplicadas a ele e não se perdem/,
      lever: "As descrições das vagas novas da Lever não repetem mais a abertura", oldLever: /As descrições de vagas da Lever/,
      short: "Uma busca só por CVS, UPS ou 3M agora leva às vagas desse empregador", oldShort: /em toda busca/,
      personio: "A maioria dos estágios e das vagas temporárias da Personio", oldPersonio: /Estágios e vagas temporárias da Personio/,
    },
    tl: {
      biggest: /pinakamalalaki/, window: "higit sa 30 araw", close: "Malapit sa linyang iyon ang Marriott", others: "ibang malalaking board, gaya ng Accenture at USAJOBS",
      field: "Sa location box", place: "pero nakakahanap na sila ngayon", oldPlace: /ang lugar na may ZIP code/, mainBox: "Sa pangunahing search box", shortClass: /gaya ng CVS/, shortLimit: "iba pang maiikling pangalan ng employer",
      city: "kailangan pa rin ng comma ng lungsod na may dalawang-letrang state code", oldBox: /kailangan pa rin ng lugar ang comma/,
      wien: "halos wala sa Vienna, Virginia", oldWien: /hindi na sa Vienna, Virginia/,
      zip: "ng mga trabahong nurse mula kahit saan, at sinasabi na ngayon ng page na hindi nito isinama ang numero", oldZip: /ZIP code|Hindi na nauubos/,
      reach: "nagpakita kami ng humigit-kumulang 12,000 trabaho mula sa 52 board na ito", oldReach: /12,600/,
      lake: "ang mga trabaho sa Lake Wales, Florida", still: "gaya ng Turkey, Texas", greece: /Greece/,
      boards: "sa mga board na pinalitan namin ng pangalan", oldBoards: /sa mga board ng apat na employer|apat na board/, lcs: "Ang mga role lang ng sarili nitong board",
      pool: "(tatlo sa apat ng PwC)", allOf: /ang lahat ng ito\./,
      report: "sa mga bullet na mayroon na ang draft mo", oldReport: /nailalapat dito ang mga pag-aayos ng report at hindi nawawala/,
      lever: "ng mga paglalarawan ng mga bagong trabaho mula sa Lever", oldLever: /paglalarawan ng trabaho mula sa Lever/,
      short: "ang paghahanap ng CVS, UPS o 3M lang", oldShort: /sa bawat paghahanap/,
      personio: "ang karamihan ng mga internship at pansamantalang trabaho mula sa Personio", oldPersonio: /May tamang label na ang mga internship/,
    },
  };
  const each = (fn: (l: (typeof LOCALES)[number], p: Pins) => void) => { for (const l of LOCALES) fn(l, PINS[l]); };

  it("the takedown title names the four boards the fix reached, and does not promise the biggest: Accenture and USAJOBS are larger and cannot be read to the end", () => {
    each((l, p) => {
      const { title, description } = shard(l)[TAKEN];
      for (const name of ["Kroger", "AutoZone", "Marriott", "Kotak"]) expect(title, `${l}: ${name}`).toContain(name);
      expect(title, l).not.toMatch(p.biggest);
      expect(description, l).toContain(p.others);
    });
  });
  it("the capped read is conditional, and Marriott is named as close to the line", () => {
    each((l, p) => {
      const d = shard(l)[TAKEN].description;
      expect(d, l).toContain(p.window);
      expect(d, l).toContain(p.close);
    });
  });
  it("the location box names the two forms it read and no class of place, and in the main search box only a city with a two-letter code still needs its comma, with phrases as typed", () => {
    each((l, p) => {
      const d = shard(l)[SEARCH].description;
      expect(d, l).toContain(p.field);
      expect(d, l).toContain(p.place);
      expect(d, l).not.toMatch(p.oldPlace);
      expect(d, l).toContain(p.mainBox);
      expect(d, l).toContain(p.city);
      expect(d, l).not.toMatch(p.oldBox);
      for (const q of ["nurse in Austin, TX", "nurse in Austin TX"]) expect(d, `${l}: ${q}`).toContain(q);
    });
  });
  it("Wien finds almost none in Vienna, Virginia: rows with no country on file still appear, so it never says none", () => {
    each((l, p) => {
      const d = shard(l)[SEARCH].description;
      expect(d, l).toContain(p.wien);
      expect(d, l).not.toMatch(p.oldWien);
    });
  });
  it("the ZIP sentence is one search read: no rule about ZIP codes, and never that a search used to empty", () => {
    each((l, p) => {
      const d = shard(l)[SEARCH].description;
      expect(d, l).toContain(p.zip);
      expect(d, l).not.toMatch(p.oldZip);
    });
  });
  it("the 52 boards' count is what we served from those 52, not the jobs they list", () => {
    each((l, p) => {
      const d = shard(l)[REACH].description;
      expect(d, l).toContain(p.reach);
      expect(d, l).not.toMatch(p.oldReach);
    });
  });
  it("the short names are the three that route, not a class, and the limit is stated", () => {
    each((l, p) => {
      const d = shard(l)[SEARCH].description;
      expect(d, l).not.toMatch(p.shortClass);
      expect(d, l).toContain(p.shortLimit);
    });
  });
  it("the short names route when typed alone: a place after them can reach no job of theirs, so no sentence says every search", () => {
    each((l, p) => {
      const d = shard(l)[SEARCH].description;
      expect(d, l).toContain(p.short);
      expect(d, l).not.toMatch(p.oldShort);
    });
  });
  it("Lever's descriptions are claimed for new rows only: a stored row keeps its old text until it ages out", () => {
    each((l, p) => {
      const d = shard(l)[DETAILS].description;
      expect(d, l).toContain(p.lever);
      expect(d, l).not.toMatch(p.oldLever);
    });
  });
  it("Personio's labels are claimed for most rows: a part-time intern or temp still shows as part-time", () => {
    each((l, p) => {
      const d = shard(l)[DETAILS].description;
      expect(d, l).toContain(p.personio);
      expect(d, l).not.toMatch(p.oldPersonio);
    });
  });
  it("Lake Wales stands alone, the limit names a place that holds, and no count of Greece, New York rows is left to go false", () => {
    each((l, p) => {
      const d = shard(l)[DETAILS].description;
      expect(d, l).toContain(p.lake);
      expect(d, l).toContain(p.still);
      expect(d, l).not.toMatch(p.greece);
    });
  });
  it("the names entry reads the boards we renamed, and prints no count the page can differ from on publish day", () => {
    each((l, p) => {
      const d = shard(l)[NAMES].description;
      expect(d, l).toContain(p.boards);
      expect(d, l).not.toMatch(p.oldBoards);
      expect(d, l).toContain(p.lcs);
      expect(d, `${l}: the old pooled count, which no page prints now`).toContain("604");
      expect(d, `${l}: LCS's count moves with the moment`).not.toMatch(/\b1[23]\b/);
      expect(d, `${l}: a count of rows moves with the moment`).not.toContain("840");
    });
  });
  it("PwC's page counts the three boards it pools, not all of an employer's boards", () => {
    each((l, p) => {
      const d = shard(l)[BOARD].description;
      expect(d, l).toContain(p.pool);
      expect(d, l).not.toMatch(p.allOf);
    });
  });
  it("a kept draft takes only the rewrites whose bullet it holds, and the page says how many", () => {
    each((l, p) => {
      const d = shard(l)[REPORT].description;
      expect(d, l).toContain(p.report);
      expect(d, l).not.toMatch(p.oldReport);
    });
  });
});

describe("what the entries owe the reader", () => {
  it("every language corrects the 31 October sentence and names all four employers", () => {
    for (const l of LOCALES) {
      const d = shard(l)[NAMES].description;
      for (const name of ["Honeywell Aerospace", "LCS", "Axia Women's Health", "Hong Kong Baptist University"]) expect(d, `${l}: ${name}`).toContain(name);
      expect(d, `${l}: the old entry's date`).toMatch(/\b31\b/);
    }
  });

  it("every language carries the same digits as the English", () => {
    const digits = (s: string) => (s.match(/\d(?:[\d., \u00a0\u202f]*\d)?/g) ?? []).map((x) => x.replace(/[., \u00a0\u202f]/g, "")).sort();
    for (const id of IDS) for (const l of LOCALES) expect(digits(shard(l)[id].description), `${l} ${id}`).toEqual(digits(EN[id].description));
  });

  it("the old entry keeps what was true on its date: a changelog entry is a dated record", () => {
    expect(EN.employersNamedByALogoFile.description).toMatch(/those results still show the old label/);
    expect(changelog.find((e) => e.id === "employersNamedByALogoFile")?.date).toBe("2026-10-31");
  });

  it("the Portuguese is Brazilian", () => {
    const pt = IDS.map((id) => `${shard("pt")[id].title} ${shard("pt")[id].description}`).join(" ");
    expect(pt).not.toMatch(/ficheiro|ecrã|telemóvel|registad|logótipo|pesquisámos|lemos a |\ba 5 de novembro\b|\ba 31 de outubro\b|«|»/i);
    expect(pt).toMatch(/em 5 de novembro|Em 5 de novembro/);
    expect(pt).toMatch(/celular/);
    expect(pt).toMatch(/você/);
  });
});

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data")data=a[++i];else if(["-H","-m","-A"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
const key=method+" "+url;
fs.appendFileSync(process.env.VD_CALLS,key+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
if(o&&o!=="/dev/null")fs.writeFileSync(o,r.body??"");else if(!o)process.stdout.write(r.body??"");
if(w)process.stdout.write(w.replace("%{http_code}",String(r.status??200)));
`;

const TREE_EN = EN;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const article = (date: string, title: string) => `<article class="rounded-xl border border-border bg-card p-4"><p class="text-xs text-muted-foreground mb-1">${date} · Fixed</p><h2 class="text-sm font-semibold text-foreground mb-1">${esc(title)}</h2><p class="text-sm text-muted-foreground">x</p></article>`;
/** The crawler /changelog as the bake writes it, from { date, title } rows. */
const crawler = (rows: Array<{ date: string; title: string }>) => `<html><head><meta name="description" content="What changed and when, newest first — including honest postmortems. Latest (${rows[0]?.date}): ${esc(rows[0]?.title ?? "")}."></head><body><main><h1>Changelog</h1><div class="space-y-4">${rows.map((r) => article(r.date, r.title)).join("")}</div></main></body></html>`;
const rowsOf = (from: number, to: number) => changelog.slice(from, to).map((e) => ({ date: e.date, title: TREE_EN[e.id].title }));
/** The site once these entries are published: the newest 30, as the bake lists them. */
const HEALTHY = crawler(rowsOf(0, 30));
const chunkOf = (entries: Record<string, unknown>) => `const e=${JSON.stringify({ changelogEntries: entries })};export{e as default};`;
const PUBLISHED = chunkOf(TREE_EN);
const UNPUBLISHED = chunkOf(Object.fromEntries(Object.entries(TREE_EN).filter(([k]) => !IDS.includes(k))));
const ENTRY = `const lazy=[()=>import("./rb-en_all-ALL00001.js"),()=>import("./en-CHLG0001.js"),()=>import("./en-GB-GBCL0001.js")];export{lazy as a};`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(section: string, over: { changelog?: string; chunk?: string } = {}): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd-52-nov-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify([
    { match: "^GET https://site\\.test/changelog$", body: over.changelog ?? HEALTHY },
    { match: "^GET https://site\\.test/$", body: `<html><head><script type="module" crossorigin src="/assets/index-ENTRY001.js"></script></head><body></body></html>` },
    { match: "^GET https://site\\.test/assets/index-ENTRY001\\.js$", body: ENTRY },
    { match: "^GET https://site\\.test/assets/rb-en_all-ALL00001\\.js$", body: `const s={header:{jobs:"Jobs"}};` },
    { match: "^GET https://site\\.test/assets/en-CHLG0001\\.js$", body: over.chunk ?? PUBLISHED },
    // The British chunk carries every key too; the sections must never read it.
    { match: "^GET https://site\\.test/assets/en-GB-GBCL0001\\.js$", body: PUBLISHED },
  ]));
  writeFileSync(join(dir, "calls.log"), "");
  const text = readFileSync(resolve(ROOT, "scripts/verify-deploy.d", section), "utf8");
  writeFileSync(join(dir, "run.sh"), `set -u\nK=pk_test; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n` + text.split("/tmp/").join(`${dir}/`));
  let out = "";
  try {
    out = execFileSync("bash", [join(dir, "run.sh")], {
      cwd: ROOT,
      env: { ...process.env, PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`, VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log") },
      encoding: "utf8", timeout: 50_000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean) };
}
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const show = (lines: string[]) => `\n${lines.join("\n")}`;
const rx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const S52 = "52-changelog-oct17-25.sh";
const S52_TITLES = [...readFileSync(resolve(ROOT, "scripts/verify-deploy.d", S52), "utf8").matchAll(/^(\d{4}-\d{2}-\d{2})\|(.+)$/gm)].map((m) => ({ date: m[1], title: m[2] }));

describe("section 52 once these entries push its titles past the newest 30", () => {
  it("names twelve titles, each with its own date", () => {
    expect(S52_TITLES).toHaveLength(12);
    for (const t of S52_TITLES) {
      const e = changelog.find((x) => TREE_EN[x.id].title.includes(t.title));
      expect(e, t.title).toBeTruthy();
      expect(e!.date, t.title).toBe(t.date);
    }
  });

  it("the healthy site prints no FAIL: the titles still listed pass as listed, the rest as past the newest 30", () => {
    const { lines, calls } = run(S52);
    expect(fails(lines), show(lines)).toEqual([]);
    const on = S52_TITLES.filter((t) => HEALTHY.includes(t.title));
    const past = S52_TITLES.filter((t) => !HEALTHY.includes(t.title));
    expect(on.length, "some titles must still be on the page").toBeGreaterThan(0);
    expect(past.length, "this batch must push some off, or this case proves nothing").toBeGreaterThan(0);
    for (const t of on) expect(lines, show(lines)).toContain(`PASS  /changelog serves crawlers "${t.title}"`);
    for (const t of past) expect(lines, show(lines)).toContain(`PASS  "${t.title}" is past the newest 30 entries the crawler page lists, and the English changelog strings the browser loads carry it`);
    expect(calls.some((c) => c.includes("en-GB-")), "the section read the British chunk").toBe(false);
    for (const c of calls) expect(c, c).toMatch(/^GET /);
  });

  it("a bake from before these titles FAILs each one: thirty older entries pushed nothing off", () => {
    const stale = crawler(Array.from({ length: 30 }, (_, i) => ({ date: "2026-10-11", title: `An older entry ${i}` })));
    const { lines } = run(S52, { changelog: stale });
    for (const t of S52_TITLES) expect(lines, show(lines)).toContain(`FAIL  the English changelog strings the browser loads carry "${t.title}", but the crawler copy of /changelog does not (the prerender did not rebuild)`);
    expect(lines.some((l) => /is past the newest 30/.test(l)), show(lines)).toBe(false);
  });

  it("a title lost from the middle of the page FAILs: entries older than it are still listed", () => {
    const lost = "What a company page says when it lists no roles";
    const { lines } = run(S52, { changelog: crawler(rowsOf(0, 31).filter((r) => r.title !== lost)) });
    expect(lines, show(lines)).toContain(`FAIL  the English changelog strings the browser loads carry "${lost}", but the crawler copy of /changelog does not (the prerender did not rebuild)`);
  });

  it("fewer than thirty entries cannot have pushed anything off: FAIL", () => {
    const short = crawler(Array.from({ length: 29 }, (_, i) => ({ date: "2026-12-01", title: `A newer entry ${i}` })));
    const { lines } = run(S52, { changelog: short });
    expect(lines.some((l) => /is past the newest 30/.test(l)), show(lines)).toBe(false);
    expect(fails(lines), show(lines)).toHaveLength(12);
  });

  it("a title in neither place FAILs as not published, however new the page is", () => {
    const newer = crawler(Array.from({ length: 30 }, (_, i) => ({ date: "2026-12-01", title: `A newer entry ${i}` })));
    const gone = "A lighter tab icon and share picture";
    const without = chunkOf(Object.fromEntries(Object.entries(TREE_EN).filter(([, v]) => v.title !== gone)));
    const { lines } = run(S52, { changelog: newer, chunk: without });
    expect(lines, show(lines)).toContain(`FAIL  /changelog does not serve "${gone}" (the frontend has not been published since the changelog for 17 to 25 October merged)`);
  });
});

const S52C = "52c-changelog-nov-02.sh";
const TITLES = IDS.map((id) => TREE_EN[id].title);

describe("section 52c judges the seven entries", () => {
  it("lists exactly their titles, in order", () => {
    const listed = /<<'VD52C_TITLES'\n([\s\S]*?)\nVD52C_TITLES/.exec(readFileSync(resolve(ROOT, "scripts/verify-deploy.d", S52C), "utf8"))?.[1].split("\n") ?? [];
    expect(listed).toEqual(TITLES);
  });

  it("before the publish every line is INFO, and only GETs are sent", () => {
    const { lines, calls } = run(S52C, { changelog: crawler(rowsOf(7, 37)), chunk: UNPUBLISHED });
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.some((l) => /^INFO .*does not carry the 2 November entries yet/.test(l)), show(lines)).toBe(true);
    expect(lines.filter((l) => l.startsWith("PASS")), show(lines)).toEqual([]);
    for (const c of calls) expect(c, c).toMatch(/^GET /);
    expect(calls.some((c) => c.includes("en-GB-"))).toBe(false);
  });

  it("after the publish each title passes on the crawler page, dated 2 November, and the correction is served", () => {
    const { lines } = run(S52C);
    expect(fails(lines), show(lines)).toEqual([]);
    for (const t of TITLES) expect(lines, show(lines)).toContain(`PASS  /changelog serves crawlers "${t}", dated 2026-11-02`);
    expect(lines.some((l) => /^PASS .*now carry the new name/.test(l)), show(lines)).toBe(true);
    for (const l of lines) expect(l, l).toMatch(/^(PASS|FAIL|INFO|==) /);
  });

  it("a wrong date FAILs: an entry is dated the day its functions went live", () => {
    const { lines } = run(S52C, { changelog: crawler(rowsOf(0, 30).map((r) => (TITLES.includes(r.title) ? { ...r, date: "2026-11-05" } : r))) });
    expect(lines.some((l) => new RegExp(`^FAIL  /changelog dates "${rx(TITLES[0])}" 2026-11-05, want 2026-11-02`).test(l)), show(lines)).toBe(true);
  });

  it("a title the crawler page lost FAILs, and so does one dropped from both", () => {
    const lost = run(S52C, { changelog: crawler(rowsOf(0, 30).filter((r) => r.title !== TITLES[3])) }).lines;
    expect(lost, show(lost)).toContain(`FAIL  the US English changelog strings carry "${TITLES[3]}", but the crawler copy of /changelog does not (the prerender did not rebuild)`);
    const without = chunkOf(Object.fromEntries(Object.entries(TREE_EN).filter(([k]) => k !== IDS[2])));
    const gone = run(S52C, { chunk: without, changelog: crawler(rowsOf(0, 30).filter((r) => r.title !== TITLES[2])) }).lines;
    expect(gone, show(gone)).toContain(`FAIL  the 2 November entries are published, but neither /changelog nor the US English changelog strings carry "${TITLES[2]}" (an entry was dropped or retitled when it landed)`);
  });

  it("a later batch that pushes them off the page passes, and a stale bake does not", () => {
    const newer = crawler(Array.from({ length: 30 }, (_, i) => ({ date: "2026-12-01", title: `A newer entry ${i}` })));
    const pushed = run(S52C, { changelog: newer }).lines;
    expect(fails(pushed), show(pushed)).toEqual([]);
    for (const t of TITLES) expect(pushed, show(pushed)).toContain(`PASS  "${t}" is past the newest 30 entries the crawler page lists, and the US English changelog strings carry it`);
    const stale = crawler(Array.from({ length: 30 }, (_, i) => ({ date: "2026-10-11", title: `An older entry ${i}` })));
    const old = run(S52C, { changelog: stale }).lines;
    for (const t of TITLES) expect(old, show(old)).toContain(`FAIL  the US English changelog strings carry "${t}", but the crawler copy of /changelog does not (the prerender did not rebuild)`);
  });

  it("a names entry that lost its correction FAILs", () => {
    const blunted = chunkOf({ ...TREE_EN, [NAMES]: { ...TREE_EN[NAMES], description: "Search results for some employers changed." } });
    const { lines } = run(S52C, { chunk: blunted });
    expect(lines.some((l) => /^FAIL .*does not say those results now carry the new name/.test(l)), show(lines)).toBe(true);
  });

  it("no US chunk at all is a FAIL, and the British chunk is never read in its place", () => {
    const { lines, calls } = run(S52C, { chunk: `const e={};export{e as default};` });
    expect(lines.some((l) => /^FAIL  no US English changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts/.test(l)), show(lines)).toBe(true);
    expect(calls.some((c) => c.includes("en-GB-"))).toBe(false);
  });
});
