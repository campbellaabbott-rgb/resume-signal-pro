/**
 * THE REVIEW'S SMALLER FINDINGS, EACH HELD (hp-fix, 2026-10-18).
 *
 *   - The scan lede promised a report "in about 90 seconds"; the constant is
 *     a bound, not an average, and every other page says "within".
 *   - The rail's figures named a time and no day; its count is every board we
 *     read that still lists a posting, so it says that.
 *   - The homepage FAQ named one way a posting leaves the board; the sources
 *     lede on the same page names three.
 *   - The German and Tagalog rail sentence printed "Min.." (the short
 *     duration ends with a period before the sentence's own).
 *   - The AI illustration retyped the board's location as "Cambridge, MA".
 *   - Translated chip labels were cut off under text spacing (the Chip's
 *     label truncates).
 *   - The pricing title and description advertised both prices while
 *     neither was on sale, and dropped the EEA.
 *   - The Builder price typed a "$" before the number in every language.
 *   - The list call had no deadline, and a curve that missed its wait kept
 *     running.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ILLUSTRATION_LOCATION, ILLUSTRATION_PLACE } from "@/components/home/HomeAiSection";
import { HOME_H1_CLASS } from "@/lib/home/hero-classes";
import { PRO_PERK_ITEMS as WAVE_FOUR_PRO_PERKS } from "@/config/pro-perks";
import { cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: (...a: unknown[]) => rpc(...a),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import { HomeBoardRail } from "@/components/home/HomeBoardRail";
import { HomeAiSection } from "@/components/home/HomeAiSection";
import { HomeFaq } from "@/components/home/HomeFaq";
import { SampleReport } from "@/components/home/SampleReport";
import { BuilderAndLicence } from "@/components/pricing/BuilderAndLicence";
import { pricingMetaKeys } from "@/components/pricing/pricing-meta";
import { resolveSaleGates } from "@/components/pricing/sale-gates";
import { minutesText } from "@/lib/home/stamps";
import { WRAP_CHIP } from "@/lib/home/wrap-chip";
import { useHomeRows } from "@/lib/home/use-home-rows";
import { visibleProPerks } from "@/components/pricing/pro-perks-mirror";
import { displayLocation } from "@/lib/listing/location";
import { money } from "@/lib/format";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Tree = Record<string, Record<string, Record<string, string>>>;
const home = (lng: string) => (JSON.parse(readFileSync(resolve(__dirname, `../i18n/shards/home/${lng}.json`), "utf8")) as Tree).home;
const pricing = (lng: string) => (JSON.parse(readFileSync(resolve(__dirname, `../i18n/shards/pricing/${lng}.json`), "utf8")) as Tree).pricingPlans;

describe("the scan lede says within, as every other page does", () => {
  const APPROX = /\babout\b|\betwa\b|\bunos\b|\benviron\b|लगभग|ongeveer|cerca de|\bmga \{\{seconds/i;
  for (const lng of LOCALES) {
    it(lng, () => {
      expect(home(lng).scan.lede).not.toMatch(APPROX);
      expect(home(lng).scan.lede).toContain("{{seconds}}");
    });
  }
  it("en reads 'within {{seconds}} seconds'", () => {
    expect(home("en").scan.lede).toContain("within {{seconds}} seconds");
  });
});

describe("the rail names its day, and counts what it says", () => {
  for (const lng of LOCALES) {
    it(`${lng}: readBasis carries {{date}} and {{time}}`, () => {
      expect(home(lng).rail.readBasis).toContain("{{date}}");
      expect(home(lng).rail.readBasis).toContain("{{time}}");
    });
  }
  it("rendered in English: the day, and boards we read with a live posting", () => {
    const fresh = { boards: 31941, p50Min: 176, p95Min: 317, computedAt: "2026-10-18T06:45:00Z" };
    const { container } = render(<MemoryRouter><HomeBoardRail freshness={fresh} /></MemoryRouter>);
    const text = container.textContent ?? "";
    expect(text).toContain("before 18 Oct 2026, 06:45 UTC");
    expect(text).toContain("job boards we read, with a live posting");
  });
  it("no doubled full stop after a short duration (German 'Min.', Tagalog 'min.')", async () => {
    for (const lng of ["de", "tl"]) expect(minutesText(337, lng)).not.toMatch(/\.$/);
    await i18n.changeLanguage("de");
    const fresh = { boards: 31941, p50Min: 176, p95Min: 337, computedAt: "2026-10-18T06:45:00Z" };
    const { container } = render(<MemoryRouter><HomeBoardRail freshness={fresh} /></MemoryRouter>);
    await waitFor(() => expect(container.textContent ?? "").toMatch(/Std/));
    expect(container.textContent ?? "").not.toMatch(/\.\./);
  });
});

describe("the homepage FAQ names the same three exits as the sources lede", () => {
  for (const lng of LOCALES) {
    it(lng, () => {
      for (const k of ["sourcesA", "sourcesAPlain"]) expect(home(lng).faq[k], `${lng} ${k}`).toContain("{{freshDays}}");
    });
  }
  it("rendered: the window comes from BOARD_FRESH_WINDOW_DAYS", () => {
    const { container } = render(<MemoryRouter><HomeFaq counts={{}} /></MemoryRouter>);
    expect(container.textContent ?? "").toMatch(/more than \d+ days old, or when we stop reading that board/);
  });
});

describe("the AI illustration prints the board's own location", () => {
  it("as JobCard would print the row", () => {
    const { container } = render(<MemoryRouter><HomeAiSection counts={{}} openTotal={null} asOf={null} /></MemoryRouter>);
    const printed = displayLocation("US - Cambridge Kendall SQ - MA").text!;
    expect(container.querySelector("figure")?.textContent ?? "").toContain(`AstraZeneca · ${printed} · Workday`);
    expect(container.querySelector("figure")?.textContent ?? "").not.toContain("Cambridge, MA");
  });

  it("the written-out place is exactly what displayLocation prints for the stored location", () => {
    expect(ILLUSTRATION_PLACE).toBe(displayLocation(ILLUSTRATION_LOCATION).text);
  });
});

describe("a translated chip label wraps instead of being cut off", () => {
  it("the sample report's chips, the AI figure's chip and the Builder chip", () => {
    const { container } = render(
      <MemoryRouter>
        <SampleReport />
        <HomeAiSection counts={{}} openTotal={null} asOf={null} />
        <BuilderAndLicence />
      </MemoryRouter>,
    );
    const chips = [...container.querySelectorAll<HTMLElement>("span.rounded-sm.text-xs")].filter((s) => s.querySelector(":scope > span.truncate"));
    expect(chips.length).toBeGreaterThanOrEqual(8);
    for (const c of chips) expect(c.className, c.textContent ?? "").toContain(WRAP_CHIP);
  });
});

describe("a long compound word in a headline breaks instead of widening the page", () => {
  // Measured under WCAG 1.4.12 text spacing at 320 px: the German headline's
  // "Bewerbungssystemen" pushed the page 7 px sideways. Automatic hyphenation
  // fixed that but also split the owner's English headline on a 375 px phone
  // ("em-" at the end of line one) and left the reserved third line empty.
  // overflow-wrap: anywhere breaks only a word too long for a line by itself,
  // and counts toward the min-content width, so nothing else moves.
  const H1_FILES = ["../components/home/HomeSearchHero.tsx", "../components/pricing/PricingHead.tsx"];
  // The homepage's H1 takes its classes from src/lib/home/hero-classes.ts,
  // which the crawler bake writes too (so the baked headline stays the LCP).
  const h1Class = (rel: string) => {
    const src = readFileSync(resolve(__dirname, rel), "utf8");
    if (/<h1\b[^>]*className=\{HOME_H1_CLASS\}/.test(src)) return HOME_H1_CLASS;
    return src.match(/<h1\b[^>]*className="([^"]*)"/)?.[1] ?? "";
  };
  it("both pages' H1 break a word only when it cannot fit a line", () => {
    for (const rel of H1_FILES) expect(h1Class(rel), rel).toMatch(/(^|\s)\[overflow-wrap:anywhere\](\s|$)/);
  });
  it("neither H1 hyphenates an ordinary word", () => {
    for (const rel of H1_FILES) expect(h1Class(rel), rel).not.toMatch(/\bhyphens-auto\b/);
  });
});

describe("the pricing title and description follow the gates", () => {
  const TEST_SELLER = { legalName: "TEST SELLER", postalAddress: "TEST ADDRESS, NOWHERE" };
  it("nothing on sale: no price in the title or the description", () => {
    expect(pricingMetaKeys(resolveSaleGates())).toEqual({ title: "pricingPlans.meta.titleNoPro", description: "pricingPlans.meta.descriptionClosed" });
  });
  it("each open gate adds its own price, never one that is not on sale", () => {
    const fa = resolveSaleGates({ seller: TEST_SELLER, fullAnalysisDelivered: true, proWatched: false });
    const pro = resolveSaleGates({ seller: TEST_SELLER, fullAnalysisDelivered: false, proWatched: true });
    const both = resolveSaleGates({ seller: TEST_SELLER, fullAnalysisDelivered: true, proWatched: true });
    expect(pricingMetaKeys(fa)).toEqual({ title: "pricingPlans.meta.titleNoPro", description: "pricingPlans.meta.descriptionFa" });
    expect(pricingMetaKeys(pro)).toEqual({ title: "pricingPlans.meta.title", description: "pricingPlans.meta.descriptionPro" });
    expect(pricingMetaKeys(both)).toEqual({ title: "pricingPlans.meta.title", description: "pricingPlans.meta.description" });
    expect(pricingMetaKeys(resolveSaleGates({ previewOpen: true })).description, "the preview sells nothing").toBe("pricingPlans.meta.descriptionClosed");
  });
  const EEA: Record<string, RegExp> = { en: /EEA/, "en-GB": /EEA/, de: /EWR/, es: /EEE/, fr: /EEE/, hi: /EEA/, nl: /EER/, pt: /EEE/, tl: /EEA/ };
  for (const lng of LOCALES) {
    it(`${lng}: every description that sells names the EEA; the closed one names no price`, () => {
      const m = pricing(lng).meta;
      for (const k of ["description", "descriptionFa", "descriptionPro"]) expect(m[k], `${lng} ${k}`).toMatch(EEA[lng]);
      expect(m.descriptionClosed).not.toMatch(/\{\{(faPrice|proPrice)\}\}/);
      expect(m.titleNoPro).not.toMatch(/\{\{proPrice\}\}/);
    });
  }
});

describe("the Builder price is formatted the way every other price is", () => {
  for (const lng of LOCALES) {
    it(`${lng}: no typed dollar sign`, () => {
      expect(pricing(lng).b2b.builderPrice).not.toContain("$");
      expect(pricing(lng).b2b.builderPrice).toContain("{{price}}");
    });
  }
  it("rendered in German, the price reads as money() writes it", async () => {
    await i18n.changeLanguage("de");
    const { container } = render(<MemoryRouter><BuilderAndLicence /></MemoryRouter>);
    await waitFor(() => expect(container.textContent ?? "").toContain(money(49, "USD", { lng: "de" })));
    expect(container.textContent ?? "").not.toContain("$49");
  });
  it("en-GB says licence", () => {
    // The card reads /data-api's own Builder strings (switch-over step 7).
    expect((JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales/en-GB.json"), "utf8")) as { dataApiPage: Record<string, string> }).dataApiPage.builderBody).not.toMatch(/license/);
    expect(pricing("en-GB").b2b.licenceName).not.toMatch(/license/);
  });
});

describe("Pro's included Full Analysis stays hidden under wave 4's key (G2)", () => {
  // Since switch-over step 6 the card lists wave 4's PRO_PERK_ITEMS itself.
  const WAVE_FOUR = WAVE_FOUR_PRO_PERKS;
  it("closed: the line is hidden; open: it shows", () => {
    expect(visibleProPerks({ fullAnalysisOnSale: false }, WAVE_FOUR).map((p) => p.key)).not.toContain("proPlan.perks.fullAnalysisIncluded");
    expect(visibleProPerks({ fullAnalysisOnSale: true }, WAVE_FOUR).map((p) => p.key)).toContain("proPlan.perks.fullAnalysisIncluded");
  });
});

describe("the list call has a deadline, and a late curve is aborted", () => {
  it("a list call that never answers hides the list after its deadline and is aborted", async () => {
    invoke.mockReset();
    let signal: AbortSignal | undefined;
    invoke.mockImplementation((_fn: string, o?: { signal?: AbortSignal }) => {
      signal = o?.signal;
      return new Promise(() => {});
    });
    const { result } = renderHook(() => useHomeRows({ allowAutomation: true, listWaitMs: 80 }));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("hidden"), { timeout: 3000 });
    expect(signal, "the list call carries an abort signal").toBeDefined();
    expect(signal!.aborted).toBe(true);
  });

  it("a curve that misses its wait is aborted, and the rows land without stamps", async () => {
    invoke.mockReset();
    rpc.mockReset();
    const job = {
      id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme", title: "Platform Engineer",
      location: "New York, NY", postedAt: new Date(Date.now() - 86_400_000).toISOString(), recheckedAt: new Date().toISOString(),
      missingSince: null, agency: false,
    };
    invoke.mockResolvedValue({ data: { jobs: [job] }, error: null });
    let curveSignal: AbortSignal | undefined;
    rpc.mockImplementation(() => ({
      abortSignal(s: AbortSignal) { curveSignal = s; return this; },
      then(onOk: (v: unknown) => void, onErr: (e: unknown) => void) { return new Promise(() => {}).then(onOk, onErr); },
    }));
    const { result } = renderHook(() => useHomeRows({ allowAutomation: true, curveWaitMs: 60 }));
    await waitFor(() => expect(result.current.status).toBe("ready"), { timeout: 3000 });
    expect(result.current.rows[0].recheckedAt).toBeNull();
    expect(curveSignal?.aborted).toBe(true);
  });
});
