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

export async function resumeTextFrom(file: File): Promise<string> {
  try {
    if (file.type === "text/plain" || /\.txt$/i.test(file.name)) {
      return await file.text();
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
