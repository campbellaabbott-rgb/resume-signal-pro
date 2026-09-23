/**
 * A PANEL NOBODY MOUNTS IS A PANEL THAT DOES NOT EXIST — AND A MENU ENTRY
 * NOBODY SERVES IS WORSE THAN NO ENTRY AT ALL.
 *
 * WHAT THIS GUARDS. Two things that meet in src/pages/Jobs.tsx, and both of
 * them are failures of WIRING rather than of logic — the class no unit test in
 * a component's own file can see, because a component with a perfect test
 * suite and no caller ships as an empty screen.
 *
 *   1. THE TWO NEW EVIDENCE SLOTS ARE ACTUALLY RENDERED. The filed-wage line
 *      and the Ontario disclosure panel were each built with their own reader,
 *      their own bars and their own guards, and neither was imported anywhere.
 *      Both render null until a qualifying row arrives, which is the right
 *      behaviour and also the reason an unmounted one is invisible: nothing
 *      about a page that never calls them looks broken.
 *
 *   2. THE VENDOR MENU OFFERS ONLY SOURCES THE BOARD SERVES. Measured
 *      2026-09-23 against the board's own per-source facet and its
 *      date-coverage rollup, which agreed exactly: nineteen sources have rows
 *      and the twentieth has none, because its secrets are not set. It sat in
 *      the menu anyway, so choosing it filtered the board to an empty page —
 *      a control that answers a question about the market when it was really
 *      answering a question about our configuration.
 *
 * THE ASYMMETRY IS THE POINT, and it is asserted in both directions. The menu
 * and the "Sources:" sentence read the SERVING set; the source LABEL map reads
 * every carried entry. Narrowing the label map with the menu would break a
 * ?source= link shared before a source went dormant — the row would lose its
 * vendor name and fall back to the un-named badge, which is the same defect
 * pointing the other way.
 *
 * HOW IT IS CHECKED. The menu half runs the SHIPPED builder over real inputs
 * rather than pinning its spelling: a guard that pins an identifier passes
 * happily over dead code, which this repo has shipped several times. The mount
 * half necessarily reads source text, so it reads it COMMENT-STRIPPED — a
 * docblock that explains which component a page mounts contains that
 * component's name, and a guard matching the name would be satisfied by the
 * explanation while the page rendered nothing.
 *
 * TEETH. Every assertion below is shown failing on a copy of the thing it
 * guards: a menu built from the carried list instead of the serving one, a
 * label map narrowed to the serving list, a page with the mount deleted, a
 * page that mounts the Ontario panel without handing it the posting's URL, and
 * a page that invents an occupation code instead of passing null.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vendorOptionsWithCounts, sourceLabel } from "../pages/Jobs";
import {
  ALL_BOARD_SOURCES,
  SERVING_SOURCES,
  SERVING_SOURCE_KEYS,
  DORMANT_SOURCES,
} from "../config/ats-vendors";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/**
 * Comments removed. JSX comment braces first, or the closing brace survives as
 * code and the next block comment swallows real markup with it.
 */
const code = (s: string) =>
  s
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/[^\n]*/gm, " ");

const JOBS = code(read("src/pages/Jobs.tsx"));

// ── the menu, exercised rather than spelled ─────────────────────────────────

describe("the vendor menu offers what the board serves, and nothing else", () => {
  it("is not vacuous: there is something marked dormant to be kept out", () => {
    expect(DORMANT_SOURCES.length, "nothing is dormant — re-anchor this file").toBeGreaterThan(0);
    expect(SERVING_SOURCES.length).toBeGreaterThan(10);
  });

  it("offers every serving source", () => {
    const offered = vendorOptionsWithCounts(null).map((o) => o.value);
    for (const key of SERVING_SOURCE_KEYS) expect(offered, `${key} is not offered`).toContain(key);
  });

  it("offers no source the board serves nothing from", () => {
    const offered = vendorOptionsWithCounts(null).map((o) => o.value);
    for (const d of DORMANT_SOURCES) {
      expect(offered, `${d.key} serves no rows and is still selectable`).not.toContain(d.key);
    }
    expect(offered).toHaveLength(SERVING_SOURCES.length);
  });

  it("a count arriving for a dormant source does not put it back in the menu", () => {
    // The facet is keyed by the source string, so a stray or stale entry for a
    // dormant vendor would be the one input that could resurrect it. The
    // builder maps over the option set, not over the facet, and this proves it.
    const facet = Object.fromEntries(DORMANT_SOURCES.map((d) => [d.key, 5_000]));
    const offered = vendorOptionsWithCounts(facet).map((o) => o.value);
    for (const d of DORMANT_SOURCES) expect(offered).not.toContain(d.key);
  });

  it("the label map keeps every carried source, dormant ones included", () => {
    // Deliberately wider than the menu: an existing ?source= link, and any row
    // already in a cached page, must still print the vendor's own name.
    for (const v of ALL_BOARD_SOURCES) {
      expect(sourceLabel(v.key), `${v.key} lost its label`).toBe(v.label);
    }
    expect(sourceLabel("not-a-vendor")).toBeNull();
  });
});

// ── the mounts ──────────────────────────────────────────────────────────────

/**
 * The one JSX element that mounts `name`, with its props, or null.
 *
 * ANCHORED ON THE ELEMENT'S OWN CLOSE. The lazy `[\s\S]*?/>` this used to be
 * ran forward to the NEXT `/>` anywhere in a 7,500-line file the moment the
 * element lost its self-close, and returned a block that still contained the
 * prop text every assertion here looks for — so a mount rewritten as
 * `<Name ...></Name>` kept the guard green while nothing about the mount had
 * been checked. `[^>]*` cannot leave the tag.
 */
function mountOf(src: string, name: string): string | null {
  const m = new RegExp(`<${name}\\b[^>]*/>`).exec(src);
  return m ? m[0] : null;
}

/**
 * Is the mount a sibling of the panel's other lines, or is it behind a
 * condition this page decides?
 *
 * BOTH COMPONENTS RENDER NULL UNTIL THEIR OWN READER QUALIFIES A ROW, which
 * is the whole design: the decision lives with the reader that has the
 * evidence, never with the page. `{someFlag && <Name … />}` satisfies every
 * other assertion in this file while showing nobody anything, and an absence
 * is exactly what nothing about the page looks like.
 */
function mountIsUnconditional(src: string, name: string): boolean {
  const at = src.indexOf(`<${name}`);
  if (at < 0) return false;
  const before = src.slice(0, at).replace(/\s+$/, "");
  return !/(?:&&|\|\||\?|:)$/.test(before);
}

describe("the board's detail panel mounts the evidence it was given", () => {
  it("imports and renders the filed-wage line", () => {
    expect(JOBS).toMatch(/import \{ LcaFiledWagesLine \} from "@\/components\/jobs\/LcaFiledWagesLine"/);
    expect(mountOf(JOBS, "LcaFiledWagesLine"), "built and never mounted").toBeTruthy();
  });

  it("imports and renders the Ontario disclosure panel", () => {
    expect(JOBS).toMatch(/import \{ OntarioEsaDisclosures \} from "@\/components\/jobs\/OntarioEsaDisclosures"/);
    expect(mountOf(JOBS, "OntarioEsaDisclosures"), "built and never mounted").toBeTruthy();
  });

  it("hands the Ontario panel the posting's own id and apply URL", () => {
    // postingUrl comes from the CALLER on purpose. The reader does not return
    // an apply URL, so that an anon-callable RPC cannot be walked to
    // reconstitute the corpus — which means a mount that forgets the prop is a
    // panel whose "read it yourself" link goes nowhere.
    const el = mountOf(JOBS, "OntarioEsaDisclosures")!;
    expect(el).toMatch(/postingId=\{detailJob\.id\}/);
    expect(el).toMatch(/postingUrl=\{detailJob\.applyUrl\}/);
  });

  it("hands the filed-wage line the employer, and states no occupation it does not have", () => {
    // NOTHING ON A POSTING CARRIES AN OCCUPATION CODE, and nothing carries a
    // worksite subdivision. Passing null is the honest input: the reader then
    // answers the employer's largest cell and the copy names which occupation
    // that is. A guess derived from the title or the free-text location would
    // make the line state an occupation the data never said.
    const el = mountOf(JOBS, "LcaFiledWagesLine")!;
    expect(el).toMatch(/companyToken=\{detailJob\.token/);
    expect(el).toMatch(/companyName=\{companyDisplayName\(detailJob\.company\)\}/);
    expect(el).toMatch(/socCode=\{null\}/);
    expect(el).toMatch(/worksiteState=\{null\}/);
  });

  it("mounts both unconditionally, so the decision stays with the reader that has the evidence", () => {
    for (const name of ["LcaFiledWagesLine", "OntarioEsaDisclosures"]) {
      expect(mountIsUnconditional(JOBS, name), `${name} is mounted behind a condition this page decides`).toBe(true);
    }
  });

  it("puts both under the employer-record line, not among the facts of the job", () => {
    // Order is the claim. These are statements about the EMPLOYER's record
    // from named government files; the <dl> below them is what this posting
    // says. A filed wage that drifted into the pay row would read as this
    // role's pay, which is the one thing the line says it is not.
    const filing = JOBS.indexOf("<LayoffFilingLine");
    const lca = JOBS.indexOf("<LcaFiledWagesLine");
    const esa = JOBS.indexOf("<OntarioEsaDisclosures");
    const facts = JOBS.indexOf("jobsPage.factPay");
    expect(filing).toBeGreaterThan(-1);
    expect(facts).toBeGreaterThan(-1);
    expect(lca, "the filed-wage line is not in the panel's evidence run").toBeGreaterThan(filing);
    expect(esa, "the Ontario panel is not in the panel's evidence run").toBeGreaterThan(filing);
    expect(lca, "the filed-wage line drifted into the facts list").toBeLessThan(facts);
    expect(esa, "the Ontario panel drifted into the facts list").toBeLessThan(facts);
  });
});

// ── teeth ───────────────────────────────────────────────────────────────────

describe("teeth: each property fails on a copy with the property removed", () => {
  it("a menu built from the carried list offers the dormant source", () => {
    // This is the exact expression the menu used to be built from.
    const carried = ALL_BOARD_SOURCES.map((v) => ({ value: v.key, label: v.label }));
    for (const d of DORMANT_SOURCES) {
      expect(carried.map((o) => o.value), `${d.key} should reappear on the old builder`).toContain(d.key);
      expect(vendorOptionsWithCounts(null).map((o) => o.value)).not.toContain(d.key);
    }
  });

  it("a label map narrowed to the serving list loses the dormant name", () => {
    const narrowed = Object.fromEntries(SERVING_SOURCES.map((v) => [v.key, v.label]));
    for (const d of DORMANT_SOURCES) {
      expect(narrowed[d.key], `${d.key} should have no label once the map is narrowed`).toBeUndefined();
      expect(sourceLabel(d.key)).toBe(d.label);
    }
  });

  it("a page with the mount deleted is reported", () => {
    for (const name of ["LcaFiledWagesLine", "OntarioEsaDisclosures"]) {
      const without = JOBS.replace(new RegExp(`<${name}\\b[\\s\\S]*?/>`), " ");
      expect(mountOf(without, name), `${name} still found after deleting its mount`).toBeNull();
      expect(mountOf(JOBS, name)).toBeTruthy();
    }
  });

  it("a mount that only appears in a comment is reported", () => {
    // The failure this repo has shipped several times: the guard's literal
    // written into the docblock that explains the guard.
    const commentedOut = `
      // The panel goes here: <OntarioEsaDisclosures postingId={detailJob.id} postingUrl={detailJob.applyUrl} />
      /* and here too: <LcaFiledWagesLine companyToken={detailJob.token} /> */
      {/* and in JSX: <LcaFiledWagesLine companyToken={detailJob.token} /> */}
    `;
    expect(mountOf(code(commentedOut), "OntarioEsaDisclosures")).toBeNull();
    expect(mountOf(code(commentedOut), "LcaFiledWagesLine")).toBeNull();
  });

  it("a panel mounted without the posting's URL is reported", () => {
    const el = "<OntarioEsaDisclosures postingId={detailJob.id} />";
    expect(/postingUrl=\{detailJob\.applyUrl\}/.test(el)).toBe(false);
    expect(/postingUrl=\{detailJob\.applyUrl\}/.test(mountOf(JOBS, "OntarioEsaDisclosures")!)).toBe(true);
  });

  it("a line handed a guessed occupation or state is reported", () => {
    const guessed = '<LcaFiledWagesLine companyToken={detailJob.token ?? ""} companyName={companyDisplayName(detailJob.company)} socCode={socFromTitle(detailJob.title)} worksiteState={detailJob.location} />';
    expect(/socCode=\{null\}/.test(guessed)).toBe(false);
    expect(/worksiteState=\{null\}/.test(guessed)).toBe(false);
    const shipped = mountOf(JOBS, "LcaFiledWagesLine")!;
    expect(/socCode=\{null\}/.test(shipped)).toBe(true);
    expect(/worksiteState=\{null\}/.test(shipped)).toBe(true);
  });

  it("a mount that lost its self-close is reported, not read as the next element", () => {
    // THE SILENT PASS. With the old lazy anchor, `<Name …></Name>` made the
    // matcher run to the next `/>` anywhere in the file and hand back a block
    // that still contained the prop text — so every prop assertion passed
    // over a mount nobody had checked.
    const rewritten = JOBS.replace(
      /<OntarioEsaDisclosures\b([^>]*)\/>/,
      "<OntarioEsaDisclosures$1></OntarioEsaDisclosures>",
    );
    expect(rewritten, "the mutation did not apply — RE-ANCHOR this tooth").not.toBe(JOBS);
    expect(mountOf(rewritten, "OntarioEsaDisclosures"), "a non-self-closing mount was read as some other element").toBeNull();
    expect(mountOf(JOBS, "OntarioEsaDisclosures")).toBeTruthy();
  });

  it("a mount hidden behind a condition is reported", () => {
    const hidden = JOBS.replace("<LcaFiledWagesLine", "{showFiledWages && <LcaFiledWagesLine");
    expect(hidden, "the mutation did not apply — RE-ANCHOR this tooth").not.toBe(JOBS);
    expect(mountIsUnconditional(hidden, "LcaFiledWagesLine"), "a conditional mount went unreported").toBe(false);
    expect(mountIsUnconditional(JOBS, "LcaFiledWagesLine")).toBe(true);
    // ...and a ternary arm is caught too.
    expect(mountIsUnconditional('const x = ok ? <LcaFiledWagesLine companyToken={t} /> : null;', "LcaFiledWagesLine")).toBe(false);
  });

  it("an evidence slot moved below the facts list is reported", () => {
    const facts = JOBS.indexOf("jobsPage.factPay");
    const moved = JOBS.replace(/<OntarioEsaDisclosures\b[\s\S]*?\/>/, " ") + "\n<OntarioEsaDisclosures postingId={detailJob.id} postingUrl={detailJob.applyUrl} />";
    expect(moved.indexOf("<OntarioEsaDisclosures"), "the moved copy should sit after the facts").toBeGreaterThan(facts);
    expect(JOBS.indexOf("<OntarioEsaDisclosures")).toBeLessThan(facts);
  });
});
