// @vitest-environment node
/**
 * A PASTED EMPLOYER LINK NAMES THE BOARD'S OWN ID (MCP upgrade 3, W1 lane L3:
 * U3-04 as revised by F13).
 *
 * WHAT WAS WRONG. Live 2026-11-16 (probe c27), get_job refused
 * movableink.com/job-listing?gh_jid=8320434 as "not a job id from this board",
 * though that link is the very applyUrl the board serves for
 * greenhouse:movableink:8320434 (c15 read that posting's form). No Workday
 * link was read at all, and Workday carries about half the board's postings.
 * The refusal named only resumebooster.work links, never that Greenhouse,
 * Lever and Ashby links already worked (c30).
 *
 * WHAT IS NOW TRUE. agent-mcp/job-link.ts has parseJobLink, a pure reader L5
 * wires in: it answers every link parseJobId already reads with that same id
 * (nothing it reads today changes), and adds two candidates, each read once
 * and believed only when the board proves it:
 *   - a Workday link, on myworkdayjobs.com or myworkdaysite.com, with or
 *     without a locale, on /job/ or /details/, with /apply or a query after
 *     it, names workday:<tenant>~<dc>~<site>:<req> exactly as normalizeWorkday
 *     forms it (tenant and data centre lowercased). It is behind an exported
 *     switch, on only while the recorded live sample of 300+ Workday cards
 *     round-trips at 98% or more (F13); off, the link is answered in words
 *     with a search, and the refusal never lists Workday;
 *   - an employer's own page carrying gh_jid=N names
 *     greenhouse:<domain label>:N, held only when the card's own applyUrl
 *     names posting N;
 *   - a miss on either is a search by employer and title, never a bare
 *     notFound.
 * Every other vendor stays unmapped: a link from one gives words, never a
 * guessed id. The round trip runs the board's own normalizers on saved vendor
 * payloads, and replays the live sample scripts/measure-job-link-roundtrip.mjs
 * recorded.
 *
 * STATE. The script's one live run (2026-11-17) read 240 cards across 62
 * tenants, not 300: the board serves a public caller 60 rows a call, and the
 * run stepped its offset by the 200 it asked for. All 240 read back to their
 * own ids in every form, but 240 is under the floor, so the switch is off; a
 * run of the corrected script that records 300 or more at 98% may turn it on.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  jobLinkHeld,
  linkKindsThatWork,
  parseJobId,
  parseJobLink,
  WORKDAY_LINKS_READ,
} from "../../supabase/functions/agent-mcp/job-link";
import {
  normalizeAshby,
  normalizeBambooHR,
  normalizeGreenhouse,
  normalizeLever,
  normalizeSmartRecruiters,
  normalizeWorkable,
  normalizeWorkday,
} from "../../supabase/functions/job-board/normalize";
import { roundTrip, workdayVariants } from "../../scripts/measure-job-link-roundtrip.mjs";

const fixture = (name: string) => JSON.parse(readFileSync(resolve(__dirname, "fixtures", name), "utf8"));
const idOf = (sent: string, o?: { workday?: boolean }) => {
  const r = parseJobLink(sent, o);
  return r.kind === "words" ? null : r.id;
};

describe("every link the reader took before is read as the same id", () => {
  // The cases a-pasted-link-is-the-job-not-a-closed-job pins for parseJobId.
  it.each([
    "workday:iko~wd3~Roofmart_Careers:REQ-13889",
    "  greenhouse:acme:12345  ",
    `https://resumebooster.work/jobs?job=${encodeURIComponent("workday:iko~wd3~Roofmart_Careers:REQ-13889")}`,
    "https://www.resumebooster.work/jobs?q=nurse&job=greenhouse%3Aacme%3A12345",
    `https://resumebooster.work/jobs/posting/workday/${encodeURIComponent("iko~wd3~Roofmart_Careers")}/REQ-13889`,
    "https://resumebooster.work/jobs/posting/greenhouse%3Aacme%3A12345",
    "https://job-boards.greenhouse.io/anthropic/jobs/5468901008",
    "https://boards.greenhouse.io/embed/job_app?for=acme&token=12345",
    "https://job-boards.eu.greenhouse.io/imc/jobs/4960533101",
    "https://jobs.lever.co/acme/2f0c6c4e-9a8b-4c1d-8e2f-0a1b2c3d4e5f/apply",
    "https://jobs.eu.lever.co/mobileye/28d00939-d06e-4f6d-84aa-4f155fe88b62",
    "https://jobs.ashbyhq.com/clera/f062a52d-8407-4b0b-9ab2-995252bc4b6c",
  ])("%s", (sent) => {
    const id = parseJobId(sent);
    expect(id).not.toBeNull();
    expect(parseJobLink(sent)).toEqual({ kind: "id", id });
    expect(parseJobLink(sent, { workday: false })).toEqual({ kind: "id", id });
  });

  it("an employer link typed without https:// is read as the link it is", () => {
    expect(parseJobLink("jobs.lever.co/acme/2f0c6c4e-9a8b-4c1d-8e2f-0a1b2c3d4e5f")).toEqual({ kind: "id", id: "lever:acme:2f0c6c4e-9a8b-4c1d-8e2f-0a1b2c3d4e5f" });
  });
});

describe("the board's own normalizers, fed saved vendor payloads, name ids the reader names back", () => {
  it("Lever (palantir, saved 2026-10-01): the posting page and its /apply page", () => {
    const raw = fixture("oversize-lever-palantir-2026-10-01.json");
    const cards = normalizeLever(raw, "Palantir", "palantir");
    expect(cards.length).toBe(raw.length);
    for (const [i, c] of cards.entries()) {
      expect(parseJobLink(c.applyUrl)).toEqual({ kind: "id", id: c.id });
      expect(parseJobLink(raw[i].applyUrl)).toEqual({ kind: "id", id: c.id });
    }
  });

  it("Ashby (openai, saved 2026-10-01): the posting page and its /application page", () => {
    const raw = fixture("oversize-ashby-openai-2026-10-01.json");
    const cards = normalizeAshby(raw, "OpenAI", "openai");
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) {
      expect(parseJobLink(c.applyUrl)).toEqual({ kind: "id", id: c.id });
      expect(parseJobLink(`${c.applyUrl}/application`)).toEqual({ kind: "id", id: c.id });
    }
  });

  it("Greenhouse (sonobello, read live 2026-11-16)", () => {
    const [c] = normalizeGreenhouse({ jobs: [fixture("greenhouse-sonobello-5474869008.json")] }, "Sono Bello", "sonobello");
    expect(c.id).toBe("greenhouse:sonobello:5474869008");
    expect(parseJobLink(c.applyUrl)).toEqual({ kind: "id", id: c.id });
  });

  it("Greenhouse on the employer's own domain (c27): a candidate the card's own applyUrl proves", () => {
    const [c] = normalizeGreenhouse(
      { jobs: [{ id: 8320434, title: "Marketing Manager", absolute_url: "https://movableink.com/job-listing?gh_jid=8320434" }] },
      "Movable Ink",
      "movableink",
    );
    expect(c.id).toBe("greenhouse:movableink:8320434");
    const r = parseJobLink(c.applyUrl);
    expect(r).toMatchObject({ kind: "candidate", vendor: "greenhouse", id: c.id, proof: { param: "gh_jid", value: "8320434" } });
    expect(jobLinkHeld(r, c)).toBe(true);
    // The same id with an applyUrl that names no posting N proves nothing.
    expect(jobLinkHeld(r, { ...c, applyUrl: "https://movableink.com/careers" })).toBe(false);
    expect(jobLinkHeld(r, { ...c, applyUrl: "https://movableink.com/job-listing?gh_jid=8320435" })).toBe(false);
    // A card the board serves on Greenhouse's own page for posting N names it too.
    expect(jobLinkHeld(r, { ...c, applyUrl: "https://job-boards.greenhouse.io/movableink/jobs/8320434" })).toBe(true);
    // Another posting, or no card, is not a hit.
    expect(jobLinkHeld(r, { id: "greenhouse:movableink:1", applyUrl: c.applyUrl })).toBe(false);
    expect(jobLinkHeld(r, null)).toBe(false);
  });

  it("a gh_jid page under a careers subdomain or a two-part suffix guesses the domain's own label", () => {
    expect(idOf("https://careers.stripe.com/listing?gh_jid=123")).toBe("greenhouse:stripe:123");
    expect(idOf("https://www.example.co.uk/jobs/?gh_jid=77&utm_source=x")).toBe("greenhouse:example:77");
    expect(idOf("https://example.com/jobs?gh_jid=abc")).toBeNull();
  });

  it("a candidate the board does not hold is answered with a search, never a bare notFound", () => {
    const r = parseJobLink("https://movableink.com/job-listing?gh_jid=8320434");
    if (r.kind !== "candidate") throw new Error("expected a candidate");
    expect(r.ifNotHeld.note).toMatch(/Greenhouse posting 8320434/);
    expect(r.ifNotHeld.note).toMatch(/search by employer and title/i);
    expect(r.ifNotHeld.suggestedSearch).toEqual({ companies: ["movableink"] });
  });

  it("Workday: each normalizeWorkday id, built from recorded live paths, is the id its applyUrl names", () => {
    // externalPath shapes from the 2026-11-16 probe's live cards (c17, c22, c34):
    // a "---" title, an "R26_1002" requisition whose id keeps only "1002", an
    // "R_00049949" requisition, a three-digit data centre, and a site with "_".
    const boards: Array<[string, string]> = [
      ["etsy~wd5~Depop_Careers", "/job/London-UK/Staff-Data-Engineer---Data-Quality---Governance_JR5215"],
      ["crossoverhealth~wd1~Careers", "/job/Austin-Texas/Chiropractor---4-days_R26_1002"],
      ["utaustin~wd1~UTstaff", "/job/AUSTIN-TX/Pediatric-Neurology-Advanced-Practice-Provider_R_00049949"],
      ["accenture~wd103~AccentureCareers", "/job/Shanghai/Data-Engineer-Senior-Data-Engineer_14718368"],
      ["humana~wd5~CenterWell_External_Career_Site", "/job/Austin-TX/Home-Health-Account-Executive_R-436842"],
    ];
    const want = [
      "workday:etsy~wd5~Depop_Careers:JR5215",
      "workday:crossoverhealth~wd1~Careers:1002",
      "workday:utaustin~wd1~UTstaff:00049949",
      "workday:accenture~wd103~AccentureCareers:14718368",
      "workday:humana~wd5~CenterWell_External_Career_Site:R-436842",
    ];
    boards.forEach(([token, externalPath], i) => {
      const [c] = normalizeWorkday([{ title: "A role", externalPath, locationsText: "Somewhere" }], "Employer", token);
      expect(c.id).toBe(want[i]);
      const r = parseJobLink(c.applyUrl, { workday: true });
      expect(r).toMatchObject({ kind: "candidate", vendor: "workday", id: c.id });
      expect(jobLinkHeld(r, c)).toBe(true);
      for (const v of workdayVariants(c.applyUrl)) expect(idOf(v.url, { workday: true }), `${v.name}: ${v.url}`).toBe(c.id);
    });
  });

  it("Workday: the case, locale, /details/, myworkdaysite, /apply and query forms a person pastes", () => {
    const id = "workday:etsy~wd5~Depop_Careers:JR5215";
    for (const url of [
      "https://etsy.wd5.myworkdayjobs.com/en-US/Depop_Careers/job/London-UK/Staff-Data-Engineer---Data-Quality---Governance_JR5215",
      "https://ETSY.WD5.myworkdayjobs.com/en-US/Depop_Careers/job/London-UK/Staff-Data-Engineer---Data-Quality---Governance_JR5215",
      "https://etsy.wd5.myworkdayjobs.com/Depop_Careers/job/London-UK/Staff-Data-Engineer---Data-Quality---Governance_JR5215",
      "https://etsy.wd5.myworkdayjobs.com/fr-FR/Depop_Careers/job/London-UK/Staff-Data-Engineer---Data-Quality---Governance_JR5215",
      "https://etsy.wd5.myworkdayjobs.com/en-US/Depop_Careers/details/Staff-Data-Engineer---Data-Quality---Governance_JR5215?q=data",
      "https://etsy.wd5.myworkdayjobs.com/en-US/Depop_Careers/job/London-UK/Staff-Data-Engineer---Data-Quality---Governance_JR5215/apply/applyManually",
      "https://etsy.wd5.myworkdayjobs.com/Depop_Careers/job/London-UK/Staff-Data-Engineer---Data-Quality---Governance_JR5215?source=LinkedIn",
      "https://wd5.myworkdaysite.com/recruiting/etsy/Depop_Careers/job/London-UK/Staff-Data-Engineer---Data-Quality---Governance_JR5215",
      "https://wd5.myworkdaysite.com/en-US/recruiting/Etsy/Depop_Careers/details/Staff-Data-Engineer---Data-Quality---Governance_JR5215",
      "etsy.wd5.myworkdayjobs.com/en-US/Depop_Careers/job/London-UK/Staff-Data-Engineer---Data-Quality---Governance_JR5215",
    ]) expect(idOf(url, { workday: true }), url).toBe(id);
  });

  it("Workday: a link that names a careers site and no posting is not a guessed id", () => {
    for (const url of [
      "https://etsy.wd5.myworkdayjobs.com/en-US/Depop_Careers",
      "https://etsy.wd5.myworkdayjobs.com/Depop_Careers/jobs?q=engineer",
      "https://wd5.myworkdaysite.com/recruiting/etsy/Depop_Careers",
      "https://www.myworkdayjobs.com/Depop_Careers/job/X/Title_R1",
    ]) expect(idOf(url, { workday: true }), url).toBeNull();
  });

  it("Workday: a miss, or the switch off, is a search for that title on that careers site, said to be a search", () => {
    const url = "https://etsy.wd5.myworkdayjobs.com/en-US/Depop_Careers/job/London-UK/Staff-Data-Engineer---Data-Quality---Governance_JR5215";
    const on = parseJobLink(url, { workday: true });
    if (on.kind !== "candidate") throw new Error("expected a candidate");
    const search = { query: "Staff Data Engineer Data Quality Governance", companies: ["etsy~wd5~Depop_Careers"] };
    expect(on.ifNotHeld.suggestedSearch).toEqual(search);
    expect(on.ifNotHeld.note).toMatch(/search by employer and title/i);
    expect(on.ifNotHeld.note).toMatch(/not this posting/);
    expect(jobLinkHeld(on, null)).toBe(false);
    const off = parseJobLink(url, { workday: false });
    expect(off).toMatchObject({ kind: "words", site: "workday", suggestedSearch: search });
    if (off.kind !== "words") throw new Error("expected words");
    expect(off.note).toMatch(/not this posting/);
    expect(off.note).not.toMatch(/workday:/i);
  });

  it("vendors with no live round trip are never mapped: their links are words, never a guessed id", () => {
    const sr = normalizeSmartRecruiters({ content: [{ id: "744000012345678", name: "Registered Nurse" }] }, "Acme", "acme");
    const wk = normalizeWorkable({ jobs: [{ title: "Registered Nurse", shortcode: "ABC123DEF" }] }, "Acme", "acme");
    const bb = normalizeBambooHR({ result: [{ id: 42, jobOpeningName: "Registered Nurse" }] }, "Acme", "acme");
    for (const c of [...sr, ...wk, ...bb]) {
      expect(c.applyUrl).toMatch(/^https:\/\//);
      expect(parseJobLink(c.applyUrl, { workday: true }), c.applyUrl).toMatchObject({ kind: "words", site: "other" });
    }
  });
});

describe("what the reader says when a link names no posting", () => {
  it("the refusal lists the kinds of link that work, and Workday only while the switch is on", () => {
    expect(linkKindsThatWork(false)).toMatch(/Greenhouse, Lever or Ashby/);
    expect(linkKindsThatWork(false)).toMatch(/gh_jid/);
    expect(linkKindsThatWork(false)).toMatch(/resumebooster\.work/);
    expect(linkKindsThatWork(false)).not.toMatch(/Workday/);
    expect(linkKindsThatWork(true)).toMatch(/Workday/);
    expect(linkKindsThatWork()).toBe(linkKindsThatWork(WORKDAY_LINKS_READ));
    for (const sent of ["software engineer", "https://example.com/jobs/123", "https://resumebooster.work/jobs"]) {
      const r = parseJobLink(sent);
      expect(r.kind, sent).toBe("words");
      if (r.kind === "words") expect(r.note).toContain(linkKindsThatWork());
    }
  });

  it("the default reads Workday links only when the switch says so", () => {
    const url = "https://etsy.wd5.myworkdayjobs.com/en-US/Depop_Careers/job/London-UK/Staff-Data-Engineer---Data-Quality---Governance_JR5215";
    expect(parseJobLink(url).kind).toBe(WORKDAY_LINKS_READ ? "candidate" : "words");
  });
});

describe("the live sample scripts/measure-job-link-roundtrip.mjs recorded", () => {
  // The newest recording: a later run writes workday-link-roundtrip-<date>.json beside it.
  const recorded = () => {
    const name = readdirSync(resolve(__dirname, "fixtures")).filter((f) => /^workday-link-roundtrip-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().at(-1);
    if (!name) throw new Error("no recorded Workday sample in src/test/fixtures");
    return fixture(name) as { cards: Array<{ id: string; applyUrl: string }> };
  };

  it("is live Workday cards, each a board id and the applyUrl the board served for it", () => {
    const live = recorded();
    expect(live.cards.length).toBeGreaterThan(0);
    expect(new Set(live.cards.map((c) => c.id)).size).toBe(live.cards.length);
    for (const c of live.cards) {
      expect(c.id.startsWith("workday:")).toBe(true);
      expect(c.applyUrl).toMatch(/^https:\/\/[^/]+\.myworkdayjobs\.com\//);
    }
  });

  it("the switch is on exactly when 300 or more recorded cards round-trip at 98% or more in every form (F13)", () => {
    const live = recorded();
    const out = roundTrip(live.cards, (u: string) => idOf(u, { workday: true }));
    const rates = Object.entries(out.rates as Record<string, number>);
    const lowest = Math.min(...rates.map(([, v]) => v));
    console.log(`job-link round trip on ${live.cards.length} recorded cards: ${rates.map(([k, v]) => `${k} ${(v * 100).toFixed(2)}%`).join(", ")}`);
    expect(WORKDAY_LINKS_READ).toBe(live.cards.length >= 300 && lowest >= 0.98);
  });
});
