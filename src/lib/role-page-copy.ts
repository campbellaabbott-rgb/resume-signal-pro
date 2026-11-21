// What a /roles/<slug> page says its lists are, spelled once for the React
// page and the bake (scripts/prerender-seo.mjs). Register L1-05: the lists
// are the role's FIELD's detection tables, and the baked intro said so while
// both pages' headings ("Keywords ATS systems expect on a pilot resume") and
// the React intro ("the live data our resume scanner uses when it detects a
// pilot resume") still presented them as written for the one title.

import { inSentence } from "./seo/display-case";

/**
 * The intro, the three list headings and the structured-data description of
 * one role page. The titles list's heading names what it is, the field's
 * table (SEO audit 2026-11-18, CONTENT-M2): its old heading claimed the
 * titles were searched by recruiters beside this one, over the same table on
 * every sibling page, and nothing measures a recruiter's search.
 */
export function roleListCopy(roleTitle: string, industryName: string) {
  // In a sentence an acronym stays one ("RN resumes", "HR tables"), SEO-019.
  const role = inSentence(roleTitle);
  const field = inSentence(industryName);
  return {
    intro: `These are the ${field} keyword tables, certifications and titles our resume scanner checks when it reads a resume in that field, ${role} resumes included. They are the field's lists, not a list written for this one title.`,
    keywordsHeading: `Keywords from the ${industryName} tables`,
    certsHeading: `Certifications in the ${industryName} tables`,
    relatedHeading: `Other titles in the ${industryName} tables`,
    ldDescription: `The ${field} keyword tables, certifications and titles a real resume scanner checks on every ${field} resume, ${role} resumes included.`,
  };
}
