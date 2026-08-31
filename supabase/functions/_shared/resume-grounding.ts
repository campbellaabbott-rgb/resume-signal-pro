














export interface TailoredExperience {
  company: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  bullets: string[];
}

export interface TailoredEducation {
  school: string;
  degree: string;
  field: string;
  startDate: string;
  endDate: string;
  details: string;
}

export interface TailoredResumeShape {
  contact: Record<string, string>;
  summary: string;
  experience: TailoredExperience[];
  education: TailoredEducation[];
  skills: string[];
  certifications: string[];
}

export interface GroundingReport {
  ok: boolean;
  
  issues: string[];
  
  removedSkills: string[];
  removedCertifications: string[];
  
  cleaned: TailoredResumeShape;
}


export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set([
  "the", "of", "and", "a", "an", "at", "in", "for", "to", "de", "la", "el",
  "senior", "sr", "junior", "jr", "lead", "principal", "staff", "i", "ii", "iii",
]);


const sigTokens = (s: string) =>
  normalizeForMatch(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t));






function tokensSupported(hay: string, needle: string, ratio: number): boolean {
  const tokens = sigTokens(needle);
  if (tokens.length === 0) return true; 
  const hit = tokens.filter((tk) => hay.includes(tk)).length;
  return hit / tokens.length >= ratio;
}

const yearsIn = (s: string) => [...s.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => m[0]);














const NUM_CLAIM = /\$\s?\d[\d,.]*\s?[kKmMbB]?|\d+(?:[.,]\d+)?\s?%|\d+(?:\.\d+)?x\b|\b\d+(?:[.,]\d+)?\s?[kKmMbB]\b|\b\d{2,}\b/g;


const canonNum = (s: string) => s.replace(/[\s,]/g, "").toLowerCase();

const numClaims = (text: string): string[] =>
  [...(text.matchAll(NUM_CLAIM))].map((m) => m[0]).filter((raw) => {
    const bare = raw.replace(/[^0-9.]/g, "");
    const isBareInt = /^\d+$/.test(raw.trim());
    if (isBareInt && Number(bare) < 13) return false;      
    if (isBareInt && /^(19|20)\d{2}$/.test(raw.trim())) return false; 
    return true;
  });





export function unsupportedNumericClaims(sourceResume: string, text: string): string[] {
  const sourceNums = new Set(numClaims(sourceResume).map(canonNum));
  
  
  for (const m of sourceResume.matchAll(/\d[\d,.]*/g)) sourceNums.add(canonNum(m[0]));
  const bad: string[] = [];
  for (const claim of numClaims(text)) {
    const canon = canonNum(claim);
    const digits = canon.replace(/[^0-9.]/g, "");
    if (sourceNums.has(canon) || sourceNums.has(digits)) continue;
    bad.push(claim.trim());
  }
  return [...new Set(bad)];
}











export function validateProseClaims(sourceResume: string, text: string, supportingContext = ""): string[] {
  const source = supportingContext ? `${sourceResume}\n${supportingContext}` : sourceResume;
  const issues: string[] = [];
  for (const n of unsupportedNumericClaims(source, text)) {
    issues.push(supportingContext
      ? `Figure "${n}" appears in neither the resume nor the job posting`
      : `Figure "${n}" does not appear in the source resume`);
  }
  return issues;
}

export function validateTailoredResume(sourceResume: string, resume: TailoredResumeShape): GroundingReport {
  const hay = " " + normalizeForMatch(sourceResume) + " ";
  const hayYears = new Set(yearsIn(sourceResume));
  const issues: string[] = [];

  for (const exp of resume.experience ?? []) {
    const company = normalizeForMatch(exp.company ?? "");
    if (company && !hay.includes(company) && !tokensSupported(hay, exp.company, 1)) {
      issues.push(`Employer "${exp.company}" does not appear in the source resume`);
    }
    if (!tokensSupported(hay, exp.title ?? "", 0.5)) {
      issues.push(`Job title "${exp.title}" is not supported by the source resume`);
    }
    for (const y of [...yearsIn(exp.startDate ?? ""), ...yearsIn(exp.endDate ?? "")]) {
      if (!hayYears.has(y)) issues.push(`Year ${y} on "${exp.company}" does not appear in the source resume`);
    }
    
    for (const n of unsupportedNumericClaims(sourceResume, (exp.bullets ?? []).join("\n"))) {
      issues.push(`Figure "${n}" in a "${exp.company}" bullet does not appear in the source resume`);
    }
  }

  for (const n of unsupportedNumericClaims(sourceResume, resume.summary ?? "")) {
    issues.push(`Figure "${n}" in the summary does not appear in the source resume`);
  }

  for (const edu of resume.education ?? []) {
    if (!tokensSupported(hay, edu.school ?? "", 0.75)) {
      issues.push(`School "${edu.school}" does not appear in the source resume`);
    }
    if (!tokensSupported(hay, edu.degree ?? "", 0.4)) {
      issues.push(`Degree "${edu.degree}" is not supported by the source resume`);
    }
    for (const y of [...yearsIn(edu.startDate ?? ""), ...yearsIn(edu.endDate ?? "")]) {
      if (!hayYears.has(y)) issues.push(`Year ${y} on "${edu.school}" does not appear in the source resume`);
    }
  }

  const removedSkills: string[] = [];
  const keptSkills = (resume.skills ?? []).filter((sk) => {
    const supported = tokensSupported(hay, sk, 1);
    if (!supported) removedSkills.push(sk);
    return supported;
  });

  const removedCertifications: string[] = [];
  const keptCerts = (resume.certifications ?? []).filter((c) => {
    
    const supported = tokensSupported(hay, c, 0.75);
    if (!supported) removedCertifications.push(c);
    return supported;
  });

  return {
    ok: issues.length === 0,
    issues,
    removedSkills,
    removedCertifications,
    cleaned: { ...resume, skills: keptSkills, certifications: keptCerts },
  };
}
