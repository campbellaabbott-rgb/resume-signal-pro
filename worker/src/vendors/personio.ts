import type { Page, Locator } from "playwright";
import type { VendorAdapter, Locatable, PacketFieldKey } from "./types.js";

/**
 * Personio. The cleanest structure of the six examined, and the one that shows
 * most clearly why matching on `name` beats matching on visible text.
 *
 * Observed on a live posting 2026-07-30 (see RECON.md):
 *   - The apply control reads "Auf diese Stelle bewerben" — GERMAN. Personio is
 *     a German company and its tenants localise, so the button text varies by
 *     language, not just by employer.
 *   - Its href is `{jobUrl}?apply`, which does not vary at all. That is the rule
 *     to use.
 *   - 12 fields, ALL with `name`, and the names are ENGLISH — `first_name`,
 *     `email`, `salary_expectations` — while the labels beside them are German.
 *     Vendor markup is stable; tenant-facing text is not.
 *   - `required` is set on NONE of them. Requiredness appears in the label as
 *     "*(erforderlich)". Same trap as SmartRecruiters.
 *   - Four file inputs, distinguished by name: documents.cv, .cover-letter,
 *     .employment-reference, .other. The CV is nameable, so it cannot be
 *     attached to the wrong one.
 */
const wrap = (l: Locator): Locatable => ({
  fill: async (v) => { await l.fill(v, { timeout: 8_000 }); },
  setFile: async (p) => { await l.setInputFiles(p, { timeout: 20_000 }); },
  isVisible: () => l.isVisible({ timeout: 3_000 }).catch(() => false),
});

// Language-independent by construction: these are the vendor's own attribute
// names, identical on a German, French or English tenant.
const FIELDS: Partial<Record<PacketFieldKey, string>> = {
  firstName: 'input[name="first_name"]',
  lastName: 'input[name="last_name"]',
  email: 'input[name="email"]',
  phone: 'input[name="phone"]',
  city: 'input[name="location"]',
  salaryExpectation: 'input[name="salary_expectations"]',
};

export const personio: VendorAdapter = {
  key: "personio",

  // Set on zero of twelve fields; requiredness lives in the label text.
  requiredAttributeIsTrustworthy: false,

  async resolveFormUrl(page, postingUrl) {
    const base = postingUrl.replace(/[?#].*$/, "").replace(/\/+$/, "");
    const url = `${base}?apply`;
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 })
      .catch(() => null);
    if (!resp || resp.status() >= 400) return null;
    await page.waitForTimeout(3_000);
    // Confirm a real form rather than the description page with a query string.
    const ok = await page.locator('input[name="email"]').count().catch(() => 0);
    return ok > 0 ? url : null;
  },

  async locate(page, field) {
    const sel = FIELDS[field];
    if (!sel) return null;
    const l = page.locator(sel).first();
    return (await l.count()) > 0 ? wrap(l) : null;
  },

  async locateResume(page) {
    // Named explicitly. Three of the four file inputs are NOT the CV, and
    // putting a résumé into "employment reference" would submit an application
    // whose CV slot is empty while looking, to us, like it worked.
    const l = page.locator('input[name="documents.cv"]').first();
    return (await l.count()) > 0 ? wrap(l) : null;
  },

  // Located by TYPE and form membership, never by text: the control reads
  // "Bewerbung senden" on this tenant and something else on an English one.
  // Cannot be answered here. Personio sets `required` on none of its twelve
  // fields — requiredness is "*(erforderlich)" in the label text — so counting
  // the attribute returns zero and would look like nothing is missing.
  async unansweredRequired() { return null; },

  async canProceed(page) {
    const submit = page.locator('form button[type="submit"], form input[type="submit"]').last();
    if (await submit.count() && await submit.isVisible().catch(() => false)) return "would-submit";
    return "stuck";
  },

  async proceed(page) {
    if (await this.canProceed(page) !== "would-submit") return "stuck";
    await page.locator('form button[type="submit"], form input[type="submit"]').last()
      .click({ timeout: 10_000 });
    return "submitted";
  },

  async confirmed(page) {
    const body = ((await page.textContent("body").catch(() => "")) ?? "").slice(0, 4_000);
    // Both languages seen on this vendor. Anything else is "unknown" — never a
    // guess, because a wrong "yes" records a send that did not happen.
    if (/thank you|application (?:has been )?(?:received|submitted)|vielen dank|bewerbung.{0,20}(erhalten|eingegangen)/i.test(body)) {
      return "yes";
    }
    // Presence is NOT evidence the form is still showing. Breezy is a JS wizard:
    // every step lives in ONE form, so after a successful submit these fields
    // can remain in the DOM at zero size. Counting them would assert "not
    // submitted", which is treated as safely retryable — and a retry is a second
    // application under a real person's name, with no way to withdraw either.
    //
    // Visibility is the honest test. If the field is genuinely on screen the
    // submit did not take; if it is merely present, we do not know, and "unknown"
    // routes to a human.
    const still = await page.locator('input[name="email"]').first().isVisible({ timeout: 2_000 }).catch(() => false);
    if (still) return "no";
    return "unknown";
  },
};
