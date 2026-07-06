// Vendor parsing-behavior data for /ats/:vendor pages. Pure data module —
// also imported by the build-time prerenderer (scripts/prerender-seo.mjs),
// so keep it free of React/browser imports.

export interface VendorGuide {
  name: string;
  headline: string;
  behaviors: Array<{ q: string; a: string }>;
}

export const VENDORS: Record<string, VendorGuide> = {
  workday: {
    name: "Workday",
    headline: "How Workday parses resumes — and what breaks",
    behaviors: [
      { q: "Does Workday read two-column resumes?", a: "Unreliably. Multi-column layouts frequently scramble Workday's parser — content reads out of order, and experience can end up attached to the wrong role. A single-column layout is the safe format." },
      { q: "Do decorative bullets and symbols survive?", a: "Often not. Non-standard bullet glyphs (✦, ➤, ►) and heavy tab-alignment can merge fields in the parsed preview. Standard round bullets parse cleanly." },
      { q: "Should I check the parsed result?", a: "Yes — Workday shows you the parsed fields before submission. Always review them; if your dates or titles landed in the wrong boxes, fix the source document rather than the form." },
    ],
  },
  greenhouse: {
    name: "Greenhouse",
    headline: "How Greenhouse handles your resume file",
    behaviors: [
      { q: "Does Greenhouse keep my original PDF?", a: "Yes — recruiters see your original file. But Greenhouse's keyword search runs on the extracted text, so layout quirks that break extraction still reduce how often you surface in searches." },
      { q: "Do fancy layouts hurt me in Greenhouse?", a: "Less than in form-filling systems, since humans see your original design — but the text layer still needs to extract cleanly for search and screening tools." },
    ],
  },
  lever: {
    name: "Lever",
    headline: "How Lever reads resume structure",
    behaviors: [
      { q: "Does Lever care about section headers?", a: "Yes. Lever's section detection expects standard headers — Experience, Education, Skills. Creative headers ('Where I've Made Impact') can unsort your history in the parsed profile." },
      { q: "What formatting parses best?", a: "Standard headers, single column, conventional bullets. Lever threads your history correctly when the structure is conventional." },
    ],
  },
  icims: {
    name: "iCIMS",
    headline: "How iCIMS auto-fills applications from your resume",
    behaviors: [
      { q: "Why did my application form fill in wrong?", a: "iCIMS auto-populates application fields from its parse of your resume. Columns plus tab-alignment is the worst case — fields land in the wrong boxes. Always verify the auto-filled form before submitting." },
      { q: "What's the safest format for iCIMS?", a: "Single column, no tables, standard section headers. The parse drives the form, so parse-safety matters more here than almost anywhere." },
    ],
  },
};
