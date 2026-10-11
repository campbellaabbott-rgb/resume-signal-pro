// @vitest-environment node
/**
 * THE PERK READER KEEPS THE PRECISION IT WAS MEASURED AT.
 *
 * The salary parser shipped 232 wrong figures because nothing held it to a
 * measured precision. The perk extractor (supabase/functions/_shared/
 * perks-extract.ts) was tuned on 24 employers' postings and then run once on
 * 24 others it had never seen: micro precision 93% (272 of 293), recall 86%
 * (272 of 318), 99 postings. Those postings and their hand labels are
 * src/test/fixtures/perks-test-split.json. This file holds:
 *
 *   - the counts, exactly: a change that moves one true or false positive
 *     fails here by name, and the per-key table is printed on failure;
 *   - every key a profile may ever show measured at 95% precision or better
 *     on these postings (the plan's publish gate, step 1), and every key
 *     below it withheld;
 *   - the withheld keys (flexible working, mental health, childcare,
 *     discounts, commuting, meals, bonus, learning, "benefits exist",
 *     positive visa offers) can never publish: not in the TypeScript list,
 *     not in the database's CHECK, not in the reader's list;
 *   - Ramp's "Fertility HRA (up to $10,000 per year)" line is a benefit the
 *     perk reader stores as words, never as pay -- while the salary parser,
 *     which the perk text never reaches, still reads it as "$10,000 per
 *     year" (the control that makes the isolation load-bearing);
 *   - nothing but the employer-profiles function imports the extractor, and
 *     nothing in this lane writes a description, salary or search column.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CANDIDATE_KEYS, PERK_KEYS, ROLLUP_KEYS, WITHHELD_KEYS, extract, readPosting, type PerkKey,
} from "../../supabase/functions/_shared/perks-extract";
import { extractSalary } from "../../supabase/functions/_shared/salary-extract";
import { codeOf, sqlCodeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
type Row = { idx: number; company: string; vendor: string; country: string | null; title: string; labels: string; note: string; description: string };
const FIXTURE = JSON.parse(readFileSync(resolve(__dirname, "fixtures/perks-test-split.json"), "utf8")) as { rows: Row[] };
const ROWS = FIXTURE.rows;

const gold = (r: Row) => Object.fromEntries(r.labels.split(/\s+/).filter(Boolean).map((t) => { const [k, v] = t.split(":"); return [k, v[0]]; })) as Record<string, string>;

type Stat = { tp: number; fp: number; fn: number; ntp: number; nfp: number; nfn: number; nfpIdx: number[] };
const stats: Record<string, Stat> = Object.fromEntries(PERK_KEYS.map((p) => [p, { tp: 0, fp: 0, fn: 0, ntp: 0, nfp: 0, nfn: 0, nfpIdx: [] }]));
for (const r of ROWS) {
  const g = gold(r);
  const e = extract(r.title, r.description);
  for (const p of PERK_KEYS) {
    const gs = g[p];
    const ps = e.perks[p];
    const gPos = gs === "Y" || gs === "Q";
    const pPos = ps === "Y" || ps === "Q";
    const s = stats[p];
    if (gPos && pPos) s.tp++;
    else if (!gPos && pPos) s.fp++;
    else if (gPos && !pPos) s.fn++;
    if (gs === "N" && ps === "N") s.ntp++;
    else if (gs !== "N" && ps === "N") { s.nfp++; s.nfpIdx.push(r.idx); }
    else if (gs === "N" && ps !== "N") s.nfn++;
  }
}
const total = Object.values(stats).reduce((a, s) => ({ tp: a.tp + s.tp, fp: a.fp + s.fp, fn: a.fn + s.fn }), { tp: 0, fp: 0, fn: 0 });
const precision = (s: { tp: number; fp: number }) => (s.tp + s.fp ? s.tp / (s.tp + s.fp) : NaN);
const table = () => PERK_KEYS.map((p) => {
  const s = stats[p];
  return `${p.padEnd(11)} tp ${s.tp} fp ${s.fp} fn ${s.fn} precision ${(precision(s) * 100).toFixed(0)}% | N tp ${s.ntp} fp ${s.nfp} fn ${s.nfn}`;
}).join("\n");

describe("the held-out split, read by the shipped extractor", () => {
  it("is the split that was measured: the 99 postings with text among 24 employers' 101", () => {
    // Two postings of the 101 had no text (a USAJOBS agency's only one, and
    // one of Spotify's), so 23 employers carry the 99 the counts are over.
    expect(ROWS.length).toBe(99);
    expect(new Set(ROWS.map((r) => r.company)).size).toBe(23);
  });

  it("finds 272 of the 318 labelled perks and claims 21 that are not there (93% precision, 86% recall)", () => {
    expect(total, `per-key counts:\n${table()}`).toEqual({ tp: 272, fp: 21, fn: 46 });
    expect(precision(total)).toBeGreaterThan(0.92);
    expect(total.tp / (total.tp + total.fn)).toBeGreaterThan(0.85);
  });

  it("every key a profile may show reads at 95% precision or better here", () => {
    const low: string[] = [];
    for (const key of CANDIDATE_KEYS) {
      if (key === "visa_not_offered") continue; // the stated limit: below
      const s = stats[key as PerkKey];
      if (!(precision(s) >= 0.95) || s.tp < 10) low.push(`${key}: ${s.tp} right, ${s.fp} wrong`);
    }
    expect(low, `a candidate key below the publish gate:\n${table()}`).toEqual([]);
  });

  it("the visa limit: 9 of 10 stated as not offered agree with the label, and the tenth posting says it too", () => {
    const s = stats.visa;
    expect([s.ntp, s.nfp]).toEqual([9, 1]);
    // The disagreement is a labelling error the measurement left in place:
    // the posting itself says the role is not eligible for sponsorship.
    const [idx] = s.nfpIdx;
    const row = ROWS.find((r) => r.idx === idx)!;
    expect(row.description).toMatch(/not eligible for visa sponsorship/i);
  });

  it("every positive key under 95% here is withheld, never a candidate", () => {
    const measuredLow = PERK_KEYS.filter((p) => stats[p].tp + stats[p].fp > 0 && precision(stats[p]) < 0.95);
    expect(measuredLow.sort()).toEqual(["childcare", "bonus", "commute", "discount", "flex", "generic", "learning", "meals", "mental"].sort());
    for (const p of measuredLow) {
      expect(WITHHELD_KEYS as readonly string[], `${p} measured under 95% and is not withheld`).toContain(p);
      expect(CANDIDATE_KEYS as readonly string[]).not.toContain(p);
    }
  });
});

describe("the withheld keys can never publish", () => {
  const MIGRATION = readdirSync(resolve(ROOT, "supabase/migrations")).find((f) => f.startsWith("20261012110000_"));
  const sql = MIGRATION ? sqlCodeOf(readFileSync(resolve(ROOT, "supabase/migrations", MIGRATION), "utf8")) : "";
  const listAfter = (anchor: RegExp): string[] => {
    const m = anchor.exec(sql);
    if (!m) return [];
    const open = sql.indexOf("(", m.index + m[0].length - 1);
    const close = sql.indexOf(")", open);
    return [...sql.slice(open + 1, close).matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  };

  it("the list is the plan's, and no withheld key is a candidate", () => {
    expect([...WITHHELD_KEYS].sort()).toEqual(["bonus", "childcare", "commute", "discount", "flex", "generic", "learning", "meals", "mental", "visa"]);
    expect(CANDIDATE_KEYS.filter((k) => (WITHHELD_KEYS as readonly string[]).includes(k))).toEqual([]);
    expect([...CANDIDATE_KEYS].sort()).toEqual(["dental", "equity", "health", "life_dis", "parental", "pto", "retire", "visa_not_offered", "vision"]);
  });

  it("the database refuses a published flag on anything but the candidates, and the reader names the same list", () => {
    expect(MIGRATION, "20261012110000_*.sql is missing").toBeTruthy();
    const check = listAfter(/CONSTRAINT employer_profile_perk_publish_only_candidates CHECK \(NOT published OR perk IN/);
    expect(check.sort(), "the CHECK on employer_profile_perk_publish").toEqual([...CANDIDATE_KEYS].sort());
    const reader = sql.slice(sql.indexOf("FUNCTION public.get_employer_perks(p_token text)"));
    const readerList = [...(/pp\.perk IN \(([^)]*)\)/.exec(reader)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(readerList.sort(), "the reader's own list").toEqual([...CANDIDATE_KEYS].sort());
    for (const w of WITHHELD_KEYS) {
      expect(check).not.toContain(w);
      expect(readerList).not.toContain(w);
    }
  });

  it("the stored bit order is the migration's seed, key for key", () => {
    const seed = [...sql.matchAll(/\('([a-z_]+)',\s*(\d+),\s*'(positive|negation)'\)/g)].map((m) => ({ perk: m[1], bit: Number(m[2]), counts: m[3] }));
    expect(seed).toEqual(ROLLUP_KEYS.map((k) => ({ perk: k.perk, bit: k.bit, counts: k.counts })));
  });
});

describe("Ramp's fertility HRA line is a benefit, never pay", () => {
  const ramp = ROWS.filter((r) => r.company === "Ramp");
  const HRA = "Fertility HRA (up to $10,000 per year)";

  it("all four Ramp postings carry it, inside the benefits section the extractor found", () => {
    expect(ramp.length).toBe(4);
    for (const r of ramp) {
      const lines = `${r.title}\n${r.description}`.split("\n");
      const at = lines.findIndex((l) => l.includes(HRA));
      expect(at, `#${r.idx}`).toBeGreaterThan(0);
      expect(extract(r.title, r.description).sectionLines, `#${r.idx}: the line sits outside a benefits section`).toContain(at);
    }
  });

  it("the perk read keeps no amount: masks and quoted words only, and no value of 10,000", () => {
    for (const r of ramp) {
      const read = readPosting(r.title, r.description);
      expect(Object.keys(read).sort()).toEqual(["franchise", "n", "q", "quotes", "readable", "y"]);
      expect(read.readable).toBe(true);
      const values = extract(r.title, r.description).values;
      expect(Object.keys(values).every((k) => ["pto_days", "parental_weeks", "retire_pct"].includes(k))).toBe(true);
      expect(Object.values(values)).not.toContain(10000);
    }
  });

  it("the control: the salary parser, which perk text never reaches, reads the same line as pay", () => {
    // job-board .94 (phase 3) teaches NOT_PAY this case. Until then this is
    // why benefits text lives in its own tables and never in a description.
    expect(extractSalary(HRA)).toMatch(/\$10,000 per year/);
  });
});

describe("the extractor is the employer-profiles function's alone", () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    if (!existsSync(dir)) return out;
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) {
        if (["node_modules", "dist", ".git"].includes(e)) continue;
        walk(p, out);
      } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e)) out.push(p);
    }
    return out;
  };
  const rel = (p: string) => p.slice(ROOT.length + 1);
  const isTest = (p: string) => /(^|\/)src\/test\//.test(rel(p)) || /\.test\.|_test\.ts$/.test(p);

  it("no file outside supabase/functions/employer-profiles imports it (tests aside)", () => {
    const files = [...walk(resolve(ROOT, "supabase/functions")), ...walk(resolve(ROOT, "src")), ...walk(resolve(ROOT, "worker/src")), ...walk(resolve(ROOT, "scripts"))];
    expect(files.length).toBeGreaterThan(300);
    const importers = files
      .filter((p) => !isTest(p) && !p.endsWith("_shared/perks-extract.ts"))
      .filter((p) => /perks-extract/.test(codeOf(readFileSync(p, "utf8"))))
      .map(rel);
    expect(importers.every((p) => p.startsWith("supabase/functions/employer-profiles/")), importers.join("\n")).toBe(true);
    expect(importers, "the function that should import it does not").toContain("supabase/functions/employer-profiles/index.ts");
  });

  it("the function never writes a posting, a description, a salary or a search column", () => {
    const dir = resolve(ROOT, "supabase/functions/employer-profiles");
    const code = walk(dir).filter((p) => !isTest(p)).map((p) => codeOf(readFileSync(p, "utf8"))).join("\n");
    expect(code).not.toMatch(/salary-extract|search-routing|from\(\s*["']job_board_postings["']\s*\)/);
    expect(code).not.toMatch(/\b(salary|search_tsv|title_tsv)\b/);
  });

  it("the lane's SQL writes only its own tables", () => {
    const dir = resolve(ROOT, "supabase/migrations");
    const mine = readdirSync(dir).filter((f) => /^2026101211\d{4}_/.test(f));
    expect(mine.length).toBeGreaterThanOrEqual(2);
    for (const f of mine) {
      const code = sqlCodeOf(readFileSync(resolve(dir, f), "utf8"));
      expect(code, f).not.toMatch(/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(public\.)?job_board_postings\b/i);
      expect(code, f).not.toMatch(/\bsalary\w*\s*=/i);
    }
  });
});
