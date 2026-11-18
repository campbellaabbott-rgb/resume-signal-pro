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
 * The bug round of 2026-11-08 adds: a right-to-left line read in the order
 * it is written (S14X-044), a lone control-character item read as the space
 * it stands for (S14X-123), CJK radical forms read as the ideographs they are
 * (S14X-146), the link line (S14X-147) and the per-page scanned verdict
 * (S14X-282).
 *
 * Plain TypeScript with no imports, so the Node test suite runs it against
 * real pdf.js output.
 */
export type PdfTextItem = { str?: string; transform?: number[]; hasEOL?: boolean; height?: number; width?: number; dir?: string };

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

/**
 * LETTER-SPACED TEXT IS ONE WORD A LETTER APART (S12-027). A heading styled
 * with letter-spacing (CSS tracking, every Chrome-printed résumé template that
 * spaces its section titles) reaches pdf.js with a gap after every glyph, and
 * pdf.js writes the gap as a space: "W O R K" " " "E X P E R I E N C E". The
 * scanner's section reader saw one section and filed Experience, Education and
 * Skills as empty. Within one item, a run of three or more single letters each
 * followed by one space is the word they spell; a wider gap stays a word gap.
 */
const TRACKED_RUN = /^(?:\p{L}\p{M}* ){2,}\p{L}\p{M}*$/u;
export function untrack(str: string): string {
  if (!str.includes(" ")) return str;
  return str.split(/( {2,})/).map((part) => (TRACKED_RUN.test(part) ? part.replace(/ /g, "") : part)).join("");
}

/**
 * S14X-123: AN ITEM THAT IS ONE CONTROL CHARACTER IS A SPACE. Chrome on macOS
 * prints the space of a Korean or Japanese line as its own glyph that pdf.js
 * can only name U+0001, so every word gap was a control byte and the upload
 * was refused as a broken font. A lone C0 control (tab, line feed and
 * carriage return aside) in an item of its own is read as the space it
 * stands in for.
 */
// eslint-disable-next-line no-control-regex -- the lone control an item can be
const LONE_CONTROL = /^[\x01-\x08\x0B\x0C\x0E-\x1F]$/;

/**
 * S14X-044: RIGHT-TO-LEFT LINES. pdf.js gives each Hebrew or Arabic run's
 * text in reading order but the line's items in the order Chrome drew them,
 * left to right, so a Hebrew sentence with a number came out in pieces
 * reversed: ".25%אנשים … ב- 10 הובלתי צוות של". On a page whose letters are
 * mostly right-to-left (or a line where they are), a line holding a
 * right-to-left run or no letters at all is read right to left: its items in
 * descending x, each stretch holding Latin letters (an email, "SQL, Figma")
 * kept as one left-to-right unit, a number on its own, and a sentence mark a
 * number carried at its left (".25%") moved after it. Pages with no
 * right-to-left letters are joined exactly as before.
 */
const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/;
const RTL_LETTERS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/g;
const countRtl = (s: string) => (s.match(RTL_LETTERS) ?? []).length;
const countLetters = (s: string) => (s.match(/\p{L}/gu) ?? []).length;

type Piece = { it: PdfTextItem; str: string; sep: string };
type Unit = { str: string; left: number; right: number; h: number; space: boolean };

const touching = (gap: number, h: number) => h > 0 && gap <= h * TOUCH_SHARE && gap >= -h * 0.5;
/** A sentence mark Chrome drew at a number's left belongs after it: ".25%" is "25%.". */
const markAfter = (s: string) => s.replace(/^([.,:;!?]+)(.+)$/su, "$2$1");

function rtlLine(pieces: Piece[]): string | null {
  const placed: Array<Unit & { kind: "R" | "L" | "W" | "S" }> = [];
  for (const p of pieces) {
    if (p.str === "") continue;
    const x = xOf(p.it);
    if (x === null) return null;
    const r = countRtl(p.str);
    const l = countLetters(p.str) - r;
    const kind = p.str.trim() === "" ? "S" : r > 0 && r >= l ? "R" : l > 0 ? "L" : "W";
    const h = typeof p.it.height === "number" && p.it.height > 0 ? p.it.height : 0;
    placed.push({ str: p.str, left: x, right: endOf(p.it) ?? x, h, space: kind === "S", kind });
  }
  placed.sort((a, b) => b.left - a.left);
  const units: Unit[] = [];
  let run: typeof placed = [];
  const flush = () => {
    if (run.some((u) => u.kind === "L")) {
      // One left-to-right unit, its edge spaces kept as spaces.
      let a = 0;
      let b = run.length;
      while (a < b && run[a].kind === "S") units.push(run[a++]);
      const tail: Unit[] = [];
      while (b > a && run[b - 1].kind === "S") tail.unshift(run[--b]);
      const core = run.slice(a, b).reverse();
      let str = "";
      core.forEach((u, i) => {
        const prev = core[i - 1];
        if (prev && !u.space && !prev.space && !touching(u.left - prev.right, Math.max(u.h, prev.h))) str += " ";
        str += u.str;
      });
      units.push({ str: markAfter(str), left: core[0].left, right: Math.max(...core.map((u) => u.right)), h: Math.max(...core.map((u) => u.h)), space: false }, ...tail);
    } else {
      for (const u of run) units.push(u.kind === "W" ? { ...u, str: markAfter(u.str) } : u);
    }
    run = [];
  };
  for (const u of placed) {
    if (u.kind === "R") { flush(); units.push(u); } else run.push(u);
  }
  flush();
  let out = "";
  units.forEach((u, i) => {
    const prev = units[i - 1];
    if (prev && !u.space && !prev.space && !touching(prev.left - u.right, Math.max(u.h, prev.h))) out += " ";
    out += u.str;
  });
  return out;
}

/**
 * S14X-146: CJK RADICAL FORMS ARE THE IDEOGRAPHS THEY STAND FOR. A Chinese
 * PDF from macOS names some glyphs by their CJK Radicals Supplement form
 * (U+2E80-U+2EF3), which NFKC leaves alone, so 增长 read as 增⻓ and a
 * keyword search for it failed. Each radical with a single unified
 * equivalent (Unicode's EquivalentUnifiedIdeograph.txt) is read as that
 * ideograph. The Kangxi radicals are folded by NFKC already.
 */
const RADICAL_PAIRS = "⺁厂⺂乛⺃乚⺄乙⺅亻⺆冂⺇𠘨⺈刀⺉刂⺊卜⺋㔾⺌小⺍小⺎兀⺏尣⺐尢⺑𡯂⺒巳⺓幺⺔彑⺕𫜹⺖忄⺗心⺘扌⺙攵⺛旡⺜日⺝月⺞歺⺟母⺠民⺡氵⺢氺⺣灬⺤爫⺥爫⺦丬⺧牛⺨犭⺩王⺪𤴔⺫目⺬示⺭礻⺮𥫗⺯糹⺰纟⺱罓⺲罒⺳㓁⺴冗⺵𦉫⺶羊⺷𦍌⺸𦍋⺹耂⺺肀⺻聿⺼肉⺽𦥑⺾艹⺿艹⻀艹⻁虎⻂衤⻃覀⻄西⻅见⻆角⻇𧢲⻈讠⻉贝⻊𧾷⻋车⻌辶⻍辶⻎辶⻏邑⻐钅⻑長⻒镸⻓长⻔门⻕𨸏⻖阝⻗雨⻘青⻙韦⻚页⻛风⻜飞⻝食⻞𩙿⻟飠⻠饣⻡𩠐⻢马⻣骨⻤鬼⻥鱼⻦鸟⻧卤⻨麦⻩黄⻪黾⻫斉⻬齐⻭歯⻮齿⻯竜⻰龙⻱龜⻲亀⻳龟";
const RADICALS = new Map<string, string>();
{
  const cps = [...RADICAL_PAIRS];
  for (let i = 0; i + 1 < cps.length; i += 2) RADICALS.set(cps[i], cps[i + 1]);
}
const RADICAL = /[\u2E80-\u2EFF]/g;
export const unifiedRadicals = (text: string) => text.replace(RADICAL, (c) => RADICALS.get(c) ?? c);

export function pageTextFromItems(items: PdfTextItem[]): string {
  const pieces: Piece[] = [];
  let prevY: number | null = null;
  let prevHeight = 0;
  let prevEnd: number | null = null;
  let pendingSeparator = "";
  for (const it of items) {
    const raw = it.str ?? "";
    const str = LONE_CONTROL.test(raw) ? " " : untrack(raw);
    const y = yOf(it);
    let separator = pendingSeparator;
    if (separator) {
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
    }
    pieces.push({ it, str, sep: separator });
    pendingSeparator = it.hasEOL ? "\n" : " ";
    const end = endOf(it);
    if (end !== null && str !== "") prevEnd = end;
    if (y !== null && str.trim() !== "") {
      prevY = y;
      prevHeight = typeof it.height === "number" && it.height > 0 ? it.height : prevHeight;
    }
  }
  const all = pieces.map((p) => p.str).join("");
  const rtl = countRtl(all);
  let out = "";
  if (rtl === 0) {
    for (const p of pieces) out += p.sep + p.str;
  } else {
    const rtlPage = rtl * 2 >= countLetters(all);
    const lines: Piece[][] = [];
    for (const p of pieces) {
      if (lines.length === 0 || p.sep === "\n") lines.push([p]);
      else lines[lines.length - 1].push(p);
    }
    for (const line of lines) {
      const text = line.map((p) => p.str).join("");
      const r = countRtl(text);
      const l = countLetters(text) - r;
      const ordered = r > l || (rtlPage && (r > 0 || l === 0)) ? rtlLine(line) : null;
      out += ordered === null ? line.map((p) => p.sep + p.str).join("") : line[0].sep + ordered;
    }
  }
  return unifiedRadicals(out.normalize("NFKC"))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Arabic letters' share of all letters: pdf.js breaks Arabic ligatures, so past 30% the visitor is told (S14X-044). */
export function arabicShare(text: string): number {
  const letters = countLetters(text);
  return letters === 0 ? 0 : (text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/g) ?? []).length / letters;
}

/**
 * S14X-123, inside items: when every control character in the text is the
 * same one and the text is mostly Hangul, Kana or Han, a control between two
 * letters is a word gap. Any other mix is left for looksGarbled, so a broken
 * font is still refused.
 */
// eslint-disable-next-line no-control-regex -- the bytes this function exists to judge
const CONTROLS = /[\x01-\x08\x0B\x0C\x0E-\x1F]/g;
const CJK = /[\u1100-\u11FF\u3040-\u30FF\u3130-\u318F\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/g;

export function cjkControlsAsSpaces(text: string): { text: string; spaced: number } {
  const controls = text.match(CONTROLS) ?? [];
  const only = controls[0];
  if (only === undefined || controls.some((c) => c !== only)) return { text, spaced: 0 };
  const letters = countLetters(text);
  if (letters === 0 || (text.match(CJK) ?? []).length / letters < 0.5) return { text, spaced: 0 };
  const hex = only.charCodeAt(0).toString(16).padStart(2, "0");
  let spaced = 0;
  const out = text.replace(new RegExp(`(?<=\\p{L})\\x${hex}(?=\\p{L})`, "gu"), () => { spaced++; return " "; });
  return { text: out, spaced };
}

/**
 * S14X-282: A RÉSUMÉ FOLLOWED BY IMAGE PAGES. The scanned-PDF test wanted 200
 * characters for every page, so a one-page résumé followed by scanned
 * certificates was refused as "a scanned image". It is refused only when no
 * page carries a résumé's worth of text; pages with next to nothing on them
 * are counted so the visitor can be told they were skipped.
 */
export const MIN_PAGE_CHARS = 200;
export const IMAGE_PAGE_CHARS = 20;
export function scannedVerdict(pageLengths: number[]): { refuse: boolean; imagePages: number } {
  if (Math.max(0, ...pageLengths) < MIN_PAGE_CHARS) return { refuse: true, imagePages: 0 };
  return { refuse: false, imagePages: pageLengths.filter((n) => n < IMAGE_PAGE_CHARS).length };
}

/**
 * S14X-147: one trailing line, "Links: a | b", of the link targets (pdf.js
 * Link annotations) the text does not already show: mailto, http and https
 * only, mailto: dropped, each address once, at most ten and 1,000
 * characters. The same rule as parse-docx's docx-text.ts.
 */
export function linksLine(urls: string[], text: string): string {
  const shown = text.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  let length = 7;
  for (const u of urls.map((x) => x.trim())) {
    let item = "";
    if (/^mailto:/i.test(u)) {
      try { item = decodeURIComponent(u.slice(7).split("?")[0]).trim(); } catch { item = ""; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item)) continue;
    } else if (/^https?:\/\/[^\s]+$/i.test(u)) item = u;
    else continue;
    const key = item.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
    if (!key || item.length > 200 || seen.has(key) || shown.includes(key)) continue;
    if (out.length >= 10 || length + item.length + 3 > 1000) break;
    seen.add(key);
    out.push(item);
    length += item.length + 3;
  }
  return out.length ? `Links: ${out.join(" | ")}` : "";
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
