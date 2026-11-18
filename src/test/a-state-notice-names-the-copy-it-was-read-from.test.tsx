/**
 * A STATE NOTICE NAMES THE COPY IT WAS READ FROM (S14X-279).
 *
 * layoff-filings reads Texas and Florida from the agencies' own files and the
 * other states from Big Local News' copy of each state's file
 * (raw.githubusercontent.com/biglocalnews/...). The read stamp and the chip's
 * tooltip said "read from {{sourceName}}" for all of them, so a Washington
 * notice claimed a read from Washington ESD that never happened.
 *
 * Now a courier state's stamp and tooltip say "from {{sourceName}} via Big
 * Local News, read {{readAgo}}"; Texas and Florida keep "read from". The
 * direct set lives in src/config/layoffs.ts, held equal to the function's
 * WARN_FEEDS by a cross-runtime guard. A notice dated by our own first read
 * (S14X-036) says so instead of "listed by {{agency}} on".
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: async () => ({ data: [] }) } }));

import "@/i18n";
import { LAYOFF_WARN_DIRECT_STATES } from "@/config/layoffs";
import { LayoffFilingChip, LayoffFilingLine, layoffLineText, layoffReadViaCourier, type LayoffFiling } from "@/components/jobs/LayoffFilingLine";

const ROOT = resolve(__dirname, "../..");

const row = (over: Partial<LayoffFiling>): LayoffFiling => ({
  companyToken: "acme", source: "state_warn", relation: "filer", filer: "Alaska Airlines",
  eventDate: "2026-10-30", eventBasis: "warn_received", publicDate: "2026-10-30", publicBasis: "state_received",
  state: "WA", site: "Seattle, Spokane, Renton", workers: 121, eventType: "layoff", effectiveDate: "2026-12-31",
  pct: null, headcount: null, form: null, sourceUrl: "https://esd.wa.gov/x", sourceName: "Washington ESD",
  readAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), moreN: 0, ...over,
});
const WA = row({});
const TX = row({ state: "TX", sourceName: "Texas Workforce Commission", sourceUrl: "https://www.twc.texas.gov/x" });
const FL = row({ state: "FL", sourceName: "Florida Commerce", sourceUrl: "https://floridajobs.org/x" });

const lineText = (r: LayoffFiling) => {
  const { container, unmount } = render(<MemoryRouter><LayoffFilingLine row={r} country="US" /></MemoryRouter>);
  const text = container.textContent ?? "";
  unmount();
  return text;
};
const tipText = (r: LayoffFiling) => {
  const { container, unmount } = render(<MemoryRouter><LayoffFilingChip row={r} country="US" /></MemoryRouter>);
  const title = container.querySelector("[data-layoff-filing=chip]")?.getAttribute("title") ?? "";
  unmount();
  return title;
};

describe("the read stamp names the copy the notice was read from", () => {
  it("a Washington notice is read via Big Local News, and its line and tooltip say so", () => {
    expect(layoffReadViaCourier(WA)).toBe(true);
    expect(lineText(WA)).toMatch(/from Washington ESD via Big Local News, read /);
    expect(lineText(WA)).not.toMatch(/read from Washington ESD/);
    expect(tipText(WA)).toMatch(/From Washington ESD via Big Local News, read /);
  });

  it("Texas and Florida are read from the agencies' own files, and keep 'read from'", () => {
    for (const r of [TX, FL]) {
      expect(layoffReadViaCourier(r), r.state!).toBe(false);
      expect(lineText(r)).toMatch(new RegExp(`read from ${r.sourceName}`));
      expect(lineText(r)).not.toMatch(/Big Local News/);
      expect(tipText(r)).not.toMatch(/Big Local News/);
    }
  });

  it("an 8-K is read from EDGAR itself and never names the courier", () => {
    expect(layoffReadViaCourier(row({ source: "sec_8k_205", state: null }))).toBe(false);
  });

  it("the direct-read set is the function's: the WARN_FEEDS states whose feed is not Big Local News' raw copy", () => {
    const code = readFileSync(resolve(ROOT, "supabase/functions/layoff-filings/index.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const block = /const WARN_FEEDS: WarnFeed\[\] = \[([\s\S]*?)\n\];/.exec(code)?.[1] ?? "";
    expect(block, "WARN_FEEDS is not where the guard reads it").not.toBe("");
    const direct = [...block.matchAll(/state: "([A-Z]{2})", feed: "([a-z_]+)"/g)].filter((m) => m[2] !== "bln_raw").map((m) => m[1]);
    expect([...direct].sort()).toEqual([...LAYOFF_WARN_DIRECT_STATES].sort());
    // Every other state is the spread of RAW_STATE_MAPS, read from the raw copy.
    expect(block).toMatch(/\.\.\.RAW_STATE_MAPS\.map\(\(m\): WarnFeed => \(\{ key: `\$\{m\.state\}:bln_raw`, state: m\.state, feed: "bln_raw", map: m \}\)\)/);
  });
});

describe("a notice dated by our own first read says so", () => {
  it("an Iowa notice with public_basis our_first_fetch prints 'first read by us on', never 'listed by' the agency", () => {
    const ia = row({
      state: "IA", filer: "Winnebago Industries", eventDate: "2026-10-09", eventBasis: "warn_notice_date",
      publicDate: "2026-11-15", publicBasis: "our_first_fetch", workers: 51, site: "605 W Crystal Lake Rd",
      sourceName: "Iowa Workforce Development", sourceUrl: "https://workforce.iowa.gov/x",
    });
    const text = lineText(ia);
    expect(text).toMatch(/first read by us on /);
    expect(text).not.toMatch(/listed by Iowa Workforce Development/);
    // Positive control: a state's own stamp is still credited to the state.
    const or = row({ state: "OR", eventBasis: "warn_notice_date", publicBasis: "state_received", sourceName: "Oregon HECC" });
    expect(lineText(or)).toMatch(/listed by Oregon HECC on /);
    const t = ((_k: string, d: string, v?: Record<string, unknown>) => d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(v?.[k] ?? ""))) as never;
    expect(layoffLineText(ia, t).text).toMatch(/first read by us on/);
  });
});

describe("the shard carries the strings in every language", () => {
  const LANGS = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];
  const KEYS = ["readVia", "tipVia", "lineWarnFirstRead", "lcaChip"];
  const shard = (l: string) => JSON.parse(readFileSync(resolve(ROOT, `src/i18n/shards/layoff-filings/${l}.json`), "utf8")) as { layoffFilings: Record<string, string> };
  const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  it("every language has every key, with the English placeholders, and names Big Local News where the English does", () => {
    const en = shard("en").layoffFilings;
    expect(Object.keys(en).sort()).toEqual([...KEYS].sort());
    expect(en.readVia).toContain("via Big Local News, read");
    for (const l of LANGS) {
      const s = shard(l).layoffFilings;
      expect(Object.keys(s).sort(), l).toEqual([...KEYS].sort());
      for (const k of KEYS) {
        expect(placeholders(s[k]), `${l}.${k}`).toEqual(placeholders(en[k]));
        if (/Big Local News/.test(en[k])) expect(s[k], `${l}.${k}`).toContain("Big Local News");
      }
      if (!l.startsWith("en")) expect(s.readVia, `${l} is English`).not.toBe(en.readVia);
    }
  });
});
