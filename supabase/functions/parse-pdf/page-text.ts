/**
 * ONE PAGE OF PDF.JS TEXT ITEMS, AS LINES.
 *
 * parse-pdf joined every item on a page with a space (register L5-01), so each
 * page reached the scanner as ONE line. The scanner reads résumés line by line
 * (sections, roles, bullets, the timeline, the tone audit), so every PDF upload
 * was scanned as 0 sections, 0 roles and 0 bullets: the sparse-résumé prompt,
 * "too passive", 0-word sections and a score about ten points low, while the
 * same résumé pasted as text got a different report.
 *
 * pdf.js marks the last item of a visual line with `hasEOL`. Some producers
 * omit it, so a change of baseline (transform[5], the item's y) larger than
 * half the line height is read as a new line too. Within a line, items are
 * still joined with a space, exactly as before.
 *
 * Plain TypeScript with no imports, so the Node test suite runs it against
 * real pdf.js output.
 */
export type PdfTextItem = { str?: string; transform?: number[]; hasEOL?: boolean; height?: number };

const yOf = (it: PdfTextItem): number | null =>
  Array.isArray(it.transform) && typeof it.transform[5] === "number" ? it.transform[5] : null;

export function pageTextFromItems(items: PdfTextItem[]): string {
  let out = "";
  let prevY: number | null = null;
  let prevHeight = 0;
  let pendingSeparator = "";
  for (const it of items) {
    const str = it.str ?? "";
    const y = yOf(it);
    if (pendingSeparator) {
      // A new baseline with no end-of-line mark still starts a new line.
      const moved = pendingSeparator === " " && prevY !== null && y !== null && str.trim() !== "" &&
        Math.abs(y - prevY) > Math.max(2, prevHeight * 0.5);
      out += moved ? "\n" : pendingSeparator;
    }
    out += str;
    pendingSeparator = it.hasEOL ? "\n" : " ";
    if (y !== null && str.trim() !== "") {
      prevY = y;
      prevHeight = typeof it.height === "number" && it.height > 0 ? it.height : prevHeight;
    }
  }
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
