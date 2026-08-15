/**
 * THE AGENT IS THE HALLMARK, AND ITS CLAIMS ARE MEASURED OR ABSENT.
 *
 * The homepage used to open with the board and follow with the agent as a
 * brochure — four static cards, third person. The rebuild makes the agent the
 * first section, speaking in the first person, holding live inventory, and —
 * after a scan — acting on the visitor's own CV with real sendable postings.
 *
 * Two failure classes these tests exist to block, both paid for before:
 *
 *   CLAIM DRIFT — a hardcoded inventory number ("35,000 jobs I can apply to")
 *   goes false the day the catalog moves. Every number the hero or the
 *   matches panel renders must come from a payload, and absence must render
 *   as absence, never as zero and never as yesterday's figure.
 *
 *   THE SILENTLY-DROPPED FILTER — the panel's "browse all" link must carry
 *   the parameter Jobs.tsx actually reads (`agentOnly=1`). The first draft
 *   shipped `agent=1`, which Jobs ignores: the button would have promised the
 *   agent's inventory and delivered the unfiltered board.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HERO = readFileSync(resolve(__dirname, "../components/HomeHero.tsx"), "utf8");
const PANEL = readFileSync(resolve(__dirname, "../components/AgentMatchesPanel.tsx"), "utf8");
const INDEX = readFileSync(resolve(__dirname, "../pages/Index.tsx"), "utf8");
const JOBS = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const heroCode = strip(HERO);
const panelCode = strip(PANEL);
const indexCode = strip(INDEX);

describe("the agent opens the page", () => {
  it("is ONE hero, not two stacked ones", () => {
    // Two full-height heroes put 6,807px and four competing CTAs between a
    // visitor and any action; the upload tool — the only path to a paying
    // customer — began at 10,546px. Consolidated 2026-08-13 to 3,903px.
    expect(indexCode, "HomeHero is not on the page").toMatch(/<HomeHero \/>/);
    expect(indexCode, "the second stacked hero is back").not.toMatch(/<JobBoardHero \/>/);
    expect(indexCode, "the old agent hero is back alongside HomeHero").not.toMatch(/<AgentHero \/>/);
  });

  it("offers exactly one primary action", () => {
    // Two equally-loud gradient buttons is the choice paralysis this hero
    // exists to remove: the secondary is border-weight, never a second
    // gradient fill.
    // Counted on FILLED interactive elements only. A first version matched
    // `bg-gradient-to-r from-primary` anywhere and failed on the headline's
    // own text gradient — the assertion has to distinguish a painted button
    // from painted words, which is exactly the distinction it is about.
    const filled = (heroCode.match(/className="[^"]*\bbg-gradient-to-r from-primary[^"]*text-primary-foreground[^"]*"/g) ?? []).length;
    expect(filled, "a second primary-weight CTA is back in the hero").toBe(1);
    // ...and the secondary is border-weight, not a second fill.
    expect(heroCode).toMatch(/ctaSecondary[\s\S]{0,80}|border border-border bg-card\/60/);
  });

  it("puts the platform proof inside the hero, under the action", () => {
    const ctaAt = heroCode.indexOf("ctaPrimary");
    const stripAt = heroCode.indexOf('<AtsCoverage variant="strip" />');
    expect(stripAt, "the hero lost the platform strip").toBeGreaterThan(-1);
    expect(ctaAt).toBeLessThan(stripAt);
  });

  it("replaced the brochure, not doubled it", () => {
    expect(indexCode, "the old static showcase renders alongside the hero")
      .not.toMatch(/<ApplyAgentShowcase/);
  });

  it("speaks with measured inventory or with none", () => {
    // The line renders only when BOTH numbers arrived; no fallback figures.
    // Each stat renders only when its own payload arrived.
    expect(heroCode).toMatch(/\{totals && \(/);
    expect(heroCode).toMatch(/\{sendable !== null && \(/);
    // Payload gating: a number must be > 0 to be trusted — a zero from a
    // half-written status payload must read as absence, not "0 openings".
    expect(heroCode).toMatch(/typeof n === "number" && n > 0/);
    // And no literal inventory anywhere: five-or-more-digit numbers in the
    // hero are claims only a payload may make.
    expect(heroCode.replace(/\d{1,2}\b/g, "")).not.toMatch(/\b\d{3,}(?:,\d{3})*\b/);
  });

  it("its one action targets the uploader anchor that exists", () => {
    const anchor = /data-scan-button="true"/;
    expect(HERO).toMatch(anchor);
    // The anchor must actually exist somewhere in the app, or the CTA is a
    // no-op — checked against the codebase rather than assumed.
    const uploader = readFileSync(resolve(__dirname, "../components/ResumeUploader.tsx"), "utf8");
    expect(uploader, "the uploader lost its data-scan-button anchor").toMatch(/data-scan-button/);
  });
});

describe("the matches panel acts on the CV and only on real data", () => {
  it("asks for sendable postings only", () => {
    expect(panelCode).toMatch(/sendableOnly: true/);
  });

  it("renders absence on empty or error, never a shell", () => {
    expect(panelCode).toMatch(/if \(rows\.length === 0\) return;/);
    expect(panelCode).toMatch(/if \(!jobs\) return null;/);
  });

  it("caps its count claim exactly as the server capped it", () => {
    expect(panelCode).toMatch(/capped \? "\+" : ""/);
    expect(panelCode).toMatch(/d\.countCapped === true/);
  });

  it("links to the board with the parameter Jobs actually reads", () => {
    expect(panelCode).toMatch(/agentOnly=1/);
    expect(JOBS, "Jobs.tsx no longer reads agentOnly — the panel's link silently drops its filter")
      .toMatch(/get\("agentOnly"\)/);
  });

  it("mounts only after a scan, fed by the scan's own extraction", () => {
    const at = indexCode.indexOf("<AgentMatchesPanel");
    expect(at, "the panel is not wired into the results screen").toBeGreaterThan(-1);
    const ctx = indexCode.slice(at, at + 300);
    expect(ctx).toMatch(/currentRole=\{freeKeywordResult\.currentRole\}/);
    expect(ctx).toMatch(/freeKeywordResult\.keywords/);
  });

  it("searches only with a credible key", () => {
    // Under 3 characters of extracted signal, no query fires and no panel
    // renders — an empty-string search would return the whole board and
    // present it as a personal match.
    expect(panelCode).toMatch(/if \(query\.length < 3\) return;/);
  });
});

describe("the front page states one subject and no frozen totals", () => {
  const HERO_C = readFileSync(resolve(__dirname, "../components/Hero.tsx"), "utf8");
  const BOARD = readFileSync(resolve(__dirname, "../components/JobBoardHero.tsx"), "utf8");
  const stripCode = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

  it("exactly one h1 renders in every page state", () => {
    // Three rendered h1s is a hierarchy a screen reader cannot navigate and
    // three competing subjects to a crawler. But ZERO is worse, and that is
    // what a first pass shipped: Hero's h1 was demoted while HomeHero owned
    // it, and HomeHero is gated on `!landing && !freeKeywordResult` — so the
    // landing variants and the post-scan screen rendered with no h1 at all,
    // caught by loading /resume-checker.
    //
    // The invariant is exclusivity, not a count in one file: HomeHero and Hero
    // never render together (Index gates them on complementary conditions), so
    // each carries its own h1 and every state has exactly one.
    const homeH1 = (HERO.match(/<h1[\s>]/g) ?? []).length;
    const heroH1 = (HERO_C.match(/<h1[\s>]/g) ?? []).length;
    expect(homeH1, "HomeHero must own the default homepage h1").toBe(1);
    expect(heroH1, "Hero must own the h1 on landing and post-scan states").toBeGreaterThanOrEqual(1);
    // Balanced tags — reopening h1s left </h2> closers behind once.
    expect((HERO_C.match(/<\/h1>/g) ?? []).length).toBe(heroH1);
    // The exclusivity itself, read off Index.
    expect(indexCode).toMatch(/\{!landing && !freeKeywordResult && \(/);
    expect(indexCode).toMatch(/\{\(landing \|\| freeKeywordResult\) && <Hero /);
  });

  it("no shipped surface hardcodes a board total", () => {
    // "550,000+" sat in the headline, a CTA, the <title> and og: tags while the
    // board served 603,904 — true, frozen, and understating the product by
    // ~54,000 in the direction that makes it look smaller. Numbers about the
    // board come from the board.
    const surfaces: Array<[string, string]> = [
      ["Hero.tsx", stripCode(HERO_C)],
      ["JobBoardHero.tsx", stripCode(BOARD)],
      ["HomeHero.tsx", stripCode(HERO)],
      ["LiveMatches.tsx", stripCode(readFileSync(resolve(__dirname, "../components/LiveMatches.tsx"), "utf8"))],
    ];
    for (const [name, code] of surfaces) {
      expect(code, `${name} hardcodes a stale board total`).not.toMatch(/550,000/);
    }
  });

  it("the live claims degrade to count-free copy, never to a placeholder", () => {
    const code = stripCode(HERO_C);
    // Both live strings are ternaries against the fetched totals, with a
    // sibling key that states the same thing without a number.
    expect(code).toMatch(/boardTotals\s*\?[\s\S]{0,220}browseJobsLive[\s\S]{0,220}browseJobsPlain/);
    expect(code).toMatch(/boardTotals\s*\?[\s\S]{0,260}feedbackLive[\s\S]{0,260}feedbackPlain/);
  });

  it("interpolates on `n`, never `count`", () => {
    // i18next reserves `count` for plural selection: passing it changes which
    // plural form resolves and forces a number type. Caught by tsc when the
    // first draft used it.
    const code = stripCode(HERO_C);
    expect(code).toMatch(/\{\{n\}\}\+ verified jobs/);
    expect(code, "a board total is interpolated on the reserved `count` key")
      .not.toMatch(/\{\{count\}\}\+ verified/);
  });

  it("rounds a published floor DOWN", () => {
    const hook = readFileSync(resolve(__dirname, "../hooks/use-board-totals.ts"), "utf8");
    // A rounded-UP figure claims roles that do not exist, and the "+" only
    // reads as honest when the number under it is a floor.
    expect(hook).toMatch(/Math\.floor\(n \/ step\) \* step/);
    expect(hook, "rounding to NEAREST would publish roles the board does not have")
      .not.toMatch(/Math\.round\(n \/ step\)/);
  });

  it("a failed totals read yields null, never zero", () => {
    const hook = readFileSync(resolve(__dirname, "../hooks/use-board-totals.ts"), "utf8");
    expect(hook).toMatch(/if \(jobs > 0\) setTotals/);
  });
});

describe("the platform tallies survive every page state", () => {
  it("render on the landing and post-scan screens too", () => {
    // The agent+board band is replaced once a report exists (the report must
    // lead). The fifteen platforms and their live counts are not pitch — they
    // answer "where do these jobs come from" — so they get their own render
    // in exactly the states the band does not cover.
    expect(indexCode).toMatch(/\{\(landing \|\| freeKeywordResult\) && \([\s\S]{0,400}<AtsCoverage variant="strip" \/>/);
  });

  it("through the same component, not a second data path", () => {
    // One source for the counts; a hand-rolled copy for the compact state is
    // how two numbers for one quantity end up on the same site.
    const strips = (indexCode.match(/<AtsCoverage variant="strip" \/>/g) ?? []).length;
    expect(strips, "the strip is duplicated in Index").toBe(1);
    expect(indexCode).toMatch(/<AtsCoverage \/>/); // the full variant, deeper in the page
  });
});

describe("the page orders product, then evidence, then argument", () => {
  // Measured 2026-08-13 on a 45,741px homepage: the board's own provenance
  // rendered at 17,816px (40% down, behind two expectation-setting blocks) and
  // the two measured-evidence sections sat below 9,157px of argument. A reader
  // who stops scrolling mid-argument — most of them — reached neither.
  const at = (needle: string) => {
    const i = indexCode.indexOf(needle);
    expect(i, `${needle} is gone from the homepage`).toBeGreaterThan(-1);
    return i;
  };

  it("puts the board's provenance before the scan's expectation-setting", () => {
    expect(at("<AtsCoverage />")).toBeLessThan(at("<WhatYouGetSection />"));
  });

  it("keeps the free scan actionable first — the one rule this band never breaks", () => {
    // Provenance moved up, but not past the uploader: everything above it must
    // still be something a visitor can act on.
    expect(at("<ResumeUploader")).toBeLessThan(at("<AtsCoverage />"));
  });

  it("puts measured evidence ahead of the persuasion trio", () => {
    const proof = Math.max(at("<SocialProof />"), at("<LiveScanStats />"));
    for (const arg of ["<AnalysisPreview />", "<ComparisonTable />", "<WhyNotChatGPT />"]) {
      expect(proof, `${arg} is back above the evidence for it`).toBeLessThan(at(arg));
    }
  });

  it("still closes on the FAQ and the final call", () => {
    expect(at("<WhyNotChatGPT />")).toBeLessThan(at("<FAQ />"));
    expect(at("<FAQ />")).toBeLessThan(at("<FinalCTA"));
  });
});
