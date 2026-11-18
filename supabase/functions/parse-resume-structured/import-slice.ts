/**
 * HOW MUCH OF A RÉSUMÉ THE BUILDER'S IMPORT READS, AND WHERE IT STOPS
 * (S14X-071: C-S14-042).
 *
 * The model is shown at most IMPORT_MAX_CHARS characters (the cap is a cost
 * decision and is unchanged). It used to be resumeText.slice(0, 20000): the
 * cut fell wherever character 20,000 did, often mid-word, and the answer
 * said nothing, so the builder could not tell the person the rest was left
 * out. Now the cut falls at the last line break at or below the cap (when
 * one sits in the second half of it), else at the last space, else at the
 * cap, and never between the two halves of a surrogate pair; the answer
 * carries resumeTruncated, importedChars and totalChars.
 *
 * Import-free, so the Deno function and the Node tests both load it.
 */
export const IMPORT_MAX_CHARS = 20000;

export interface ImportSlice {
  /** What the model is shown: a prefix of the text. */
  text: string;
  /** True when some of the text was left out. */
  truncated: boolean;
  /** text.length, in UTF-16 code units, as String.length counts. */
  importedChars: number;
  /** The whole text's length. */
  totalChars: number;
}

export function importSlice(input: string, max: number = IMPORT_MAX_CHARS): ImportSlice {
  const whole = String(input ?? "");
  if (whole.length <= max) {
    return { text: whole, truncated: false, importedChars: whole.length, totalChars: whole.length };
  }
  let cut = whole.lastIndexOf("\n", max);
  if (cut < max / 2) {
    cut = -1;
    for (let i = max; i > max / 2; i--) {
      if (/\s/.test(whole[i] ?? "")) { cut = i; break; }
    }
    if (cut < 0) cut = max;
  }
  // Never end on the first half of a surrogate pair (an emoji, a CJK
  // extension character): the model would be shown a broken character.
  const code = whole.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  const text = whole.slice(0, cut);
  return { text, truncated: true, importedChars: text.length, totalChars: whole.length };
}
