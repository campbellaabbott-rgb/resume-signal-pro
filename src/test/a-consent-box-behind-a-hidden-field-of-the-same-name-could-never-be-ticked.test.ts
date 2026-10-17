/**
 * Sweep S11-047. applyResolution found a control by its position among EVERY
 * input carrying the question's name, hidden ones included. Pinpoint (and any
 * Rails form) renders a hidden `application[process_information]=0` just
 * before the required consent checkbox, so `first()` was the hidden input:
 * "checkbox not visible", a non-transient refusal, and every Pinpoint posting
 * with that box blocked. On a radio group with the same leading hidden field
 * the index the enumerator gave was one off, and the neighbouring option was
 * ticked while the log said the right one was.
 *
 * Driven against a real DOM (jsdom) through a page stand-in whose locators are
 * the DOM's own CSS selector engine, so what is tested is which element the
 * answer lands on, not the selector string.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { applyResolution } from "../../worker/src/questions/answer.js";
import type { DomQuestion } from "../../worker/src/vendors/enumerate-dom.js";

type Page = Parameters<typeof applyResolution>[0];

type El = HTMLInputElement & HTMLSelectElement;
function domPage(): Page {
  const visible = (e: Element | undefined) =>
    !!e && (e as HTMLInputElement).type !== "hidden" && (e as HTMLElement).style.display !== "none";
  const loc = (els: () => El[]): unknown => ({
    first: () => loc(() => els().slice(0, 1)),
    nth: (i: number) => loc(() => els().slice(i, i + 1)),
    isVisible: async () => visible(els()[0]),
    isChecked: async () => !!els()[0]?.checked,
    check: async () => {
      const e = els()[0];
      if (!visible(e)) throw new Error("element is not visible");
      e!.checked = true;
    },
    fill: async (v: string) => { const e = els()[0]; if (!visible(e)) throw new Error("not visible"); e!.value = v; },
    inputValue: async () => els()[0]?.value ?? "",
    selectOption: async () => {},
    evaluate: async <T,>(fn: (e: Element) => T) => fn(els()[0]!),
  });
  return { locator: (sel: string) => loc(() => [...document.querySelectorAll(sel)] as El[]) } as unknown as Page;
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("a consent box behind a Rails hidden field is ticked", () => {
  const q: DomQuestion = {
    name: "application[process_information]", type: "checkbox", required: true,
    label: "I consent to the processing of my personal data", options: [],
  };

  it("Pinpoint's shape: the box itself is ticked, the hidden field untouched", async () => {
    document.body.innerHTML = `
      <input type="hidden" name="application[process_information]" value="0">
      <label><input type="checkbox" id="consent" name="application[process_information]" value="1" required>
        I consent to the processing of my personal data</label>`;
    const r = await applyResolution(domPage(), q, { kind: "check", category: "consent-processing" });
    expect(r).toMatchObject({ ok: true });
    expect((document.getElementById("consent") as HTMLInputElement).checked).toBe(true);
  });
});

describe("a radio group behind a hidden field gets the option it was given", () => {
  const html = `
    <fieldset><legend>Are you willing to travel?</legend>
      <input type="hidden" name="application[travel]" value="">
      <input type="radio" id="t-yes" name="application[travel]" value="yes"><label for="t-yes">Yes</label>
      <input type="radio" id="t-no" name="application[travel]" value="no"><label for="t-no">No</label>
    </fieldset>`;
  const q: DomQuestion = { name: "application[travel]", type: "radio", required: true, label: "Are you willing to travel?", options: ["Yes", "No"] };

  it.each([["No", "t-no", "t-yes"], ["Yes", "t-yes", "t-no"]])("%s ticks %s and leaves %s alone", async (option, ticked, left) => {
    document.body.innerHTML = html;
    const r = await applyResolution(domPage(), q, { kind: "choose", category: "unrecognised", option });
    expect(r).toMatchObject({ ok: true });
    expect((document.getElementById(ticked) as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById(left) as HTMLInputElement).checked).toBe(false);
  });

  it("an option the enumerator never counted refuses rather than ticking a neighbour", async () => {
    // The first radio has no label and no value, so the enumerator listed
    // only ["Yes", "No"] and "No" sits at index 1 — which is the "Yes" control.
    document.body.innerHTML = `
      <input type="radio" id="blank" name="application[travel]" value="">
      <input type="radio" id="t-yes" name="application[travel]" value="yes"><label for="t-yes">Yes</label>
      <input type="radio" id="t-no" name="application[travel]" value="no"><label for="t-no">No</label>`;
    const r = await applyResolution(domPage(), q, { kind: "choose", category: "unrecognised", option: "No" });
    expect(r.ok).toBe(false);
    expect((document.getElementById("t-yes") as HTMLInputElement).checked).toBe(false);
  });
});

describe("a text box behind a hidden field of its name is filled", () => {
  it("the visible box takes the answer", async () => {
    document.body.innerHTML = `
      <input type="hidden" name="application[city]" value="">
      <input type="text" id="city" name="application[city]">`;
    const q: DomQuestion = { name: "application[city]", type: "text", required: true, label: "City", options: [] };
    const r = await applyResolution(domPage(), q, { kind: "fill", category: "city", value: "Leeds" });
    expect(r).toMatchObject({ ok: true });
    expect((document.getElementById("city") as HTMLInputElement).value).toBe("Leeds");
  });
});
