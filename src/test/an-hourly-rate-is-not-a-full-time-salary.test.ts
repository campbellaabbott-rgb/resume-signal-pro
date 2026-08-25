// The salary floor returned the OPPOSITE of what was asked, because every
// sub-annual rate was annualized at a full-time load nobody had checked.
//
// Measured against production 2026-08-25 (build 2026-08-25.6), reproduced 3/3:
//   {"action":"list","q":"teacher","salaryFloor":90000,"limit":40}
//     -> 15 jobs, FOURTEEN of them salaryPeriod:"hour".
// The rows the floor served, and what the employers' own pages say:
//   "USD 44 per hour"        -> 91,520   After-school Chess Teacher; the posting
//                                        says "part-time, hourly positions"
//   "$90 per hour"           -> 187,200  VI Teacher; "Expected Hours: 10-40 per week"
//   "$75–300/per-hour-wage"  -> 156,000  Head-Royce SUBSTITUTE teacher
//   "$80/hour"               -> 166,400  Infusion Nurse Practitioner (PRN)
//   "$160–160/per-day-wage"  -> 332,800  substitute teacher — MULT had no 'day'
//                                        key at all, so a $160 DAY rate fell
//                                        through the unlabeled-hourly inference
//                                        and was annualized at 2080 h/yr
// After: every one of those returns annualMin null, except the day rate, which
// annualizes honestly at 260 working days (41,600) when nothing says part-time.
//
// The guard was tuned against 183 live rows pulled the same day (93 hourly/
// unlabeled rows behind salaryFloor probes on teacher/nurse/tutor/coach/driver,
// plus 90 rows across technician/engineer/analyst/manager/phlebotomist/
// caregiver). 39 fired; the two false positives that surfaced — a full-time
// Weld Technician whose benefits list ends "these benefits also apply to
// part-time employees", and a $197,300 Capital One engineering role whose pay
// footer says "salaries for part-time roles will be prorated" — are pinned
// below, because hiding a real full-time job from the floor is the failure
// mode this guard can cause and the one nobody would notice.
import { describe, it, expect } from "vitest";
import {
  parseSalaryStructured,
  detectPartTime,
  type SalaryContext,
} from "../../supabase/functions/_shared/salary-extract";

// Real title/description text as stored, trimmed to the sentence that carries
// (or fails to carry) the signal.
const AFTER_SCHOOL: SalaryContext = {
  title: "After-school Chess Teacher",
  description:
    "We are looking to fill multiple roles in order to return our after-school programs to in-person learning. These are part-time, hourly positions available during the school year from September through June, following the NYC DOE schedule.",
};
const VI_TEACHER: SalaryContext = {
  title: "VI Teacher",
  description:
    "Job Types: Full-Time, Part-Time, Contract\nPay: $90 per hour\nExpected Hours: 10-40 per week\nBenefits: \n- flexible schedule",
};
const SUBSTITUTE_DAY: SalaryContext = { title: "Substitute Teacher (As-Needed Basis)" };
const HEAD_ROYCE: SalaryContext = { title: "Head-Royce Substitute Teacher" };
const PRN_NP: SalaryContext = { title: "Infusion Nurse Practitioner (PRN)" };
const PER_DIEM_CRNA: SalaryContext = {
  title: "Certified Registered Nurse Anesthetist (CRNA), Endoscopy - Per Diem - Seattle, WA",
};
const CASUAL_PA: SalaryContext = {
  title: "Per Diem Physician Assistant or Nurse Practitioner (Casual Employee)",
};
const PERMANENT_PART_TIME_AU: SalaryContext = {
  title: "Clinical Nurse Surgical Ward",
  description:
    "Clinical Nurse – Surgical Ward | Buderim Hospital\nEmployment Term:   Permanent Part Time Opportunity Available\nLocation: Buderim Private Hospital, Sunshine Coast QLD\nRemuneration:   $55.63   -   $59.61",
};
const PERMANENT_PART_TIME_CA: SalaryContext = {
  title: "Health Records Technician",
  description:
    "Job Category: Administrative/Clerical \nHospital Location: Newmarket ON \nJob Type: Permanent, Part time \nNumber of Positions: 1 \nUnion: SEIU CLERICAL \nMinimum - Maximum Hourly Rate: $33.61 - $37.32",
};
const TUTOR_3_TO_12_HOURS: SalaryContext = {
  title: "Special Education Tutor - Middle School Math",
  description:
    "Requirements \n• 3-12 hours per week of availability\n• An earned Bachelor's degree (Masters preferred)",
};
const COACH_6_HOURS: SalaryContext = {
  title: "1:1 College Academic Coach & Tutor (Adult Learner Support)",
  description:
    "Hours: Flexible per week based on agreed schedule (up to 6 hours/week)\nSubjects: General College Academic Support & Executive Functioning",
};

// Full-time controls — the guard must leave every one of these alone.
const STANFORD_RN: SalaryContext = {
  title: "Clinical Nurse (RN), BMT/CT Clinic - 8HR Days 1.0",
  description:
    "Monitors and evaluates data as frequently as needed based on stability.\nPlans and Implements Therapeutic Interventions: Collaborates with the patient, family and care team, setting priorities, delegating tasks appropriately, and seeking assistance as needed.",
};
const IVX_FULL_TIME_NP: SalaryContext = {
  title: "Infusion Nurse Practitioner (NP)",
  description:
    "FT Nurse Practitioner (NP) | West Bay Area Market\nLocation(s): San Mateo Infusion Center \nFull-Time | Monday - Friday + rotating Saturdays | 7:00 AM - 7:00 PM\nIn addition to cash pay, full-time regular employees are eligible for 401(k), health benefits, and other company benefit programs.",
};
const WELD_TECH: SalaryContext = {
  title: "Weld Technician- 1st Shift",
  description:
    "Disability benefits\nLife Insurance\nParental leave\nAdoption benefits\nTuition Reimbursement\n* These benefits also apply to part-time employees\nPosting Dates: \nAugust 25, 2026 - November 15, 2026",
};
const CAPITAL_ONE: SalaryContext = {
  title: "Lead Software Engineer, Full Stack (Java, API, AWS, AI)",
  description:
    "This role is expected to accept applications for a minimum of 5 business days. Salaries for part-time roles will be prorated based upon the agreed upon number of hours to be regularly worked. \nMcLean, VA: $197,300 - $225,100 for Lead Software Engineer",
};
// Added at review, 2026-08-25: the one false positive the guard still had,
// found by re-running it over 155 live rows pulled with their descriptions.
// Its title DECLARES full time; its only "part-time" is inside an eligibility
// footnote whose "Eligibility" sits 89 chars away — nine characters outside the
// ±80 boilerplate window, so the window could not reject it. 85,488 -> null,
// i.e. a declared full-time job hidden from the salary floor.
const GENETICS_COUNSELOR_FT: SalaryContext = {
  title:
    "Genetics Counselor II - Pediatric Cancer and Blood Disorders Genetic Predisposition Clinic - Full Time",
  description:
    "Well-being programs\nEducational Assistance Program\nNote: Eligibility for programs listed above may depend on your FTE or status (e.g., full-time, part-time, per diem, temporary, etc.); please ask a Recruiter for more information during an interview.",
};
const SEIT: SalaryContext = {
  title: "SEIT / Special Education Teacher – Nassau County",
  description: "Provide direct special education instruction to preschool students in Nassau County.",
};

describe("a day rate is not an hourly rate", () => {
  it("annualizes lever's per-day-wage at working days, not at 2080 hours", () => {
    const p = parseSalaryStructured("$160–160/per-day-wage", "US");
    expect(p?.period, "'day' had no entry in the period vocabulary at all").toBe("day");
    expect(p?.annualMultiplier).toBe(260); // 52 weeks x 5 days; 2080 / 260 = an 8-hour day
    expect(p?.annualMin, "was 332,800 — the unlabeled-hourly inference at 2080").toBe(41_600);
    expect(p?.annualMax).toBe(41_600);
  });

  it("reads the other day phrasings the feeds use", () => {
    expect(parseSalaryStructured("$500 per day", "US")?.annualMin).toBe(130_000);
    expect(parseSalaryStructured("$160/day", "US")?.annualMin).toBe(41_600);
    expect(parseSalaryStructured("£350 a day", "GB")?.annualMin).toBe(91_000);
  });

  it("keeps an explicit annual figure when the text also mentions a day", () => {
    // 'day' is tested LAST, after year: mistaking a salary for a day rate is a
    // 260x error, and this phrasing is common in shift-work postings.
    const p = parseSalaryStructured("$120,000 per year, 8 hours a day", "US");
    expect(p?.period).toBe("year");
    expect(p?.annualMin).toBe(120_000);
  });

  it("applies a magnitude window to day rates like every other period", () => {
    expect(parseSalaryStructured("$20 per day", "US")?.annualMin, "below any real day rate").toBeNull();
    expect(parseSalaryStructured("$8,000 per day", "US")?.annualMin, "not a day rate").toBeNull();
  });
});

describe("a part-time rate is not annualized as full-time", () => {
  it("refuses the rows the salaryFloor=90000 teacher probe actually served", () => {
    expect(parseSalaryStructured("USD 44 per hour", "US", AFTER_SCHOOL)?.annualMin, "was 91,520").toBeNull();
    expect(parseSalaryStructured("$90 per hour", "US", VI_TEACHER)?.annualMin, "was 187,200").toBeNull();
    expect(parseSalaryStructured("$75–300/per-hour-wage", "US", HEAD_ROYCE)?.annualMin, "was 156,000").toBeNull();
    expect(parseSalaryStructured("$160–160/per-day-wage", "US", SUBSTITUTE_DAY)?.annualMin, "was 332,800").toBeNull();
  });

  it("refuses per-diem / PRN / casual healthcare rates", () => {
    expect(parseSalaryStructured("$80/hour", "US", PRN_NP)?.annualMin, "was 166,400").toBeNull();
    expect(parseSalaryStructured("$160/hour", "US", PER_DIEM_CRNA)?.annualMin, "was 332,800").toBeNull();
    expect(parseSalaryStructured("$73.00 per hour", "US", CASUAL_PA)?.annualMin, "was 151,840").toBeNull();
  });

  it("refuses an UNLABELED rate too — the inference assumes the same 2080", () => {
    // Neither string carries a period word; both were annualized by the
    // inferred-hourly path, which is exactly as load-dependent as "per hour".
    expect(parseSalaryStructured("$55.63 - $59.61", "AU", PERMANENT_PART_TIME_AU)?.annualMin, "was 115,710").toBeNull();
    expect(parseSalaryStructured("$33.61 - $37.32", "CA", PERMANENT_PART_TIME_CA)?.annualMin, "was 69,909").toBeNull();
  });

  it("reads a stated weekly load below the 30h full-time line", () => {
    expect(parseSalaryStructured("$55 - $75/hr", "US", TUTOR_3_TO_12_HOURS)?.annualMin, "was 114,400").toBeNull();
    expect(parseSalaryStructured("$45-$50/hr", "US", COACH_6_HOURS)?.annualMin, "was 93,600").toBeNull();
    expect(detectPartTime(TUTOR_3_TO_12_HOURS)).toBe("12 hours per week");
    expect(detectPartTime(COACH_6_HOURS)).toBe("6 hours per week");
  });

  it("drops the upper bound with the lower one — never one end of a range", () => {
    const p = parseSalaryStructured("$55 - $75/hr", "US", TUTOR_3_TO_12_HOURS);
    expect(p?.annualMax).toBeNull();
    expect(p?.annualMultiplier).toBeNull();
  });

  it("still reports the posting's own verbatim rate and period", () => {
    // Refusing the annual figure must not erase what the employer stated —
    // the card keeps showing "$44 per hour", it just stops claiming $91,520.
    const p = parseSalaryStructured("USD 44 per hour", "US", AFTER_SCHOOL);
    expect(p?.min).toBe(44);
    expect(p?.period).toBe("hour");
    expect(p?.currency).toBe("USD");
    expect(p?.partTimeSignal).toBe("part-time");
  });
});

describe("the part-time guard must not hide a full-time job", () => {
  it("leaves full-time hourly clinical roles alone", () => {
    // Both descriptions say "as needed" — about clinical judgement, not hours.
    expect(parseSalaryStructured("$96.35 - $111.14 per hour", "US", STANFORD_RN)?.annualMin).toBe(200_408);
    expect(parseSalaryStructured("$76 — $91.50", "US", IVX_FULL_TIME_NP)?.annualMin).toBe(158_080);
    expect(detectPartTime(STANFORD_RN)).toBeNull();
    expect(detectPartTime(IVX_FULL_TIME_NP)).toBeNull();
  });

  it("ignores part-time mentions inside benefits and pay-policy boilerplate", () => {
    expect(parseSalaryStructured("$29.60 - $38.50", "US", WELD_TECH)?.annualMin).toBe(61_568);
    expect(detectPartTime(WELD_TECH), '"these benefits also apply to part-time employees"').toBeNull();
    expect(detectPartTime(CAPITAL_ONE), '"salaries for part-time roles will be prorated"').toBeNull();
    expect(parseSalaryStructured("$197,300 - $225,100", "US", CAPITAL_ONE)?.annualMin).toBe(197_300);
  });

  it("lets a title that declares full time outrank prose", () => {
    expect(detectPartTime(GENETICS_COUNSELOR_FT), "its title says Full Time").toBeNull();
    expect(parseSalaryStructured("$41.10 - $61.65", "US", GENETICS_COUNSELOR_FT)?.annualMin).toBe(85_488);
    // The veto is the TITLE's, not the description's: a description offering
    // both types is still ambiguous and must still suppress.
    expect(detectPartTime(VI_TEACHER), '"Job Types: Full-Time, Part-Time" in prose').toBe("part-time");
    // And a title that states both is ambiguous too — the stated part-time word
    // wins over the full-time word beside it.
    expect(detectPartTime({ title: "Barista - Full Time / Part Time" })).toBe("part time");
  });

  it("does not treat a dress code or a restaurant category as a contract type", () => {
    expect(detectPartTime({ title: "Server - Casual Dining", description: "Join our team." })).toBeNull();
    expect(detectPartTime({ title: "Staff Engineer", description: "Our office is business casual and dog friendly." })).toBeNull();
    expect(detectPartTime({ title: "Investment Banking Analyst", description: "You will cover regional banks." })).toBeNull();
    expect(detectPartTime({ title: "Disaster Relief Program Manager", description: "Coordinate relief efforts." })).toBeNull();
  });

  it("leaves a rate alone when nothing in the posting states a load", () => {
    // Honest residue: a SEIT teacher is paid per session in practice, but the
    // posting says so nowhere, so the board keeps annualizing at 2080. The
    // guard fires on stated facts only — it does not infer from job titles.
    expect(parseSalaryStructured("$64-$75/ hour", "US", SEIT)?.annualMin).toBe(133_120);
    expect(parseSalaryStructured("$64-$75/ hour", "US")?.annualMin).toBe(133_120);
  });

  it("never touches a figure the employer already stated per year or per month", () => {
    // Annualizing these assumes nothing about hours, so a part-time posting
    // that quotes a salary keeps it — suppressing it would hide a real
    // part-time salary from a filter that asked for salaries.
    const yearly = parseSalaryStructured("$150K – $180K", "US", { title: "Nurse Practitioner - Part Time" });
    expect(yearly?.annualMin).toBe(150_000);
    expect(yearly?.partTimeSignal, "detected, and deliberately not acted on").toBe("part time");
    const monthly = parseSalaryStructured("$6,000 per month", "US", { title: "Part-Time Bookkeeper" });
    expect(monthly?.annualMin).toBe(72_000);
  });
});

describe("the annual figure and the salary text cannot disagree", () => {
  // The day-rate bug was a DISAGREEMENT the returned shape could not express:
  // the text said "per-day-wage", the stored annual had been computed at
  // 2080 h/yr, and nothing tied the two together. annualMultiplier now does.
  const CASES: Array<[string, string | null, SalaryContext | undefined]> = [
    ["$136k–227k/per-year-salary", "US", undefined],
    ["$22.5–22.5/per-hour-wage", "US", undefined],
    ["$160–160/per-day-wage", "US", undefined],
    ["USD 4,000 - 6,000 monthly", "US", undefined],
    ["$1,200 per week", "US", undefined],
    ["$29.20 an hour", "US", undefined],
    ["$51.05 - $76.60", "US", undefined],
    ["$115,000 — $125,000", "US", undefined],
    ["USD 44 per hour", "US", AFTER_SCHOOL],
    ["$96.35 - $111.14 per hour", "US", STANFORD_RN],
    ["$160–160/per-day-wage", "US", SUBSTITUTE_DAY],
  ];

  it("always reports annualMin as min times the multiplier it claims", () => {
    for (const [text, country, ctx] of CASES) {
      const p = parseSalaryStructured(text, country, ctx);
      expect(p, text).not.toBeNull();
      if (p!.annualMin === null) {
        expect(p!.annualMultiplier, text).toBeNull();
        expect(p!.annualMax, text).toBeNull();
        continue;
      }
      expect(p!.annualMultiplier, text).not.toBeNull();
      expect(Math.round(p!.min * p!.annualMultiplier!), text).toBe(p!.annualMin);
      if (p!.annualMax !== null) {
        expect(Math.round(p!.max! * p!.annualMultiplier!), text).toBe(p!.annualMax);
      }
    }
  });

  it("uses the multiplier the stated period implies, never another one", () => {
    const EXPECTED: Record<string, number> = { hour: 2080, day: 260, week: 52, month: 12, year: 1 };
    for (const [text, country, ctx] of CASES) {
      const p = parseSalaryStructured(text, country, ctx);
      if (!p || p.period === null || p.annualMultiplier === null) continue;
      expect(p.annualMultiplier, `${text} says "${p.period}"`).toBe(EXPECTED[p.period]);
    }
  });
});
