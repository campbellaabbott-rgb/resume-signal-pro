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
 * half the line height is read as a new line too.
 *
 * WITHIN A LINE, ITEMS THAT TOUCH ARE ONE WORD (register S11-006). Chrome,
 * Edge and every headless-Chrome résumé builder (Skia) wrap each fi/fl/ff
 * ligature glyph in its own span, and pdf.js ends a text item at each one. A
 * space between every pair of items turned "Certified" into "Certi fi ed" and
 * "fiona.hoffman@gmail.com" into "fi ona.ho ff man@gmail.com", so the contact
 * reader took "man@gmail.com" as the address. An item that starts where the
 * previous one ended (within 0.15 of the line height) continues the same
 * word; only a real gap is a space. The page text is NFKC-normalized, so a
 * ligature character (U+FB01) reads as the two letters it stands for.
 *
 * Plain TypeScript with no imports, so the Node test suite runs it against
 * real pdf.js output.
 */
export type PdfTextItem = { str?: string; transform?: number[]; hasEOL?: boolean; height?: number; width?: number };

const yOf = (it: PdfTextItem): number | null =>
  Array.isArray(it.transform) && typeof it.transform[5] === "number" ? it.transform[5] : null;
const xOf = (it: PdfTextItem): number | null =>
  Array.isArray(it.transform) && typeof it.transform[4] === "number" ? it.transform[4] : null;
const endOf = (it: PdfTextItem): number | null => {
  const x = xOf(it);
  return x !== null && typeof it.width === "number" && Number.isFinite(it.width) ? x + it.width : null;
};

/** How close (as a share of the line height) the next item must start to continue the same word. */
export const TOUCH_SHARE = 0.15;

export function pageTextFromItems(items: PdfTextItem[]): string {
  let out = "";
  let prevY: number | null = null;
  let prevHeight = 0;
  let prevEnd: number | null = null;
  let pendingSeparator = "";
  for (const it of items) {
    const str = it.str ?? "";
    const y = yOf(it);
    if (pendingSeparator) {
      let separator = pendingSeparator;
      if (separator === " " && str !== "" && str.trim() === "") {
        // A space item is itself the space.
        separator = "";
      } else if (separator === " " && prevY !== null && y !== null && str.trim() !== "") {
        // A new baseline with no end-of-line mark still starts a new line.
        if (Math.abs(y - prevY) > Math.max(2, prevHeight * 0.5)) {
          separator = "\n";
        } else {
          // Same baseline: touching items are one word, a real gap is a space.
          const x = xOf(it);
          const h = typeof it.height === "number" && it.height > 0 ? it.height : prevHeight;
          if (x !== null && prevEnd !== null && h > 0) {
            const gap = x - prevEnd;
            if (gap <= h * TOUCH_SHARE && gap >= -h * 0.5) separator = "";
          }
        }
      }
      out += separator;
    }
    out += str;
    pendingSeparator = it.hasEOL ? "\n" : " ";
    const end = endOf(it);
    if (end !== null && str !== "") prevEnd = end;
    if (y !== null && str.trim() !== "") {
      prevY = y;
      prevHeight = typeof it.height === "number" && it.height > 0 ? it.height : prevHeight;
    }
  }
  return out
    .normalize("NFKC")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * GLYPHS PDF.JS COULD ONLY NAME AS U+0000 (register S11-035).
 *
 * Chrome (Skia) gives a Devanagari or Bengali conjunct or matra glyph no
 * ToUnicode entry and describes it only in /ActualText, which pdf.js does not
 * read, so each such glyph reaches us as U+0000. looksGarbled counts those as
 * control bytes and refused the upload as "corrupted, re-export it", and
 * re-exporting from the same browser yields the same file.
 *
 * When EVERY control character in the text is U+0000 and the text is
 * substantially in an Indic script, the NULs are this known gap rather than
 * corruption: they are removed, and the count is returned so the caller can
 * tell the visitor that a .docx or pasted text reads those characters
 * exactly. Any other control byte, or NULs in other text, is left for
 * looksGarbled to judge as before.
 */
// Devanagari through Sinhala: Hindi, Marathi, Nepali, Bengali, Assamese,
// Punjabi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam, Sinhala.
const INDIC = /[ऀ-෿]/g;
// eslint-disable-next-line no-control-regex -- the bytes this function exists to judge
const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;
// eslint-disable-next-line no-control-regex -- U+0000 is the glyph pdf.js could not name
const NUL = /\x00/g;

export function dropUnnamedIndicGlyphs(text: string): { text: string; dropped: number } {
  const controls = text.match(CONTROL) ?? [];
  if (controls.length === 0) return { text, dropped: 0 };
  if (controls.some((c) => c !== "\u0000")) return { text, dropped: 0 };
  const letters = (text.match(/\p{L}|\p{M}/gu) ?? []).length;
  const indic = (text.match(INDIC) ?? []).length;
  if (letters === 0 || indic / letters < 0.3) return { text, dropped: 0 };
  return { text: text.replace(NUL, ""), dropped: controls.length };
}

/**
 * MULTI-COLUMN RISK (register S11-036).
 *
 * pdf.js, like most ATS text extractors, reads text in content-stream order,
 * not visual order. Two layouts break that order:
 *
 *  1. STACKED COLUMNS: one column is written top to bottom, then the text
 *     jumps back up for the next. The old test wanted TWO upward jumps per
 *     page, so the ordinary sidebar-then-main résumé (one jump) passed as
 *     "no multi-column layout". A page now counts when a dense block of at
 *     least four lines is followed by an upward jump to a block whose left
 *     edge sits at least 15% of the page width away: two columns side by
 *     side. A header written last (same left edge) or a few right-floated
 *     dates written first (sparse, not a column) do not count.
 *  2. INTERLEAVED ROWS: a table-like layout writes both columns on each
 *     baseline, so lines read "Python   Software Engineer, Globex". A page
 *     counts when at least four baselines carry a second run of text after a
 *     gutter, starting at the same x, and those runs are wide (median at
 *     least 15% of the page width). Right-aligned dates start at different x
 *     and are narrow, so they do not count.
 *
 * The old two-jumps rule still counts as well.
 */
export type PageBox = { width: number; height: number };
const LETTER: PageBox = { width: 612, height: 792 };

type Placed = { x: number; y: number; end: number; h: number };

function placedItems(items: PdfTextItem[]): Placed[] {
  const out: Placed[] = [];
  for (const it of items) {
    const x = xOf(it);
    const y = yOf(it);
    if (x === null || y === null || !(it.str ?? "").trim()) continue;
    const end = endOf(it) ?? x;
    const h = typeof it.height === "number" && it.height > 0 ? it.height : 10;
    out.push({ x, y, end, h });
  }
  return out;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Distinct baselines of a block, top to bottom. */
function baselinesOf(block: Placed[]): number[] {
  const ys: number[] = [];
  for (const p of block) if (!ys.some((y) => Math.abs(y - p.y) <= 2)) ys.push(p.y);
  return ys.sort((a, b) => b - a);
}

function stackedColumns(placed: Placed[], page: PageBox): boolean {
  const Y_JUMP = 15;
  // Split the page into blocks at every upward jump.
  const blocks: Placed[][] = [];
  let current: Placed[] = [];
  let lastY: number | null = null;
  let upwardJumps = 0;
  for (const p of placed) {
    if (lastY !== null && p.y - lastY > Y_JUMP) {
      upwardJumps++;
      blocks.push(current);
      current = [];
    }
    current.push(p);
    lastY = p.y;
  }
  if (current.length) blocks.push(current);
  if (upwardJumps >= 2) return true;

  for (let i = 0; i + 1 < blocks.length; i++) {
    const a = blocks[i];
    const b = blocks[i + 1];
    const lines = baselinesOf(a);
    if (lines.length < 4) continue;
    const steps = lines.slice(1).map((y, k) => lines[k] - y);
    const lineHeight = median(a.map((p) => p.h));
    if (median(steps) > lineHeight * 3) continue; // sparse: not a column
    const leftA = Math.min(...a.map((p) => p.x));
    const leftB = Math.min(...b.map((p) => p.x));
    if (Math.abs(leftA - leftB) >= page.width * 0.15) return true;
  }
  return false;
}

function interleavedRows(placed: Placed[], page: PageBox): boolean {
  const rows: Placed[][] = [];
  for (const p of placed) {
    const row = rows.find((r) => Math.abs(r[0].y - p.y) <= 2);
    if (row) row.push(p);
    else rows.push([p]);
  }
  const runs: { start: number; width: number }[] = [];
  for (const row of rows) {
    const sorted = [...row].sort((a, b) => a.x - b.x);
    for (let k = 1; k < sorted.length; k++) {
      const prevEnd = Math.max(...sorted.slice(0, k).map((p) => p.end));
      const gutter = Math.max(sorted[k].h * 2, page.width * 0.04);
      if (sorted[k].x - prevEnd > gutter) {
        const end = Math.max(...sorted.slice(k).map((p) => p.end));
        runs.push({ start: sorted[k].x, width: end - sorted[k].x });
        break;
      }
    }
  }
  for (const r of runs) {
    const same = runs.filter((o) => Math.abs(o.start - r.start) <= 3);
    if (same.length >= 4 && median(same.map((o) => o.width)) >= page.width * 0.15) return true;
  }
  return false;
}

export function detectMultiColumnRisk(items: PdfTextItem[], page: PageBox = LETTER): boolean {
  const box = page.width > 0 && page.height > 0 ? page : LETTER;
  const placed = placedItems(items);
  return stackedColumns(placed, box) || interleavedRows(placed, box);
}
