/**
 * WHAT THIS GUARDS
 * ----------------
 * UKG Pro Recruiting puts `JobLocationType` on every row of the list payload
 * fetchUkg already POSTs for every UKG board on every pass — the work mode the
 * employer picked from a dropdown in their own recruiting system. Until this
 * build the board read NONE of it: `UkgOpportunity` did not declare the field,
 * and the comment above the UKG arm's `workMode` said the list "states no
 * remote flag of its own", which was false. We stated a mode on 716 of 34,333
 * servable UKG rows (2.1%) while the employer had answered the question on
 * roughly half of them.
 *
 * This guard pins the rules that make reading it safe, and it pins them by
 * walking REAL CAPTURED PAYLOADS rather than by asserting on source text:
 *
 *   1. ONLY 0, 1 and 2 map. There is no default branch: every other integer —
 *      UKG's own -1 "not specified" sentinel included — and a null, a numeric
 *      string or an absent key are SILENCE, not a state. An unmapped INTEGER is
 *      also logged, because silence in the code must not be silence to us.
 *   2. The mapping is the VENDOR'S vocabulary, checked against captured rows.
 *   3. A blank dropdown stays blank; it never erases the mode the posting's own
 *      words state, and it is never read as on-site.
 *   4. A dropdown that CONTRADICTS the employer's own words is REFUSED — null,
 *      never the enum, and never on-site. The employer's own words include the
 *      LABELS THEY GAVE EVERY SITE on the requisition, which is the half a
 *      review found missing.
 *   5. A string that names a BUILDING or an ORG-CHART UNIT is not a policy: the
 *      head-office phrase comes out of the place, the category and the labels
 *      before the detector sees them, and stays in the title.
 *
 * WHERE THE SAFETY ACTUALLY COMES FROM, said plainly because the risk section
 * of this build leaned the other way. It comes from rule 4 and from the
 * `?? text` fallback in rule 3. Rule 1 is a cheap fence over a value the vendor
 * has NOT been observed to send: across 33,497 captured rows JobLocationType
 * took only 0, 1, 2 and null (2,409 / 16,148 / 1,237 / 13,703), and the -1
 * sentinel the walk below exercises lives in the vendor's search FACET, not in
 * the list payload. It stays because it is one line and it is what a vendor-side
 * widening would hit first, but it is not the thing standing between this fill
 * and a fabricated on-site.
 *
 * WHY IT HAS TO BE THIS SHAPE
 * ---------------------------
 * The 2026-09-23 Workday place build is the precedent for both halves. A
 * comment asserting a field path is not evidence: the path first proposed there
 * was present on 0 of 367 live payloads while tsc, the deno gate and every
 * existing test stayed green. So this file runs the real normalizer over
 * payloads captured from the vendor's own endpoint
 * (src/test/fixtures/ukg-job-location-type.json, twelve rows from nine tenants,
 * captured 2026-09-27) and checks the VALUES it returns.
 *
 * HOW BIG THIS IS, ON OUR OWN DENOMINATOR AND NOT THE VENDOR'S. 300 servable
 * UKG rows sampled at five offsets down the vendor=ukg slice, each row's own
 * opportunity id then asked of the vendor (2026-09-27, 299 answered): 297 hold
 * no stated mode today and 177 of those (59.6%) would gain one — 149 on-site,
 * 24 hybrid, 4 remote. An independent 143-row draw read 45.3%, so the reach is
 * a RANGE (~15,000-20,000 of the 33,617 no-mode rows) rather than a number. The
 * 65.6% first proposed for this was a vendor-side page-0 sample scaled onto our
 * denominator, and re-running that route here reproduces it at 65.3%: page 0 is
 * where the enum's coverage is highest, so it is the one sample that must not
 * be scaled.
 *
 * And `workdayDetailPlace` is the precedent for refusing a contradiction rather
 * than resolving it. MEASURED on a CENSUS of every UKG board in JOB_SOURCES —
 * 1,291 boards, page 0 of each, 33,497 rows, 2026-09-27: both sides speak on
 * 902 rows and agree on 762 (84.5%); of the 140 disagreements, 37 are an
 * On-site dropdown under the employer's own label reading Remote and 9 an
 * On-site dropdown under their own Hybrid. Before the labels were read, 26 rows
 * were SERVED On-site while a label on the same requisition carried an explicit
 * remote word — including both rows the audit's adversarial verifier named as
 * the evidence for having this gate ("Remote - Indianapolis, IN" and
 * "Remote - Los Angeles, CA"). With the labels read, that count is 0.
 *
 * The other direction matters as much and is why rule 3 is here: in the same
 * census the dropdown is blank on 501 of the 1,403 rows whose own words DO
 * state a mode (35.7%), so a bare `enum` — no `?? text` — would go dark on them.
 * Existing rows are shielded by the refresh path's stated-only write; a NEW
 * arrival is not.
 *
 * AND RULE 5 IS MEASURED, NOT ASSUMED. 179 census rows carry the head-office
 * phrase in a vendor location label, and where those employers also answered
 * their own dropdown they said Hybrid on 32 and On-site on 40 against Remote on
 * only 19 — the label is not a remote statement on 72 of the 91 rows that
 * settle it. Feeding the labels in UNMASKED would have published remote on 130
 * of them, the same fabrication the Paylocity half of this bundle removes, and
 * would have deleted the employer's own On-site on 39 more by "contradicting"
 * it with our reading of their building's name.
 *
 * NOTE 0 IS HYBRID. The vendor's own localization resource orders the three
 * labels Hybrid, On-site, Remote; guessing the enum from the usual boolean
 * shape would have been wrong in the most damaging direction.
 *
 * TEETH — every break below was applied to the shipped normalizer, run, and
 * restored; the counts are what vitest reported on this file:
 *  (a) `?? textMode` dropped, so the arm returns the bare enum.
 *  (b) the contradiction refusal dropped (`enumMode ?? textMode` alone): the
 *      ARUP row and the Sitelogiq row resolve to onsite under labels reading
 *      Remote. That is the fabrication, reproduced on real rows.
 *  (c) the refusal replaced by text precedence (`textMode ?? enumMode`) —
 *      refusing in both directions is asserted, so a rule that always prefers
 *      our own text fails too.
 *  (d) a default branch added to the mapping (an unmapped integer answering
 *      On-site).
 *  (e) the table re-keyed 0 -> On-site, 1 -> Hybrid (the plausible guess, and
 *      the damaging one).
 *  (f) `JobLocationType` removed from the interface — and `npm run
 *      check:functions` fails with TS2339 on the read itself.
 *  (g) the vendor labels dropped from the text side, which is the state the
 *      contradiction gate shipped in.
 *  (h) the head-office mask dropped from the labels, which deletes the Grande
 *      Cheese employer's own On-site.
 *  (i) the unmapped-integer log removed.
 * And on the disclosure half:
 *  (j) the card's provenance attribute deleted, and separately its key renamed
 *      — the FIRST version of that pin passed the rename break, because it
 *      counted the bare key and the old key is a substring of the new one; the
 *      pin is now the whole `title={t("…"` attribute, at every derived site.
 *  (k) the English sentence pasted into de.json.
 *  (l) the inline default edited away from the en.json value.
 * The numbers each break produced are in the build report for this change.
 * Every figure quoted above was measured with the fixtures in this repository
 * or with the captures they were drawn from, on 2026-09-27.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  normalizeUkg,
  ukgLocationTypeMode,
  detectWorkMode,
  withoutHomeOfficeToken,
  type UkgOpportunity,
} from "../../supabase/functions/job-board/normalize";
import { codeOf } from "./helpers/strip-comments";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(
  readFileSync(join(HERE, "fixtures", "ukg-job-location-type.json"), "utf8"),
) as Record<string, UkgOpportunity & Record<string, unknown>>;

type Mode = "remote" | "hybrid" | "onsite" | null;

/** `ukg:<token>:<Id>` — the id the normalizer builds, so the key IS the capture. */
const SUN = "ukg:recruiting~SUN1007SECL~405f8226-5347-498b-8c69-d200212ad1bb";
const HYBRID_ROW = `${SUN}:ecd99147-1bb3-42cc-931c-ee7cc8d1482f`;
const ONSITE_ROW = `${SUN}:dc16e4c5-9608-49bc-86e5-51889286918d`;
const REMOTE_ROW = `${SUN}:43040896-1675-4bd2-af31-97a25fb43860`;
const SILENT_ROW = `${SUN}:1fe2a932-c534-4792-ad0b-7f803c734f1e`;
const ARUP_REMOTE_VS_ONSITE =
  "ukg:recruiting2~ARU1000ARUP~62cc791d-612e-42e6-909f-0de27efe2038:133f45f2-b7a0-4fd5-a297-96b436844646";
const AUG_HYBRID_VS_ONSITE =
  "ukg:recruiting~AUG1000AUG~02a29cd6-e7aa-4501-96be-6336647e3184:692bd5bf-2be4-4ddd-9e24-e32c507bb43f";
const SUR_HYBRID_VS_REMOTE =
  "ukg:recruiting~SUR1004SRGY~aa616d8f-f2a8-46c2-8f8e-1ca56e162ffd:fd2acb80-91b5-4574-8b77-6c8d6eb39ca3";
const MIS_BLANK_BUT_REMOTE =
  "ukg:recruiting~MIS1008~0e453acf-d578-055d-9df2-f788e73fadcf:ff1adcd6-131c-467d-b26f-09ffd7176709";
/**
 * THE FOUR ROWS THE REVIEW ADDED, and every one of them is a row the shipped
 * gate could not see. `location` is the first site's City/State and only falls
 * back to a label when that address is empty, so on any properly-placed row the
 * employer's own "Remote - Indianapolis, IN" was deleted BEFORE the
 * contradiction check ran — and the check then compared the dropdown against a
 * string the remote statement had been removed from, and published On-site.
 */
// The row the audit's adversarial verifier named as the evidence for requiring
// the contradiction gate at all. Four sites, one of them labelled
// "Remote - Indianapolis, IN"; the first site is a real Minneapolis address, so
// the label never reached the detector. Dropdown 1 (On-site).
const SIT_LABEL_REMOTE_VS_ONSITE =
  "ukg:recruiting2~SIT1001SILQ~6a77286d-3477-45d7-9461-715b965f604c:ad22c8aa-cc26-4174-8669-2ab23afd4f9e";
// A row whose only statement lives in LocalizedDescription: LocalizedName is
// empty, the description reads "Remote Missouri", the dropdown is blank. Reading
// the name and not the description would go dark on 174 rows of the census.
const CKE_DESCRIPTION_ONLY_REMOTE =
  "ukg:recruiting2~CKE1000CKER~8d7aeff6-90f7-47bf-9f70-771c5260877f:36635e64-2d63-4336-8c7b-593b0db6b260";
// The refusal in the other direction, from a LABEL rather than a title: the
// employer's own site label reads "Hybrid, GA" under a dropdown reading Remote.
const CON_LABEL_HYBRID_VS_REMOTE =
  "ukg:recruiting~CON1019ACADE~c2b42121-092c-4125-8209-60593d2c63e0:52034777-1a14-4636-a7f7-f0d976b4ba83";
// AND THE ROW THAT SHOWS WHY THE LABELS ARE MASKED FIRST. Grande Cheese labels
// its Fond du Lac WI headquarters "Home Office" in both label fields and answers
// its own dropdown On-site. Handed in unmasked, our remote pattern reads the
// building as a policy, contradicts the employer's own On-site and deletes it —
// the same fabrication the Paylocity half of this bundle removes, moved one
// vendor over. 179 census rows carry that token in a label, and where those
// employers answered the dropdown they said Hybrid on 32 and On-site on 40
// against Remote on 19.
const GRA_HEAD_OFFICE_LABEL_ONSITE =
  "ukg:recruiting2~GRA1007GRAND~54e3f493-e093-4bb2-8a28-7a5bdf4d375f:f9616686-46a5-433f-b5e8-46bd1e5de2c3";

/**
 * What each captured row's work mode must be, and WHY — every entry names the
 * employer's dropdown value and what the posting's own words say, so a wrong
 * expectation cannot hide behind a passing assertion.
 */
const EXPECTED: ReadonlyArray<readonly [string, Mode, string]> = [
  [HYBRID_ROW, "hybrid", "dropdown 0 (Hybrid); text says nothing — 0 is NOT 'unspecified'"],
  [ONSITE_ROW, "onsite", "dropdown 1 (On-site); text says nothing. This is the population the fill is mostly made of"],
  [REMOTE_ROW, "remote", "dropdown 2 (Remote) and the title says Remote — they agree"],
  [SILENT_ROW, null, "dropdown blank, text silent: the board states nothing rather than on-site"],
  [ARUP_REMOTE_VS_ONSITE, null, "dropdown 1 (On-site) against a location field reading Remote — refused"],
  [AUG_HYBRID_VS_ONSITE, null, "dropdown 1 (On-site) against a title reading *Hybrid* — refused"],
  [SUR_HYBRID_VS_REMOTE, null, "dropdown 2 (Remote) against a title reading Hybrid — refused in the other direction too"],
  [MIS_BLANK_BUT_REMOTE, "remote", "dropdown blank, location field reads Remote: the employer's words survive"],
  [SIT_LABEL_REMOTE_VS_ONSITE, null, "dropdown 1 (On-site) against the employer's own site label 'Remote - Indianapolis, IN' — refused, and served On-site before this build"],
  [CKE_DESCRIPTION_ONLY_REMOTE, "remote", "dropdown blank; the only statement is a LocalizedDescription reading 'Remote Missouri'"],
  [CON_LABEL_HYBRID_VS_REMOTE, null, "dropdown 2 (Remote) against the employer's own label reading 'Hybrid, GA' — refused from a label, not a title"],
  [GRA_HEAD_OFFICE_LABEL_ONSITE, "onsite", "dropdown 1 (On-site) and a label naming their own head-office building: the building is masked, so the employer's answer stands"],
];

/** Every label the employer attached to every site on a captured requisition. */
function vendorLabelsOf(id: string): string {
  const locs = (FIXTURES[id].Locations ?? []) as Array<Record<string, unknown>>;
  return locs
    .flatMap((L) => [L?.LocalizedName, L?.LocalizedDescription])
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .join(" · ");
}

/** One captured row through the real normalizer, keyed by its own id. */
function normalizeCapture(id: string, patch?: Partial<UkgOpportunity>) {
  const row = FIXTURES[id];
  expect(row, `fixture ${id} is missing — the capture file was edited`).toBeTruthy();
  const token = id.slice("ukg:".length, id.lastIndexOf(":"));
  const [job] = normalizeUkg([{ ...row, ...patch }], "Employer", token);
  return job;
}

describe("the employer picked the work mode from a dropdown, and we read it", () => {
  it("every captured row carries the field at all — the path is checked, not described", () => {
    // The remoteType lesson: the first proposal's field path was present on 0
    // of 367 live payloads. If UKG ever moves or drops this key, this fails
    // here rather than silently turning the whole read into a no-op.
    const ids = Object.keys(FIXTURES);
    expect(ids.length, "expected the twelve captured rows").toBe(12);
    for (const id of ids) {
      expect(
        Object.prototype.hasOwnProperty.call(FIXTURES[id], "JobLocationType"),
        `${id} carries no JobLocationType — recapture before trusting this guard`,
      ).toBe(true);
    }
    // And the captures cover all four states the vendor can send, or the walk
    // below would be proving the mapping on a subset of it.
    const seen = new Set(ids.map((id) => String(FIXTURES[id].JobLocationType)));
    expect([...seen].sort()).toEqual(["0", "1", "2", "null"]);
  });

  it("maps each captured row to the mode its own employer stated", () => {
    for (const [id, expected, why] of EXPECTED) {
      const job = normalizeCapture(id);
      expect(job.workMode, `${id} — ${why}`).toBe(expected);
      // The boolean and the trinary are one fact; they cannot drift.
      expect(job.remote, `${id} boolean/trinary disagree`).toBe(job.workMode === "remote");
    }
  });

  it("never states on-site on a row whose own words say otherwise", () => {
    // The named risk of this whole change: the gain is overwhelmingly on-site
    // claims, the one state this board is structurally short of, so the failure
    // mode worth its own assertion is a wrong on-site specifically.
    for (const id of [ARUP_REMOTE_VS_ONSITE, AUG_HYBRID_VS_ONSITE, SUR_HYBRID_VS_REMOTE]) {
      expect(normalizeCapture(id).workMode, `${id} was resolved instead of refused`).not.toBe("onsite");
    }
  });
});

describe("an integer the vendor's own renderer draws nothing for is silence, not a state", () => {
  it("answers only for 0, 1 and 2 across the whole integer neighbourhood", () => {
    // Walked, not spot-checked: a default branch anywhere in the mapping shows
    // up here as an answer for a value the vendor never sends. -1 is not
    // hypothetical — it is UKG's own "not specified" facet value.
    const answered = [];
    for (let v = -50; v <= 50; v++) if (ukgLocationTypeMode(v) !== null) answered.push(v);
    expect(answered, "an unmapped integer was given a work mode").toEqual([0, 1, 2]);
    expect(ukgLocationTypeMode(0)).toBe("hybrid");
    expect(ukgLocationTypeMode(1)).toBe("onsite");
    expect(ukgLocationTypeMode(2)).toBe("remote");
  });

  it("treats a blank, a non-integer, a string and an absent key as silence", () => {
    for (const raw of [null, undefined, -1, 3, 99, 1.5, NaN, Infinity, "1", "Remote", true, {}, []] as unknown[]) {
      expect(ukgLocationTypeMode(raw), `${JSON.stringify(raw) ?? String(raw)} was read as a state`).toBeNull();
    }
  });

  it("says so out loud when the vendor sends an integer we do not map", () => {
    // Silence in the code must not be silence to the operator. The board drops
    // an unmapped value forever and by design; if UKG ever adds a fourth label
    // the only way anyone finds out is this line, which copies the Workday
    // classifier's unclassified-remoteType log one vendor over. -1 is excluded
    // by name: it is the vendor's own "not specified" facet value, documented
    // silence, and logging it would be a third of the log.
    const lines: string[] = [];
    const real = console.log;
    console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
    try {
      for (const raw of [3, 4, 99, -7] as unknown[]) {
        normalizeCapture(ONSITE_ROW, { JobLocationType: raw as number });
      }
      const quiet = lines.length;
      for (const raw of [null, undefined, -1, 1.5, "1", 0, 1, 2] as unknown[]) {
        normalizeCapture(ONSITE_ROW, { JobLocationType: raw as number | null });
      }
      expect(lines.length, "a mapped value, a blank or the vendor's own sentinel was logged").toBe(quiet);
    } finally { console.log = real; }
    expect(lines.length, "an unmapped integer was dropped with no signal").toBe(4);
    for (const l of lines) expect(l).toMatch(/JobLocationType/);
    // And the whole captured census is quiet, which is the claim the note makes.
    const noisy: string[] = [];
    const real2 = console.log;
    console.log = (...a: unknown[]) => { noisy.push(a.map(String).join(" ")); };
    try {
      for (const id of Object.keys(FIXTURES)) normalizeCapture(id);
    } finally { console.log = real2; }
    expect(noisy, "the captured rows hold a value this board does not map").toEqual([]);
  });

  it("silence in the dropdown is never on-site on a row whose text is silent too", () => {
    // Null is 41.2% of this vendor's rows in the capture. A widening that filled
    // it would invent a mode on ~14,000 servable postings.
    for (const raw of [null, undefined, -1, 3, 99, "1"] as unknown[]) {
      const job = normalizeCapture(ONSITE_ROW, { JobLocationType: raw as number | null });
      expect(job.workMode, `JobLocationType ${String(raw)} produced a mode`).toBeNull();
      expect(job.remote).toBe(false);
    }
  });
});

describe("a dropdown the employer left blank never erases the mode their words state", () => {
  it("keeps the text-derived mode when the dropdown says nothing", () => {
    // 58 of the 89 text-stated rows in the capture have a blank dropdown, so a
    // bare `enum` would have gone dark on the majority of what we already
    // state on this vendor. Both halves of that are checked: a real blank row,
    // and a row whose field is deleted outright.
    expect(normalizeCapture(MIS_BLANK_BUT_REMOTE).workMode).toBe("remote");
    const noField = { ...FIXTURES[ARUP_REMOTE_VS_ONSITE] } as Record<string, unknown>;
    delete noField.JobLocationType;
    const [job] = normalizeUkg(
      [noField as UkgOpportunity],
      "Employer",
      "recruiting2~ARU1000ARUP~62cc791d-612e-42e6-909f-0de27efe2038",
    );
    expect(job.workMode, "a row with no dropdown at all lost the mode its location states").toBe("remote");
  });

  it("agrees with the shared text detector on every row where the dropdown is blank", () => {
    // The one-detector rule: with no vendor statement the UKG arm must answer
    // exactly what detectWorkMode answers for the same strings, or this arm has
    // grown a second work-mode ladder. The strings are the posting's place, its
    // title, its job category and the employer's own labels for every site on
    // the requisition — with the head-office phrase taken out of the three that
    // name a building or an org-chart unit, and left in the title.
    for (const id of Object.keys(FIXTURES)) {
      const job = normalizeCapture(id, { JobLocationType: null });
      expect(
        job.workMode,
        `${id} disagrees with the shared detector once the dropdown is blank`,
      ).toBe(detectWorkMode(
        withoutHomeOfficeToken(job.location),
        job.title,
        withoutHomeOfficeToken(job.department),
        withoutHomeOfficeToken(vendorLabelsOf(id)),
      ));
    }
  });
});

describe("the dropdown and the posting's own words disagreeing is refused, never resolved", () => {
  it("refuses in both directions, on real captured rows", () => {
    expect(normalizeCapture(ARUP_REMOTE_VS_ONSITE).workMode).toBeNull();
    expect(normalizeCapture(AUG_HYBRID_VS_ONSITE).workMode).toBeNull();
    expect(normalizeCapture(SUR_HYBRID_VS_REMOTE).workMode).toBeNull();
  });

  it("refuses every disagreeing pair, and only the disagreeing ones", () => {
    // Exhaustive over the vocabulary rather than over the three rows that
    // happen to exist: for each dropdown value, a title that states each mode.
    const TITLES: ReadonlyArray<readonly [string, Mode]> = [
      ["Analyst", null],
      ["Analyst (Remote)", "remote"],
      ["Analyst (Hybrid)", "hybrid"],
      ["Analyst (On-site)", "onsite"],
    ];
    for (const [jlt, enumMode] of [[0, "hybrid"], [1, "onsite"], [2, "remote"]] as ReadonlyArray<readonly [number, Mode]>) {
      for (const [title, textMode] of TITLES) {
        const job = normalizeCapture(ONSITE_ROW, { JobLocationType: jlt, Title: title });
        const expected = enumMode && textMode && enumMode !== textMode ? null : (enumMode ?? textMode);
        expect(job.workMode, `dropdown ${jlt} with title "${title}"`).toBe(expected);
        if (textMode && textMode !== enumMode) {
          expect(job.workMode, `dropdown ${jlt} overruled the posting's own "${title}"`).not.toBe(enumMode);
        }
      }
    }
  });
});

describe("the jump from 2.1% to about 45% stated in one vendor is disclosed, not silent", () => {
  /**
   * WHY THIS IS PART OF THE SAME GUARD. The fill is overwhelmingly on-site
   * claims inside a single vendor, so from outside it is indistinguishable from
   * the on-site DEFAULT this board refuses to have — unless the surface printing
   * the mode says whose statement it is. The employment-type badge already
   * carries exactly such a line and its own nine-locale guard; the work-mode
   * badge, the older of the two, carried none. A disclosure nobody renders is
   * not a disclosure, so both ends are asserted: the string in every locale, and
   * a reader at every place the board prints a mode.
   */
  const JOBS = readFileSync(resolve(HERE, "../pages/Jobs.tsx"), "utf8");
  const LOCALE_DIR = resolve(HERE, "../i18n/locales");
  const localeJobsPage = (f: string) =>
    (JSON.parse(readFileSync(join(LOCALE_DIR, f), "utf8")) as { jobsPage?: Record<string, unknown> }).jobsPage ?? {};

  /**
   * ENUMERATED, NOT COUNTED. This assertion used to be `hits === 2`, which is
   * the fourth shape of a guard that looks like it works: a count cannot fail
   * when an UNANNOTATED surface is added, only when a known one is removed —
   * and it was already wrong, because the compare drawer printed a posting's
   * own work mode with no provenance line while the guard stayed green. So the
   * render sites are DERIVED from the source and each one has to carry the
   * attribute. A new surface fails this until it is annotated, and a new
   * ANNOTATED surface passes, which is the difference between pinning a
   * property and pinning a number.
   *
   * The pin is the WHOLE ATTRIBUTE, not the key: pinning
   * `jobsPage.workModeProvenance` alone passed against a break that renamed the
   * attribute and appended a character to the key, because the old key is a
   * substring of the new one.
   */
  it("is rendered at every surface that prints a posting's own work mode", () => {
    const PROVENANCE = 'title={t("jobsPage.workModeProvenance"';
    // Every interpolation of the work-mode label. The three filter-option
    // builders interpolate their loop variable and are labelling a CONTROL, not
    // a posting — a control has no provenance to state.
    const all = [...JOBS.matchAll(/t\(`jobsPage\.workMode\.\$\{([^}]*)\}/g)];
    const own = all.filter((m) => m[1].trim() !== "m");
    expect(all.length - own.length, "the filter-option builders moved — re-read this exclusion").toBeGreaterThanOrEqual(2);
    expect(own.length, "a surface that prints a posting's own work mode has disappeared").toBeGreaterThanOrEqual(3);
    for (const m of own) {
      const at = m.index!;
      expect(
        JOBS.slice(Math.max(0, at - 900), at),
        `the surface rendering jobsPage.workMode.\${${m[1].trim()}} carries no provenance line`,
      ).toContain(PROVENANCE);
    }
    // AND THE CRAWLER-FACING PAGE, which is a different file and the one whose
    // JSON-LD is built from the same field.
    const POSTING = readFileSync(resolve(HERE, "../pages/JobPosting.tsx"), "utf8");
    const at = POSTING.indexOf('job.workMode === "remote"');
    expect(at, "the posting page stopped printing a work mode — re-point this guard").toBeGreaterThan(0);
    expect(
      POSTING.slice(at, at + 900),
      "the baked posting page prints a work mode with no provenance line",
    ).toContain(PROVENANCE);
  });

  it("exists as a real sentence in all nine locales, and says where the mode came from", () => {
    const files = readdirSync(LOCALE_DIR).filter((f) => f.endsWith(".json"));
    expect(files.length, "expected nine locale files").toBe(9);
    for (const f of files) {
      const v = localeJobsPage(f).workModeProvenance;
      expect(typeof v, `${f}: jobsPage.workModeProvenance`).toBe("string");
      expect(String(v).trim().length, `${f}: must be a real translation, not a stub`).toBeGreaterThan(40);
    }
    // The English sentence has to carry the two claims that make it a provenance
    // line rather than a label: whose statement it is, and what silence means.
    const en = String(localeJobsPage("en.json").workModeProvenance);
    expect(en).toMatch(/employer states it/i);
    expect(en).toMatch(/hiring system/i);
    expect(en).toMatch(/never read as on-site/i);
  });

  it("is not the English string sitting in a translated locale", () => {
    // A copy-paste of the default into de.json renders English to a German
    // reader while passing every parity check.
    const en = String(localeJobsPage("en.json").workModeProvenance);
    for (const f of ["de.json", "es.json", "fr.json", "nl.json", "pt.json", "hi.json", "tl.json"]) {
      expect(String(localeJobsPage(f).workModeProvenance), `${f} still holds the English text`).not.toBe(en);
    }
  });

  it("keeps the inline default and the English locale value the same sentence", () => {
    // A locale VALUE overrides the inline default, so the two drifting apart
    // means the reader and the reviewer are looking at different claims — and
    // the one the reviewer reads in the source is the one nobody is shown.
    const en = String(localeJobsPage("en.json").workModeProvenance);
    expect(JOBS, "the inline default no longer matches en.json").toContain(en);
  });
});

describe("the source cannot quietly grow a default branch", () => {
  // Comment-stripped, because this repository has failed guards whose required
  // literal was satisfied by a sentence in a comment.
  const SRC = codeOf(readFileSync(resolve(HERE, "../../supabase/functions/job-board/normalize.ts"), "utf8"));

  it("declares the field on the interface it parses", () => {
    expect(SRC, "UkgOpportunity does not declare JobLocationType").toMatch(/JobLocationType\?:\s*number \| null;/);
  });

  it("maps exactly three values and nothing else", () => {
    // A structural pin BESIDE the behavioural walk above, not instead of it: it
    // is what catches a fourth entry added to the table with no fixture for it.
    const map = SRC.match(/new Map<number, string>\(\[([\s\S]*?)\]\)/);
    expect(map, "the JobLocationType table is no longer a Map keyed by number").not.toBeNull();
    const entries = [...map![1].matchAll(/\[(-?\d+),\s*"([^"]+)"\]/g)].map((m) => [Number(m[1]), m[2]]);
    expect(entries).toEqual([[0, "Hybrid"], [1, "On-site"], [2, "Remote"]]);
  });

  it("reads the dropdown through the ONE shared vendor-label reader", () => {
    // The only structural pin left here, and it is about the one-reader rule
    // rather than about any particular argument list: a second work-mode ladder
    // for this vendor is what this catches.
    const arm = SRC.slice(SRC.indexOf("export function normalizeUkg"));
    const body = arm.slice(0, arm.indexOf("export function normalizePinpoint"));
    expect(body, "the UKG arm no longer reads the dropdown").toMatch(/ukgLocationTypeMode\(j\.JobLocationType\)/);
  });

  /**
   * WHAT USED TO BE HERE, AND WHY IT IS NOT. Two pins required the text side to
   * be spelled `detectWorkMode(location, title, dept)` and the refusal to be
   * spelled exactly as it stood. The first of those was the third shape of a
   * guard that looks like it works: it REQUIRED THE DEFECTIVE READ. `location`
   * is the first site's City/State and discards the employer's own site labels,
   * so the contradiction check it fed was blind in precisely the class it was
   * written for — and the fix to that made this file go red on a pin that had
   * nothing to do with the property. Both are replaced by the behaviour below,
   * which is what the pins were standing in for.
   */
  it("reads the employer's own site labels, not only the place it derived", () => {
    // A row placed properly by the vendor, with the employer's own remote
    // statement in a label the derived place cannot contain. Under the shipped
    // read this was served On-site.
    expect(normalizeCapture(SIT_LABEL_REMOTE_VS_ONSITE).workMode).toBeNull();
    // And with the dropdown blanked, the label is a positive source: the arm
    // answers the mode the employer's own label states.
    expect(normalizeCapture(SIT_LABEL_REMOTE_VS_ONSITE, { JobLocationType: null }).workMode).toBe("remote");
    // BOTH label fields, not one: this row's LocalizedName is empty.
    expect(vendorLabelsOf(CKE_DESCRIPTION_ONLY_REMOTE)).toBe("Remote Missouri");
    expect(normalizeCapture(CKE_DESCRIPTION_ONLY_REMOTE).workMode).toBe("remote");
    const namesOnly = { ...FIXTURES[CKE_DESCRIPTION_ONLY_REMOTE] } as UkgOpportunity;
    expect(
      (namesOnly.Locations ?? []).every((L) => !String(L?.LocalizedName ?? "").trim()),
      "the description-only row gained a LocalizedName — recapture it or this proves nothing",
    ).toBe(true);
  });

  it("does not read the employer's own head-office building as a policy", () => {
    // The mask, in the state the defect lives in. Unmasked, our remote pattern
    // reads this employer's Fond du Lac headquarters as work-from-home,
    // contradicts their own On-site and writes nothing — deleting a statement
    // rather than inventing one, but deleting it on 179 rows of the census.
    expect(vendorLabelsOf(GRA_HEAD_OFFICE_LABEL_ONSITE)).toBe("Home Office · Home Office");
    expect(normalizeCapture(GRA_HEAD_OFFICE_LABEL_ONSITE).workMode).toBe("onsite");
    // And with no dropdown at all the building states nothing, rather than
    // becoming a remote claim the employer never made.
    expect(normalizeCapture(GRA_HEAD_OFFICE_LABEL_ONSITE, { JobLocationType: null }).workMode).toBeNull();
    // The title keeps the phrase, because there it IS the posting's own words.
    expect(detectWorkMode("Berater Home Office")).toBe("remote");
  });

  it("refuses from a label in the other direction too", () => {
    expect(normalizeCapture(CON_LABEL_HYBRID_VS_REMOTE).workMode).toBeNull();
  });
});

describe("the job CATEGORY is read, and a category naming a building is not a policy", () => {
  /**
   * WHY THIS BLOCK EXISTS. The arm hands the detector a third string — UKG's
   * JobCategoryName — and the exhaustive contradiction matrix above varies only
   * the TITLE, so nothing exercised it. It matters in both directions. On the
   * census it is the only source of a mode on 114 rows: 107 of them are
   * departments literally named for on-site work ("ONSITE", "On-Site Property
   * Maintenance"), which IS the employer's own word, and 7 are named for the
   * head office ("HOME OFFICE", "CM Home Office"), which is not — and on 5 of
   * those the employer's dropdown says On-site, so the category reading was
   * deleting their own answer. The category is therefore still read and the
   * head-office phrase is masked out of it, and the copy on the card names the
   * department as a source because the code reads one.
   */
  const DEPTS: ReadonlyArray<readonly [string | null, Mode, string]> = [
    [null, null, "no category at all"],
    ["Internships", null, "a category that states nothing"],
    ["ONSITE", "onsite", "the employer's own word"],
    ["On-Site Property Maintenance", "onsite", "27 census rows of this shape"],
    ["Remote Patient Monitoring", "remote", "a clinical family whose name carries the word: still the employer's own words, and the refusal below is what protects the dropdown"],
    ["HOME OFFICE", null, "a category named for the head-office building states nothing"],
    ["CM Home Office", null, "same, with a prefix"],
  ];

  it.each(
    ([[0, "hybrid"], [1, "onsite"], [2, "remote"], [null, null]] as ReadonlyArray<readonly [number | null, Mode]>)
      .flatMap(([jlt, enumMode]) => DEPTS.map(([dept, deptMode, why]) => [jlt, enumMode, dept, deptMode, why] as const)),
  )("dropdown %s with category %s", (jlt, enumMode, dept, deptMode) => {
    // SILENT_ROW: dropdown blank, title and place state nothing, so the category
    // is the only text source and the expectation is the rule itself.
    const job = normalizeCapture(SILENT_ROW, {
      JobLocationType: jlt as number | null,
      JobCategoryName: dept ?? undefined,
    });
    const expected = enumMode && deptMode && enumMode !== deptMode ? null : (enumMode ?? deptMode);
    expect(job.workMode, `dropdown ${String(jlt)} with category ${String(dept)}`).toBe(expected);
    expect(job.remote).toBe(job.workMode === "remote");
  });

  it("a category naming the head office never deletes the employer's dropdown answer", () => {
    // The 5 live rows: category "HOME OFFICE", dropdown On-site. Before the
    // mask the two contradicted and the board showed nothing.
    const job = normalizeCapture(SILENT_ROW, { JobLocationType: 1, JobCategoryName: "HOME OFFICE" });
    expect(job.workMode, "the head-office category refused the employer's own On-site").toBe("onsite");
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * A REFUSAL THE WRITER CANNOT WRITE IS NOT A REFUSAL.
 *
 * Everything above proves the NORMALIZER refuses a contradiction —
 * AUG_HYBRID_VS_ONSITE answers null, and the exhaustive pass covers every
 * dropdown against every title. All of it was true and deployed in .78, and on
 * 2026-10-01, with .81 live, that same posting still served "hybrid":
 *
 *   ukg:…:692bd5bf-2be4-4ddd-9e24-e32c507bb43f
 *   title "Pre-Visit Specialist I - Call Center *Hybrid*", dropdown On-site
 *   normalizeUkg -> null          served workMode -> "hybrid"
 *
 * The refusal was computed on every visit and discarded on every visit. Two
 * writers handle this column in the refresh diff loop and neither could carry
 * it: put("work_mode", …) is stated-only and returns on a null, and the escape
 * hatch that exists precisely to let a null through sat INSIDE
 * `row.remote !== prev.remote`. remote is false for hybrid, false for onsite
 * and false for null, so every transition inside that set leaves the boolean
 * still and was unwritable. Only a correction that happened to flip the
 * boolean — remote→null, the iCIMS case n115 was written for — could land.
 *
 * So the guard below is not about the normalizer, which was never wrong. It is
 * about the arithmetic that made a whole class of its answers undeliverable,
 * and it is stated as that arithmetic rather than as the shape of today's
 * code: FROM the modes and their booleans, derive which transitions leave
 * `remote` unchanged; that set is non-empty; therefore a writer that requires
 * the boolean to move cannot deliver them.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("a work-mode correction that does not move the boolean is still written", () => {
  const INDEX = codeOf(
    readFileSync(resolve(HERE, "../../supabase/functions/job-board/index.ts"), "utf8"),
  );
  // `remote: workMode === "remote"` — the derivation every normalizer uses.
  const MODES = [null, "remote", "hybrid", "onsite"] as const;
  const remoteOf = (m: string | null) => m === "remote";

  it("the hazard is real: most mode changes leave the boolean untouched", () => {
    const still = MODES.flatMap((a) =>
      MODES.filter((b) => b !== a && remoteOf(a) === remoteOf(b)).map((b) => `${a}->${b}`),
    );
    // hybrid<->onsite, hybrid<->null, onsite<->null — six of the twelve.
    expect(still).toContain("hybrid->null");
    expect(still).toContain("onsite->null");
    expect(
      still.length,
      "if no transition left the boolean still, gating the trinary on the boolean would be harmless",
    ).toBe(6);
  });

  /** The diff loop's pair block, sliced by code and not by prose. */
  const pairBlock = (): string => {
    const i = INDEX.indexOf('typeof row.remote === "boolean"');
    expect(i, "the pair block is gone — re-point this guard").toBeGreaterThan(0);
    // To the end of the statement that follows the work_mode write.
    return INDEX.slice(i, i + 1200);
  };

  it("reads the real block, not an empty slice", () => {
    expect(INDEX.length, "index.ts read as empty — every check here would pass vacuously")
      .toBeGreaterThan(100_000);
    expect(pairBlock()).toContain("patch.work_mode");
  });

  it("does not gate the trinary on the boolean having changed", () => {
    const head = pairBlock().slice(0, pairBlock().indexOf("{") + 1);
    expect(
      /row\.remote\s*!==\s*prev\.remote/.test(head),
      "the pair block is entered only when the boolean changed, so hybrid->null, " +
        "onsite->null and hybrid<->onsite can never be written — which is how a refusal " +
        "computed on every visit was discarded on every visit",
    ).toBe(false);
  });

  it("writes the trinary whenever it differs, and the boolean on its own test", () => {
    const b = pairBlock();
    // The trinary's own condition compares modes, not booleans.
    expect(b).toMatch(/nextMode\s*!==\s*prev\.work_mode/);
    expect(b).toMatch(/patch\.work_mode\s*=\s*nextMode/);
    // The boolean keeps its own guard inside the block rather than gating it.
    expect(b).toMatch(/if\s*\(\s*row\.remote\s*!==\s*prev\.remote\s*\)/);
  });

  it("does not log the same edit twice when the stated-only writer already wrote it", () => {
    // put() handles a non-null change earlier in the same loop. Without this
    // test the block would note() it a second time and job_board_field_changes
    // would report two employer edits where there was one.
    expect(pairBlock()).toMatch(/patch\.work_mode\s*===\s*undefined/);
  });
});
