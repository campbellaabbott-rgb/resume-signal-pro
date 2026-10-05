/**
 * THE AGENT'S TYPESCRIPT HALF (platform debug sweep 2026-10-04, agents-api).
 *
 * Behaviour, run — not spellings read. Each block names the register item it
 * holds:
 *
 *   1.11   generate-application-answers' real response, through the boundary
 *          converter, into buildPacket: no throw, the draft is used
 *   L9-05  the packet builder fills only what it holds (2.32 sponsorship
 *          inversion, current salary, start-date phrasings, name halves,
 *          someone else's name, a cover-letter box)
 *   L9-06  the cover-note gate checks sentence-initial and mixed-case names,
 *          and matches a résumé word that ends a sentence
 *   L9-04  a saved search's own countries reach its run
 *   1.13   the worker fills an adapter from the live identity, split
 *   L9-07  a refusal about the moment is retried, one of principle is not
 *   1.12   every vendor the agent claims to submit to has an adapter that
 *          can reach a submit
 *   1.69 / L9-12 / L9-18  /v1's parsers refuse what they cannot bind
 *   1.41   the /v1/companies walk visits every employer exactly once
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPacket, toDraftedAnswers, type PacketQuestion } from "../../supabase/functions/_shared/submission-packet.ts";
import { validateCoverNote } from "../../supabase/functions/_shared/cover-note.ts";
import { searchRunRow } from "../../supabase/functions/_shared/mandate-reach.ts";
import { SENDABLE_VENDORS } from "../../supabase/functions/_shared/apply-automation.ts";
import { identityFields, MUST_FILL_IF_SHOWN } from "../../worker/src/packet-fields.ts";
import { classifyRefusal, isTransientRefusal } from "../../worker/src/refusal.ts";
import { intParam, isInvalid, isoParam, numParam, secondsToMidnightUtc } from "../../supabase/functions/public-api/params.ts";
import { companyPage, type CompanyRow } from "../../supabase/functions/public-api/company-walk.ts";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*/gm, " ");

describe("1.11 — a drafted answer reaches the packet in the shape the packet reads", () => {
  // EXACTLY what generate-application-answers returns (its .map at the end):
  // keyed by `question`, never `label`.
  const generatorResponse = {
    answers: [
      { question: "How familiar are you with Service Titan?", answer: "Two years scheduling 40 technicians in Service Titan.", supported: true, note: "", anticipated: false },
      { question: "Why do you want to work here?", answer: "", supported: false, note: "Add what draws you to the company.", anticipated: false },
    ],
    skipped: [],
    inferred: false,
  };
  const questions: PacketQuestion[] = [
    { label: "Full name", required: true },
    { label: "How familiar are you with Service Titan?", required: true, fieldType: "textarea" },
    { label: "Why do you want to work here?", required: false, fieldType: "textarea" },
  ];
  const profile = { fullName: "Ana Diaz", email: "ana@example.com" };

  it("buildPacket was handed the raw response before: it threw on d.label", () => {
    expect(() => buildPacket({
      questions, profile, standing: {}, automationTier: "auto",
      drafted: generatorResponse.answers as unknown as Parameters<typeof buildPacket>[0]["drafted"],
    })).not.toThrow(); // tolerant now, even of the wrong shape
  });

  it("through the converter, the grounded draft is used and the unsupported one is not", () => {
    const drafted = toDraftedAnswers(generatorResponse.answers);
    expect(drafted.map((d) => d.label)).toEqual(questions.slice(1).map((q) => q.label));
    const p = buildPacket({ questions, profile, standing: {}, drafted, automationTier: "auto" });
    const field = p.fields.find((f) => f.key === "How familiar are you with Service Titan?");
    expect(field).toMatchObject({ source: "drafted", value: generatorResponse.answers[0].answer });
    expect(p.fields.some((f) => f.key === "Why do you want to work here?")).toBe(false);
    expect(p.ready).toBe(true);
  });

  it("apply-agent converts at the boundary instead of assigning", () => {
    const agent = code(read("supabase/functions/apply-agent/index.ts"));
    expect(agent).toMatch(/drafted = toDraftedAnswers\(/);
    expect(agent).not.toMatch(/if \(Array\.isArray\(list\)\) drafted = list;/);
  });
});

describe("L9-05 / 2.32 — the packet builder fills only what it holds", () => {
  const standing = { workAuthorized: true, requiresSponsorship: false, salaryExpectation: "$95,000", earliestStart: "2026-11-02" };
  const profile = { fullName: "Ana Maria Diaz", email: "a@example.com", resumeFileUrl: "3f1c-uid/resume-1696.pdf" };
  const fill = (label: string, fieldType?: string, coverNote?: { value: string; tailored: boolean }) => {
    const p = buildPacket({ questions: [{ label, required: true, fieldType }], profile, standing, drafted: [], automationTier: "auto", coverNote });
    return { value: p.fields.find((f) => f.key === label)?.value ?? null, blocked: p.blockers.length > 0 };
  };

  it("'authorized to work … without sponsorship?' is answered for what it asks", () => {
    expect(fill("Are you legally authorized to work in the US without sponsorship?").value).toBe("Yes");
    expect(fill("Will you now or in the future require visa sponsorship?").value).toBe("No");
  });

  it("current salary is never answered with the expectation", () => {
    expect(fill("What is your current salary?")).toEqual({ value: null, blocked: true });
    expect(fill("What is your expected salary?").value).toBe("$95,000");
  });

  it("start-date phrasings are recognised, and a schedule question is not one", () => {
    expect(fill("What is the earliest date you could start?").value).toBe("2026-11-02");
    expect(fill("What days are you available to work?").value).not.toBe("2026-11-02");
  });

  it("first and last name are the halves, and someone else's name is not the candidate's", () => {
    expect(fill("First name").value).toBe("Ana");
    expect(fill("Last name").value).toBe("Maria Diaz");
    expect(fill("Referrer name")).toEqual({ value: null, blocked: true });
    expect(fill("Company name")).toEqual({ value: null, blocked: true });
  });

  it("a Cover Letter text box gets the note, never the résumé's storage path", () => {
    const note = { value: "I have run payments at scale for six years.", tailored: false };
    expect(fill("Cover Letter", "textarea", note).value).toBe(note.value);
    expect(fill("Cover Letter", "textarea")).toEqual({ value: null, blocked: true });
    expect(fill("Cover letter", "input_file")).toEqual({ value: null, blocked: true });
    expect(fill("Resume", "input_file").value).toBe(profile.resumeFileUrl);
  });
});

describe("L9-06 — the cover-note gate", () => {
  const resume = "Senior engineer at Acme Corp. Built the billing service, written in Kotlin.\nPython, SQL.";
  const pad = " I care about reliable systems, careful reviews and clear writing, and I would bring that habit to this team from day one of the role, alongside the patience a long migration needs.";
  const ok = (note: string) => validateCoverNote({ note: note + pad, resumeText: resume, jobTitle: "Engineer", company: "Initrode" });

  it("an employer the résumé never mentions is caught at the start of a sentence", () => {
    expect(ok("Google taught me how to run payments at scale.").ok).toBe(false);
  });

  it("a mixed-case employer is caught", () => {
    expect(ok("I spent two years at eBay running checkout.").ok).toBe(false);
  });

  it("a skill that ends a résumé sentence is grounded", () => {
    expect(ok("At Acme Corp I built the billing service in Kotlin.").ok).toBe(true);
  });

  it("ordinary sentence openers are not claims", () => {
    expect(ok("Having built billing at Acme Corp, I want to do it again.").ok).toBe(true);
  });
});

describe("L9-04 — a saved search's countries reach its run", () => {
  const mandate = { user_id: "u", countries: null as string | null, max_age_days: null, include_uncategorised: false };
  const search = { id: 7, label: "Pflege", q: "Pflegefachkraft", category: "", location: "", remote_only: false, salary_min: null, daily_count: 5 };

  it("a DE search on a mandate with no country runs in DE", () => {
    expect(searchRunRow(mandate, { ...search, countries: "DE" }).countries).toBe("DE");
  });

  it("a US search on a GB mandate runs in the US, and an explicit 'anywhere' stays anywhere", () => {
    expect(searchRunRow({ ...mandate, countries: "GB" }, { ...search, countries: "US" }).countries).toBe("US");
    expect(searchRunRow({ ...mandate, countries: "GB" }, { ...search, countries: null }).countries).toBeNull();
  });

  it("only a search read without the column keeps the mandate's value", () => {
    expect(searchRunRow({ ...mandate, countries: "GB" }, search).countries).toBe("GB");
  });

  it("the runner builds its rows with it", () => {
    expect(code(read("supabase/functions/agent-runner/index.ts"))).toMatch(/runRows\.push\(searchRunRow\(m, s\)\)/);
  });
});

describe("1.13 — the worker fills an adapter from the live identity", () => {
  it("first and last name come from the broker's answers, split, with no packet label at all", () => {
    const f = identityFields({ fullName: "Ana Maria Diaz", email: "a@example.com", phone: "+1 555" }, {});
    expect(f.firstName?.value).toBe("Ana");
    expect(f.lastName?.value).toBe("Maria Diaz");
    expect(f.fullName?.value).toBe("Ana Maria Diaz");
    expect(f.email?.value).toBe("a@example.com");
    expect(f.confirmEmail?.value).toBe("a@example.com");
  });

  it("a note tailored for this posting wins over the standing one", () => {
    const f = identityFields({ fullName: "A B", coverNote: "standing" }, { __coverNote: { value: "tailored", source: "drafted" } });
    expect(f.coverNote).toEqual({ value: "tailored", source: "drafted" });
  });

  it("an empty value is left out rather than typed", () => {
    expect(identityFields({ fullName: "Ana" }).lastName).toBeUndefined();
  });

  it("name and email are the inputs a form may not be submitted without", () => {
    expect(MUST_FILL_IF_SHOWN).toEqual(expect.arrayContaining(["firstName", "lastName", "email"]));
  });

  it("the worker no longer builds adapter fields from packet labels", () => {
    const idx = code(read("worker/src/index.ts"));
    expect(idx).toMatch(/fields: identityFields\(claimed\.answers, p\.fields\)/);
    expect(idx).not.toMatch(/toFieldKeys\(/);
  });

  it("a shown-but-empty name is a classified refusal, not an unclassified one", () => {
    const r = "the form asks for firstName, lastName and it could not be filled — not sending an application without the candidate's name or email";
    expect(classifyRefusal(r)).toEqual({ stage: "partial-fill", wording: "missing: firstName, lastName" });
  });
});

describe("L9-07 — a refusal about the moment is retried; one of principle is not", () => {
  it("timeouts, driver errors, a form that did not load, a résumé that did not attach: retried", () => {
    for (const r of [
      "driver error: Timeout 45000ms exceeded",
      "driver error: net::ERR_TIMED_OUT at https://x",
      "could not find the application form from this posting URL",
      "could not read this form's questions — not submitting blind",
      "the résumé did not attach — setFile reported no error, but neither the input nor the page shows the file",
    ]) expect(isTransientRefusal(r), r).toBe(true);
  });

  it("a question it cannot answer, a CAPTCHA, a closed posting, a missing CV: final", () => {
    for (const r of [
      "2 required question(s) the agent cannot answer — salary-current: not collected",
      "captcha appeared on a vendor measured clean — needs a human",
      "posting is closed",
      "this form wants a résumé and none is attached to the profile",
      "form asks 3 question(s) and no standing answers are on file",
    ]) expect(isTransientRefusal(r), r).toBe(false);
  });
});

describe("1.12 — the agent claims only vendors it can submit to", () => {
  const registry = read("worker/src/vendors/index.ts");
  const adapters = registry.slice(registry.indexOf("export const ADAPTERS"), registry.indexOf("};", registry.indexOf("export const ADAPTERS")));
  const registered = [...adapters.matchAll(/^\s*([a-z][a-z0-9_]*),\s*$/gm)].map((m) => m[1]);

  it("SENDABLE_VENDORS is exactly the registered adapters", () => {
    expect([...registered].sort()).toEqual([...SENDABLE_VENDORS].sort());
    expect(registered.length).toBeGreaterThan(0);
  });

  for (const v of SENDABLE_VENDORS) {
    it(`${v}'s adapter can answer would-submit`, () => {
      expect(read(`worker/src/vendors/${v}.ts`)).toMatch(/return "would-submit"/);
    });
  }

  it("oracle is not among them, and its adapter still cannot submit", () => {
    expect(SENDABLE_VENDORS).not.toContain("oracle");
    expect(read("worker/src/vendors/oracle.ts")).not.toMatch(/return "would-submit"/);
  });
});

describe("1.69 / L9-12 / L9-18 — /v1 parses or refuses, never drops", () => {
  const q = (s: string) => new URLSearchParams(s);

  it("a fractional or non-numeric limit is refused; absent keeps the default", () => {
    expect(isInvalid(intParam(q("limit=1.5"), "limit"))).toBe(true);
    expect(isInvalid(intParam(q("limit=abc"), "limit"))).toBe(true);
    expect(intParam(q("limit=25"), "limit")).toBe(25);
    expect(intParam(q(""), "limit")).toBeNull();
  });

  it("salary_min=100k is refused instead of silently unfiltered", () => {
    expect(isInvalid(numParam(q("salary_min=100k"), "salary_min"))).toBe(true);
    expect(numParam(q("salary_min=100000"), "salary_min")).toBe(100000);
  });

  it("posted_after must be an ISO date, and is returned normalised", () => {
    expect(isInvalid(isoParam(q("posted_after=last-week"), "posted_after"))).toBe(true);
    expect(isInvalid(isoParam(q("posted_after=2026-09"), "posted_after"))).toBe(true);
    expect(isoParam(q("posted_after=2026-09-01"), "posted_after")).toBe("2026-09-01T00:00:00.000Z");
  });

  it("a quota refusal's Retry-After runs to midnight UTC, not an hour", () => {
    expect(secondsToMidnightUtc(Date.UTC(2026, 9, 5, 2, 0, 0))).toBe(22 * 3600);
    const api = code(read("supabase/functions/public-api/index.ts"));
    expect(api).toMatch(/"Retry-After": String\(secondsToMidnightUtc\(\)\)/);
    expect(api).not.toMatch(/quota_exceeded[^\n]*"Retry-After": "3600"/);
  });

  it("no limit or offset in /v1 is read with Number() any more", () => {
    const api = code(read("supabase/functions/public-api/index.ts"));
    expect(api).not.toMatch(/Number\((?:p|url\.searchParams)\.get\("(?:limit|offset)"\)\)/);
  });
});

describe("1.41 — the /v1/companies walk visits every employer exactly once", () => {
  // Mixed case on purpose: localeCompare and `>` disagree on exactly these.
  const rows: CompanyRow[] = [
    { token: "a1", count: 5 }, { token: "A2", count: 5 }, { token: "a3", count: 9 },
    { token: "acme", count: 1 }, { token: "BoschGroup", count: 7 }, { token: "bayada", count: 7 },
    { token: "M3USA", count: 2 }, { token: "cvshealth~wd1~CVS_Health_Careers", count: 3 },
    { token: "zeta", count: 0 }, { token: "Zulu", count: 0 }, { token: "jobs.novanthealth.org", count: 4 },
    { token: "x", count: 12 }, { token: "y", count: 12 },
  ];
  const walk = (term: string, limit: number) => {
    const seen: string[] = [];
    let cursor: { ep: string; id: string } | null = null;
    for (let guard = 0; guard < 100; guard++) {
      const pg = companyPage({ rows, term, cursor, limit, countOf: (r) => Number(r.count ?? 0) });
      seen.push(...pg.window.map((r) => String(r.token)));
      if (!pg.next) return { seen, matched: pg.matched, loops: guard };
      cursor = pg.next;
    }
    throw new Error("the walk did not end");
  };

  for (const limit of [1, 2, 3, 5]) {
    it(`count order, ${limit} a page: every employer once, biggest first`, () => {
      const { seen, matched } = walk("", limit);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen.length).toBe(matched);
      expect(seen.length).toBe(rows.length);
      expect(seen.slice(0, 2).sort()).toEqual(["x", "y"]);
    });
    it(`token order (q=a), ${limit} a page: every match once, in code-unit order`, () => {
      const { seen, matched } = walk("a", limit);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen.length).toBe(matched);
      expect(seen).toEqual([...seen].sort((p, r) => (p < r ? -1 : p > r ? 1 : 0)));
    });
  }
});
