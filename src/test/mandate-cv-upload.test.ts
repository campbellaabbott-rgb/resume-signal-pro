/**
 * THE ONE PREREQUISITE, SATISFIABLE WHERE IT IS STATED.
 *
 * The agent derives roles, places and field from a CV. The CV itself is the
 * only thing it cannot work out — and the panel's answer to not having one was
 * a sentence pointing "above", at a control on a different page. On /agent that
 * control does not exist at all, so the single thing standing between a paying
 * subscriber and a working agent was the one thing this surface could not do.
 *
 * WHAT THIS FILE DEFENDS, in order of how expensive the failure is:
 *
 *   1. A parse failure must never be silent. resumeTextFrom returns "" for
 *      EVERY failure — unreadable PDF, a scan with no text layer, and the
 *      rate-limited case, since parse-pdf shares a budget that ordinary board
 *      traffic has exhausted before. Treating "" as "nothing happened" gives a
 *      file picker that swallows CVs.
 *   2. The paste path is always reachable, not a consolation prize revealed
 *      after a failure.
 *   3. Saving makes the agent startable in the same breath — no reload.
 *   4. It writes the SAME row Account.tsx writes, not a second home for one fact.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const panel = readFileSync(
  resolve(__dirname, "../components/account/MorningQueuePanel.tsx"), "utf8");
const account = readFileSync(resolve(__dirname, "../pages/Account.tsx"), "utf8");
const code = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

describe("one definition of 'text out of a CV'", () => {
  it("uses the shared extractor rather than calling parse-pdf itself", () => {
    expect(code).toMatch(/import \{ resumeTextFrom \} from "@\/lib\/resumeText"/);
    expect(code).not.toMatch(/invoke\("parse-pdf"|invoke\("parse-docx"/);
  });

  it("accepts the formats that extractor handles", () => {
    const accept = /accept="([^"]+)"/.exec(code)?.[1] ?? "";
    for (const ext of [".pdf", ".docx", ".txt"]) expect(accept).toContain(ext);
  });
});

describe("a failed parse is loud", () => {
  it("checks the returned text rather than assuming success", () => {
    // The whole hazard: "" is the failure signal AND a falsy string.
    expect(code).toMatch(/if \(!text\.trim\(\)\) \{/);
  });

  it("opens the paste box and says so", () => {
    const i = code.indexOf("if (!text.trim())");
    const block = code.slice(i, i + 300);
    expect(block).toMatch(/setPasteOpen\(true\)/);
    expect(block).toMatch(/cvParseFailed/);
  });

  it("lets the SAME file be retried", () => {
    // Without clearing the input, re-choosing the file that just failed fires
    // no change event and the control visibly does nothing.
    expect(code).toMatch(/e\.target\.value = ""/);
  });
});

describe("the paste path is not a consolation prize", () => {
  it("is reachable before anything has failed", () => {
    // parse-pdf shares a rate budget; a scanned CV has no text layer at all.
    // The path that always works must not hide behind the one that sometimes does.
    expect(code).toMatch(/onClick=\{\(\) => setPasteOpen\(\(v\) => !v\)\}/);
  });

  it("shows the character count against the threshold", () => {
    expect(code).toMatch(/cvPasteCount/);
    expect(code).toMatch(/pasteDraft\.trim\(\)\.length < 100/);
  });
});

describe("saving makes the agent startable immediately", () => {
  it("updates ownResume, so resumeReady flips without a reload", () => {
    // resumeForMandate reads ownResume; a save needing a refresh to take effect
    // would be a new version of the dead end this replaces.
    expect(code).toMatch(/setOwnResume\(clean\)/);
  });

  it("enforces the same 100-character floor as the mandate gate", () => {
    // Storing something shorter leaves the button disabled with no explanation.
    expect(code).toMatch(/if \(clean\.length < 100\)/);
  });

  it("writes the same row Account.tsx writes", () => {
    for (const col of ["matching_resume_text", "matching_resume_updated_at"]) {
      expect(code, `${col} must match Account's shape`).toContain(col);
      expect(account).toContain(col);
    }
    expect(code).toMatch(/\.slice\(0, 50000\)/);
    expect(account).toMatch(/slice\(0, 50000\)/);
  });

  it("reports a write failure instead of pretending", () => {
    expect(code).toMatch(/cvSaveError/);
    expect(code).toMatch(/return false;/);
  });
});

describe("the copy no longer points somewhere the reader cannot go", () => {
  it("nothing renders the old '(above)' string", () => {
    // It survives in nine locale files, unused. A translated string that names
    // a place that does not exist invites reuse — this is the guard.
    expect(code).not.toMatch(/agentQueue\.needResume"/);
  });

  it("the toast points at this panel", () => {
    expect(code).toMatch(/agentQueue\.needResumeHere/);
  });

  it("the orphaned key really is orphaned everywhere in src", () => {
    const srcDir = resolve(__dirname, "..");
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name === "i18n" || e.name === "test") continue;   // locales keep the dead key
        const p = resolve(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && readFileSync(p, "utf8").includes('"agentQueue.needResume"')) hits.push(p);
      }
    };
    walk(srcDir);
    expect(hits, "something still renders copy that says the CV control is elsewhere").toEqual([]);
  });
});

describe("it is shown to the person who needs it", () => {
  it("appears exactly when a subscriber has no usable résumé", () => {
    expect(code).toMatch(/\{agentActive === true && !resumeReady && \(/);
  });

  it("sits inside the form a new subscriber already sees", () => {
    // The form renders on (editing || !mandate), so somebody who has never set
    // one up meets the upload without pressing anything first.
    expect(code).toMatch(/\{\(editing \|\| !mandate\) \? \(/);
  });
});
