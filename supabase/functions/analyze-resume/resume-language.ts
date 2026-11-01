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
 * Method: script check for Devanagari (Hindi), then distinctive-stopword
 * frequency for Latin-script languages. Word lists deliberately avoid
 * cross-language collisions (e.g. "experiência" pt ≠ "experiencia" es ≠
 * "expérience" fr) and English homographs ("mit" would match MIT, "von"
 * appears in surnames — both excluded or outvoted by the ≥3-distinct-words
 * requirement). English is the default when nothing clears the bar.
 */

export interface ResumeLanguageResult {
  language: string; // ISO 639-1 code: en, es, fr, de, pt, nl, it, hi, tl
  languageName: string; // English name, for prompt injection
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
}

const LANGUAGE_WORDS: Record<string, { name: string; words: string[] }> = {
  es: {
    name: 'Spanish',
    words: [
      'años', 'experiencia', 'desarrollo', 'gestión', 'empresa', 'equipo',
      'responsable de', 'trabajo', 'habilidades', 'educación', 'ventas',
      'logros', 'conocimientos', 'puesto', 'mejora', 'aumenté', 'lideré',
      'también', 'según', 'a través de', 'más de', 'y de',
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

/**
 * Detect the language a resume is written in. Non-English requires ≥3 distinct
 * matched words AND a clear lead over English — a stray Spanish phrase on an
 * English resume must not flip the report language.
 */
export function detectResumeLanguage(resumeText: string): ResumeLanguageResult {
  // Normalize typographic apostrophes (U+2019/U+2018, what Word/Docs insert)
  // to straight quotes so list entries like "d'expérience" match real resumes.
  const text = resumeText.toLowerCase().replace(/[‘’]/g, "'");

  // Script-based: Devanagari → Hindi (certain, no stopwords needed)
  const devanagari = (resumeText.match(/[ऀ-ॿ]/g) || []).length;
  if (devanagari > 20) {
    return { language: 'hi', languageName: 'Hindi', confidence: 'high', evidence: [`${devanagari} Devanagari characters`] };
  }

  const scores: Record<string, { score: number; distinct: number; hits: string[] }> = {};
  for (const [code, { words }] of Object.entries(LANGUAGE_WORDS)) {
    let score = 0;
    let distinct = 0;
    const hits: string[] = [];
    for (const w of words) {
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // NOT \b: JS \b only understands ASCII \w, so it silently never matches at
      // accented edges — \béquipe\b can't fire (space→é is \W→\W, no boundary).
      // Unicode letter/digit lookarounds give real word boundaries for any script.
      const count = (text.match(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'gu')) || []).length;
      if (count > 0) {
        distinct++;
        score += Math.min(count, 5); // cap per-word so one repeated term can't dominate
        if (hits.length < 4) hits.push(w);
      }
    }
    scores[code] = { score, distinct, hits };
  }

  const en = scores.en;
  const ranked = Object.entries(scores)
    .filter(([code]) => code !== 'en')
    .sort((a, b) => b[1].score - a[1].score);
  const [topCode, top] = ranked[0];

  // Non-English wins only with real evidence AND a clear lead over English.
  // Bar tuned on a real miss: a compact French resume matched 4 distinct words
  // (score 4) and failed the original >=6 bar, so the language hint never fired
  // and the report language was left to chance. >=3 distinct collision-safe
  // words with a 1.2x lead is already far beyond anything an English resume
  // produces against these lists.
  if (top.distinct >= 3 && top.score >= 4 && top.score > en.score * 1.2) {
    const runnerUp = ranked[1]?.[1].score ?? 0;
    const confidence: 'high' | 'medium' =
      top.score >= runnerUp * 2 && top.score >= en.score * 2 ? 'high' : 'medium';
    return {
      language: topCode,
      languageName: LANGUAGE_WORDS[topCode].name,
      confidence,
      evidence: [`matched: ${top.hits.join(', ')} (${top.distinct} distinct terms, score ${top.score} vs en ${en.score})`],
    };
  }

  return {
    language: 'en',
    languageName: 'English',
    confidence: en.distinct >= 3 ? 'high' : 'medium',
    evidence: en.distinct > 0 ? [`English terms matched (score ${en.score})`] : ['no strong language signals — defaulting to English'],
  };
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
