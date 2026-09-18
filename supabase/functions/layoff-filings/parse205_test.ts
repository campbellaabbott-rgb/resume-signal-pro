// The parser port is held to two things: the Python it was ported from,
// field for field on all 28 saved documents, and lane 1's hand labels — the
// 18 in-sample filings it was tuned on (a fit) and the 10 July-2026 hold-out
// filings it never saw (the measurement). The hold-out assertions are the
// baseline the spec quotes and nothing above it: recall is reported.
//
// Run: deno test --allow-read --allow-env supabase/functions/layoff-filings/

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parse205, parseConfidence, PARSER_VERSION, sentences, textOf } from "./parse205.ts";
import { sampleJson, sampleList, sampleText } from "./fixtures.ts";

interface PyRow {
  adsh: string; section: string | null; section_chars: number; pct: number | null; headcount: number | null;
  timing: string | null; cost: string | null; decision_date: string | null; excerpt: string | null;
  is_workforce: boolean; sites: string[];
}

/** Lane 1's hand labels (lane1-sec-edgar.md §C for the 18; the hold-out paragraph for the 10). */
const IN_SAMPLE: Record<string, { filer: string; pct: number | null; headcount: number | null; workforce: boolean }> = {
  "0001437749-26-028729": { filer: "Insteel Industries", pct: null, headcount: 65, workforce: true },
  "0001140361-26-034320": { filer: "PDS Biotechnology", pct: 36, headcount: null, workforce: true },
  "0001193125-26-368858": { filer: "Synopsys (8-K/A)", pct: null, headcount: null, workforce: true },
  "0001568100-26-000044": { filer: "PagerDuty", pct: 15, headcount: null, workforce: true },
  "0001104659-26-103548": { filer: "TELA Bio", pct: 20, headcount: 41, workforce: true },
  "0001670076-26-000093": { filer: "Frontier Group", pct: null, headcount: null, workforce: false },
  "0000931148-26-000075": { filer: "GrafTech", pct: null, headcount: null, workforce: true },
  "0001193125-26-379343": { filer: "TScan Therapeutics", pct: 75, headcount: null, workforce: true },
  "0001713683-26-000156": { filer: "Zscaler", pct: 3, headcount: null, workforce: true },
  "0001193125-26-381967": { filer: "Simmons First National", pct: null, headcount: 100, workforce: true },
  "0001193125-26-382690": { filer: "Trade Desk", pct: 15, headcount: null, workforce: true },
  "0002039852-26-000121": { filer: "Bancorp (TBBK)", pct: 9, headcount: 64, workforce: true },
  "0000897077-26-000101": { filer: "Alamo Group", pct: null, headcount: null, workforce: false },
  "0001493152-26-042189": { filer: "CVD Equipment", pct: 50, headcount: null, workforce: true },
  "0001193125-26-387279": { filer: "Commerce.com", pct: null, headcount: null, workforce: true },
  "0001193125-26-389901": { filer: "Cambium Networks", pct: 53.6, headcount: 260, workforce: true },
  "0001193125-26-390577": { filer: "Sionna Therapeutics", pct: 46, headcount: null, workforce: true },
  "0001193125-26-393058": { filer: "Mission Produce", pct: null, headcount: null, workforce: true },
};

const HOLDOUT: Record<string, { filer: string; pct: number | null; headcount: number | null; workforce: boolean }> = {
  "0000106640-26-000052": { filer: "Whirlpool", pct: null, headcount: null, workforce: true },
  "0001651562-26-000055": { filer: "Coursera", pct: null, headcount: null, workforce: true },
  "0001477932-26-004260": { filer: "SOBR Safe", pct: null, headcount: 3, workforce: true },
  "0001104659-26-083326": { filer: "NextCure", pct: null, headcount: null, workforce: true },
  "0001517375-26-000052": { filer: "Sprout Social", pct: 20, headcount: 260, workforce: true },
  "0001104659-26-084248": { filer: "ArcBest", pct: 2, headcount: null, workforce: true },
  "0001213900-26-079061": { filer: "Optimus Healthcare", pct: null, headcount: null, workforce: true },
  "0001193125-26-308023": { filer: "Exodus Movement", pct: 25, headcount: 77, workforce: true },
  "0001104659-26-085071": { filer: "Cracker Barrel", pct: null, headcount: null, workforce: true },
  "0001628280-26-049010": { filer: "Goodyear", pct: null, headcount: 1750, workforce: true },
};

function parseDir(sub: string) {
  const out = new Map<string, ReturnType<typeof parse205>>();
  for (const f of sampleList(sub, ".htm")) out.set(f.slice(0, -4), parse205(sampleText(`${sub}/${f}`)));
  return out;
}

Deno.test("the port reproduces the Python parser field for field on the 18 in-sample documents", () => {
  const py = sampleJson<PyRow[]>("parse205_v2_30d.json");
  const ours = parseDir("docs");
  assertEquals(ours.size, 18);
  for (const row of py) {
    const p = ours.get(row.adsh);
    assert(p, `no parse for ${row.adsh}`);
    assertEquals(p.section, row.section, `${row.adsh} section`);
    assertEquals(p.pct, row.pct, `${row.adsh} pct`);
    assertEquals(p.headcount, row.headcount, `${row.adsh} headcount`);
    assertEquals(p.isWorkforce, row.is_workforce, `${row.adsh} is_workforce`);
    assertEquals(p.decisionDate, row.decision_date, `${row.adsh} decision_date`);
    assertEquals(p.cost, row.cost, `${row.adsh} cost`);
    assertEquals(norm(p.timing), norm(row.timing), `${row.adsh} timing`);
    assertEquals(norm(p.excerpt), norm(row.excerpt), `${row.adsh} excerpt`);
    assertEquals(p.sites, row.sites, `${row.adsh} sites`);
    assert(Math.abs(p.sectionChars - row.section_chars) <= 2, `${row.adsh} section length ${p.sectionChars} vs ${row.section_chars}`);
  }
});

Deno.test("the port reproduces the Python parser on the 10 hold-out documents it was never tuned on", () => {
  const py = sampleJson<PyRow[]>("parse205_v2_holdout.json");
  const ours = parseDir("holdout");
  assertEquals(ours.size, 10);
  for (const row of py) {
    const p = ours.get(row.adsh)!;
    assertEquals(p.section, row.section, `${row.adsh} section`);
    assertEquals(p.pct, row.pct, `${row.adsh} pct`);
    assertEquals(p.headcount, row.headcount, `${row.adsh} headcount`);
    assertEquals(p.isWorkforce, row.is_workforce, `${row.adsh} is_workforce`);
    assertEquals(norm(p.timing), norm(row.timing), `${row.adsh} timing`);
    assertEquals(norm(p.excerpt), norm(row.excerpt), `${row.adsh} excerpt`);
  }
});

Deno.test("in-sample hand labels: every numeric field the filing states is read, none invented (a fit, not a measurement)", () => {
  const ours = parseDir("docs");
  let stated = 0, read = 0, invented = 0, classified = 0;
  for (const [adsh, label] of Object.entries(IN_SAMPLE)) {
    const p = ours.get(adsh)!;
    if (label.pct != null) { stated += 1; if (p.pct === label.pct) read += 1; }
    if (label.headcount != null) { stated += 1; if (p.headcount === label.headcount) read += 1; }
    if (label.pct == null && p.pct != null) invented += 1;
    if (label.headcount == null && p.headcount != null) invented += 1;
    if (p.isWorkforce === label.workforce) classified += 1;
  }
  assertEquals(stated, 15);
  assertEquals(read, 15);
  assertEquals(invented, 0);
  assertEquals(classified, 18);
});

Deno.test("hold-out hand labels: the baseline the spec quotes and nothing above it", () => {
  const ours = parseDir("holdout");
  let statedFields = 0, correct = 0, wrong = 0, numericRows = 0, classified = 0, pctFalse = 0;
  for (const [adsh, label] of Object.entries(HOLDOUT)) {
    const p = ours.get(adsh)!;
    if (label.pct != null) { statedFields += 1; if (p.pct === label.pct) correct += 1; else if (p.pct != null) wrong += 1; }
    if (label.headcount != null) { statedFields += 1; if (p.headcount === label.headcount) correct += 1; else if (p.headcount != null) wrong += 1; }
    if (label.pct == null && p.pct != null) pctFalse += 1;
    if (p.pct != null || p.headcount != null) numericRows += 1;
    if (p.isWorkforce === label.workforce) classified += 1;
  }
  // Numeric precision 5/5 and recall 5/7 (Goodyear's noun form and SOBR's
  // word number are the two misses lane 1 named).
  assertEquals(statedFields, 7);
  assertEquals(correct, 5);
  assertEquals(wrong, 0);
  assertEquals(pctFalse, 0, "a percentage the filing never stated");
  // ≥ 3 of 10 hold-out rows carry a number; the port reads exactly the 3 it did in Python.
  assert(numericRows >= 3, `numeric rows ${numericRows} below the 3/10 baseline`);
  assertEquals(numericRows, 3);
  // Workforce classification 7/10: the three plant-closure filings read as non-workforce.
  assertEquals(classified, 7);
  console.log(`[parse205 ${PARSER_VERSION}] hold-out numeric rows ${numericRows}/10, fields ${correct}/${statedFields}, classified ${classified}/10 — reported, not targeted`);
});

Deno.test("every SEC document yields a section text; the section is the whole Item 2.05 (or the item it incorporates)", () => {
  for (const sub of ["docs", "holdout"]) {
    for (const f of sampleList(sub, ".htm")) {
      const p = parse205(sampleText(`${sub}/${f}`));
      assert(p.sectionText && p.sectionText.length > 40, `${f}: no section`);
      assert(/^Item\s*\d\.\d\d/i.test(p.sectionText), `${f}: section does not start at an item heading`);
      const conf = parseConfidence(p);
      assert(conf >= 0 && conf <= 1);
    }
  }
});

Deno.test("text extraction: inline XBRL header, scripts and styles are dropped; block tags break lines; entities decode", () => {
  const html = `<html><head><style>p{x}</style><script>1</script></head><body><ix:header>hidden</ix:header>
    <p>Item&nbsp;2.05 Costs &amp; Exit</p><div>On September 1, 2026, the Company reduced its workforce by approximately 15%.</div>
    <br/>Item 9.01 Exhibits</body></html>`;
  const t = textOf(html);
  assert(!t.includes("hidden"));
  assert(!t.includes("p{x}"));
  assert(t.includes("Item 2.05 Costs & Exit"));
  const p = parse205(html);
  assertEquals(p.pct, 15);
  assertEquals(p.decisionDate, "September 1, 2026");
  assertEquals(sentences("A first. Second one; Third (paren).").length, 3);
});

function norm(s: string | null): string | null {
  return s == null ? null : s.replace(/\s+/g, " ").trim();
}
