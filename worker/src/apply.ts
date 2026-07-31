// The form driver. Vendor-agnostic on purpose: everything that differs between
// ATS platforms lives in src/vendors/, and what remains here is the set of rules
// about CONSEQUENCES, which are the same everywhere.
//
// WHY THIS WAS REWRITTEN. The first version tried to fill any form by guessing
// at labels, names, placeholders and aria-labels in turn. Recon on three live
// vendors (worker/RECON.md) found it would have failed on all three, and not one
// of those failures was a CAPTCHA:
//   - SmartRecruiters: stored URL is a description page; the form is behind a
//     link reading "I'm interested"; fields have no name attributes and live in
//     1,806 shadow roots; the page ends in "Next", not submit.
//   - Breezy: form is at {url}/apply; fields have names but no labels.
//   - Teamtailor: apply control reads "Apply Here .xx" — written by the
//     employer, so no vendor-level text pattern can match it.
//
// The lesson is that a driver cannot be written from imagination. It can only be
// written from observation, per vendor. What CAN be written once is this: the
// rules about what must never happen.
import type { Browser, Page } from "playwright";
import { adapterFor, BLOCKED } from "./vendors/index.js";
import type { PacketFieldKey, VendorAdapter } from "./vendors/types.js";
import { planAnswers, type StandingAnswers } from "./questions/match.js";
import { applyResolution } from "./questions/answer.js";

export type PacketField = { value: string; source: string };

export type ApplyInput = {
  /** The candidate's own standing answers to screening questions. Omitted =
   *  no screening question can be answered, so any form that asks one is
   *  refused rather than part-filled. */
  answers?: StandingAnswers;
  applyUrl: string;
  source: string;
  /** Keyed by PacketFieldKey. Anything the adapter cannot place is reported, not guessed at. */
  fields: Partial<Record<PacketFieldKey, PacketField>>;
  resumePath?: string;
};

export type ApplyOutcome =
  /** A confirmation was recognised. Safe to stamp as sent. */
  | { kind: "submitted"; evidence: string }
  /** Submit was never pressed. Nothing was sent; safe to try again later. */
  | { kind: "not-submitted"; reason: string }
  /** Submit was pressed and the result is unknown. NEVER retried, always escalated. */
  | { kind: "uncertain"; reason: string; screenshot?: Buffer };

const SETTLE_MS = 2_500;
const SUBMIT_WAIT = 20_000;
const MAX_STEPS = 6;

export async function applyToPosting(browser: Browser, input: ApplyInput): Promise<ApplyOutcome> {
  const source = String(input.source ?? "").toLowerCase();

  if (BLOCKED[source]) {
    return { kind: "not-submitted", reason: `${source}: ${BLOCKED[source]}` };
  }
  const adapter = adapterFor(source);
  if (!adapter) {
    // Refusing an un-examined vendor is the point, not a limitation. Shipping a
    // guessed adapter is what this whole rewrite exists to prevent.
    return { kind: "not-submitted", reason: `${source} has no adapter — no recon has been done on it` };
  }

  const ctx = await browser.newContext({
    // A normal desktop browser. NOT a spoofed fingerprint — these vendors were
    // measured to carry no CAPTCHA and no challenge wall, so there is nothing to
    // evade and no reason to pretend to be something we are not.
    viewport: { width: 1280, height: 900 },
    acceptDownloads: false,
  });
  const page = await ctx.newPage();

  try {
    const formUrl = await adapter.resolveFormUrl(page, input.applyUrl);
    if (!formUrl) {
      // Distinguished from "the form defeated us": we never found it. On the old
      // driver this surfaced as "no submit control found", which read like a
      // broken posting and hid a fixable URL problem.
      return { kind: "not-submitted", reason: "could not find the application form from this posting URL" };
    }
    await page.waitForTimeout(SETTLE_MS);

    const body = (await page.textContent("body").catch(() => "")) ?? "";
    if (/no longer accepting|position (?:has been )?closed|posting (?:is )?closed|not found/i.test(body)) {
      return { kind: "not-submitted", reason: "posting is closed" };
    }

    // Vendors change their protection; the measurement is a snapshot, not a
    // guarantee. Stop — do not attempt, do not solve, do not evade.
    if (/recaptcha|hcaptcha|turnstile|arkoselabs/i.test(await page.content())) {
      return { kind: "not-submitted", reason: "captcha appeared on a vendor measured clean — needs a human" };
    }

    // ---- fill, stepping through the form as the adapter directs ----
    const wanted = Object.keys(input.fields) as PacketFieldKey[];
    const placed = new Set<PacketFieldKey>();
    let resumeAttached = false;
    // Answered questions persist across steps: a multi-step wizard keeps earlier
    // steps in the DOM, and re-answering would re-click a radio (toggling
    // nothing) or re-fill a field the vendor has since reformatted.
    const answeredNames = new Set<string>();
    let submittedAt = -1;

    for (let step = 0; step < MAX_STEPS; step++) {
      for (const key of wanted) {
        if (placed.has(key)) continue;
        const field = input.fields[key];
        if (!field?.value) continue;
        const target = await adapter.locate(page, key).catch(() => null);
        if (!target || !(await target.isVisible())) continue;
        await target.fill(field.value).then(() => { placed.add(key); }, () => {});
      }

      if (!resumeAttached && input.resumePath) {
        const file = await adapter.locateResume(page).catch(() => null);
        if (file) {
          await file.setFile(input.resumePath).then(() => { resumeAttached = true; }, () => {});
          // Several vendors parse the CV and rewrite name/email from it, which
          // would otherwise race the fields just filled.
          await page.waitForTimeout(SETTLE_MS);
        }
      }

      // A form that wants a CV and has not got one is a hard stop. The old
      // driver leaned on the required-field check for this; on SmartRecruiters
      // that check is inert, so it is checked directly.
      if (!resumeAttached && input.resumePath === undefined) {
        const anyFile = await adapter.locateResume(page).catch(() => null);
        if (anyFile) {
          return { kind: "not-submitted", reason: "this form wants a résumé and none is attached to the profile" };
        }
      }

      // ---- employer screening questions ----
      //
      // The binding constraint on unattended applying, measured: not CAPTCHAs.
      // Across 8 live Breezy postings only 3 could be completed from the mapped
      // identity fields alone; answering these questions from the candidate's
      // own standing answers took it to 7.
      //
      // Everything here is an answer the candidate gave. Anything else refuses.
      const asked = await adapter.enumerateQuestions(page).catch(() => null);
      if (asked === null) {
        // Could not read the form. NOT the same as "the form asks nothing" —
        // treating a failed probe as a clean bill of health is how an
        // unanswered required question reaches an employer.
        return { kind: "not-submitted", reason: "could not read this form's questions — not submitting blind" };
      }
      if (asked.length > 0) {
        const answers = input.answers;
        if (!answers) {
          const required = asked.filter((x) => x.required && !adapter.mappedNames.has(x.name));
          if (required.length > 0) {
            return { kind: "not-submitted", reason: `form asks ${required.length} question(s) and no standing answers are on file` };
          }
        } else {
          const { answerable, blocking } = planAnswers(asked, answers, adapter.mappedNames);
          if (blocking.length > 0) {
            const why = blocking.slice(0, 3)
              .map((b: { r: { kind: string; category?: string; why?: string } }) => (b.r.kind === "unanswerable" ? `${b.r.category}: ${b.r.why}` : ""))
              .filter(Boolean).join("; ");
            return {
              kind: "not-submitted",
              reason: `${blocking.length} required question(s) the agent cannot answer — ${why}`,
            };
          }
          for (const { q: dq, r } of answerable) {
            if (answeredNames.has(dq.name)) continue;
            const res = await applyResolution(page, dq, r);
            if (res.ok) { answeredNames.add(dq.name); continue; }
            // A REQUIRED question that would not take its answer stops the run.
            // Pressing on submits a form the vendor will reject, which burns the
            // posting for this candidate and then trips the duplicate guard when
            // they try to apply properly themselves.
            if (dq.required) {
              return { kind: "not-submitted", reason: `could not answer "${dq.label || dq.name}": ${res.why}` };
            }
          }
        }
      }

      const unplaced = wanted.filter((k) => !placed.has(k) && input.fields[k]?.value);
      const guard = await preSubmitGuard(page, adapter, wanted.length, placed.size, unplaced);
      if (guard) return guard;

      const step_result = await adapter.proceed(page).catch(() => "stuck" as const);
      if (step_result === "stuck") {
        return {
          kind: "not-submitted",
          reason: `stopped at step ${step + 1}: no way forward found (${placed.size}/${wanted.length} fields placed)`,
        };
      }
      if (step_result === "submitted") { submittedAt = step; break; }
      await page.waitForTimeout(SETTLE_MS);
    }

    if (submittedAt < 0) {
      return { kind: "not-submitted", reason: `form still unfinished after ${MAX_STEPS} steps — not submitting a partial application` };
    }

    // EVERYTHING BEFORE THIS POINT IS REVERSIBLE. Nothing after it is.
    try {
      await page.waitForLoadState("networkidle", { timeout: SUBMIT_WAIT });
    } catch {
      return {
        kind: "uncertain",
        reason: "submitted but the page never settled — outcome unknown, not retrying",
        screenshot: await page.screenshot().catch(() => undefined),
      };
    }

    const verdict = await adapter.confirmed(page).catch(() => "unknown" as const);
    if (verdict === "yes") {
      return { kind: "submitted", evidence: `${adapter.key} confirmed after step ${submittedAt + 1}` };
    }
    if (verdict === "no") {
      // Only asserted where an adapter has real evidence — e.g. Breezy still
      // showing the same form. Nothing was sent, so this is safely retryable.
      return { kind: "not-submitted", reason: "submit did not take; the form is still showing" };
    }
    return {
      kind: "uncertain",
      reason: "no confirmation recognised after submit",
      screenshot: await page.screenshot().catch(() => undefined),
    };
  } catch (e) {
    return { kind: "not-submitted", reason: `driver error: ${String(e).slice(0, 160)}` };
  } finally {
    await ctx.close().catch(() => {});
  }
}

/**
 * The two checks that must pass before any submit, and an honest account of what
 * each is worth on this vendor.
 */
async function preSubmitGuard(
  page: Page,
  adapter: VendorAdapter,
  expected: number,
  placedCount: number,
  unplaced: PacketFieldKey[],
): Promise<ApplyOutcome | null> {
  // A half-filled application is worse than none: it burns the posting for that
  // candidate, and the duplicate guard then stops them applying properly later.
  if (expected > 0 && placedCount < Math.ceil(expected * 0.6)) {
    return {
      kind: "not-submitted",
      reason: `only placed ${placedCount}/${expected} fields (missing: ${unplaced.join(", ")}) — refusing to submit a partial application`,
    };
  }

  // Only meaningful where the vendor actually sets the attribute. On
  // SmartRecruiters it is absent on every field and requiredness lives in
  // JavaScript, so running this there would return zero and be counted as
  // protection it did not provide. Skipping it honestly is better than passing
  // it hollowly.
  if (adapter.requiredAttributeIsTrustworthy) {
    const emptyRequired = await page
      .locator("input[required], select[required], textarea[required]")
      .evaluateAll((els: Element[]) => els.filter((e) => !(e as HTMLInputElement).value).length)
      .catch(() => 0);
    if (emptyRequired > 0) {
      return { kind: "not-submitted", reason: `${emptyRequired} required field(s) the packet could not answer` };
    }
  }

  return null;
}
