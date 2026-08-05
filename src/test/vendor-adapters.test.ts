import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Golden fixtures: do the adapters still target fields the vendors actually have?
 *
 * Every selector in every adapter is checked against a snapshot of what a REAL
 * rendered form presented on 2026-07-30. If a vendor renames `cEmail` or drops
 * `documents.cv`, this fails on the next commit instead of surfacing weeks later
 * as applications quietly sent with half their fields blank under a real
 * person's name.
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM. It is a structural check, not a live
 * run. It cannot see a form becoming multi-step, a new CAPTCHA, or Playwright's
 * locator behaviour in shadow DOM. Saved HTML would not have helped either —
 * personio serves 0 inputs and pinpoint 9 of 56, so a saved page for those would
 * look like a fixture and be a fiction. Only breezy's server HTML is complete
 * enough to keep, and it is kept.
 */
const root = resolve(__dirname, "../..");
const fixDir = resolve(root, "worker/src/vendors/__fixtures__");
const observed = JSON.parse(readFileSync(resolve(fixDir, "observed-fields.json"), "utf8"));
const src = (f: string) => readFileSync(resolve(root, "worker/src/vendors", f), "utf8");

/**
 * Strip comments before matching anything.
 *
 * My first version of the decoy test matched "Save application for later" in
 * pinpoint.ts and failed — on the COMMENT explaining why that control must not
 * be clicked. A test that reads prose rather than code will fail exactly when
 * someone documents the hazard well, which teaches people to stop documenting.
 */
const codeOnly = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Pull the field names an adapter targets.
 *
 * Handles both literal selectors and pinpoint's `f("first_name")` helper, which
 * builds `[name="application_form[application][first_name]"]` from a template.
 * My first version returned the raw template — `...[${k}]` — and reported the
 * adapter as targeting a field no form has. The adapter was right; the reader
 * was wrong.
 */
const selectorsIn = (raw: string): string[] => {
  const code = codeOnly(raw);
  const out = new Set<string>();

  // Adapters declare bare attribute names in a KEYS map and derive selectors
  // from them, so this reads the names rather than parsing selectors back out.
  //
  // It has now been wrong twice in opposite directions. First it returned
  // pinpoint's unresolved template `...[${k}]`. Then, when the adapters gained a
  // regex to strip selectors at runtime, it read the regex's own
  // `[name="([^"]+)"]` as a targeted field. Both times the adapter was right and
  // the reader was wrong — which is why the adapters no longer parse selectors
  // at runtime at all, and why this matches declarations instead of patterns.
  const keysBlock = code.match(/const\s+(?:KEYS|FIELD_KEYS)\b[^=]*=\s*\{([\s\S]*?)\}/);
  if (keysBlock) {
    // An optional name template: const n = (k: string) => `prefix${k}suffix`
    const tpl = code.match(/const\s+n\s*=\s*\([^)]*\)\s*=>\s*`([^$]*)\$\{k\}([^`]*)`/);
    const wrap = (v: string) => (tpl ? `${tpl[1]}${v}${tpl[2]}` : v);
    for (const m of keysBlock[1].matchAll(/:\s*"([^"]+)"/g)) out.add(wrap(m[1]));
    const resume = code.match(/const\s+RESUME_KEY\s*=\s*"([^"]+)"/);
    if (resume) out.add(wrap(resume[1]));
  }

  // Literal selectors, for adapters that still write them out.
  for (const m of code.matchAll(/\[name="([^"$]+)"\]/g)) out.add(m[1]);
  return [...out];
};

describe("adapter selectors still match what the vendors present", () => {
  const NAME_MATCHED: Array<[string, string]> = [
    ["breezy", "breezy.ts"],
    ["personio", "personio.ts"],
    ["pinpoint", "pinpoint.ts"],
    ["teamtailor", "teamtailor.ts"],
  ];

  it("has a fixture for every adapter that ships", () => {
    // Guards the guard: an adapter added without recon would otherwise sail
    // past this file untested, which is the exact failure the whole
    // observation-first rule exists to prevent.
    const index = src("index.ts");
    const shipped = [...index.matchAll(/^\s{2}([a-z]+),$/gm)].map((m) => m[1]);
    expect(shipped.length, "no adapters found — the matcher broke").toBeGreaterThan(0);
    for (const key of shipped) {
      expect(observed[key], `${key} ships without an observed-fields entry`).toBeTruthy();
    }
  });

  for (const [vendor, file] of NAME_MATCHED) {
    it(`${vendor}: every targeted field exists on the real form`, () => {
      const used = selectorsIn(src(file));
      expect(used.length, `${vendor} adapter targets nothing`).toBeGreaterThan(0);
      const real: string[] = observed[vendor].names;
      const missing = used.filter((s) => !real.includes(s));
      expect(missing, `${vendor} targets fields the live form does not have: ${missing.join(", ")}`)
        .toEqual([]);
    });

    it(`${vendor}: the résumé field is the one the vendor names for a CV`, () => {
      const code = src(file);
      const expected = observed[vendor].resumeField;
      if (!expected) return; // breezy names it inline; covered by the check above
      // Resolved through the same extractor, because pinpoint builds this
      // selector with its `f()` helper rather than writing it out.
      expect(selectorsIn(code), `${vendor} must attach the CV to ${expected}`).toContain(expected);
    });
  }

  it("smartrecruiters is NOT served — the vendor refuses headless browsers", () => {
    // Measured 2026-07-31: its apply URL returns 403 to headless and 200 to
    // headed, same URL and machine, seconds apart. No CAPTCHA, no challenge —
    // just a 403 that reads like a broken link.
    //
    // The adapter is written and correct. Serving it again means either spoofing
    // the user agent or hiding behind a virtual display, which is the same line
    // as solving a CAPTCHA. This test exists so that re-adding it has to be a
    // decision someone makes, not a line someone restores.
    const index = codeOnly(src("index.ts"));
    const shipped = index.slice(index.indexOf("ADAPTERS"), index.indexOf("NEEDS_RECON"));
    expect(shipped, "smartrecruiters must not be in ADAPTERS while it 403s headless")
      .not.toMatch(/\bsmartrecruiters\b/);
    expect(index).toMatch(/smartrecruiters:.*403/);
    expect(observed.smartrecruiters.servable, "fixture must record the refusal").toBe(false);
  });

  it("smartrecruiters' adapter still matches labels the form shows", () => {
    // The only label-matched adapter, because it is the only vendor with no
    // name attributes at all.
    const code = src("smartrecruiters.ts");
    const labels: string[] = observed.smartrecruiters.labels;
    for (const key of ["first name", "last name", "email", "city", "linkedin", "website"]) {
      expect(code.toLowerCase(), `smartrecruiters should target ${key}`).toContain(key);
      expect(
        labels.some((l) => l.toLowerCase().includes(key)),
        `the real form no longer shows a label containing "${key}"`,
      ).toBe(true);
    }
  });

  it("declares requiredAttributeIsTrustworthy to match what the form does", () => {
    // The subtlest failure available here: a vendor that does not set `required`
    // while the adapter claims it does. The driver would then run an
    // empty-required check that always passes and count it as protection.
    for (const [vendor, file] of [...NAME_MATCHED, ["smartrecruiters", "smartrecruiters.ts"] as [string, string]]) {
      const claims = /requiredAttributeIsTrustworthy:\s*true/.test(src(file));
      const truth = observed[vendor].requiredAttributeIsTrustworthy === true;
      expect(claims, `${vendor} claims trustworthy=${claims} but the form says ${truth}`).toBe(truth);
      if (truth) {
        expect(observed[vendor].fieldsWithRequiredAttr, `${vendor} claims trustworthy with 0 required fields`)
          .toBeGreaterThan(0);
      }
    }
  });
});

describe("the rules that keep a real employer from getting nonsense", () => {
  it("no adapter targets a honeypot", () => {
    // Oracle ships name="honey-pot": invisible to a person, so anything filling
    // it is provably not one. Filling it would announce us on a vendor with no
    // CAPTCHA, and the rejections would read as bad luck.
    for (const file of ["breezy.ts", "personio.ts", "pinpoint.ts", "teamtailor.ts", "smartrecruiters.ts"]) {
      for (const sel of selectorsIn(src(file))) {
        expect(/honey.?pot|bot.?trap|^hp_/i.test(sel), `${file} targets a honeypot: ${sel}`).toBe(false);
      }
    }
    expect(observed.oracle.honeypotField, "oracle's honeypot must stay on record").toBe("honey-pot");
  });

  it("pinpoint does not click the draft-saving decoy", () => {
    // "Save application for later" sits beside the real submit. Clicking it
    // parks a draft no employer ever sees, while every signal we have says the
    // application was sent — a false positive that is worse than a failure.
    const code = codeOnly(src("pinpoint.ts"));
    expect(code).toMatch(/\^submit application\$/i);
    expect(code, "must not match the save-for-later control").not.toMatch(/save application for later/i);
  });

  it("oracle and workday stay out of the shipped adapters", () => {
    const index = src("index.ts");
    const shipped = index.slice(index.indexOf("ADAPTERS"), index.indexOf("NEEDS_RECON"));
    // Oracle needs a decision about accepting an employer's terms on someone's
    // behalf; workday needs per-tenant accounts nobody has built. Neither is a
    // coding gap, and neither should be quietly closed by an adapter.
    expect(shipped).not.toMatch(/\boracle\b/);
    expect(shipped).not.toMatch(/\bworkday\b/);
    expect(index).toMatch(/workday:/);
  });

  it("breezy's saved HTML still contains the fields the adapter targets", () => {
    // The one vendor whose server HTML is complete, so this is a genuine
    // end-to-end check of selector against markup rather than against a summary.
    const html = readFileSync(resolve(fixDir, "breezy.html"), "utf8");
    for (const sel of selectorsIn(src("breezy.ts"))) {
      expect(html, `breezy.html has no field named ${sel}`).toContain(`name="${sel}"`);
    }
  });
});

describe("a false 'not submitted' is the dangerous direction", () => {
  /**
   * FOUND BY A DRY RUN ON A LIVE BREEZY FORM, 2026-07-31.
   *
   * Breezy is a JS wizard: every step shares one <form>, and "Submit
   * Application" sits in the DOM at zero size until the last step. So a field
   * being PRESENT after a submit proves nothing — it survives, just hidden.
   *
   * The adapters asserted "no" on presence. A wrong "no" means not-submitted,
   * which the driver treats as safely retryable, which is a SECOND application
   * to the same employer under a real person's name. Neither can be withdrawn.
   *
   * A wrong "yes" loses an application. A wrong "no" creates one. Only the
   * second is unrecoverable, so failure must be asserted from visibility and
   * anything less must fall through to "unknown", which routes to a human.
   */
  for (const file of ["breezy.ts", "personio.ts", "pinpoint.ts", "teamtailor.ts"]) {
    it(`${file} decides from visibility BEFORE it reads the page's words`, () => {
      const code = codeOnly(src(file));
      const confirmed = code.slice(code.indexOf("async confirmed"));

      // All three now delegate to one classifier, so the rule cannot drift
      // between them — it drifted into all three identically once already.
      expect(confirmed, `${file} must use the shared classifier`)
        .toMatch(/classifyConfirmation\(\s*still\s*,\s*body\s*\)/);

      // Visibility must be COMPUTED before the body text is read. This is the
      // ordering that matters: see the shared classifier for why phrases-first
      // recorded failed submits as sent.
      const visAt = confirmed.indexOf("isVisible");
      const bodyAt = confirmed.indexOf('textContent("body")');
      expect(visAt, `${file} no longer checks visibility`).toBeGreaterThan(0);
      expect(visAt, `${file} reads the page's words before checking the form is gone`)
        .toBeLessThan(bodyAt);

      // Presence is still not evidence.
      expect(confirmed, `${file} must not infer from an element merely existing`)
        .not.toMatch(/count\(\)[\s\S]{0,40}return "no"/);
    });
  }
});

describe("classifying a submit outcome — the ordering that lost applications", () => {
  it("a still-visible form means NOT SENT, whatever words are on the page", async () => {
    const { classifyConfirmation } = await import("../../worker/src/vendors/confirmed.js");
    // THE REGRESSION. "Thank you for your interest in this role" is ordinary
    // job-ad copy sitting on the form itself. Testing phrases first matched it
    // on a FAILED submit and recorded the application as sent — the candidate
    // told they applied to a job they did not, and then blocked by the
    // duplicate guard from applying properly.
    expect(classifyConfirmation(true, "Thank you for your interest in this role!"))
      .toBe("no");
    expect(classifyConfirmation(true, "Your application has been received"))
      .toBe("no");
  });

  it("recognises confirmations in the languages these vendors serve", async () => {
    const { classifyConfirmation } = await import("../../worker/src/vendors/confirmed.js");
    for (const said of [
      "Thank you! Your application has been received.",
      "Vielen Dank! Ihre Bewerbung ist bei uns eingegangen.",
      "Merci, votre candidature a bien été reçue.",
      "Gracias, hemos recibido su solicitud.",
      "Bedankt! Je sollicitatie is ontvangen.",
      "Obrigado — a sua candidatura foi recebida.",
    ]) {
      expect(classifyConfirmation(false, said), `should recognise: ${said}`).toBe("yes");
    }
  });

  it("falls to unknown rather than guessing when nothing matches", async () => {
    const { classifyConfirmation } = await import("../../worker/src/vendors/confirmed.js");
    // Every phrase in the list is a guess until a real submission is watched,
    // so a miss must park for a human. It must NOT read as not-submitted:
    // that is treated as safely retryable, and a retry is a second application
    // under a real person's name that cannot be withdrawn.
    expect(classifyConfirmation(false, "All done. Reference #48213.")).toBe("unknown");
    expect(classifyConfirmation(false, "")).toBe("unknown");
  });
});

describe("a honeypot marked REQUIRED is the trap, not the question", () => {
  it("teamtailor's full_email is recorded, and shape — not name — is what finds it", () => {
    // Teamtailor ships an invisible, keyboard-unreachable email field named
    // full_email, next to the real candidate[email], and marks it REQUIRED.
    // Nothing about that name looks like a trap, so the name blocklist sails
    // past it — and "required" is the bait: a driver reasoning "required,
    // therefore answer it" fills it and announces itself to a vendor that has
    // no CAPTCHA. The rejections would read as bad luck.
    expect(observed.teamtailor.honeypot).toBe("full_email");
    // Detection lives in the enumerator and keys on shape, so it travels to
    // vendors whose trap has a different name.
    const enumr = src("enumerate-dom.ts");
    expect(enumr, "honeypot detection must not be name-based").toMatch(/tabindex.*-1|aria-hidden/);
    expect(enumr).toMatch(/honeypot = invisible && unreachable/);
    // A file input styled invisible over a drop zone is the NORMAL way these
    // forms render an upload — flagging those would break every résumé attach.
    expect(enumr, "file inputs must be exempt").toMatch(/type !== "file"/);
  });

  it("the matcher skips a honeypot rather than filling OR blocking on it", async () => {
    const { matchQuestion } = await import("../../worker/src/questions/match.js");
    const trap = { name: "full_email", type: "email", required: true, honeypot: true, label: "", options: [] };
    // null = leave it alone. Filling identifies us; treating it as an
    // unanswerable required field refuses postings that are fine.
    expect(matchQuestion(trap, {
      fullName: "A B", firstName: "A", lastName: "B", email: "a@b.com", phone: "", city: "", country: "",
      address: "", postcode: "", linkedin: "", website: "", coverNote: "", salaryExpectation: "", earliestStart: "",
      workAuthorized: true, requiresSponsorship: false, willingToRelocate: true,
      workAuthorizedCountries: [], shareDemographics: false, consentToProcessing: true,
    })).toBeNull();
  });
  it("recognises the vendors' OWN languages, not just English", async () => {
    const { classifyConfirmation: classifyConfirmationFn } =
      await import("../../worker/src/vendors/confirmed.js");
    // Teamtailor is Swedish and Personio German, and both localise per tenant.
    // A tenant running in its home language previously had no chance of being
    // recognised, so every successful send there would have parked as uncertain
    // — an agent that works and looks broken.
    const cases: Array<[string, string]> = [
      ["Swedish", "Tack för din ansökan! Vi hör av oss."],
      ["Swedish", "Din ansökan har mottagits."],
      ["Norwegian", "Takk for søknaden."],
      ["Danish", "Tak for din ansøgning."],
      ["Finnish", "Kiitos hakemuksestasi."],
      ["Italian", "Grazie! Candidatura ricevuta."],
      ["Polish", "Dziękujemy za zgłoszenie."],
      ["English", "Application complete."],
      ["English", "You have applied to this role."],
      ["English", "We will be in touch shortly."],
    ];
    for (const [lang, said] of cases) {
      expect(classifyConfirmationFn(false, said), `${lang}: ${said}`).toBe("yes");
    }
  });

  it("THE WIDER LIST STILL CANNOT MANUFACTURE A FALSE SUBMITTED", async () => {
    const { classifyConfirmation: classifyConfirmationFn } =
      await import("../../worker/src/vendors/confirmed.js");
    // The whole reason widening is safe is that visibility is checked FIRST.
    // If that ever regressed, every phrase added above becomes a new way to
    // tell somebody they applied to a job they did not. So each one is
    // re-asserted against a form that is STILL ON SCREEN.
    for (const said of [
      "Tack för din ansökan!", "Vielen Dank!", "Grazie!", "Thank you",
      "Application complete", "We will be in touch", "Dziękujemy",
    ]) {
      expect(classifyConfirmationFn(true, said), `form still up: ${said}`).toBe("no");
    }
  });

});

/**
 * THE ADAPTER THAT CANNOT SEE ITS OWN FORM.
 *
 * SmartRecruiters renders in shadow DOM across several steps, so "no form field
 * found" means EITHER submitted OR mid-wizard. It therefore cannot use the
 * visibility gate every other adapter relies on — and its answer to that was to
 * match loose phrases with no gate at all, which is precisely the false positive
 * the gate exists to prevent.
 *
 * It had drifted, too: the Nordic wording added for Teamtailor and Personio
 * never reached its private regex, so a Swedish tenant could not have been
 * recognised there even in principle.
 */
describe("an adapter that cannot check visibility uses the strict list", () => {
  it("SmartRecruiters no longer carries its own confirmation regex", () => {
    const sr = readFileSync(
      resolve(__dirname, "../../worker/src/vendors/smartrecruiters.ts"), "utf8");
    const code = sr.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/classifyWithoutVisibility\(body\)/);
    // A private phrase list is how this one silently fell three languages behind.
    expect(code).not.toMatch(/test\(body\)/);
  });

  it("the strict list REFUSES ordinary job-ad copy", async () => {
    const { classifyWithoutVisibility } = await import("../../worker/src/vendors/confirmed.js");
    for (const said of [
      "Thank you for your interest in this role!",
      "Thanks for applying — read more about life at Acme.",
      "Merci de votre intérêt pour ce poste.",
      "Vielen Dank für Ihr Interesse.",
    ]) {
      expect(classifyWithoutVisibility(said), `must not confirm on: ${said}`).toBe("unknown");
    }
  });

  it("it recognises a page that names a completed application", async () => {
    const { classifyWithoutVisibility } = await import("../../worker/src/vendors/confirmed.js");
    for (const said of [
      "Your application has been received.",
      "We have received your application.",
      "Application submitted.",
      "Ihre Bewerbung ist eingegangen.",
      "Din ansökan har mottagits.",
      "Votre candidature a été reçue.",
    ]) {
      expect(classifyWithoutVisibility(said), `should confirm on: ${said}`).toBe("yes");
    }
  });

  it("it NEVER answers no — that would invite a second application", async () => {
    const { classifyWithoutVisibility } = await import("../../worker/src/vendors/confirmed.js");
    // Mid-wizard looks identical to failed here. "no" would retry; unknown parks.
    for (const said of ["Step 3 of 4", "", "Please complete the required fields"]) {
      expect(classifyWithoutVisibility(said)).toBe("unknown");
    }
  });

  it("the strict list is a SUBSET of the broad one", async () => {
    const { CONFIRMED_RE, CONFIRMED_STRICT_RE } =
      await import("../../worker/src/vendors/confirmed.js");
    // Anything strict enough to confirm without a visibility check must also
    // satisfy the gated path, or the two would disagree about the same page.
    for (const said of [
      "Your application has been received.",
      "Din ansökan har mottagits.",
      "Ihre Bewerbung ist eingegangen.",
    ]) {
      expect(CONFIRMED_STRICT_RE.test(said), said).toBe(true);
      expect(CONFIRMED_RE.test(said), `broad list must also accept: ${said}`).toBe(true);
    }
  });
});
