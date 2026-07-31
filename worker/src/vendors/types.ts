import type { Page } from "playwright";

/**
 * A vendor adapter: everything that differs between ATS platforms.
 *
 * WHY ADAPTERS AND NOT ONE CLEVER DRIVER. Recon on three real vendors (see
 * RECON.md) found no property shared by all of them. SmartRecruiters has labels
 * and no name attributes; Breezy has name attributes and no labels. One puts
 * requiredness in the `required` attribute, the other only in JavaScript. Their
 * apply controls read "I'm interested", "Apply To Position" and "Apply Here .xx"
 * — the last written by the employer, not the vendor.
 *
 * A generic driver has to guess, and a guess that half-works is worse than a
 * refusal: it fills four fields out of nine and submits something incoherent
 * under a real person's name.
 *
 * So the shared driver keeps only what is genuinely universal — the safety
 * rules, which are about consequences rather than markup — and everything
 * vendor-shaped lives here.
 */
export interface VendorAdapter {
  readonly key: string;

  /**
   * Turn the URL we stored into the URL the form actually lives at.
   *
   * Our board stores the job-description URL. On Breezy the form is that URL
   * plus `/apply`; on SmartRecruiters it is a different host path reached via a
   * link. Getting this wrong is the single most common way to "fail" a posting
   * that was always fillable — the driver lands on a description page, finds no
   * form, and reports the posting broken.
   *
   * Return null when the form cannot be located, so the caller can say so
   * plainly instead of pressing on.
   */
  resolveFormUrl(page: Page, postingUrl: string): Promise<string | null>;

  /**
   * Map a packet field to a locator on this vendor's form.
   *
   * Returns null when this vendor has no such field — a normal, expected answer,
   * not a failure. Not every form asks for a LinkedIn URL.
   */
  locate(page: Page, field: PacketFieldKey): Promise<Locatable | null>;

  /** The file input for the résumé. Named explicitly because more than one file input is common. */
  locateResume(page: Page): Promise<Locatable | null>;

  /**
   * Advance a multi-step form, or submit it.
   *
   * Returns `submitted` only when this adapter believes the final submit has
   * been pressed. `advanced` means a step boundary was crossed and there is more
   * to fill. `stuck` means neither — the caller must not guess.
   */
  proceed(page: Page): Promise<"advanced" | "submitted" | "stuck">;

  /**
   * What proceed() WOULD do, without doing it.
   *
   * Exists so a dry run can report the real answer instead of guessing. The
   * first version of the dry run checked for buttons reading "submit
   * application" or "continue" and declared Personio STUCK — because its button
   * says "Bewerbung senden". That is the same mistake the adapters exist to
   * avoid: identifying a control by its words.
   *
   * proceed() MUST delegate to this and act on the answer, so the two can never
   * disagree about what the page offers.
   */
  canProceed(page: Page): Promise<"would-advance" | "would-submit" | "stuck">;

  /**
   * Required fields on THIS form that this adapter has no answer for.
   *
   * The real ceiling on unattended applying, and it is not CAPTCHAs. Sampling
   * eight live Breezy postings on 2026-07-31: three had a bare form and could
   * have been completed; five carried employer screening questions — radio
   * groups, checkbox groups, extra file uploads, consent boxes — that no packet
   * can answer. Those five would be refused before submit, correctly.
   *
   * Returns NULL, never an empty array, when the vendor does not put requiredness
   * in the `required` attribute. Personio and SmartRecruiters mark fields with an
   * asterisk in the label and enforce in JavaScript, so counting the attribute
   * there returns zero and would read as "nothing missing" — a false clean on
   * exactly the question this exists to answer.
   */
  unansweredRequired(page: Page): Promise<string[] | null>;

  /**
   * Did the application land? Vendor-specific because confirmation wording is.
   *
   * MUST return "unknown" when unsure. A false "yes" records a send that never
   * happened; a false "no" invites a retry, and a duplicate application under a
   * real name cannot be withdrawn. Unknown is the honest and safe answer, and it
   * routes to a human.
   */
  confirmed(page: Page): Promise<"yes" | "no" | "unknown">;

  /**
   * Does this vendor express requiredness in the `required` attribute?
   *
   * SmartRecruiters does not — it marks fields with an asterisk in the label and
   * enforces in JavaScript. The shared driver uses this to know whether its
   * empty-required-field check is meaningful here, rather than running a check
   * that always passes and counting it as protection.
   */
  readonly requiredAttributeIsTrustworthy: boolean;
}

/** Anything the driver can fill or click, kept narrow so adapters stay simple. */
export interface Locatable {
  fill(value: string): Promise<void>;
  setFile(path: string): Promise<void>;
  isVisible(): Promise<boolean>;
}

/**
 * The fields a packet can carry. Deliberately a closed set: an adapter that
 * cannot map one returns null, and the driver decides what that costs.
 */
export type PacketFieldKey =
  | "fullName" | "firstName" | "lastName"
  | "email" | "confirmEmail" | "phone"
  | "city" | "country" | "address"
  | "linkedin" | "website"
  | "coverNote" | "salaryExpectation";
