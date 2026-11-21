// @vitest-environment node
/**
 * A SEARCH SENT AS keyword IS SEARCHED FOR THAT WORD AND SAYS SO, AN ARGUMENT
 * LEFT EMPTY IS NOT SENT, AND A NAME NO TOOL TAKES IS REFUSED WITH THE NAMES
 * IT DOES TAKE, BEFORE ANYTHING IS COUNTED (lane fix/1121-connector-errors,
 * item 2).
 *
 * Live 2026-11-21: search_jobs {keyword: "Recruiter", country: "IE"} answered
 * every job in Ireland (Team Member, Group CFO, ...), total 3,525, with no
 * error and no note: a name the tool does not declare was dropped without a
 * word. The shipped handler, its network faked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const ROW = { id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme", title: "Recruiter", country: "IE" };
const KEY = { authorization: "Bearer rb_live_harness_key" };
const CV = "Talent acquisition partner, eight years recruiting engineers and nurses, sourcing, interviewing, offers. ".repeat(3);

let m: KeylessMcp;
beforeEach(async () => {
  m = await bootKeylessMcp();
  m.board = () => new Response(JSON.stringify({ jobs: [ROW], total: 1, hasMore: false }), { status: 200 });
}, 120_000);

const search = async (args: unknown, name = "search_jobs") => {
  const r = await m.rpc("tools/call", { name, arguments: args });
  const res = r.result as { isError?: boolean; content: Array<{ text: string }> };
  return { isError: res.isError === true, text: res.content[0].text, body: JSON.parse(res.content[0].text) as Record<string, unknown> };
};
const metered = () => m.rpcs.filter((r) => r.name === "mcp_anon_check_v2").length;
const pageReads = () => m.boardCalls.filter((b) => !b.countOnly && !b.explain);

describe("NOT SENT: null, a blank string and an empty array are no argument", () => {
  it("the shape a client sends when it fills unused optional fields is the search {query} alone", async () => {
    await search({ query: "nurse" });
    const plain = pageReads()[0];
    m.boardCalls.length = 0;
    const r = await search({ query: "nurse", location: null, remote: null, sort: "", payBasis: null, maxAgeDays: null });
    expect(r.isError).toBe(false);
    expect(pageReads()[0]).toEqual(plain);
  });
  it("a blank country and an empty companies list send neither; page null is no argument at all", async () => {
    await search({ query: "nurse", country: "  " });
    expect(pageReads()[0]).not.toHaveProperty("country");
    await search({ query: "nurse", companies: [] });
    expect(pageReads()[1]).not.toHaveProperty("companies");
    const r = await search({ query: "nurse", page: null });
    expect(r.isError).toBe(false);
    expect(r.body).not.toHaveProperty("ignoredArguments");
  });
});

describe("PAGE, which no tool declares and models send", () => {
  it.each([1, "1"])("page %j is the first page, answered, with page named in ignoredArguments", async (page) => {
    const r = await search({ query: "nurse", page });
    expect(r.isError).toBe(false);
    expect(r.body.ignoredArguments).toEqual(["page"]);
  });
  it("page 2 is refused naming offset, with no meter call and no board call", async () => {
    const r = await search({ query: "nurse", page: 2 });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/offset = nextOffset/);
    expect(metered()).toBe(0);
    expect(m.boardCalls).toHaveLength(0);
  });
});

describe("ALIASES: a name the tool does not declare is read under its obvious name and said back", () => {
  it("{keyword, country} searches the keyword and says argumentsRead {keyword: query}", async () => {
    const r = await search({ keyword: "Recruiter", country: "IE" });
    expect(r.isError).toBe(false);
    expect(pageReads()[0]).toMatchObject({ q: "Recruiter", country: "IE" });
    expect(r.body.argumentsRead).toEqual({ keyword: "query" });
  });
  it("/v1's spelling work_mode is read as workMode", async () => {
    const r = await search({ query: "nurse", work_mode: "remote" });
    expect(r.isError).toBe(false);
    expect(pageReads()[0]).toMatchObject({ workMode: "remote" });
    expect(r.body.argumentsRead).toEqual({ work_mode: "workMode" });
  });
});

describe("SHAPES and VALUES", () => {
  it("arguments sent as a JSON string are read; an array is an argument error", async () => {
    const r = await search('{"query":"nurse"}');
    expect(r.isError).toBe(false);
    expect(pageReads()[0]).toMatchObject({ q: "nurse" });
    expect((await search([1, 2])).isError).toBe(true);
    expect(metered()).toBe(1);
  });
  it("two names for one argument with different values are refused naming both", async () => {
    const r = await search({ q: "a", query: "b" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/\\"q\\"/);
    expect(r.text).toMatch(/\\"query\\"/);
  });
  it("remote 'true' binds remote; remote 'yes' is refused naming true and false; sort 'date' is refused with its enum", async () => {
    await search({ query: "nurse", remote: "true" });
    expect(pageReads()[0]).toMatchObject({ remote: true });
    const yes = await search({ query: "nurse", remote: "yes" });
    expect(yes.isError).toBe(true);
    expect(yes.text).toMatch(/true or false/);
    const date = await search({ query: "nurse", sort: "date" });
    expect(date.isError).toBe(true);
    expect(date.text).toMatch(/relevance, newest, salary/);
  });
  it("a name no search tool takes is refused with the names it does take, uncounted", async () => {
    const r = await search({ query: "nurse", colour: "red" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/does not take \\"colour\\"\. It takes: query, location, country/);
    expect(metered()).toBe(0);
  });
});

describe("OTHER TOOLS", () => {
  it("get_job answers an unknown name and lists it in ignoredArguments", async () => {
    m.board = () => new Response(JSON.stringify({ job: ROW }), { status: 200 });
    const r = await search({ id: ROW.id, verbose: true }, "get_job");
    expect(r.body.ignoredArguments).toEqual(["verbose"]);
  });
  it("search refuses a filter, naming search_jobs", async () => {
    const r = await search({ query: "nurse", location: "Austin" }, "search");
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/search takes only query; search_jobs takes location, country and the other filters\./);
  });
});

describe("FIT_RESUME hands every search name to its search (keyed)", () => {
  beforeEach(() => {
    m.answers.api_key_check = { data: { is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: "builder", rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1 }, error: null };
    m.answers.v1_withheld_company_tokens = { data: [], error: null };
    const inner = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) =>
      String(url).endsWith("/functions/v1/job-fit") ? new Response(JSON.stringify({ fits: {}, matched: {}, missing: {} }), { status: 200 }) : inner(url, init)) as typeof fetch;
  });
  const fit = async (args: Record<string, unknown>, headers: Record<string, string> = KEY) => {
    const r = await m.rpc("tools/call", { name: "fit_resume", arguments: args }, headers);
    const res = r.result as { isError?: boolean; content: Array<{ text: string }> };
    return { isError: res.isError === true, text: res.content[0].text };
  };
  it("a filtered fit reaches the board with its filters, never refused", async () => {
    expect((await fit({ resumeText: CV, companies: "anthropic" })).isError).toBe(false);
    expect(pageReads()[0]).toMatchObject({ companies: ["anthropic"] });
    expect((await fit({ resumeText: CV, workMode: "remote", maxAgeDays: 7 })).isError).toBe(false);
    expect(pageReads()[1]).toMatchObject({ workMode: "remote", maxAgeDays: 7 });
    expect((await fit({ resumeText: CV, employer: "anthropic" })).isError).toBe(false);
    expect(pageReads()[2]).toMatchObject({ companies: ["anthropic"] });
  });
  it("an unknown name is refused listing the names; with no credential the key answer comes first", async () => {
    const r = await fit({ resumeText: CV, colour: "red" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/fit_resume does not take \\"colour\\"\. It takes: /);
    const none = await fit({ resumeText: CV, colour: "red" }, {});
    expect(none.text).not.toMatch(/does not take/);
    expect(none.text).toMatch(/key|sign/i);
  });
});
