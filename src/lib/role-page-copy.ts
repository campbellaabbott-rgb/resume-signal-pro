// What a /roles/<slug> page says its lists are, spelled once for the React
// page and the bake (scripts/prerender-seo.mjs). Register L1-05: the lists
// are the role's FIELD's detection tables, and the baked intro said so while
// both pages' headings ("Keywords ATS systems expect on a pilot resume") and
// the React intro ("the live data our resume scanner uses when it detects a
// pilot resume") still presented them as written for the one title.

/** The intro, the two list headings and the structured-data description of one role page. */
export function roleListCopy(roleTitle: string, industryName: string) {
  const role = roleTitle.toLowerCase();
  const field = industryName.toLowerCase();
  return {
    intro: `These are the ${field} keyword tables, certifications and titles our resume scanner checks when it reads a resume in that field, ${role} resumes included. They are the field's lists, not a list written for this one title.`,
    keywordsHeading: `Keywords from the ${industryName} tables`,
    certsHeading: `Certifications in the ${industryName} tables`,
    ldDescription: `The ${field} keyword tables, certifications and titles a real resume scanner checks on every ${field} resume, ${role} resumes included.`,
  };
}
