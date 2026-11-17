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
 *     paragraph with work-rights words, and deletes nothing. Replaying c14's
 *     own cut on Movable Ink's whole posting with a sponsorship line at its
 *     end: today the line is cut off, with boilerplate last it survives.
 *   - postingExcerptOf, which apply_myself serves today, is unchanged.
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

/** Where the (n+1)th copy of `line` sits in `lines`. */
function nthIndex(lines: string[], line: string, n: number): number {
  let at = -1;
  for (let k = 0; k <= n; k++) at = lines.indexOf(line, at + 1);
  return at;
}
