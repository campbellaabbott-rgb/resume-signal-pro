/**
 * EACH NEW FORM READER READS ITS RECORDED FORM (connect W5, APPLY-1107-01).
 *
 * The AI read the employer's real form on about 11.5% of the postings it can
 * serve. Five more hiring systems publish theirs on a public GET, and now
 * each is read (owner decision 2026-11-07: on Claude, Claude Code, keys and
 * /v1; ChatGPT stays Greenhouse and Recruitee):
 *   - Paylocity: recruiting.paylocity.com/Recruiting/Jobs/Apply/{id}, the
 *     page's window.pageData sections and screener;
 *   - Workable: apply.workable.com/api/v1/jobs/{shortcode}/form;
 *   - Teamtailor: {token}.teamtailor.com/jobs/{id}/applications/new;
 *   - Lever: jobs.lever.co/{token}/{id}/apply, the cards' baseTemplate;
 *   - BambooHR: {token}.bamboohr.com/careers/{id}/detail, formFields plus
 *     customQuestions.
 * Every fetch is a GET pinned to the vendor's own host, with redirects
 * refused (one Teamtailor hop to the tenant's own career domain excepted),
 * and nothing is ever submitted. A closed posting reads as no form, never
 * as an empty one.
 *
 * Recorded 2026-11-08 from live postings (trimmed to the form; each trimmed
 * copy was checked to read exactly as the full page did).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FORM_READER_VENDORS, PUBLIC_API_FORM_VENDORS, readApplicationForm, type FormRead, type PostingRef } from "../../supabase/functions/_shared/application-form";
import { whoAnswersEach } from "../../supabase/functions/_shared/self-apply";

const fixture = (f: string) => readFileSync(resolve(__dirname, "fixtures/forms", f), "utf8");
type Served = { status?: number; body?: string; location?: string };
const serving = (map: Record<string, Served>) => {
  const urls: string[] = [];
  const inits: Array<RequestInit | undefined> = [];
  const f = (async (u: string, init?: RequestInit) => {
    urls.push(String(u));
    inits.push(init);
    const s = map[String(u)];
    if (!s) return new Response("", { status: 404 });
    return new Response(s.body ?? "", { status: s.status ?? 200, headers: s.location ? { location: s.location } : {} });
  }) as typeof fetch;
  return { f, urls, inits };
};
const read = async (ref: PostingRef, map: Record<string, Served>) => {
  const s = serving(map);
  const r = await readApplicationForm(ref, { fetch: s.f, now: () => Date.parse("2026-11-08T12:00:00Z") });
  return { r, ...s };
};
const form = (r: FormRead) => {
  if (r.kind !== "read") throw new Error(`expected a read form, got ${r.kind}`);
  return r.form;
};

const WK = { id: "workable:acdisaster:C6A04F38AA", source: "workable", token: "acdisaster", applyUrl: "https://apply.workable.com/j/C6A04F38AA" };
const WK_URL = "https://apply.workable.com/api/v1/jobs/C6A04F38AA/form";
const LV = { id: "lever:cfsenergy:c7cedda0-0650-4d31-8f36-a279ef6cba12", source: "lever", token: "cfsenergy", applyUrl: "https://jobs.lever.co/cfsenergy/c7cedda0-0650-4d31-8f36-a279ef6cba12" };
const LV_URL = "https://jobs.lever.co/cfsenergy/c7cedda0-0650-4d31-8f36-a279ef6cba12/apply";
const BH = { id: "bamboohr:alstonco:1410", source: "bamboohr", token: "alstonco", applyUrl: "https://alstonco.bamboohr.com/careers/1410" };
const BH_URL = "https://alstonco.bamboohr.com/careers/1410/detail";
const PL = { id: "paylocity:c3b88991-c035-4553-a749-c4ed739f2faa:4344747", source: "paylocity", token: "c3b88991-c035-4553-a749-c4ed739f2faa", applyUrl: "https://recruiting.paylocity.com/recruiting/jobs/Details/4344747" };
const PL_URL = "https://recruiting.paylocity.com/Recruiting/Jobs/Apply/4344747";
const TT = { id: "teamtailor:providentmexico:8685261", source: "teamtailor", token: "providentmexico", applyUrl: "https://providentmexico.teamtailor.com/jobs/8685261-supervisor-de-credito" };
const TT_URL = "https://providentmexico.teamtailor.com/jobs/8685261/applications/new";

describe("which surfaces read the five", () => {
  it("every reader surface carries them; ChatGPT stays Greenhouse and Recruitee", () => {
    for (const v of ["paylocity", "workable", "teamtailor", "lever", "bamboohr"]) expect(FORM_READER_VENDORS).toContain(v);
    expect([...PUBLIC_API_FORM_VENDORS].sort()).toEqual(["greenhouse", "recruitee"]);
  });

  it("inside ChatGPT a Lever form is withheld without a fetch", async () => {
    const s = serving({ [LV_URL]: { body: fixture("lever-cfsenergy-c7cedda0.html") } });
    const r = await readApplicationForm(LV, { fetch: s.f, vendors: PUBLIC_API_FORM_VENDORS });
    expect(r).toEqual({ kind: "withheld", vendor: "lever" });
    expect(s.urls).toEqual([]);
  });
});

describe("Workable", () => {
  it("reads 31 questions, the CV and the two sections the form adds", async () => {
    const { r, urls } = await read(WK, { [WK_URL]: { body: fixture("workable-acdisaster-C6A04F38AA.json") } });
    const f = form(r);
    expect(f.questions).toHaveLength(31);
    expect(f.documents).toEqual([{ name: "Resume", required: true }]);
    expect(f.alsoOnForm.join(" | ")).toMatch(/^Education \(optional\).*\| Experience \(optional\)/);
    const sponsor = f.questions.find((q) => /require sponsorship/.test(q.label))!;
    expect(sponsor).toMatchObject({ required: true, options: ["Yes", "No"] });
    expect(urls).toEqual([WK_URL]);
  });
});

describe("Lever", () => {
  it("reads its four cards as six questions, the required CV, a cover letter and the EEO block", async () => {
    const { r, urls } = await read(LV, { [LV_URL]: { body: fixture("lever-cfsenergy-c7cedda0.html") } });
    const f = form(r);
    expect(f.questions).toHaveLength(6);
    expect(f.questions.filter((q) => q.required)).toHaveLength(4);
    expect(f.questions.some((q) => /Export Co/.test(q.label))).toBe(true);
    expect(f.documents).toEqual([{ name: "Resume / CV", required: true }, { name: "Please Upload a Cover Letter", required: false }]);
    expect(f.alsoOnForm).toEqual(["Voluntary self-identification (EEO) questions"]);
    expect(urls).toEqual([LV_URL]);
  });

  it("an EU tenant is read from jobs.eu.lever.co, as its own link says", async () => {
    const eu = { ...LV, applyUrl: "https://jobs.eu.lever.co/cfsenergy/c7cedda0-0650-4d31-8f36-a279ef6cba12" };
    const { urls } = await read(eu, {});
    expect(urls).toEqual(["https://jobs.eu.lever.co/cfsenergy/c7cedda0-0650-4d31-8f36-a279ef6cba12/apply"]);
  });
});

describe("BambooHR", () => {
  it("reads the standard fields and the employer's own questions, sponsorship among them", async () => {
    const { r, urls } = await read(BH, { [BH_URL]: { body: fixture("bamboohr-alstonco-1410.json") } });
    const f = form(r);
    expect(f.questions.length).toBe(30);
    expect(f.documents).toEqual([{ name: "Resume / CV", required: true }]);
    const marked = whoAnswersEach(f.questions);
    const sponsor = marked.find((q) => /require sponsorship/.test(q.label))!;
    expect(sponsor).toMatchObject({ answeredBy: "you", options: ["Yes", "No"], required: true });
    expect(urls).toEqual([BH_URL]);
  });
});

describe("Paylocity", () => {
  it("reads the application's sections and its screener, and marks the screens", async () => {
    const { r, urls } = await read(PL, { [PL_URL]: { body: fixture("paylocity-4344747.html") } });
    const f = form(r);
    expect(f.questions.length).toBe(26);
    expect(f.questions.filter((q) => q.screens).map((q) => q.label.slice(0, 30))).toEqual([
      "Are you 21 years or older ?", "This position is on-site in Na", "Are you Legally authorized to ",
    ]);
    expect(f.documents.map((d) => d.name)).toEqual(["Resume / CV", "Cover letter", "Additional files"]);
    expect(f.alsoOnForm.some((x) => /^Work History: /.test(x))).toBe(true);
    expect(urls).toEqual([PL_URL]);
  });

  it("a closed posting (a redirect to JobNotFound) is no form, never an empty one, and the redirect is not followed", async () => {
    const { r, urls, inits } = await read(PL, { [PL_URL]: { status: 302, location: "/Recruiting/Jobs/JobNotFound" } });
    expect(r.kind).toBe("absent");
    expect(urls).toEqual([PL_URL]);
    expect(inits[0]?.redirect).toBe("manual");
  });
});

describe("Teamtailor", () => {
  it("reads five screening answers, the locations, the motivation letter and the CV", async () => {
    const { r, urls } = await read(TT, { [TT_URL]: { body: fixture("teamtailor-providentmexico-8685261.html") } });
    const f = form(r);
    expect(f.questions.map((q) => q.type)).toEqual(["text", "radio", "boolean", "boolean", "boolean", "checkbox", "textarea"]);
    expect(f.documents).toEqual([{ name: "Subir currículum", required: true }, { name: "Archivos adicionales", required: false }]);
    expect(urls).toEqual([TT_URL]);
  });

  it("an id carrying its URL slug is read at the job number", async () => {
    const { r, urls } = await read({ ...TT, id: "teamtailor:providentmexico:8685261-supervisor-de-credito" }, { [TT_URL]: { body: fixture("teamtailor-providentmexico-8685261.html") } });
    expect(r.kind).toBe("read");
    expect(urls).toEqual([TT_URL]);
  });

  it("follows one redirect to the tenant's own career domain when the posting's link names that site", async () => {
    const custom = "https://careers.ale-hop.org/jobs/8685261/applications/new";
    const ref = { ...TT, applyUrl: "https://careers.ale-hop.org/jobs/8685261-x" };
    const { r, urls } = await read(ref, { [TT_URL]: { status: 301, location: custom }, [custom]: { body: fixture("teamtailor-providentmexico-8685261.html") } });
    expect(r.kind).toBe("read");
    expect(urls).toEqual([TT_URL, custom]);
  });

  it.each([
    ["another site than the posting's link", "https://evil.example/jobs/8685261/applications/new"],
    ["plain http", "http://careers.ale-hop.org/jobs/8685261/applications/new"],
    ["another path", "https://careers.ale-hop.org/admin"],
    ["credentials in the URL", "https://user:pw@careers.ale-hop.org/jobs/8685261/applications/new"],
  ])("never follows a redirect to %s", async (_what, to) => {
    const ref = { ...TT, applyUrl: "https://careers.ale-hop.org/jobs/8685261-x" };
    const { r, urls } = await read(ref, { [TT_URL]: { status: 301, location: to }, [to]: { body: fixture("teamtailor-providentmexico-8685261.html") } });
    expect(r.kind).toBe("absent");
    expect(urls).toEqual([TT_URL]);
  });
});

describe("every fetch stays on the vendor's host, and a forged posting is refused", () => {
  it.each([
    ["a Teamtailor token that is not a host label", { ...TT, id: "teamtailor:evil.com/x:8685261", token: "evil.com/x" }],
    ["a BambooHR token that is not a host label", { ...BH, id: "bamboohr:evil.com#:1410", token: "evil.com#" }],
    ["a Lever id that is not a posting uuid", { ...LV, id: "lever:cfsenergy:../../admin", applyUrl: "https://evil.example/x" }],
    ["a Paylocity id that is not a number", { ...PL, id: `${PL.source}:${PL.token}:1;rm` }],
    ["a Workable shortcode with a path in it", { ...WK, id: "workable:acdisaster:C6A0/../admin" }],
  ])("%s: no fetch at all", async (_what, ref) => {
    const { r, urls } = await read(ref as PostingRef, {});
    expect(r.kind).not.toBe("read");
    expect(urls).toEqual([]);
  });

  it("a forged apply link never moves a fetch off the vendor's host", async () => {
    const hosts: string[] = [];
    for (const ref of [
      { ...WK, applyUrl: "https://evil.example/j/C6A04F38AA" },
      { ...LV, applyUrl: "https://evil.example/cfsenergy/x" },
      { ...BH, applyUrl: "https://evil.example/careers/1410" },
      { ...PL, applyUrl: "https://evil.example/Details/4344747" },
      { ...TT, applyUrl: "https://evil.example/jobs/8685261" },
    ]) {
      const { urls } = await read(ref, {});
      hosts.push(...urls.map((u) => new URL(u).hostname));
    }
    expect(hosts.sort()).toEqual(["alstonco.bamboohr.com", "apply.workable.com", "jobs.lever.co", "providentmexico.teamtailor.com", "recruiting.paylocity.com"]);
  });

  it("every reader fetch refuses redirects and sends nothing but a GET", async () => {
    for (const [ref, url] of [[WK, WK_URL], [LV, LV_URL], [BH, BH_URL], [PL, PL_URL], [TT, TT_URL]] as const) {
      const { inits } = await read(ref, { [url]: { body: "{}" } });
      expect(inits.length, ref.id).toBe(1);
      expect(inits[0]?.redirect, ref.id).toBe("manual");
      expect(inits[0]?.method ?? "GET", ref.id).toBe("GET");
      expect(inits[0]?.body, ref.id).toBeUndefined();
    }
  });
});

describe("a closed posting reads as no form", () => {
  it.each([
    ["Workable", WK, WK_URL, { status: 404 }],
    ["Lever", LV, LV_URL, { status: 404 }],
    ["BambooHR (status not Open)", BH, BH_URL, { body: JSON.stringify({ result: { jobOpening: { jobOpeningStatus: "Filled" }, formFields: { firstName: { isRequired: true } } } }) }],
    ["Teamtailor (a redirect off the tenant)", { ...TT, applyUrl: "https://providentmexico.teamtailor.com/jobs/8685261" }, TT_URL, { status: 301, location: "https://www.millenniumhotelscareers.com/" }],
  ] as const)("%s", async (_what, ref, url, served) => {
    const { r } = await read(ref, { [url]: served });
    expect(r.kind).toBe("absent");
  });
});
