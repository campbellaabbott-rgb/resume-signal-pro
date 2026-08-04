/**
 * THE RECEIPT IS THE ONE COMPONENT THAT CAN QUIETLY LIE.
 *
 * `sent_answers` and `sent_evidence` have been recorded since migration
 * 20260801050000 — 1 August — and until now NOTHING READ THEM. The migration's
 * own header says why it matters: "An honest agent that cannot show its work
 * asks for the same trust as a dishonest one."
 *
 * Everything else in the product describes intent. This describes what was
 * actually put in front of an employer under someone's name, which means the
 * failure mode is not a bad layout — it is showing a person words they did not
 * send, or implying a record exists when it does not.
 *
 * The three ways it could lie, all pinned below:
 *   1. Rendering `fields` (what was PREPARED) as though it were what was sent.
 *   2. Treating an empty record as "nothing was submitted", when the truth is
 *      "this went out before we kept per-field records".
 *   3. Inventing or reconstructing a value that was never recorded.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const receipt = readFileSync(
  resolve(__dirname, "../../src/components/account/ApplicationReceipt.tsx"), "utf8");
const panel = readFileSync(
  resolve(__dirname, "../../src/components/account/ApplyQueuePanel.tsx"), "utf8");
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the receipt shows what was SENT, not what was planned", () => {
  it("the panel actually selects the evidence columns", () => {
    // PostgREST returns only named columns. Rendering `sent_answers` without
    // selecting it yields undefined forever — the receipt would silently show
    // the empty state on every application, for all time.
    const sel = panel.slice(panel.indexOf('from("agent_submissions")'), panel.indexOf(".eq(\"user_id\""));
    expect(sel, "sent_answers is rendered but never selected").toMatch(/sent_answers/);
    expect(sel, "sent_evidence is rendered but never selected").toMatch(/sent_evidence/);
  });

  it("renders sent_answers, and does NOT substitute fields for them", () => {
    const c = code(receipt);
    expect(c).toMatch(/sentAnswers\.map/);
    // `fields` may only ever arrive as preparedAnswers, for the diff. If the
    // receipt read it directly it would be showing the plan as the record.
    expect(c, "the receipt reads `fields` directly — that is the prepared plan, not the send")
      .not.toMatch(/\bp\.fields\b|props\.fields\b/);
  });

  it("an empty record says so, and does not claim nothing was submitted", () => {
    // The application DID go out. What is missing is the per-field record, and
    // "nothing was submitted" would be a worse falsehood than silence.
    const i = code(receipt).indexOf("sentAnswers.length === 0");
    expect(i).toBeGreaterThan(-1);
    expect(receipt).toMatch(/before we started keeping per-field records/);
    // code(), not the raw file: this very test file's rationale — and the
    // component's own header — contain the phrase being forbidden.
    expect(code(receipt).toLowerCase()).not.toMatch(/nothing was submitted/);
  });

  it("shows nothing at all until there is a submitted_at", () => {
    // A receipt for an unsent application is a claim that it was sent.
    expect(code(receipt)).toMatch(/if \(!p\.submittedAt\) return null;/);
  });
});

describe("the prepared-vs-sent diff cannot invent a difference", () => {
  it("only reports a change when a prepared value genuinely exists", () => {
    // `prepared !== undefined &&` — without it, every answer whose label is not
    // present in the prepared map reads as "changed at send time", which would
    // manufacture a discrepancy on a correct application.
    expect(code(receipt)).toMatch(/const changed = prepared !== undefined && prepared !== a\.value/);
  });

  it("keeps prepared and sent as separate inputs", () => {
    // The migration added two columns precisely so a learned answer resolving
    // between prepare and send stays VISIBLE. One merged value destroys that.
    const c = code(receipt);
    expect(c).toMatch(/sentAnswers/);
    expect(c).toMatch(/preparedAnswers/);
  });
});

describe("the employer's confirmation is theirs, not ours", () => {
  it("renders sent_evidence verbatim", () => {
    expect(code(receipt)).toMatch(/\{p\.sentEvidence\}/);
  });

  it("says plainly when no confirmation was captured", () => {
    // Absence of evidence is reported as absence, not as success.
    expect(receipt).toMatch(/returned no confirmation text/);
  });
});

describe("the controls the agent enforces are reachable", () => {
  const controls = readFileSync(
    resolve(__dirname, "../../src/components/account/AgentControlsPanel.tsx"), "utf8");
  const agentPage = readFileSync(
    resolve(__dirname, "../../src/pages/Agent.tsx"), "utf8");

  for (const col of ["blocked_companies", "paused_until", "employer_cooldown_days"]) {
    it(`${col} can actually be set by a person`, () => {
      // apply-agent enforces all three. Enforcement with no way to configure it
      // is a guard nobody can reach.
      expect(code(controls), `${col} is enforced but has no control`).toContain(col);
    });
  }

  it("the panel is mounted on the agent page", () => {
    expect(code(agentPage)).toMatch(/<AgentControlsPanel/);
  });

  it("an absent blocklist blocks nothing", () => {
    // Same permissive-when-missing rule the backend follows. If the UI wrote
    // [] as a restriction, or read absent as restrictive, the two layers would
    // disagree about what an empty mandate means.
    expect(code(controls)).toMatch(/Array\.isArray\(data\.blocked_companies\) \? data\.blocked_companies : \[\]/);
  });

  it("dedupes the blocklist case-insensitively, as the backend matches", () => {
    expect(code(controls)).toMatch(/x\.toLowerCase\(\) === v\.toLowerCase\(\)/);
  });

  it("saves the cooldown on blur, not per keystroke", () => {
    // Typing "30" passes through 3, and 3 is a real setting that would be
    // written and enforced for as long as it took to type the second digit.
    const c = code(controls);
    // Anchor on the SAVE CALL, not the field name: "employer_cooldown_days: n"
    // also prefixes "employer_cooldown_days: number" in the interface.
    const i = c.indexOf("save({ employer_cooldown_days: n })");
    expect(i).toBeGreaterThan(-1);
    expect(c.slice(Math.max(0, i - 400), i)).toMatch(/onBlur/);
  });
});
