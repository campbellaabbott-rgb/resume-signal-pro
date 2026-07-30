import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const panel = readFileSync(resolve(root, "src/components/account/ApplyQueuePanel.tsx"), "utf8");
const en = JSON.parse(readFileSync(resolve(root, "src/i18n/locales/en.json"), "utf8"));

describe("a reviewer can see exactly what would be sent in their name", () => {
  // The product rests on someone letting an agent act as them. That consent is
  // only meaningful if they can read the payload first.
  it("renders every field with its provenance", () => {
    expect(panel).toContain("applyQueue.willSend");
    expect(panel).toMatch(/Object\.entries\(p\.fields/);
    // a fact and a generated sentence must be distinguishable at a glance
    expect(panel).toContain("applyQueue.src.");
    for (const s of ["profile", "standing", "resume", "drafted", "declined"]) {
      expect(en.applyQueue.src[s], `src.${s} label`).toBeTruthy();
    }
    expect(en.applyQueue.src.drafted).toMatch(/drafted/i);
  });

  it("prints every blocker in full rather than just saying 'blocked'", () => {
    // "Needs you: work authorisation" is useful; "blocked" is not. A queue that
    // says something is stuck without saying why is one people stop reading.
    expect(panel).toMatch(/p\.blockers\.map/);
    expect(panel).toMatch(/\{b\.detail\}/);
  });

  it("says when a form was inferred rather than published", () => {
    // Only Greenhouse publishes real questions. Presenting a guessed form as the
    // employer's actual one is the same class of lie as an invented count.
    expect(panel).toContain("questions_are_real");
    expect(en.applyQueue.inferred).toMatch(/doesn't publish/i);
    expect(en.applyQueue.inferred).toMatch(/may ask more/i);
  });
});

describe("recording a send is a report of fact, not a decision", () => {
  it("stamps a timestamp and a source together", () => {
    // The database trigger refuses `submitted` without both, so a partial write
    // cannot record an application that never happened.
    const i = panel.indexOf('status: "submitted"');
    expect(i).toBeGreaterThan(-1);
    const near = panel.slice(i, i + 220);
    expect(near).toContain("submitted_at");
    expect(near).toContain("submitted_via");
  });

  it("never offers to re-mark something already sent", () => {
    expect(panel).toMatch(/p\.status !== "submitted" &&/);
  });
});

describe("the states read plainly and are fully translated", () => {
  it("names all six packet states", () => {
    for (const s of ["sReady", "sBlocked", "sSent", "sStale", "sPreparing", "sFailed"]) {
      expect(en.applyQueue[s], s).toBeTruthy();
    }
    expect(en.applyQueue.sReady).toMatch(/nothing needs you/i);
    expect(en.applyQueue.sStale).toMatch(/already applied/i);
  });

  it("is translated into all nine locales, nested src labels included", () => {
    const keys = Object.keys(en.applyQueue).filter((k) => k !== "src");
    for (const loc of ["en-GB", "es", "fr", "de", "pt", "nl", "hi", "tl"]) {
      const j = JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${loc}.json`), "utf8"));
      expect(j.applyQueue, `${loc} missing applyQueue`).toBeTruthy();
      for (const k of keys) expect(j.applyQueue[k], `${loc}.applyQueue.${k}`).toBeTruthy();
      for (const s of ["profile", "standing", "resume", "drafted", "declined"]) {
        expect(j.applyQueue.src?.[s], `${loc}.applyQueue.src.${s}`).toBeTruthy();
      }
    }
  });

  it("actually translates rather than shipping English nine times", () => {
    for (const loc of ["es", "fr", "de", "hi"]) {
      const j = JSON.parse(readFileSync(resolve(root, `src/i18n/locales/${loc}.json`), "utf8"));
      expect(j.applyQueue.sBlocked).not.toBe(en.applyQueue.sBlocked);
      expect(j.applyQueue.src.drafted).not.toBe(en.applyQueue.src.drafted);
    }
  });
});
