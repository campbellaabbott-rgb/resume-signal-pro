import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The wiring, not the parser — mandate-proposal.test.ts covers the reading.
 *
 * Two things can go wrong here that a unit test of the pure function cannot
 * see, and both were live before this change:
 *
 * 1. The panel could not see a résumé at all on /agent. Agent.tsx passes
 *    `defaultResume={null}`, so `resumeReady` was false for anybody who had not
 *    first activated a mandate from /account — the Activate button sat disabled
 *    on the agent's own page, under a sentence pointing "above" at a panel that
 *    uploads a CV and never writes resume_text. A proposal read from nothing is
 *    no proposal, so this is the same fix.
 *
 * 2. A proposal that overwrites what somebody typed. Autofill that fights the
 *    user is worse than no autofill.
 */
const panel = readFileSync(
  resolve(__dirname, "../components/account/MorningQueuePanel.tsx"),
  "utf8",
);
const agentPage = readFileSync(resolve(__dirname, "../pages/Agent.tsx"), "utf8");

describe("the mandate form can see a résumé wherever it is mounted", () => {
  it("Agent.tsx still passes no résumé, which is the thing being compensated for", () => {
    // If this ever stops being true the fallback below is dead code rather than
    // a fix, and this test should be revisited rather than deleted.
    expect(agentPage).toMatch(/defaultResume=\{null\}/);
  });

  it("falls back to the pinned matching résumé, then the newest scan", () => {
    expect(panel).toMatch(/matching_resume_text/);
    expect(panel).toMatch(/user_scans/);
  });

  it("prefers the caller's résumé over its own lookup", () => {
    // Account.tsx already resolves the same two sources; re-reading them would
    // be a second opinion that can disagree with the one on screen.
    expect(panel).toMatch(/defaultResume\?\.trim\(\)\s*\|\|\s*ownResume\?\.trim\(\)/);
  });

  it("uses the same résumé for the proposal that it gates Activate on", () => {
    // Two expressions for "the résumé" is how the button and the suggestions
    // start describing different documents.
    expect(panel).toMatch(/proposeMandate\(resumeForMandate\)/);
  });
});

describe("a proposal is offered, never imposed", () => {
  it("only bulk-fills when every relevant field is blank", () => {
    expect(panel).toMatch(/const formIsBlank\s*=\s*!form\.q\.trim\(\)/);
    expect(panel).toMatch(/formIsBlank && \(/);
  });

  it("each field keeps whatever the person typed", () => {
    // `f.q.trim() || proposed` — their value wins, always.
    expect(panel).toMatch(/q:\s*f\.q\.trim\(\)\s*\|\|/);
    expect(panel).toMatch(/location:\s*f\.location\.trim\(\)\s*\|\|/);
    expect(panel).toMatch(/category:\s*f\.category\s*\|\|/);
  });

  it("writes terms through the shared joiner, so no comma survives into a term", () => {
    // A comma inside a value is re-read by agent-runner's or() as a separator
    // and silently widens the search to terms nobody typed.
    expect(panel).toMatch(/toMandateField\(/);
    expect(panel).not.toMatch(/setForm\(\(f\) => \(\{ \.\.\.f, q: \[\.\.\..*\]\.join\(", "\)/);
  });

  it("labels adjacent roles as suggestions rather than as CV quotes", () => {
    expect(panel).toMatch(/not something your CV says/);
  });

  it("never activates as a side effect of proposing", () => {
    const start = panel.indexOf("const applyProposal");
    expect(start).toBeGreaterThan(-1);
    const body = panel.slice(start, start + 600);
    expect(body).not.toMatch(/saveMandate|saveSearch|from\("agent_/);
  });
});
