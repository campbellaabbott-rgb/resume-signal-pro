// @vitest-environment node
/**
 * THE GUIDE NAMES ONLY WHAT THE CALLER IS OFFERED (connect W3, BR-18).
 *
 * Live 2026-11-07: the keyless guide's "Prompts and resources" line named
 * the prompt what_can_my_key_do and the resource resumebooster://me/key, while
 * prompts/list and resources/list offer neither to a caller with no
 * credential, so a model offered the person a step that could not be taken.
 * The line is now built from the same predicate the two listings apply.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

type Read = { result: { contents: Array<{ text: string }> } };
const linesOf = (r: Read) => r.result.contents[0].text.split("\n");
const promptsLine = (r: Read) => linesOf(r).find((l) => l.startsWith("Prompts: "))!;

describe("the guide's prompts and resources are the caller's own lists", () => {
  let mcp: KeylessMcp;
  beforeAll(async () => { mcp = await bootKeylessMcp(); }, 120_000);

  it("with no credential: every prompt and resource the listings offer, and nothing they do not", async () => {
    const guide = await mcp.rpc("resources/read", { uri: "resumebooster://guide" }) as Read;
    const line = promptsLine(guide);
    const prompts = (await mcp.rpc("prompts/list") as { result: { prompts: Array<{ name: string }> } }).result.prompts.map((p) => p.name);
    const resources = (await mcp.rpc("resources/list") as { result: { resources: Array<{ uri: string }> } }).result.resources.map((r) => r.uri);
    expect(prompts).not.toContain("what_can_my_key_do");
    expect(resources).not.toContain("resumebooster://me/key");
    expect(line).not.toMatch(/what_can_my_key_do/);
    expect(line).not.toMatch(/resumebooster:\/\/me\/key/);
    for (const p of prompts) expect(line).toContain(`\`${p}\``);
    for (const r of resources) expect(line).toContain(`\`${r}\``);
  });

  it("with a credential: the key's own prompt and resource are named", async () => {
    const guide = await mcp.rpc("resources/read", { uri: "resumebooster://guide" }, { authorization: "Bearer rb_live_harness" }) as Read;
    const line = promptsLine(guide);
    expect(line).toMatch(/`what_can_my_key_do`/);
    expect(line).toMatch(/`resumebooster:\/\/me\/key`/);
  });
});
