/**
 * SAVED JOBS → MANDATE, ONE CLICK.
 *
 * A saved row is a job somebody chose and has not applied to — the clearest
 * statement of intent this product records. The link on the saved list hands
 * the distinct saved role titles to /agent as ?seedTitles=a|b|c, where they
 * PREFILL the mandate form and do nothing else.
 *
 * THE CONTRACT UNDER TEST is the same one the CV proposal established: seeded
 * text loses to everything. An existing mandate wins (the seed branch never
 * runs), anything already typed wins, and the person still presses Activate.
 * An agent that starts hunting for roles nobody confirmed is the one thing
 * this product cannot afford.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toMandateField } from "../lib/mandateProposal";

const account = readFileSync(resolve(__dirname, "../pages/Account.tsx"), "utf8");
const panel = readFileSync(resolve(__dirname, "../components/account/MorningQueuePanel.tsx"), "utf8");

describe("the link on the saved list", () => {
  it("is built from SAVED rows only", () => {
    // An applied row is done; offering the agent for it is an offer to repeat
    // work, and the duplicate guard would refuse the result anyway.
    expect(account).toMatch(/a\.status === "saved" && a\.role\?\.trim\(\)/);
  });

  it("needs at least two roles — one row cannot support 'jobs like these'", () => {
    expect(account).toMatch(/savedRoles\.length >= 2/);
  });

  it("sanitises each title through toMandateField before it touches a URL", () => {
    // Titles flow into a PostgREST or() downstream, where a comma is a
    // separator. The same character rule the CV proposal enforces.
    expect(account).toMatch(/\.map\(\(a\) => toMandateField\(\[a\.role as string\]\)\)/);
    expect(account).toMatch(/encodeURIComponent\(savedRoles\.join\("\|"\)\)/);
  });

  it("routes to the agent page", () => {
    expect(account).toMatch(/to=\{`\/agent\?seedTitles=/);
  });
});

describe("the panel's side of the handshake", () => {
  it("only reads the seed when there is NO existing mandate", () => {
    // The seed lives in the else-branch of the mandate load. An existing
    // mandate's form must never be overwritten by a link somebody followed.
    const load = panel.slice(panel.indexOf("if (m) {"), panel.indexOf("if (Array.isArray(qRows))"));
    expect(load).toMatch(/\} else \{[\s\S]*seedTitles/);
  });

  it("re-sanitises every title — a URL param is caller-controlled input", () => {
    expect(panel).toMatch(/seed\.split\("\|"\)\.map\(\(x\) => toMandateField\(\[x\]\)\)/);
  });

  it("never overwrites typed text", () => {
    expect(panel).toMatch(/f\.q\.trim\(\) \? f : \{ \.\.\.f, q: toMandateField\(titles\) \}/);
  });

  it("caps and dedupes the titles", () => {
    expect(panel).toMatch(/new Set\(seed\.split/);
    expect(panel).toMatch(/\.slice\(0, 4\)/);
  });

  it("fills the form and nothing else — no save, no activate", () => {
    // The seed block must not touch persistence. Saving happens when the
    // person presses the button, through the same path it always did.
    const i = panel.indexOf('new URLSearchParams(window.location.search).get("seedTitles")');
    const block = panel.slice(i, i + 700);
    expect(block).not.toMatch(/\.from\(|\.rpc\(|\.upsert\(|\.insert\(/);
  });
});

describe("the sanitiser both sides share", () => {
  it("strips the PostgREST separators from a hostile title", () => {
    const cleaned = toMandateField(["Sales, Engineer (Senior)*"]);
    expect(cleaned).not.toMatch(/[,()*]/);
    expect(cleaned.toLowerCase()).toContain("sales");
  });

  it("drops an empty title outright", () => {
    expect(toMandateField([""])).toBe("");
  });
});
