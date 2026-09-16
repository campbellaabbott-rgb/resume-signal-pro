import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { MCP_ANON_CAPS, MCP_ANON_TOOL_NAMES, MCP_FREE_KEY_DAILY_QUOTA, MCP_TOOLS } from "../config/mcp-tools";

/**
 * THE INSTALL FILES POINT AT THIS SERVER.
 *
 * The distribution repo (resumebooster-mcp, PLAN item 6) generates every
 * install file — .mcp.json, server.json, the plugin manifests, the README —
 * from one constants file that MIRRORS this repo's src/config/mcp-tools.ts
 * and .env. The other repo's own test reads this repo and fails on drift;
 * this file is the same check from this side, so a change here that the
 * mirror has not followed is caught in whichever repo runs its tests next
 * (PLAN item 6 "First step": a vitest that the remote URL equals MCP_URL —
 * the URL, never the version).
 *
 * The sibling is found beside this checkout (or at RESUMEBOOSTER_MCP_DIR).
 * When it is absent the file skips with a reason: a missing sibling is not
 * drift, and the other repo's CI checks this one out to run the reverse.
 */
const ROOT = resolve(__dirname, "../..");
const SIBLING = process.env.RESUMEBOOSTER_MCP_DIR ?? resolve(ROOT, "..", "resumebooster-mcp");
const present = existsSync(resolve(SIBLING, "mcp.config.json"));
const readJson = (rel: string) => JSON.parse(readFileSync(resolve(SIBLING, rel), "utf8"));

const mcpUrl = (): string => {
  const env = readFileSync(resolve(ROOT, ".env"), "utf8");
  const base = /^VITE_SUPABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
  if (!base) throw new Error("VITE_SUPABASE_URL is not in .env — RE-ANCHOR this guard");
  return `${base}/functions/v1/agent-mcp`;
};

describe.skipIf(!present)(`the distribution repo beside this one (${SIBLING}) mirrors this server`, () => {
  it("every install file's URL is this project's agent-mcp (the URL, never the version)", () => {
    const url = mcpUrl();
    const c = readJson("mcp.config.json");
    expect(c.mcpUrl).toBe(url);
    const mcp = readJson(".mcp.json");
    expect(Object.keys(mcp.mcpServers)).toEqual([c.serverName]);
    expect(mcp.mcpServers[c.serverName].url).toBe(url);
    const server = readJson("server.json");
    expect(server.remotes.map((r: { url: string }) => r.url)).toEqual([url]);
    expect(server.version).not.toBe(/version: "([^"]+)"/.exec(readFileSync(resolve(ROOT, "supabase/functions/agent-mcp/index.ts"), "utf8"))?.[1]);
  });

  it("its tool list, tiers, unkeyed tier, caps and quota are this repo's mirror", () => {
    const c = readJson("mcp.config.json");
    expect(c.tools).toEqual(MCP_TOOLS.map(({ name, tier }) => ({ name, tier })));
    expect(c.anonTools).toEqual([...MCP_ANON_TOOL_NAMES]);
    expect(c.anonCaps).toEqual({ ...MCP_ANON_CAPS });
    expect(c.freeKeyDailyQuota).toBe(MCP_FREE_KEY_DAILY_QUOTA);
  });

  it("the retention its privacy paragraph states is mcp_anon_check's own prune", () => {
    const c = readJson("mcp.config.json");
    const dir = resolve(ROOT, "supabase/migrations");
    const defining = readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()
      .filter((n) => readFileSync(resolve(dir, n), "utf8").includes("FUNCTION public.mcp_anon_check("));
    expect(defining.length).toBeGreaterThan(0);
    const sql = readFileSync(resolve(dir, defining[defining.length - 1]), "utf8").replace(/--[^\n]*/g, "");
    const prune = /DELETE FROM public\.mcp_anon_rate r WHERE r\.day < v_today - (\d+);/.exec(sql);
    expect(prune, "mcp_anon_check's prune statement — RE-ANCHOR").toBeTruthy();
    expect(c.anonAddressHashRetentionDays).toBe(Number(prune![1]));
  });

  it("no install file carries a key, and the header form reads the environment", () => {
    const mcp = readJson(".mcp.json");
    const c = readJson("mcp.config.json");
    expect(JSON.stringify(mcp)).not.toMatch(/rb_live_[A-Za-z0-9]{8,}/);
    expect(mcp.mcpServers[c.serverName].headers).toEqual({ Authorization: `Bearer \${${c.keyEnvVar}:-}` });
  });
});
