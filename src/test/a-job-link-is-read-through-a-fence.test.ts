// @vitest-environment node
/**
 * A JOB LINK IS READ THROUGH A FENCE (sweep S11-032, owner decision
 * 2026-10-11: build a safe fetcher).
 *
 * WHAT WAS WRONG. The scanner's "Job URL" tab never fetched anything: it sent
 * "[Job URL: <link>]" as the job description, and the free scan and the $5
 * analysis scored a résumé against a bare link. The owner chose to make the
 * tab true: a new edge function, fetch-job-posting, that reads the posting.
 * A function that fetches a URL a stranger types is a server-side request
 * forgery waiting to happen, so this file holds the fence, every part of it
 * driven with a fake fetch and a fake resolver:
 *
 *   - THE HOST LIST: https only, port 443, no credentials, the vendors the
 *     board reads and employers' careers subdomains of them; never an address,
 *     a lookalike, a custom domain, LinkedIn or Indeed;
 *   - ADDRESSES: every address a name resolves to is public, or nothing is
 *     fetched -- private, loopback, link-local (cloud metadata), CGNAT, IPv6
 *     unique-local and link-local, and IPv4 dressed as IPv6 are refused;
 *   - REBINDING: the name is resolved again after the request; a name that
 *     turned private gets nothing read;
 *   - REDIRECTS are followed by hand and each hop is held to the whole rule;
 *   - a BYTE CAP (declared or streamed) and a DEADLINE that covers a slow body;
 *   - the two METERS (check_rate_limit, then the board's day) before anything
 *     outbound, and the board bucket equal to job-board's own;
 *   - the shipped bundle answers its build and refuses an unlisted host.
 */
import { describe, expect, it, vi } from "vitest";
import { checkFetchUrl, parseJobUrl, vendorOfHost } from "../../supabase/functions/fetch-job-posting/hosts";
import { isPublicAddress, runtimeResolver, safeFetch, type SafeFetchDeps } from "../../supabase/functions/fetch-job-posting/net-guard";
import { apiPlanFor, htmlToText, jobPostingFromHtml, vendorPageText } from "../../supabase/functions/fetch-job-posting/extract";
import { boardAddressKey, boardBucket, boardNetworkOf, BOARD_ADDRESS_DAILY_CAP, BOARD_BUDGET_DEADLINE_MS, BOARD_BUILD_DAILY_CAP, BOARD_PROBE_DAILY_CAP, FETCHES_PER_ADDRESS_HOUR, RATE_WINDOW_MINUTES } from "../../supabase/functions/fetch-job-posting/budget";
import { handleFetchJobPosting, type HandlerDeps } from "../../supabase/functions/fetch-job-posting/handler";
import { addressKey, ADDRESS_DAILY_CAP, ANON_BUDGET_DEADLINE_MS, bucketFor, BUILD_DAILY_CAP, networkOf, PROBE_DAILY_CAP, type CountedCaller } from "../../supabase/functions/job-board/anon-budget";
import { loadEdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 20_000, hookTimeout: 120_000 });

const PUBLIC_V4 = "151.101.1.69";
const DESCRIPTION = "<p>We are hiring a senior payroll analyst.</p><ul><li>Own multi-state payroll and quarterly filings</li><li>Partner with HR on audits and controls</li></ul><p>Five years of payroll experience, ADP or Workday Payroll, strong Excel. Hybrid in Austin, Texas.</p>";
const LD_PAGE = `<html><head><script type="application/ld+json">{"@type":"WebSite","name":"x"}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Senior Payroll Analyst","hiringOrganization":{"@type":"Organization","name":"Acme"},"description":${JSON.stringify(DESCRIPTION)}}</script></head><body>nav nav nav</body></html>`;

/** A response whose body records whether anyone read it. */
function tracked(body: string, init: ResponseInit = {}): { res: Response; read: () => boolean } {
  let pulled = false;
  const bytes = new TextEncoder().encode(body);
  // highWaterMark 0: the stream asks for its body only when a reader does.
  const stream = new ReadableStream<Uint8Array>({ pull(c) { pulled = true; c.enqueue(bytes); c.close(); } }, { highWaterMark: 0 });
  return { res: new Response(stream, { status: 200, headers: { "content-type": "text/html" }, ...init }), read: () => pulled };
}

function deps(over: Partial<SafeFetchDeps> & { fetch?: SafeFetchDeps["fetch"] } = {}): SafeFetchDeps & { asked: string[] } {
  const asked: string[] = [];
  const base: SafeFetchDeps = {
    resolve: async () => [PUBLIC_V4],
    fetch: async () => new Response(LD_PAGE, { headers: { "content-type": "text/html" } }),
    deadlineMs: 2_000,
  };
  const d = { ...base, ...over };
  const inner = d.fetch;
  return { ...d, asked, fetch: async (u, i) => { asked.push(u); return await inner(u, i); } };
}

// ─────────────────────────────────────────────────────────────────────────────
describe("the host list", () => {
  const ACCEPTED: Array<[string, string]> = [
    ["https://job-boards.greenhouse.io/loonshotgames/jobs/8799633002", "greenhouse"],
    ["https://job-boards.eu.greenhouse.io/sohohouseco/jobs/4552351101", "greenhouse"],
    ["https://boards.greenhouse.io/embed/job_app?for=acme&token=123", "greenhouse"],
    ["https://jobs.lever.co/paytmpayments/f7f8c3c8-bb78-47a9-a4c3-a0f0f6f42f9a", "lever"],
    ["https://jobs.eu.lever.co/mobileye/aed812a3-0f66-4ec1-baf9-a0bbb4e9c8d2", "lever"],
    ["https://jobs.ashbyhq.com/datasnipper/ca7a6d04-50bc-4783-842a-3bf742f37ea3", "ashby"],
    ["https://labcorp.wd1.myworkdayjobs.com/en-US/External/job/Bengaluru-India/Analyst_2635654", "workday"],
    ["https://wd3.myworkdaysite.com/recruiting/acme/External/job/x_1", "workday"],
    ["https://jobs.smartrecruiters.com/JYSK/744000154877740", "smartrecruiters"],
    ["https://apply.workable.com/j/EC24BD09A7", "workable"],
    ["https://unitedpropertyassociates.bamboohr.com/careers/94", "bamboohr"],
    ["https://evolvedigital.recruitee.com/o/operations-manager", "recruitee"],
    ["https://footasylum.teamtailor.com/jobs/8527943-sales-assistant", "teamtailor"],
    ["https://sungrow-emea.jobs.personio.de/job/2837109", "personio"],
    ["https://acme.jobs.personio.com/job/1", "personio"],
    ["https://brightside-collective.breezy.hr/p/0ba6d08e2b0e-coordinator", "breezy"],
    ["https://acme.pinpointhq.com/en/postings/1d94ace1", "pinpoint"],
    ["https://careers-primehealthcare.icims.com/jobs/284798/job", "icims"],
    ["https://ecwl.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/245294", "oracle"],
    ["https://ats.rippling.com/zadentech/jobs/9f4c8ecf-200e-4e25-8e2d-9c3f6d4e9b75", "rippling"],
    ["https://recruiting.paylocity.com/recruiting/jobs/Details/4503396", "paylocity"],
    ["https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?jobId=1", "adp"],
    ["https://recruiting.ultipro.com/REY1002RPLAN/JobBoard/x/OpportunityDetail?opportunityId=y", "ukg"],
    ["https://ipinfo.applytojob.com/apply/Ajsmc94QD8/Research-Intern", "jazzhr"],
    ["https://www.usajobs.gov:443/job/887664900", "usajobs"],
  ];
  it("accepts a posting link on every vendor the board reads", () => {
    for (const [u, vendor] of ACCEPTED) {
      const r = parseJobUrl(u);
      expect(r.ok && r.vendor, u).toBe(vendor);
    }
  });

  it("reads a link the way a person pastes it: no scheme, or http, becomes https", () => {
    const bare = parseJobUrl("  jobs.lever.co/acme/f7f8c3c8-bb78-47a9-a4c3-a0f0f6f42f9a ");
    expect(bare.ok && bare.url.protocol).toBe("https:");
    const http = parseJobUrl("http://boards.greenhouse.io/acme/jobs/1");
    expect(http.ok && http.url.toString()).toBe("https://boards.greenhouse.io/acme/jobs/1");
  });

  const REFUSED: Array<[string, string]> = [
    ["https://www.linkedin.com/jobs/view/123", "unsupported_host"],
    ["https://www.indeed.com/viewjob?jk=abc", "unsupported_host"],
    ["https://www.glassdoor.com/job-listing/x", "unsupported_host"],
    ["https://careers.mountaingroup.com/en/postings/1d94ace1", "unsupported_host"], // a vendor behind the employer's own domain
    ["https://greenhouse.io/acme", "unsupported_host"],
    ["https://evilgreenhouse.io/acme/jobs/1", "unsupported_host"],
    ["https://boards.greenhouse.io.evil.example/acme/jobs/1", "unsupported_host"],
    ["https://myworkdayjobs.com.evil.example/x", "unsupported_host"],
    ["https://a.b.recruitee.com/o/x", "unsupported_host"], // one employer label, never two
    ["https://-acme.recruitee.com/o/x", "unsupported_host"],
    ["https://boards.greenhouse.io@evil.example/acme/jobs/1", "bad_url"], // credentials, whatever the host
    ["https://user:pw@boards.greenhouse.io/acme/jobs/1", "bad_url"],
    ["https://boards.greenhouse.io:8443/acme/jobs/1", "bad_url"],
    ["https://127.0.0.1/", "unsupported_host"],
    ["https://169.254.169.254/latest/meta-data/", "unsupported_host"],
    ["https://0x7f000001/", "unsupported_host"],
    ["https://[::1]/", "unsupported_host"],
    ["https://[fd00::1]/", "unsupported_host"],
    ["ftp://boards.greenhouse.io/acme", "not_https"],
    ["file:///etc/passwd", "not_https"],
    ["javascript:alert(1)", "not_https"],
    ["localhost:8080/x", "not_https"],
    ["", "bad_url"],
    ["https://boards.greenhouse.io/acme jobs", "bad_url"],
  ];
  it("refuses every other host, every address, and every other scheme", () => {
    for (const [u, reason] of REFUSED) {
      const r = parseJobUrl(u);
      expect(r.ok === false ? r.reason : "accepted", u).toBe(reason);
    }
    expect(parseJobUrl(123).ok).toBe(false);
  });

  it("holds every hop to the same rule, not only the pasted link", () => {
    expect(checkFetchUrl(new URL("http://boards.greenhouse.io/x"))).toEqual({ ok: false, reason: "not_https" });
    expect(checkFetchUrl(new URL("https://example.com/x"))).toEqual({ ok: false, reason: "unsupported_host" });
    expect(vendorOfHost("BOARDS.GREENHOUSE.IO.")).toBe("greenhouse");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("addresses", () => {
  const PRIVATE = [
    "10.0.0.1", "10.255.255.255", "127.0.0.1", "127.1.2.3", "0.0.0.0", "169.254.169.254", "172.16.0.1", "172.31.255.255",
    "192.168.1.1", "100.64.0.1", "100.127.255.254", "192.0.0.8", "192.0.2.1", "198.18.0.1", "198.51.100.7", "203.0.113.9",
    "224.0.0.1", "239.255.255.250", "255.255.255.255", "240.0.0.1",
    "::", "::1", "fd00::1", "fc00::1", "fdff:ffff::1", "fe80::1", "fe80::1%eth0", "febf::1", "fec0::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::ffff:7f00:1", "::ffff:0:10.0.0.1", "::127.0.0.1",
    "64:ff9b::a9fe:a9fe", "64:ff9b::10.0.0.1", "64:ff9b:1::1", "2001:db8::1", "2001::1", "2001:10::1", "2002:7f00:1::1", "3fff::1",
    "not-an-address", "", "1.2.3", "1.2.3.256",
  ];
  const PUBLIC = ["8.8.8.8", "1.1.1.1", PUBLIC_V4, "172.32.0.1", "100.128.0.1", "2606:4700::6810:84e5", "2a00:1450:4001:82a::200e", "::ffff:8.8.8.8", "64:ff9b::808:808"];
  it("refuses private, loopback, link-local, CGNAT, multicast, documentation, ULA and IPv4 dressed as IPv6", () => {
    for (const a of PRIVATE) expect(isPublicAddress(a), a).toBe(false);
  });
  it("lets public unicast addresses through", () => {
    for (const a of PUBLIC) expect(isPublicAddress(a), a).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("the fetch, fenced", () => {
  const URL0 = "https://acme.recruitee.com/o/payroll-analyst";

  it("a name that resolves to a private address is never asked", async () => {
    for (const addrs of [["10.0.0.5"], ["169.254.169.254"], ["fd12:3456::1"], ["fe80::1"], ["::ffff:127.0.0.1"], [PUBLIC_V4, "192.168.0.10"]]) {
      const d = deps({ resolve: async () => addrs });
      const r = await safeFetch(URL0, d);
      expect(r, addrs.join(",")).toEqual({ ok: false, reason: "blocked_address" });
      expect(d.asked, addrs.join(",")).toEqual([]);
    }
  });

  it("a name that does not resolve is never asked", async () => {
    const d = deps({ resolve: async () => { throw new Error("NXDOMAIN"); } });
    expect(await safeFetch(URL0, d)).toEqual({ ok: false, reason: "dns_failed" });
    const empty = deps({ resolve: async () => [] });
    expect(await safeFetch(URL0, empty)).toEqual({ ok: false, reason: "dns_failed" });
    expect([...d.asked, ...empty.asked]).toEqual([]);
  });

  it("DNS rebinding: a name public for the first look and private by the second gets nothing read", async () => {
    let looks = 0;
    const page = tracked(LD_PAGE);
    const d = deps({
      resolve: async () => (++looks === 1 ? [PUBLIC_V4] : ["127.0.0.1"]),
      fetch: async () => page.res,
    });
    const r = await safeFetch(URL0, d);
    expect(r).toEqual({ ok: false, reason: "blocked_address" });
    expect(looks, "the name was not asked again after the request").toBe(2);
    expect(page.read(), "the body of a rebound name was read").toBe(false);
  });

  it("every hop is re-resolved: a redirect to a listed host that turned private is refused", async () => {
    const d = deps({
      resolve: async (h) => (h === "other.recruitee.com" ? ["10.1.2.3"] : [PUBLIC_V4]),
      fetch: async (u) => (u.startsWith(URL0) ? new Response(null, { status: 302, headers: { location: "https://other.recruitee.com/o/x" } }) : new Response(LD_PAGE)),
    });
    expect(await safeFetch(URL0, d)).toEqual({ ok: false, reason: "blocked_address" });
    expect(d.asked).toEqual([URL0]);
  });

  it("a redirect off the list, or to http, is refused before it is followed", async () => {
    for (const [loc, reason] of [["https://evil.example/steal", "unsupported_host"], ["http://acme.recruitee.com/o/x", "not_https"], ["https://169.254.169.254/latest/meta-data/", "unsupported_host"], ["https://karriere.acme.de/o/x", "unsupported_host"]]) {
      const d = deps({ fetch: async (u) => (u === URL0 ? new Response(null, { status: 301, headers: { location: loc } }) : new Response(LD_PAGE)) });
      expect(await safeFetch(URL0, d), loc).toEqual({ ok: false, reason });
      expect(d.asked, loc).toEqual([URL0]);
    }
  });

  it("redirects are followed by hand, at most three, and never by the runtime", async () => {
    const inits: RequestInit[] = [];
    let n = 0;
    const d = deps({ fetch: async (_u, i) => { inits.push(i); n++; return new Response(null, { status: 302, headers: { location: `/o/hop-${n}` } }); } });
    expect(await safeFetch(URL0, d)).toEqual({ ok: false, reason: "too_many_redirects" });
    expect(d.asked.length).toBe(4);
    expect(inits.every((i) => i.redirect === "manual")).toBe(true);
    const ok = deps({ fetch: async (u) => (u === URL0 ? new Response(null, { status: 308, headers: { location: "/o/moved" } }) : new Response(LD_PAGE)) });
    const r = await safeFetch(URL0, ok);
    expect(r.ok && r.url).toBe("https://acme.recruitee.com/o/moved");
  });

  it("a body declared over the cap is not read; a body streamed over it is cut off", async () => {
    const declared = tracked("x", { headers: { "content-length": "999999999" } });
    const d1 = deps({ fetch: async () => declared.res, maxBytes: 1000 });
    expect(await safeFetch(URL0, d1)).toEqual({ ok: false, reason: "too_large" });
    expect(declared.read()).toBe(false);
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({ pull(c) { sent += 512; c.enqueue(new Uint8Array(512)); } });
    const d2 = deps({ fetch: async () => new Response(endless), maxBytes: 4096 });
    expect(await safeFetch(URL0, d2)).toEqual({ ok: false, reason: "too_large" });
    expect(sent, "the read did not stop near the cap").toBeLessThan(4096 + 2048);
  });

  it("a slow body and slow headers both end at the deadline", async () => {
    const trickle = new ReadableStream<Uint8Array>({
      async pull(c) { await new Promise((r) => setTimeout(r, 100)); c.enqueue(new TextEncoder().encode("<p>")); },
    });
    const t0 = Date.now();
    const slowBody = await safeFetch(URL0, deps({ fetch: async () => new Response(trickle), deadlineMs: 400 }));
    expect(slowBody).toEqual({ ok: false, reason: "timeout" });
    expect(Date.now() - t0).toBeLessThan(1500);
    const stalled = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); } });
    expect(await safeFetch(URL0, deps({ fetch: async () => new Response(stalled), deadlineMs: 300 }))).toEqual({ ok: false, reason: "timeout" });
    const t1 = Date.now();
    expect(await safeFetch(URL0, deps({ fetch: () => new Promise<Response>(() => {}), deadlineMs: 300 }))).toEqual({ ok: false, reason: "timeout" });
    expect(Date.now() - t1).toBeLessThan(1500);
  });

  it("an error status is not read as a posting", async () => {
    expect(await safeFetch(URL0, deps({ fetch: async () => new Response("gone", { status: 404 }) }))).toEqual({ ok: false, reason: "http_error", status: 404 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("what is read: the JobPosting, or the vendor's API", () => {
  it("reads the page's JobPosting and nothing else on the page", () => {
    const p = jobPostingFromHtml(LD_PAGE)!;
    expect(p.title).toBe("Senior Payroll Analyst");
    expect(p.company).toBe("Acme");
    expect(p.text).toMatch(/multi-state payroll/);
    expect(p.text).not.toMatch(/nav nav/);
    const graph = `<script type="application/ld+json">{"@graph":[{"@type":"Organization"},{"@type":["JobPosting"],"title":"T","description":${JSON.stringify(DESCRIPTION)}}]}</script>`;
    expect(jobPostingFromHtml(graph)?.text).toMatch(/quarterly filings/);
    expect(jobPostingFromHtml(`<script type="application/ld+json">{"@type":"JobPosting","description":"Apply now."}</script>`), "a teaser is not a job description").toBeNull();
  });

  it("turns markup, escaped markup and entities into plain lines", () => {
    expect(htmlToText("&lt;p&gt;Own payroll&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Audits&lt;/li&gt;&lt;/ul&gt;")).toBe("Own payroll\n\n• Audits");
    expect(htmlToText("<script>steal()</script><p>R&amp;D &#8211; caf&eacute;</p>")).toBe("R&D – café");
  });

  it("derives each vendor's API from the posting link", () => {
    const plan = (u: string, v: string) => apiPlanFor(new URL(u), v)?.url ?? null;
    expect(plan("https://job-boards.greenhouse.io/acme/jobs/123", "greenhouse")).toBe("https://boards-api.greenhouse.io/v1/boards/acme/jobs/123?questions=false");
    expect(plan("https://job-boards.eu.greenhouse.io/acme/jobs/123", "greenhouse")).toBe("https://boards.eu.greenhouse.io/v1/boards/acme/jobs/123?questions=false");
    expect(plan("https://jobs.lever.co/acme/f7f8c3c8-bb78-47a9-a4c3-a0f0f6f42f9a/apply", "lever")).toBe("https://api.lever.co/v0/postings/acme/f7f8c3c8-bb78-47a9-a4c3-a0f0f6f42f9a?mode=json");
    expect(plan("https://acme.wd5.myworkdayjobs.com/en-US/Acme_Careers/job/Boston/Engineer_JR1", "workday")).toBe("https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Acme_Careers/job/Boston/Engineer_JR1");
    expect(plan("https://jobs.smartrecruiters.com/JYSK/744000154877740-store-manager", "smartrecruiters")).toBe("https://api.smartrecruiters.com/v1/companies/JYSK/postings/744000154877740");
    expect(plan("https://acme.recruitee.com/o/payroll-analyst", "recruitee")).toBe("https://acme.recruitee.com/api/offers/payroll-analyst");
    expect(plan("https://ats.rippling.com/acme/jobs/9f4c8ecf-200e-4e25-8e2d-9c3f6d4e9b75", "rippling")).toBe("https://api.rippling.com/platform/api/ats/v1/board/acme/jobs/9f4c8ecf-200e-4e25-8e2d-9c3f6d4e9b75");
    expect(plan("https://acme.bamboohr.com/careers/94", "bamboohr")).toBe("https://acme.bamboohr.com/careers/94/detail");
    expect(plan("https://jobs.ashbyhq.com/acme/ca7a6d04-50bc-4783-842a-3bf742f37ea3", "ashby"), "ashby is read from its page").toBeNull();
    // Every derived API URL is itself on the list: the fence holds it too.
    for (const u of [
      plan("https://job-boards.greenhouse.io/acme/jobs/123", "greenhouse"), plan("https://jobs.eu.lever.co/acme/f7f8c3c8-bb78-47a9-a4c3-a0f0f6f42f9a", "lever"),
      plan("https://jobs.smartrecruiters.com/JYSK/744000154877740", "smartrecruiters"), plan("https://ats.rippling.com/acme/jobs/9f4c8ecf-200e-4e25-8e2d-9c3f6d4e9b75", "rippling"),
      plan("https://ecwl.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/245294", "oracle"),
    ]) expect(checkFetchUrl(new URL(u!)).ok, u!).toBe(true);
  });

  it("reads the vendor API's own shapes", () => {
    const gh = apiPlanFor(new URL("https://job-boards.greenhouse.io/acme/jobs/1"), "greenhouse")!;
    const escaped = DESCRIPTION.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const p = gh.read(JSON.stringify({ title: "Payroll Analyst", company_name: "Acme", content: escaped }))!;
    expect(p).toMatchObject({ title: "Payroll Analyst", company: "Acme" });
    expect(p.text).toMatch(/^We are hiring/);
    const ukg = vendorPageText(`<script>x = new US.Opportunity.CandidateOpportunityDetail({"Title":"Operator","Description":${JSON.stringify(DESCRIPTION)}});</script>`, "ukg");
    expect(ukg?.title).toBe("Operator");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
type RpcCall = { fn: string; args: Record<string, unknown> };
function handlerDeps(rpcAnswers: Record<string, () => { data: unknown; error: { message: string } | null }>, over: Partial<SafeFetchDeps> = {}) {
  const calls: RpcCall[] = [];
  const d = deps(over);
  const hd: HandlerDeps = {
    ...d,
    serviceKey: "svc-key",
    rpc: async (fn, args) => { calls.push({ fn, args }); return (rpcAnswers[fn] ?? (() => ({ data: null, error: null })))(); },
  };
  return { hd, calls, asked: d.asked };
}
const post = (url: unknown, headers: Record<string, string> = {}) =>
  new Request("https://h.supabase.co/functions/v1/fetch-job-posting", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.50", ...headers }, body: JSON.stringify({ url }),
  });
const ALLOWED = { check_rate_limit: () => ({ data: true, error: null }), job_board_anon_check: () => ({ data: [{ is_allowed: true }], error: null }) };

describe("the handler: refusals first, meters before anything outbound", () => {
  it("an unlisted host is answered at once: no meter, no fetch, and the page is told to ask for the text", async () => {
    const { hd, calls, asked } = handlerDeps(ALLOWED);
    const res = await handleFetchJobPosting(post("https://www.linkedin.com/jobs/view/123"), hd);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: "unsupported_host" });
    expect(calls).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("the hourly limit refuses before any fetch, and a limiter that cannot answer refuses too", async () => {
    const limited = handlerDeps({ ...ALLOWED, check_rate_limit: () => ({ data: false, error: null }) });
    const r1 = await handleFetchJobPosting(post("https://acme.recruitee.com/o/x"), limited.hd);
    expect(r1.status).toBe(429);
    expect((await r1.json()).reason).toBe("rate_limited");
    expect(limited.asked).toEqual([]);
    expect(limited.calls[0]).toEqual({ fn: "check_rate_limit", args: { p_ip: "203.0.113.50", p_function: "fetch-job-posting", p_max_requests: FETCHES_PER_ADDRESS_HOUR, p_window_minutes: RATE_WINDOW_MINUTES } });
    const broken = handlerDeps({ ...ALLOWED, check_rate_limit: () => ({ data: null, error: { message: "down" } }) });
    const r2 = await handleFetchJobPosting(post("https://acme.recruitee.com/o/x"), broken.hd);
    expect(r2.status).toBe(503);
    expect(broken.asked).toEqual([]);
  });

  it("the board's day refuses an address it refused, and fails open when it cannot answer", async () => {
    const refused = handlerDeps({ ...ALLOWED, job_board_anon_check: () => ({ data: [{ is_allowed: false }], error: null }) });
    const r1 = await handleFetchJobPosting(post("https://acme.recruitee.com/o/x"), refused.hd);
    expect(r1.status).toBe(429);
    expect((await r1.json()).reason).toBe("board_budget");
    expect(refused.asked).toEqual([]);
    const bucket = refused.calls.find((c) => c.fn === "job_board_anon_check")!.args;
    expect(bucket.p_bucket).toBe(await boardBucket(addressKey("203.0.113.50"), "svc-key"));
    const down = handlerDeps({ ...ALLOWED, job_board_anon_check: () => ({ data: null, error: { message: "down" } }) });
    const r2 = await handleFetchJobPosting(post("https://acme.recruitee.com/o/payroll-analyst"), down.hd);
    expect(r2.status).toBe(200);
  });

  it("a posting comes back as plain text with its title", async () => {
    const { hd } = handlerDeps(ALLOWED, {
      fetch: async (u) => (u.includes("/api/offers/")
        ? new Response(JSON.stringify({ offer: { title: "Payroll Analyst", company_name: "Acme", description: DESCRIPTION } }))
        : new Response("nope", { status: 500 })),
    });
    const res = await handleFetchJobPosting(post("https://acme.recruitee.com/o/payroll-analyst"), hd);
    const j = await res.json();
    expect(j).toMatchObject({ ok: true, vendor: "recruitee", source: "vendor_api", title: "Payroll Analyst", company: "Acme" });
    expect(j.text).toMatch(/quarterly filings/);
    expect(j.text).not.toMatch(/</);
  });

  it("a page with no posting on it says so instead of returning the page", async () => {
    const { hd } = handlerDeps(ALLOWED, { fetch: async () => new Response("<html><body>Sign in to see this job</body></html>") });
    const j = await (await handleFetchJobPosting(post("https://acme.teamtailor.com/jobs/1-x"), hd)).json();
    expect(j).toEqual({ ok: false, reason: "no_description", vendor: "teamtailor" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("the board's day is the board's own row", () => {
  it("the same key, network, bucket and caps as job-board/anon-budget.ts", async () => {
    for (const a of ["203.0.113.50", "8.8.8.8", "2a00:1450:4001:82a::200e", "::ffff:8.8.4.4", "[2606:4700::1]:443", "8.8.8.8:5555", "10.0.0.1", "fe80::1", "fd00::1", "nonsense"]) {
      const k = addressKey(a);
      expect(boardAddressKey(a), a).toBe(k);
      expect(boardNetworkOf(k), a).toBe(networkOf(k));
      const caller = { exempt: false, kind: k ? "address" : "unknown_address", key: k } as unknown as CountedCaller;
      expect(await boardBucket(k, "svc-key"), a).toBe(await bucketFor(caller, "svc-key"));
    }
    expect([BOARD_ADDRESS_DAILY_CAP, BOARD_BUILD_DAILY_CAP, BOARD_PROBE_DAILY_CAP, BOARD_BUDGET_DEADLINE_MS]).toEqual([ADDRESS_DAILY_CAP, BUILD_DAILY_CAP, PROBE_DAILY_CAP, ANON_BUDGET_DEADLINE_MS]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("the runtime resolver", () => {
  it("asks A and AAAA, and a name with neither is a failure", async () => {
    const asked: string[] = [];
    (globalThis as Record<string, unknown>).Deno = { resolveDns: async (n: string, t: string) => { asked.push(`${n}/${t}`); if (t === "AAAA") throw Object.assign(new Error("no record"), { name: "NotFound" }); return [PUBLIC_V4]; } };
    const r = runtimeResolver(async () => new Response("{}"));
    expect(await r("acme.recruitee.com")).toEqual([PUBLIC_V4]);
    expect(asked.sort()).toEqual(["acme.recruitee.com/A", "acme.recruitee.com/AAAA"]);
    (globalThis as Record<string, unknown>).Deno = { resolveDns: async () => { throw Object.assign(new Error("no record"), { name: "NotFound" }); } };
    await expect(runtimeResolver(async () => new Response("{}"))("nope.recruitee.com")).rejects.toThrow();
    delete (globalThis as Record<string, unknown>).Deno;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("the shipped bundle", () => {
  it("names its build on the preflight and refuses an unlisted host without a meter", async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc-key" };
    const rpcs: string[] = [];
    g.__fjpDb = { rpc: async (fn: string) => { rpcs.push(fn); return { data: true, error: null }; } };
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    const handler = await loadEdgeHandler("fetch-job-posting", {
      "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__fjpDb; }",
    });
    const pre = await handler(new Request("https://h.supabase.co/functions/v1/fetch-job-posting", { method: "OPTIONS" }));
    expect(pre.headers.get("x-fn-build")).toBe("fetch-job-posting.2026-10-09.1");
    expect(pre.headers.get("access-control-allow-headers")).toMatch(/content-type/);
    const res = await handler(post("https://www.indeed.com/viewjob?jk=1"));
    expect(await res.json()).toEqual({ ok: false, reason: "unsupported_host" });
    expect(rpcs).toEqual([]);
    delete g.Deno;
  });
});
