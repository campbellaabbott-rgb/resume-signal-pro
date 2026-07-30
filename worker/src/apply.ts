// The form driver: load a real application page, fill it, submit it.
//
// WHY A BROWSER AND NOT AN HTTP POST. Measured 2026-07-30 across 674 apply
// pages: every zero-CAPTCHA vendor ships 0% postable forms — no
// <input name=...> exists in the HTML at all, because the form is built by
// JavaScript after load. There is nothing for an HTTP client to POST to. That is
// the whole reason this worker exists as a separate service: Supabase edge
// functions run Deno with no browser binary.
//
// THE ONE RULE THIS FILE IS BUILT AROUND: an ambiguous outcome is never a
// retry. If a submit times out we do not know whether the application landed.
// Retrying "to be safe" is how one application becomes two under a real person's
// name, at a real employer, with no way to take it back. Uncertainty is recorded
// as uncertainty and handed to a human — it is never resolved by guessing.
import type { Browser, Page } from "playwright";

export type PacketField = { value: string; source: string };

export type ApplyInput = {
  applyUrl: string;
  source: string;
  fields: Record<string, PacketField>;
  resumePath?: string;
};

export type ApplyOutcome =
  /** The page showed a confirmation we recognised. Safe to stamp as sent. */
  | { kind: "submitted"; evidence: string }
  /** We never pressed submit. Nothing was sent; safe to try again later. */
  | { kind: "not-submitted"; reason: string }
  /** We pressed submit and could not confirm. NEVER retried, always escalated. */
  | { kind: "uncertain"; reason: string; screenshot?: Buffer };

const SETTLE_MS = 2_500;
const NAV_TIMEOUT = 45_000;
const SUBMIT_WAIT = 20_000;

// Confirmation language across the vendors in the auto tier. Deliberately
// conservative: a phrase we are not sure about produces `uncertain`, which a
// human resolves, rather than a false "sent" that hides a failed application.
const CONFIRMED = [
  /thank you for (?:your )?appl/i,
  /application (?:has been )?(?:received|submitted|complete)/i,
  /we(?:'ve| have) received your application/i,
  /your application was sent/i,
  /submission (?:was )?successful/i,
];

/** Match a form control to a packet field by label, name, placeholder or aria. */
async function fillByLabel(page: Page, label: string, value: string): Promise<boolean> {
  const escaped = label.replace(/["\\]/g, "").trim();
  if (!escaped || !value) return false;
  const attempts = [
    () => page.getByLabel(new RegExp(escaped.slice(0, 40), "i")).first(),
    () => page.locator(`input[name*="${(escaped.split(/\s+/)[0] ?? escaped).toLowerCase()}" i]`).first(),
    () => page.getByPlaceholder(new RegExp(escaped.slice(0, 30), "i")).first(),
    () => page.locator(`[aria-label*="${escaped.slice(0, 30)}" i]`).first(),
  ];
  for (const get of attempts) {
    try {
      const el = get();
      if (await el.count() === 0) continue;
      if (!(await el.isVisible({ timeout: 1_500 }).catch(() => false))) continue;
      const tag = await el.evaluate((n: Element) => n.tagName.toLowerCase()).catch(() => "");
      if (tag === "select") await el.selectOption({ label: value }).catch(() => el.selectOption(value));
      else await el.fill(value, { timeout: 5_000 });
      return true;
    } catch { /* try the next strategy */ }
  }
  return false;
}

export async function applyToPosting(browser: Browser, input: ApplyInput): Promise<ApplyOutcome> {
  const ctx = await browser.newContext({
    // A normal desktop browser. NOT a spoofed fingerprint — these vendors were
    // measured to carry no CAPTCHA and no challenge wall, so there is nothing to
    // evade and no reason to pretend to be something we are not.
    viewport: { width: 1280, height: 900 },
    acceptDownloads: false,
  });
  const page = await ctx.newPage();

  try {
    const resp = await page.goto(input.applyUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    if (!resp || resp.status() >= 400) {
      return { kind: "not-submitted", reason: `page returned ${resp?.status() ?? "no response"}` };
    }
    await page.waitForTimeout(SETTLE_MS); // the form is JS-built; give it a beat

    // A posting that has come down since the packet was prepared. Common — the
    // board's own 30-day rule means packets can outlive their postings.
    const body = (await page.textContent("body").catch(() => "")) ?? "";
    if (/no longer accepting|position (?:has been )?closed|posting (?:is )?closed|not found/i.test(body)) {
      return { kind: "not-submitted", reason: "posting is closed" };
    }

    // Some vendors put the form behind an Apply button rather than on the page.
    for (const name of [/^apply(?: now| for this job)?$/i, /^start (?:your )?application$/i]) {
      const btn = page.getByRole("button", { name }).first();
      if (await btn.count() && await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(SETTLE_MS);
        break;
      }
    }

    // A CAPTCHA that appears despite the vendor measuring clean. Vendors change
    // their protection; the measurement is a snapshot, not a guarantee. Stop —
    // do not attempt, do not solve, do not evade.
    const html = await page.content();
    if (/recaptcha|hcaptcha|turnstile|arkoselabs/i.test(html)) {
      return { kind: "not-submitted", reason: "captcha appeared on a vendor measured clean — needs a human" };
    }

    let filled = 0;
    for (const [label, f] of Object.entries(input.fields)) {
      if (await fillByLabel(page, label, f.value)) filled++;
    }

    // A file input the packet has no file for is a hard stop, not a shrug. The
    // required-field check below would catch it on a well-marked form, but plenty
    // of forms leave the résumé input unmarked and simply reject on submit — and
    // a rejected submit is an ambiguous outcome, which costs a human's time to
    // resolve. Better to refuse here where the reason is knowable.
    const fileInput = page.locator('input[type="file"]').first();
    const hasFileField = (await fileInput.count()) > 0;
    if (hasFileField) {
      if (!input.resumePath) {
        return { kind: "not-submitted", reason: "this form wants a résumé file and none is attached to the profile" };
      }
      try {
        await fileInput.setInputFiles(input.resumePath, { timeout: 15_000 });
      } catch (e) {
        return { kind: "not-submitted", reason: `résumé upload failed: ${String(e).slice(0, 90)}` };
      }
      // Give the vendor's uploader a moment; several parse the file and rewrite
      // the form's name/email fields from it, which would otherwise race us.
      await page.waitForTimeout(SETTLE_MS);
    }

    // Refuse to submit a form we mostly failed to fill. A half-filled
    // application is worse than none: it burns the posting for that candidate,
    // and the duplicate guard will stop them applying properly later.
    const expected = Object.keys(input.fields).length;
    if (expected > 0 && filled < Math.ceil(expected * 0.6)) {
      return { kind: "not-submitted", reason: `only filled ${filled}/${expected} fields — refusing to submit a partial application` };
    }

    // Required fields the packet had nothing for. The DOM is the authority here,
    // not our expectation of the form.
    const emptyRequired = await page.locator("input[required], select[required], textarea[required]")
      .evaluateAll((els: Element[]) => els.filter((e) => !(e as HTMLInputElement).value).length).catch(() => 0);
    if (emptyRequired > 0) {
      return { kind: "not-submitted", reason: `${emptyRequired} required field(s) the packet could not answer` };
    }

    const submit = page.getByRole("button", { name: /^(submit|send) (?:application|now)?$|^submit$|^apply$/i }).first();
    if (!(await submit.count())) {
      return { kind: "not-submitted", reason: "no submit control found" };
    }

    // EVERYTHING BEFORE THIS LINE IS REVERSIBLE. Everything after is not.
    await submit.click({ timeout: 10_000 });

    try {
      await page.waitForLoadState("networkidle", { timeout: SUBMIT_WAIT });
    } catch {
      // Timed out waiting. We pressed submit; it may or may not have landed.
      return {
        kind: "uncertain",
        reason: "submitted but the page never settled — outcome unknown, not retrying",
        screenshot: await page.screenshot().catch(() => undefined),
      };
    }

    const after = ((await page.textContent("body").catch(() => "")) ?? "").slice(0, 4_000);
    const hit = CONFIRMED.find((re) => re.test(after));
    if (hit) return { kind: "submitted", evidence: (after.match(hit)?.[0] ?? "confirmed").slice(0, 120) };

    // No confirmation we recognise. It may have worked; it may have failed
    // validation. We do not know, so we say we do not know.
    return {
      kind: "uncertain",
      reason: "no confirmation message recognised after submit",
      screenshot: await page.screenshot().catch(() => undefined),
    };
  } catch (e) {
    return { kind: "not-submitted", reason: `driver error: ${String(e).slice(0, 160)}` };
  } finally {
    await ctx.close().catch(() => {});
  }
}
