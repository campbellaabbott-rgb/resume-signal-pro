/**
 * The DOM-side question enumerator, held as a STRING rather than a function.
 *
 * Two reasons, both practical:
 *
 * 1. tsx/esbuild compile with `keep-names`, which rewrites arrow functions to
 *    reference a `__name` helper. That helper exists in the Node bundle and not
 *    in the page, so a perfectly correct extractor throws
 *    `ReferenceError: __name is not defined` the moment it runs inside
 *    `page.evaluate`. Passing source text side-steps the transform entirely.
 * 2. Every adapter needs the same enumeration. One copy means a fix to the
 *    label-walking logic lands for all of them at once.
 *
 * WHAT IT RETURNS, and why the shape matters.
 *
 * Controls are grouped by `name`, so a radio group is ONE question with N
 * options rather than N questions. That distinction is not cosmetic: read
 * ungrouped, a group's individual option labels ("Male", "African", "Yes")
 * present themselves as question text. A matcher built on that would be
 * pattern-matching answers and calling them questions — and would confidently
 * "recognise" an EEO race question as a yes/no.
 *
 * The question label for a group is taken from the nearest ancestor that
 * contains EVERY member of the group, never from any single option's own label.
 */
export const ENUMERATE_JS = `(() => {
  const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const labelFor = (e) => {
    if (e.id) {
      const l = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(e.id) : e.id) + '"]');
      if (l) return clean(l.textContent);
    }
    const w = e.closest("label");
    return w ? clean(w.textContent) : "";
  };

  const groups = new Map();
  const all = document.querySelectorAll("input, select, textarea");
  for (let i = 0; i < all.length; i++) {
    const e = all[i];
    if (!e.name || e.type === "hidden") continue;
    if (!groups.has(e.name)) groups.set(e.name, []);
    groups.get(e.name).push(e);
  }

  const out = [];
  groups.forEach((els, name) => {
    const e = els[0];
    const tag = e.tagName;
    const type = tag === "SELECT" ? "select" : tag === "TEXTAREA" ? "textarea" : (e.type || "text");
    const required = els.some((x) => x.required || x.getAttribute("aria-required") === "true");

    let options = [];
    if (type === "select") {
      const os = e.options || [];
      for (let i = 0; i < os.length; i++) { const t = clean(os[i].text); if (t) options.push(t); }
    } else if (els.length > 1) {
      for (let i = 0; i < els.length; i++) {
        const t = labelFor(els[i]) || clean(els[i].value);
        if (t) options.push(t);
      }
    }

    // The question label. For a multi-control group, climb to the nearest
    // ancestor holding every member and read its heading — a single option's
    // label is an ANSWER and must never be mistaken for the question.
    let label = "";
    if (els.length > 1) {
      let a = e.parentElement;
      for (let i = 0; i < 6 && a; i++, a = a.parentElement) {
        let holdsAll = true;
        for (let j = 0; j < els.length; j++) if (!a.contains(els[j])) { holdsAll = false; break; }
        if (!holdsAll) continue;
        const hs = a.querySelectorAll("legend, h2, h3, h4, label, .question");
        for (let k = 0; k < hs.length; k++) {
          let wraps = false;
          for (let j = 0; j < els.length; j++) if (hs[k].contains(els[j])) { wraps = true; break; }
          if (!wraps) { const t = clean(hs[k].textContent); if (t) { label = t; break; } }
        }
        if (label) break;
      }
    } else {
      label = labelFor(e);
      if (!label) {
        // Climb only while the container holds THIS control and no other.
        //
        // The naive version — nearest li/div, first label inside — reported
        // marex's cEmail, cPhoneNumber and cAddress as "Full Name", because all
        // four sit in one wrapper whose first label belongs to the name field.
        // A matcher fed that would type the candidate's name into their phone
        // and address. A label shared by several controls identifies none of
        // them, so this stops at the boundary and returns "" instead, which the
        // matcher treats as unanswerable.
        let a = e.parentElement;
        for (let i = 0; i < 4 && a; i++, a = a.parentElement) {
          if (a.querySelectorAll("input:not([type=hidden]), select, textarea").length > 1) break;
          const h = a.querySelector("label, legend, h3, h4");
          if (h && !h.contains(e)) { const t = clean(h.textContent); if (t) { label = t; break; } }
        }
      }
    }

    // A trailing asterisk is a requiredness MARKER, not part of the question.
    // Left on, every pattern would need to tolerate it and some would not.
    label = label.replace(/[*\\u2217]\\s*$/, "").trim();
    out.push({ name: name, type: type, required: required, label: label.slice(0, 200), options: options.slice(0, 24) });
  });
  return out;
})()`;

/** One control group on a real form: a question, its type, and its options. */
export type DomQuestion = {
  name: string;
  type: string;
  required: boolean;
  label: string;
  options: string[];
};

/**
 * Run the enumerator on a page.
 *
 * Returns null rather than [] when it cannot run. An empty array means "this
 * form has no controls", which is a claim; null means "I could not look", which
 * is the honest answer when evaluation fails. The caller must not read a failed
 * probe as a clean form — that is the same class of error as counting zero
 * `required` attributes on a vendor that does not set them and calling it safe.
 */
export async function enumerateOn(
  page: { evaluate: (js: string) => Promise<unknown> },
): Promise<DomQuestion[] | null> {
  try {
    const out = await page.evaluate(ENUMERATE_JS);
    return Array.isArray(out) ? (out as DomQuestion[]) : null;
  } catch {
    return null;
  }
}
