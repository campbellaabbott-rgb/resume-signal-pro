/**
 * FREELANCE BOOST'S STRUCTURE TABLE AND ITS READING OF A REPLY.
 *
 * Pure (no imports, no Deno): the Node tests load it directly.
 *
 * S12-107. The table sent every buyer who freelances alongside a job (the
 * page's DEFAULT situation) to a consolidated "Independent Consultant
 * (part-time)" entry, so no 'alongside' buyer ever got the Projects section,
 * while the Projects section's own note said it was for "1–3 projects
 * alongside employment". One to three projects alongside a job now get the
 * Projects section (each project with its dates, so the overlap is visible);
 * four or more get the consolidated part-time entry. Every note says only
 * what is true of the buyer's own answers.
 *
 * S12-055 / S12-105. One gemini-2.5-pro call capped at 3,000 tokens (thinking
 * included) truncated the JSON for a buyer with three to five projects, and a
 * truncated reply was a 500 with no other model tried; a Transition Pro reply
 * without its cover letter or LinkedIn About was saved as delivered.
 * readBoostReply says whether a reply is a deliverable at all, so the caller
 * walks the model chain past an unusable one and never marks it delivered.
 */

export interface ProjectIntakeShape {
  clientType: string;
  deliverable: string;
}

export interface StructureInput {
  projects: readonly unknown[];
  targetRole?: string;
  freelanceWasPrimary?: boolean;
  overlapsEmployment?: boolean;
  returningToFullTime?: boolean;
  totalClientsOverall?: number;
  workMode?: "freelance" | "fractional";
}

export type Structure = { structure: string; header: string; note: string };

export function decideStructure(req: StructureInput): Structure {
  const n = req.projects.length;
  const projectsWord = n === 1 ? "one project" : `${n} projects`;
  // Fractional/interim leadership always gets the portfolio umbrella —
  // concurrent senior engagements under one entry is the convention, and it
  // preempts the job-hopping misread regardless of situation.
  if (req.workMode === "fractional") {
    return {
      structure: "fractional_portfolio",
      header: `Fractional ${req.targetRole || "Executive"}`,
      note: n > 1
        ? "Fractional leadership: one umbrella portfolio entry with per-engagement scope lines — concurrent engagements are the format, never hidden and never split into look-alike 'jobs'."
        : "Fractional/interim engagement: umbrella entry with explicit scope — reads as leadership continuity, not a gap or a gig.",
    };
  }
  if (req.overlapsEmployment) {
    if (n <= 3) {
      return {
        structure: "projects_section",
        header: "Freelance Projects",
        note: `Freelancing alongside a job, ${projectsWord}: a dedicated Projects section below Experience, each project with its dates, so the overlap is visible and never hidden.`,
      };
    }
    return {
      structure: "consolidated_part_time",
      header: "Independent Consultant (part-time)",
      note: `Freelancing alongside a job, ${projectsWord}: one consolidated role labeled (part-time) with its dates — the overlap is never hidden.`,
    };
  }
  if (req.returningToFullTime && (req.totalClientsOverall ?? n) >= 4) {
    return {
      structure: "consolidated_with_scope",
      header: "Independent Consultant",
      note: "Long freelance stretch returning to full-time: consolidated role plus a one-line scope statement to preempt the 'gap' read.",
    };
  }
  if (n >= 3 && req.freelanceWasPrimary) {
    return {
      structure: "consolidated",
      header: "Independent Consultant",
      note: "Three or more related projects with freelance as your main work: one consolidated role covering all of it.",
    };
  }
  return {
    structure: "projects_section",
    header: "Freelance Projects",
    note: `${n === 1 ? "One project" : `${n} projects`}: a dedicated Projects section below Experience, each project with its dates.`,
  };
}

export const BANNED_PHRASES = [/\bhelped with\b/i, /\bworked on\b/i, /\bwas responsible for\b/i, /\bresponsible for\b/i, /\bvarious clients\b/i, /\bmisc\.? projects\b/i];

/** Room for the reply: up to eight projects, the transition texts, and the reasoning a pro model spends against the same cap. */
export const BOOST_MAX_TOKENS = 8000;

/** Words in a text, for the Transition Pro length floors. */
const words = (s: unknown) => (typeof s === "string" ? s.trim().split(/\s+/).filter(Boolean).length : 0);

/** The shortest Transition Pro texts that are still the product (asked for: 250-320 and 100-140 words). */
export const TRANSITION_LETTER_MIN_WORDS = 150;
export const LINKEDIN_ABOUT_MIN_WORDS = 60;

export type BoostProject = { index?: number; clientLabel?: string; relevance?: number; bullets: string[]; keywordsCovered: string[] };
export type BoostReply = {
  roleTitle?: string;
  scopeStatement?: string;
  projects: BoostProject[];
  transitionParagraph?: string;
  gapHandling?: string;
  transitionCoverLetter?: string;
  linkedinAbout?: string;
};

/**
 * A reply as a deliverable, or why it is not one. The banned phrasings are
 * removed and the posting keywords checked here, so "usable" means usable
 * after the server's own enforcement.
 */
export function readBoostReply(
  content: unknown,
  opts: { transitionPro: boolean; posting?: string | null },
): { ok: true; out: BoostReply } | { ok: false; reason: string } {
  if (typeof content !== "string" || !content.trim()) return { ok: false, reason: "empty reply" };
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, reason: "no JSON in the reply" };
    try { raw = JSON.parse(m[0]); } catch { return { ok: false, reason: "truncated or broken JSON" }; }
  }
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not an object" };
  const out = raw as BoostReply & Record<string, unknown>;
  if (!Array.isArray(out.projects) || out.projects.length === 0) return { ok: false, reason: "no projects" };
  const postingNorm = (opts.posting ?? "").toLowerCase();
  const projects: BoostProject[] = [];
  for (const p of out.projects as unknown[]) {
    if (!p || typeof p !== "object") continue;
    const proj = p as Record<string, unknown>;
    const bullets = (Array.isArray(proj.bullets) ? proj.bullets : [])
      .filter((b): b is string => typeof b === "string" && b.trim().length > 0 && !BANNED_PHRASES.some((re) => re.test(b)));
    if (bullets.length === 0) continue;
    const keywordsCovered = postingNorm
      ? (Array.isArray(proj.keywordsCovered) ? proj.keywordsCovered : [])
        .filter((k): k is string => typeof k === "string" && postingNorm.includes(k.toLowerCase()))
      : [];
    projects.push({ ...(proj as BoostProject), bullets, keywordsCovered });
  }
  if (projects.length === 0) return { ok: false, reason: "no project kept a bullet" };
  if (opts.transitionPro) {
    if (words(out.transitionCoverLetter) < TRANSITION_LETTER_MIN_WORDS) return { ok: false, reason: "the Transition Pro cover letter is missing or cut short" };
    if (words(out.linkedinAbout) < LINKEDIN_ABOUT_MIN_WORDS) return { ok: false, reason: "the Transition Pro LinkedIn About is missing or cut short" };
  }
  return { ok: true, out: { ...out, projects } };
}
