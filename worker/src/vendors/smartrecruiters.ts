import type { Page, Locator } from "playwright";
import type { VendorAdapter, Locatable, PacketFieldKey } from "./types.js";

/**
 * SmartRecruiters. The hardest of the three, and the one that proved the
 * adapter architecture was necessary.
 *
 * Observed on a live posting 2026-07-30 (see RECON.md):
 *   - The stored URL is a job DESCRIPTION page with no form on it at all. The
 *     apply control is a LINK reading "I'm interested" pointing at a separate
 *     `oneclick-ui` path.
 *   - The real form lives inside 1,806 open shadow roots. `querySelectorAll`
 *     sees nothing; Playwright pierces open roots, so it sees everything.
 *   - Not one field has a `name`. Matching is by `label[for]`, which is present
 *     and clean on 11 of 14.
 *   - Not one field sets `required`, though labels carry asterisks. Requiredness
 *     is enforced in JavaScript.
 *   - Two file inputs share `id="file-input"`.
 *   - The first page ends in `Next`. It is a multi-step form.
 */
const wrap = (l: Locator): Locatable => ({
  fill: async (v) => { await l.fill(v, { timeout: 8_000 }); },
  setFile: async (p) => { await l.setInputFiles(p, { timeout: 20_000 }); },
  isVisible: () => l.isVisible({ timeout: 3_000 }).catch(() => false),
});

// Matched on label text, since there are no name attributes. Anchored where the
// label is unambiguous: "Email" must not also match "Confirm your email", so the
// email pattern excludes the confirm variant explicitly.
const LABELS: Partial<Record<PacketFieldKey, RegExp>> = {
  firstName: /^first name/i,
  lastName: /^last name/i,
  email: /^email/i,
  confirmEmail: /^confirm your email/i,
  city: /^city$/i,
  linkedin: /^linkedin$/i,
  website: /^website$/i,
  coverNote: /let the company know about your interest/i,
};

export const smartrecruiters: VendorAdapter = {
  key: "smartrecruiters",

  // Labels say "First name*" but no field sets the attribute. The driver must
  // NOT count its empty-required check as protection here.
  requiredAttributeIsTrustworthy: false,

  async resolveFormUrl(page, postingUrl) {
    const resp = await page.goto(postingUrl, { waitUntil: "domcontentloaded", timeout: 45_000 })
      .catch(() => null);
    if (!resp || resp.status() >= 400) return null;

    // Find the link by DESTINATION, not by text. The observed label was "I'm
    // interested"; other tenants use other words. `oneclick-ui` is the vendor's
    // own path and is not something an employer can rename.
    const link = page.locator('a[href*="/oneclick-ui/"]').first();
    if (!(await link.count())) return null;
    const href = await link.getAttribute("href").catch(() => null);
    if (!href) return null;

    const url = new URL(href, postingUrl).href;
    const r2 = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 })
      .catch(() => null);
    if (!r2 || r2.status() >= 400) return null;
    // The form is JS-built inside shadow DOM; give it a beat to exist.
    await page.waitForTimeout(3_000);
    return url;
  },

  async locate(page, field) {
    const re = LABELS[field];
    if (!re) return null;
    // getByLabel resolves label[for] across open shadow boundaries.
    const l = page.getByLabel(re).first();
    return (await l.count().catch(() => 0)) > 0 ? wrap(l) : null;
  },

  async locateResume(page) {
    // TWO file inputs share id="file-input" — one for CV-autocomplete at the
    // top, one in the Resume section. Anchor on the Resume heading so the
    // résumé does not get attached to the autocomplete widget, which would
    // silently produce an application with no CV.
    const scoped = page.locator('input[type="file"]');
    const n = await scoped.count().catch(() => 0);
    if (n === 0) return null;
    // The Resume section's input is the LAST of the two on the observed page.
    // Deliberately last rather than first: `.first()` is the autocomplete.
    return wrap(scoped.nth(n - 1));
  },

  async proceed(page) {
    for (const re of [/^submit application$/i, /^submit$/i, /^send application$/i]) {
      const b = page.getByRole("button", { name: re }).first();
      if (await b.count() && await b.isVisible().catch(() => false)) {
        await b.click({ timeout: 10_000 });
        return "submitted";
      }
    }
    const next = page.getByRole("button", { name: /^next$/i }).first();
    if (await next.count() && await next.isVisible().catch(() => false)) {
      await next.click({ timeout: 10_000 });
      await page.waitForTimeout(2_000);
      return "advanced";
    }
    return "stuck";
  },

  async confirmed(page) {
    const body = ((await page.textContent("body").catch(() => "")) ?? "").slice(0, 4_000);
    if (/thank you for (?:your )?appl|application (?:has been )?(?:received|submitted)|we(?:'ve| have) received your application/i.test(body)) {
      return "yes";
    }
    // NEVER assert "no" here. The form is in shadow DOM and multi-step; not
    // finding a confirmation could equally mean we are on step 3 of 4. Unknown
    // routes to a human, which is right when we genuinely do not know.
    return "unknown";
  },
};
