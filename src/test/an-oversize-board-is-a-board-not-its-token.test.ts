import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { codeOf } from "./helpers/strip-comments";
import {
  clearOversize,
  heldOversize,
  loadOversizeEntries,
  noteOversize,
  oversizeStatusRows,
  oversizeTokens,
  type OversizeEntry,
} from "../../supabase/functions/job-board/oversize-registry.ts";
import { classifyStale, staleExclusion, type StaleContext, type StaleRow } from "../../supabase/functions/job-board/stale-lane.ts";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources.ts";

/**
 * AN OVERSIZE BOARD IS A BOARD, NOT ITS TOKEN (job-board .90, F2).
 *
 * The oversize registry (meta oversize_boards) was keyed by bare token. 139
 * tokens are carried by two or three vendors, and on those a twin's read
 * reached the other board's entry:
 *
 *   - lush is greenhouse AND personio. greenhouse:lush was oversize; every
 *     personio:lush read deleted the "lush" entry, so the freshness sweep's
 *     closure-log protection for greenhouse:lush switched off until its next
 *     oversize visit.
 *   - pulse is greenhouse AND ashby. Its entry vanished from status from
 *     00:45 to 01:32Z on 2026-10-06 as ashby:pulse read, and came back when
 *     greenhouse:pulse failed again.
 *
 * The registry is now keyed the way board_failures is since .89 (n417): the
 * bare token, or `source:token` on a shared token. Every other key stays the
 * bare token. A row an older build wrote by bare token is re-keyed on load
 * by its stored source, so no currently registered board loses the
 * protection across the deploy. The stale lane and status still speak tokens.
 *
 * The first block runs the pure module; the second runs index.ts's own code
 * (lifted and transpiled) so the wiring is proven by what it does.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const CODE = codeOf(FN);

const SHARED = new Set(["pulse", "lush", "samsara"]);
const ghPulse = { source: "greenhouse", token: "pulse" };
const ashbyPulse = { source: "ashby", token: "pulse" };
const ghLush = { source: "greenhouse", token: "lush" };
const personioLush = { source: "personio", token: "lush" };
const bigco = { source: "teamtailor", token: "bigco" };

describe("the registry module keys by board", () => {
  it("a twin's successful read leaves the other board's entry in place", () => {
    const reg = new Map<string, OversizeEntry>();
    noteOversize(reg, ghPulse, 20.6, SHARED);
    noteOversize(reg, ghLush, 9.1, SHARED);
    expect(clearOversize(reg, ashbyPulse, SHARED), "ashby:pulse read; it never was oversize").toBe(false);
    expect(clearOversize(reg, personioLush, SHARED), "personio:lush read; it never was oversize").toBe(false);
    expect([...reg.keys()].sort()).toEqual(["greenhouse:lush", "greenhouse:pulse"]);
    expect(clearOversize(reg, ghPulse, SHARED), "the oversize board itself read").toBe(true);
    expect([...reg.keys()]).toEqual(["greenhouse:lush"]);
  });

  it("every board on an unshared token keeps its bare-token key", () => {
    const reg = new Map<string, OversizeEntry>();
    noteOversize(reg, bigco, 15, SHARED);
    expect([...reg.keys()]).toEqual(["bigco"]);
    expect(clearOversize(reg, bigco, SHARED)).toBe(true);
    expect(reg.size).toBe(0);
  });

  it("a recorded visit is dirty only on a new board, a moved size or a 12h-old stamp, and re-inserts newest last", () => {
    const reg = new Map<string, OversizeEntry>();
    const t0 = Date.parse("2026-10-06T00:00:00Z");
    expect(noteOversize(reg, ghPulse, 20.6, SHARED, t0)).toBe(true);
    expect(noteOversize(reg, bigco, 15, SHARED, t0)).toBe(true);
    expect(noteOversize(reg, ghPulse, 20.65, SHARED, t0 + 3_600_000), "same size an hour later").toBe(false);
    expect([...reg.keys()], "the board just seen moves to the end, so the cap drops the oldest").toEqual(["bigco", "greenhouse:pulse"]);
    expect(noteOversize(reg, ghPulse, 21, SHARED, t0 + 2 * 3_600_000), "size moved").toBe(true);
    expect(noteOversize(reg, ghPulse, 21, SHARED, t0 + 15 * 3_600_000), "stamp 13h old").toBe(true);
    expect(reg.get("greenhouse:pulse")).toEqual({ source: "greenhouse", mb: 21, at: new Date(t0 + 15 * 3_600_000).toISOString() });
    expect(noteOversize(reg, ashbyPulse, 13.6, SHARED, t0), "the twin is a new board, not a size change on the first").toBe(true);
    expect(reg.get("greenhouse:pulse")?.mb).toBe(21);
  });

  it("a row written by bare token converts by its stored source; keyed and unshared entries are unchanged", () => {
    const reg = new Map<string, OversizeEntry>();
    loadOversizeEntries(reg, {
      pulse: { source: "greenhouse", mb: 20.6, at: "2026-10-06T01:32:43Z" },
      bigco: { source: "teamtailor", mb: 15, at: "2026-10-05T00:00:00Z" },
      "greenhouse:lush": { source: "greenhouse", mb: 9.1, at: "2026-10-05T23:15:13Z" },
      broken: null,
    }, SHARED);
    expect([...reg.keys()]).toEqual(["greenhouse:pulse", "bigco", "greenhouse:lush"]);
    expect(reg.get("greenhouse:pulse")).toEqual({ source: "greenhouse", mb: 20.6, at: "2026-10-06T01:32:43Z" });
    // The same board under both spellings (an older isolate wrote after a newer one) is one entry, the later kept.
    loadOversizeEntries(reg, { "greenhouse:pulse": { source: "greenhouse", mb: 1, at: "a" }, pulse: { source: "greenhouse", mb: 2, at: "b" } }, SHARED);
    expect([...reg.entries()]).toEqual([["greenhouse:pulse", { source: "greenhouse", mb: 2, at: "b" }]]);
    loadOversizeEntries(reg, null, SHARED);
    expect(reg.size).toBe(0);
  });

  it("an aged posting is held by its own board's entry, not by its token's twin", () => {
    const reg = new Map<string, OversizeEntry>();
    noteOversize(reg, ghPulse, 20.6, SHARED);
    noteOversize(reg, bigco, 15, SHARED);
    expect(heldOversize(reg, { source: "greenhouse", company_token: "pulse" }, SHARED)).toBe(true);
    expect(heldOversize(reg, { source: "ashby", company_token: "pulse" }, SHARED)).toBe(false);
    expect(heldOversize(reg, { source: "teamtailor", company_token: "bigco" }, SHARED)).toBe(true);
    expect(heldOversize(reg, { source: "lever", company_token: "acme" }, SHARED)).toBe(false);
  });

  it("the stale lane still gets tokens: the exclusion and the classifier see `pulse`, once", () => {
    const reg = new Map<string, OversizeEntry>();
    noteOversize(reg, ghPulse, 20.6, SHARED);
    noteOversize(reg, ashbyPulse, 13.6, SHARED);
    noteOversize(reg, bigco, 15, SHARED);
    expect(oversizeTokens(reg)).toEqual(["pulse", "bigco"]);
    const ex = staleExclusion({ oversize: oversizeTokens(reg), tries: new Map() });
    expect(ex).toContain("pulse");
    expect(ex.filter((t) => t.includes(":")), "p_exclude takes tokens").toEqual([]);
  });

  it("status rows carry the bare token the verifiers filter on, and the board key", () => {
    const rows = oversizeStatusRows({
      "greenhouse:pulse": { source: "greenhouse", mb: 20.6, at: "x" },
      bigco: { source: "teamtailor", mb: 15, at: "y" },
      lush: { source: "greenhouse", mb: 30, at: "z" },
    });
    expect(rows).toEqual([
      { token: "lush", key: "lush", source: "greenhouse", mb: 30, at: "z" },
      { token: "pulse", key: "greenhouse:pulse", source: "greenhouse", mb: 20.6, at: "x" },
      { token: "bigco", key: "bigco", source: "teamtailor", mb: 15, at: "y" },
    ]);
    const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`t${i}`, { source: "lever", mb: i, at: "" }]));
    expect(oversizeStatusRows(many)).toHaveLength(50);
    expect(oversizeStatusRows(undefined)).toEqual([]);
  });
});

// ── index.ts's own code ─────────────────────────────────────────────────────

const transpile = (src: string) =>
  ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
/** Run `body` (TypeScript) as a function body with `scope` bound by name. */
function run<T>(body: string, scope: Record<string, unknown>): T {
  const names = Object.keys(scope);
  return new Function(...names, `${transpile(`function __shipped() {\n${body}\n}`)}\nreturn __shipped();`)(...names.map((n) => scope[n])) as T;
}
const MODULE = { clearOversize, heldOversize, loadOversizeEntries, noteOversize, oversizeStatusRows, oversizeTokens };

/** One top-level function of index.ts. */
function lifted(name: string): string {
  const at = FN.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  expect(at, `${name} not found in job-board/index.ts`).toBeGreaterThan(0);
  return FN.slice(at, FN.indexOf("\n}\n", at) + 2);
}
/** index.ts's SHARED_TOKENS, computed by its own code over the shipped catalogue. */
const SHIPPED_SHARED = (() => {
  const m = /^const SHARED_TOKENS: ReadonlySet<string> = (\(\(\) => \{[\s\S]*?\n\}\)\(\));$/m.exec(FN);
  expect(m, "SHARED_TOKENS not found in job-board/index.ts").toBeTruthy();
  return run<ReadonlySet<string>>(`return ${m![1]};`, { JOB_SOURCES });
})();
/** The lines of CODE between two landmarks that touch the registry, in order. */
function registryLines(from: string, to: string): string[] {
  const a = CODE.indexOf(from);
  expect(a, `landmark not found: ${from}`).toBeGreaterThan(0);
  const b = CODE.indexOf(to, a + from.length);
  expect(b, `landmark not found after ${from}: ${to}`).toBeGreaterThan(a);
  const lines = CODE.slice(a, b).split("\n").filter((l) => l.includes("OVERSIZE_BOARDS"));
  expect(lines.length, `nothing between ${from} and ${to} touches the registry`).toBeGreaterThan(0);
  return lines;
}
/** The expression after `prop:` in CODE (from the first match at or after `from`), up to its closing comma. */
function propertyExpr(prop: string, from = 0): string {
  const at = CODE.indexOf(`${prop}:`, from);
  expect(at, `${prop} not found`).toBeGreaterThan(0);
  let depth = 0;
  let quote = "";
  for (let j = at + prop.length + 1; j < CODE.length; j++) {
    const c = CODE[j];
    if (quote) { if (c === quote && CODE[j - 1] !== "\\") quote = ""; continue; }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) return CODE.slice(at + prop.length + 1, j).trim();
  }
  throw new Error(`unterminated ${prop}`);
}

/** The oversize branch's registry statements, run for `board`; returns whether they marked the row dirty. */
function recordOversizeVisit(reg: Map<string, OversizeEntry>, board: { source: string; token: string }, mb: number): boolean {
  const lines = registryLines('if (failReason.startsWith("oversize"))', "budgetSkipped.push(s.token);");
  return run<boolean>(`let oversizeDirty = false;\n${lines.join("\n")}\nreturn oversizeDirty;`, {
    ...MODULE, OVERSIZE_BOARDS: reg, SHARED_TOKENS: SHIPPED_SHARED, s: board, mb,
  });
}
/** The success path's registry statements, run for `board`. */
function recordRead(reg: Map<string, OversizeEntry>, board: { source: string; token: string }): boolean {
  const lines = registryLines("okKeys.push(boardKeyOf(s));", "try {");
  return run<boolean>(`let oversizeDirty = false;\n${lines.join("\n")}\nreturn oversizeDirty;`, {
    ...MODULE, OVERSIZE_BOARDS: reg, SHARED_TOKENS: SHIPPED_SHARED, s: board,
  });
}

/** loadOversizeBoards, readMetaRow and META_READ, lifted, against a meta row. */
async function loadShipped(reg: Map<string, OversizeEntry>, boards: unknown): Promise<void> {
  const metaRead = /^const META_READ = [^\n]+;$/m.exec(FN)?.[0] ?? "";
  const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { v: { boards } }, error: null }) }) }) }) };
  const load = run<(c: unknown) => Promise<void>>(
    `${metaRead}\n${FN.includes("async function readMetaRow(") ? lifted("readMetaRow") : ""}\n${lifted("loadOversizeBoards")}\nreturn loadOversizeBoards;`,
    { ...MODULE, OVERSIZE_BOARDS: reg, SHARED_TOKENS: SHIPPED_SHARED, console: { warn: () => {}, log: () => {} } },
  );
  await load(client);
}

/** The freshness sweep's per-chunk loop, lifted; returns the posting ids it wrote to the closure log. */
async function sweepShipped(reg: Map<string, OversizeEntry>, rows: Array<Record<string, unknown>>): Promise<string[]> {
  const ledger = CODE.indexOf('"freshness-sweep"');
  expect(ledger, "the freshness sweep's ledger write is gone").toBeGreaterThan(0);
  const at = CODE.lastIndexOf("for (let i = 0; i < ids.length; i += 200) {", ledger);
  expect(at, "the sweep's chunk loop was not found").toBeGreaterThan(0);
  let depth = 0;
  let end = -1;
  for (let j = CODE.indexOf("{", at); j < CODE.length; j++) {
    if (CODE[j] === "{") depth++;
    else if (CODE[j] === "}" && --depth === 0) { end = j + 1; break; }
  }
  const exits: Array<Record<string, unknown>> = [];
  const client = {
    from: () => ({
      select: () => ({ in: async (_c: string, ids: string[]) => ({ data: rows.filter((r) => ids.includes(String(r.id))), error: null }) }),
      upsert: () => Promise.resolve({ error: null }),
    }),
  };
  const sweep = run<(c: unknown, ids: string[], tomb: Set<string>, exitedAt: string) => Promise<void>>(
    `return async (client, ids, alreadyTombstoned, exitedAt) => { ${CODE.slice(at, end)} };`,
    {
      ...MODULE,
      OVERSIZE_BOARDS: reg,
      SHARED_TOKENS: SHIPPED_SHARED,
      META_READ: { light: true, oversize: true },
      LIFECYCLE_SELECT: "id, source, company_token, company, title, category, first_seen, posted_at",
      waitUntil: () => {},
      tenureDays: () => ({ days: 31, basis: "posted_at" }),
      exitReasonFor: () => "aged_out",
      lifecycleFacets: () => ({}),
      insertExits: (_c: unknown, r: Array<Record<string, unknown>>) => { exits.push(...r); return Promise.resolve({ error: null }); },
      console: { warn: () => {}, log: () => {} },
    },
  );
  await sweep(client, rows.map((r) => String(r.id)), new Set(), "2026-10-06T05:00:00Z");
  return exits.map((r) => String(r.posting_id)).sort();
}

const agedRow = (source: string, token: string, n: number) => ({
  id: `${source}:${token}:${n}`, source, company_token: token, company: token, title: "Role", category: "other",
  posted_at: "2026-09-01T00:00:00Z", first_seen: "2026-09-01T00:00:00Z", effective_posted: "2026-09-01T00:00:00Z",
});

describe("index.ts keys the oversize registry by board", () => {
  it("control: the shipped catalogue shares the tokens these cases use", () => {
    for (const t of ["pulse", "lush", "samsara"]) expect(SHIPPED_SHARED.has(t), t).toBe(true);
    expect(SHIPPED_SHARED.has("bigco")).toBe(false);
  });

  it("an over-bound visit records the board, and a twin's read does not clear it", () => {
    const reg = new Map<string, OversizeEntry>();
    const dirty = [recordOversizeVisit(reg, ghPulse, 20.6), recordOversizeVisit(reg, bigco, 15)];
    expect([...reg.keys()], "a shared token's board is keyed source:token, every other board by its bare token").toEqual(["greenhouse:pulse", "bigco"]);
    expect(dirty, "a new entry is a dirty registry").toEqual([true, true]);
    expect(recordRead(reg, ashbyPulse), "ashby:pulse read: nothing of its own to clear").toBe(false);
    expect(
      [...reg.keys()],
      "ashby:pulse's read deleted greenhouse:pulse's entry: the sweep then logs greenhouse:pulse's live postings as closures",
    ).toEqual(["greenhouse:pulse", "bigco"]);
    expect(recordRead(reg, ghPulse), "the oversize board itself read").toBe(true);
    expect(recordRead(reg, bigco)).toBe(true);
    expect(reg.size).toBe(0);
  });

  it("a registry row written by bare token is re-keyed on load by its stored source", async () => {
    const reg = new Map<string, OversizeEntry>();
    await loadShipped(reg, {
      lush: { source: "greenhouse", mb: 9.1, at: "2026-10-05T23:15:13Z" },
      pulse: { source: "greenhouse", mb: 20.6, at: "2026-10-06T01:32:43Z" },
      bigco: { source: "teamtailor", mb: 15, at: "2026-10-05T00:00:00Z" },
    });
    expect([...reg.keys()]).toEqual(["greenhouse:lush", "greenhouse:pulse", "bigco"]);
    expect(recordRead(reg, personioLush), "personio:lush read after the load").toBe(false);
    expect(reg.has("greenhouse:lush"), "the converted entry survives its twin's read").toBe(true);
  });

  it("the freshness sweep holds an oversize board's aged rows by board, and logs its readable twin's", async () => {
    const reg = new Map<string, OversizeEntry>();
    await loadShipped(reg, {
      pulse: { source: "greenhouse", mb: 20.6, at: "2026-10-06T01:32:43Z" },
      bigco: { source: "teamtailor", mb: 15, at: "2026-10-05T00:00:00Z" },
    });
    const logged = await sweepShipped(reg, [
      agedRow("greenhouse", "pulse", 1),
      agedRow("ashby", "pulse", 2),
      agedRow("teamtailor", "bigco", 7),
      agedRow("lever", "acme", 9),
    ]);
    expect(
      logged,
      "only rows of boards outside the registry reach the closure log; greenhouse:pulse and bigco are held across the key change",
    ).toEqual(["ashby:pulse:2", "lever:acme:9"]);
  });

  it("the stale lane hands get_stalest_boards and the classifier tokens, never board keys", () => {
    const reg = new Map<string, OversizeEntry>([
      ["greenhouse:pulse", { source: "greenhouse", mb: 20.6, at: "x" }],
      ["bigco", { source: "teamtailor", mb: 15, at: "y" }],
    ]);
    const lines = registryLines("let staleBoards: JobSource[] = [];", "const slice = [...demandBoards");
    const scope = { ...MODULE, OVERSIZE_BOARDS: reg, staleExclusion, staleTries: new Map<string, number>() };
    const exclusion = lines.map((l) => /^\s*const (\w+) = ([\s\S]*);\s*$/.exec(l)).find(Boolean);
    expect(exclusion, "the p_exclude list is built in one statement from the registry").toBeTruthy();
    const pExclude = run<string[]>(`return ${exclusion![2]};`, scope);
    expect(pExclude).toContain("pulse");
    expect(pExclude).toContain("bigco");
    expect(pExclude.filter((t) => t.includes(":")), "p_exclude takes tokens; a board key excludes nothing").toEqual([]);

    const ctxAt = CODE.indexOf("classifyStale(rows, {");
    expect(ctxAt, "the stale lane's classifyStale call").toBeGreaterThan(0);
    const oversize = run<ReadonlySet<string>>(`return ${propertyExpr("oversize", ctxAt)};`, scope);
    const ctx: StaleContext = {
      catalogued: new Set(["pulse", "bigco"]),
      quarantinedVendors: new Set(),
      oversize,
      dormant: new Set(),
      failing: new Set(),
      tries: new Map(),
    };
    const row: StaleRow = { stale_token: "pulse", stale_vendor: "greenhouse", stamped_at: "2026-10-01T00:00:00Z", age_min: 6000, posting_rows: 3, live_rows: 3, newest_effective: null };
    const verdicts = classifyStale([row], ctx);
    expect(verdicts.map((v) => v.cls), "the classifier compares tokens").toEqual(["oversize"]);
  });

  it("status names each entry by bare token and by board key", () => {
    const expr = propertyExpr("oversizeBoards", CODE.indexOf("oversizeBoards:"));
    const overMeta = { data: { v: { boards: { "greenhouse:pulse": { source: "greenhouse", mb: 20.6, at: "x" }, bigco: { source: "teamtailor", mb: 15, at: "y" } } } } };
    const rows = run<Array<Record<string, unknown>>>(`return ${expr};`, { ...MODULE, overMeta });
    expect(rows).toEqual([
      { token: "pulse", key: "greenhouse:pulse", source: "greenhouse", mb: 20.6, at: "x" },
      { token: "bigco", key: "bigco", source: "teamtailor", mb: 15, at: "y" },
    ]);
  });
});
