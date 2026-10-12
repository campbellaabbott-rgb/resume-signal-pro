/**
 * TEXT A FEED ESCAPED, PRINTED AS THE EMPLOYER WROTE IT (audit JL12).
 *
 * decodeNameEntities (company-display) knows the named entities employer
 * names carry — &amp; &#39; &rsquo; &ndash; — but not numeric ones, and
 * titles arrive with both: "R&amp;D Engineer &#8211; Batteries" kept its
 * "&#8211;" through cleanJobTitle onto the posting page's h1, its title tag
 * and its JobPosting markup. Titles and department lines go through both
 * decoders here (named first, so a double-escaped "&amp;#8211;" resolves),
 * then the title through cleanJobTitle's doubled-phrase fold. Nothing is
 * ever added: a decoder only turns an escape back into its character.
 */
import { cleanJobTitle, decodeNameEntities } from "@/lib/company-display";
import { decodeJdEntities } from "@/components/jobs/posting-page";

/** Named and numeric entities both decoded, whitespace collapsed. */
export function decodeListingText(s: string | null | undefined): string {
  if (typeof s !== "string") return "";
  return decodeJdEntities(decodeNameEntities(s)).replace(/\s+/g, " ").trim();
}

/** A posting title as every listing surface prints it. */
export function listingTitle(s: string | null | undefined): string {
  const decoded = decodeListingText(s);
  return decoded ? cleanJobTitle(decoded) : "";
}
