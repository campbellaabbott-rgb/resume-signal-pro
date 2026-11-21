// @vitest-environment node
/**
 * A ROW THE BOARD LABELS employer KEEPS THAT LABEL, NO ANSWER SAYS TOTAL
 * COUNTS TITLE MATCHES ONLY, AND A PAGE WHOSE ROWS CARRY NO LABEL IS NEVER
 * TOLD NO TITLE MATCHED (lane fix/1121-connector-errors, item 14).
 *
 * The guide said total counts postings whose TITLE matches; the board counts
 * a vector of title, employer name and department (Recruiter in Ireland: 110,
 * of which 16 match in the title). Only "title" and "description" were passed
 * on as a match scope, so the board build's third label would be dropped. And
 * most rows carry no label at all (115 of 133 benchmark rows).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const MCP = readFileSync(resolve(__dirname, "../../supabase/functions/agent-mcp/index.ts"), "utf8");
const row = (i: number, matchScope?: string) => ({ id: `greenhouse:acme:${i}`, source: "greenhouse", title: `Role ${i}`, ...(matchScope ? { matchScope } : {}) });

let m: KeylessMcp;
let page: Array<Record<string, unknown>>;
let extra: Record<string, unknown>;
beforeEach(async () => {
  m = await bootKeylessMcp();
  extra = {};
  m.board = () => new Response(JSON.stringify({ jobs: page, total: page.length, hasMore: false, ...extra }), { status: 200 });
}, 120_000);
const search = async (args: Record<string, unknown> = { query: "recruiter" }) => JSON.parse((await m.call(args)).text) as Record<string, unknown>;

describe("the employer label and the split totals pass through", () => {
  it("a row labelled employer keeps it; titleTotal and employerTotal ride beside total", async () => {
    page = [row(1, "employer")];
    extra = { titleTotal: 16, employerTotal: 94 };
    const r = await search();
    expect((r.jobs as Array<Record<string, unknown>>)[0].matchScope).toBe("employer");
    expect(r).toMatchObject({ titleTotal: 16, employerTotal: 94 });
  });
  it("every board body carries the board's own fence for the withheld system", async () => {
    page = [row(1)];
    await search();
    expect(m.boardCalls[0].excludeSources).toEqual(["smartrecruiters"]);
  });
  it("the guide says total counts title, employer-name and department matches, never TITLE alone", () => {
    expect(MCP).not.toMatch(/counts postings whose TITLE matches/);
    expect(MCP).toMatch(/total\\` counts postings whose title, employer name or department matched/);
  });
});

describe("matchNote fires only when every row says it matched somewhere other than its title", () => {
  it.each([
    ["employer and description rows", () => [row(1, "employer"), row(2, "description")], true],
    ["description rows (today's case)", () => [row(1, "description"), row(2, "description")], true],
    ["ten unlabelled rows (Manager in Italy)", () => Array.from({ length: 10 }, (_, i) => row(i)), false],
    ["three unlabelled and seven description rows", () => [...Array.from({ length: 3 }, (_, i) => row(i)), ...Array.from({ length: 7 }, (_, i) => row(10 + i, "description"))], false],
    ["one title row and nine employer rows", () => [row(0, "title"), ...Array.from({ length: 9 }, (_, i) => row(1 + i, "employer"))], false],
    ["an empty page", () => [], false],
  ])("%s", async (_what, rows, fires) => {
    page = rows();
    const r = await search();
    expect(r.matchNote !== undefined).toBe(fires);
  });
  it("a browse with no query whose rows are unlabelled carries none", async () => {
    page = [row(1), row(2)];
    const r = await search({ location: "Dublin" });
    expect(r).not.toHaveProperty("matchNote");
  });
});
