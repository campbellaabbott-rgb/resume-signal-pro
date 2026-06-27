// Public changelog content. Add new entries to the TOP of this array as features
// ship — newest first. Keep entries written for users (what changed and why it
// helps them), not engineering changelogs (no file names, no internal jargon).

export type ChangelogTag = "new" | "improved" | "fixed";

export interface ChangelogEntry {
  date: string; // ISO date, e.g. "2026-06-26"
  title: string;
  description: string;
  tags: ChangelogTag[];
}

export const changelog: ChangelogEntry[] = [
  {
    date: "2026-06-26",
    title: "Apply Assistant",
    description:
      "Paste a job posting and get a resume tailored to that specific role, a matching cover letter, an honest list of skill gaps (we don't fabricate experience you don't have), and a step-by-step checklist — reviewed and submitted by you, never auto-submitted on your behalf.",
    tags: ["new"],
  },
  {
    date: "2026-06-25",
    title: "ATS Parse Simulation",
    description:
      "Added a second, fully mechanical check alongside the AI score: we detect missing section headers, unextractable contact info, missing dates, broken character encoding from PDF font issues, and even multi-column layouts that get scrambled by real ATS text parsers — all deterministic, reproducible findings, not a model's guess.",
    tags: ["new"],
  },
  {
    date: "2026-06-25",
    title: "Real semantic job matching",
    description:
      "Replaced literal keyword pattern-matching with genuine AI judgment that reads your resume and the job description together — so a skill phrased differently (or demonstrated through related experience) is now recognized correctly instead of requiring an exact text match.",
    tags: ["improved"],
  },
  {
    date: "2026-06-24",
    title: "Resume Builder",
    description:
      "A structured resume editor with editable sections, a live preview, and one-click export to PDF or Word — prefilled automatically from your most recent scan.",
    tags: ["new"],
  },
  {
    date: "2026-06-24",
    title: "Deeper Interview Coach and Career Path Simulator",
    description:
      "The paid versions now go further than the free preview: 14 interview questions with full model answers using the STAR method, a 90-day action plan for each career path, and downloadable PDF reports for both.",
    tags: ["improved"],
  },
  {
    date: "2026-06-23",
    title: "More honest scoring",
    description:
      "Removed a scoring bug that let resumes inflate toward the middle of the scale, and tightened the AI's instructions so a genuinely weak resume now scores low — encouragement in the feedback no longer softens the actual number.",
    tags: ["fixed"],
  },
  {
    date: "2026-06-22",
    title: "Faster page loads",
    description:
      "Cut the initial page size by more than half by only loading what each page actually needs — exports, less-common languages, and other pages no longer slow down your first visit.",
    tags: ["improved"],
  },
  {
    date: "2026-06-21",
    title: "Scanned PDF detection",
    description:
      "If you upload a scanned image-based PDF with no selectable text, we now tell you immediately instead of silently analyzing blank content — with a clear suggestion to upload a text-based version or paste your resume directly.",
    tags: ["fixed"],
  },
];
