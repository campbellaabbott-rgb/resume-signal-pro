import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MCP_TOOLS, MCP_HOSTS } from "../config/mcp-tools";
import { SENDABLE_VENDOR_KEYS, SENDABLE_VENDOR_LABELS } from "../config/sendable-vendors";

/**
 * THE /agents PAGE DESCRIBED A SERVER THAT DID NOT EXIST.
 *
 * Measured 2026-09-15: the MCP server registered eleven tools and answered
 * tools/list with all eleven; the page that tells a human what to connect to
 * listed six under a heading that said so. Five tools — get_jobs,
 * check_jobs_open, fit_resume, key_status, debug_search — were invisible on the
 * one page a person reads before deciding to mint a key. The same page called
 * board_stats' second figure an employer count where the server's own basis
 * line says it is a count of boards, told claude.ai and ChatGPT users to enter
 * a header their dialogs have no field for, and stated a corpus figure as a
 * literal that the board had already outgrown.
 *
 * None of it was invented. Every sentence was true when it was written and
 * went false when the server moved — the claim-drift shape this repo has now
 * recorded five times. The fix is never a careful re-read; it is one mirror
 * constant that every surface renders from, plus this file, which reads the
 * OTHER runtime's source and fails on drift.
 *
 * Everything asserted here is a PROPERTY read off comment-stripped code: the
 * names the server registers, the gates its dispatch applies, the keys its
 * stats runner returns, the vendor list the apply pipeline obeys. Nothing pins
 * a spelling in prose, so a comment that discusses the defect cannot fail it.
 */
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
// Line comments first: a line comment containing `/*` (a path glob) would
// otherwise open a block that the block strip runs to the next `*/`.
const strip = (s: string) =>
  s.replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");

const MCP = strip(read("supabase/functions/agent-mcp/index.ts"));
const PAGE = strip(read("src/pages/AgentConnect.tsx"));
const PRERENDER = strip(read("scripts/prerender-seo.mjs"));
const APPLY = strip(read("supabase/functions/_shared/apply-automation.ts"));

const between = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  expect(a, `anchor "${from}" present`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(to, a + 1);
  expect(b, `anchor "${to}" after "${from}"`).toBeGreaterThan(a);
  return src.slice(a, b);
};

/** The names the server registers, in registration order. */
const TOOLS_SRC = between(MCP, "const TOOLS = [", "\n];");
const SERVER_NAMES = [...TOOLS_SRC.matchAll(/\n    name: "([a-z_]+)",/g)].map((m) => m[1]);
const serverBlock = (name: string) => {
  const marks = [...TOOLS_SRC.matchAll(/\n    name: "([a-z_]+)",/g)];
  const i = marks.findIndex((m) => m[1] === name);
  expect(i, `server registers ${name}`).toBeGreaterThanOrEqual(0);
  const start = marks[i].index ?? 0;
  const end = i + 1 < marks.length ? (marks[i + 1].index ?? TOOLS_SRC.length) : TOOLS_SRC.length;
  return TOOLS_SRC.slice(start, end);
};

/**
 * The gates the dispatch applies, read off the switch: a case whose body
 * calls the paid-tier check is paid; a case whose runner refuses a key with
 * no owner is account-linked. Everything else answers any key.
 */
const DISPATCH = between(MCP, "switch (name) {", "\n    default:");
const caseChunk = (name: string): string => {
  const marks = [...DISPATCH.matchAll(/case "([a-z_]+)":/g)];
  const i = marks.findIndex((m) => m[1] === name);
  if (i >= 0) {
    const start = marks[i].index ?? 0;
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? DISPATCH.length) : DISPATCH.length;
    return DISPATCH.slice(start, end);
  }
  // Not every tool is dispatched from the switch: one is answered beside it
  // (it reports the very decision the call was allowed by). Its call site is
  // still the name followed by its runner, so read that instead.
  const site = new RegExp(`"${name}"[\\s\\S]{0,160}?await run[A-Za-z]+\\(`).exec(MCP);
  expect(site, `a call site for ${name}`).toBeTruthy();
  return site![0];
};
const runnerBody = (fnName: string) => {
  const m = new RegExp(`async function ${fnName}\\(`).exec(MCP);
  expect(m, `runner ${fnName} is declared`).toBeTruthy();
  const start = m!.index;
  const next = /\n(?:async )?function /g;
  next.lastIndex = start + 1;
  const n = next.exec(MCP);
  return MCP.slice(start, n ? n.index : MCP.length);
};
const serverTier = (name: string): "read" | "paid" | "apply" => {
  const chunk = caseChunk(name);
  if (/isPaidTier\(/.test(chunk)) return "paid";
  const runner = /await (run[A-Za-z]+)\(/.exec(chunk)?.[1];
  if (!runner) return "read";
  const body = runnerBody(runner);
  // Refuses a key that is not linked to an account: reads the owner and
  // returns on null. key_status also reads the owner but reports it instead
  // of refusing, and that difference is the whole point of the tier.
  return /keyOwner\(/.test(body) && /if \(!userId\) \{\s*return/.test(body) ? "apply" : "read";
};

describe("the page says six and the server says eleven", () => {
  it("the server registers a non-trivial tool list (an empty match would pass every comparison vacuously)", () => {
    expect(SERVER_NAMES.length).toBeGreaterThan(5);
    expect(new Set(SERVER_NAMES).size, "duplicate registrations").toBe(SERVER_NAMES.length);
  });

  it("the mirror names exactly the tools the server registers", () => {
    const mirror = MCP_TOOLS.map((t) => t.name);
    const missingFromMirror = SERVER_NAMES.filter((n) => !mirror.includes(n));
    const extraOnMirror = mirror.filter((n) => !SERVER_NAMES.includes(n));
    expect(
      { missingFromMirror, extraOnMirror },
      `src/config/mcp-tools.ts lists ${mirror.length} tools; supabase/functions/agent-mcp/index.ts registers ${SERVER_NAMES.length}`,
    ).toEqual({ missingFromMirror: [], extraOnMirror: [] });
    expect(mirror.length).toBe(SERVER_NAMES.length);
  });

  it("the mirror's tier is the gate the server's dispatch actually applies", () => {
    for (const t of MCP_TOOLS) {
      expect(serverTier(t.name), `${t.name}: mirror says ${t.tier}`).toBe(t.tier);
    }
  });

  it("the tier split is non-trivial on both sides", () => {
    // A dispatch that lost its paid gate or its owner refusal would classify
    // everything as read, and a mirror that said the same would agree with it.
    // Both sides must show all three tiers, or the comparison above is moot.
    for (const tier of ["read", "paid", "apply"] as const) {
      expect(MCP_TOOLS.some((t) => t.tier === tier), `mirror has a ${tier} tool`).toBe(true);
      expect(SERVER_NAMES.some((n) => serverTier(n) === tier), `server has a ${tier} tool`).toBe(true);
    }
  });

  it("the page renders its tool list from the mirror and spells no count", () => {
    expect(PAGE, "AgentConnect.tsx must import the mirror").toMatch(/from "@\/config\/mcp-tools"/);
    expect(PAGE, "the tool section must map over MCP_TOOLS").toMatch(/MCP_TOOLS\.map\(/);
    expect(PAGE, "the count must be read off the constant").toMatch(/MCP_TOOLS\.length/);
    // No local tool table: one list, or the page and the server drift again.
    expect(PAGE).not.toMatch(/const TOOLS\b/);
    // "The six tools", "eleven tools", "11 tools" — a spelled count is the
    // defect. Number words and digits directly before "tools" are refused.
    const spelled = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|\d+)\s+tools\b/i.exec(PAGE);
    expect(spelled?.[0], "a spelled tool count on the page").toBeUndefined();
    // Every registered name reaches the page through the mirror, so the page
    // source itself need not spell one — and if it does, it is a second list.
    const inline = SERVER_NAMES.filter((n) => new RegExp(`name: "${n}"`).test(PAGE));
    expect(inline, "tool entries declared inline on the page instead of the mirror").toEqual([]);
  });

  it("the host table names both kinds of host, and the page renders it", () => {
    expect(MCP_HOSTS.some((h) => h.header)).toBe(true);
    expect(MCP_HOSTS.some((h) => !h.header)).toBe(true);
    expect(PAGE).toMatch(/MCP_HOSTS\.map\(/);
    // The sentence the refuter caught: both named clients "configure the
    // Authorization header in their own UI". Neither can, and the page must
    // not say either can — the property is the host table's `header` flag.
    for (const h of MCP_HOSTS.filter((x) => !x.header)) {
      expect(h.how, `${h.name} is marked header:false but its note does not say why`).toMatch(/OAuth|beta|no field/i);
    }
  });

  it("board_stats is described as a count of boards on both sides, matching what the runner returns", () => {
    const runner = runnerBody("runBoardStats");
    // The runner's second figure is named as boards, and no returned key
    // claims employers. This is the property the descriptions must follow.
    expect(runner).toMatch(/openCompanyBoards:/);
    expect(runner).not.toMatch(/^\s*employers?:/m);
    const server = serverBlock("board_stats");
    const mirror = MCP_TOOLS.find((t) => t.name === "board_stats")!.body;
    for (const [where, text] of [["server description", server], ["mirror body", mirror]] as const) {
      expect(text, `${where} must say boards`).toMatch(/boards/i);
      expect(text, `${where} calls the board count an employer count`).not.toMatch(/employer count/i);
    }
  });

  it("no corpus count is spelled on the page, in the server's tool descriptions, or in the mirror", () => {
    // "700k+", "700,000+", "790,686" — a number that is true on the day it is
    // typed and false on its own schedule. Derived from the board or absent.
    const literal = /\b\d{3}k\+|\b\d{3},\d{3}\+?/;
    expect(literal.exec(PAGE)?.[0], "AgentConnect.tsx spells a corpus count").toBeUndefined();
    expect(literal.exec(TOOLS_SRC)?.[0], "a tool description spells a corpus count").toBeUndefined();
    for (const t of MCP_TOOLS) expect(literal.exec(t.body)?.[0], `${t.name} mirror body spells a count`).toBeUndefined();
    // The page states the figure the way the homepage does — from the live
    // board, with count-free copy when the read fails.
    expect(PAGE).toMatch(/useBoardTotals\(\)/);
    expect(PAGE).toMatch(/roundedFloor\(/);
  });

  it("the sendable-vendor mirror equals the Deno list the apply pipeline obeys", () => {
    const m = /export const SENDABLE_VENDORS[^=]*=\s*\[([^\]]*)\]/.exec(APPLY);
    expect(m, "SENDABLE_VENDORS is no longer a literal array").toBeTruthy();
    const deno = [...m![1].matchAll(/"([a-z0-9_-]+)"/g)].map((x) => x[1]).sort();
    expect(deno.length, "the extractor matched nothing").toBeGreaterThan(0);
    expect([...SENDABLE_VENDOR_KEYS].sort()).toEqual(deno);
    expect(SENDABLE_VENDOR_LABELS.length).toBe(deno.length);
  });

  it("the page names the sendable vendors from the mirror and spells neither the names nor their count", () => {
    expect(PAGE).toMatch(/from "@\/config\/sendable-vendors"/);
    expect(PAGE).toMatch(/SENDABLE_VENDOR_(?:SENTENCE|LABELS)/);
    expect(PAGE).toMatch(/SENDABLE_VENDOR_(?:KEYS|LABELS)\.length/);
    const spelledName = SENDABLE_VENDOR_LABELS.filter((label) => new RegExp(`\\b${label}\\b`).test(PAGE));
    expect(spelledName, "vendor names spelled on the page instead of rendered from the mirror").toEqual([]);
    expect(/\b(?:four|five|six|seven|\d+) hiring systems\b/i.exec(PAGE)?.[0], "a spelled vendor count").toBeUndefined();
  });

  it("the crawler-facing copy is baked from the same mirrors", () => {
    // The prerender bundles src modules for Node; the /agents page it writes
    // must render the tool list and the vendor list from the constants, not
    // from a second copy typed into the script.
    expect(PRERENDER).toMatch(/path: "\/agents"/);
    expect(PRERENDER).toMatch(/D\.MCP_TOOLS/);
    expect(PRERENDER).toMatch(/D\.SENDABLE_VENDOR_(?:SENTENCE|LABELS)/);
    expect(PRERENDER).toMatch(/D\.MCP_HOSTS/);
    expect(/\b\d{3}k\+/.exec(PRERENDER)?.[0], "prerender spells a corpus count").toBeUndefined();
    // The 2026-08-27 incident, one page over: /agent's crawler copy said
    // "four hiring systems" while the Deno list held five. Every vendor count
    // in the script is rendered from the mirror or absent.
    expect(/\b(?:four|five|six|seven|\d+) hiring systems\b/i.exec(PRERENDER)?.[0], "prerender spells a vendor count").toBeUndefined();
  });
});
