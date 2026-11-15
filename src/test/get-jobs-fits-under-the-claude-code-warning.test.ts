// @vitest-environment node
/**
 * GET_JOBS FITS UNDER THE CLAUDE CODE WARNING (connect W3, BR-11).
 *
 * Live 2026-11-07: get_jobs on ten ids answered a 96,106-byte result whose
 * text held 47,343 characters (about 12,000 tokens), over the 10,000-token
 * size Claude Code warns about for a tool result; each description was cut to
 * about 4,135 characters from its top, wherever its requirements sat. Now:
 *   - more than three ids answer with cards only unless includeDescription is
 *     true, and descriptionsOmitted says how to get them;
 *   - asked for, ten descriptions share 15,000 characters in all;
 *   - a description that has to be cut leads with its requirements section.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const PITCH = "We are a fast-growing company on a mission. ".repeat(70);
const NEEDS = "Requirements:\n- Five years of Go\n- On call one week in six\n";
const DESCRIPTION = `${PITCH}\n${NEEDS}${"Benefits and more about us. ".repeat(200)}`;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `greenhouse:acme${i}:${100000 + i}`);
const descTotal = (out: { jobs: Array<{ description?: string }> }) => out.jobs.reduce((n, c) => n + (c.description?.length ?? 0), 0);

describe("get_jobs answers within what a model reads", () => {
  let mcp: KeylessMcp;
  beforeAll(async () => {
    mcp = await bootKeylessMcp();
    mcp.board = (body) => new Response(JSON.stringify({
      job: { id: body.id, source: "greenhouse", title: "Backend Engineer", company: "Acme" },
      description: DESCRIPTION,
    }), { status: 200 });
  }, 120_000);

  it("ten ids by default: cards only, and descriptionsOmitted says how to read them", async () => {
    const out = JSON.parse((await mcp.call({ ids: ids(10) }, { name: "get_jobs" })).text);
    expect(out.returned).toBe(10);
    expect(descTotal(out)).toBe(0);
    expect(out.descriptionsOmitted).toMatch(/includeDescription:true/);
    expect(out.descriptionsOmitted).toMatch(/15,000 characters/);
  });

  it("three ids by default: their descriptions, within the budget", async () => {
    const out = JSON.parse((await mcp.call({ ids: ids(3) }, { name: "get_jobs" })).text);
    expect(out.jobs.every((c: { description?: string }) => typeof c.description === "string" && c.description.length > 0)).toBe(true);
    expect(descTotal(out)).toBeLessThanOrEqual(15_000);
    expect(out.descriptionsOmitted).toBeUndefined();
  });

  it("ten ids with includeDescription:true share 15,000 characters, each cut leading with its requirements", async () => {
    const out = JSON.parse((await mcp.call({ ids: ids(10), includeDescription: true }, { name: "get_jobs" })).text);
    expect(DESCRIPTION.length).toBeGreaterThan(8_000);
    expect(descTotal(out)).toBeLessThanOrEqual(15_000);
    expect(out.truncatedForSize).toBe(true);
    for (const c of out.jobs as Array<{ description: string }>) {
      expect(c.description.startsWith("Requirements:")).toBe(true);
      expect(c.description).toMatch(/Five years of Go/);
      expect(c.description).toMatch(/call get_job with this id for the whole description/);
    }
  });

  it("includeDescription:false on a short list is honoured", async () => {
    const out = JSON.parse((await mcp.call({ ids: ids(2), includeDescription: false }, { name: "get_jobs" })).text);
    expect(descTotal(out)).toBe(0);
  });
});
