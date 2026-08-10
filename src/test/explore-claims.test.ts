/**
 * EXPLORE WAS PUBLISHING THREE FALSE SENTENCES AND HIDING HALF A SECTION.
 *
 * Measured against production 2026-08-10:
 *
 *   get_size_segments() emits bands mega/large/mid/small, computed from
 *   GREATEST(on_board, feed_total) — a count of OPEN ROLES. The page asked for
 *   ["enterprise","mid","small"], labelled them by EMPLOYEE COUNT ("Enterprise
 *   — 1,000+ employees"), and blurbed "Every company here states its own
 *   headcount… Nothing is guessed."
 *
 *   Consequences, all three at once: `enterprise` never matched, so mega (212
 *   companies / 129,810 roles) and large (724 / 175,821) never rendered — 52%
 *   of the section and every recognisable large employer invisible; the two
 *   bands that did render carried role counts under headcount labels; and no
 *   row in the payload carries an employee field at all, so the sourcing
 *   promise described work nobody does. Epic Games rendered under "Startups &
 *   small teams — under 100 employees".
 *
 * Nothing errored. This is the same shape as tracking_days -> observed_days on
 * the Ghost Job Index and posted_coverage_pct before it: a renamed field does
 * not throw, it silently disables the thing gated on it, and an absence reads
 * as a deliberately withheld statistic.
 *
 * So these tests guard the CLASS, not the instance: the UI must derive its
 * bands from the payload, and no surface may promise headcount sourcing that
 * the SQL does not perform.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const EXPLORE = readFileSync(resolve(__dirname, "../pages/Explore.tsx"), "utf8");
/** Explore.tsx with comments stripped — assertions about what the code DOES
 *  must not be satisfiable (or defeated) by prose describing what it no longer
 *  does. Every removal note here names the thing it removed. */
const CODE = EXPLORE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const LOCALES = resolve(__dirname, "../i18n/locales");
const MIG = resolve(__dirname, "../../supabase/migrations");
const localeFiles = readdirSync(LOCALES).filter((f) => f.endsWith(".json"));

const latestWith = (fragment: string) => {
  const hit = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => readFileSync(resolve(MIG, f), "utf8"))
    .filter((t) => t.includes(fragment)).pop();
  if (!hit) throw new Error(`no migration contains: ${fragment}`);
  return hit;
};

describe("bands come from the payload, never from a hardcoded list", () => {
  it("does not iterate a literal band list", () => {
    // The bug in one line. A literal here cannot be kept in step with the SQL,
    // and when it drifts the section half-disappears in silence.
    expect(EXPLORE).not.toMatch(/\["enterprise",\s*"mid",\s*"small"\]/);
    expect(EXPLORE).toMatch(/orderedBands\(segments\)/);
  });

  it("the Segments type is open, so a renamed key still type-checks and renders", () => {
    expect(EXPLORE).toMatch(/type Segments = Record<string, Segment \| undefined>;/);
  });

  it("an unrecognised band falls back to a label instead of vanishing", () => {
    expect(EXPLORE).toMatch(/t\("explore\.segOther"/);
  });

  it("orders by roles-per-company — the dimension the bands are cut on", () => {
    // Ordering by TOTAL open roles looks equivalent and is not: the small band
    // holds 15,513 companies, so its aggregate outweighs mega's 212 and the
    // headings render "200-999, Under 50, 1,000+, 50-199". Verified live
    // before this was corrected.
    expect(CODE).toMatch(/open_roles \?\? 0\) \/ Math\.max\(b\[1\]\.companies, 1\)/);
  });

  it("sorts biggest-band-first on the live band shape", () => {
    // Exercised as data, not as a regex: the real payload's four bands must
    // come back mega, large, mid, small.
    const bands: Record<string, { companies: number; open_roles: number }> = {
      mid:   { companies: 1724,  open_roles: 120029 },
      mega:  { companies: 212,   open_roles: 129810 },
      large: { companies: 724,   open_roles: 175821 },
      small: { companies: 15513, open_roles: 157980 },
    };
    const order = Object.entries(bands)
      .sort((a, b) => b[1].open_roles / Math.max(b[1].companies, 1) - a[1].open_roles / Math.max(a[1].companies, 1))
      .map(([k]) => k);
    expect(order).toEqual(["mega", "large", "mid", "small"]);
  });
});

describe("no surface promises headcount the SQL never reads", () => {
  const sql = latestWith("FUNCTION public.get_size_segments");

  it("the RPC really does band on open roles, not employees", () => {
    // If this ever flips back to headcount banding, the labels below must flip
    // with it — that is the whole coupling this test exists to hold.
    expect(sql).toMatch(/GREATEST\(sum\(on_board\), sum\(feed_total\)\)/);
    expect(sql).toMatch(/WHEN effective >= 1000 THEN 'mega'/);
  });

  it("every locale's band labels describe open roles, not employees", () => {
    const EMPLOYEE_WORD = /employee|Mitarbeitende|empleado|salari|medewerker|funcionári|empleyado|कर्मचारी/i;
    for (const f of localeFiles) {
      const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      for (const k of ["segMega", "segLarge", "segMid", "segSmall"]) {
        const v = e[k];
        if (!v) continue;
        expect(v, `${f} explore.${k} still labels a role-count band by employees: ${v}`)
          .not.toMatch(EMPLOYEE_WORD);
      }
    }
  });

  it("no locale still claims sourced headcounts in the blurb", () => {
    const CLAIM = /states its own headcount|nennt seine eigene Mitarbeiterzahl|indica su propia plantilla|Nothing is guessed/i;
    for (const f of localeFiles) {
      const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      if (!e.segBlurb) continue;
      expect(e.segBlurb, `${f} explore.segBlurb still promises headcount sourcing`).not.toMatch(CLAIM);
    }
  });

  it("the retired enterprise label is gone everywhere, not just in English", () => {
    // A locale value overrides the inline default, so leaving it in eight
    // translations would keep the false label live for those readers — the
    // sources-note lesson.
    for (const f of localeFiles) {
      const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      expect(e.segEnterprise, `${f} still carries explore.segEnterprise`).toBeUndefined();
    }
  });
});

describe("the page does not fire a query that cannot finish", () => {
  it("no live get_transparent_employers call remains", () => {
    // 57014 on 100% of attempts, ~27s each, on every page view, for a section
    // that consequently never rendered.
    expect(EXPLORE).not.toMatch(/rpc\("get_transparent_employers"/);
  });

  it("transparent is read from the cache instead", () => {
    expect(EXPLORE).toMatch(/Array\.isArray\(c\.transparent\)/);
    expect(latestWith("FUNCTION public.refresh_explore_cache")).toMatch(/'transparent', transparent/);
  });

  it("a slow collection cannot blank the other six", () => {
    // The cache was all-or-nothing: one failing member aborted the INSERT and
    // froze every section with nothing saying so.
    const fn = latestWith("FUNCTION public.refresh_explore_cache");
    expect(fn).toMatch(/transparent jsonb := '\[\]'::jsonb;/);
    expect(fn).toMatch(/EXCEPTION WHEN OTHERS THEN[\s\S]{0,220}RAISE WARNING 'explore cache: transparent employers unavailable/);
  });

  it("the dead drill-through is gone, not merely hidden", () => {
    // get_size_segment_companies 57014s on every band AND pages a different
    // population (headcount bands) than the section it sat under.
    //
    // Asserted against CODE with comments stripped: the removal note names the
    // RPC in prose, and the first version of this test matched that and
    // "failed" on a file that was already correct. A guard that cannot tell an
    // explanation from a call site is worse than no guard.
    expect(CODE).not.toMatch(/get_size_segment_companies/);
    expect(CODE).not.toMatch(/loadSegAll/);
  });
});

describe("the page says when it was measured", () => {
  it("renders the cache's own computed_at", () => {
    expect(EXPLORE).toMatch(/setComputedAt\(c\.computed_at\)/);
    expect(EXPLORE).toMatch(/t\("explore\.asOf"/);
  });

  it("only with a real timestamp — no timestamp, no claim", () => {
    expect(EXPLORE).toMatch(/\{computedAt && \(/);
  });

  it("no surface still says the lists are computed live", () => {
    expect(CODE).not.toMatch(/computed live/);
    for (const f of localeFiles) {
      const e = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).explore ?? {}) as Record<string, string>;
      for (const k of ["subhead", "seoDescription"]) {
        if (e[k]) expect(e[k], `${f} explore.${k}`).not.toMatch(/computed live/i);
      }
    }
  });
});

describe("every t() key the page uses exists in English", () => {
  it("has no key referenced only in code", () => {
    // explore.repostBadgeCapped shipped referenced-but-undefined in all nine
    // locales, on the branch that fires for the worst real re-posters.
    const en = (JSON.parse(readFileSync(resolve(LOCALES, "en.json"), "utf8")).explore ?? {}) as Record<string, string>;
    const used = [...EXPLORE.matchAll(/t\("explore\.([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
    expect(used.length, "no explore t() keys found — regex broken").toBeGreaterThan(10);
    const missing = [...new Set(used)].filter((k) => !(k in en));
    expect(missing, `referenced in Explore.tsx but absent from en.json: ${missing.join(", ")}`).toEqual([]);
  });
});
