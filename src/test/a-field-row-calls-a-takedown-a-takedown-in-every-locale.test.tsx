/**
 * A FIELD ROW CALLS A TAKEDOWN A TAKEDOWN, IN EVERY LOCALE (the fix round of
 * 2026-11-08, on GEO-1107-04).
 *
 * GEO-1107-04 retitled the Ghost Job Index's by-field table "How often roles
 * are taken down and not re-listed, by field", and its method text says a
 * takedown is never called a hire. Each row under that heading still printed
 * its figure as a fill, in hard-coded English, so every reader (and every
 * rendering crawler: the bake has no copy of this table) read a takedown
 * called a fill, and readers in the eight other locales read it in English.
 *
 * The row's three figures now come from locale keys in all nine bundles; the
 * row says what the number counts, and the banned-claims list is run over
 * the rendered rows.
 *
 * @vitest-environment jsdom
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { LISTING_BANNED_PHRASES, LOCALE_FILES, readMainLocale } from "./helpers/locale-strings";
import { codeOf } from "./helpers/strip-comments";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => stubTable(),
    functions: { invoke: async () => ({ data: null, error: null }) },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in"]) th[k] = () => th;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import GhostJobIndex from "../pages/GhostJobIndex";
import { FILL_CURVE_CACHE_KEY } from "../lib/fill-curve-cache";

vi.setConfig(MOUNT_TEST_BUDGET);
afterAll(async () => { cleanup(); await i18n.changeLanguage("en"); });

const ROOT = resolve(__dirname, "../..");
const KEYS = ["fillRowTakenDown", "fillRowRelisted", "fillRowInterval"] as const;
const PLACEHOLDERS: Record<(typeof KEYS)[number], string[]> = {
  fillRowTakenDown: ["{{pct}}", "{{days}}"],
  fillRowRelisted: ["{{pct}}"],
  fillRowInterval: ["{{lo}}", "{{hi}}", "{{n}}"],
};
const ghostKeys = (file: string) => (readMainLocale(file) as { ghostIndex?: Record<string, unknown> }).ghostIndex ?? {};
const banned = (text: string) => LISTING_BANNED_PHRASES.filter(([, re]) => re.test(text)).map(([name]) => name);

const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const GHOST = {
  total_open: 794317, total_companies: 32967, total_company_names: 32086, closed_90d: 1000,
  observed_days: 58, median_days_open: 13.8, median_days_to_close: 11, posted_coverage_pct: 99.4,
};
const FIELD = "alpha_field";
const fieldRow = {
  category: FIELD,
  n_at_risk_14: 400, fills_le_14: 120, fill_rate_14: 0.36, fill_rate_14_lo: 0.31, fill_rate_14_hi: 0.41,
  relist_rate_14: 0.17, still_open_14: 0.42, median_days_to_fill: null, median_censored: true,
  dated_coverage: 0.7, window_days: 120, sufficient: true,
};
const cache = {
  computed_at: iso(HOUR),
  ghost_stats: { ...GHOST, computed_at: iso(HOUR) },
  stale_parts: [],
  [FILL_CURVE_CACHE_KEY]: { computed_at: iso(HOUR), rows: [fieldRow] },
};

/** The rendered row for the one field, as text. */
async function fieldRowText(): Promise<string> {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_stats_cache") return { data: cache };
    if (fn === "get_ghost_job_index_stats") return { data: [GHOST] };
    return { data: fn === "get_audit_result" ? null : [] };
  });
  render(<MemoryRouter><GhostJobIndex /></MemoryRouter>);
  const name = FIELD.replace(/_/g, " ");
  await waitFor(() => expect(document.body.textContent).toContain(name), SLOW);
  const cell = [...document.querySelectorAll("span")].find((s) => s.textContent === name)!;
  return cell.parentElement!.textContent ?? "";
}

describe("the three figures of a field row are locale keys in all nine bundles", () => {
  for (const file of LOCALE_FILES) {
    it(`${file}: each key carries its placeholders and calls no takedown a fill`, () => {
      const g = ghostKeys(file);
      for (const k of KEYS) {
        const v = g[k];
        expect(typeof v, `${file} ghostIndex.${k}`).toBe("string");
        for (const p of PLACEHOLDERS[k]) expect(v as string, `${file} ${k}`).toContain(p);
        expect(banned(v as string), `${file} ${k}`).toEqual([]);
      }
    });
  }
  it("the row sentence is translated, not English, outside the two English bundles", () => {
    const en = ghostKeys("en.json").fillRowTakenDown;
    for (const file of LOCALE_FILES.filter((f) => !/^en/.test(f))) expect(ghostKeys(file).fillRowTakenDown, file).not.toBe(en);
  });
  it("the page prints the row through the keys, with no English figure typed in its code", () => {
    const code = codeOf(readFileSync(resolve(ROOT, "src/pages/GhostJobIndex.tsx"), "utf8"));
    for (const k of KEYS) expect(code).toContain(`t("ghostIndex.${k}"`);
    expect(banned(code)).toEqual([]);
  });
});

describe("the rendered row says what its number counts", () => {
  it("in English: a share taken down and not re-listed by day 14, and nothing called filled", async () => {
    const text = await fieldRowText();
    expect(text).toContain("36% taken down and not re-listed by day 14");
    expect(text).toContain("≥17% re-listed");
    expect(text).toContain("31–41% · 400 tracked");
    expect(banned(text)).toEqual([]);
    cleanup();
  });
  it("in German: the German sentence with the same figures", async () => {
    i18n.addResourceBundle("de", "translation", readMainLocale("de.json"), true, true);
    await i18n.changeLanguage("de");
    const text = await fieldRowText();
    const want = (ghostKeys("de.json").fillRowTakenDown as string).replace("{{pct}}", "36").replace("{{days}}", "14");
    expect(text).toContain(want);
    expect(text).not.toMatch(/taken down|re-listed|tracked/);
    expect(banned(text)).toEqual([]);
    cleanup();
    await i18n.changeLanguage("en");
  });
});
