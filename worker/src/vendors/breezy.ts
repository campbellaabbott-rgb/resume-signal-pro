import type { Page, Locator } from "playwright";
import { enumerateOn } from "./enumerate-dom.js";
import { classifyConfirmation } from "./confirmed.js";
import type { VendorAdapter, Locatable, PacketFieldKey } from "./types.js";

/**
 * Breezy. The friendliest of the three examined.
 *
 * Observed on a live posting 2026-07-30 (see RECON.md): plain light DOM, no
 * shadow roots, 40 of 50 fields carry a stable semantic `name`, and 30 set the
 * `required` attribute honestly. The form is the job URL plus `/apply`, so it
 * needs no clicking-through at all.
 */
const wrap = (l: Locator): Locatable => ({
  fill: async (v) => { await l.fill(v, { timeout: 8_000 }); },
  setFile: async (p) => { await l.setInputFiles(p, { timeout: 20_000 }); },
  isVisible: () => l.isVisible({ timeout: 3_000 }).catch(() => false),
});

// Read off the real form. Breezy prefixes candidate fields with `c`, which is
// stable across tenants because it is the vendor's own markup rather than
// anything an employer edits.
// Bare names first, selectors derived — so nothing parses a selector back into
// a name at runtime.
const KEYS: Partial<Record<PacketFieldKey, string>> = {
  fullName: "cName",
  email: "cEmail",
  phone: "cPhoneNumber",
  address: "cAddress",
  salaryExpectation: "cSalary",
  coverNote: "cSummary",
};
const RESUME_KEY = "cResume";


const FIELDS: Partial<Record<PacketFieldKey, string>> = {
  fullName: 'input[name="cName"]',
  email: 'input[name="cEmail"]',
  phone: 'input[name="cPhoneNumber"]',
  address: 'input[name="cAddress"]',
  salaryExpectation: 'input[name="cSalary"]',
  coverNote: 'textarea[name="cSummary"]',
};

export const breezy: VendorAdapter = {
  key: "breezy",

  // Breezy sets `required` on 30 of 50 fields, so the driver's empty-required
  // check means something here.
  requiredAttributeIsTrustworthy: true,

  // Derived from the map above, so a rename cannot desynchronise them.
  mappedNames: new Set([...Object.values(KEYS), RESUME_KEY]),

  enumerateQuestions: (page) => enumerateOn(page),

  async resolveFormUrl(page, postingUrl) {
    // Derived, not clicked. The apply control reads "Apply To Position" on this
    // tenant, but the URL rule holds regardless of what an employer calls the
    // button — which is the whole reason to prefer a rule over a click.
    const base = postingUrl.replace(/[?#].*$/, "").replace(/\/+$/, "");
    const url = base.endsWith("/apply") ? base : `${base}/apply`;
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 })
      .catch(() => null);
    if (!resp || resp.status() >= 400) return null;
    // Confirm we actually landed on a form rather than a soft 404 rendered 200.
    const hasForm = await page.locator('input[name="cEmail"]').count().catch(() => 0);
    return hasForm > 0 ? url : null;
  },

  async locate(page, field) {
    const sel = FIELDS[field];
    if (!sel) return null;
    const l = page.locator(sel).first();
    return (await l.count()) > 0 ? wrap(l) : null;
  },

  async locateResume(page) {
    // Named explicitly: this form has three file inputs and only one is the CV.
    const l = page.locator('input[name="cResume"]').first();
    return (await l.count()) > 0 ? wrap(l) : null;
  },

  // `required` is honest here (30 of 50 fields), so this answer is real.
  async unansweredRequired(page) {
    const mapped = new Set([...Object.values(KEYS), RESUME_KEY]);
    const names = await page.locator("input[required], select[required], textarea[required]")
      .evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLInputElement).name || "(unnamed)"))])
      .catch(() => [] as string[]);
    return names.filter((n) => !mapped.has(n));
  },

  async canProceed(page) {
    const submit = page.getByRole("button", { name: /^submit application$/i }).first();
    if (await submit.count() && await submit.isVisible().catch(() => false)) return "would-submit";
    const cont = page.getByRole("button", { name: /^continue$/i }).first();
    if (await cont.count() && await cont.isVisible().catch(() => false)) return "would-advance";
    return "stuck";
  },

  async proceed(page) {
    // Delegates so the dry run and the real run can never disagree.
    const what = await this.canProceed(page);
    if (what === "would-submit") {
      await page.getByRole("button", { name: /^submit application$/i }).first().click({ timeout: 10_000 });
      return "submitted";
    }
    if (what === "would-advance") {
      await page.getByRole("button", { name: /^continue$/i }).first().click({ timeout: 10_000 });
      return "advanced";
    }
    return "stuck";
  },

  async confirmed(page) {
    // Visibility BEFORE words. See classifyConfirmation — checking the phrase
    // list first recorded a failed submit as sent whenever the form page
    // carried ordinary "thank you for your interest" copy.
    //
    // Visible, not merely present: these forms are JS wizards whose fields
    // survive a successful submit at zero size.
    const still = await page.locator('input[name="cEmail"]').first()
      .isVisible({ timeout: 2_000 }).catch(() => false);
    const body = ((await page.textContent("body").catch(() => "")) ?? "").slice(0, 4_000);
    return classifyConfirmation(still, body);
  },
};
