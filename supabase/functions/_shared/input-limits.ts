export const MAX_RESUME_LENGTH = 50_000;
export const MAX_JOB_DESCRIPTION_LENGTH = 20_000;
export function checkInputLimits(fields: { resumeText?: unknown; jobDescription?: unknown }): string | null {
  if (typeof fields.resumeText === "string" && fields.resumeText.length > MAX_RESUME_LENGTH) {
    return `Resume text is too long. Please limit to ${MAX_RESUME_LENGTH.toLocaleString()} characters.`;
  }
  if (typeof fields.jobDescription === "string" && fields.jobDescription.length > MAX_JOB_DESCRIPTION_LENGTH) {
    return `Job description is too long. Please limit to ${MAX_JOB_DESCRIPTION_LENGTH.toLocaleString()} characters.`;
  }
  return null;
}