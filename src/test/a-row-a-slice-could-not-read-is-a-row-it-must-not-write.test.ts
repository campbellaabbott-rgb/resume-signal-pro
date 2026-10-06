import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { codeOf } from "./helpers/strip-comments";
import * as oversizeRegistry from "../../supabase/functions/job-board/oversize-registry.ts";

/**
 * A ROW A SLICE COULD NOT READ IS A ROW IT MUST NOT WRITE (job-board .90, F4).
 *
 * Two job_board_meta rows are loaded at the start of every refresh slice and
 * written back WHOLE from that slice's memory: the light set
 * (light_desc_dynamic, 110 of 500 boards on 2026-10-06) and the oversize
 * registry (oversize_boards, 37 entries). supabase-js reports a failed read as
 * `{ data: null, error }` rather than throwing, and both loaders read `data`
 * only, so a statement timeout cleared the in-memory set and the next
 * enrolment, or a dirty registry persist, wrote the near-empty set over the
 * row. Every light board then fetched ?content=true again, tripped the byte
 * bound and lost its rows for a rotation.
 *
 * The registry also feeds the pass-end freshness sweep, which keeps aged rows
 * of oversize boards OUT of the closure log (n147). An empty registry there
 * writes those boards' live postings into the ledger as employer closures,
 * forever. So an unread registry makes the sweep fail closed by not running:
 * it writes no closure, and it deletes and tombstones nothing either, because
 * deleting a row without its exit loses a true closure for good. The aged rows
 * are already hidden from the list, and the next pass with a readable registry
 * sweeps them with their exits and the oversize holds.
 *
 * This file runs the SHIPPED loaders, the enrolment, the registry persist and
 * the whole freshness sweep (lifted from index.ts and transpiled) against a
 * stub client whose meta read fails the way supabase-js fails.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const CODE = codeOf(FN);

/** One top-level function's source, or "" when the file does not have it. */
function liftedIfPresent(name: string): string {
  const at = FN.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  return at < 0 ? "" : FN.slice(at, FN.indexOf("\n}\n", at) + 2);
}
function lifted(name: string): string {
  const src = liftedIfPresent(name);
  expect(src, `${name} not found in job-board/index.ts`).not.toBe("");
  return src;
}
const constNum = (name: string) => Number(new RegExp(`const ${name} = ([0-9_]+);`).exec(CODE)![1].replace(/_/g, ""));

/** The whole freshness sweep block: the aged-row select, tombstones, the ledger write, the delete and the cleanup. */
function sweepBlock(): string {
  const head = "const freshCutoffIso = new Date(freshCutoffMs).toISOString();";
  const at = CODE.indexOf(head);
  expect(at, "the freshness sweep's cutoff line was not found").toBeGreaterThan(0);
  expect(CODE.indexOf('"freshness-sweep"', at), "the freshness sweep's ledger write is gone").toBeGreaterThan(at);
  const open = CODE.lastIndexOf("{", at);
  let depth = 0;
  for (let j = open; j < CODE.length; j++) {
    if (CODE[j] === "{") depth++;
    else if (CODE[j] === "}" && --depth === 0) return CODE.slice(open + 1, j);
  }
  throw new Error("unbalanced sweep block");
}

type Read = { data: unknown; error: unknown } | Error;
type Row = Record<string, unknown>;

/**
 * A client whose meta reads answer from `reads`, whose postings table holds `postings` (all aged
 * past the window), and which records every write and delete.
 */
function stubClient(reads: Record<string, Read>, postings: Row[] = []) {
  const upserts: Array<{ table: string; k?: string; row: unknown }> = [];
  const deleted: string[] = [];
  const client = {
    from(table: string) {
      return {
        select() {
          const q = {
            eq(_col: string, k: string) {
              return {
                maybeSingle: async () => {
                  const r = reads[k] ?? { data: null, error: null };
                  if (r instanceof Error) throw r;
                  return r;
                },
              };
            },
            lt: () => q,
            order: () => q,
            range: async (a: number, b: number) => ({ data: postings.slice(a, b + 1).map((p) => ({ id: p.id })), error: null }),
            in: async (_col: string, ids: string[]) => ({ data: table === "job_board_postings" ? postings.filter((p) => ids.includes(String(p.id))) : [], error: null }),
          };
          return q;
        },
        upsert(row: unknown) {
          upserts.push({ table, k: (row as { k?: string })?.k, row });
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            in: async (_col: string, ids: string[]) => {
              if (table === "job_board_postings") deleted.push(...ids);
              return { error: null };
            },
            lt: async () => ({ error: null }),
          };
        },
      };
    },
  };
  return { client, upserts, deleted, metaWrites: (k: string) => upserts.filter((u) => u.table === "job_board_meta" && u.k === k) };
}

/**
 * One isolate's worth of the shipped code. The light set and the registry are
 * module state, so a harness lives across slices exactly as an isolate does.
 */
function isolate() {
  const metaRead = /^const META_READ = [^\n]+;$/m.exec(FN)?.[0] ?? "";
  const src = `function __isolate() {
    ${metaRead}
    const OVERSIZE_BOARDS = new Map();
    ${liftedIfPresent("readMetaRow")}
    ${lifted("loadDynamicLight")}
    ${lifted("enrolDynamicLight")}
    ${lifted("loadOversizeBoards")}
    ${lifted("persistOversizeBoards")}
    const sweep = async (client, freshCutoffMs, sliceWallStart) => { ${sweepBlock()} };
    return { OVERSIZE_BOARDS, loadDynamicLight, enrolDynamicLight, loadOversizeBoards, persistOversizeBoards, sweep };
  }`;
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const exits: Row[][] = [];
  const DYNAMIC_LIGHT = new Set<string>();
  const deps: Record<string, unknown> = {
    ...oversizeRegistry,
    SHARED_TOKENS: new Set<string>(),
    DYNAMIC_LIGHT,
    JOB_SOURCES: [{ source: "greenhouse", token: "acme" }],
    LIGHT_CAPABLE_VENDORS: new Set(["greenhouse"]),
    lightKey: (s: { source: string; token: string }) => `${s.source}:${s.token}`,
    AUTO_LIGHT_CAP: constNum("AUTO_LIGHT_CAP"),
    OVERSIZE_CAP: constNum("OVERSIZE_CAP"),
    LIFECYCLE_SELECT: "id, source, company_token, company, title, category, posted_at, first_seen",
    FRESH_PRUNE_MAX: constNum("FRESH_PRUNE_MAX"),
    FRESH_WINDOW_DAYS: constNum("FRESH_WINDOW_DAYS"),
    breadcrumb: async () => {},
    waitUntil: () => {},
    tenureDays: () => ({ days: 31, basis: "posted_at" }),
    exitReasonFor: () => "aged_out",
    lifecycleFacets: () => ({}),
    insertExits: (_c: unknown, rows: Row[]) => {
      exits.push(rows);
      return Promise.resolve({ error: null });
    },
    console: { warn: () => {}, log: () => {} },
  };
  const names = Object.keys(deps);
  const h = new Function(...names, `${js}\nreturn __isolate();`)(...names.map((n) => deps[n])) as {
    OVERSIZE_BOARDS: Map<string, unknown>;
    loadDynamicLight: (c: unknown) => Promise<void>;
    enrolDynamicLight: (c: unknown, b: { source: string; token: string }, why: string) => Promise<boolean>;
    loadOversizeBoards: (c: unknown) => Promise<void>;
    persistOversizeBoards: (c: unknown) => Promise<void>;
    sweep: (c: unknown, freshCutoffMs: number, sliceWallStart: number) => Promise<void>;
  };
  /** Closure-log rows the sweep handed to insertExits since the last call, by posting id. */
  const logged = () => exits.splice(0).flat().map((r) => String(r.posting_id)).sort();
  return { ...h, DYNAMIC_LIGHT, logged };
}

/** What supabase-js returns for a meta read that failed (it does not throw). */
const FAILED: Read = { data: null, error: { message: "canceling statement due to statement timeout", code: "57014" } };
const lightRow = (tokens: string[]): Read => ({ data: { v: { tokens, keyedBy: "source:token" } }, error: null });
const registryRow = (boards: Record<string, { source: string; mb: number; at: string }>): Read => ({ data: { v: { boards } }, error: null });

const aged: Row[] = [
  { id: "greenhouse:acme:1", source: "greenhouse", company_token: "acme", company: "Acme", title: "Engineer", category: "engineering", posted_at: "2026-09-01T00:00:00Z", first_seen: "2026-09-01T00:00:00Z", effective_posted: "2026-09-01T00:00:00Z" },
  { id: "teamtailor:bigco:7", source: "teamtailor", company_token: "bigco", company: "BigCo", title: "Nurse", category: "healthcare", posted_at: "2026-09-02T00:00:00Z", first_seen: "2026-09-02T00:00:00Z", effective_posted: "2026-09-02T00:00:00Z" },
];
const ids = aged.map((r) => String(r.id));

describe("a loader that could not read writes nothing back", () => {
  it("an unread light row keeps the set it had, and an enrolment in that slice does not write the row", async () => {
    const iso = isolate();
    const good = stubClient({ light_desc_dynamic: lightRow(["greenhouse:speechify", "greenhouse:lush"]) });
    await iso.loadDynamicLight(good.client);
    expect([...iso.DYNAMIC_LIGHT].sort()).toEqual(["greenhouse:lush", "greenhouse:speechify"]);
    expect(await iso.enrolDynamicLight(good.client, { source: "greenhouse", token: "samsara" }, "test")).toBe(true);
    expect(good.metaWrites("light_desc_dynamic"), "control: after a good read an enrolment persists").toHaveLength(1);

    const bad = stubClient({ light_desc_dynamic: FAILED });
    await iso.loadDynamicLight(bad.client);
    expect(
      [...iso.DYNAMIC_LIGHT].sort(),
      "a failed read emptied the light set: every light board fetches ?content=true again and trips the byte bound",
    ).toEqual(["greenhouse:lush", "greenhouse:samsara", "greenhouse:speechify"]);
    expect(await iso.enrolDynamicLight(bad.client, { source: "greenhouse", token: "pulse" }, "test"), "the board is light in this slice").toBe(true);
    expect(iso.DYNAMIC_LIGHT.has("greenhouse:pulse")).toBe(true);
    expect(
      bad.metaWrites("light_desc_dynamic"),
      "a slice that never read the light row wrote it whole: its set is not the row, and the write drops every board it did not hold",
    ).toHaveLength(0);
    expect(bad.upserts, "nothing at all is written by a slice whose light read failed").toHaveLength(0);
  });

  it("a fresh isolate whose first read fails writes nothing, whatever it enrols", async () => {
    const iso = isolate();
    const bad = stubClient({ light_desc_dynamic: FAILED });
    await iso.loadDynamicLight(bad.client);
    await iso.enrolDynamicLight(bad.client, { source: "greenhouse", token: "acme" }, "test");
    expect(
      bad.metaWrites("light_desc_dynamic"),
      "an isolate holding one board overwrote a 110-board row",
    ).toHaveLength(0);
  });

  it("an unread registry keeps its entries, is not persisted, and the freshness sweep does not run: no closure, no delete", async () => {
    const iso = isolate();
    const bigco = { source: "teamtailor", mb: 15, at: "2026-10-05T23:00:00Z" };
    const cutoff = Date.parse("2026-09-06T04:00:00Z");
    const tombstones = (c: ReturnType<typeof stubClient>) => c.upserts.filter((u) => u.table === "job_board_aged_out").length;

    // Slice 1, read: the oversize board's aged row is held, the other is a closure; both leave.
    const good = stubClient({ oversize_boards: registryRow({ bigco }) }, aged);
    await iso.loadOversizeBoards(good.client);
    await iso.persistOversizeBoards(good.client);
    expect(good.metaWrites("oversize_boards"), "control: after a good read the registry persists").toHaveLength(1);
    await iso.sweep(good.client, cutoff, Date.now());
    expect(iso.logged(), "control: with the registry read, only the board that is not oversize is logged").toEqual(["greenhouse:acme:1"]);
    expect(good.deleted.sort(), "control: a readable sweep deletes every aged row").toEqual([...ids].sort());
    expect(tombstones(good), "control: and tombstones them").toBe(1);

    // Slice 2, the read fails.
    const bad = stubClient({ oversize_boards: FAILED }, aged);
    await iso.loadOversizeBoards(bad.client);
    expect([...iso.OVERSIZE_BOARDS.keys()], "a failed read emptied the registry").toEqual(["bigco"]);
    await iso.persistOversizeBoards(bad.client);
    expect(
      bad.metaWrites("oversize_boards"),
      "a slice that never read the registry wrote it whole, over whatever another slice had recorded",
    ).toHaveLength(0);
    await iso.sweep(bad.client, cutoff, Date.now());
    expect(
      iso.logged(),
      "the sweep logged closures while it could not know which boards are oversize: a board we are too small to read " +
        "has its live postings written into the closure log as an employer's closures",
    ).toEqual([]);
    expect(
      bad.deleted,
      "the sweep deleted aged rows it wrote no exit for: greenhouse:acme:1 is a true exit, and once its row is gone the closure log can never get it back",
    ).toEqual([]);
    expect(tombstones(bad), "nothing is tombstoned either: the rows are swept, with their exits, by the next readable pass").toBe(0);

    // Slice 3, readable again: the rows still there are swept with the exit and the hold slice 1 wrote.
    const again = stubClient({ oversize_boards: registryRow({ bigco }) }, aged);
    await iso.loadOversizeBoards(again.client);
    await iso.sweep(again.client, cutoff, Date.now());
    expect(iso.logged(), "the next readable pass logs the true exit the skipped pass left").toEqual(["greenhouse:acme:1"]);
    expect(again.deleted.sort()).toEqual([...ids].sort());

    // Slice 4, the row is simply absent: that is a read, so the registry is empty and writes resume.
    const none = stubClient({ oversize_boards: { data: null, error: null } }, aged);
    await iso.loadOversizeBoards(none.client);
    expect(iso.OVERSIZE_BOARDS.size).toBe(0);
    await iso.persistOversizeBoards(none.client);
    expect(none.metaWrites("oversize_boards"), "a missing row was read; it is not a failure").toHaveLength(1);
  });

  it("a read that throws is treated like one that returned an error", async () => {
    const iso = isolate();
    await iso.loadOversizeBoards(stubClient({ oversize_boards: registryRow({ bigco: { source: "teamtailor", mb: 15, at: "x" } }) }).client);
    await iso.loadDynamicLight(stubClient({ light_desc_dynamic: lightRow(["greenhouse:speechify"]) }).client);
    const thrown = stubClient({ oversize_boards: new Error("fetch failed"), light_desc_dynamic: new Error("fetch failed") }, aged);
    await iso.loadOversizeBoards(thrown.client);
    await iso.loadDynamicLight(thrown.client);
    await iso.persistOversizeBoards(thrown.client);
    await iso.enrolDynamicLight(thrown.client, { source: "greenhouse", token: "acme" }, "test");
    expect(thrown.metaWrites("oversize_boards")).toHaveLength(0);
    expect(thrown.metaWrites("light_desc_dynamic")).toHaveLength(0);
    expect([...iso.DYNAMIC_LIGHT].sort()).toEqual(["greenhouse:acme", "greenhouse:speechify"]);
    await iso.sweep(thrown.client, Date.parse("2026-09-06T05:00:00Z"), Date.now());
    expect(iso.logged(), "an unread registry writes no closure").toEqual([]);
    expect(thrown.deleted, "and deletes nothing").toEqual([]);
  });
});
