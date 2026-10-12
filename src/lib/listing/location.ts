/**
 * THE PLACE, AS A HUMAN WOULD SAY IT — moved out of Jobs.tsx so the card, the
 * pane, the company page and the posting page read one function.
 *
 * displayLocation's three rules are unchanged and still bind first (see the
 * note it carried in Jobs.tsx): nothing is invented, meaning survives, and the
 * employer's raw string is never lost. This module adds what the job-listings
 * audit (2026-10-11, JL13) measured going wrong on top of them:
 *
 *   1. A SEPARATOR INSIDE PARENTHESES IS NOT A SEPARATOR. "San Jose (Building
 *      5 - North)" was cut at the dash into "San Jose (Building 5" and
 *      "North)", so a card printed a locality with half a bracket and the
 *      bake handed "San Jose (Building 5" to addressLocality. Segments and
 *      comma parts now split only at parenthesis depth zero.
 *   2. A PLACE SAID TWICE IS SAID ONCE. Feeds that join a city field to a
 *      region field that already carries the city print "Barrington,
 *      Barrington" and "Canada · Canada". An adjacent repeat is dropped (and
 *      the result is marked reduced, so the pane still shows the raw string).
 *   3. NO HALF A BRACKET IS EVER PRINTED. A part whose parentheses still do not
 *      balance (a vendor that truncated the field) loses the unmatched bracket
 *      characters, never the words around them.
 *
 * The posting page goes one step further before it builds structured data:
 * dropUnbalancedParenSegments removes the whole unbalanced part, because a
 * locality property must be a place and half a bracket says the string was
 * cut. The bake's copy of that fix belongs to the SEO group (hand-off).
 */
import { STATE_ALIASES, METRO_ALIASES } from "../../../supabase/functions/_shared/location-terms";

/** Separators between location segments: spaced dashes, pipes, semicolons, spaced slashes. */
const SEGMENT_SEPARATOR = /\s+[–—]\s+|\s+-\s+|\s*[|;]\s*|\s+\/\s+/y;
const COMMA = /,/y;

/** Indexes of the bracket characters in `s` that have a partner, in order. */
function matchedBrackets(s: string): Set<number> {
  const matched = new Set<number>();
  const stack: Array<{ c: string; at: number }> = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "[") stack.push({ c, at: i });
    else if (c === ")" || c === "]") {
      const top = stack[stack.length - 1];
      if (top && (top.c === "(") === (c === ")")) { stack.pop(); matched.add(top.at); matched.add(i); }
    }
  }
  return matched;
}

/**
 * Split `raw` at every match of a sticky `separator` that sits outside
 * parentheses. Only a bracket with a partner opens a group: a vendor that cut
 * the field after "(Electronic City" must not swallow every separator after
 * it into one unclosed group.
 */
export function splitOutsideParens(raw: string, separator: RegExp): string[] {
  const re = new RegExp(separator.source, separator.flags.includes("y") ? separator.flags : `${separator.flags}y`);
  const matched = matchedBrackets(raw);
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if ((c === "(" || c === "[") && matched.has(i)) { depth++; i++; continue; }
    if ((c === ")" || c === "]") && matched.has(i) && depth > 0) { depth--; i++; continue; }
    if (depth === 0) {
      re.lastIndex = i;
      const m = re.exec(raw);
      if (m && m.index === i && m[0].length > 0) {
        out.push(raw.slice(start, i));
        i += m[0].length;
        start = i;
        continue;
      }
    }
    i++;
  }
  out.push(raw.slice(start));
  return out;
}

/** True when every ( and [ in `s` closes, in order. */
export function parensBalanced(s: string): boolean {
  const stack: string[] = [];
  for (const c of s) {
    if (c === "(" || c === "[") stack.push(c);
    else if (c === ")" || c === "]") {
      const open = stack.pop();
      if (!open || (open === "(") !== (c === ")")) return false;
    }
  }
  return stack.length === 0;
}

/** The part with its unmatched brackets removed (and the space they leave tidied). Words are never removed. */
export function withoutUnmatchedBrackets(s: string): string {
  if (parensBalanced(s)) return s;
  const keep = new Array<boolean>(s.length).fill(true);
  const stack: Array<{ c: string; at: number }> = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "[") stack.push({ c, at: i });
    else if (c === ")" || c === "]") {
      const top = stack[stack.length - 1];
      if (top && (top.c === "(") === (c === ")")) stack.pop();
      else keep[i] = false;
    }
  }
  for (const open of stack) keep[open.at] = false;
  return [...s].filter((_, i) => keep[i]).join("").replace(/\(\s*\)|\[\s*\]/g, "").replace(/\s{2,}/g, " ").trim();
}

// ── displayLocation, ported verbatim from Jobs.tsx and then fixed ───────────

const COUNTRY_TEXT_ALIASES: Record<string, readonly string[]> = {
  US: ["usa", "u.s.", "u.s.a", "united states", "america", "remote - us"],
  GB: ["uk", "u.k.", "united kingdom", "england", "scotland", "wales", "britain"],
  CA: ["canada"], AU: ["australia"], NZ: ["new zealand"], IE: ["ireland"],
  IN: ["india"], DE: ["germany", "deutschland"], FR: ["france"],
  NL: ["netherlands", "holland"], ES: ["spain", "españa"], IT: ["italy", "italia"],
  PT: ["portugal"], BR: ["brazil", "brasil"], MX: ["mexico", "méxico"],
  PH: ["philippines"], SG: ["singapore"], ZA: ["south africa"], PL: ["poland"],
  SE: ["sweden"], CH: ["switzerland"], JP: ["japan"], AE: ["uae", "united arab emirates"],
};

const KNOWN_PLACE_ABBREVIATIONS: ReadonlySet<string> = new Set<string>([
  ...Object.keys(STATE_ALIASES),
  ...Object.keys(METRO_ALIASES),
  ...Object.keys(COUNTRY_TEXT_ALIASES).map((c) => c.toLowerCase()),
  ...Object.values(COUNTRY_TEXT_ALIASES).flatMap((a) => [...a]),
]);

const stripEdgePunctuation = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}]+$/u, "");

/** Is this token an identifier rather than a word of a place? (Unchanged from Jobs.tsx.) */
export function isLocationCodeToken(token: string, opensString: boolean): boolean {
  const t = stripEdgePunctuation(token);
  if (!t) return true;
  if (/^\d+$/.test(t)) return t.length >= 4 || t.startsWith("0") || (opensString && t.length >= 2);
  return /\d/.test(t) && /\p{L}/u.test(t);
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The place a listing can honestly name, the raw string it came from, and
 * whether anything was taken out. Same contract as Jobs.tsx's displayLocation,
 * which re-exports this once the board is wired.
 */
export function displayLocation(
  location: string | null | undefined,
): { text: string | null; raw: string | null; reduced: boolean } {
  const raw = String(location ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return { text: null, raw: null, reduced: false };
  let seenToken = false;
  let dropped = false;
  const segments: string[] = [];
  for (const segment of splitOutsideParens(raw, SEGMENT_SEPARATOR)) {
    const parts: string[] = [];
    for (const rawPart of splitOutsideParens(segment, COMMA)) {
      const kept: string[] = [];
      for (const token of rawPart.trim().split(" ")) {
        if (!token) continue;
        const opens = !seenToken;
        seenToken = true;
        // A dash between words can only reach here from inside brackets (the
        // segment split takes every other one), where it is the employer's
        // own punctuation: "(Building 5 - North)" keeps its dash.
        if (/^[–—-]$/.test(token) && kept.length > 0) { kept.push(token); continue; }
        if (isLocationCodeToken(token, opens)) { dropped = true; continue; }
        kept.push(token);
      }
      while (kept.length > 0 && /^[–—-]$/.test(kept[kept.length - 1])) kept.pop();
      if (kept.length === 0) {
        if (rawPart.trim() === "" && segment.includes(",")) dropped = true; // an empty comma part
        continue;
      }
      let part = kept.join(" ");
      const balanced = withoutUnmatchedBrackets(part);
      if (balanced !== part) { dropped = true; part = balanced; }
      if (!/\p{L}|\p{N}/u.test(part)) { dropped = true; continue; }
      // "Barrington, Barrington": the same place twice in a row is said once.
      if (parts.length > 0 && same(parts[parts.length - 1], part)) { dropped = true; continue; }
      parts.push(part);
    }
    if (parts.length === 0) continue;
    const joined = parts.join(", ");
    // "Canada · Canada": the same segment twice in a row is said once.
    if (segments.length > 0 && same(segments[segments.length - 1], joined)) { dropped = true; continue; }
    segments.push(joined);
  }
  let text = segments.join(" · ");
  const acronym = /^([A-Z]{2})\s+(.+)$/.exec(text);
  if (acronym && !KNOWN_PLACE_ABBREVIATIONS.has(acronym[1].toLowerCase())) {
    const rest = acronym[2].split(/[\s,·]+/).filter((w) => /\p{L}{2}/u.test(w));
    if (rest.length >= 2) { text = acronym[2]; dropped = true; }
  }
  if (!/\p{L}{2}/u.test(text)) return { text: null, raw, reduced: true };
  return { text, raw, reduced: dropped };
}

/**
 * The location string with every comma or dash part whose brackets do not
 * balance removed, separators and all — for the posting page's structured
 * data and its visible line, never for the stored row. Null when nothing is
 * left, which the caller reads as "no locality", the same answer the page
 * gives for a location that was only a code.
 */
export function dropUnbalancedParenSegments(location: string | null | undefined): string | null {
  const raw = String(location ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  if (parensBalanced(raw)) return raw;
  const keepSegments: string[] = [];
  for (const segment of splitOutsideParens(raw, SEGMENT_SEPARATOR)) {
    const parts = splitOutsideParens(segment, COMMA).map((p) => p.trim()).filter((p) => p && parensBalanced(p));
    if (parts.length) keepSegments.push(parts.join(", "));
  }
  const out = keepSegments.join(" - ").trim();
  return out || null;
}

// ── the country, named only where the line does not already name it ────────

function containsWord(text: string, word: string): boolean {
  const hay = text.toLowerCase();
  const needle = word.toLowerCase();
  const isLetter = (c: string) => /[a-z]/.test(c);
  let i = hay.indexOf(needle);
  while (i !== -1) {
    const before = i === 0 ? "" : hay[i - 1];
    const after = hay[i + needle.length] ?? "";
    if (!isLetter(before) && !isLetter(after)) return true;
    i = hay.indexOf(needle, i + 1);
  }
  return false;
}

/** A country code's own name in the reader's language, or null for anything that is not a code. */
export function countryLabelOrNull(country: string | null | undefined, lng?: string): string | null {
  if (typeof country !== "string" || !/^[A-Za-z]{2}$/.test(country.trim())) return null;
  const code = country.trim().toUpperCase();
  try {
    return new Intl.DisplayNames(lng ? [lng] : undefined, { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * The country's name when the location text does not already say it (same
 * suppression as Jobs.tsx's countryToName). The alias table only SUPPRESSES a
 * true statement already on screen; it cannot produce a country the row
 * does not carry.
 */
export function countryToName(
  location: string | null | undefined,
  country: string | null | undefined,
  lng?: string,
): string | null {
  const name = countryLabelOrNull(country, lng);
  if (!name) return null;
  const code = String(country).trim().toUpperCase();
  const text = String(location ?? "").toLowerCase();
  if (!text.trim()) return name;
  if (text.includes(name.toLowerCase())) return null;
  // The English name too: a German reader's "Vereinigte Staaten" is not on a line reading "United States".
  const english = countryLabelOrNull(code, "en");
  if (english && text.includes(english.toLowerCase())) return null;
  if (containsWord(text, code)) return null;
  const aliases = Object.prototype.hasOwnProperty.call(COUNTRY_TEXT_ALIASES, code) ? COUNTRY_TEXT_ALIASES[code] : [];
  return aliases.some((a) => text.includes(a)) ? null : name;
}

/** Every place a posting names: its own line, then the folded siblings' places, each tidied and deduplicated. */
export function allListingPlaces(job: { location?: string | null; otherLocations?: string[] | null }): string[] {
  const out: string[] = [];
  for (const raw of [job.location ?? null, ...(job.otherLocations ?? [])]) {
    const text = displayLocation(raw).text;
    if (text && !out.some((o) => same(o, text))) out.push(text);
  }
  return out;
}
