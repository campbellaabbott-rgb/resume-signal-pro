// Which job titles on the board does the résumé scanner NOT recognise?
//
//   deno run --allow-net --allow-read --allow-env scripts/role-vocab-gaps.ts [pages]
//
// resumeRoleTerms turns a résumé into the search query the drop runs. A
// headline title it does not know resolves to nothing — the reader gets the
// honest fallback ("ranking what you're browsing"), which on the default browse
// is 0-30% scoreable. The founder/CEO gap was found by a user report; this
// finds the rest from the board's own titles, weighted by how many postings
// carry them, so the vocabulary grows where readers actually are.
//
// Reads /v1/jobs newest-first with the key in .env.local (never .env — tracked,
// public repo). Sequential, a few pages, read-only.
import { resumeRoleTerms } from "../supabase/functions/_shared/fit-score.ts";

const env: Record<string, string> = {};
for (const f of [".env", ".env.local"]) {
  try { for (const l of Deno.readTextFileSync(f).split("\n")) { const i = l.indexOf("="); if (i > 0 && !l.startsWith("#")) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, ""); } } catch { /* optional */ }
}
const KEY = Deno.env.get("RB_API_KEY") ?? env.RB_API_KEY; if (!KEY) { console.error("RB_API_KEY missing"); Deno.exit(2); }
const BASE = `${env.VITE_SUPABASE_URL}/functions/v1/public-api`;
const pages = Math.max(1, Math.min(20, Number(Deno.args[0] ?? 8) || 8));

const norm = (t: string) => t.toLowerCase()
  .replace(/\(.*?\)|\[.*?\]|\s*[-–—|/,:].*$/g, "")            // drop parentheticals and everything after a separator
  .replace(/\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|associate|assistant|chief|head of|vp of|director of|entry[- ]level|remote|hybrid|part[- ]time|full[- ]time|i{1,3}|iv|v)\b/g, " ")
  .replace(/[^a-z& ]/g, " ").replace(/\s+/g, " ").trim();
const counts = new Map<string, number>(); let cursor = ""; let rows = 0;
for (let p = 0; p < pages; p++) {
  const res = await fetch(`${BASE}/v1/jobs?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers: { Authorization: `Bearer ${KEY}` } });
  if (!res.ok) { console.error(`page ${p}: HTTP ${res.status}`); break; }
  const j = await res.json();
  for (const r of j.data ?? []) { rows++; const n = norm(String(r.title ?? "")); if (n.length >= 4) counts.set(n, (counts.get(n) ?? 0) + 1); }
  cursor = j.page?.nextCursor ?? ""; if (!cursor) break;
}
const titles = [...counts.entries()].sort((a, b) => b[1] - a[1]);
const filler = "\nEXPERIENCE\nLed cross-functional teams, owned the roadmap and delivery, hired and managed staff, ran reporting and planning.\n".repeat(3) + "SKILLS: communication, planning, analysis\nBS, State University";
const gaps: Array<[string, number]> = []; let covered = 0, uncovered = 0;
for (const [t, n] of titles) {
  const terms = resumeRoleTerms(`Jane Doe — ${t.replace(/\b\w/g, (c) => c.toUpperCase())}, Acme Corp` + filler);
  if (terms.length === 0) { gaps.push([t, n]); uncovered += n; } else covered += n;
}
console.log(`postings sampled ${rows}   distinct normalised titles ${titles.length}`);
console.log(`postings whose headline resolves to a term: ${covered} (${(100 * covered / Math.max(1, covered + uncovered)).toFixed(0)}%)   unresolved: ${uncovered}`);
console.log(`\nTOP UNRESOLVED TITLES (count) — candidates for the retrieval vocabulary:`);
for (const [t, n] of gaps.slice(0, 40)) console.log(`  ${String(n).padStart(4)}  ${t}`);
