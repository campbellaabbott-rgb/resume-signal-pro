/**
 * THE ACTIVATE BUTTON WORKED AND THE SAVE DID NOT.
 *
 * Two hand-kept copies of "does this person have a usable résumé":
 *
 *   resumeReady (enables the button)  defaultResume || ownResume || mandate.resume_text
 *   saveMandate (writes the row)      defaultResume ||               mandate.resume_text
 *
 * `ownResume` is the ONLY one of the three ever set on /agent — Account.tsx
 * passes a résumé as `defaultResume`, the Agent page hardcodes it null, and
 * ownResume is the fetch that exists to cover exactly that. So on the agent's
 * own page a subscriber saw an ENABLED button, pressed it, got "save a résumé
 * first", and no row was written. Nothing on screen explained it.
 *
 * That is the identical dead end the comment beside resumeReady says was fixed
 * on 2026-08-02 — fixed there, missed here, because the fix was "use the same
 * expression in both places" and two copies maintained by hand drift. The
 * repair is one definition, and this file is what stops a third copy appearing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const panel = readFileSync(
  resolve(__dirname, "../components/account/MorningQueuePanel.tsx"), "utf8");
/** Comments stripped: the prose here NAMES the broken expression it warns about. */
const code = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

describe("one definition of the résumé the agent scores against", () => {
  it("is declared exactly once", () => {
    expect((code.match(/const resumeForMandate =/g) ?? []).length).toBe(1);
  });

  it("includes ownResume — the only source /agent can have", () => {
    expect(code).toMatch(/const resumeForMandate = defaultResume\?\.trim\(\) \|\| ownResume\?\.trim\(\) \|\| mandate\?\.resume_text\?\.trim\(\) \|\| ""/);
  });

  it("prefers the pinned résumé over a mandate's stale snapshot", () => {
    // Reversing this is a separate old bug (audit 2026-07-25): re-saving would
    // never pick up a newer CV.
    const expr = /const resumeForMandate = (.+);/.exec(code)?.[1] ?? "";
    expect(expr.indexOf("defaultResume")).toBeLessThan(expr.indexOf("mandate?.resume_text"));
    expect(expr.indexOf("ownResume")).toBeLessThan(expr.indexOf("mandate?.resume_text"));
  });
});

describe("the button and the save agree, because they read the same value", () => {
  it("the button's gate derives from it", () => {
    expect(code).toMatch(/const resumeReady = resumeForMandate\.length >= 100/);
  });

  it("the save reads it rather than rebuilding the chain", () => {
    expect(code).toMatch(/const resume = resumeForMandate;/);
  });

  it("NOTHING rebuilds that chain a second time", () => {
    // The regression to prevent: a future edit reintroducing
    // `defaultResume || mandate?.resume_text` anywhere. One definition or none.
    const rebuilds = code.match(/defaultResume\?\.trim\(\) \|\| mandate\?\.resume_text/g) ?? [];
    expect(rebuilds, "a second résumé chain has appeared — that is the drift").toEqual([]);
  });

  it("is declared BEFORE the callback that reads it", () => {
    // `const` is not hoisted. Declaring it after saveMandate would be a
    // temporal-dead-zone throw the moment the callback ran during render.
    expect(code.indexOf("const resumeForMandate =")).toBeLessThan(code.indexOf("const saveMandate = useCallback"));
  });

  it("is in the callback's dependency list", () => {
    // /agent fetches ownResume asynchronously. Without this dep the closure is
    // built on the first render — when it is still null — and keeps saving
    // against an empty résumé after the fetch lands.
    const deps = /\}, \[mandate, ([^\]]+)\]\);/.exec(code)?.[1] ?? "";
    expect(deps).toContain("resumeForMandate");
    expect(deps).not.toMatch(/\bdefaultResume\b/);
  });
});
