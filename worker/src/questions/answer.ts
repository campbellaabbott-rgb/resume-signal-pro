/**
 * Put a resolved answer onto a real control.
 *
 * Keyed on the `name` attribute, which every shipped adapter's form provides.
 * SmartRecruiters renders no names at all, which is one more reason it stays
 * out of ADAPTERS — a name-keyed answerer would silently place nothing there
 * and the packet would look filled.
 *
 * THE ORDERING CONTRACT. `DomQuestion.options` is built by the enumerator in
 * element order, so `options[i]` belongs to the i-th control in the group. This
 * module depends on that to check the right radio, and the matcher only ever
 * returns option text taken verbatim from that same array. If the enumerator
 * ever sorts or de-duplicates options, radios will be checked by a stale index
 * and the answer will be wrong while every log line still says "answered".
 */
import type { Page } from "playwright";
import type { DomQuestion } from "../vendors/enumerate-dom.js";
import type { Resolution } from "./match.js";

const FILL_TIMEOUT = 10_000;

/** Attribute selector for a field name. Quoted, so Rails-style
 *  `application_form[application][first_name]` needs no escaping. */
const byName = (name: string) => `[name="${name.replace(/"/g, '\\"')}"]`;

export type AnswerResult =
  | { ok: true; how: string }
  | { ok: false; why: string };

/**
 * Apply one resolution. Returns a failure rather than throwing, because a
 * control that would not take its answer must stop the submission — not be
 * swallowed by a catch and counted as done.
 */
export async function applyResolution(
  page: Page,
  q: DomQuestion,
  r: Resolution,
): Promise<AnswerResult> {
  if (r.kind === "unanswerable") return { ok: false, why: r.why };

  const group = page.locator(byName(q.name));

  try {
    if (r.kind === "check") {
      const box = group.first();
      if (!(await box.isVisible().catch(() => false))) return { ok: false, why: "checkbox not visible" };
      await box.check({ timeout: FILL_TIMEOUT });
      return { ok: true, how: `checked ${q.name}` };
    }

    if (r.kind === "fill") {
      const el = group.first();
      if (!(await el.isVisible().catch(() => false))) return { ok: false, why: "field not visible" };
      await el.fill(r.value, { timeout: FILL_TIMEOUT });
      // Read it back. A control that silently rejects input — a masked field, a
      // JS widget over a hidden input — otherwise reports success while the
      // employer receives a blank. Trimmed compare because some fields reformat.
      const got = await el.inputValue().catch(() => "");
      if (got.trim() !== r.value.trim()) {
        return { ok: false, why: `field kept "${got.slice(0, 40)}" instead of the answer` };
      }
      return { ok: true, how: `filled ${q.name}` };
    }

    // choose
    if (q.type === "select") {
      const el = group.first();
      await el.selectOption({ label: r.option }, { timeout: FILL_TIMEOUT });
      return { ok: true, how: `selected "${r.option}" in ${q.name}` };
    }

    // Radio (or a multi-checkbox group). The matcher returns option text taken
    // verbatim from `q.options`, so its index is the index of the control.
    const idx = q.options.indexOf(r.option);
    if (idx < 0) return { ok: false, why: `"${r.option}" is not among this control's options` };
    const one = group.nth(idx);
    if (!(await one.isVisible().catch(() => false))) return { ok: false, why: "option not visible" };
    await one.check({ timeout: FILL_TIMEOUT });
    if (!(await one.isChecked().catch(() => false))) {
      return { ok: false, why: `option "${r.option}" did not take` };
    }
    return { ok: true, how: `chose "${r.option}" in ${q.name}` };
  } catch (e) {
    return { ok: false, why: String(e).slice(0, 120) };
  }
}
