export interface RedactionResult {
  redacted: string;
  exclusionsApplied: Array<{ feature: string; count: number }>;
}
interface Rule {
  feature: string;
  pattern: RegExp;
  replacement: string;
}
const BASELINE_RULES: Rule[] = [
  { feature: "date_of_birth", pattern: /\b(date of birth|dob|born)\s*[:\-]?\s*[\w\s,\/.-]{4,20}\b/gi, replacement: "[REDACTED-DOB]" },
  { feature: "explicit_age", pattern: /\b(age|aged)\s*[:\-]?\s*\d{2}\b/gi, replacement: "[REDACTED-AGE]" },
  { feature: "graduation_year", pattern: /\b(class of|graduated|graduation)\s*[:\-]?\s*(19|20)\d{2}\b/gi, replacement: "graduated [REDACTED-YEAR]" },
  { feature: "education_year_range", pattern: /\b(?:b\.?[as]\.?|m\.?[as]\.?|mba|ph\.?d\.?|bachelor(?:'s)?|master(?:'s)?|associate(?:'s)?)\b([^.\n]{0,80}?)\b(19|20)\d{2}\b/gi, replacement: (() => "$&") as unknown as string },
  { feature: "national_origin", pattern: /\b(nationality|citizen(ship)? of|national of|country of origin|visa status|work permit|green card|h-?1b|opt\b|cpt\b)\s*[:\-]?\s*[\w\s()-]{0,40}/gi, replacement: "[REDACTED-ORIGIN]" },
  { feature: "disability_mention", pattern: /\b(disability|disabled|accommodat(e|ion|ions)|chronic illness|medical leave|wheelchair|neurodivergen\w+|autis\w+|adhd|dyslexi\w+)\b[^.\n]{0,60}/gi, replacement: "[REDACTED-ADA]" },
  { feature: "family_status", pattern: /\b(married|single mother|single father|maternity|paternity|pregnan\w+|children:?\s*\d|dependents:?\s*\d)\b/gi, replacement: "[REDACTED-FAMILY]" },
  { feature: "affinity_group", pattern: /\b(women in \w+|black (professionals|engineers|mba)\w*|latin[oax]+ (professionals|association)\w*|asian (professionals|association)\w*|lgbtq?\+?\w*|veterans? (association|network)|society of women engineers|nsbe|shpe)\b[^.\n]{0,40}/gi, replacement: "[REDACTED-AFFINITY]" },
  { feature: "religion", pattern: /\b(church|mosque|synagogue|temple|ministry|christian|muslim|jewish|hindu|buddhist|catholic)\b[^.\n]{0,40}/gi, replacement: "[REDACTED-RELIGION]" },
  { feature: "street_address", pattern: /\b\d{1,5}\s+[A-Z][a-z]+\s+(street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|court|ct\.?)\b[^,\n]{0,30}/gi, replacement: "[REDACTED-ADDRESS]" },
  { feature: "zip_code", pattern: /\b\d{5}(?:-\d{4})?\b(?=\s*(?:$|\n|,|\s{2}))/g, replacement: "[REDACTED-ZIP]" },
  { feature: "photo_reference", pattern: /\b(photo|photograph|headshot|profile picture)\s*[:\-]?\s*(attached|included|enclosed|\.(jpe?g|png))\b/gi, replacement: "[REDACTED-PHOTO]" },
  { feature: "gendered_terms", pattern: /\b(mr\.|mrs\.|ms\.|miss|he\/him|she\/her|they\/them|pronouns\s*[:\-]\s*[\w/]+)\b/gi, replacement: "[REDACTED-GENDER]" },
];
function redactName(text: string): { text: string; count: number } {
  const firstLine = (text.split("\n").find(l => l.trim().length > 0) ?? "").trim();
  const looksLikeName = /^[A-ZÀ-Þ][\w'’.-]+(\s+[A-ZÀ-Þ][\w'’.-]+){1,3}$/u.test(firstLine) && !/\d/.test(firstLine);
  if (!looksLikeName) return { text, count: 0 };
  let count = 0;
  const tokens = firstLine.split(/\s+/).filter(t => t.length > 1);
  let out = text;
  const escapedFull = firstLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  out = out.replace(new RegExp(escapedFull, "g"), () => { count++; return "[CANDIDATE]"; });
  for (const tok of tokens) {
    const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${esc}\\b`, "g"), () => { count++; return "[CANDIDATE]"; });
  }
  return { text: out, count };
}
function redactEducationYears(text: string): { text: string; count: number } {
  let count = 0;
  const lines = text.split("\n");
  let inEducation = false;
  const out = lines.map(line => {
    const l = line.toLowerCase();
    if (/^\s*(education|academic|qualifications)\b/.test(l)) inEducation = true;
    else if (/^\s*(experience|employment|work history|skills|projects|summary)\b/.test(l)) inEducation = false;
    if (inEducation && /(19|20)\d{2}/.test(line)) {
      count++;
      return line.replace(/(19|20)\d{2}/g, "[YEAR]");
    }
    return line;
  }).join("\n");
  return { text: out, count };
}
export interface RedactionConfig {
  extraBlocklist?: Array<{ feature: string; pattern: string }>;
}
export function redactForScoring(rawText: string, config: RedactionConfig = {}): RedactionResult {
  const exclusions = new Map<string, number>();
  const bump = (feature: string, n: number) => {
    if (n > 0) exclusions.set(feature, (exclusions.get(feature) ?? 0) + n);
  };
  const nameResult = redactName(rawText);
  bump("candidate_name", nameResult.count);
  let text = nameResult.text;
  const eduResult = redactEducationYears(text);
  bump("education_years", eduResult.count);
  text = eduResult.text;
  for (const rule of BASELINE_RULES) {
    if (rule.feature === "education_year_range") continue;
    let count = 0;
    text = text.replace(rule.pattern, () => { count++; return rule.replacement; });
    bump(rule.feature, count);
  }
  for (const extra of (config.extraBlocklist ?? []).slice(0, 20)) {
    try {
      const re = new RegExp(extra.pattern.slice(0, 200), "gi");
      let count = 0;
      text = text.replace(re, () => { count++; return `[REDACTED-${extra.feature.toUpperCase().slice(0, 20)}]`; });
      bump(`custom:${extra.feature}`, count);
    } catch {  }
  }
  return {
    redacted: text,
    exclusionsApplied: Array.from(exclusions.entries()).map(([feature, count]) => ({ feature, count })),
  };
}