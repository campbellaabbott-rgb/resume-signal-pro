// @vitest-environment node
/**
 * A SEARCH SENT AS keyword IS SEARCHED FOR THAT WORD AND SAYS SO, AN ARGUMENT
 * LEFT EMPTY IS NOT SENT, AND A NAME NO TOOL TAKES IS ANSWERED WITHOUT, SAID
 * ON THE FIRST LINE AND COUNTED, NEVER DROPPED (lane fix/1121-connector-errors,
 * item 2, as corrected 2026-11-22 to owner decision D3).
 *
 * Live 2026-11-21: search_jobs {keyword: "Recruiter", country: "IE"} answered
 * every job in Ireland (Team Member, Group CFO, ...), total 3,525, with no
 * error and no note: a name the tool does not declare was dropped without a
 * word. D3 (mcp-upgrade-3-2026-11-16/decisions.json): correct and say known
 * misnamings; say and count unknown ones, refusing them only in a later lane
 * after the 7-day count and a replay; fixed answers for sponsorship and
 * seniority; string booleans accepted and disclosed. The shipped handler, its
 * network faked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const ROW = { id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme", title: "Recruiter", country: "IE" };
const KEY = { authorization: "Bearer rb_live_harness_key" };
const CV = "Talent acquisition partner, eight years recruiting engineers and nurses, sourcing, interviewing, offers. ".repeat(3);
const SPONSORSHIP = `The board cannot filter on this. Read each posting's own lines (get_jobs with includeDescription true, requirements first) and ask the person.`;
const SENIORITY = `Put the level in query as a title word (for example "senior"). The experience filter covers about 39% of postings.`;

let m: KeylessMcp;
beforeEach(async () => {
  m = await bootKeylessMcp();
  m.board = () => new Response(JSON.stringify({ jobs: [ROW], total: 1, hasMore: false }), { status: 200 });
}, 120_000);

type Block = { type: string; text: string };
/** The answer: every text block, the first line, and the JSON block read. */
const search = async (args: unknown, name = "search_jobs", headers?: Record<string, string>) => {
  const r = await m.rpc("tools/call", { name, arguments: args }, headers);
  const res = r.result as { isError?: boolean; content: Block[]; structuredContent?: Record<string, unknown> };
  const json = res.content.find((b) => b.text.trimStart().startsWith("{")) ?? res.content[0];
  return {
    isError: res.isError === true,
    blocks: res.content,
    first: res.content[0].text.split("\n")[0],
    text: json.text,
    body: JSON.parse(json.text) as Record<string, unknown>,
    structured: res.structuredContent,
  };
};
const metered = () => m.rpcs.filter((r) => r.name === "mcp_anon_check_v2").length;
const pageReads = () => m.boardCalls.filter((b) => !b.countOnly && !b.explain);
/** The outcomes counted, once the background writes have run. */
const outcomes = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
  return m.rpcs.filter((x) => x.name === "mcp_count_call").map((x) => x.args.p_outcome);
};

describe("NOT SENT: null, a blank string and an empty array are no argument", () => {
  it("the shape a client sends when it fills unused optional fields is the search {query} alone", async () => {
    await search({ query: "nurse" });
    const plain = pageReads()[0];
    m.boardCalls.length = 0;
    const r = await search({ query: "nurse", location: null, remote: null, sort: "", payBasis: null, maxAgeDays: null });
    expect(r.isError).toBe(false);
    expect(pageReads()[0]).toEqual(plain);
    expect(r.blocks).toHaveLength(1);
    expect(await outcomes()).toEqual(["ok", "ok"]);
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
  it("page 2 is still refused naming offset, with no meter call and no board call", async () => {
    const r = await search({ query: "nurse", page: 2 });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/offset = nextOffset/);
    expect(metered()).toBe(0);
    expect(m.boardCalls).toHaveLength(0);
  });
});

describe("ALIASES: a name the tool does not declare is read under its obvious name, said back and counted corrected", () => {
  it("{keyword, country} searches the keyword and says argumentsRead {keyword: query}", async () => {
    const r = await search({ keyword: "Recruiter", country: "IE" });
    expect(r.isError).toBe(false);
    expect(pageReads()[0]).toMatchObject({ q: "Recruiter", country: "IE" });
    expect(r.body.argumentsRead).toEqual({ keyword: "query" });
    expect(await outcomes()).toEqual(["corrected"]);
  });
  it("/v1's spelling work_mode is read as workMode", async () => {
    const r = await search({ query: "nurse", work_mode: "remote" });
    expect(r.isError).toBe(false);
    expect(pageReads()[0]).toMatchObject({ workMode: "remote" });
    expect(r.body.argumentsRead).toEqual({ work_mode: "workMode" });
  });
});

describe("UNKNOWN NAMES (D3): never applied, NOT refused, said on the first line, listed and counted would_refuse", () => {
  it("{query, colour} is the search {query} alone, and its first line says colour was not applied", async () => {
    await search({ query: "nurse" });
    const plain = pageReads()[0];
    m.boardCalls.length = 0;
    const r = await search({ query: "nurse", colour: "red" });
    expect(r.isError).toBe(false);
    expect(pageReads()[0]).toEqual(plain);
    expect(r.first).toMatch(/^search_jobs does not take "colour", so it was not applied\. It takes: query, location, country, /);
    expect(r.first).not.toMatch(/Did you mean/);
    expect(r.body.ignoredArguments).toEqual(["colour"]);
    expect(r.body.notApplied).toEqual([r.first]);
    expect(r.structured?.notApplied).toEqual([r.first]);
    expect(r.body).not.toHaveProperty("didYouMean");
    expect(metered()).toBe(2);
    expect(await outcomes()).toEqual(["ok", "would_refuse"]);
  });
  it("a name two edits from one the tool takes is offered as a did-you-mean", async () => {
    const r = await search({ query: "nurse", locaton: "Austin" });
    expect(r.isError).toBe(false);
    expect(pageReads()[0]).not.toHaveProperty("location");
    expect(r.first).toMatch(/^search_jobs does not take "locaton", so it was not applied\. It takes: .*\. Did you mean location\?$/);
    expect(r.body.didYouMean).toEqual({ locaton: "location" });
  });
  it("a did-you-mean is never offered toward a fixed-answer name the tool does not take", async () => {
    const r = await search({ query: "nurse", levle: "senior" });
    expect(r.first).toMatch(/does not take "levle", so it was not applied/);
    expect(r.body).not.toHaveProperty("didYouMean");
  });
  it("two unknown names are said in one line", async () => {
    const r = await search({ query: "nurse", colour: "red", shoe: 9 });
    expect(r.first).toMatch(/^search_jobs does not take "colour" or "shoe", so they were not applied\./);
    expect(r.body.ignoredArguments).toEqual(["colour", "shoe"]);
  });
  it("a real conflict between two sent names is still refused naming both", async () => {
    const r = await search({ q: "a", query: "b" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/\\"q\\"/);
    expect(r.text).toMatch(/\\"query\\"/);
  });
});

describe("FIXED ANSWERS: sponsorship and seniority names are never applied and get their note", () => {
  it("visa and seniority are answered without, each with its note on the first lines, and counted corrected", async () => {
    await search({ query: "nurse" });
    const plain = pageReads()[0];
    m.boardCalls.length = 0;
    const r = await search({ query: "nurse", visa: "yes", seniority: "senior" });
    expect(r.isError).toBe(false);
    expect(pageReads()[0]).toEqual(plain);
    expect(r.blocks[0].text.split("\n")).toEqual([SPONSORSHIP, SENIORITY]);
    expect(r.body.ignoredArguments).toEqual(["visa", "seniority"]);
    expect(await outcomes()).toEqual(["ok", "corrected"]);
  });
  it.each(["sponsorship", "visa_sponsorship", "requires_sponsorship", "work_authorization", "work_authorisation", "clearance"])(
    "%s: the value is read nowhere and sent nowhere",
    async (name) => {
      const r = await search({ query: "nurse", [name]: "needs-h1b-xyz" });
      expect(r.first).toBe(SPONSORSHIP);
      expect(JSON.stringify(m.boardCalls)).not.toMatch(/needs-h1b-xyz/);
      expect(JSON.stringify(m.rpcs)).not.toMatch(/needs-h1b-xyz/);
      expect(r.text).not.toMatch(/needs-h1b-xyz/);
    },
  );
  it.each(["level", "seniority_level", "experience_level"])("%s gets the seniority note", async (name) => {
    const r = await search({ query: "nurse", [name]: "senior" });
    expect(r.first).toBe(SENIORITY);
    expect(pageReads()[0]).not.toHaveProperty("experience");
  });
});

describe("VALUES (D3): string booleans and the listed synonyms are read and said; anything else outside an enum is refused", () => {
  it.each([["true", true], ["yes", true], ["1", true], ["YES ", true]])("remote %j binds remote true and says how it was read", async (sent, b) => {
    const r = await search({ query: "nurse", remote: sent });
    expect(r.isError).toBe(false);
    expect(pageReads()[0]).toMatchObject({ remote: b });
    expect(r.body.valuesRead).toEqual({ [String(sent).trim()]: true });
    expect(await outcomes()).toEqual(["corrected"]);
  });
  it.each(["false", "no", "0"])("remote %j binds nothing, and says it was read as false", async (sent) => {
    await search({ query: "nurse" });
    const plain = pageReads()[0];
    const r = await search({ query: "nurse", remote: sent });
    expect(r.isError).toBe(false);
    expect(pageReads()[1]).toEqual(plain);
    expect(r.body.valuesRead).toEqual({ [sent]: false });
  });
  it("remote true sent as a boolean is no correction", async () => {
    const r = await search({ query: "nurse", remote: true });
    expect(r.body).not.toHaveProperty("valuesRead");
    expect(await outcomes()).toEqual(["ok"]);
  });
  it("remote 'maybe' is still refused naming true and false", async () => {
    const r = await search({ query: "nurse", remote: "maybe" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/true or false/);
    expect(metered()).toBe(0);
  });
  it.each(["date", "recent", "latest", "posted", "newest_first", "Newest First"])("sort %j is read as newest and said", async (sent) => {
    const r = await search({ query: "nurse", sort: sent });
    expect(r.isError).toBe(false);
    expect(pageReads()[0]).toMatchObject({ sort: "newest" });
    expect(r.body.valuesRead).toEqual({ [sent]: "newest" });
  });
  it("sort 'oldest' is still refused listing the enum", async () => {
    const r = await search({ query: "nurse", sort: "oldest" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/relevance, newest, salary/);
  });
  it.each([
    ["workMode", "wfh", "remote"], ["workMode", "work from home", "remote"], ["workMode", "remote only", "remote"],
    ["workMode", "on-site", "onsite"], ["workMode", "in office", "onsite"], ["workMode", "office", "onsite"],
    ["experience", "junior", "entry"], ["experience", "graduate", "entry"], ["experience", "grad", "entry"],
  ])("%s %j is read as %s, said, and counted corrected", async (name, sent, read) => {
    const r = await search({ query: "nurse", [name]: sent });
    expect(r.isError).toBe(false);
    expect(pageReads()[0]).toMatchObject({ [name]: read });
    expect(r.body.valuesRead).toEqual({ [sent]: read });
    expect(await outcomes()).toEqual(["corrected"]);
  });
  it("a country read from its name is said back and counted corrected; a code is no correction", async () => {
    const r = await search({ query: "nurse", country: "Ireland" });
    expect(r.isError).toBe(false);
    expect(pageReads()[0]).toMatchObject({ country: "IE" });
    expect(r.body.countryRead).toEqual({ Ireland: "IE" });
    await search({ query: "nurse", country: "IE" });
    expect(await outcomes()).toEqual(["corrected", "ok"]);
  });
  it("office is read as onsite for workMode only: experience office is still refused", async () => {
    const r = await search({ query: "nurse", experience: "office" });
    expect(r.isError).toBe(true);
  });
  it("arguments sent as a JSON string are read; an array is an argument error", async () => {
    const r = await search('{"query":"nurse"}');
    expect(r.isError).toBe(false);
    expect(pageReads()[0]).toMatchObject({ q: "nurse" });
    expect((await search([1, 2])).isError).toBe(true);
    expect(metered()).toBe(1);
  });
});

describe("OTHER TOOLS", () => {
  it("get_job answers an unknown name, lists it in ignoredArguments, and counts the call ok", async () => {
    m.board = () => new Response(JSON.stringify({ job: ROW }), { status: 200 });
    const r = await search({ id: ROW.id, verbose: true }, "get_job");
    expect(r.body.ignoredArguments).toEqual(["verbose"]);
    expect(r.body).not.toHaveProperty("notApplied");
    expect(await outcomes()).toEqual(["ok"]);
  });
  it("search answers a filter on query alone, its one JSON text item opening with the line, counted would_refuse", async () => {
    const r = await search({ query: "nurse", location: "Austin" }, "search");
    expect(r.isError).toBe(false);
    expect(r.blocks).toHaveLength(1);
    expect(Object.keys(r.body)[0]).toBe("notApplied");
    expect(r.body.notApplied).toEqual(["search takes only query; search_jobs takes location, country and the other filters."]);
    expect(r.body.ignoredArguments).toEqual(["location"]);
    expect(JSON.stringify(pageReads())).not.toMatch(/Austin/);
    expect(await outcomes()).toEqual(["would_refuse"]);
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
  it("a filtered fit reaches the board with its filters, never refused", async () => {
    expect((await search({ resumeText: CV, companies: "anthropic" }, "fit_resume", KEY)).isError).toBe(false);
    expect(pageReads()[0]).toMatchObject({ companies: ["anthropic"] });
    expect((await search({ resumeText: CV, workMode: "remote", maxAgeDays: 7 }, "fit_resume", KEY)).isError).toBe(false);
    expect(pageReads()[1]).toMatchObject({ workMode: "remote", maxAgeDays: 7 });
    expect((await search({ resumeText: CV, employer: "anthropic" }, "fit_resume", KEY)).isError).toBe(false);
    expect(pageReads()[2]).toMatchObject({ companies: ["anthropic"] });
  });
  it("an unknown name is answered without and said first, counted would_refuse; with no credential the key answer comes first, unchanged", async () => {
    const r = await search({ resumeText: CV, colour: "red" }, "fit_resume", KEY);
    expect(r.isError).toBe(false);
    expect(r.first).toMatch(/^fit_resume does not take "colour", so it was not applied\. It takes: /);
    expect(JSON.stringify(pageReads())).not.toMatch(/colour/);
    expect(await outcomes()).toContain("would_refuse");
    const r2 = await m.rpc("tools/call", { name: "fit_resume", arguments: { resumeText: CV, colour: "red" } }, {});
    const none = (r2.result as { content: Block[] }).content.map((b) => b.text).join("\n");
    expect(none).not.toMatch(/does not take/);
    expect(none).toMatch(/key|sign/i);
  });
});
