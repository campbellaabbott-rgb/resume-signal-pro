// Caps on the free-text inputs to the public (verify_jwt=false) LLM endpoints.
// These mirror the limits the gated scanner (analyze-resume) already enforces so
// that a single request can't bill an unbounded number of input tokens. Rate
// limiting caps HOW MANY calls an IP can make; this caps the COST of each call.
// Legit resumes are far under these bounds (the scanner rejects >50k upstream),
// so over-length input is almost always abuse or a malformed request.
export const MAX_RESUME_LENGTH = 50_000;
export const MAX_JOB_DESCRIPTION_LENGTH = 20_000;

// Returns a human-readable error string when an input exceeds its cap, or null
// when everything is within bounds. Callers turn a non-null result into a 400.
// Non-string / absent fields are ignored so callers can pass whatever they have.
export function checkInputLimits(fields: { resumeText?: unknown; jobDescription?: unknown }): string | null {
  if (typeof fields.resumeText === "string" && fields.resumeText.length > MAX_RESUME_LENGTH) {
    return `Resume text is too long. Please limit to ${MAX_RESUME_LENGTH.toLocaleString()} characters.`;
  }
  if (typeof fields.jobDescription === "string" && fields.jobDescription.length > MAX_JOB_DESCRIPTION_LENGTH) {
    return `Job description is too long. Please limit to ${MAX_JOB_DESCRIPTION_LENGTH.toLocaleString()} characters.`;
  }
  return null;
}
