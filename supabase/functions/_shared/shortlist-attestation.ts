/**
 * WHAT A SHORTLIST UPLOADER CONFIRMS BEFORE A STRANGER'S RESUME IS SCORED
 * (owner decision D14, 2026-10-12).
 *
 * Any signed-in account could upload other people's resumes for AI scoring,
 * with no stated basis. The uploader now confirms this sentence on the page,
 * the evaluation request carries attested: true, shortlist-evaluate refuses
 * without it, and the confirmation is logged on the candidate's decision
 * history with this exact text. One definition, read by the page and the
 * function, so the logged words are the words shown. No imports.
 */
export const SHORTLIST_ATTESTATION_VERSION = "2026-10-12";

export const SHORTLIST_ATTESTATION_TEXT =
  "I confirm I am allowed to have this person's resume scored by AI for this role (for example, they applied for it), " +
  "that I will give them the notice this role's jurisdiction requires, and that I will not use the score as the only reason for a decision.";
