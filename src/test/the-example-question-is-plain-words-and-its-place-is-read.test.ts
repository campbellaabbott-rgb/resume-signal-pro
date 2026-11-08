/**
 * THE FIRST QUESTION IS PLAIN WORDS, AND ITS PLACE IS READ (CJ-09, 2026-11-07).
 *
 * Every chat tile told a seeker to type "Using Resume Booster, call
 * search_jobs with query … and location …": a function call, written that
 * way because the server once read a place inside the query as words of the
 * title. agent-mcp now moves a trailing "in <known place>" to the location
 * itself (query-place.ts), so the plain sentence finds what the arguments
 * found. Pinned by behaviour: the sentence names no tool and no argument, and
 * the server's own reader, run on the words the sentence asks for, moves the
 * place out of the title words. The Claude tile also names the ready-made
 * prompt the server lists, by the name the mirror carries for it.
 */
import { describe, expect, it } from "vitest";
import {
  MCP_CONNECTOR_NAME, MCP_EXAMPLE_QUESTION, MCP_HOSTS, MCP_PROMPTS, MCP_TEST_QUERY, MCP_TOOL_NAMES,
} from "../config/mcp-tools";
import { readQuery } from "../../supabase/functions/agent-mcp/query-place";

/** The search the sentence asks for, as an AI hands it on: "<what> jobs in <where>". */
const asked = (q: string) => /\b([a-z][\w-]*(?: [\w-]+)*? jobs in [A-Z][\w ]*?)(?= with | and |[.?!]|$)/.exec(q)?.[1] ?? null;

describe("the first question every page suggests", () => {
  it("is a sentence a person types: no tool name, no argument name, no quoted arguments", () => {
    for (const n of MCP_TOOL_NAMES) expect(MCP_EXAMPLE_QUESTION, `names the tool ${n}`).not.toMatch(new RegExp(`\\b${n}\\b`));
    expect(MCP_EXAMPLE_QUESTION).not.toMatch(/\bcall\b|\bquery\b|\blocation\b|"/);
    expect(MCP_EXAMPLE_QUESTION).toContain(MCP_CONNECTOR_NAME);
    expect(MCP_EXAMPLE_QUESTION).toContain(MCP_TEST_QUERY);
  });

  it("the server's own reader moves its place out of the title words, so the plain sentence searches where it says", () => {
    const words = asked(MCP_EXAMPLE_QUESTION);
    expect(words, "the sentence asks for no '<what> jobs in <where>' search").not.toBeNull();
    const r = readQuery(words!);
    expect(r.location).toBe("Texas");
    expect(r.query).toBe(MCP_TEST_QUERY);
  });

  it("teeth: a sentence with the place where the reader does not look leaves it in the title words", () => {
    // "Texas nurse jobs" puts the place first; the reader moves only a
    // trailing "in <place>", so this wording would search titles for Texas.
    const r = readQuery(`Texas ${MCP_TEST_QUERY} jobs`);
    expect(r.location).toBeUndefined();
    expect(asked(`Find Texas ${MCP_TEST_QUERY} jobs with ${MCP_CONNECTOR_NAME}.`)).toBeNull();
  });

  it("the Claude tile also names the ready-made prompt the server lists, by the mirror's title for it", () => {
    const browse = MCP_PROMPTS.find((p) => p.name === "browse_jobs");
    expect(browse, "the mirror lists no browse_jobs prompt").toBeTruthy();
    const claude = MCP_HOSTS.find((h) => h.id === "claude")!;
    const ask = claude.steps({ url: "https://example.invalid/functions/v1/agent-mcp" }).find((s) => s.copy === MCP_EXAMPLE_QUESTION)!;
    expect(ask.note).toMatch(new RegExp(`\\*\\*${MCP_CONNECTOR_NAME}\\*\\*, then \\*\\*Browse jobs\\*\\*`));
    expect(browse!.title.toLowerCase()).toContain("browse jobs");
  });
});
