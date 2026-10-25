// @vitest-environment node
/**
 * THE SEARCH EXCLUSION IS ORIGIN/MAIN'S, BYTE FOR BYTE (wave 4 descope,
 * 2026-10-25; S12-017 left wave 4 and is its own search project).
 *
 * WHAT WAS WRONG. The descope at 27e54375 put origin/main's titleExcluded back
 * but kept rounds 3 and 4's splitExclusions and cleanTerms, and the recheck of
 * that mix found it worse than origin/main on realistic queries:
 *   - a slash pair of single letters after "not" or "-" excluded nothing:
 *     "clerk not a/p" searched the whole text, so the page served the A/P
 *     titles the person excluded (main excludes "ap" and searches "clerk");
 *   - a slash pair that names one thing was split into common words:
 *     "technician not med/surg" excluded "med" and "surg" and struck "Certified
 *     Med Tech"; "engineer not tcp/ip" struck "IP Engineer" (main joins the pair
 *     and strikes neither);
 *   - a pinned compound typed with a space or as a plural was excluded whole
 *     and matched only as typed: "cashier not part time" kept "Cashier
 *     (Part-Time)", "nurse not night shifts" kept "Night Shift RN", titles main
 *     strikes through its one-word exclusion.
 * The owner's rule for a heuristic that fails its corpus-first recheck is to
 * put main's behaviour back. So the exclusion section of search-routing.ts is
 * origin/main's text exactly, nothing else in that file or in job-board's
 * handler reads an exclusion differently from main, and the board's banner
 * says only what main's rule does: it strikes a title holding the excluded
 * word as typed.
 *
 * ORIGIN_MAIN is origin/main's section at ef4fb53e, frozen in
 * fixtures/w4b-fix3-search/origin-main-exclusion.ts.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as SHIPPED from "../../supabase/functions/job-board/search-routing";
import * as ORIGIN_MAIN from "./fixtures/w4b-fix3-search/origin-main-exclusion";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const MARK = '/**\n * "engineer not manager" WAS RETURNING MANAGERS.';
const section = (text: string) => { const i = text.indexOf(MARK); return i < 0 ? "" : text.slice(i); };

describe("the shipped exclusion code is origin/main's", () => {
  const shipped = read("supabase/functions/job-board/search-routing.ts");
  const frozen = read("src/test/fixtures/w4b-fix3-search/origin-main-exclusion.ts");

  it("search-routing.ts's exclusion section, from the 'engineer not manager' note to the end of the file, is origin/main's text", () => {
    expect(section(frozen).length).toBeGreaterThan(3000);
    expect(section(shipped) === section(frozen), "the exclusion section differs from origin/main ef4fb53e").toBe(true);
  });

  it("nothing before that section reads an exclusion: no import, no pinned compound or place list, no other exclusion export", () => {
    const before = shipped.slice(0, shipped.indexOf(MARK));
    expect(before).not.toMatch(/^import /m);
    expect(before).not.toMatch(/splitExclusions|titleExcluded|cleanExcluded|cleanTerms|NOT_COMPOUNDS|NEGATED_PLACES|compoundAt|placeAfterNot/);
    const mod = SHIPPED as Record<string, unknown>;
    expect(mod.NOT_COMPOUNDS).toBeUndefined();
    expect(mod.NEGATED_PLACES).toBeUndefined();
  });

  it("job-board's handler calls the exclusion exactly where and as origin/main's does", () => {
    const callLines = (text: string) => text.split("\n").filter((l) => /splitExclusions\(|titleExcluded\(|exclusion\.(?:positive|excluded)/.test(l)).map((l) => l.trim()).sort();
    // origin/main ef4fb53e's lines, verbatim.
    expect(callLines(read("supabase/functions/job-board/index.ts"))).toEqual([
      "!(excludedTerms.length && titleExcluded(String(r.title ?? \"\"), excludedTerms)));",
      "? jobs.filter((j) => !titleExcluded(String((j as { title?: unknown }).title ?? \"\"), excluded))",
      "? won.rows.filter((r) => !titleExcluded(String(r.title ?? \"\"), excludedTerms))",
      ".filter((r) => !(excludedTerms.length && titleExcluded(String(r.title ?? \"\"), excludedTerms)));",
      "const exclusion = splitExclusions(String(body.q ?? \"\"));",
      "const excludedTerms = exclusion.excluded;",
      "if (excludedTerms.length) body = { ...body, q: exclusion.positive };",
    ].sort());
  });
});

type Out = { positive: string; excluded: string[] };
/** The recheck's cases: each query with origin/main's answer, and titles with whether main strikes them. */
const RECHECK: Array<[string, Out, Array<[string, boolean]>]> = [
  // Single-letter slash pairs: main joins the pair and searches the head.
  ["clerk not a/p", { positive: "clerk", excluded: ["ap"] }, [["AP Clerk", true], ["Clerk", false], ["Admin Clerk (A/P)", false]]],
  ["clerk -a/p", { positive: "clerk", excluded: ["ap"] }, [["AP Clerk", true]]],
  ["clerk not -a/p", { positive: "clerk", excluded: ["ap"] }, [["AP Clerk", true]]],
  ["accountant not a/r", { positive: "accountant", excluded: ["ar"] }, [["AR Accountant", true]]],
  ["accountant not a/r Dallas", { positive: "accountant Dallas", excluded: ["ar"] }, [["AR Accountant", true]]],
  ["cashier not p/t", { positive: "cashier", excluded: ["pt"] }, [["Cashier - PT", true], ["Cashier", false]]],
  ["nurse not f/t", { positive: "nurse", excluded: ["ft"] }, [["Nurse - FT", true]]],
  ["nurse not l/d", { positive: "nurse", excluded: ["ld"] }, [["LD Nurse", true]]],
  ["rep not a/p or a/r", { positive: "rep or a/r", excluded: ["ap"] }, [["AP Rep", true]]],
  // Slash pairs that name one thing: main's joined token strikes no title holding one half.
  ["technician not med/surg", { positive: "technician", excluded: ["medsurg"] }, [["Certified Med Tech", false], ["Nuclear Med Tech", false],
    ["Certified Med Tech- Per Diem", false], ["Nuclear Med Tech - Per Diem", false], ["Med Tech (Certified) Per diem", false]]],
  ["nurse not med/surg", { positive: "nurse", excluded: ["medsurg"] }, [["Med Spa Nurse", false]]],
  ["engineer not tcp/ip", { positive: "engineer", excluded: ["tcpip"] }, [["IP Engineer", false]]],
  // Compounds typed with a space or as a plural: main excludes the first word, so every spelling of it is struck.
  ["cashier not part time", { positive: "cashier time", excluded: ["part"] }, [["Cashier (Part-Time)", true], ["Cashier - Idlewild - Part-Time", true],
    ["Cashier (Full-Time & Part-Time)", true], ["Part Time Cashier", true]]],
  ["teacher not full time", { positive: "teacher time", excluded: ["full"] }, [["Teacher - Full-Time", true]]],
  ["nurse not night shifts", { positive: "nurse shifts", excluded: ["night"] }, [["Night Shift RN", true]]],
  ["worker not night shifts", { positive: "worker shifts", excluded: ["night"] }, [["Night Shift Worker", true], ["Worker (Night-Shift)", true], ["Worker - Night Shifts", true]]],
  ["driver not box trucks", { positive: "driver trucks", excluded: ["box"] }, [["Box Truck Driver", true]]],
  ["agent not call centers", { positive: "agent centers", excluded: ["call"] }, [["Call Center Agent", true]]],
  ["rep not customer service", { positive: "rep service", excluded: ["customer"] }, [["Customer Services Rep", true]]],
  ["nurse not entry level", { positive: "nurse level", excluded: ["entry"] }, [["Entry-Level Nurse", true]]],
  ["nurse not per diem", { positive: "nurse diem", excluded: ["per"] }, [["Per-Diem Nurse", true]]],
  ["driver not long haul", { positive: "driver haul", excluded: ["long"] }, [["Long-Haul Driver", true]]],
  ["developer not team lead", { positive: "developer lead", excluded: ["team"] }, [["Team-Lead Developer", true]]],
  ["nurse not new grad", { positive: "nurse grad", excluded: ["new"] }, [["New-Grad Nurse", true]]],
  ["aide not home health", { positive: "aide health", excluded: ["home"] }, [["Home-Health Aide", true]]],
  ["technician not help desk", { positive: "technician desk", excluded: ["help"] }, [["Help-Desk Technician", true]]],
  ["chef not line cook", { positive: "chef cook", excluded: ["line"] }, [["Line-Cook Chef", true]]],
  // A typed hyphen is folded away, as main does: "parttime" strikes the run-together title only.
  ["barista not part-time", { positive: "barista", excluded: ["parttime"] }, [["Parttime Barista", true], ["Part-Time Barista", false]]],
  // A plural typed word strikes only itself; a single word never strikes a different job word.
  ["producer not news", { positive: "producer", excluded: ["news"] }, [["New Grad Producer", false], ["News Producer", true]]],
  ["driver not parts", { positive: "driver", excluded: ["parts"] }, [["Part-Time Driver", false]]],
  ["manager not account", { positive: "manager", excluded: ["account"] }, [["Accounts Payable Manager", false], ["Account Manager", true]]],
  ["administrator not contract", { positive: "administrator", excluded: ["contract"] }, [["Contracts Administrator", false]]],
  // The guards that keep a query from being eaten.
  ["director not for profit", { positive: "director not for profit", excluded: [] }, []],
  ["not manager", { positive: "not manager", excluded: [] }, []],
  ["not night shift", { positive: "shift", excluded: ["night"] }, [["Night Shift RN", true]]],
  ["engineer not manager", { positive: "engineer", excluded: ["manager"] }, [["Engineering Manager", true], ["Management Consultant", false]]],
];

describe("every case the recheck of the descope named is answered as origin/main answers it", () => {
  it.each(RECHECK)("%s", (q, mainAnswer, titles) => {
    expect(ORIGIN_MAIN.splitExclusions(q), "the pinned answer is origin/main's").toEqual(mainAnswer);
    const got = SHIPPED.splitExclusions(q);
    expect(got).toEqual(mainAnswer);
    for (const [t, strikes] of titles) {
      expect(ORIGIN_MAIN.titleExcluded(t, mainAnswer.excluded), `origin/main on ${t}`).toBe(strikes);
      expect(SHIPPED.titleExcluded(t, got.excluded), t).toBe(strikes);
    }
  });
});

describe("the board's banner says only what main's rule does", () => {
  const LANGS = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
  // The word for a job's title in each language: the banner names the title, the one place the rule looks.
  const TITLE_WORD: Record<(typeof LANGS)[number], RegExp> = {
    en: /\btitle\b/i, "en-GB": /\btitle\b/i, de: /Titel/, es: /título/i, fr: /titre/i, hi: /शीर्षक/, nl: /titel/i, pt: /título/i, tl: /pamagat/i,
  };
  it.each(LANGS)("%s: jobsPage.excludedTerms names the title and keeps {{terms}}", (lang) => {
    const s = JSON.parse(read(`src/i18n/locales/${lang}.json`)).jobsPage.excludedTerms as string;
    expect(s).toContain("{{terms}}");
    expect(s, s).toMatch(TITLE_WORD[lang]);
    expect(s, "it must not claim to hide every result that mentions the words").not.toMatch(/\bmention/i);
  });
});
