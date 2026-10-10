/**
 * The posting a visitor wants their résumé scored against, handed from the
 * board (a card, the posting panel, the posting page) to the scanner on "/".
 * Session-only, read once: the scanner removes it as it reads it.
 *
 * One writer and one reader, so the key and the shortest description the
 * scanner accepts are the same number on both sides.
 */
export const JD_HANDOFF_KEY = "rb_jd_handoff";
/** Shorter than this is not a job description the scan can check fit against. */
export const JD_HANDOFF_MIN_CHARS = 80;

export interface JdHandoff {
  jd: string;
  title?: string;
  company?: string;
  applyUrl?: string;
}

/** Can this description be handed over at all? */
export function canHandOff(jd: string | null | undefined): jd is string {
  return typeof jd === "string" && jd.trim().length >= JD_HANDOFF_MIN_CHARS;
}

/** Store the hand-off; false when the description is too short or storage refused it. */
export function writeJdHandoff(h: JdHandoff): boolean {
  if (!canHandOff(h.jd)) return false;
  try {
    sessionStorage.setItem(JD_HANDOFF_KEY, JSON.stringify(h));
    return true;
  } catch {
    return false;
  }
}

/** Read and remove the hand-off; null when there is none or it is unusable. */
export function takeJdHandoff(): JdHandoff | null {
  try {
    const raw = sessionStorage.getItem(JD_HANDOFF_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(JD_HANDOFF_KEY);
    const h = JSON.parse(raw) as Partial<JdHandoff> | null;
    if (!h || !canHandOff(h.jd)) return null;
    return { jd: h.jd, title: h.title, company: h.company, applyUrl: h.applyUrl };
  } catch {
    return null;
  }
}
