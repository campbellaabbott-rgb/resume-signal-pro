// @vitest-environment node
/**
 * AN ADDRESS-BAR WORKDAY LINK, AN ORACLE PREVIEW, A WORKABLE SHORT LINK AND A
 * USAJOBS PAGE ARE READ (S12-028, S12-038; fetch-job-posting.2026-10-11.26).
 *
 * S12-028. The fetcher read Workday only by the board's own /job/{place}/{slug}
 * link. What a person copies from the address bar is /{site}/details/{slug}
 * or wd{n}.myworkdaysite.com/recruiting/{tenant}/{site}/..., and Oracle shows
 * .../requisitions/preview/{id}: all answered no_description for the two
 * vendors behind 57% of the board, after charging the person's meter. CXS
 * reads a job by its slug alone (measured 2026-10-12 on a CVS Health
 * posting); Oracle's ById finder takes the preview's id. A link of a vendor
 * whose page carries no posting and whose shape no plan reads is answered
 * before the meters.
 *
 * S12-038. Workable and USAJOBS were on the host list and read by neither:
 * USAJOBS writes its JobPosting script as type="application/ld&#x2B;json"
 * (live 2026-10-12), and Workable had no plan; its /j/{code} link redirects
 * to /{account}/j/{code}, whose v2 API carries the text.
 */
import { describe, expect, it } from "vitest";
import { apiPlanFor, jobPostingFromHtml, unreadableShape } from "../../supabase/functions/fetch-job-posting/extract";
import { handleFetchJobPosting, readPosting, type HandlerDeps } from "../../supabase/functions/fetch-job-posting/handler";

const PUBLIC_V4 = "151.101.1.69";
const DESCRIPTION = "<p>We are hiring a pharmacist for our Lafayette store.</p><ul><li>Dispense and verify prescriptions accurately</li><li>Counsel patients and partner with prescribers</li></ul><p>Licensed pharmacist in Indiana, two years of retail experience preferred.</p>";
const plan = (u: string, v: string) => apiPlanFor(new URL(u), v)?.url ?? null;

describe("the shapes a person copies are planned (S12-028)", () => {
  it("Workday /details/ and myworkdaysite links read through CXS by the slug", () => {
    expect(plan("https://cvshealth.wd1.myworkdayjobs.com/en-US/CVS_Health_Careers/details/Pharmacist_R1055675", "workday"))
      .toBe("https://cvshealth.wd1.myworkdayjobs.com/wday/cxs/cvshealth/CVS_Health_Careers/job/Pharmacist_R1055675");
    expect(plan("https://cvshealth.wd1.myworkdayjobs.com/CVS_Health_Careers/details/Pharmacist_R1055675?q=x", "workday"))
      .toBe("https://cvshealth.wd1.myworkdayjobs.com/wday/cxs/cvshealth/CVS_Health_Careers/job/Pharmacist_R1055675");
    expect(plan("https://wd1.myworkdaysite.com/en-US/recruiting/cvshealth/CVS_Health_Careers/job/IN---Lafayette/Pharmacist_R1055675", "workday"))
      .toBe("https://wd1.myworkdaysite.com/wday/cxs/cvshealth/CVS_Health_Careers/job/IN---Lafayette/Pharmacist_R1055675");
    expect(plan("https://wd5.myworkdaysite.com/recruiting/acme/External/details/Engineer_JR1", "workday"))
      .toBe("https://wd5.myworkdaysite.com/wday/cxs/acme/External/job/Engineer_JR1");
    // positive control: the board's own form is unchanged
    expect(plan("https://acme.wd5.myworkdayjobs.com/en-US/Acme_Careers/job/Boston/Engineer_JR1", "workday"))
      .toBe("https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Acme_Careers/job/Boston/Engineer_JR1");
  });

  it("an Oracle preview link reads through the ById finder", () => {
    expect(plan("https://eluq.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions/preview/216799", "oracle"))
      .toBe(plan("https://eluq.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/216799", "oracle"));
    expect(plan("https://eluq.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions/preview/216799", "oracle")).toContain(encodeURIComponent('ById;Id="216799",siteNumber=CX_1'));
  });

  it("a Workable account link reads through its v2 API", () => {
    expect(plan("https://apply.workable.com/1-stopasia/j/8BDCFB4350/", "workable")).toBe("https://apply.workable.com/api/v2/accounts/1-stopasia/jobs/8BDCFB4350");
    expect(plan("https://apply.workable.com/j/8BDCFB4350", "workable"), "the short form has no account until it redirects").toBeNull();
  });

  it("a link no plan can read, of a vendor whose page holds no posting, is known unreadable", () => {
    expect(unreadableShape(new URL("https://eluq.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/my-profile"), "oracle")).toBe(true);
    expect(unreadableShape(new URL("https://job-boards.greenhouse.io/acme"), "greenhouse")).toBe(true);
    expect(unreadableShape(new URL("https://job-boards.greenhouse.io/acme/jobs/123"), "greenhouse")).toBe(false);
    expect(unreadableShape(new URL("https://acme.teamtailor.com/jobs/1-x"), "teamtailor"), "a page that may carry a JobPosting is still fetched").toBe(false);
  });
});

describe("USAJOBS' entity-written script type is a JobPosting (S12-038)", () => {
  it("reads the posting from type=application/ld&#x2B;json", () => {
    const page = `<html><head><script type="application/ld&#x2B;json" nonce="abc">{"@context":"http://www.schema.org","@type":"JobPosting","title":"Logistics Support Specialist","description":${JSON.stringify(DESCRIPTION)}}</script></head><body></body></html>`;
    expect(jobPostingFromHtml(page)?.title).toBe("Logistics Support Specialist");
    expect(jobPostingFromHtml(page.replace("&#x2B;", "&#43;"))?.title).toBe("Logistics Support Specialist");
    expect(jobPostingFromHtml(page.replace("ld&#x2B;json", "javascript")), "positive control: any other script is not read").toBeNull();
  });
});

function handlerDeps(fetchImpl: (u: string) => Response | Promise<Response>) {
  const asked: string[] = [];
  const rpcs: string[] = [];
  const hd: HandlerDeps = {
    resolve: async () => [PUBLIC_V4],
    fetch: async (u: string) => { asked.push(u); return await fetchImpl(u); },
    deadlineMs: 2_000,
    serviceKey: "svc-key",
    rpc: async (fn) => { rpcs.push(fn); return fn === "check_rate_limit" ? { data: true, error: null } : { data: [{ is_allowed: true }], error: null }; },
  };
  return { hd, asked, rpcs };
}
const post = (url: string) => new Request("https://h.supabase.co/functions/v1/fetch-job-posting", {
  method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.50" }, body: JSON.stringify({ url }),
});

describe("the handler reads them, and charges nothing for a shape it cannot read", () => {
  it("a Workday /details/ link answers the posting from CXS", async () => {
    const { hd, asked } = handlerDeps((u) => (u.includes("/wday/cxs/")
      ? new Response(JSON.stringify({ jobPostingInfo: { title: "Pharmacist", jobDescription: DESCRIPTION } }))
      : new Response("<html>spa shell</html>")));
    const j = await (await handleFetchJobPosting(post("https://cvshealth.wd1.myworkdayjobs.com/en-US/CVS_Health_Careers/details/Pharmacist_R1055675"), hd)).json();
    expect(j).toMatchObject({ ok: true, vendor: "workday", source: "vendor_api", title: "Pharmacist" });
    expect(asked[0]).toBe("https://cvshealth.wd1.myworkdayjobs.com/wday/cxs/cvshealth/CVS_Health_Careers/job/Pharmacist_R1055675");
  });

  it("a Workable short link follows its redirect and reads the account's API", async () => {
    const { hd, asked } = handlerDeps((u) => {
      if (u === "https://apply.workable.com/j/8BDCFB4350") return new Response(null, { status: 301, headers: { location: "/1-stopasia/j/8BDCFB4350" } });
      if (u.endsWith("/1-stopasia/j/8BDCFB4350")) return new Response("<html><div id=root></div></html>", { headers: { "content-type": "text/html" } });
      if (u === "https://apply.workable.com/api/v2/accounts/1-stopasia/jobs/8BDCFB4350") return new Response(JSON.stringify({ title: "Linguist", description: DESCRIPTION, requirements: "<p>Native Thai</p>" }));
      return new Response("nope", { status: 404 });
    });
    const out = await readPosting(new URL("https://apply.workable.com/j/8BDCFB4350"), "workable", hd);
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, source: "vendor_api" });
    expect(asked).toContain("https://apply.workable.com/api/v2/accounts/1-stopasia/jobs/8BDCFB4350");
  });

  it("an unreadable Oracle shape answers no_description before either meter and fetches nothing", async () => {
    const { hd, asked, rpcs } = handlerDeps(() => new Response("x"));
    const j = await (await handleFetchJobPosting(post("https://eluq.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/my-profile"), hd)).json();
    expect(j).toEqual({ ok: false, reason: "no_description", vendor: "oracle" });
    expect(rpcs, "no meter was charged").toEqual([]);
    expect(asked).toEqual([]);
  });
});
