import type { Page, Locator } from "playwright";
import type { VendorAdapter, Locatable, PacketFieldKey } from "./types.js";

/**
 * Pinpoint. Rails-shaped and the most honest markup of the six.
 *
 * Observed on a live posting 2026-07-30 (see RECON.md):
 *   - Form at `{posting}/applications/new`. NOT `/application` — my first note
 *     said that because the href in the probe output was truncated at 60
 *     characters and I wrote down what I could see rather than what was there.
 *     Navigating to the guessed URL returned 404, which is the only reason it
 *     was caught.
 *   - Nested `name` attributes: application_form[application][first_name] and
 *     so on. Stable, semantic, unambiguous.
 *   - `required` set on 9 fields, INCLUDING the employer's own custom questions.
 *     That makes the empty-required check meaningful here.
 *   - One file input, plainly named [cv].
 *   - Employer custom questions arrive as `answers_attributes`. On the posting
 *     examined one was required and asked for salary expectations in free text.
 *     Those are deliberately NOT mapped: an adapter cannot know what an employer
 *     asked, and the packet must answer or the submission must not happen.
 */
const wrap = (l: Locator): Locatable => ({
  fill: async (v) => { await l.fill(v, { timeout: 8_000 }); },
  setFile: async (p) => { await l.setInputFiles(p, { timeout: 20_000 }); },
  isVisible: () => l.isVisible({ timeout: 3_000 }).catch(() => false),
});

const f = (k: string) => `[name="application_form[application][${k}]"]`;

const FIELDS: Partial<Record<PacketFieldKey, string>> = {
  firstName: f("first_name"),
  lastName: f("last_name"),
  email: f("email"),
  phone: f("phone"),
  linkedin: f("linkedin_url"),
  address: f("address1"),
  coverNote: f("summary"),
};

export const pinpoint: VendorAdapter = {
  key: "pinpoint",

  // Set on 9 fields including the employer's required custom questions, so a
  // packet that cannot answer one is genuinely caught before submit.
  requiredAttributeIsTrustworthy: true,

  async resolveFormUrl(page, postingUrl) {
    const base = postingUrl.replace(/[?#].*$/, "").replace(/\/+$/, "");
    const url = `${base}/applications/new`;
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 })
      .catch(() => null);
    // A 404 here is exactly how the wrong URL rule was caught, so the status is
    // checked rather than assumed.
    if (!resp || resp.status() >= 400) return null;
    await page.waitForTimeout(2_000);
    const ok = await page.locator(f("email")).count().catch(() => 0);
    return ok > 0 ? url : null;
  },

  async locate(page, field) {
    const sel = FIELDS[field];
    if (!sel) return null;
    const l = page.locator(sel).first();
    return (await l.count()) > 0 ? wrap(l) : null;
  },

  async locateResume(page) {
    const l = page.locator(f("cv")).first();
    return (await l.count()) > 0 ? wrap(l) : null;
  },

  async proceed(page) {
    // "Save application for later" sits beside the real submit. Matching it by
    // accident would silently park the application as a draft that no employer
    // ever sees, while every signal we have says it was sent — anchored exactly
    // to avoid that.
    const submit = page.getByRole("button", { name: /^submit application$/i }).first();
    if (await submit.count() && await submit.isVisible().catch(() => false)) {
      await submit.click({ timeout: 10_000 });
      return "submitted";
    }
    return "stuck";
  },

  async confirmed(page) {
    const body = ((await page.textContent("body").catch(() => "")) ?? "").slice(0, 4_000);
    if (/thank you|application (?:has been )?(?:received|submitted)|we(?:'ve| have) received/i.test(body)) {
      return "yes";
    }
    if (await page.locator(f("email")).count().catch(() => 0)) return "no";
    return "unknown";
  },
};
