/**
 * "NEEDS YOU" ON AN APPLICATION THAT MAY ALREADY HAVE ARRIVED.
 *
 * agent_mark_uncertain parks a packet at status='blocked'. The queue read that
 * RAW status and printed "Needs you" — so somebody whose application may well
 * have been received was told it still needed them, and the obvious response to
 * "Needs you" is to go and apply again by hand.
 *
 * That is a duplicate application under a real person's name, caused entirely by
 * our own wording. It is the same failure the release path guards against with
 * `alreadySubmitted` and the duplicate check; the UI just had its own way of
 * getting there.
 *
 * packetState already ranked `uncertain` above `blocked` and already owned the
 * honest sentence. The model was right the whole time — two render paths simply
 * were not asking it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { packetState } from "../lib/packetState";

const panel = readFileSync(
  resolve(__dirname, "../components/account/ApplyQueuePanel.tsx"), "utf8");
const code = panel.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** A packet the worker submitted and could not confirm. */
const uncertainPacket = {
  status: "blocked",
  submitted_at: null,
  attempts: 99,
  blockers: [{ kind: "uncertain-submit", detail: 'no confirmation recognised after submit — page said: "All done"' }],
};

describe("the model already knew", () => {
  it("classifies it as uncertain, not blocked", () => {
    expect(packetState(uncertainPacket).phase).toBe("uncertain");
  });

  it("refuses a retry, because retrying could apply someone twice", () => {
    expect(packetState(uncertainPacket).canRetry).toBe(false);
  });

  it("an ordinary blocked packet is still blocked", () => {
    // The control. Without it, a change that made EVERYTHING read as uncertain
    // would pass every assertion above.
    const ordinary = { status: "blocked", submitted_at: null, attempts: 0, blockers: [
      { kind: "missing-answer", detail: "work authorisation" }] };
    expect(packetState(ordinary).phase).toBe("blocked");
  });
});

describe("and now the queue asks it", () => {
  it("the row label branches on the derived phase, not the raw status alone", () => {
    expect(code).toMatch(/p\.status === "blocked" && packetState\(p\)\.phase === "uncertain"/);
    expect(code).toMatch(/p\.status === "blocked" && packetState\(p\)\.phase !== "uncertain"/);
  });

  it("an uncertain packet does not say it needs you", () => {
    // The two branches are mutually exclusive on the same condition, so an
    // uncertain packet cannot reach the "Needs you" label.
    const uncertainBranch = code.slice(
      code.indexOf('packetState(p).phase === "uncertain"'),
      code.indexOf('packetState(p).phase !== "uncertain"'),
    );
    expect(uncertainBranch).toMatch(/applyQueue\.sUncertain/);
    expect(uncertainBranch).not.toMatch(/applyQueue\.sBlocked/);
  });

  it("says what actually happened, including that it may have gone through", () => {
    expect(code).toMatch(/Sent — but we could not confirm it/);
  });
});

/**
 * THE SAME MISTAKE, ON THE SURFACE PEOPLE READ FIRST.
 *
 * Having found it twice in the queue, I went looking for a third. The night
 * summary — the card somebody reads over breakfast — counted the raw status too,
 * so an uncertain packet was reported as SKIPPED. Waking up to "skipped" invites
 * exactly the manual re-application the whole uncertain state exists to prevent.
 */
describe("the night summary distinguishes unconfirmed from skipped", () => {
  const night = readFileSync(
    resolve(__dirname, "../components/account/AgentNightSummary.tsx"), "utf8");
  const ncode = night.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("SELECTS the columns packetState needs — or it is blind to uncertain", () => {
    // The trap: PostgREST returns only named columns, so without blockers and
    // attempts every uncertain packet would count as skipped and nothing would
    // error. This is the third time this exact shape has bitten this codebase.
    const sel = ncode.match(/\.select\("([^"]+)"\)/);
    expect(sel).not.toBeNull();
    expect(sel![1]).toContain("blockers");
    expect(sel![1]).toContain("attempts");
  });

  it("counts uncertain separately, before the refusal reasons", () => {
    // Before, because a packet that reached submit was never refused — letting
    // a refusal reason claim it first would file it under the wrong heading.
    const i = ncode.indexOf('packetState(r).phase === "uncertain"');
    const j = ncode.indexOf("const why = r.release_refusal");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(-1);
    expect(i, "uncertain must be checked before refusal reasons").toBeLessThan(j);
  });

  it("says sent-but-unconfirmed, never skipped", () => {
    expect(ncode).toMatch(/agentNight\.unconfirmed/);
    expect(ncode).toMatch(/sent but unconfirmed/);
  });

  it("an unconfirmed-only night still renders the card", () => {
    // The early return hid the card unless sent/waiting/blocked were non-zero.
    // A night whose ONLY event was an unconfirmed send would have shown nothing
    // at all — the most alarming outcome, rendered as silence.
    expect(ncode).toMatch(/n\.unconfirmed === 0\)\) return null/);
  });
});

describe("the summary agrees with the rows it summarises", () => {
  it("the blocked count excludes uncertain packets", () => {
    // A person reads the headline number and may never open the row. A summary
    // that contradicts its own list is worse than no summary.
    expect(code).toMatch(/blocked: rows\.filter\(\(r\) => r\.status === "blocked" && packetState\(r\)\.phase !== "uncertain"\)/);
  });

  it("uncertain packets are counted, not simply dropped", () => {
    // Excluding them from `blocked` without counting them anywhere would make
    // applications vanish from the summary entirely — quieter, and worse.
    expect(code).toMatch(/unconfirmed: rows\.filter\(\(r\) => packetState\(r\)\.phase === "uncertain"\)/);
    expect(code).toMatch(/applyQueue\.cUnconfirmed/);
  });

  it("counts come from packetState, so there is ONE definition of these words", () => {
    // A second, local definition of "blocked" is how a summary and its list end
    // up disagreeing on screen.
    // The end anchor is searched FROM the start anchor. An unanchored
    // indexOf("return (") finds the loading early-return, which sits ABOVE the
    // counts — so the slice ran backwards and yielded "", and the assertion was
    // measuring an empty string rather than the block it names.
    const from = code.indexOf("const counts = {");
    expect(from).toBeGreaterThan(-1);
    const countsBlock = code.slice(from, code.indexOf("return (", from));
    expect((countsBlock.match(/packetState\(r\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
