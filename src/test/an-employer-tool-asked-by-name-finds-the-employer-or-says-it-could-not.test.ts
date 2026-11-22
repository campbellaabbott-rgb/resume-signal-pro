// @vitest-environment node
/**
 * ASKED ABOUT ANTHROPIC BY NAME, THE GROWTH TOOL ANSWERS THE anthropic BOARD
 * AND SAYS WHICH NAME IT READ, AND A NAME IT CANNOT PLACE IS A ROW WITH
 * CANDIDATES, NEVER AN ERROR (lane fix/1121-connector-errors, item 5).
 *
 * Live 2026-11-21: employer_growth {company: "Anthropic"} and
 * employer_hiring_record {company: "Anthropic"} answered isError "needs
 * companyTokens"; Anthropic inside companyTokens answered no_series while
 * anthropic serves 166 roles.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

let m: KeylessMcp;
const known = new Set(["anthropic", "acme", "srco"]);
beforeEach(async () => {
  m = await bootKeylessMcp();
  m.answers.v1_withheld_company_tokens = { data: ["srco"], error: null };
  // The readers answer a row per token: a token they have never seen is no_series / no_record.
  const growth = (tokens: string[]) => tokens.map((t) => (known.has(t)
    ? { company_token: t, verdict: "grew", unknown_reason: null, window_days: 7 }
    : { company_token: t, verdict: "unknown", unknown_reason: "no_series", window_days: 7 }));
  const health = (tokens: string[]) => tokens.map((t) => (known.has(t)
    ? { company_token: t, open_roles: 166, closed_90d: 10, superseded_90d: 1, tracking_days: 90, feed_total: 166 }
    : { company_token: t, open_roles: 0, closed_90d: 0, superseded_90d: 0, tracking_days: null, feed_total: null }));
  const inner = (globalThis as Record<string, unknown>).__keylessMcpDb as { rpc: (n: string, a: Record<string, unknown>) => unknown };
  const rpc = inner.rpc;
  inner.rpc = (name, args) => {
    if (name === "get_company_growth") { m.rpcs.push({ name, args }); return Promise.resolve({ data: growth(args.p_tokens as string[]), error: null }); }
    if (name === "get_company_hiring_health") { m.rpcs.push({ name, args }); return Promise.resolve({ data: health(args.p_tokens as string[]), error: null }); }
    if (name === "get_employer_layoff_filings") return Promise.resolve({ data: [], error: null });
    return rpc(name, args);
  };
  m.board = (b) => {
    const asked = (b.companies ?? []) as string[];
    const resolved = asked.filter((n) => n.toLowerCase() === "anthropic").map((n) => ({ asked: n, tokens: ["anthropic"] }));
    const withheld = asked.filter((n) => n === "SR Company").map((n) => ({ asked: n, tokens: ["srco"] }));
    const unresolved = asked.filter((n) => n.toLowerCase() !== "anthropic" && n !== "SR Company").map((n) => ({ asked: n, candidates: [{ name: "Acme Corp", token: "acme" }] }));
    return new Response(JSON.stringify({ explain: true, companiesResolved: [...resolved, ...withheld], companiesUnresolved: unresolved }), { status: 200 });
  };
}, 120_000);

const call = async (name: string, args: unknown) => {
  const r = await m.rpc("tools/call", { name, arguments: args });
  const res = r.result as { isError?: boolean; content: Array<{ text: string }>; structuredContent?: Record<string, unknown> };
  return { isError: res.isError === true, text: res.content[0].text, body: JSON.parse(res.content[0].text) as { employers: Array<Record<string, unknown>> } };
};
const explains = () => m.boardCalls.filter((b) => b.explain === true);

describe("an employer asked for by name", () => {
  it("employer_growth {company: Anthropic} answers the anthropic board, saying the name it read", async () => {
    const r = await call("employer_growth", { company: "Anthropic" });
    expect(r.isError).toBe(false);
    expect(r.body.employers).toContainEqual(expect.objectContaining({ company_token: "anthropic", asked: "Anthropic", resolvedFrom: "name", verdict: "grew" }));
    expect(explains()).toHaveLength(1);
    expect(explains()[0]).toMatchObject({ action: "list", explain: true, limit: 1, noLog: true, companies: ["Anthropic"] });
  });
  it("employer_hiring_record {employer: Anthropic} the same", async () => {
    const r = await call("employer_hiring_record", { employer: "Anthropic" });
    expect(r.isError).toBe(false);
    expect(r.body.employers).toContainEqual(expect.objectContaining({ company_token: "anthropic", asked: "Anthropic", resolvedFrom: "name" }));
  });
  it("a name the board cannot place is a row with candidates, never an error", async () => {
    const r = await call("employer_growth", { companyTokens: ["Nowhere Ltd"] });
    expect(r.isError).toBe(false);
    expect(r.body.employers[0]).toMatchObject({ company_token: "Nowhere Ltd", unknown_reason: "name_not_resolved", candidates: [{ name: "Acme Corp", token: "acme" }] });
  });
  it("six unknown names: five looked up in one board call, the sixth not looked up", async () => {
    const names = ["N1", "N2", "N3", "N4", "N5", "N6"];
    const r = await call("employer_growth", { companyTokens: names });
    expect(explains()).toHaveLength(1);
    expect(explains()[0].companies).toEqual(names.slice(0, 5));
    expect(r.body.employers.find((e) => e.company_token === "N6")).toMatchObject({ unknown_reason: "name_not_looked_up" });
  });
  it("a token the ledger knows makes no board call", async () => {
    const r = await call("employer_growth", { companyTokens: ["acme"] });
    expect(r.isError).toBe(false);
    expect(explains()).toHaveLength(0);
  });
  it("a name that resolves to a withheld hiring system's employer gives not_served_here and no figure", async () => {
    const r = await call("employer_growth", { companyTokens: ["SR Company"] });
    const row = r.body.employers.find((e) => e.asked === "SR Company");
    expect(row).toMatchObject({ company_token: "srco", unknown_reason: "not_served_here" });
    expect(row).not.toHaveProperty("growth_pct");
    expect(m.rpcs.filter((x) => x.name === "get_company_growth").flatMap((x) => x.args.p_tokens as string[])).not.toContain("srco");
  });
  it("{} is still an argument error, worded for names", async () => {
    const r = await call("employer_growth", {});
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/needs companyTokens: employer names or companyToken values/);
  });
});
