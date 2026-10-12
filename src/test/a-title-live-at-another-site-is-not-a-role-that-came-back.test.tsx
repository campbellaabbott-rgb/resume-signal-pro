/**
 * A TITLE LIVE AT ANOTHER SITE IS NOT A ROLE THAT CAME BACK (Track 1, A2).
 *
 * The collector calls a takedown re-listed when a posting with the same title
 * is live anywhere on the board when it closes. On a board that lists one
 * title at many locations every real takedown reads that way: Centria Autism
 * 2,967 "came back" against 43 down on 2026-10-11, and the came-back caution
 * fired on 81 of 1,506 sampled boards with the gate passing all of them. The
 * caution also read "Worth knowing before you invest in an application" and
 * the pane "responses may be slow", inferences about applicants from a
 * posting statistic.
 *
 * Now relistCaution asks the gate first (no caution where the count is
 * withheld: a lap-read board, an unproven read, a test that reads other
 * sites), and the sentences say what the test saw: the roles we logged, with
 * no floor word in the sentence (the approved neutral sentence of GD6 drops
 * it), while the card chip keeps its marker.
 */
import { render } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import "@/i18n";
import { relistCaution } from "@/pages/Jobs";
import { HiringRecordCard, type HiringRecordInput, type RecordCurve } from "@/components/jobs/company/HiringRecordCard";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const BASE = {
  company_token: "x", observability_bucket: "full_read", watched_from: "2026-08-01", tracking_days: 60,
  sufficient: true, dated_coverage: 0.9, multi_site_title_share: 0.05,
  fill_rate_14: 0.2, fill_rate_14_lo: 0.15, fill_rate_14_hi: 0.25, still_open_14: 0.7,
};
const CENTRIA = { ...BASE, company_token: "centriaautism", multi_site_title_share: 0.97, filled_roles_90d: 43, relisted_roles_90d: 2967 };
const SINGLE_SITE = { ...BASE, company_token: "bjakcareer", multi_site_title_share: 0, filled_roles_90d: 323, relisted_roles_90d: 708 };
const LAP = { ...BASE, company_token: "ALTEN", observability_bucket: "lap_proven", watched_from: null, filled_roles_90d: 1278, relisted_roles_90d: 2437 };

describe("the caution asks the gate first", () => {
  it("Centria-shaped: no caution, because the re-post test reads other sites", () => {
    expect(relistCaution(CENTRIA as never)).toBe(false);
  });
  it("a lap-read board: no caution, its re-post test sees one visit's window (GD5)", () => {
    expect(relistCaution(LAP as never)).toBe(false);
  });
  it("an unproven read and a row without the multi-site column: no caution", () => {
    expect(relistCaution({ ...SINGLE_SITE, observability_bucket: "lap_pending" } as never)).toBe(false);
    const { multi_site_title_share: _m, ...older } = SINGLE_SITE;
    expect(relistCaution(older as never)).toBe(false);
  });
  it("positive control: a single-site board whose roles came back keeps its caution", () => {
    expect(relistCaution(SINGLE_SITE as never)).toBe(true);
  });
});

const BARS = { growthMinRatePct: 25, growthWindowDays: 7, closedWindowDays: 90, shareDays: 14, supportDays: 30 };
const card = (curve: RecordCurve, caution: boolean) => {
  const input: HiringRecordInput = {
    curve, gated: { verdict: "unknown", withheld: null }, actively: "unknown", admitted: null, relistCaution: caution,
    growth: { verdict: "unknown", row: null, why: "x" }, bars: BARS,
  };
  return render(<HiringRecordCard input={input} />).container;
};

describe("the employer page's record card", () => {
  it("Centria-shaped: the counts are withheld with the other-sites reason and no caution renders", () => {
    const c = card({ ...CENTRIA, open_roles: 830 } as RecordCurve, relistCaution(CENTRIA as never));
    expect(c.querySelector('[data-hh-gate="relist test reads other sites"]')).not.toBeNull();
    expect(c.textContent).toContain("one job title is listed at many locations at once");
    expect(c.querySelector('[data-record="relist-caution"]')).toBeNull();
  });

  it("a single-site board's caution is the neutral sentence, with both counts and no floor word", () => {
    const c = card({ ...SINGLE_SITE, open_roles: 40 } as RecordCurve, true);
    const line = c.querySelector('[data-record="relist-caution"]')?.textContent ?? "";
    expect(line).toContain("In the last 90 days, 708 roles we watched come down here came back under the same posting or had another posting with the same title live when they came down; 323 came down and have not come back.");
  });

  it("where fills read as re-posts, the pace line counts every takedown and prints no fill interval", () => {
    const c = card({ ...CENTRIA, open_roles: 830, still_open_14: 0.55, dated_n: 400 } as RecordCurve, false);
    const pace = c.querySelector('[data-record="pace"]');
    expect(pace?.getAttribute("data-ceiling")).toBe("every takedown");
    expect(pace?.textContent).toContain("Up to 45% of its roles came down within 14 days, counting every takedown");
    expect(pace?.textContent).not.toMatch(/either way/);
  });
});

// The phrases this round removes, built from parts so no guard that reads
// files for them finds them here.
const BANNED: Array<[string, RegExp]> = [
  ["responses-slow", new RegExp(["responses", "may", "be", "slow"].join(" "), "i")],
  ["real-number-higher", new RegExp(["real", "number", "can", "be", "higher"].join(" "), "i")],
  ["worth-knowing-invest", new RegExp(["Worth", "knowing", "before", "you", "invest"].join(" "), "i")],
  ["has-no-open-roles", new RegExp(["has", "no", "open", "roles"].join(" "), "i")],
  ["recheck-live-click", new RegExp(["Re-checked", "live", "when", "you", "click", "Apply"].join(" "), "i")],
  ["re-lists-often", new RegExp(["re-lists", "roles", "often"].join(" "), "i")],
];
// The floor word each locale used before the neutral sentence, built from parts.
const FLOOR_WORDS = new RegExp([["at", "least"], ["mindestens"], ["al", "menos"], ["au", "moins"], ["कम", "से", "कम"], ["minstens"], ["pelo", "menos"], ["hindi", "bababa", "sa"]]
  .map((w) => w.join(" ")).join("|"), "i");
const LOCALES = readdirSync(resolve(ROOT, "src/i18n/locales")).filter((f) => f.endsWith(".json"));
const strings = (o: unknown, path = ""): Array<[string, string]> =>
  typeof o === "string" ? [[path, o]] : o && typeof o === "object"
    ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k)) : [];

describe("no surface says it any more", () => {
  it("no English main-locale or company-shard string carries a removed phrase", () => {
    for (const f of ["en.json", "en-GB.json"]) {
      const all = [...strings(JSON.parse(read(`src/i18n/locales/${f}`))), ...strings(JSON.parse(read(`src/i18n/shards/company/${f}`)))];
      const hits = all.flatMap(([k, v]) => BANNED.filter(([, re]) => re.test(v)).map(([n]) => `${f} ${k} (${n})`));
      expect(hits).toEqual([]);
    }
    expect(LOCALES.length).toBe(9);
  });

  it("no inline default the board, the company components or Explore render carries one", () => {
    const files = ["src/pages/Jobs.tsx", "src/pages/Explore.tsx", "src/components/jobs/company/HiringRecordCard.tsx",
      "src/components/jobs/company/CompanyHeader.tsx", "src/components/jobs/company/CompanyEmptyState.tsx"];
    const hits = files.flatMap((f) => {
      const code = codeOf(read(f));
      return BANNED.filter(([, re]) => re.test(code)).map(([n]) => `${f} (${n})`);
    });
    expect(hits).toEqual([]);
  });

  it("the translations changed with English: the re-post sentence keeps both counts and drops its floor word in every locale", () => {
    for (const f of LOCALES) {
      const jp = (JSON.parse(read(`src/i18n/locales/${f}`)) as { jobsPage: Record<string, string> }).jobsPage;
      expect(jp.repostTipRoles, `${f} repostTipRoles`).toMatch(/\{\{n\}\}[\s\S]*\{\{f\}\}|\{\{f\}\}[\s\S]*\{\{n\}\}/);
      expect(jp.repostChipFloor, `${f} repostChipFloor keeps its floor marker`).toMatch(/×\+/);
      for (const k of ["repostTipRoles", "verdictChurnFloor"]) {
        expect(jp[k], `${f} ${k} keeps {{n}}`).toMatch(/\{\{n\}\}/);
        expect(jp[k], `${f} ${k} still carries a floor word`).not.toMatch(FLOOR_WORDS);
      }
      if (!f.startsWith("en")) expect(jp.repostTipRoles, `${f} is still English`).not.toMatch(/came back under the same posting/);
    }
  });
});
