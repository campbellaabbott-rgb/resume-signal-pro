/**
 * TEXT A FEED ESCAPED, PRINTED AS THE EMPLOYER WROTE IT (audit JL12).
 *
 * decodeNameEntities (company-display) knows the named entities employer
 * names carry (the escaped ampersand, apostrophe, quote marks and dashes) but
 * not numeric ones, and titles arrive with both: an "R&D Engineer – Batteries"
 * whose dash was a decimal character reference kept that reference through
 * cleanJobTitle onto the posting page's h1, its title tag and its JobPosting
 * markup (src/test/posting-entities-are-decoded-everywhere.test.tsx holds the
 * exact string). Titles and department lines go through both decoders here,
 * named first so a double-escaped reference resolves, then the title through
 * cleanJobTitle's doubled-phrase fold. Nothing is ever added: a decoder only
 * turns an escape back into its character.
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
