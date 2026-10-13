// @vitest-environment node
/**
 * THE RECRUITER RUBRIC'S HOLES, CLOSED (spec §19.2, review problem 1).
 *
 * WHAT WAS WRONG. The 2026-10-12 judge (harness/judge.ts) set `licence = "ok"`
 * for every row, so a matcher that showed a Chicago ICU nurse twenty Texas jobs
 * needing a Texas licence lost nothing for it; it read sponsorship and
 * citizenship wording only from the descriptions the BEFORE run happened to
 * hold, so the prototype's rows were read for 54 of 364; and its sponsorship
 * pattern knew no UK or German refusal.
 *
 * WHAT IS TRUE NOW. judge.ts carries two rubrics: `legacy` (byte for byte as it
 * ran, so BEFORE replays to the decimal) and `v2`, which every comparison from
 * now on uses for BEFORE and AFTER alike. Each v2 rule below has a case that
 * fails without it. The rubric never imports the engine.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anyDescription, beforeDescription, loadCorpus } from "./fixtures/match-bench/corpus";
import {
  autoJudge, CITIZEN_ONLY, clearanceVerdict, judge, licenceVerdict, NO_SPONSOR, NO_SPONSOR_V2, normaliseUS, OVERRIDES, POSTING_FACTS,
  type PostingRow,
} from "./fixtures/match-bench/judge";
import { RESUMES } from "./fixtures/match-bench/dev/manifest";
import type { LicenceHeld, ResumeTruth } from "./fixtures/match-bench/types";

const truth = (o: Partial<ResumeTruth> = {}): ResumeTruth => ({
  id: "t", file: "t.txt", field: "nursing", profile: "mid", country: "US", home: "Chicago, IL", years: 6, gap: false,
  target: [/\b(registered nurse|rn|staff nurse)\b/i], adjacent: [], related: [], oldCareer: [], tooJunior: [], tooSenior: [/\bdirector\b/i],
  maxMinYears: 8, metro: ["chicago|IL"], relocate: "country", remoteOk: false, authorized: ["US"], sponsorshipFuture: false,
  citizen: true, licences: [], held: [], clearance: false, notes: "", ...o,
});
const rn = (region: string, compact = false): LicenceHeld => ({ kind: "rn", region, compact, label: `${region} RN` });
const row = (o: Partial<PostingRow> = {}): PostingRow => ({ id: "p1", title: "Registered Nurse - ICU", location: "Dallas, TX", country: "US", ...o });

describe("licences are checked (the legacy judge passed every one)", () => {
  const illinoisNurse = truth({ held: [rn("IL")] });
  const texasJob = "Requirements: Current, unencumbered Texas RN license required.";

  it("fails a nurse whose licence does not cover the state the posting requires, where legacy passed it", () => {
    expect(judge(illinoisNurse, row(), texasJob, "legacy").licence).toBe("ok");
    const v = judge(illinoisNurse, row(), texasJob, "v2");
    expect(v.licence).toBe("fail");
    expect(v.shortlist).toBe(false);
    expect(v.reasons.join()).toMatch(/rn licence in TX; holds IL/);
  });

  it("reads a multistate (compact) licence as covering every compact state, and no other", () => {
    const azCompact = truth({ held: [rn("AZ", true)] });
    expect(licenceVerdict(azCompact, "Registered Nurse", texasJob).fail).toBe(false);
    expect(licenceVerdict(azCompact, "Registered Nurse", "Must hold an active California RN license.").fail).toBe(true);
  });

  it("treats 'or eligible', 'within 90 days' and 'upon hire' as a licence that may follow the offer", () => {
    const il = truth({ held: [rn("IL")] });
    expect(licenceVerdict(il, "Registered Nurse", "Texas RN license or eligible for licensure by endorsement required.").fail).toBe(false);
    expect(licenceVerdict(il, "Registered Nurse", "Texas RN license required within 90 days of hire.").fail).toBe(false);
  });

  it("lets a national register cover its country and nothing else", () => {
    const nmc = truth({ country: "GB", authorized: ["GB"], held: [{ kind: "rn", region: "GB", label: "NMC" }] });
    expect(licenceVerdict(nmc, "Staff Nurse", "You must have active NMC registration.").fail).toBe(false);
    const ahpra = truth({ country: "AU", authorized: ["AU"], held: [{ kind: "rn", region: "AU", label: "AHPRA" }] });
    expect(licenceVerdict(ahpra, "Staff Nurse", "You must have active NMC registration.").fail).toBe(true);
  });

  it("fails a licensed title with no licence at all, even with no description to read", () => {
    expect(licenceVerdict(truth({ held: [] }), "Pharmacist - Retail", null).fail).toBe(true);
    expect(licenceVerdict(truth({ held: [{ kind: "pharmacist", region: "OH", label: "OH RPh" }] }), "Pharmacist - Retail", null).fail).toBe(false);
  });

  it("reads electrician grades: a journeyman is not a master, and an apprentice's registration is issued on hire", () => {
    const jman = truth({ field: "trades", held: [{ kind: "electrician", region: "PA", grade: "journeyman", label: "Journeyman" }] });
    expect(licenceVerdict(jman, "Electrician", "A valid Master Electrician license is required.").fail).toBe(true);
    expect(licenceVerdict(jman, "Electrician", "Journeyman or Master electrician license required.").fail).toBe(false);
    const appr = truth({ field: "trades", held: [] });
    expect(licenceVerdict(appr, "Apprentice Electrician", "Apprentice electrician registration card required upon hire.").fail).toBe(false);
    expect(licenceVerdict(truth({ held: [{ kind: "electrician", region: "PA", grade: "apprentice", label: "Apprentice" }] }), "Journeyman Electrician", null).fail).toBe(true);
  });

  it("reads a CDL's class, and a US CDL as good in every state", () => {
    const classB = truth({ held: [{ kind: "cdl", region: "TX", grade: "B", label: "CDL-B" }] });
    expect(licenceVerdict(classB, "Delivery Driver", "Valid Class A CDL required.").fail).toBe(true);
    const classA = truth({ held: [{ kind: "cdl", region: "TX", grade: "A", label: "CDL-A" }] });
    expect(licenceVerdict(classA, "Delivery Driver", "Valid Class A CDL required. Ohio routes.").fail).toBe(false);
  });

  it("never fails a licence the posting only prefers", () => {
    expect(licenceVerdict(truth({ held: [] }), "Senior Accountant", "CPA license preferred.").fail).toBe(false);
    expect(licenceVerdict(truth({ held: [] }), "Senior Accountant", "Active CPA license required.").fail).toBe(true);
  });
});

describe("a clearance is a credential", () => {
  const citizen = truth({ citizen: true, clearance: false });
  const nonCitizen = truth({ citizen: false, clearance: false });

  it("fails anyone without an active clearance when the posting needs one held, citizen or not", () => {
    const d = "Active Secret clearance required to start.";
    expect(clearanceVerdict(citizen, d).fail).toBe(true);
    expect(clearanceVerdict(truth({ clearance: true }), d).fail).toBe(false);
    expect(judge(citizen, row({ title: "Registered Nurse" }), d, "v2").licence).toBe("fail");
  });

  it("fails 'able to obtain a clearance' only for a non-citizen, and as authorisation rather than a credential", () => {
    const d = "Candidates must be able to obtain a Secret clearance.";
    expect(clearanceVerdict(citizen, d).fail).toBe(false);
    const v = clearanceVerdict(nonCitizen, d);
    expect(v).toEqual({ fail: true, why: "clearance needs citizenship" });
  });

  it("does not read a public-trust or an optional clearance as a citizenship test", () => {
    expect(clearanceVerdict(nonCitizen, "Must be eligible to obtain a Public Trust clearance.").fail).toBe(false);
    expect(clearanceVerdict(citizen, "Please tell us if you hold a security clearance.").fail).toBe(false);
  });
});

describe("authorisation wording is read wherever a description exists", () => {
  const opt = truth({ sponsorshipFuture: true, citizen: false });

  it("reads the UK and German refusals the legacy pattern missed", () => {
    const uk = "Unfortunately we are unable to provide a work permit for this position.";
    const de = "Eine gültige Arbeitserlaubnis ist Voraussetzung.";
    for (const d of [uk, de]) {
      expect(NO_SPONSOR.test(d)).toBe(false);
      expect(NO_SPONSOR_V2.test(d)).toBe(true);
    }
    expect(judge(opt, row({ title: "Registered Nurse" }), uk, "v2").auth).toBe("fail");
    expect(judge(opt, row({ title: "Registered Nurse" }), uk, "legacy").auth).toBe("ok");
  });

  it("reads 'U.S. citizen' through the dots that broke the legacy windows", () => {
    expect(normaliseUS("Must be a U.S. citizen.")).toBe("Must be a US citizen.");
    expect(judge(truth({ citizen: false }), row(), "Must be a U.S. citizen.", "v2").auth).toBe("fail");
  });

  it("lets a permanent resident through 'citizens or permanent residents', and stops a visa holder", () => {
    const d = "Applicants must be US citizens or lawful permanent residents.";
    expect(judge(truth({ citizen: false, permanentResident: true }), row(), d, "v2").auth).toBe("ok");
    expect(judge(truth({ citizen: false }), row(), d, "v2").auth).toBe("fail");
    expect(judge(truth({ citizen: true }), row(), d, "v2").auth).toBe("ok");
    // Legacy read the clause as citizenship-only for anyone not a citizen.
    expect(CITIZEN_ONLY.test(d)).toBe(false);
  });

  it("says, on every verdict, whether a description was read", () => {
    expect(judge(truth(), row(), null, "v2").descRead).toBe(false);
    expect(judge(truth(), row(), "Some text.", "v2").descRead).toBe(true);
  });

  it("hands v2 every description the corpus holds, where legacy saw only BEFORE's own", () => {
    const c = loadCorpus();
    const onlyLater = [...c.rows.keys()].find((id) => c.description(id) && !(c.descriptionSource(id) ?? "").startsWith("before:"));
    expect(onlyLater).toBeTruthy();
    expect(beforeDescription(onlyLater!)).toBeNull();
    expect(anyDescription(onlyLater!)).toBe(c.description(onlyLater!));
  });
});

describe("what did not move", () => {
  it("still counts an unplaced location in the candidate's favour and a country they cannot work in against them", () => {
    const t = truth({ relocate: "none" });
    expect(autoJudge(t, row({ location: "Main Campus", country: "US" }), null).location).toBe("unknown");
    const abroad = autoJudge(t, row({ location: "Toronto, ON", country: "CA" }), null);
    expect(abroad.location).toBe("mismatch");
    expect(abroad.auth).toBe("fail");
  });

  it("applies the hand reviews (pair overrides and posting facts) under both rubrics", () => {
    const [key, o] = Object.entries(OVERRIDES)[0];
    const [rid, pid] = key.split("::");
    const t = RESUMES.find((r) => r.id === rid)!;
    const base: PostingRow = { id: pid, title: "x" };
    for (const rubric of ["legacy", "v2"] as const) {
      const v = judge(t, base, null, rubric);
      expect(v.reviewed).toBe(true);
      for (const [k, val] of Object.entries(o)) if (k !== "note") expect((v as unknown as Record<string, unknown>)[k]).toBe(val);
    }
    expect(Object.keys(POSTING_FACTS).length).toBe(121);
    expect(Object.keys(OVERRIDES).length).toBe(14);
  });

  it("never imports the engine it grades", () => {
    const src = readFileSync(join(__dirname, "fixtures/match-bench/judge.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*(supabase\/functions|licence-rules|posting-requirements|match-tiers|title-families|resume-profile)/);
  });
});
