// @vitest-environment node
/**
 * A NULL FIT SAYS WHY IT COULD NOT BE SCORED (S14X-052, the connector's half).
 *
 * fit_resume told the model "a null fit means the posting has no stored text
 * to score". The scorer reads English terms only, and live German postings
 * with 2,143 characters of stored text came back null for having none of
 * them, so the model told a person the employer had posted nothing. Now the
 * description and the schema say a null fit is a posting that could not be
 * scored, for either reason, and where job-fit names the reason per id
 * (the board-ui lane's change) the row carries it as `unscored`. A scorer
 * that does not say leaves it out.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const MCP = readFileSync(resolve(ROOT, "supabase/functions/agent-mcp/index.ts"), "utf8").replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
const CV = "Registered nurse with eight years on acute medical wards, IV therapy, patient assessment and discharge planning. ".repeat(3);
const KEY = { authorization: "Bearer rb_live_harness_key" };
const DE = { id: "personio:klinik:1", title: "Pflegefachkraft (m/w/d)", company: "Klinik", companyToken: "klinik", source: "personio", location: "Berlin" };
const EN = { id: "greenhouse:acme:1", title: "Registered Nurse", company: "Acme", companyToken: "acme", source: "greenhouse", location: "Leeds" };

describe("what the tool says a null fit means", () => {
  const block = MCP.slice(MCP.indexOf('name: "fit_resume",'), MCP.indexOf('name: "board_stats",'));
  it("never that a null always means no stored text", () => {
    expect(block.length).toBeGreaterThan(500);
    expect(block).not.toMatch(/null fit means the posting has no stored text/);
    expect(block).not.toMatch(/null means no stored text/);
    expect(block).toMatch(/English-only scorer/);
    expect(block).toMatch(/unscored: \{ type: "string"/);
  });
  it("names every reason job-fit sends, the résumé one (no_resume_terms) included", () => {
    const rows = readFileSync(resolve(ROOT, "supabase/functions/job-fit/score-rows.ts"), "utf8");
    const union = /export type UnscoredReason = ([^;]+);/.exec(rows)?.[1] ?? "";
    const reasons = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(reasons).toContain("no_resume_terms");
    const unscored = /unscored: \{ type: "string", description: "([^"]+)" \}/.exec(block)?.[1] ?? "";
    for (const r of reasons) expect(unscored, `fit_resume's unscored description leaves out ${r}`).toContain(r);
  });
});

describe("a row carries job-fit's reason", () => {
  let mcp: KeylessMcp;
  let scorer: Record<string, unknown>;
  beforeEach(async () => {
    mcp = await bootKeylessMcp();
    mcp.answers.api_key_check = { data: { is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: "builder", rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1 }, error: null };
    mcp.board = () => new Response(JSON.stringify({ jobs: [DE, EN], total: 2, hasMore: false }), { status: 200 });
    const inner = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) =>
      String(url).endsWith("/functions/v1/job-fit") ? new Response(JSON.stringify(scorer), { status: 200 }) : inner(url, init)) as typeof fetch;
  });
  const rows = async () => {
    const body = await mcp.rpc("tools/call", { name: "fit_resume", arguments: { resumeText: CV } }, KEY);
    const text = (body.result as { content: Array<{ text: string }> }).content[0].text;
    return (JSON.parse(text) as { jobs: Array<Record<string, unknown>> }).jobs;
  };

  it("unscored rides beside a null fit, and a scored row has none", async () => {
    scorer = { fits: { [DE.id]: null, [EN.id]: 64 }, matched: {}, missing: {}, unscored: { [DE.id]: "no_recognised_terms" } };
    const [de, en] = await rows();
    expect(de).toMatchObject({ id: DE.id, fit: null, unscored: "no_recognised_terms" });
    expect(en).toMatchObject({ id: EN.id, fit: 64 });
    expect(en).not.toHaveProperty("unscored");
  });

  it("a scorer that does not say leaves it out", async () => {
    scorer = { fits: { [DE.id]: null, [EN.id]: 64 }, matched: {}, missing: {} };
    const [de] = await rows();
    expect(de.fit).toBeNull();
    expect(de).not.toHaveProperty("unscored");
  });
});
