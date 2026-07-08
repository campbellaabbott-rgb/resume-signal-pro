// FAQ generation for the 58 industry pages — rich-result eligibility at
// scale, generated ONLY from the live detection data the page already shows
// (keywords, certifications, screener notes). No invented answers: every
// sentence is product truth. Pure module: imported by the React page AND the
// build-time prerenderer so the visible content and JSON-LD never drift.

export interface IndustryFaq {
  q: string;
  a: string;
}

export function buildIndustryFaqs(opts: {
  name: string; // display name, e.g. "Healthcare"
  keywords: string[];
  certifications: string[];
  screenerNote?: string;
}): IndustryFaq[] {
  const { name, keywords, certifications, screenerNote } = opts;
  const lower = name.toLowerCase();
  const faqs: IndustryFaq[] = [];

  if (keywords.length >= 5) {
    faqs.push({
      q: `What keywords do ATS systems look for on ${lower} resumes?`,
      a: `The highest-weight terms in our ${lower} detection engine include ${keywords.slice(0, 8).join(", ")}. These come from the live tables our scanner runs on every ${lower} resume — use the exact recognized form of each term you can honestly claim, once, attached to real experience.`,
    });
  }

  if (certifications.length >= 2) {
    faqs.push({
      q: `Which certifications matter most on a ${lower} resume?`,
      a: `Our scanner anchors ${lower} resumes on certifications like ${certifications.slice(0, 6).map((c) => c.toUpperCase()).join(", ")}. List the ones you hold with their exact recognized abbreviation — recruiters and ATS searches both match on the standard form.`,
    });
  }

  if (screenerNote) {
    faqs.push({
      q: `What do screeners check first on ${lower} resumes?`,
      a: screenerNote,
    });
  }

  faqs.push({
    q: `How do I check my ${lower} resume against this data?`,
    a: `Run the free scan — it checks your actual document against these exact keyword tables, plus parsing, structure, and red flags, and returns a full diagnostic report in about 20 seconds. No signup; your resume is never stored.`,
  });

  return faqs;
}
