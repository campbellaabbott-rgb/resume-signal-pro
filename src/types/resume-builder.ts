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
