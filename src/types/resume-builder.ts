// Structured resume data model for the Resume Builder feature.
// Unlike the rest of the app (which treats resumes as raw text for AI analysis),
// the builder needs a real, editable schema with discrete sections.

export interface BuilderContact {
  fullName: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  linkedIn: string;
  website: string;
}

export interface BuilderExperienceEntry {
  id: string;
  company: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  bullets: string[];
}

export interface BuilderEducationEntry {
  id: string;
  school: string;
  degree: string;
  field: string;
  startDate: string;
  endDate: string;
  details: string;
}

export interface BuilderResume {
  contact: BuilderContact;
  summary: string;
  experience: BuilderExperienceEntry[];
  education: BuilderEducationEntry[];
  skills: string[];
  certifications: string[];
}

export function createEmptyContact(): BuilderContact {
  return {
    fullName: "",
    title: "",
    email: "",
    phone: "",
    location: "",
    linkedIn: "",
    website: "",
  };
}

export function createEmptyExperienceEntry(): BuilderExperienceEntry {
  return {
    id: crypto.randomUUID(),
    company: "",
    title: "",
    location: "",
    startDate: "",
    endDate: "",
    bullets: [""],
  };
}

export function createEmptyEducationEntry(): BuilderEducationEntry {
  return {
    id: crypto.randomUUID(),
    school: "",
    degree: "",
    field: "",
    startDate: "",
    endDate: "",
    details: "",
  };
}

export function createEmptyResume(): BuilderResume {
  return {
    contact: createEmptyContact(),
    summary: "",
    experience: [createEmptyExperienceEntry()],
    education: [createEmptyEducationEntry()],
    skills: [],
    certifications: [],
  };
}

// AI-generated resume data (from parse-resume-structured, generate-apply-package,
// etc.) never includes an `id` field — that's purely a client-side concern for
// React list keys — and isn't guaranteed to match the full shape if the model
// omits an array. This fills in both gaps so any AI response can be safely used
// as a real BuilderResume without each call site re-implementing the same
// normalization (and risking forgetting the id injection, which causes duplicate-
// key React warnings since every entry would otherwise share `undefined`).
// A list the model wrote, kept to its strings (S11-068): a null, a number or an
// object among the bullets reached the preview's b.trim() and threw, and took
// the paid page that showed the résumé with it.
const stringsOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

export function normalizeBuilderResume(data: Record<string, unknown> | undefined | null): BuilderResume {
  const raw = data || {};

  const experience = Array.isArray(raw.experience)
    ? (raw.experience as Record<string, unknown>[]).map((entry) => {
        const bullets = stringsOf(entry?.bullets);
        return {
          ...createEmptyExperienceEntry(),
          ...entry,
          bullets: bullets.length > 0 ? bullets : [""],
        };
      })
    : [];

  const education = Array.isArray(raw.education)
    ? (raw.education as Record<string, unknown>[]).map((entry) => ({
        ...createEmptyEducationEntry(),
        ...entry,
      }))
    : [];

  return {
    contact: { ...createEmptyContact(), ...(raw.contact as Partial<BuilderContact> | undefined) },
    summary: typeof raw.summary === "string" ? raw.summary : "",
    experience: experience.length > 0 ? experience : [createEmptyExperienceEntry()],
    education: education.length > 0 ? education : [createEmptyEducationEntry()],
    skills: stringsOf(raw.skills),
    certifications: stringsOf(raw.certifications),
  };
}
