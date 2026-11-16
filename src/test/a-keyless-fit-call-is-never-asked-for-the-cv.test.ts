// @vitest-environment node
/**
 * A KEYLESS FIT CALL IS NEVER ASKED FOR THE CV (S14X-263).
 *
 * fit_resume needs a key or a sign-in. The arguments were judged before the
 * credential, so a call with no key and no CV was told "Send {resumeText:
 * '...'} with the whole CV", and the model then sent the CV only to be
 * refused for the key. A keyless call now goes straight to the key or sign-in
 * answer; a keyed call with no CV is still told what to send.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

let mcp: KeylessMcp;
beforeEach(async () => {
  mcp = await bootKeylessMcp();
});

const textOf = (body: Record<string, unknown>) =>
  String(((body.result as { content?: Array<{ text?: string }> } | undefined)?.content?.[0]?.text) ?? JSON.stringify(body));

describe("fit_resume with no credential", () => {
  it("with no CV is told about the key, never to send the whole CV", async () => {
    const out = await mcp.call({}, { name: "fit_resume" });
    expect(out.isError).toBe(true);
    expect(out.text).not.toMatch(/whole CV/i);
    expect(out.text).not.toMatch(/resumeText/);
    expect(out.text).toMatch(/needs a key/);
    expect(out.text).toMatch(/free key/i);
  });

  it("with a short CV is answered the same way, before anything is counted", async () => {
    const out = await mcp.call({ resumeText: "nurse" }, { name: "fit_resume" });
    expect(out.text).not.toMatch(/at least 100 characters/);
    expect(out.text).toMatch(/needs a key/);
    expect(mcp.rpcs.filter((r) => r.name === "mcp_anon_check_v2" || r.name === "api_key_check")).toHaveLength(0);
  });
});

describe("fit_resume with a key", () => {
  it("and no CV is still told what to send, before the key is checked", async () => {
    const body = await mcp.rpc("tools/call", { name: "fit_resume", arguments: {} }, { authorization: "Bearer rb_live_harness_key" });
    expect(textOf(body)).toMatch(/whole CV/);
    expect(mcp.rpcs.filter((r) => r.name === "api_key_check")).toHaveLength(0);
  });
});
