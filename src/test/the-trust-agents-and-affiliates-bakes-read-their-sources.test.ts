/**
 * THE /trust, /agents AND /affiliates BAKES READ THEIR SOURCES.
 *
 *   RC-S13-094/bake  /trust's crawler copy typed "7 free scans a day" while
 *                    the live page reads the scan-allowance module, so a
 *                    change there left the crawler a stale number, and it
 *                    never named the signed-in day.
 *   S14X-259/bake    /agents told every host's reader "calls a day per
 *                    network address" and printed Claude's shared-allowance
 *                    gloss under apps that call from the person's own
 *                    connection; the server counts a connection.
 *   S14X-212/bake    /affiliates promised "any date range you pick" over a
 *                    dashboard whose selector offers four fixed periods.
 *
 * The bake's main needs the live database, so these read the shipped source
 * the way the bake guards beside them do.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FREE_SCANS_PER_DAY, SIGNED_IN_SCANS_PER_DAY } from "@/config/scan-allowance";
import { MCP_ANON_CAPS } from "@/config/mcp-tools";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const BAKE = read("scripts/prerender-seo.mjs");
const section = (from: string, to: string) => {
  const a = BAKE.indexOf(from);
  expect(a, `${from} moved`).toBeGreaterThan(-1);
  return BAKE.slice(a, BAKE.indexOf(to, a + from.length));
};

describe("/trust (RC-S13-094/bake)", () => {
  const trust = section("path: \"/trust\"", "// ---- /agent ----");
  it("prints both scan allowances from the module, with no typed count", () => {
    expect(trust).toContain("${D.SCAN_FREE_PER_DAY} free scans a day (${D.SCAN_SIGNED_IN_PER_DAY} with a free account)");
    expect(BAKE).not.toMatch(/\d+ free scans a day/);
  });
  it("bundles the two names from src/config/scan-allowance", () => {
    expect(BAKE).toMatch(/export \{ FREE_SCANS_PER_DAY as SCAN_FREE_PER_DAY, SIGNED_IN_SCANS_PER_DAY as SCAN_SIGNED_IN_PER_DAY \} from "\.\.\/src\/config\/scan-allowance";/);
    expect([FREE_SCANS_PER_DAY, SIGNED_IN_SCANS_PER_DAY].every((n) => Number.isInteger(n) && n > 0)).toBe(true);
  });
});

describe("/agents (S14X-259/bake)", () => {
  it("names no network address anywhere it describes the free allowance", () => {
    expect(BAKE).not.toMatch(/per network address/);
  });
  it("counts a connection by the server's own figure, in the page and in llms-full", () => {
    // perAddressPerDay is the mirror's old name for the connection's day; the
    // first-call guard pins it to the server's figure, and this holds the two
    // names together so either may be read.
    expect(MCP_ANON_CAPS.perAddressPerDay).toBe(MCP_ANON_CAPS.otherPerConnection);
    const said = /\$\{D\.MCP_ANON_CAPS\.(?:perAddressPerDay|otherPerConnection)\} calls a day for each internet connection an app calls from/;
    const lines = BAKE.split("\n");
    expect(lines.find((l) => l.includes("const unkeyedCaps"))).toMatch(said);
    expect(lines.find((l) => l.includes("lines.push(`- MCP server for AI agents:"))).toMatch(said);
  });
  it("prints a host's own allowance gloss when the host carries one, and the shared gloss otherwise", () => {
    expect(BAKE).toContain("${h(host.allowance ?? D.MCP_ADDRESS_GLOSS)}");
    expect(BAKE).not.toContain("${h(D.MCP_ADDRESS_GLOSS)}");
  });
});

describe("/affiliates (S14X-212/bake)", () => {
  const m = /const AFFILIATE_DASHBOARD_RANGES = "([^"]+)";/.exec(BAKE);
  it("lists exactly the periods the dashboard's selector offers", () => {
    expect(m, "AFFILIATE_DASHBOARD_RANGES moved").toBeTruthy();
    const said = m![1].match(/\d+/g)!.map(Number);
    const offered = [...read("src/pages/Affiliates.tsx").matchAll(/<SelectItem value="(\d+)">/g)].map((x) => Number(x[1]));
    expect(offered.length).toBeGreaterThan(0);
    expect(said).toEqual([...new Set(offered)]);
  });
  it("and promises no range the reader picks", () => {
    expect(BAKE).not.toContain("any date range you pick");
    expect(BAKE).toContain("over the last ${AFFILIATE_DASHBOARD_RANGES}.");
  });
});
