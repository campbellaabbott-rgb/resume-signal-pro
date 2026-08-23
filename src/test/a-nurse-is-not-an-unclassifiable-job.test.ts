import { describe, expect, it } from "vitest";
import { CATEGORIZE_VERSION, categorize } from "../../supabase/functions/job-board/categories";

/**
 * "RN EMERGENCY, FULL-TIME, DAY SHIFT" WAS FILED AS UNCLASSIFIABLE.
 *
 * 159,153 postings — 27.3% of the board — sit in the field bucket "other",
 * where a posting lands when the classifier cannot read a field from its title.
 * A visitor who picks any field silently loses a quarter of the board, which is
 * why the page carries an opt-in to add them back.
 *
 * SAMPLING 3,000 OF THEM SHOWED THE BUCKET IS NOT JUNK. It is full of ordinary
 * jobs: RN Emergency, CT Scan Technologist, Physiotherapist, Registered
 * Dietitian, Head of HR Enablement, Early Years Practitioner. Only 10.4%
 * contained a non-ASCII character and 1.2% looked like an internal code.
 *
 * IT ALSO SHOWED THE HONEST LIMIT. The most common words in the bucket are
 * manager (360), specialist (240), associate (163), assistant (131), analyst
 * (116), coordinator (102) — role nouns carrying no field at all. "Quality
 * Manager" and "Inventory Planning Analyst" genuinely cannot be placed from a
 * title, and no rule should pretend otherwise. So the ceiling here is low, and
 * the measured recovery is small rather than most of it.
 *
 * CORRECTED 2026-08-23: this header first claimed 6.5%. A properly stratified
 * re-measurement (per-source allocation, keyset buckets, small random chunks)
 * puts v7 at 4.27% +/- 0.28 of the stored pile — the original 3,000-row sample
 * was company-clustered, the same bias that made "career fair" look thirty
 * times too common in another draw from this table. Contiguous pages of an id
 * ordered as source:company:uuid are one or two companies, not a sample.
 *
 * A SWEEP GAP WAS RULED OUT BEFORE WRITING ANY RULES. Running the CURRENT rules
 * over the same 3,000 titles reclassified only 6 of them — 0.2% — so stored
 * rows are not sitting mis-filed behind a stale sweep. The gap is in the rules.
 * (An earlier hand-picked probe suggested otherwise; it had selected rows by
 * ILIKE on words the rules already contain, which is a biased sample of exactly
 * the wrong kind.)
 *
 * THREE CAUSES, and they need different fixes:
 *   COMPOUNDS   "Physiotherapist" and "Ultrasonographer" contain terms the
 *               rules already name, with no word boundary in front of them, so
 *               a \b-anchored pattern can never fire.
 *   CREDENTIALS RN alone was 3,267 rows of the bucket; LPN 574; CNA 373.
 *   NAMED ROLES Technologist 1,711, Surgical 565 — and "Dentist", because the
 *               existing rule says "dental", which does not match it.
 */
describe("a nurse is not an unclassifiable job", () => {
  it("reads the professions hidden inside compound words", () => {
    for (const t of ["Physiotherapist", "Teletherapist", "Ultrasonographer", "Pediatric Echosonographer, Per Diem", "Radiographer"]) {
      expect(categorize(t), `${t} should be healthcare`).toBe("healthcare");
    }
  });

  it("reads the credentials a clinician actually types", () => {
    for (const t of ["RN Emergency, Full-time, Day shift", "RN or LPN - Long Term Care - Nights", "HHA/CNA-ALL SHIFTS", "CRNA - Cardiac", "COTA PRN", "RN PACU"]) {
      expect(categorize(t), `${t} should be healthcare`).toBe("healthcare");
    }
  });

  it("reads the named clinical roles the list was missing", () => {
    for (const t of ["CT Scan Technologist", "MRI Technologist", "Surgical Coordinator", "Dentist: Lubbock", "PRN OBGYN Hospitalist", "Speech Language Pathologist", "Registered Dietitian - East Submarket", "Respiratory Care Supervisor"]) {
      expect(categorize(t), `${t} should be healthcare`).toBe("healthcare");
    }
  });

  it("refuses a credential when the JOB is something else", () => {
    // A firefighter holding an EMT card is a firefighter. This is why EMT is
    // absent from the credential list despite being a real clinical
    // qualification — measured, it put "Firefighter EMT - Wilmington Fire Dept"
    // into healthcare.
    expect(categorize("Firefighter EMT - Wilmington Fire Dept")).not.toBe("healthcare");
  });

  it("refuses a shift code as a proxy for a profession", () => {
    // PRN marks a healthcare EMPLOYER, not a healthcare ROLE. Including it
    // gained 18 titles in the sample and dragged in a food service worker and a
    // scheduling specialist. Naming the actual roles recovered the same ground
    // without the misfires — "PRN OBGYN Hospitalist" is claimed above by
    // hospitalist, not by PRN.
    expect(categorize("Food Service Worker | PRN")).not.toBe("healthcare");
    expect(categorize("Scheduling Specialist PRN")).not.toBe("healthcare");
  });

  it("leaves a field-less role noun alone rather than guessing", () => {
    // The honest core of the bucket. These are the most common words in it
    // and none of them names a field; a rule that claimed them would be
    // inventing an answer. "Inventory Planning Analyst" left this list at v9:
    // the measured \binventory\b term (580 live rows) claims it for
    // operations, and inventory planning IS supply-chain work — the title was
    // only unclassifiable to v8's vocabulary, not in itself.
    for (const t of ["Quality Manager", "Assistant Night Manager Full Time", "Reporting Specialist", "Knowledge Manager & Action Officer"]) {
      expect(categorize(t), `${t} is genuinely unclassifiable from its title`).toBe("other");
    }
  });

  it("does not move anything the previous rules already placed", () => {
    for (const [t, want] of [
      ["Registered Nurse", "healthcare"], ["Data Scientist", "data_ai"],
      ["Software Engineer", "engineering"], ["Account Executive", "sales"],
      ["Preschool Teacher", "education"], ["Research Associate", "science"],
      ["UX Designer", "design"], ["Product Manager", "product"],
    ] as const) {
      expect(categorize(t), `${t} moved`).toBe(want);
    }
  });

  it("v8: reads the concepts whose rules missed their own spellings", () => {
    // Each class sized live before inclusion; see the v8 header in
    // categories.ts for the counts and for what was EXCLUDED and why.
    for (const [t, want] of [
      ["Audit Manager - South Florida", "finance"],        // rule required auditOR/ING
      ["Team Leader (Express)", "hospitality_retail"],     // rule stopped at "lead"
      ["Shift Leader - Nights", "hospitality_retail"],
      ["Director - Program & Delivery Management", "product"],
      ["Machine Operators - 2nd Shift", "operations"],     // \b does not fall between r and s
      ["Pflegefachkraft (m/w/d)", "healthcare"],           // the v7 compound shape, in German
      ["Prozessingenieur im Bereich Silizium-Epitaxie", "engineering"],
      ["Sachbearbeiter Logistik (m/w/d)", "operations"],
      ["Técnico de Mantenimiento", "operations"],
      ["Recepcionista", "admin"],
      ["Säljare, Västerås", "sales"],
      ["Zahnmedizinische Fachangestellte (m/w/d)", "healthcare"],
    ] as const) {
      expect(categorize(t), `${t} should be ${want}`).toBe(want);
    }
  });

  it("v8: order protects the more specific reading", () => {
    // The compound stems are appended AFTER the English rules, so a title that
    // carries both signals keeps the earlier, more specific one.
    expect(categorize("Tecnico Commerciale"), "commercial wins over técnico").toBe("sales");
    // And the audit widening must not swallow the arts.
    expect(categorize("Audition Coordinator")).not.toBe("finance");
    // Bare French/Spanish "manager" stays unclassified — a field-free word in
    // any language is still field-free.
    expect(categorize("Responsable")).toBe("other");
  });

  it("bumps the version, or the sweep never re-reads the stored bucket", () => {
    // The rules run at INSERT. Existing rows are only re-read when a completed
    // refresh pass finds this constant different from the one stamped in the
    // meta table. Adding rules without bumping it fixes only postings that
    // arrive after the deploy, and leaves the 159,153 exactly where they are.
    expect(CATEGORIZE_VERSION).toBeGreaterThanOrEqual(7);
  });
});
