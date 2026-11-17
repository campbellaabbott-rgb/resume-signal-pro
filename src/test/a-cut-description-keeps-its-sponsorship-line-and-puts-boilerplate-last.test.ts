/**
 * A CUT DESCRIPTION KEEPS ITS SPONSORSHIP LINE AND PUTS BOILERPLATE LAST
 * (MCP upgrade 3, W1 lane L4: U3-08r a and b, critique F4 and M10).
 *
 * WHAT WAS WRONG. In the 2026-11-16 probe (case c14) get_jobs cut ten
 * descriptions to an equal share of 15,000 characters, about 1,420 each, and
 * two of the cuts ended inside equal-opportunity text: no work-rights line
 * survived anywhere, so "which of these sponsor visas?" cost one more call
 * per job. The one-call answer planned for it, a "requirements" excerpt,
 * would have reused the apply excerpt (postingExcerptOf), which loses exactly
 * those lines twice over:
 *   - its six requirement slots fill first come, first served, so a closing
 *     "not eligible for visa sponsorship" line after six bullets is dropped;
 *   - it tests the boilerplate pattern before the requirement one, and that
 *     pattern counts E-Verify and equal-opportunity wording, so "Applicants
 *     must be authorized to work in the US; we participate in E-Verify" and
 *     Carvana's real "not eligible for visa sponsorship" sentence (glued to
 *     its equal-opportunity sentence) are thrown away as boilerplate.
 *
 * WHAT IS NOW TRUE.
 *   - requirementsExcerptOf tests work-rights lines first and always keeps up
 *     to two of them, plus up to four other requirement lines: six or fewer,
 *     240 characters or fewer each (a long work-rights sentence is cut around
 *     its work-rights words, never before them), so ten postings fit in
 *     14,400 characters, inside get_jobs' 15,000.
 *   - The words that mark a work-rights line are read in context: a payments
 *     firm's "Visa and Mastercard", event "sponsorship opportunities" and
 *     "employer-sponsored benefits" (all in c14) are not work-rights lines,
 *     and a compliance sentence about "work authorization ... requirements"
 *     is not one either.
 *   - boilerplateLast moves equal-opportunity, accommodation, privacy and
 *     benefits paragraphs after everything else before any cut, never a
 *     paragraph with work-rights words, a stated pay range or a requirement,
 *     and deletes nothing. Replaying c14's own cut on Movable Ink's whole
 *     posting with a sponsorship line at its end: today the line is cut off,
 *     with boilerplate last it survives.
 *   - postingExcerptOf, which apply_myself serves today, is unchanged.
 *
 * Found in review of the first version, and now true as well:
 *   - a veto word reaches only its own clause: "Visa" beside a card scheme
 *     in the same clause is the card, but a visa sentence after a sentence
 *     naming American Express is still a work-rights line, as is "the right
 *     to work in the UK and be willing to work shifts" and "a passport or a
 *     visa that allows them to work", while "eligible to work from home" is
 *     still not one;
 *   - citizenship, U.S.-person, immigration-support and "Remote (US only)"
 *     lines are work-rights lines, while a mission line about serving
 *     citizens, a firm that sponsors benefit plans, and a duty to manage an
 *     office relocation are not;
 *   - a label keeps its value from the next line, a benefits bullet that
 *     only says "Visa sponsorship" is kept, a heading is never a label's
 *     value, two joined headings are still a heading, and a line that opens
 *     with a heading and states a requirement is a requirement line;
 *   - portfolio, reference and licence lines are requirements, not
 *     how-to-apply lines;
 *   - a cut never splits an emoji;
 *   - boilerplateLast ends a benefits section at the next section heading,
 *     so requirements and pay under or after it are never moved (Airbus,
 *     Adyen, Liquid Personnel), and on every real text no moved line states
 *     pay or a requirement.
 *
 * Found in a second review: to keep a hostile page's cost in bounds, every
 * "<" with no ">" in the next 1,000 characters was read as text, so one long
 * tag (an inline base64 image, a Word style attribute, a SafeLinks href, an
 * SVG path) came back in postingExcerpt as its own markup, in place of the
 * requirement beside it. Now such a "<" is text only when another "<" comes
 * before its ">", so a long tag is still a tag, and a stray "<" in a line
 * still is text.
 *
 * Judged on real text: the c14 postings (fixture), and the 99 held-out
 * postings of the perk reader's test split, whose work-rights sentences are
 * listed below by hand. On that split the new excerpt keeps every listed
 * line, and keeps every work-rights line today's excerpt kept.
 */
import { describe, expect, it } from "vitest";
import {
  boilerplateLast,
  isWorkRightsLine,
  postingExcerptOf,
  requirementsExcerptOf,
} from "../../supabase/functions/agent-mcp/posting-excerpt";
import C14 from "./fixtures/posting-excerpt-c14.json";
import SPLIT from "./fixtures/perks-test-split.json";
import BOILER from "./fixtures/posting-terms-boilerplate-2026-11.json";
import LANG from "./fixtures/posting-language-corpus-2026-11-15.json";

type C14Posting = { id: string; title: string; company: string; cutText: string; wholeText?: string };
const POSTINGS = (C14 as { postings: C14Posting[] }).postings;
const posting = (idPrefix: string) => POSTINGS.find((p) => p.id.startsWith(idPrefix))!;
const ROWS = (SPLIT as { rows: Array<{ idx: number; company: string; description: string }> }).rows;
const row = (idx: number) => ROWS.find((r) => r.idx === idx)!;

/** A real sentence from the perk split (Carvana and Torbay Council postings). */
const NOT_ELIGIBLE = "This role is not eligible for visa sponsorship.";
const E_VERIFY = "Applicants must be authorized to work in the US; we participate in E-Verify.";

const linesOf = (text: string) => text.split("\n");
/**
 * Movable Ink's whole text in the order get_jobs cut it: requirements-first
 * puts the Qualifications heading first, then what followed it, then what
 * came before it. Checked against the cut c14 recorded, below.
 */
const asGetJobsOrderedMovableInk = (t: string) => {
  const at = t.indexOf("\nQualifications:") + 1;
  return `${t.slice(at).trim()}\n\n${t.slice(0, at).trim()}`;
};
const sorted = (xs: string[]) => [...xs].sort();
const keeps = (lines: string[], words: string) => lines.some((l) => l.includes(words));

describe("the c14 postings, as recorded", () => {
  it("are ten English postings whose cut text holds no work-rights line, and their whole text none either", () => {
    expect(POSTINGS).toHaveLength(10);
    for (const p of POSTINGS) {
      for (const text of [p.cutText, p.wholeText ?? ""]) {
        const flagged = linesOf(text).filter((l) => isWorkRightsLine(l));
        expect(flagged, p.id).toEqual([]);
      }
    }
  });

  it("a payments firm's Visa membership, event sponsorship and employer-sponsored benefits are not work-rights lines", () => {
    const modulr = linesOf(posting("greenhouse:modulrfinance").cutText).find((l) => /Visa and Mastercard/.test(l))!;
    expect(modulr).toBeTruthy();
    expect(isWorkRightsLine(modulr)).toBe(false);
    const starburst = linesOf(posting("greenhouse:starburst").wholeText!);
    for (const words of ["sponsorship opportunities across EMEA", "employer-sponsored benefits"]) {
      const l = starburst.find((x) => x.includes(words))!;
      expect(l, words).toBeTruthy();
      expect(isWorkRightsLine(l), words).toBe(false);
    }
  });
});

describe("requirementsExcerptOf keeps the work-rights lines today's excerpt loses", () => {
  it("a sponsorship line after six bullets (UMG's eight real bullets, then the line)", () => {
    const text = `${posting("workday:umusic").cutText}\n${NOT_ELIGIBLE}`;
    // Today's excerpt: the bullets fill its six requirement slots first.
    expect(postingExcerptOf(text)).not.toContain(NOT_ELIGIBLE);
    const ex = requirementsExcerptOf(text).postingExcerpt;
    expect(ex).toContain(NOT_ELIGIBLE);
    expect(ex.length).toBeLessThanOrEqual(6);
    // The others are the posting's own first requirement lines, in its order.
    expect(ex[0]).toBe("Passionate about music with a desire to progress in the industry.");
    expect(ex[ex.length - 1]).toBe(NOT_ELIGIBLE);
  });

  it("the E-Verify sentence that says who may work is a work-rights line, not boilerplate", () => {
    const text = `${posting("greenhouse:movableink").cutText}\n${E_VERIFY}`;
    expect(postingExcerptOf(text)).not.toContain(E_VERIFY);
    expect(isWorkRightsLine(E_VERIFY)).toBe(true);
    expect(requirementsExcerptOf(text).postingExcerpt).toContain(E_VERIFY);
    // E-Verify alone says nothing about the applicant: still boilerplate.
    expect(isWorkRightsLine("We participate in E-Verify.")).toBe(false);
  });

  it("two work-rights slots are kept even when a posting has many requirement lines, and they come first among work-rights lines about visas", () => {
    const bullets = Array.from({ length: 12 }, (_, i) => `· Requirement ${i + 1}: at least ${i + 2} years of experience with SQL and reporting tools`).join("\n");
    const text = [
      "Requirements:", bullets,
      "Relocation support is available for this role.",
      "Candidates must have the right to work in the UK.",
      NOT_ELIGIBLE,
    ].join("\n");
    const ex = requirementsExcerptOf(text).postingExcerpt;
    expect(ex).toHaveLength(6);
    // Visa and right-to-work lines outrank the relocation line for the two slots.
    expect(ex).toContain("Candidates must have the right to work in the UK.");
    expect(ex).toContain(NOT_ELIGIBLE);
    expect(ex.filter((l) => l.startsWith("Requirement")).length).toBe(4);
  });

  it("a bare heading is not taken as a work-rights line; the sentence under it is", () => {
    const text = "Requirements:\n· 3+ years of experience in B2B marketing\nVisa sponsorship\nWe are unable to sponsor visas for this role.";
    const ex = requirementsExcerptOf(text).postingExcerpt;
    expect(ex).not.toContain("Visa sponsorship");
    expect(ex).toContain("We are unable to sponsor visas for this role.");
  });

  it("a short line is kept when it is a work-rights line", () => {
    expect(requirementsExcerptOf("Requirements:\n· 3+ years of experience in B2B marketing\nNo sponsorship.").postingExcerpt).toContain("No sponsorship.");
  });

  it("how-to-apply lines are not requirements in this excerpt", () => {
    const text = "Requirements:\n· 3+ years of experience in B2B marketing\nTo apply, please submit your CV and a cover letter by 30 November.";
    expect(requirementsExcerptOf(text).postingExcerpt).toEqual(["3+ years of experience in B2B marketing"]);
  });
});

describe("on the perk reader's 99 held-out postings (real text, listed by hand)", () => {
  // Every work-rights sentence in the split, by posting: the words it must keep.
  const LISTED: Array<[number, string]> = [
    [10, "SC Security Clearance"],
    [36, "must have work authorization that does not now or in the future require sponsorship"],
    [39, "Baseline Security Clearance"],
    [141, "work authorized in the United States without the need for new visa sponsorship"],
    [149, "not eligible for visa sponsorship"],
    [150, "not eligible for visa sponsorship"],
    [151, "not eligible for visa sponsorship"],
    [152, "not eligible for visa sponsorship"],
    [153, "not eligible for visa sponsorship"],
    [160, "Eligible to work in the UK"],
    [162, "Eligible to work in the UK"],
    [201, "This role is eligible for visa sponsorship"],
    [202, "not eligible for visa sponsorship"],
    [203, "not eligible for visa sponsorship"],
    [204, "not eligible for visa sponsorship"],
  ];

  it("keeps every listed line, where today's excerpt keeps only some", () => {
    let today = 0;
    for (const [idx, words] of LISTED) {
      const r = row(idx);
      expect(keeps(requirementsExcerptOf(r.description).postingExcerpt, words), `#${idx} ${r.company}: ${words}`).toBe(true);
      if (keeps(postingExcerptOf(r.description), words)) today++;
    }
    console.log(`[L4] listed work-rights lines kept: today's excerpt ${today}/${LISTED.length}, requirements excerpt ${LISTED.length}/${LISTED.length}`);
    expect(today).toBeLessThan(LISTED.length);
  });

  it("is never worse than today's excerpt: every work-rights line today's keeps, the new one keeps", () => {
    for (const r of ROWS) {
      const now = requirementsExcerptOf(r.description).postingExcerpt;
      for (const l of postingExcerptOf(r.description).filter((x) => isWorkRightsLine(x))) {
        expect(now, `#${r.idx} ${r.company}`).toContain(l);
      }
    }
  });

  it("the only other lines it reads as work rights are relocation lines; no compliance or equal-opportunity sentence is one", () => {
    const listed = new Set(LISTED.map(([i]) => i));
    const unlisted: number[] = [];
    for (const r of ROWS) {
      for (const l of r.description.split("\n").filter((x) => isWorkRightsLine(x))) {
        if (listed.has(r.idx)) continue;
        unlisted.push(r.idx);
        expect(l, `#${r.idx} ${r.company}`).toMatch(/\breloca/i);
      }
    }
    // Adyen's relocation talk, Deliveroo's benefits line, Ramp's relocation cover.
    expect([...new Set(unlisted)].sort()).toEqual([142, 181, 182, 183, 184, 185]);
    for (const [idx, words] of [
      [15, "We comply with all applicable laws and regulations on non-discrimination"],
      [35, "All employment decisions shall be made without regard to age"],
      [92, "In compliance with Federal and State Equal Opportunity Laws"],
      [133, "in accordance with the Immigration Reform and Control Act of 1986"],
      [174, "does not discriminate on the basis of any legally protected characteristic"],
    ] as Array<[number, string]>) {
      const l = row(idx).description.split("\n").find((x) => x.includes(words))!;
      expect(l, `#${idx}`).toBeTruthy();
      expect(isWorkRightsLine(l), `#${idx} ${words}`).toBe(false);
    }
  });

  it("every excerpt has six lines or fewer of 240 characters or fewer", () => {
    for (const r of ROWS) {
      const ex = requirementsExcerptOf(r.description).postingExcerpt;
      expect(ex.length, `#${r.idx}`).toBeLessThanOrEqual(6);
      for (const l of ex) expect(l.length, `#${r.idx}`).toBeLessThanOrEqual(240);
    }
  });
});

describe("on real lines from the boilerplate and language fixtures", () => {
  const TEXT: Record<string, string> = Object.fromEntries([
    ...(BOILER as { rows: Array<{ id: string; description: string }> }).rows.map((r) => [r.id, r.description]),
    ...(LANG as { cases: Array<{ id: string; text: string }> }).cases.map((c) => [c.id, c.text]),
  ]);
  /** The sentence of a fixture posting that holds `words`, as the excerpt splits it. */
  const sentence = (id: string, words: string) => {
    const t = TEXT[Object.keys(TEXT).find((k) => k.includes(id))!];
    expect(t, id).toBeTruthy();
    const s = t.split(/\n+|<[^>]+>/).flatMap((l) => l.split(/(?<=[.!?])\s+(?=[A-Z])/)).find((x) => x.includes(words));
    expect(s, `${id}: ${words}`).toBeTruthy();
    return s!;
  };

  it.each([
    ["BoschGroup:744000158833829", "Indefinite U.S. work authorized individuals only."],
    ["SpringVentureGroup1", "We are unable to sponsor for this role now or in the future"],
    ["CanyonGBS", "must reside in the Philippines and be legally allowed to work"],
    ["SIXT", "must be authorized to work in Canada"],
    ["lutontownfootballclub", "Applicants must be eligible to live and work in the UK."],
    ["nandosanz~wd3~NandosANZ/JR109244", "Applicants must have the right to work in Australia/New Zealand"],
    ["REC_RTX_Ext_Gateway", "Active and existing security clearance required after day 1"],
    ["leidos~wd5~External/R-00196448-1", "US Citizen with at least an active Secret clearance."],
  ])("%s: a work-rights line", (id, words) => {
    expect(isWorkRightsLine(sentence(id, words))).toBe(true);
  });

  it.each([
    ["tipaltisolutions", "and Visa, enabling"],
    ["revantage~wd1~Revantage", "including itineraries, visas, and expense reports"],
    ["suddath~wd5~Suddath/R12265-1", "providing relocation and logistics services"],
    ["7c55d775-5122-40be-a0b0-1e35de7d70b9", "total relocation expert"],
    ["70410376-3018-4e61-a9e7-d6794946516c/9201261024603_2", "installation and relocation team"],
    ["70410376-3018-4e61-a9e7-d6794946516c/9201261024603_2", "relocate machinery and equipment"],
    ["70410376-3018-4e61-a9e7-d6794946516c/9201261057940_2", "equipment for relocation"],
    ["careers.keo.com/12843", "individual athletic sponsorship, study assistance sponsorship"],
    ["BoschGroup:744000158833829", "I9 / work authorization guidance"],
  ])("%s: not a work-rights line (%s)", (id, words) => {
    expect(isWorkRightsLine(sentence(id, words))).toBe(false);
  });

  it("a clearance label keeps its value from the next line (GDIT's template)", () => {
    const id = Object.keys(TEXT).find((k) => k.includes("gdit~wd5~External_Career_Site/RQ230851"))!;
    const ex = requirementsExcerptOf(TEXT[id]).postingExcerpt;
    expect(ex).toContain("Clearance Level Must Currently Possess: Secret");
    expect(ex).toContain("Clearance Level Must Be Able to Obtain: Top Secret");
    expect(ex).not.toContain("Clearance Level Must Currently Possess:");
  });

  it("\"authorized to work in the U.S. without sponsorship\" stays one line", () => {
    const ex = requirementsExcerptOf("Requirements:\n· Must be authorized to work in the U.S. without employer sponsorship now or in the future.").postingExcerpt;
    expect(ex).toEqual(["Must be authorized to work in the U.S. without employer sponsorship now or in the future."]);
  });
});

describe("the size bound", () => {
  it("ten postings come to 14,400 characters or fewer: six lines of 240 at most each", () => {
    const many = `Requirements:\n${Array.from({ length: 20 }, (_, i) => `· Requirement ${i}: ${"x".repeat(300)}`).join("\n")}\n${"We cannot sponsor a visa. ".repeat(20)}`;
    const ex = requirementsExcerptOf(many).postingExcerpt;
    expect(ex.length).toBeLessThanOrEqual(6);
    for (const l of ex) expect(l.length).toBeLessThanOrEqual(240);
    expect(ex.join("").length * 10).toBeLessThanOrEqual(14_400);
  });

  it("a work-rights sentence longer than 240 characters is cut around its work-rights words, never before them", () => {
    const long = `${"Our team works across many markets and time zones, with colleagues in offices from London to Singapore, ".repeat(4)}and we are unable to offer visa sponsorship for this position at this time.`;
    const ex = requirementsExcerptOf(`Requirements:\n${long}`).postingExcerpt;
    expect(ex).toHaveLength(1);
    expect(ex[0].length).toBeLessThanOrEqual(240);
    expect(ex[0]).toMatch(/unable to offer visa sponsorship/);
    expect(ex[0].startsWith("…")).toBe(true);
  });

  it("an empty description gives no lines and no flags, never a guess", () => {
    expect(requirementsExcerptOf("")).toEqual({ postingExcerpt: [] });
  });
});

describe("boilerplateLast", () => {
  const TEXTS = [
    ...POSTINGS.flatMap((p) => [p.cutText, p.wholeText].filter((t): t is string => !!t)),
    ...ROWS.map((r) => r.description),
  ];

  it("deletes nothing from any real text: the same lines, the same length", () => {
    for (const t of TEXTS) {
      const out = boilerplateLast(t);
      expect(out.length).toBe(t.length);
      expect(sorted(linesOf(out))).toEqual(sorted(linesOf(t)));
    }
  });

  it("never moves a line with work-rights or remote words: nothing that came after it comes before it", () => {
    let checked = 0;
    for (const t of TEXTS) {
      const lines = linesOf(t);
      const out = linesOf(boilerplateLast(t));
      lines.forEach((l, i) => {
        if (!isWorkRightsLine(l) && !/\bremote\b/i.test(l)) return;
        checked++;
        const left = new Map<string, number>();
        for (const x of lines.slice(0, i)) left.set(x, (left.get(x) ?? 0) + 1);
        for (const x of out.slice(0, nthIndex(out, l, lines.slice(0, i).filter((y) => y === l).length))) {
          const n = left.get(x) ?? 0;
          expect(n, `"${x}" came after "${l}" and now comes before it`).toBeGreaterThan(0);
          left.set(x, n - 1);
        }
      });
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("moves Movable Ink's two equal-opportunity paragraphs after its requirements, pay and responsibilities, from where get_jobs' order put them", () => {
    const whole = posting("greenhouse:movableink").wholeText!;
    const ordered = linesOf(asGetJobsOrderedMovableInk(whole));
    // As c14 cut it, the two paragraphs sat ahead of the responsibilities.
    expect(ordered.findIndex((l) => l.startsWith("We welcome and employ people"))).toBeLessThan(ordered.findIndex((l) => l.startsWith("Responsibilities:")));
    // The blank line that followed them goes with them; judged on the lines with text.
    const out = linesOf(boilerplateLast(ordered.join("\n"))).filter((l) => l.trim());
    expect(out[out.length - 2]).toMatch(/^Studies have shown that women/);
    expect(out[out.length - 1]).toMatch(/^We welcome and employ people regardless of race/);
    for (const kept of ["Qualifications:", "The base pay range", "Responsibilities:", "Support with the execution"]) {
      expect(out.findIndex((l) => l.startsWith(kept)), kept).toBeGreaterThan(-1);
      expect(out.findIndex((l) => l.startsWith(kept)), kept).toBeLessThan(out.length - 2);
    }
    // On the whole text, where they already come last, they stay last.
    expect(linesOf(boilerplateLast(whole)).slice(-2)).toEqual(linesOf(whole).slice(-2));
  });

  it("moves Treatwell's benefits and equal-opportunities sections, but not its \"100% remote position\" line", () => {
    const whole = posting("workable:treatwell").wholeText!;
    const out = linesOf(boilerplateLast(whole));
    const remote = out.findIndex((l) => l.startsWith("100% remote position"));
    const benefits = out.findIndex((l) => l.trim() === "Benefits");
    expect(remote).toBeGreaterThan(-1);
    expect(benefits).toBeGreaterThan(remote);
    expect(out.slice(benefits).some((l) => l.startsWith("28-days holiday"))).toBe(true);
    expect(out[out.length - 1]).toMatch(/^Treatwell is an ‘Open to All’ employer/);
  });

  it("moves UMG's \"Why Join\" and diversity sections after the text that followed them", () => {
    // c14's cut ends inside UMG's diversity section; get_jobs had put the
    // requirements first, so the posting's other text came after it.
    const rest = "About the role\nYou will support the marketing team with campaign planning and reporting.";
    const out = linesOf(boilerplateLast(`${posting("workday:umusic").cutText}\n${rest}`));
    const why = out.findIndex((l) => /^Why Join UMG UK\?/.test(l));
    const role = out.findIndex((l) => /^You will support the marketing team/.test(l));
    const qual = out.findIndex((l) => /^There are no specific academic requirements/.test(l));
    expect(qual).toBeGreaterThan(-1);
    expect(role).toBeGreaterThan(qual);
    expect(why).toBeGreaterThan(role);
    expect(out[out.length - 2]).toMatch(/^Diversity, Equity, Inclusion & Belonging/);
  });

  it("replaying c14's own cut on Movable Ink's whole posting with a closing sponsorship line: today it is cut off, with boilerplate last it survives", () => {
    const p = posting("greenhouse:movableink");
    // get_jobs puts a requirements heading first, then cuts to its share;
    // this replay is checked against the cut c14 recorded.
    const rotate = asGetJobsOrderedMovableInk;
    const share = p.cutText.length;
    expect(rotate(p.wholeText!).slice(0, share)).toBe(p.cutText);
    const withLine = `${p.wholeText}\n${NOT_ELIGIBLE}`;
    expect(rotate(withLine).slice(0, share)).not.toContain(NOT_ELIGIBLE);
    expect(boilerplateLast(rotate(withLine)).slice(0, share)).toContain(NOT_ELIGIBLE);
  });

  it("leaves a text with nothing to move exactly as it was", () => {
    for (const t of ["", "Requirements:\n· SQL\n· Python", "We are an equal opportunity employer.", "<p>one line of html</p>"]) {
      expect(boilerplateLast(t)).toBe(t);
    }
  });
});

// ── Found in review of the first version (each case a reviewer's probe) ──

describe("work-rights words are read in their own clause, not in the next one", () => {
  it.each([
    "Must have the right to work in the UK and be willing to work shifts, including weekends.",
    "You must be eligible to work in the UK and able to work remotely two days a week.",
    "We are unable to offer sponsorship for this role; conference sponsorship sales experience preferred.",
    "We comply with federal law and participate in E-Verify to confirm that every new hire is authorized to work in the U.S.",
    "Applicants must hold a valid UK passport or a visa that allows them to work in the UK.",
    "You will manage our partnerships with American Express. You must hold a valid visa for Ireland.",
  ])("a work-rights line: %s", (line) => {
    expect(isWorkRightsLine(line)).toBe(true);
  });

  it.each([
    "Employees are eligible to work from home two days a week.",
    "We comply with all applicable laws and regulations on work authorization requirements.",
    "Sponsorship opportunities across EMEA events and conferences.",
  ])("still not one: %s", (line) => {
    expect(isWorkRightsLine(line)).toBe(false);
  });

  it("a hotel posting's right-to-work line after six bullets is kept", () => {
    const text = [
      "Requirements:",
      "· 2+ years of experience in hotel front office operations",
      "· Experience with Opera PMS is required",
      "· Excellent written and spoken English is essential",
      "· A hospitality degree or diploma is preferred",
      "· Minimum of one year in a supervisory role",
      "· Food hygiene certificate level 2 required",
      "Must have the right to work in the UK and be willing to work shifts, including weekends.",
    ].join("\n");
    expect(requirementsExcerptOf(text).postingExcerpt).toContain("Must have the right to work in the UK and be willing to work shifts, including weekends.");
  });
});

describe("citizenship, U.S.-person, immigration and location-only lines are work-rights lines; relocation duties are not", () => {
  it.each([
    "Applicants must be U.S. citizens.",
    "Candidates must have U.S. citizenship.",
    "This position requires U.S. citizenship.",
    "Requires US citizenship due to government contract.",
    "Only U.S. citizens are eligible for this position.",
    "Due to ITAR regulations, applicants must be U.S. Persons.",
    "We do not provide immigration support for this role.",
    "This role is Remote (US only).",
    "Remote - UK only.",
    "Remote in the EU only.",
    "US-based remote role; candidates outside the US will not be considered.",
    "This position is open to candidates residing in Germany only.",
    "This is a remote role open to candidates based in Canada only.",
    "You must already live in the UK.",
  ])("%s", (line) => {
    expect(isWorkRightsLine(line)).toBe(true);
  });

  it.each([
    "Manage the relocation of our data centre to Slough in Q3.",
    "We are relocating our head office to Manchester next year.",
    "Coordinate employee relocation and immigration paperwork for new hires.",
  ])("a duty, not a condition on the applicant: %s", (line) => {
    expect(isWorkRightsLine(line)).toBe(false);
  });

  it.each([
    // NCDOT's real mission line (posting-selection-screen public/308).
    "Our work not only serves the citizens of North Carolina but also the nation.",
    // GE Aerospace's real benefits notice (experience-merge-recheck row 65).
    "GE Aerospace (General Electric Company or the Company) and its affiliates each sponsor certain employee benefit plans or programs (i.e., is a “Sponsor”).",
  ])("a mission or a benefit plan, not a condition on the applicant: %s", (line) => {
    expect(isWorkRightsLine(line)).toBe(false);
  });
});

describe("a work-rights label keeps its value, a list item is a statement, and a heading is never a value", () => {
  it.each([
    ["Visa sponsorship:\nNo", "Visa sponsorship: No"],
    ["Sponsorship:\nNot available", "Sponsorship: Not available"],
    ["Security Clearance:\nSecret", "Security Clearance: Secret"],
    ["Work Authorization:\nUS Citizen", "Work Authorization: US Citizen"],
    ["Visa sponsorship\nNot available for this role", "Visa sponsorship Not available for this role"],
  ])("%j", (text, line) => {
    expect(requirementsExcerptOf(`Requirements:\n· 3+ years of experience in B2B marketing\n${text}`).postingExcerpt).toContain(line);
  });

  it("a benefits bullet that only says \"Visa sponsorship\" is kept, beside its relocation bullet", () => {
    const dash = requirementsExcerptOf("Requirements:\n- 3+ years of experience with Go\nWhat we offer\n- Visa sponsorship\n- Relocation package\n- 25 days holiday").postingExcerpt;
    expect(dash).toContain("- Visa sponsorship");
    expect(dash).toContain("- Relocation package");
    const dot = requirementsExcerptOf("Requirements:\n· 3+ years of SaaS marketing experience required.\nWhat we offer:\n• Visa sponsorship\n• Relocation").postingExcerpt;
    expect(dot).toContain("Visa sponsorship");
    const html = requirementsExcerptOf("<p>Requirements</p><ul><li>3+ years of experience with Go</li></ul><p>Benefits</p><ul><li>Visa sponsorship</li><li>Relocation package</li></ul>").postingExcerpt;
    expect(html).toContain("Visa sponsorship");
  });

  it("a label left blank is dropped, never joined to the heading after it", () => {
    for (const text of ["Sponsorship Available:\nJob Description\nYou will build services.", "Visa Sponsorship Available:\nResponsibilities\nShip features."]) {
      const ex = requirementsExcerptOf(`Requirements:\n· 3+ years of experience in B2B marketing\n${text}`).postingExcerpt;
      expect(ex.join("\n"), text).not.toMatch(/Sponsorship Available/);
    }
  });
});

describe("requirement lines are not taken for how-to-apply lines or headings", () => {
  it("portfolio, references and licence lines are requirements", () => {
    const ex = requirementsExcerptOf([
      "Requirements:",
      "- A strong portfolio showcasing UX work is required.",
      "- 3+ years of experience in product design",
      "- Two professional references are required.",
      "- Must have a valid driving licence and two references.",
    ].join("\n")).postingExcerpt;
    for (const words of ["strong portfolio", "Two professional references", "valid driving licence"]) expect(keeps(ex, words), words).toBe(true);
  });

  it("\"Qualifications: <a requirement>\" is a requirement line, not only a heading", () => {
    const ex = requirementsExcerptOf("Qualifications: Bachelor's degree in nursing required.\nAbout us\nWe run clinics across the region.").postingExcerpt;
    expect(ex).toEqual(["Qualifications: Bachelor's degree in nursing required."]);
  });

  it("two headings joined (\"Qualifications / Requirements\") are still a heading, and a bare \"Requirements\" is never glued to the line under it", () => {
    // GE Vernova's and a cleared-role posting's real shapes (posting-selection-screen public/28 and 303).
    const ge = requirementsExcerptOf("Qualifications / Requirements\nAssociate's degree in electrical technology or mechatronics\nThree years of maintenance experience in a manufacturing plant").postingExcerpt;
    expect(ge).toEqual(["Associate's degree in electrical technology or mechatronics", "Three years of maintenance experience in a manufacturing plant"]);
    const cleared = requirementsExcerptOf("Requirements\nRequired Clearance: TS/SCI with Poly\nCandidate must have 10 years of experience in network engineering.").postingExcerpt;
    expect(cleared[0]).toBe("Required Clearance: TS/SCI with Poly");
    expect(requirementsExcerptOf("Requirements - Must have 5 years of Python experience\nAbout us\nWe are a software firm.").postingExcerpt).toEqual(["Requirements - Must have 5 years of Python experience"]);
  });
});

describe("a cut never splits a character", () => {
  it("a 240-character cut steps back from the middle of an emoji", () => {
    const line = `· ${"a".repeat(237)} 😀 required experience with dashboards and reporting tools.`;
    // The emoji's first half is the 239th character, where a cut to 239 plus "…" falls.
    expect(line.slice(2).charCodeAt(238)).toBe(0xd83d);
    const [got] = requirementsExcerptOf(`Requirements:\n${line}`).postingExcerpt;
    expect(got.length).toBeLessThanOrEqual(240);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(got)).toBe(false);
  });
});

describe("boilerplateLast never moves a requirement or a pay line", () => {
  const moved = (text: string) => {
    const lines = linesOf(text);
    const out = linesOf(boilerplateLast(text));
    const once = lines.filter((l) => l.trim() && lines.indexOf(l) === lines.lastIndexOf(l));
    return once.filter((l) => out.indexOf(l) > lines.indexOf(l));
  };
  const PAY = /[$€£]\s?\d|\b(?:salary|pay) range\b/i;
  const MUST = /\bmust (?:have|hold|possess)\b|\b(?<!as )required\b(?! by)|\brequirements?\b|\byears? of (?:\w+ )?experience\b|\bdegree\b|\blicen[cs]e[ds]?\b|\bcertifi(?:ed|cations?)\b|\bexperience (?:with|in)\b/i;

  it("requirements under a benefits heading stay where they are, before the next section", () => {
    const out = linesOf(boilerplateLast("Benefits\nHealth insurance\nYour Skills\n3+ years of experience required\nA bachelor's degree is required\nResponsibilities\nShip features."));
    expect(out.indexOf("3+ years of experience required")).toBeLessThan(out.indexOf("Responsibilities"));
    expect(out.indexOf("A bachelor's degree is required")).toBeLessThan(out.indexOf("Responsibilities"));
    expect(out.indexOf("Your Skills")).toBeLessThan(out.indexOf("3+ years of experience required"));
  });

  it("a stated salary range is never moved, under a benefits heading or in a pay-transparency sentence", () => {
    for (const text of [
      "Compensation & Benefits\nThe base salary range for this role is $120,000 - $150,000 per year.\nHealth insurance and a 401(k) match.\nAbout the role\nYou will lead the analytics team.",
      "In accordance with pay transparency laws, the base salary range for this role is $100,000 - $130,000.\nAbout the role\nYou will lead the analytics team.",
    ]) {
      expect(moved(text).filter((l) => PAY.test(l)), text).toEqual([]);
    }
  });

  it("Adyen's and Liquid Personnel's pay lines keep their place", () => {
    for (const [idx, words] of [[141, "The annual base salary range for this role is $125,000-175,000"], [159, "€44,000 - €55,000"]] as Array<[number, string]>) {
      const t = row(idx).description;
      expect(t.includes(words), `#${idx}`).toBe(true);
      expect(moved(t).filter((l) => l.includes(words)), `#${idx}`).toEqual([]);
    }
  });

  it("Airbus's \"What's In It For You\" section ends at \"Job Summary\": the job and its requirements stay ahead of the privacy text", () => {
    const t = row(10).description;
    const out = boilerplateLast(t);
    const consent = "By submitting your CV or application you are consenting";
    expect(out.indexOf(consent)).toBeGreaterThanOrEqual(t.indexOf(consent));
    for (const kept of ["Job Summary", "HOW YOU WILL CONTRIBUTE TO THE TEAM", "Be educated to degree level"]) {
      expect(out.indexOf(kept), kept).toBeLessThanOrEqual(t.indexOf(kept));
    }
    expect(out.indexOf("Financial Reward")).toBeGreaterThan(t.indexOf("Financial Reward"));
  });

  it("on every real text, no moved line states pay or a requirement, and a job's own sections are never moved", () => {
    const texts: Array<[string, string]> = [
      ...POSTINGS.flatMap((p) => [[p.id, p.cutText], [`${p.id} whole`, p.wholeText ?? ""]] as Array<[string, string]>),
      ...ROWS.map((r) => [`split#${r.idx}`, r.description] as [string, string]),
      ...(BOILER as { rows: Array<{ id: string; description: string }> }).rows.map((r) => [r.id, r.description] as [string, string]),
      ...(LANG as { cases: Array<{ id: string; truth: string; text: string }> }).cases.filter((c) => c.truth === "en").map((c) => [c.id, c.text] as [string, string]),
    ].filter(([, t]) => t);
    let movedLines = 0;
    const overHalf: string[] = [];
    for (const [id, t] of texts) {
      const m = moved(t);
      movedLines += m.length;
      for (const l of m) {
        expect(PAY.test(l), `${id}: ${l}`).toBe(false);
        expect(MUST.test(l), `${id}: ${l}`).toBe(false);
      }
      if (m.join("\n").length > t.length / 2) overHalf.push(id);
    }
    console.log(`[L4] boilerplateLast on ${texts.length} real texts: ${movedLines} lines moved, ${overHalf.length} texts with more than half their characters moved`);
    expect(movedLines).toBeGreaterThan(50);
    // In review, ten texts had more than half moved, among them Airbus (89%,
    // its whole job body), Salesforce's "Day to Day" duties and two Johnson
    // Controls postings. The five left are short postings whose moved text is
    // only a company or equal-opportunity paragraph, or a "Why join" pitch:
    // their duties and requirements stay first.
    expect(overHalf.sort()).toEqual([
      "site:/jobs/posting/greenhouse/tipaltisolutions/6234229004",
      "smartrecruiters:BoschGroup:pt:744000161294895",
      "smartrecruiters:BoschGroup:pt:744000161331490",
      "smartrecruiters:BoschGroup:pt:744000161544969",
      "smartrecruiters:JYSK:it:744000160799260",
    ]);
  });
});

describe("a long tag is still a tag, and a stray \"<\" is still text", () => {
  const b64 = `iVBORw0KGgo${"A".repeat(3000)}`;
  it.each([
    [
      "an inline base64 image in a list item",
      `<p>Requirements</p><ul><li>5+ years of nursing experience</li><li><img src="data:image/png;base64,${b64}" alt="badge"> Must hold an active RN licence</li><li>Must be authorized to work in the United States without sponsorship.</li></ul>`,
      ["5+ years of nursing experience", "Must hold an active RN licence", "Must be authorized to work in the United States without sponsorship."],
    ],
    [
      "a Word style attribute",
      `<h2>Requirements</h2><p style="${"margin:0in;font-size:11pt;font-family:Calibri,sans-serif;mso-fareast-font-family:Calibri;".repeat(14)}">Bachelor's degree required.</p><p>Visa sponsorship is not available for this role.</p>`,
      ["Bachelor's degree required.", "Visa sponsorship is not available for this role."],
    ],
    [
      "a SafeLinks link",
      `<h3>Qualifications</h3><ul><li>Must have a CDL licence, see <a href="https://nam12.safelinks.protection.outlook.com/?url=${"x".repeat(1100)}">policy</a></li><li>Security clearance required.</li></ul>`,
      ["Must have a CDL licence, see policy", "Security clearance required."],
    ],
    [
      "an inline SVG path",
      `<div><h2>What you'll bring</h2><ul><li><svg viewBox="0 0 24 24"><path d="${"M12 2 L 3 7 ".repeat(120)}"></path></svg> 3+ years of experience with Python required</li></ul></div>`,
      ["3+ years of experience with Python required"],
    ],
  ])("%s: the requirement beside it is picked, and no markup is", (_name, html, lines) => {
    const got = requirementsExcerptOf(html).postingExcerpt;
    expect(got).toEqual(lines);
    expect(got.join("\n")).not.toMatch(/[<>]|base64|safelinks|mso-/);
  });

  it("a \"<\" in a line's own words, with another tag before any \">\", is text and keeps the lines after it", () => {
    const filler = "and the ability to work closely with the warehouse team on every shift, ".repeat(16);
    const got = requirementsExcerptOf(
      `<h2>Requirements</h2><ul><li>Must be able to lift loads of < 50 lb ${filler}</li><li>Must hold a valid forklift licence</li><li>Must be authorized to work in the United States without sponsorship.</li></ul>`,
    ).postingExcerpt;
    expect(got[0]).toMatch(/^Must be able to lift loads of < 50 lb and the ability/);
    expect(got.slice(1)).toEqual(["Must hold a valid forklift licence", "Must be authorized to work in the United States without sponsorship."]);
  });
});

/** Where the (n+1)th copy of `line` sits in `lines`. */
function nthIndex(lines: string[], line: string, n: number): number {
  let at = -1;
  for (let k = 0; k <= n; k++) at = lines.indexOf(line, at + 1);
  return at;
}
