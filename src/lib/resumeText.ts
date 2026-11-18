/**
 * Text out of an uploaded résumé, so setup can read it instead of asking.
 *
 * Wraps the same two edge functions the scanner uses. Deliberately returns "" on
 * every failure rather than throwing: this runs as a SIDE EFFECT of uploading a
 * CV, and a parse failure must never turn a successful upload into an error
 * message. The worst case is that we ask a couple of questions we might have
 * been able to skip — which is exactly the state the product was in before.
 */
import { supabase } from "@/integrations/supabase/client";
import { looksGarbled, normalizeIntakeText } from "../../supabase/functions/_shared/text-validation";

/**
 * A .TXT RÉSUMÉ, READ IN THE ENCODING IT WAS SAVED IN (S14X-283, C-S14-133).
 *
 * file.text() reads UTF-8 only. Notepad's "Unicode" and Word's "Unicode
 * Text" save UTF-16 with a byte-order mark, which UTF-8 turned into a NUL
 * between every letter; an older Windows editor saves windows-1252, whose
 * accents became replacement characters. The mark is honoured (FF FE is
 * utf-16le, FE FF utf-16be, EF BB BF is UTF-8 and dropped); bytes that are
 * not valid UTF-8 are windows-1252. The text then gets the same intake
 * cleanup the parsers give theirs (S14X-280), and `garbled` says whether it
 * is still not readable text (a binary file renamed .txt).
 */
export async function readTextFile(file: Blob): Promise<{ text: string; garbled: boolean }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let decoded: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) decoded = new TextDecoder("utf-16le").decode(bytes.subarray(2));
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) decoded = new TextDecoder("utf-16be").decode(bytes.subarray(2));
  else {
    const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
    } catch {
      decoded = new TextDecoder("windows-1252").decode(body);
    }
  }
  const text = normalizeIntakeText(decoded);
  return { text, garbled: looksGarbled(text) };
}

export async function resumeTextFrom(file: File): Promise<string> {
  try {
    if (file.type === "text/plain" || /\.txt$/i.test(file.name)) {
      const { text, garbled } = await readTextFile(file);
      return garbled ? "" : text;
    }
    const fn = file.type === "application/pdf" || /\.pdf$/i.test(file.name)
      ? "parse-pdf"
      : "parse-docx";
    const formData = new FormData();
    formData.append("file", file);
    const { data, error } = await supabase.functions.invoke(fn, { body: formData });
    if (error) return "";
    const text = (data as { success?: boolean; text?: string } | null)?.text;
    return typeof text === "string" ? text : "";
  } catch {
    // Includes the rate-limited case: parse-pdf is on the shared budget, and a
    // 429 here must not surface as a broken upload.
    return "";
  }
}
