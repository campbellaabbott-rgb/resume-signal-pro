export const foldName = (s: string): string =>
  s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
export const OCCUPATION_GUARD: ReadonlySet<string> = new Set([
  "sales", "nurse", "nursing", "driver", "chef", "intern", "internship", "it",
  "hr", "manager", "engineer", "engineering", "developer", "analyst", "teacher",
  "accountant", "designer", "recruiter", "technician", "assistant", "associate",
  "director", "specialist", "coordinator", "consultant", "administrator",
  "apple", "target", "shell", "oracle", "next", "general", "digital", "health",
  "talent", "medical", "american", "global", "open", "first", "summit",
  "capital", "premier", "national", "standard", "crown", "pioneer", "frontier",
  "horizon", "unity", "spark", "match", "monster", "indeed", "visa", "discover",
  "guardian", "liberty", "progressive", "cardinal", "sage", "stripe", "square",
  "orange", "gap", "boots", "sky", "three", "giant", "remote", "hybrid",
  "ace", "arrow", "benchmark", "card", "continental", "flex", "infuse", "ing",
  "intuitive", "mars", "nov", "republic", "rochester", "sec", "wisconsin",
  "wood",
]);
export const ENGLISH_STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "else", "when", "at", "by",
  "for", "with", "about", "into", "to", "from", "up", "down", "in", "out", "on",
  "off", "over", "under", "again", "no", "nor", "not", "only", "own", "same",
  "so", "than", "too", "very", "can", "will", "just", "it", "its", "is", "are",
  "was", "were", "be", "been", "being", "do", "does", "did", "of", "as", "who",
]);
export type Route = "BROWSE" | "EMPLOYER" | "SYMBOL" | "SIMPLE" | "RANKED";
export const RETRIEVER_FOR: Readonly<Record<Route, "browse" | "company" | "simple" | "ranked">> = {
  BROWSE: "browse",
  EMPLOYER: "company",
  SYMBOL: "ranked",
  SIMPLE: "simple",
  RANKED: "ranked",
};
export interface RouteDecision {
  route: Route;
  reason: string;
  tokens?: string[];
  matchedName?: string;
}
export function pickRoute(
  rawQ: string,
  aliases: Readonly<Record<string, { tokens: string[]; name: string }>>,
): RouteDecision {
  const raw = String(rawQ ?? "").trim();
  if (!raw) return { route: "BROWSE", reason: "empty query" };
  const alnum = foldName(raw);
  const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean);
  if (alnum.length >= 3 && !OCCUPATION_GUARD.has(alnum)) {
    const hit = aliases[alnum];
    if (hit && hit.tokens.length > 0) {
      return { route: "EMPLOYER", reason: `whole query matches employer ${hit.name}`, tokens: hit.tokens, matchedName: hit.name };
    }
  }
  if (/[+#]/.test(raw)) {
    return { route: "SYMBOL", reason: "symbol query — ranked retrieval, separated by literal scoring" };
  }
  if (tokens.some((t) => ENGLISH_STOPWORDS.has(t) || foldName(t).length <= 3)) {
    return { route: "SIMPLE", reason: "query contains a token the english index discards" };
  }
  return { route: "RANKED", reason: "default" };
}
export const wordCount = (text: string, term: string): number => {
  if (!term) return 0;
  const re = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "gi");
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    n++;
    if (re.lastIndex > 0) re.lastIndex--;
    if (re.lastIndex <= m.index) re.lastIndex = m.index + 1;
  }
  return n;
};
export function scoreTitle(title: string, query: string, ageDays?: number): number {
  const t = String(title ?? "");
  const tl = t.toLowerCase();
  const qRaw = String(query ?? "").trim();
  const qTokens = qRaw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (qTokens.length === 0) return 0;
  const present = qTokens.filter((tok) => wordCount(tl, tok) > 0).length;
  let score = (100 * present) / qTokens.length;
  const normT = foldName(t);
  const normQ = foldName(qRaw);
  if (normT === normQ) score += 120;
  else if (tl.startsWith(qRaw.toLowerCase())) score += 45;
  if (qTokens.length > 1 && tl.includes(qRaw.toLowerCase())) score += 25;
  if (/[^a-z0-9\s]/i.test(qRaw) && tl.includes(qRaw.toLowerCase())) score += 90;
  const titleTokens = tl.split(/[^a-z0-9]+/).filter(Boolean).length;
  const extra = Math.max(0, titleTokens - qTokens.length);
  score -= 22 * Math.log(1 + extra);
  for (const tok of qTokens) score -= 12 * Math.max(0, wordCount(tl, tok) - 1);
  if (typeof ageDays === "number" && Number.isFinite(ageDays) && ageDays >= 0) {
    score += Math.min(12, Math.max(0, 12 - 3 * Math.log(1 + ageDays)));
  }
  return score;
}
const PERK_CONTEXT =
  /\b(membership|reimbursement|discount(s|ed)?|perk|benefit(s)?|allowance|stipend|401\s?k|insurance|pto|gym|wellness|voucher|gift\s?card)\b/i;
export function isPerkListMatch(snippet: unknown): boolean {
  const text = String(snippet ?? "");
  const marks = [...text.matchAll(/\[\[(.+?)\]\]/g)];
  if (marks.length === 0) return false;
  return marks.every((m) => {
    const at = m.index ?? 0;
    const from = text.lastIndexOf("\n", at) + 1;
    const toRaw = text.indexOf("\n", at);
    const line = text.slice(from, toRaw === -1 ? text.length : toRaw);
    return PERK_CONTEXT.test(line);
  });
}
export function rerankWindow<T extends { title?: unknown; company?: unknown; token?: unknown; snippet?: unknown }>(
  rows: readonly T[],
  query: string | readonly string[],
  perCompany = 2,
): T[] {
  const readings = (Array.isArray(query) ? query : [query as string])
    .map((q) => String(q ?? "").trim())
    .filter((q) => q.length > 0);
  const queries = readings.length ? readings : [""];
  const scored = rows.map((r, i) => ({
    r,
    i,
    s: Math.max(...queries.map((q) => scoreTitle(String(r.title ?? ""), q))),
    c: Math.max(...queries.map((q) => scoreTitle(String(r.company ?? ""), q))),
  })).map((x) => ({
    ...x,
    cls: x.s > 0 ? 0 : x.c > 0 ? 1 : isPerkListMatch(x.r.snippet) ? 3 : 2,
  }));
  scored.sort((a, b) => (a.cls - b.cls) || (b.s - a.s) || (b.c - a.c) || (a.i - b.i));
  const seen = new Map<string, number>();
  const keep: typeof scored = [];
  const demoted: typeof scored = [];
  for (const x of scored) {
    if (x.cls === 1) { keep.push(x); continue; }
    const key = String(x.r.company ?? x.r.token ?? "").toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    (n <= perCompany ? keep : demoted).push(x);
  }
  return [...keep, ...demoted].map((x) => x.r);
}
const EXCLUSION_STOPWORDS: ReadonlySet<string> = new Set([
  "for", "the", "a", "an", "of", "in", "at", "to", "on",
]);
export function splitExclusions(raw: string): { positive: string; excluded: string[] } {
  const text = String(raw ?? "").trim();
  if (!text) return { positive: text, excluded: [] };
  const words = text.split(/\s+/);
  const positive: string[] = [];
  const excluded: string[] = [];
  let pendingNot: string | null = null;
  for (const w of words) {
    if (pendingNot !== null) {
      if (EXCLUSION_STOPWORDS.has(w.toLowerCase())) positive.push(pendingNot, w);
      else excluded.push(w.toLowerCase());
      pendingNot = null;
      continue;
    }
    if (/^not$/i.test(w)) { pendingNot = w; continue; }
    if (w.length > 1 && w.startsWith("-")) { excluded.push(w.slice(1).toLowerCase()); continue; }
    positive.push(w);
  }
  const cleanExcluded = [...new Set(excluded.map((e) => e.replace(/[^a-z0-9+#.]/gi, "").toLowerCase()).filter((e) => e.length >= 2))];
  if (!positive.length || !cleanExcluded.length) return { positive: text, excluded: [] };
  return { positive: positive.join(" "), excluded: cleanExcluded };
}
export function titleExcluded(title: string, excluded: readonly string[]): boolean {
  if (!excluded.length) return false;
  const t = String(title ?? "").toLowerCase();
  return excluded.some((e) => new RegExp(`(^|[^a-z0-9])${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(t));
}
