/**
 * THE ONE READER FOR THE JOB BOARD CATALOG.
 *
 * WHY THIS EXISTS. sources.ts used to hold ~44.5k entries as `s("Name",
 * "vendor", "token")` call lines, and every catalog guard read the catalog by
 * running its own regex over the file text. On 2026-09-06 the catalog was
 * repacked to get the edge function back under the ~4.5MB deploy cap (a bundle
 * over the cap deploys "successfully" and keeps serving the OLD version).
 * 44,081 of those lines became 406 packed string literals expanded at load.
 *
 * The regexes did not start failing. They started seeing 465 boards out of
 * 44,544 and reporting "no duplicates" and "no demo tenants" about the 1% they
 * could still parse. A blind guard over this catalog is precisely how a demo
 * board, a duplicated feed, or a junk employer name ships. Four guards went
 * blind at once because four guards each had their own matcher.
 *
 * So: one reader, shared. If it breaks, it breaks loudly and everything that
 * depends on it goes red together -- instead of four files quietly agreeing
 * that a 465-board catalog looks fine.
 *
 * WHAT IT PARSES. All three entry forms that can appear in JOB_SOURCES, merged
 * in FILE ORDER, because the refresh cursor is positional and a reordered
 * catalog is a re-crawled catalog:
 *
 *   1. packed  ...u("Name<VT>0<VT>token<LF>Name2<VT>4<VT>token2")
 *              records split on U+000A, fields split on U+000B, the middle
 *              field a numeric INDEX into the `V` vendor array.
 *   2. object  { name: "X", source: "workday", token: "y", pages: 51 }
 *              the 462 entries carrying a page budget or an agency flag.
 *   3. legacy  s("X", "workday", "y")
 *              zero of these survive today; parsed anyway so a hand-added
 *              entry in the old form is never invisible.
 *
 * The vendor vocabulary is resolved FROM sources.ts -- both the `JobSourceKind`
 * union and the `V` packing order -- never from a list copied into this file.
 * The order of V is data: an entry appended to it must not silently shift every
 * vendor in the catalog, and a V that drifts from the JobSourceKind union
 * throws here rather than mislabelling 44k boards.
 *
 * HOUSE RULE (this repo has been bitten by it seven times): assert CODE against
 * `CODE_SOURCE`, which has comments blanked out, and PROSE against `RAW_SOURCE`.
 * That rule is not theoretical here. Today the only two occurrences of the text
 * `s("` in the whole of sources.ts sit inside comments describing the old
 * format. A guard matching it against raw text finds two "entries" and concludes
 * the catalog parser still works.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const SOURCES_PATH = resolve(
  __dirname,
  "../../../supabase/functions/job-board/sources.ts",
);

/** Record separator inside a packed literal: U+000A, written there as an escape. */
const RECORD_SEP = "\n";
/** Field separator inside a packed record: U+000B, written there as an escape. */
const FIELD_SEP = "\u000B";

/**
 * A parse that returns a short list is worse than a parse that dies: a short
 * list re-creates, in one place, the exact blindness this file exists to end.
 * The floor sits far below the real size (44,544) so ordinary catalog growth or
 * pruning never trips it and only a broken parse does.
 */
export const MIN_EXPECTED_BOARDS = 20_000;

export interface CatalogEntry {
  name: string;
  source: string;
  token: string;
  /** Per-tenant page budget; object-literal entries only. */
  pages?: number;
  /** Staffing-agency disclosure flag; object-literal entries only. */
  agency?: boolean;
  /** Which syntax this entry was written in -- for guard failure messages. */
  form: "packed" | "object" | "legacy";
  /** Position in JOB_SOURCES. The refresh cursor is positional. */
  index: number;
}

/**
 * Blank out `//` and block comments, preserving every byte offset and newline
 * so positions and line numbers still line up with the raw file. String and
 * template literals are consumed first, so a `//` inside a token never eats the
 * rest of the line.
 */
export function stripTsComments(src: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out.push(c);
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          out.push(src[i], src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out.push(src[i]);
        const closed = src[i] === quote;
        i++;
        if (closed) break;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      const stop = nl === -1 ? src.length : nl;
      out.push(" ".repeat(stop - i));
      i = stop;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      const stop = close === -1 ? src.length : close + 2;
      // Keep newlines so line numbers survive; blank everything else.
      out.push(src.slice(i, stop).replace(/[^\n]/g, " "));
      i = stop;
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join("");
}

export const RAW_SOURCE: string = readFileSync(SOURCES_PATH, "utf8");
/** Comment-stripped view of sources.ts. Assert CODE against this one. */
export const CODE_SOURCE: string = stripTsComments(RAW_SOURCE);

const fail = (message: string): never => {
  throw new Error(`[catalog helper] ${message}\n  source: ${SOURCES_PATH}`);
};

const SIMPLE_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  v: "\v",
  b: "\b",
  f: "\f",
};

/**
 * Decode a JS/TS string literal body the way the runtime would.
 *
 * This is the part that has to be exactly right. The packed literals hold their
 * separators as ESCAPES inside TypeScript source, not as raw control
 * characters, and real catalog data leans on that: one employer is written
 * `Rudy's \"Country Store\" & Bar-B-Q` (escaped quotes inside a name), and
 * several UKG names carry trailing `\t`s. Decoding must preserve both -- the
 * escaped quotes so the name is not truncated, the tabs because a tab-padded
 * employer name is junk a name guard is supposed to SEE. Nothing is trimmed or
 * normalised here; this returns what the deployed function builds.
 *
 * It also has to get `\\n` right: that is a backslash followed by 'n', not a
 * record separator. Counting raw two-character `\n` sequences instead of
 * decoding overcounts the catalog.
 */
function decodeStringBody(body: string): string {
  let out = "";
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c !== "\\") {
      out += c;
      i++;
      continue;
    }
    const esc = body[i + 1];
    i += 2;
    if (esc === undefined) fail("string literal ends in a lone backslash");
    if (esc === "u") {
      if (body[i] === "{") {
        const close = body.indexOf("}", i);
        if (close === -1) fail("unterminated \\u{...} escape");
        const cp = Number.parseInt(body.slice(i + 1, close), 16);
        if (!Number.isFinite(cp)) fail(`bad \\u{...} escape near ${body.slice(i, i + 12)}`);
        out += String.fromCodePoint(cp);
        i = close + 1;
        continue;
      }
      const hex = body.slice(i, i + 4);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(`bad \\u escape "\\u${hex}"`);
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 4;
      continue;
    }
    if (esc === "x") {
      const hex = body.slice(i, i + 2);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) fail(`bad \\x escape "\\x${hex}"`);
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 2;
      continue;
    }
    // Line continuation: a backslash before a real newline produces nothing.
    if (esc === "\n") continue;
    if (esc === "\r") {
      if (body[i] === "\n") i++;
      continue;
    }
    if (esc === "0" && !/[0-9]/.test(body[i] ?? "")) {
      out += "\0";
      continue;
    }
    // Covers \\ \" \' \` and every other identity escape.
    out += SIMPLE_ESCAPES[esc] ?? esc;
  }
  return out;
}

/** Read the string literal at `start`; returns its decoded value and the index after the closing quote. */
function readStringLiteral(src: string, start: number): { value: string; end: number } {
  const quote = src[start];
  if (quote !== '"' && quote !== "'" && quote !== "`") {
    fail(
      `expected a string literal at offset ${start}, found ` +
        `${JSON.stringify(src.slice(start, start + 40))}`,
    );
  }
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === quote) {
      return { value: decodeStringBody(src.slice(start + 1, i)), end: i + 1 };
    }
    i++;
  }
  return fail(`unterminated string literal starting at offset ${start}`);
}

const skipSpace = (src: string, i: number): number => {
  let j = i;
  while (j < src.length && /\s/.test(src[j])) j++;
  return j;
};

/** The vendor vocabulary, read from the `JobSourceKind` union in sources.ts. */
function parseVendorKinds(code: string): string[] {
  const m = /export\s+type\s+JobSourceKind\s*=([\s\S]*?);/.exec(code);
  if (!m) fail("could not find the JobSourceKind union -- the catalog's vendor vocabulary");
  const kinds = [...m![1].matchAll(/"([^"]+)"/g)].map((k) => k[1]);
  if (kinds.length === 0) fail("the JobSourceKind union parsed to zero vendors");
  return kinds;
}

/**
 * The packing order, read from `const V` in sources.ts.
 *
 * Resolved from the file rather than copied here on purpose: the packed records
 * store a vendor INDEX, so if V ever gains, loses or reorders an entry, a
 * hardcoded copy would relabel every board from that point on without a single
 * test failing.
 */
function parsePackedVendorOrder(code: string, kinds: string[]): string[] {
  const m = /\bconst\s+V\s*:\s*JobSourceKind\[\]\s*=\s*\[([\s\S]*?)\]/.exec(code);
  if (!m) fail("could not find `const V` -- the packed catalog's vendor index");
  const order = [...m![1].matchAll(/"([^"]+)"/g)].map((v) => v[1]);
  if (order.length === 0) fail("`const V` parsed to zero vendors");
  const unknown = order.filter((v) => !kinds.includes(v));
  if (unknown.length) {
    fail(`\`const V\` names vendors absent from JobSourceKind: ${unknown.join(", ")}`);
  }
  return order;
}

/** Locate the JOB_SOURCES array body, returning the offsets just inside its brackets. */
function findCatalogArray(code: string): { start: number; end: number } {
  const decl = /export\s+const\s+JOB_SOURCES\s*:[^=]*=\s*\[/.exec(code);
  if (!decl) fail("could not find `export const JOB_SOURCES = [`");
  const open = decl!.index + decl![0].length - 1;
  let depth = 1;
  let i = open + 1;
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") {
      i = readStringLiteral(code, i).end;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return { start: open + 1, end: i };
    }
    i++;
  }
  return fail("JOB_SOURCES array is never closed");
}

function readObjectProp(objText: string, prop: string): string | null {
  const m = new RegExp(`\\b${prop}\\s*:\\s*(?=["'\`])`).exec(objText);
  if (!m) return null;
  return readStringLiteral(objText, m.index + m[0].length).value;
}

function parseCatalog(kinds: string[], packedOrder: string[]): CatalogEntry[] {
  const { start, end } = findCatalogArray(CODE_SOURCE);
  const entries: CatalogEntry[] = [];
  const push = (e: Omit<CatalogEntry, "index">) => entries.push({ ...e, index: entries.length });

  let i = start;
  while (i < end) {
    const c = CODE_SOURCE[i];
    if (/\s/.test(c) || c === ",") {
      i++;
      continue;
    }

    // 1. packed:  ...u("record<LF>record<LF>record")
    if (CODE_SOURCE.startsWith("...u(", i)) {
      const litStart = skipSpace(CODE_SOURCE, i + "...u(".length);
      const { value, end: litEnd } = readStringLiteral(CODE_SOURCE, litStart);
      for (const record of value.split(RECORD_SEP)) {
        const fields = record.split(FIELD_SEP);
        if (fields.length !== 3) {
          fail(
            `packed record has ${fields.length} field(s), expected 3 ` +
              `(name, vendor index, token): ${JSON.stringify(record.slice(0, 120))}`,
          );
        }
        const idx = Number(fields[1]);
        if (!Number.isInteger(idx) || idx < 0 || idx >= packedOrder.length) {
          fail(
            `packed record names vendor index ${JSON.stringify(fields[1])}, but V holds ` +
              `${packedOrder.length} vendors: ${JSON.stringify(record.slice(0, 120))}`,
          );
        }
        push({ name: fields[0], source: packedOrder[idx], token: fields[2], form: "packed" });
      }
      i = skipSpace(CODE_SOURCE, litEnd);
      if (CODE_SOURCE[i] !== ")") fail(`expected ')' closing a ...u(...) spread at offset ${i}`);
      i++;
      continue;
    }

    // 2. object:  { name: "X", source: "workday", token: "y", pages: 51, agency: true }
    if (c === "{") {
      let depth = 0;
      let j = i;
      while (j < end) {
        const ch = CODE_SOURCE[j];
        if (ch === '"' || ch === "'" || ch === "`") {
          j = readStringLiteral(CODE_SOURCE, j).end;
          continue;
        }
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        }
        j++;
      }
      const objText = CODE_SOURCE.slice(i, j);
      const name = readObjectProp(objText, "name");
      const source = readObjectProp(objText, "source");
      const token = readObjectProp(objText, "token");
      if (name === null || source === null || token === null) {
        fail(
          `catalog object literal is missing name/source/token: ` +
            `${JSON.stringify(objText.slice(0, 160))}`,
        );
      }
      if (!kinds.includes(source!)) {
        fail(
          `catalog object literal names unknown vendor ${JSON.stringify(source)}: ` +
            `${JSON.stringify(objText.slice(0, 160))}`,
        );
      }
      const pages = /\bpages\s*:\s*(\d+)/.exec(objText);
      const agency = /\bagency\s*:\s*(true|false)\b/.exec(objText);
      push({
        name: name!,
        source: source!,
        token: token!,
        ...(pages ? { pages: Number(pages[1]) } : {}),
        ...(agency ? { agency: agency[1] === "true" } : {}),
        form: "object",
      });
      i = j;
      continue;
    }

    // 3. legacy:  s("X", "workday", "y")
    const legacy = /^s\s*\(\s*(?=["'`])/.exec(CODE_SOURCE.slice(i, i + 8));
    if (legacy && !/[\w$.]/.test(CODE_SOURCE[i - 1] ?? "")) {
      let j = i + legacy[0].length;
      const parts: string[] = [];
      for (let f = 0; f < 3; f++) {
        j = skipSpace(CODE_SOURCE, j);
        const lit = readStringLiteral(CODE_SOURCE, j);
        parts.push(lit.value);
        j = skipSpace(CODE_SOURCE, lit.end);
        if (f < 2) {
          if (CODE_SOURCE[j] !== ",") {
            fail(`legacy s() entry at offset ${i} has fewer than 3 arguments`);
          }
          j++;
        }
      }
      if (CODE_SOURCE[j] !== ")") {
        fail(`legacy s() entry at offset ${i} is not closed after 3 arguments`);
      }
      if (!kinds.includes(parts[1])) {
        fail(
          `legacy s() entry names unknown vendor ${JSON.stringify(parts[1])} ` +
            `for ${JSON.stringify(parts[0])}`,
        );
      }
      push({ name: parts[0], source: parts[1], token: parts[2], form: "legacy" });
      i = j + 1;
      continue;
    }

    // Anything else is an entry form this reader does not know about. Skipping
    // it silently is the failure mode this whole file exists to prevent.
    return fail(
      `unrecognised element in JOB_SOURCES at offset ${i}: ` +
        `${JSON.stringify(CODE_SOURCE.slice(i, i + 120))}. Teach this reader the new entry ` +
        `form -- every catalog guard reads the catalog through it.`,
    );
  }

  if (entries.length < MIN_EXPECTED_BOARDS) {
    const byForm = entries.reduce<Record<string, number>>((acc, e) => {
      acc[e.form] = (acc[e.form] ?? 0) + 1;
      return acc;
    }, {});
    fail(
      `parsed only ${entries.length} boards (${JSON.stringify(byForm)}), fewer than the ` +
        `${MIN_EXPECTED_BOARDS} floor. The catalog holds tens of thousands; a short parse ` +
        `means this reader has gone blind to an entry form, and every guard reading through ` +
        `it is silently passing on a fraction of the catalog. Fix the reader; do not lower ` +
        `the floor.`,
    );
  }
  return entries;
}

export const VENDOR_KINDS: string[] = parseVendorKinds(CODE_SOURCE);
/** The vendor order the packed records index into, read from `const V`. */
export const PACKED_VENDOR_ORDER: string[] = parsePackedVendorOrder(CODE_SOURCE, VENDOR_KINDS);
/** The whole catalog, in file order. Parsed once per test module. */
export const CATALOG: CatalogEntry[] = parseCatalog(VENDOR_KINDS, PACKED_VENDOR_ORDER);
/** `[name, source, token]` tuples -- the shape the existing guards already use. */
export const CATALOG_TUPLES: Array<[string, string, string]> = CATALOG.map(
  (e) => [e.name, e.source, e.token],
);
