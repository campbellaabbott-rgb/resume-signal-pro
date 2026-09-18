// The Item 2.05 reader, ported line for line from lane 1's parse205_v2.py
// (the version whose hold-out numbers the spec quotes: numeric precision
// 5/5, recall 5/7, workforce classification 7/10 on ten July-2026 filings
// the parser had never seen). The port is pinned to the Python output on
// the saved 18 + 10 documents by parse205_test.ts; a change to any rule
// here is a new parser_version, and the fill-rate is reported per version,
// never targeted.
//
// What comes out: the whole Item 2.05 section (stored on every SEC row),
// the first workforce sentence as the excerpt, a percentage and/or a
// headcount when a sentence states one, the timing phrase, the decision
// date and the cost the filing names. Where nothing is stated the fields
// are null and the section text still ships — the sentence, not a zero.

export const PARSER_VERSION = "parse205_v2_ts";

export interface Parsed205 {
  section: "direct" | `via_${string}` | null;
  sectionText: string | null;
  sectionChars: number;
  pct: number | null;
  headcount: number | null;
  headcountBasis: "stated" | "derived_from_to" | null;
  timing: string | null;
  cost: string | null;
  decisionDate: string | null;
  excerpt: string | null;
  isWorkforce: boolean;
  sites: string[];
}

// ── HTML → text ────────────────────────────────────────────────────────────

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", bull: "•",
  copy: "©", reg: "®", trade: "™", sect: "§", para: "¶", middot: "·",
};

export function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    const v = NAMED[e.toLowerCase()];
    return v ?? m;
  });
}

const BLOCK_OPEN = new Set(["p", "div", "br", "tr", "li", "td", "h1", "h2", "h3", "h4"]);
const BLOCK_CLOSE = new Set(["p", "div", "tr", "li", "h1", "h2", "h3", "h4"]);

/** The document as text: inline XBRL header dropped, block tags as newlines, entities decoded. */
export function textOf(html: string): string {
  let raw = html.replace(/<ix:header>[\s\S]*?<\/ix:header>/gi, "");
  raw = raw.replace(/<!--[\s\S]*?-->/g, "");
  const out: string[] = [];
  let skip = 0;
  let i = 0;
  const re = /<\/?\s*([a-zA-Z][\w:.-]*)[^>]*>|<![^>]*>|<\?[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const text = raw.slice(i, m.index);
    if (skip === 0 && text) out.push(text);
    i = m.index + m[0].length;
    const tagName = (m[1] ?? "").toLowerCase();
    if (tagName === "") continue;
    const closing = m[0].startsWith("</");
    if (tagName === "style" || tagName === "script") {
      skip = closing ? Math.max(0, skip - 1) : skip + 1;
      continue;
    }
    if (!closing && BLOCK_OPEN.has(tagName)) out.push("\n");
    if (closing && BLOCK_CLOSE.has(tagName)) out.push("\n");
  }
  const tail = raw.slice(i);
  if (skip === 0 && tail) out.push(tail);
  let t = unescapeHtml(unescapeHtml(out.join(""))).replace(/ /g, " ");
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/\n\s*\n+/g, "\n");
  return t;
}

// ── sections ───────────────────────────────────────────────────────────────

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function itemSection(t: string, item: string): string | null {
  const m = new RegExp("\\n\\s*Item\\s*" + escapeRe(item) + "\\b", "i").exec(t);
  if (!m) return null;
  const startEnd = m.index + m[0].length;
  const rest = t.slice(startEnd);
  const n = /\n\s*Item\s*\d\.\d\d\b/i.exec(rest);
  return (n ? t.slice(m.index, startEnd + n.index) : t.slice(m.index, m.index + 8000)).trim();
}

export function section205(t: string): { text: string | null; how: Parsed205["section"] } {
  const s = itemSection(t, "2.05");
  if (!s) return { text: null, how: null };
  const ref = /Item\s*(\d\.\d\d)\s*(?:below|above|of this)?[^.]{0,60}incorporated/i.exec(s);
  if (ref && s.length < 400) {
    const s2 = itemSection(t, ref[1]);
    if (s2) return { text: s2, how: `via_${ref[1]}` };
  }
  return { text: s, how: "direct" };
}

// ── the rules ──────────────────────────────────────────────────────────────

const NUM = "\\d{1,3}(?:,\\d{3})+|\\d+";
const WORDS: Record<string, number> = {
  "half": 50, "one-half": 50, "one-third": 33, "a third": 33, "one-quarter": 25, "a quarter": 25,
  "two-thirds": 67, "three-quarters": 75,
};
const WF =
  "(?:global\\s+|total\\s+|current\\s+|full-time\\s+|worldwide\\s+|salaried\\s+|hourly\\s+|non-union\\s+|corporate\\s+|U\\.S\\.\\s+)*" +
  "(?:workforce|employees|headcount|employee base|positions|team|team members|associates|staff|personnel|roles|jobs)";
const ACT = /reduc|eliminat|affect|impact|layoff|laid off|terminat|cut|separat|displac|RIF\b|position/i;
const NEG = /retain|remain|hire|hiring|add|grow|attrition/i;
const PCT = new RegExp(
  "(?:approximately|about|roughly|up to|nearly)?\\s*(\\d{1,2}(?:\\.\\d)?)\\s*(?:%|percent)\\s+of\\s+(?:its|the Company.s|our|the|the Bank.s|the Company.s)?\\s*" + WF,
  "i",
);
const PCT2 = /(?:workforce|headcount|employees|positions)\s+by\s+(?:approximately|about|roughly|up to|nearly)?\s*(\d{1,2}(?:\.\d)?)\s*(?:%|percent)/i;
const PCT3 = /(?:workforce|headcount|employees|positions)\s+(?:of|by)\s+(?:approximately|about|roughly|up to|nearly)?\s*(\d{1,2}(?:\.\d)?)\s*(?:%|percent)/i;
const PCTW = new RegExp(
  "(?:workforce|headcount|employees)\\s+by\\s+(?:approximately|about|roughly)?\\s*(" + Object.keys(WORDS).map(escapeRe).join("|") + ")\\b",
  "i",
);
const HC = new RegExp(
  "(?:approximately|about|roughly|up to|nearly)?\\s*(" + NUM + ")\\s+(?:\\w+\\s+){0,3}?(?:employees|positions|roles|jobs|team members|associates|staff members|people|workers)",
  "gi",
);
const FROMTO = new RegExp(
  "from\\s+(?:approximately\\s+)?(" + NUM + ")\\s+(?:[\\w-]+\\s+){0,2}?(?:employees|positions)\\s+to\\s+(?:approximately\\s+)?(" + NUM + ")",
  "i",
);
const TIME =
  /(?:substantially\s+)?complete[d]?\s+(?:by|in|during|within)\s+[^.,;]{3,60}|effective\s+(?:immediately|on\s+\w+\s+\d{1,2},?\s*\d{4})|(?:first|second|third|fourth)\s+(?:fiscal\s+)?quarter\s+of\s+(?:fiscal\s+(?:year\s+)?)?\d{4}|(?:by|in)\s+(?:the\s+end\s+of\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s*\d{0,2},?\s*\d{4}|by\s+the\s+end\s+of\s+(?:fiscal\s+)?(?:year\s+)?\d{4}/i;
const COST = new RegExp("\\$\\s?(" + NUM + "(?:\\.\\d+)?)\\s*(million|billion)", "i");
const DATE = /On\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4})/;
const SITES = /(?:facility|facilities|plant|office|branch|branches|operations)\s+(?:located\s+)?in\s+([A-Z][\w.]+(?:\s[A-Z][\w.]+)?,\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/g;
const WORKFORCE_WORDS = /workforce|headcount|employees|positions|reduction in force|layoff|associates|severance/i;
const EXCERPT_WORDS = /workforce|headcount|employees|positions|associates/i;

export function sentences(s: string): string[] {
  return s.replace(/\n/g, " ").split(/(?<=[.;])\s+(?=[A-Z(•])/).map((x) => x.trim()).filter((x) => x !== "");
}

const toInt = (s: string) => parseInt(s.replace(/,/g, ""), 10);

/** Parse one primary document (HTML) into the Item 2.05 reading. */
export function parse205(html: string): Parsed205 {
  const t = textOf(html);
  const { text: sec, how } = section205(t);
  const r: Parsed205 = {
    section: how, sectionText: sec, sectionChars: sec ? sec.length : 0,
    pct: null, headcount: null, headcountBasis: null, timing: null, cost: null, decisionDate: null,
    excerpt: null, isWorkforce: false, sites: [],
  };
  if (!sec) return r;
  r.isWorkforce = WORKFORCE_WORDS.test(sec);
  const ss = sentences(sec);
  for (const x of ss) {
    if (!ACT.test(x)) continue;
    if (r.pct == null) {
      for (const rx of [PCT, PCT2, PCT3]) {
        const m = rx.exec(x);
        if (m && !NEG.test(x.slice(0, m.index).slice(-60))) {
          r.pct = parseFloat(m[1]);
          r.excerpt = r.excerpt ?? x.slice(0, 500);
          break;
        }
      }
      if (r.pct == null) {
        const m = PCTW.exec(x);
        if (m) { r.pct = WORDS[m[1].toLowerCase()]; r.excerpt = r.excerpt ?? x.slice(0, 500); }
      }
    }
    if (r.headcount == null) {
      const m = FROMTO.exec(x);
      if (m) {
        const a = toInt(m[1]), b = toInt(m[2]);
        if (a > b) { r.headcount = a - b; r.headcountBasis = "derived_from_to"; r.excerpt = r.excerpt ?? x.slice(0, 500); continue; }
      }
      HC.lastIndex = 0;
      let h: RegExpExecArray | null;
      while ((h = HC.exec(x)) !== null) {
        const n = toInt(h[1]);
        if (n >= 5 && !NEG.test(x.slice(0, h.index).slice(-40)) && !/\$|million|percent|%/.test(h[0])) {
          r.headcount = n; r.headcountBasis = "stated"; r.excerpt = r.excerpt ?? x.slice(0, 500);
          break;
        }
      }
    }
  }
  const tm = TIME.exec(sec); r.timing = tm ? tm[0].slice(0, 80) : null;
  const cm = COST.exec(sec); r.cost = cm ? `${cm[1]} ${cm[2]}` : null;
  const dm = DATE.exec(sec); r.decisionDate = dm ? dm[1] : null;
  const sites: string[] = [];
  for (const m of sec.matchAll(SITES)) if (!sites.includes(m[1])) sites.push(m[1]);
  r.sites = sites.slice(0, 5);
  if (!r.excerpt) {
    const first = ss.find((x) => EXCERPT_WORDS.test(x));
    r.excerpt = first ? first.slice(0, 500) : null;
  }
  return r;
}

/** A confidence for the numeric reading: 1 when a number was read from the section, 0.5 when only a sentence, 0 when no section. */
export function parseConfidence(p: Parsed205): number {
  if (!p.sectionText) return 0;
  if (p.pct != null || p.headcount != null) return 1;
  return p.excerpt ? 0.5 : 0.25;
}
