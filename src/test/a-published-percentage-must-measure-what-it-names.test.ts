import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE BOARD PUBLISHED ITS WORK-MODE COVERAGE AS ITS EXPERIENCE COVERAGE.
 *
 * The coverage block computed four counts and destructured three names:
 *
 *   const [sal, wm, exp] = await Promise.all([
 *     one("salary_rank_usd"...), one("salary_max_annual"...),
 *     one("work_mode"...),       one("experience_band"...),
 *   ]);
 *
 * The second entry was added for a pay-CEILING filter that was later refused
 * with data, and inserting it SECOND shifted every binding down one. So the
 * page printed the ceiling coverage as "work mode on 14%" (really 29.1%) and
 * the work-mode coverage as "experience level on 30%" (really 42.1%), while
 * the experience count was computed and discarded. Measured live 2026-08-24:
 * the board was understating its own coverage by roughly half, underneath a
 * sentence telling readers those figures were what employers actually state.
 *
 * A count with no reader is what caused it, so the orphan is deleted rather
 * than bound. The generic assertion below is the one that matters: a
 * Promise.all whose array is longer than its destructuring is this defect in
 * its general form, and it is invisible to the type checker.
 *
 * Second defect in the same block: the numerators did not apply the freshness
 * window that the denominator applied, so every fraction was a count over one
 * population divided by the size of a smaller one.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const JOBS = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
const stripTs = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const CODE = stripTs(FN);

describe("a published percentage must measure what it names", () => {
  it("every destructured Promise.all binds every promise it awaits", () => {
    // The general form of the defect. Scans the whole function: an array
    // longer than its names silently re-labels every value after the gap.
    const re = /const \[([^\]]*)\] = await Promise\.all\(\[([\s\S]*?)\n(\s*)\]\)/g;
    const offenders: string[] = [];
    for (const m of CODE.matchAll(re)) {
      const names = m[1].split(",").map((x) => x.trim()).filter(Boolean);
      const body = m[2];
      // Count top-level entries: commas at depth 0 of the array literal.
      let depth = 0, entries = 1;
      for (const ch of body) {
        if ("([{".includes(ch)) depth++;
        else if (")]}".includes(ch)) depth--;
        else if (ch === "," && depth === 0) entries++;
      }
      if (body.trim().endsWith(",")) entries--;
      if (entries !== names.length) {
        offenders.push(`[${names.join(", ")}] binds ${names.length} of ${entries} promises`);
      }
    }
    expect(offenders, "a promise with no name re-labels everything after it").toEqual([]);
  });

  it("the refused pay-ceiling count is gone, not merely unbound", () => {
    const cov = CODE.slice(CODE.indexOf("const coverage = await"), CODE.indexOf("const frac ="));
    expect(cov).not.toMatch(/salary_max_annual/);
    expect(cov).toMatch(/one\("work_mode", "not\.is\.null"\)/);
    expect(cov).toMatch(/one\("experience_band", "neq\.unspecified"\)/);
  });

  it("numerator and denominator stand on the same population", () => {
    const cov = CODE.slice(CODE.indexOf("const one = async (col"), CODE.indexOf("const frac ="));
    // The helper must apply the same freshness window the `open` denominator does.
    expect(cov).toMatch(/\.is\("missing_since", null\)\.gte\("effective_posted", freshIso\)/);
  });

  it("country is disclosed like the other three filters", () => {
    expect(CODE).toMatch(/one\("country", "not\.is\.null"\)/);
    expect(CODE).toMatch(/if \(applied\.country && typeof cov\.country === "number"\) out\.country = cov\.country;/);
    expect(JOBS).toMatch(/fc\.country/);
  });
});

describe("the arrow keys still scroll the page", () => {
  // The results page is 16,038px tall on desktop, 21,971px on mobile, and a
  // window-level keydown handler called preventDefault() on ArrowUp/ArrowDown
  // whenever nothing was focused — which is the state of every cold load,
  // because e.target is then <body> and neither guard covers it. Measured
  // live: dispatching ArrowDown on document.body returned defaultPrevented
  // true, while PageDown/Space/Home/End returned false.
  it("arrows only steer the list when focus is inside it", () => {
    expect(JOBS).toMatch(/const inList = typeof el\?\.closest === "function" && !!el\.closest\("\[data-job-id\]"\)/);
    expect(JOBS).toMatch(/if \(!isVim && \(e\.key === "ArrowDown" \|\| e\.key === "ArrowUp"\) && !inList\) return;/);
  });

  it("j and k stay global, because they scroll nothing natively", () => {
    expect(JOBS).toMatch(/const isDown = \(e\.key === "ArrowDown" && inList\) \|\| e\.key === "j";/);
    expect(JOBS).toMatch(/const isUp = \(e\.key === "ArrowUp" && inList\) \|\| e\.key === "k";/);
  });
});

describe("a count the page disproves is withdrawn, not published", () => {
  // Measured live 2026-08-24: q=camarero published total 3 above 60 delivered
  // rows, 57 titled "Camarero/a"; cocinero published 10 above 50. The counter
  // asks the FTS predicate while the retriever also runs a prefix scan, so a
  // title the parser welded into one lexeme ("camarero/a") is served but
  // never counted. The ROWS were right — this is arithmetic, not recall, and
  // an audit lane that read it as a 39x recall loss was refuted by the rows
  // themselves.
  it("suppresses the total when the page already holds more than it claims", () => {
    expect(CODE).toMatch(/const totalUnderstated = !augmented && typeof total === "number" && \(offset \+ shownRowCount\) > total;/);
    expect(CODE).toMatch(/total: augmented \|\| totalUnderstated \? null : total,/);
  });

  it("publishes a provable floor in its place", () => {
    expect(CODE).toMatch(/totalUnderstated \? \{ countUnavailable: true, totalAtLeast: offset \+ shownRowCount \}/);
  });
});
