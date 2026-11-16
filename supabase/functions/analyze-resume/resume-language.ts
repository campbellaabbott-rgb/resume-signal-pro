/**
 * Resume Language Detection
 *
 * Deterministic, dependency-free detection of the language a resume is written
 * in. Exists because the in-prompt "detect the language and respond in it"
 * instruction demonstrably fails — a French resume got an English report in
 * production (2026-07-09) — the model defaults to the language of the huge
 * English system prompt. Detecting server-side lets us (a) inject the language
 * as a hard, stated fact the model must obey, (b) use it as a geo signal, and
 * (c) expose it in the response so tests can verify compliance.
 *
 * Method: the writing system first, then distinctive-stopword frequency
 * within it. Word lists deliberately avoid cross-language collisions (e.g.
 * "experiência" pt ≠ "experiencia" es ≠ "expérience" fr) and English
 * homographs ("mit" would match MIT, "von" appears in surnames — both excluded
 * or outvoted by the ≥3-distinct-words requirement).
 *
 * WHAT IT DOES NOT KNOW, IT SAYS (register S13-024). The detector used to
 * know eight languages and call everything else English, and call every
 * Devanagari CV Hindi: a Polish, Russian, Turkish, Swedish or Indonesian CV
 * got an English report with English keyword gaps, and a Marathi or Nepali CV
 * a Hindi one. Now:
 *   - a script that one language owns names it (Greek, Hebrew, Thai, Hangul,
 *     kana for Japanese, Han alone for Chinese); a shared script (Cyrillic,
 *     Arabic, Devanagari) names a language only on that language's own
 *     words, and otherwise names the script with language 'unknown';
 *   - Polish, Turkish, Swedish, Indonesian and Malay have word lists;
 *   - a Latin-script text of some length that is neither English nor any
 *     listed language is 'unknown', not English;
 *   - `supported` says whether the report's keyword lists, section words and
 *     prompt are built for the language, so the scan can say when they are not.
 * A short text with little to go on stays English, as before.
 *
 * Recheck fix (2026-11-01, 2,450 texts: Wikipedia intros in 27 languages,
 * 1,616 real postings with a declared language, 917 terse English lists):
 *   - Russian is named only on words Bulgarian and Serbian do not write
 *     ("или", "при", "как", "все" are theirs too), and Bulgarian, Serbian and
 *     Macedonian have words and letters of their own (ъ; ј љ њ ћ ђ џ; ќ ѓ ѕ);
 *   - Indonesian and Malay are told apart only by the spellings one of them
 *     writes ("bahwa"/"bahawa", "yaitu"/"iaitu"); with none, the language is
 *     'unknown' rather than a guess;
 *   - before a Latin-script text is called 'unknown', the supported lists are
 *     read again at a lower bar, so Spanish or Portuguese prose with little
 *     résumé vocabulary is named, not told the report does not cover it.
 */

export interface ResumeLanguageResult {
  /** ISO 639-1 code, or 'unknown' when the text names no language we can tell. */
  language: string;
  /** English name, for prompt injection ("Polish"; "an unidentified language" when unknown). */
  languageName: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  /** The writing system the text is mostly in: 'Latin', 'Cyrillic', 'Arabic', 'Devanagari', 'Han', ... */
  script: string;
  /** Whether the report's keyword lists, section words and prompt are built for this language. */
  supported: boolean;
}

/** The languages the report is built for: its prompt, keyword lists and section words. */
export const SUPPORTED_LANGUAGES: readonly string[] = ['en', 'es', 'fr', 'de', 'pt', 'nl', 'it', 'hi', 'tl'];

const LANGUAGE_WORDS: Record<string, { name: string; words: string[] }> = {
  es: {
    name: 'Spanish',
    words: [
      'años', 'experiencia', 'desarrollo', 'gestión', 'empresa', 'equipo',
      'responsable de', 'trabajo', 'habilidades', 'educación', 'ventas',
      'logros', 'conocimientos', 'puesto', 'mejora', 'aumenté', 'lideré',
      'también', 'según', 'a través de', 'más de', 'y de',
      // Function words no other listed language writes (not "para", "por",
      // "como", "desde": Portuguese; not "con", "una", "del": Italian).
      'los', 'las', 'fue', 'sus', 'muy', 'hasta', 'pero', 'cuando', 'año', 'ciudad', 'tiene', 'puede',
    ],
  },
  fr: {
    name: 'French',
    words: [
      'années', "d'expérience", 'développement', 'gestion', 'entreprise',
      'équipe', 'compétences', 'formation', 'chez', 'mise en place',
      'augmentation', 'réalisé', 'projets', 'poste', 'maîtrise', 'auprès',
      'avec', 'pour', 'dans', 'grâce', 'ainsi que', "d'une", 'ans de', 'marque',
    ],
  },
  de: {
    name: 'German',
    words: [
      'und', 'für', 'erfahrung', 'jahre', 'entwicklung', 'verantwortlich',
      'kenntnisse', 'ausbildung', 'unternehmen', 'projekte', 'leitung',
      'umsetzung', 'über', 'während', 'fähigkeiten', 'berufserfahrung',
    ],
  },
  pt: {
    name: 'Portuguese',
    words: [
      'não', 'são', 'experiência', 'gestão', 'desenvolvimento', 'empresa',
      'equipe', 'anos de', 'responsável', 'habilidades', 'educação',
      'projetos', 'vendas', 'conhecimentos', 'atuação', 'liderança de',
      // Not "mais" (French), "das"/"dos" (German, Spanish), "com" (a URL),
      // "quando" (Italian).
      'uma', 'foi', 'seu', 'sua', 'seus', 'suas', 'muito', 'ainda', 'pelo', 'pela', 'pelos', 'também', 'até', 'cidade', 'então',
    ],
  },
  nl: {
    name: 'Dutch',
    words: [
      'ervaring', 'ontwikkeling', 'verantwoordelijk', 'vaardigheden',
      'opleiding', 'werkzaamheden', 'bedrijf', 'projecten', 'jaar ervaring',
      'binnen', 'waaronder', 'werkervaring', 'kennis van', 'leidinggeven',
    ],
  },
  it: {
    name: 'Italian',
    words: [
      'anni', 'esperienza', 'sviluppo', 'gestione', 'azienda', 'responsabile',
      'competenze', 'formazione', 'presso', 'lavoro', 'progetti', 'vendite',
      'conoscenze', 'capacità', 'attività',
    ],
  },
  // Polish, Turkish, Swedish, Indonesian and Malay (S13-024). Words the
  // neighbouring languages do not share: no Czech/Slovak "je"/"na", no
  // Danish/Norwegian "med"/"som", no Malay-and-Indonesian common core alone,
  // and no Turkish "ve", which an apostrophe in "we've" would leave standing.
  pl: {
    name: 'Polish',
    words: [
      'oraz', 'się', 'jest', 'dla', 'przez', 'który', 'która', 'które',
      'doświadczenie', 'umiejętności', 'wykształcenie', 'zarządzanie',
      'odpowiedzialny', 'odpowiedzialna', 'współpraca', 'firmy', 'także',
      'również', 'jako', 'może', 'będzie', 'pracy', 'zespołu', 'lub',
    ],
  },
  tr: {
    name: 'Turkish',
    words: [
      'için', 'ile', 'olarak', 'bir', 'deneyim', 'deneyimi', 'yönetimi',
      'sorumlu', 'geliştirme', 'eğitim', 'beceriler', 'şirket', 'proje',
      'çalıştım', 'görev', 'veya', 'olan', 'gibi', 'daha', 'kadar', 'sonra',
    ],
  },
  sv: {
    name: 'Swedish',
    words: [
      'och', 'att', 'är', 'för', 'inte', 'också', 'erfarenhet', 'arbete',
      'ansvarig', 'utveckling', 'utbildning', 'kunskaper', 'företag',
      'arbetat', 'ansvar', 'eller', 'från', 'hos', 'inom', 'även', 'när',
    ],
  },
  // Indonesian and Malay share their commonest words ("yang", "dan",
  // "untuk"), so both lists carry them and each adds the spellings only it
  // writes (Indonesian perusahaan, karena, bisa, universitas, proyek; Malay
  // syarikat, kerana, boleh, universiti, projek). A text with only the shared
  // words, or as many of one's spellings as the other's, is 'unknown'.
  id: {
    name: 'Indonesian',
    words: [
      'yang', 'dengan', 'untuk', 'dalam', 'tidak', 'adalah', 'pengalaman',
      'perusahaan', 'karena', 'bisa', 'saat', 'universitas', 'proyek',
      'manajemen', 'kualitas', 'nomor', 'telepon', 'pesan', 'coba',
      'silakan', 'kirim', 'kata sandi', 'kerja sama',
      'bahwa', 'yaitu', 'maupun', 'saja', 'setelah', 'internasional', 'uang', 'klub', 'musik', 'serikat',
    ],
  },
  ms: {
    name: 'Malay',
    words: [
      'yang', 'dengan', 'untuk', 'dalam', 'tidak', 'adalah', 'pengalaman',
      'syarikat', 'kerana', 'boleh', 'semasa', 'universiti', 'projek',
      'pengurusan', 'kualiti', 'nombor', 'telefon', 'mesej', 'cuba', 'sila',
      'kata laluan', 'kerjasama',
      'bahawa', 'iaitu', 'mahupun', 'sahaja', 'selepas', 'antarabangsa', 'wang', 'kelab', 'muzik', 'filem', 'bandar',
    ],
  },
  tl: {
    name: 'Tagalog',
    words: [
      'ang', 'mga', 'ako', 'trabaho', 'karanasan', 'kasanayan', 'pamamahala',
      'kumpanya', 'proyekto', 'edukasyon', 'namamahala', 'pagbebenta',
    ],
  },
  en: {
    name: 'English',
    words: [
      'the', 'and', 'with', 'experience', 'years', 'managed', 'led',
      'developed', 'responsible', 'skills', 'education', 'improved',
      'increased', 'team', 'project',
    ],
  },
};

/** Count each list's distinct words and capped hits in an already-lowercased text. */
function scoreLists(text: string, lists: Record<string, { name: string; words: string[] }>) {
  const scores: Record<string, { score: number; distinct: number; hits: string[] }> = {};
  for (const [code, { words }] of Object.entries(lists)) {
    let score = 0;
    let distinct = 0;
    const hits: string[] = [];
    for (const w of words) {
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // NOT \b: JS \b only understands ASCII \w, so it silently never matches at
      // accented edges — \béquipe\b can't fire (space→é is \W→\W, no boundary).
      // Unicode letter/mark/digit lookarounds give real word boundaries for any
      // script (the marks keep a Devanagari vowel sign from ending a word).
      const count = (text.match(new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escaped}(?![\\p{L}\\p{M}\\p{N}])`, 'gu')) || []).length;
      if (count > 0) {
        distinct++;
        score += Math.min(count, 5); // cap per-word so one repeated term can't dominate
        if (hits.length < 4) hits.push(w);
      }
    }
    scores[code] = { score, distinct, hits };
  }
  return scores;
}

// Writing systems. A script one language owns names that language; a shared
// one is read further by its languages' own words below.
const SCRIPTS: Array<{ script: string; re: RegExp; language?: string; name?: string }> = [
  { script: 'Cyrillic', re: /\p{Script=Cyrillic}/gu },
  { script: 'Arabic', re: /\p{Script=Arabic}/gu },
  { script: 'Devanagari', re: /\p{Script=Devanagari}/gu },
  { script: 'Han', re: /\p{Script=Han}/gu },
  { script: 'Kana', re: /[\p{Script=Hiragana}\p{Script=Katakana}]/gu, language: 'ja', name: 'Japanese' },
  { script: 'Hangul', re: /\p{Script=Hangul}/gu, language: 'ko', name: 'Korean' },
  { script: 'Greek', re: /\p{Script=Greek}/gu, language: 'el', name: 'Greek' },
  { script: 'Hebrew', re: /\p{Script=Hebrew}/gu, language: 'he', name: 'Hebrew' },
  { script: 'Thai', re: /\p{Script=Thai}/gu, language: 'th', name: 'Thai' },
  { script: 'Bengali', re: /\p{Script=Bengali}/gu },
  { script: 'Tamil', re: /\p{Script=Tamil}/gu },
  { script: 'Telugu', re: /\p{Script=Telugu}/gu },
  { script: 'Gujarati', re: /\p{Script=Gujarati}/gu },
  { script: 'Gurmukhi', re: /\p{Script=Gurmukhi}/gu },
  { script: 'Kannada', re: /\p{Script=Kannada}/gu },
  { script: 'Malayalam', re: /\p{Script=Malayalam}/gu },
  { script: 'Georgian', re: /\p{Script=Georgian}/gu },
  { script: 'Armenian', re: /\p{Script=Armenian}/gu },
  { script: 'Ethiopic', re: /\p{Script=Ethiopic}/gu },
  { script: 'Sinhala', re: /\p{Script=Sinhala}/gu },
  { script: 'Khmer', re: /\p{Script=Khmer}/gu },
  { script: 'Myanmar', re: /\p{Script=Myanmar}/gu },
];

// Languages that share a script, told apart by their own common words. A
// word two of them share ("को", "के" in Hindi and Nepali; "в", "на" in
// Russian and Ukrainian; "من" in Arabic and Persian) is on no list.
const SHARED_SCRIPT_WORDS: Record<string, Record<string, { name: string; words: string[] }>> = {
  Devanagari: {
    hi: { name: 'Hindi', words: ['है', 'हैं', 'और', 'में', 'की', 'का', 'से', 'किया', 'था', 'थी', 'लिए', 'एक', 'पर', 'साथ', 'द्वारा'] },
    mr: { name: 'Marathi', words: ['आहे', 'आहेत', 'आणि', 'मध्ये', 'केले', 'होते', 'साठी', 'च्या', 'या', 'व', 'केला', 'करणे', 'म्हणून', 'मी'] },
    ne: { name: 'Nepali', words: ['छ', 'छन्', 'र', 'मा', 'गरेको', 'थियो', 'हो', 'भएको', 'गर्ने', 'लागि', 'पनि', 'यो', 'गरें', 'सम्म'] },
  },
  Cyrillic: {
    // Not "и", "за", "на", "образование", "управление", "компании": Bulgarian
    // writes them too; nor "или", "при", "как", "все": Bulgarian and Serbian do.
    ru: { name: 'Russian', words: ['что', 'это', 'также', 'опыт', 'опытом', 'был', 'была', 'работы', 'работал', 'работала', 'отвечал', 'отвечала', 'навыки', 'более', 'лет', 'если', 'его', 'чтобы', 'всех', 'нет', 'больше', 'который', 'которые', 'было', 'будет', 'можно', 'только', 'есть'] },
    uk: { name: 'Ukrainian', words: ['та', 'що', 'це', 'як', 'або', 'також', 'досвід', 'досвідом', 'був', 'була', 'роботи', 'працював', 'працювала', 'відповідав', 'освіта', 'навички', 'більше', 'років', 'якщо', 'його', 'усі', 'і'] },
    bg: { name: 'Bulgarian', words: ['това', 'които', 'който', 'която', 'което', 'със', 'във', 'също', 'опит', 'като', 'след', 'трябва', 'година', 'години', 'са', 'съм'] },
    sr: { name: 'Serbian', words: ['је', 'који', 'која', 'које', 'што', 'као', 'али', 'током', 'године', 'између', 'због', 'од'] },
    mk: { name: 'Macedonian', words: ['кој', 'кое', 'кои', 'исто така', 'помеѓу', 'беше', 'од', 'во'] },
  },
  Arabic: {
    ar: { name: 'Arabic', words: ['في', 'على', 'إلى', 'التي', 'الذي', 'هذه', 'هذا', 'عن', 'مع', 'كان', 'ذلك', 'أو', 'يمكن', 'لا'] },
    fa: { name: 'Persian', words: ['است', 'در', 'را', 'که', 'این', 'از', 'با', 'برای', 'های', 'می', 'شده', 'یک'] },
    ur: { name: 'Urdu', words: ['ہے', 'ہیں', 'کے', 'میں', 'اور', 'کی', 'کا', 'سے', 'کو', 'نے', 'لیے'] },
  },
};

// English words no listed or neighbouring language writes the same way
// ("to", "is", "was", "of", "for", "we", "will" and "are" are words in
// Polish, Czech, Dutch, German, Danish or Romanian). Used only to decide
// whether a Latin-script text that matched no list is English after all.
const ENGLISH_FUNCTION_WORDS = ['the', 'and', 'with', 'from', 'were', 'have', 'has', 'this', 'that', 'which', 'our', 'your', 'you', 'they', 'been', 'into', 'about', 'their', 'would', 'while', 'where'];

const nameOfScript = (script: string) => `a language written in the ${script} script`;

/**
 * Detect the language a resume is written in. Non-English requires ≥3 distinct
 * matched words AND a clear lead over English — a stray Spanish phrase on an
 * English resume must not flip the report language.
 */
export function detectResumeLanguage(resumeText: string): ResumeLanguageResult {
  // Normalize typographic apostrophes (U+2019/U+2018, what Word/Docs insert)
  // to straight quotes so list entries like "d'expérience" match real resumes.
  const text = resumeText.toLowerCase().replace(/[‘’]/g, "'");
  const result = (language: string, languageName: string, confidence: 'high' | 'medium' | 'low', evidence: string[], script: string): ResumeLanguageResult =>
    ({ language, languageName, confidence, evidence, script, supported: SUPPORTED_LANGUAGES.includes(language) });

  // 1. The writing system. A non-Latin script decides when it holds at least
  // 30 letters and a fifth of all letters: an English CV that lists
  // "Languages: हिन्दी, Русский" stays English, a Russian CV full of English
  // tool names does not.
  const latin = (resumeText.match(/\p{Script=Latin}/gu) || []).length;
  const counts = SCRIPTS.map((s) => ({ ...s, n: (resumeText.match(s.re) || []).length }));
  const han = counts.find((c) => c.script === 'Han')!.n;
  const kana = counts.find((c) => c.script === 'Kana')!.n;
  // Japanese writes Han and kana together; kana is what marks it.
  if (kana > 0 && kana >= (han + kana) * 0.1) counts.find((c) => c.script === 'Kana')!.n += han;
  const allLetters = latin + counts.reduce((sum, c) => sum + c.n, 0);
  const top = counts.filter((c) => !(c.script === 'Han' && kana > 0 && kana >= (han + kana) * 0.1)).sort((a, b) => b.n - a.n)[0];
  if (top && top.n >= 30 && top.n >= allLetters * 0.2) {
    const evidence = [`${top.n} ${top.script} letters of ${allLetters}`];
    if (top.language) return result(top.language, top.name!, 'high', evidence, top.script);
    if (top.script === 'Han') return result('zh', 'Chinese', 'high', evidence, 'Han');
    const lists = SHARED_SCRIPT_WORDS[top.script];
    if (lists) {
      const s = scoreLists(text, lists);
      // Letters only one of them writes count as one more word: ы and э are
      // Russian (and Belarusian, which also writes і and ў), і ї є ґ Ukrainian.
      if (top.script === 'Cyrillic') {
        if (/[ыэё]/.test(text) && !/[іїєґў]/.test(text)) { s.ru.distinct++; s.ru.hits.push('ы/э'); }
        if (/[іїєґ]/.test(text) && !/[ыэў]/.test(text)) { s.uk.distinct++; s.uk.hits.push('і/ї/є'); }
        // ъ inside words is Bulgarian (Russian writes it rarely, and with ы/э);
        // ј љ њ џ are Serbian and Macedonian, ћ ђ Serbian, ќ ѓ ѕ Macedonian.
        if ((text.match(/ъ/g) || []).length >= 3 && !/[ыэ]/.test(text)) { s.bg.distinct++; s.bg.hits.push('ъ'); }
        if (/[ћђ]/.test(text) || (/[јљњџ]/.test(text) && !/[ќѓѕ]/.test(text))) { s.sr.distinct++; s.sr.hits.push('ј/ћ/ђ'); }
        if (/[ќѓѕ]/.test(text)) { s.mk.distinct++; s.mk.hits.push('ќ/ѓ/ѕ'); }
      }
      const ranked = Object.entries(s).sort((a, b) => b[1].distinct - a[1].distinct || b[1].score - a[1].score);
      const [code, best] = ranked[0];
      const second = ranked[1]?.[1];
      // Its own words, at least two of them, and more of them than any
      // other language of the script.
      if (best.distinct >= 2 && best.distinct > (second?.distinct ?? 0)) {
        return result(code, lists[code].name, best.distinct >= 3 ? 'high' : 'medium', [...evidence, `matched: ${best.hits.join(', ')} (${best.distinct} distinct terms)`], top.script);
      }
      // Devanagari with a Hindi word and no Marathi or Nepali one is read as
      // Hindi, the script's commonest language, as it always was.
      if (top.script === 'Devanagari' && s.hi.distinct >= 1 && s.mr.distinct === 0 && s.ne.distinct === 0) {
        return result('hi', 'Hindi', 'medium', [...evidence, `matched: ${s.hi.hits.join(', ')}`], 'Devanagari');
      }
    }
    return result('unknown', nameOfScript(top.script), 'low', [...evidence, 'no language of the script clears the bar'], top.script);
  }

  // 2. Latin script: the word lists.
  const scores = scoreLists(text, LANGUAGE_WORDS);
  const en = scores.en;
  const ranked = Object.entries(scores)
    .filter(([code]) => code !== 'en')
    .sort((a, b) => b[1].score - a[1].score);
  const [topCode, topLang] = ranked[0];

  // Non-English wins only with real evidence AND a clear lead over English.
  // Bar tuned on a real miss: a compact French resume matched 4 distinct words
  // (score 4) and failed the original >=6 bar, so the language hint never fired
  // and the report language was left to chance. >=3 distinct collision-safe
  // words with a 1.2x lead is already far beyond anything an English resume
  // produces against these lists.
  if (topLang.distinct >= 3 && topLang.score >= 4 && topLang.score > en.score * 1.2) {
    // Indonesian and Malay share their commonest words: only the spellings
    // one of them writes decide, and none decides nothing.
    if (topCode === 'id' || topCode === 'ms') {
      const own = (a: string, b: string) => LANGUAGE_WORDS[a].words.filter(w => !LANGUAGE_WORDS[b].words.includes(w));
      const tell = scoreLists(text, { id: { name: 'Indonesian', words: own('id', 'ms') }, ms: { name: 'Malay', words: own('ms', 'id') } });
      if (tell.id.distinct === tell.ms.distinct) {
        return result('unknown', 'an unidentified language', 'low',
          [`matched words Indonesian and Malay share (${topLang.hits.join(', ')}); ${tell.id.distinct} spellings of either`], 'Latin');
      }
      const code = tell.id.distinct > tell.ms.distinct ? 'id' : 'ms';
      return result(code, LANGUAGE_WORDS[code].name, 'medium',
        [`matched: ${scores[code].hits.join(', ')}; own spellings: ${tell[code].hits.join(', ')}`], 'Latin');
    }
    const runnerUp = ranked[1]?.[1].score ?? 0;
    const confidence: 'high' | 'medium' =
      topLang.score >= runnerUp * 2 && topLang.score >= en.score * 2 ? 'high' : 'medium';
    return result(topCode, LANGUAGE_WORDS[topCode].name, confidence,
      [`matched: ${topLang.hits.join(', ')} (${topLang.distinct} distinct terms, score ${topLang.score} vs en ${en.score})`], 'Latin');
  }

  // 3. No list cleared the bar. A text of some length with almost no English
  // function words is in a language we have no list for (Czech, Danish,
  // Finnish, Romanian, Vietnamese...): say so rather than call it English.
  // It takes both: next to no English, and the accented letters of the
  // language it is in (Czech, Polish, Finnish, Danish, Romanian, Catalan and
  // Vietnamese all write them; English writes them only in a name or a
  // "résumé"), so a terse English CV of tool names and job titles stays English.
  const words = (text.match(/\p{L}+/gu) || []).length;
  const englishFn = scoreLists(text, { en: { name: 'English', words: ENGLISH_FUNCTION_WORDS } }).en;
  const accented = (text.match(/[^\x00-\x7f\p{M}](?<=\p{Script=Latin})/gu) || []).length;
  if (words >= 40 && englishFn.distinct <= 1 && en.distinct <= 2 && accented >= latin * 0.015) {
    // Not English. Before saying "unknown", read the supported languages'
    // lists again at a lower bar: two of a language's own words, more than
    // any other supported language. Prose with little résumé vocabulary (a
    // Portuguese job ad, a Spanish paragraph) is named, and never told the
    // report does not cover the language it covers.
    const supportedRanked = ranked.filter(([code]) => SUPPORTED_LANGUAGES.includes(code)).sort((a, b) => b[1].distinct - a[1].distinct || b[1].score - a[1].score);
    const [lowCode, low] = supportedRanked[0] ?? [];
    const lowSecond = supportedRanked[1]?.[1];
    const unsupportedBest = ranked.filter(([code]) => !SUPPORTED_LANGUAGES.includes(code)).reduce((m, [, v]) => Math.max(m, v.distinct), 0);
    if (low && low.distinct >= 2 && low.distinct > (lowSecond?.distinct ?? 0) && low.distinct > unsupportedBest) {
      return result(lowCode, LANGUAGE_WORDS[lowCode].name, 'low',
        [`matched: ${low.hits.join(', ')} (${low.distinct} distinct terms, below the main bar; ${englishFn.distinct} English function words)`], 'Latin');
    }
    return result('unknown', 'an unidentified language', 'low',
      [`${words} words, ${englishFn.distinct} English function words, ${accented} accented letters, no word list cleared the bar`], 'Latin');
  }

  return result('en', 'English', en.distinct >= 3 ? 'high' : 'medium',
    en.distinct > 0 ? [`English terms matched (score ${en.score})`] : ['no strong language signals — defaulting to English'], 'Latin');
}

/** What the report says when it is not built for the résumé's language (S13-024). */
export interface LanguageNotice {
  reason: 'unknown' | 'unsupported';
  /** ISO 639-1 code, or 'unknown'. */
  language: string;
  /** English name of the language, or null when it is unknown. */
  name: string | null;
  script: string;
  /** One plain English sentence; the page may show its own translation from `reason` and `name`. */
  message: string;
}

const SUPPORTED_NAMES = 'English, Spanish, French, German, Portuguese, Dutch, Italian, Hindi and Tagalog';

export function languageNoticeOf(r: ResumeLanguageResult): LanguageNotice | null {
  if (r.supported) return null;
  if (r.language === 'unknown') {
    const where = r.script === 'Latin' ? 'which language this résumé is written in' : `which language this résumé is written in (it uses the ${r.script} script)`;
    return {
      reason: 'unknown', language: 'unknown', name: null, script: r.script,
      message: `We could not tell ${where}. The report's keyword and section checks are built for ${SUPPORTED_NAMES}, so they read it against English terms and may miss words in your language.`,
    };
  }
  return {
    reason: 'unsupported', language: r.language, name: r.languageName, script: r.script,
    message: `This résumé reads as ${r.languageName}. The report's keyword and section checks are built for ${SUPPORTED_NAMES}, so they read it against English terms and may miss ${r.languageName} ones.`,
  };
}

/**
 * The prompt's language instruction, appended last so it is the freshest
 * thing the model reads. English needs none. A supported language gets the
 * hard instruction it always had; a language the lists do not cover gets the
 * same instruction plus a warning that the English keyword evidence may miss
 * its words; an unknown one is told to answer in the résumé's own language.
 */
export function formatLanguageForPrompt(r: ResumeLanguageResult, fixedChoicesNote: string): string {
  if (r.language === 'en') return '';
  const listNote = r.supported ? '' : ` The keyword evidence and section checks above are built for English and eight other languages, not this one: a skill whose English name is absent may still be on the resume in its own words, so do not call it missing on that ground alone.`;
  if (r.language === 'unknown') {
    const script = r.script === 'Latin' ? '' : ` (it is written in the ${r.script} script)`;
    return `\n\n**RESUME LANGUAGE NOT IDENTIFIED (MANDATORY).** The scanner could not identify the language this resume is written in${script}. Write your ENTIRE response in the language the resume itself is written in — every free-text string value (tips, red flags, rewrites, explanations, verdicts). Keep the JSON keys in English exactly as specified. ${fixedChoicesNote} Keyword suggestions must be terms actually used in the resume's own job market.${listNote}`;
  }
  return `\n\n**DETECTED RESUME LANGUAGE: ${r.languageName.toUpperCase()} (MANDATORY).** This resume is written in ${r.languageName}. Your ENTIRE response must be written in ${r.languageName} — every free-text string value (tips, red flags, rewrites, explanations, verdicts). Keep the JSON keys in English exactly as specified. ${fixedChoicesNote} Keyword suggestions must be ${r.languageName} terms actually used in that job market. Do NOT respond in English.${listNote}`;
}

// Language → country evidence for geo detection. Corroboration-style: the
// homeland is only a WEAK prior (weight of a city mention) because languages
// cross borders (de→AT/CH, pt→PT, es→LATAM, fr→BE/CA). Multi-country languages
// list every plausible market so an existing signal for any of them can be
// corroborated instead of contradicted.
export const LANGUAGE_GEO: Record<string, { homeland: string; countries: string[] }> = {
  fr: { homeland: 'FR', countries: ['FR', 'BE', 'CH', 'CA'] },
  de: { homeland: 'DE', countries: ['DE', 'AT', 'CH'] },
  nl: { homeland: 'NL', countries: ['NL', 'BE'] },
  it: { homeland: 'IT', countries: ['IT', 'CH'] },
  pt: { homeland: 'BR', countries: ['BR', 'PT'] },
  es: { homeland: 'ES', countries: ['ES', 'MX', 'AR', 'CL', 'CO', 'PE'] },
  hi: { homeland: 'IN', countries: ['IN'] },
  tl: { homeland: 'PH', countries: ['PH'] },
};
