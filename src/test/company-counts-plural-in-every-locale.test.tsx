/**
 * EVERY COUNT ON THE COMPANY PAGE IS ONE PLURAL SENTENCE, IN NINE LANGUAGES.
 *
 * The answer line under every company H1 filled {{roleWord}} with the English
 * "role"/"roles" in all eight other languages ("Ja — aktuell 199 verifizierte
 * offene roles", "हाँ — अभी 847 सत्यापित खुले roles"), and printed "1943
 * offene Stellen" with no grouping (audit CP3, CP10, CP22). The company shard
 * now holds each counted sentence as one key with every plural category
 * Intl.PluralRules reports for the language (es, fr and pt need _many), and
 * the page passes the figure already grouped in the reader's language.
 *
 * Held here: the nine shard files and their identical key sets, the plural
 * categories, placeholders that match English (a translator cannot drop a
 * number), no English left in place, no digits typed into copy, the inline
 * English defaults equal to the English shard, no banned wording, and the
 * rendered answer line in German, Hindi and Spanish.
 */
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import i18n from "i18next";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { COMPANY_SHARD_LOCALES, companyShard, loadCompanyShard } from "./helpers/company-shard";
import { openRolesLine, CompanyHeader } from "@/components/jobs/company/CompanyHeader";
import { buildLanderModel, type LanderInput } from "@/lib/company/lander-model";

const ROOT = resolve(__dirname, "../..");
const MAIN = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/locales/en.json"), "utf8")) as Record<string, unknown>;
const flatten = (o: Record<string, unknown>, p = ""): Array<[string, string]> =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flatten(v as Record<string, unknown>, `${p}${k}.`) : [[`${p}${k}`, String(v)]]));
const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (k: string) => k.replace(PLURAL, "");
const placeholders = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
const shardFlat = (l: string) => new Map(flatten((companyShard(l) as { companyProfile: Record<string, unknown> }).companyProfile));
/** Placeholders a translation may use beyond English's: the component passes both forms of the name. */
const EXTRA: Record<string, string[]> = { subtitle: ["company", "companyPossessive"] };

afterAll(async () => { await i18n.changeLanguage("en"); });

describe("the company shard", () => {
  it("ships one file per locale, all nine, under the top-level key companyProfile", () => {
    expect(COMPANY_SHARD_LOCALES).toEqual(["de", "en", "en-GB", "es", "fr", "hi", "nl", "pt", "tl"]);
    for (const l of COMPANY_SHARD_LOCALES) expect(Object.keys(companyShard(l))).toEqual(["companyProfile"]);
  });

  it("every locale has the same keys as English, up to the plural categories its language uses", () => {
    const en = [...new Set([...shardFlat("en").keys()].map(base))].sort();
    expect(en.length).toBeGreaterThan(100);
    for (const l of COMPANY_SHARD_LOCALES) {
      expect([...new Set([...shardFlat(l).keys()].map(base))].sort(), `${l}: key set`).toEqual(en);
    }
  });

  it("every plural key carries exactly the categories Intl.PluralRules reports (es, fr, pt: one, many, other)", () => {
    const pluralBases = [...new Set([...shardFlat("en").keys()].filter((k) => PLURAL.test(k)).map(base))];
    expect(pluralBases.length).toBeGreaterThan(10);
    for (const l of COMPANY_SHARD_LOCALES) {
      const want = [...new Intl.PluralRules(l).resolvedOptions().pluralCategories].sort();
      const flat = shardFlat(l);
      for (const b of pluralBases) {
        const have = [...flat.keys()].filter((k) => base(k) === b && PLURAL.test(k)).map((k) => k.match(PLURAL)![1]).sort();
        expect(have, `${l} ${b}`).toEqual(want);
      }
    }
    expect([...new Intl.PluralRules("es").resolvedOptions().pluralCategories].sort()).toEqual(["many", "one", "other"]);
  });

  it("every value keeps English's placeholders, is not empty, and types no digit a placeholder should carry", () => {
    const en = shardFlat("en");
    const enOf = (k: string) => en.get(k) ?? en.get(`${base(k)}_other`) ?? "";
    for (const l of COMPANY_SHARD_LOCALES) {
      for (const [k, v] of shardFlat(l)) {
        expect(v.trim().length, `${l} ${k}: empty`).toBeGreaterThan(0);
        const want = placeholders(enOf(k));
        const allowed = new Set([...want, ...(EXTRA[k] ?? [])]);
        const have = placeholders(v);
        for (const p of have) expect(allowed.has(p), `${l} ${k}: unknown placeholder {{${p}}}`).toBe(true);
        // A counted sentence keeps its numbers: no placeholder English has may be dropped, except a name form.
        for (const p of want) if (!(EXTRA[k] ?? []).includes(p) && !/_one$/.test(k)) expect(have, `${l} ${k}: dropped {{${p}}}`).toContain(p);
        // Only the SEC form names carry digits ("8-K", "2.05"); every count is a placeholder.
        const bare = v.replace(/\{\{[^}]*\}\}/g, "").replace(/8-K|2\.05/g, "");
        expect(bare, `${l} ${k}: a digit typed into copy`).not.toMatch(/\d/);
      }
    }
  });

  it("is translated, not English left in place, outside the two English locales", () => {
    const en = shardFlat("en");
    for (const l of ["de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      const flat = shardFlat(l);
      for (const k of ["openRoles_other", "subtitle", "record.leadUnknown", "records.noProof", "agency.banner", "collision.h1", "usajobs.cap", "zero.answer"]) {
        expect(flat.get(k), `${l} ${k}: still English`).not.toBe(en.get(k));
      }
    }
  });

  it("defines no key the main locale already has, and claims nothing the house rules ban", () => {
    expect(MAIN.companyProfile, "companyProfile is the shard's namespace, not the main file's").toBeUndefined();
    for (const l of COMPANY_SHARD_LOCALES) {
      for (const [k, v] of shardFlat(l)) {
        expect(v, `${l} ${k}`).not.toMatch(/\bverified\b|\bverifiziert|\bverificad|\bvérifié|\bgeverifieerd|सत्यापित/i);
        expect(v, `${l} ${k}`).not.toMatch(/zero ghost|\bfilled\b|early applicants/i);
      }
    }
  });
});

describe("the inline English defaults are the English shard", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && !/\.test\./.test(f)) files.push(p);
    }
  };
  walk(resolve(ROOT, "src/components/jobs"));
  walk(resolve(ROOT, "src/lib/company"));
  files.push(resolve(ROOT, "src/pages/Companies.tsx"));
  const en = shardFlat("en");
  const unq = (s: string) => JSON.parse(`"${s}"`) as string;

  it("every t('companyProfile.*', default) and every plural pair matches its English value, and every English key is called", () => {
    const called = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\bt\(\s*"companyProfile\.([\w.]+)"\s*,\s*"((?:[^"\\]|\\.)*)"/g)) {
        called.add(m[1]);
        expect(en.get(m[1]), `${f}: companyProfile.${m[1]}`).toBe(unq(m[2]));
      }
      for (const m of src.matchAll(/tPlural\(\s*[^,]+,\s*"companyProfile\.([\w.]+)",[\s\S]*?"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"\s*\)/g)) {
        called.add(`${m[1]}_one`); called.add(`${m[1]}_other`);
        expect(en.get(`${m[1]}_one`), `${f}: companyProfile.${m[1]}_one`).toBe(unq(m[2]));
        expect(en.get(`${m[1]}_other`), `${f}: companyProfile.${m[1]}_other`).toBe(unq(m[3]));
      }
      for (const m of src.matchAll(/i18n\.t\(\s*"companyProfile\.([\w.]+)",\s*\{[^}]*defaultValue:\s*"((?:[^"\\]|\\.)*)"/g)) {
        called.add(m[1]);
        expect(en.get(m[1])).toBe(unq(m[2]));
      }
    }
    expect([...en.keys()].filter((k) => !called.has(k)), "English shard keys nothing renders").toEqual([]);
  });
});

describe("the answer line in three languages", () => {
  const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const input = (o: Partial<LanderInput> = {}): LanderInput => ({
    token: "clera", storedName: "Clera", bakedName: null, cachedName: null,
    listTotal: 1943, listFloor: false, feedTotal: null, feedFloor: false, feedAsOf: null,
    boardReadAt: minsAgo(46), source: "ashby", agency: false, collision: null, isUsajobs: false,
    loading: false, error: false, budgetRefusal: false, gated: { verdict: "unknown", withheld: null },
    verdict: "unknown", growth: "unknown", layoffRows: 0, visitorFilters: [], ...o,
  });

  it("German, Hindi and Spanish print their own word for roles, the grouped figure, and no English", async () => {
    loadCompanyShard();
    // Every figure carries its date now (an undated count prints no line), so
    // the count word is read off the head of the line, before " · ".
    const at = minsAgo(46);
    const head = (value: number, lng: string) => openRolesLine(i18n.t.bind(i18n), { value, floor: false, asOf: at, basis: "read" }, lng)!.split(" · ")[0];
    await i18n.changeLanguage("de");
    expect(head(1943, "de")).toBe("1.943 offene Stellen");
    expect(head(1, "de")).toBe("1 offene Stelle");
    expect(openRolesLine(i18n.t.bind(i18n), { value: 1943, floor: true, asOf: at, basis: "counted" }, "de")).toMatch(/^1\.943\+ offene Stellen · gezählt vor 46 Min/);
    await i18n.changeLanguage("hi");
    const hi = openRolesLine(i18n.t.bind(i18n), { value: 847, floor: false, asOf: at, basis: "read" }, "hi")!;
    expect(hi.split(" · ")[0]).toBe("847 खुले रोल");
    expect(hi).not.toMatch(/\broles?\b/);
    await i18n.changeLanguage("es");
    expect(head(1_000_000, "es")).toBe("1.000.000 vacantes abiertas");
    expect(head(1, "es")).toBe("1 vacante abierta");
    await i18n.changeLanguage("en");
  });

  it("the rendered header in German carries no English count word", async () => {
    loadCompanyShard();
    await i18n.changeLanguage("de");
    const { container } = render(<MemoryRouter><CompanyHeader model={buildLanderModel(input())} token="clera" system="Ashby" boardReadAt={minsAgo(46)} onWatch={() => {}} /></MemoryRouter>);
    const answer = container.querySelector("[data-company-answer]")?.textContent ?? "";
    expect(answer).toMatch(/^1\.943 offene Stellen · gelesen vor 46 Min\.?/);
    expect(answer).not.toMatch(/\broles?\b/);
    await i18n.changeLanguage("en");
  });
});
