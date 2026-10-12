/**
 * THE EMPLOYER'S DESCRIPTION, AS A LISTING SHOWS IT.
 *
 * Decoded (the ingest misses some entities), with exact repeats folded, cut
 * into the employer's own sections where it has them, and with one fact about
 * its length stated rather than hidden:
 *
 * REPEATS (audit JL6). Some feeds hand us the same body twice — Lever's
 * descriptionBodyPlain concatenated with its lists, iCIMS and Pinpoint
 * duplicating whole sections — so a reader scrolled through every paragraph
 * twice. A paragraph (a line of 80 characters or more, compared with its
 * whitespace collapsed) that already appeared verbatim is dropped from the
 * display. Shorter lines are left alone: "Requirements:" and "• Python" repeat
 * legitimately. Nothing is rewritten; the fix at the source is wave 4's.
 *
 * THE CAP. The board stores at most STORED_DESC_CAP characters of a
 * description (supabase/functions/job-board/index.ts slices every write), so a
 * stored text that long may well continue on the employer's site, and the
 * pane says so instead of letting the reader assume the posting ends where
 * our copy does. A mirror of a constant in another runtime goes false in
 * silence, so a test reads the edge file and fails when the two disagree.
 */
import { decodeJdEntities } from "@/components/jobs/posting-page";

/** Mirrors STORED_DESC_CAP in supabase/functions/job-board/index.ts (held equal by a test). */
export const STORED_DESC_CAP = 12_000;
/** A line this long that repeats verbatim is a duplicated paragraph, not a repeated heading or bullet. */
export const REPEAT_MIN_CHARS = 80;

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** The text with later verbatim copies of long paragraphs removed, and how many were removed. */
export function collapseRepeatedParagraphs(text: string): { text: string; collapsed: number } {
  const seen = new Set<string>();
  let collapsed = 0;
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const key = norm(line);
    if (key.length >= REPEAT_MIN_CHARS) {
      if (seen.has(key)) { collapsed++; continue; }
      seen.add(key);
    }
    out.push(line);
  }
  // A dropped block leaves its blank-line padding behind; three or more newlines become two.
  return { text: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), collapsed };
}

/** Our stored copy may stop short of the employer's own posting. */
export function descriptionMayContinue(raw: string | null | undefined): boolean {
  return typeof raw === "string" && raw.length >= STORED_DESC_CAP;
}

/**
 * Lines that open a section. Conservative: a short standalone line matching a
 * known heading (EN plus the highest-frequency DE/FR/ES ones on the board).
 * Ported unchanged from Jobs.tsx's pane.
 */
export const JD_HEADING = /^\s*(what you(?:'|’)ll (?:do|be doing)|responsibilities|your (?:role|mission|profile|tasks)|the role|role overview|requirements|qualifications|what (?:you(?:'|’)ll|we(?:'|’)re looking for|you bring|we offer|we expect)|about (?:you|us|the role|the team|the job)|who you are|nice to have(?:s)?|bonus points|benefits|perks|compensation|why (?:join|you(?:'|’)ll love it)|skills(?: (?:&|and) experience)?|duties|deine aufgaben|dein profil|wir bieten|vos missions|votre profil|tus funciones|requisitos|beneficios|ofrecemos)\s*:?\s*$/i;

export interface PreparedDescription {
  /** Decoded, repeats folded. */
  text: string;
  collapsed: number;
  /** The employer's own sections, when it has at least two recognisable headings; null otherwise. */
  sections: Array<{ title: string | null; text: string }> | null;
  mayContinue: boolean;
}

export function prepareDescription(raw: string): PreparedDescription {
  const { text, collapsed } = collapseRepeatedParagraphs(decodeJdEntities(raw));
  const sections: Array<{ title: string | null; body: string[] }> = [{ title: null, body: [] }];
  for (const line of text.split("\n")) {
    if (line.trim().length <= 60 && JD_HEADING.test(line)) sections.push({ title: line.trim().replace(/:\s*$/, ""), body: [] });
    else sections[sections.length - 1].body.push(line);
  }
  const titled = sections.filter((s) => s.title).length;
  return {
    text,
    collapsed,
    sections: titled < 2
      ? null
      : sections
          .map((s) => ({ title: s.title, text: s.body.join("\n").trim() }))
          .filter((s) => s.title !== null || s.text.length > 0),
    mayContinue: descriptionMayContinue(raw),
  };
}
