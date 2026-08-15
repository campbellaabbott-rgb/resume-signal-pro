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

const HERO = readFileSync(resolve(__dirname, "../components/AgentHero.tsx"), "utf8");
const PANEL = readFileSync(resolve(__dirname, "../components/AgentMatchesPanel.tsx"), "utf8");
const INDEX = readFileSync(resolve(__dirname, "../pages/Index.tsx"), "utf8");
const JOBS = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const heroCode = strip(HERO);
const panelCode = strip(PANEL);
const indexCode = strip(INDEX);

describe("the agent opens the page", () => {
  it("renders before the board hero", () => {
    const agentAt = indexCode.indexOf("<AgentHero />");
    const boardAt = indexCode.indexOf("<JobBoardHero />");
    expect(agentAt, "AgentHero is not on the page").toBeGreaterThan(-1);
    expect(boardAt, "JobBoardHero is gone").toBeGreaterThan(-1);
    expect(agentAt, "the board opens the page again — the agent is the hallmark").toBeLessThan(boardAt);
  });

  it("replaced the brochure, not doubled it", () => {
    expect(indexCode, "the old static showcase renders alongside the hero")
      .not.toMatch(/<ApplyAgentShowcase/);
  });

  it("speaks with measured inventory or with none", () => {
    // The line renders only when BOTH numbers arrived; no fallback figures.
    expect(heroCode).toMatch(/inv\.sendable !== null && inv\.total !== null &&/);
    // Payload gating: a number must be > 0 to be trusted — a zero from a
    // half-written status payload must read as absence, not "0 openings".
    expect(heroCode).toMatch(/d\.sendable\?\.postings === "number" && d\.sendable\.postings > 0/);
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
