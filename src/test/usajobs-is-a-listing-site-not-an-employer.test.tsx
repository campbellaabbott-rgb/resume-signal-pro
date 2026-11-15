/**
 * USAJOBS IS A LISTING SITE, NOT AN EMPLOYER (audit CP6, plan D12).
 *
 * /jobs/company/usajobs read "Open roles at USAJOBS", "straight from USAJOBS'
 * own job board", "Work at USAJOBS? Claim this profile", and never said the
 * feed answers at most 10,000 results per query. Held here: the hub variant,
 * its H1 and the per-query cap sentence, no "own job board" copy, no claim,
 * no perks or SEC figures, and a hiring record that prints only the
 * tracking-floor reason.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(async () => ({ data: null, error: null })) } }));

import { buildLanderModel, USAJOBS_RESULT_CAP, type LanderInput } from "@/lib/company/lander-model";
import { CompanyLanderHeader } from "@/components/jobs/company/CompanyLander";
import { HiringRecordCard, type HiringRecordInput } from "@/components/jobs/company/HiringRecordCard";

const QUICK = { timeout: 3000 } as const;
const input = (o: Partial<LanderInput> = {}): LanderInput => ({
  token: "usajobs", storedName: "USAJOBS", bakedName: null, cachedName: null,
  listTotal: 9303, listFloor: false, feedTotal: 9303, feedFloor: true, feedAsOf: null,
  boardReadAt: new Date(Date.now() - 20 * 60_000).toISOString(), source: "usajobs", agency: false, collision: null, isUsajobs: true,
  loading: false, error: false, budgetRefusal: false, gated: { verdict: "unknown", withheld: "tracking" },
  verdict: "unknown", growth: "unknown", layoffRows: 0, visitorFilters: [], ...o,
});

describe("the USAJOBS hub", () => {
  it("is its own variant and shows no employer-only section", () => {
    const m = buildLanderModel(input());
    expect(m.variant).toBe("usajobs");
    expect(m.sections.claim).toBe(false);
    expect(m.sections.perks).toBe(false);
    expect(m.sections.sec).toBe(false);
    expect(m.sections.hiringRecordFloorOnly).toBe(true);
    expect(m.sections.mixAsListings).toBe(true);
    expect(USAJOBS_RESULT_CAP).toBe(10_000);
  });

  it("says what it is, states the per-query cap, and offers no claim and no 'own job board'", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CompanyLanderHeader model={buildLanderModel(input())} token="usajobs" labelOf={() => "USAJOBS"} source="usajobs" boardReadAt={null} onWatch={() => {}} onShowOnly={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Federal openings listed on USAJOBS");
    expect(screen.getByText("Up to 10,000 results per query; not every federal opening.")).toBeInTheDocument();
    expect(document.querySelector("[data-company-answer]")?.textContent).toMatch(/^9,303 roles dated in the last 30 days/);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/own job board|own careers system|Open roles at USAJOBS|Work at USAJOBS/);
    await user.click(screen.getByRole("button", { name: "More actions for USAJOBS" }));
    expect(await screen.findByRole("menuitem", { name: "Copy link" }, QUICK)).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /claim/i })).toBeNull();
  });

  it("its hiring record prints only the tracking-floor reason", () => {
    const rec: HiringRecordInput = {
      curve: { open_roles: 9303, filled_roles_90d: 120, relisted_roles_90d: 30, tracking_days: 10, observability_bucket: "full_read", watched_from: "2026-08-01", multi_site_title_share: 0, sufficient: true, dated_coverage: 0.9 },
      gated: { verdict: "unknown", withheld: "tracking" }, actively: "unknown", admitted: null, relistCaution: false,
      growth: { verdict: "unknown", row: null, why: "we set this board aside ourselves" },
      bars: { growthMinRatePct: 25, growthWindowDays: 7, closedWindowDays: 90, shareDays: 14, supportDays: 30 },
    };
    const { container } = render(<HiringRecordCard input={rec} floorOnly />);
    expect(container.querySelectorAll("[data-hh-gate]")).toHaveLength(1);
    expect(container.querySelector("[data-hh-gate]")?.getAttribute("data-hh-gate")).toBe("tracking");
    expect(container.textContent).toContain("We have watched this board for 10 days");
    expect(container.textContent).not.toMatch(/how fast roles come down|posting rate/i);
    expect(container.textContent).toContain("No reliable hiring signal yet");
  });
});

// ── XR-1, the index half: the agency's stated close date closes the row ──────
// index.ts cannot be imported (Deno.serve at load), so the parts are cut from
// its raw text and transpiled with TypeScript (esbuild refuses jsdom).
import { readFileSync as readSrc } from "node:fs";
import { resolve as resolvePath } from "node:path";
import ts from "typescript";

const INDEX = readSrc(resolvePath(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const jsOf = (src: string) => ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const topFn = (head: string) => {
  const i = INDEX.indexOf(`\n${head}`);
  if (i < 0) throw new Error(`${head} moved in index.ts: re-anchor this test`);
  return INDEX.slice(i + 1, INDEX.indexOf("\n}\n", i) + 2);
};
const topConst = (name: string) => {
  const m = INDEX.match(new RegExp(`^const ${name} = [\\s\\S]*?;\\n`, "m"));
  if (!m) throw new Error(`const ${name} moved in index.ts`);
  return m[0];
};

type Q = { table: string; ops: Array<[string, unknown[]]> };
/** A PostgREST-shaped stub: every chain records its calls and resolves through `answer`. */
const stubClient = (answer: (q: Q) => { data?: unknown; error?: unknown; count?: number }) => {
  const asked: Q[] = [];
  const from = (table: string) => {
    const q: Q = { table, ops: [] };
    asked.push(q);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "lt", "in", "limit", "insert", "delete", "upsert", "maybeSingle"]) chain[m] = (...a: unknown[]) => { q.ops.push([m, a]); return chain; };
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: null, error: null, ...answer(q) }).then(res, rej);
    return chain;
  };
  return { client: { from }, asked };
};

describe("XR-1: a USAJOBS announcement closes on the date its agency states", () => {
  const closer = () => {
    const exits: Array<Record<string, unknown>[]> = [];
    const pending: Promise<unknown>[] = [];
    const src = [topConst("STATED_CLOSE_MAX"), topConst("statedClosed"), topFn("async function closeStatedClosed("), topFn("async function closeVanishedChunk(")].join("\n");
    const make = new Function(
      "LIFECYCLE_SELECT", "tenureDays", "exitReasonFor", "lifecycleFacets", "insertExits", "normalizeCloseTitle", "settleInsertError", "CLOSURE_OPTIONAL_COLS", "waitUntil", "dropTombstones", "console",
      `${jsOf(src)}\nreturn { closeStatedClosed, statedClosed };`,
    );
    const fns = make(
      "id, source, company_token, company, title, category, first_seen, posted_at",
      () => ({ days: 12, basis: "posted" }), () => "aged_out", () => ({}),
      async (_c: unknown, rows: Record<string, unknown>[]) => { exits.push(rows); return { error: null }; },
      (t: string) => t.toLowerCase(), async (_c: unknown, _t: string, err: unknown) => err ?? null, [],
      (p: Promise<unknown>) => { pending.push(p); return p; }, () => {}, { warn: () => {}, log: () => {} },
    ) as { closeStatedClosed: (c: unknown) => Promise<number>; statedClosed: (j: { source: string; closesAt?: string | null }, now: number) => boolean };
    return { ...fns, exits, pending };
  };
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const READ_AT = new Date(Date.now() - 600_000).toISOString(); // the board's last read (job_board_verifications.verified_at)
  /** The board's last read, its live count, the picked rows and their lifecycle rows. */
  const board = (picked: typeof rows, o: { readAt?: string | null; live?: number } = {}) => (q: Q) => {
    if (q.table === "job_board_verifications") return { data: o.readAt === null ? null : { verified_at: o.readAt ?? READ_AT } };
    if (q.table === "job_board_postings" && q.ops[0]?.[1][0] === "id, company_token") return { data: picked.map((r) => ({ id: r.id, company_token: r.company_token })) };
    if (q.table === "job_board_postings" && q.ops[0]?.[1][0] === "id") return { count: o.live ?? 18_500 };
    if (q.table === "job_board_postings" && q.ops[0]?.[0] === "select") return { data: picked };
    return {};
  };
  const rows = [
    { id: "usajobs:usajobs:1", source: "usajobs", company_token: "usajobs", company: "Department of the Interior", title: "Park Ranger", category: "other", first_seen: "2026-10-01T00:00:00Z", posted_at: "2026-09-01T00:00:00Z" },
    { id: "usajobs:usajobs:2", source: "usajobs", company_token: "usajobs", company: "Department of Veterans Affairs", title: "Nurse", category: "healthcare", first_seen: "2026-10-02T00:00:00Z", posted_at: "2026-10-02T00:00:00Z" },
  ];

  it("a stored row past closes_at closes through the feed-removal path: a closure, an exit 'removed' marked stated_close, and the row gone", async () => {
    const c = closer();
    const { client, asked } = stubClient(board(rows));
    expect(await c.closeStatedClosed(client)).toBe(2);
    await Promise.all(c.pending);
    const pick = asked.find((q) => q.ops[0]?.[1][0] === "id, company_token")!;
    expect(pick.ops.slice(1).map(([m, a]) => [m, a[0]])).toEqual([["eq", "source"], ["lt", "closes_at"], ["limit", 1_000]]);
    const closures = asked.find((q) => q.table === "job_board_closures")!.ops[0][1][0] as Array<Record<string, unknown>>;
    expect(closures.map((r) => [r.posting_id, r.absence_basis])).toEqual([[rows[0].id, "stated_close"], [rows[1].id, "stated_close"]]);
    // A stated close is two postings of a live board, not the board vanishing: the batch is read against its live rows.
    expect(closures.map((r) => [r.batch_removed, r.batch_live_before])).toEqual([[2, 18_500], [2, 18_500]]);
    expect(c.exits.flat().map((r) => [r.posting_id, r.exit_reason, r.exit_basis])).toEqual([[rows[0].id, "removed", "stated_close"], [rows[1].id, "removed", "stated_close"]]);
    const del = asked.find((q) => q.ops[0]?.[0] === "delete")!;
    expect(del.ops[1]).toEqual(["in", ["id", rows.map((r) => r.id)]]);
  });

  it("an announcement posted long ago still closes as removed, not aged out: the stated date is the evidence", async () => {
    const c = closer();
    const old = [{ ...rows[0], posted_at: "2025-01-01T00:00:00Z" }];
    const { client } = stubClient(board(old));
    expect(await c.closeStatedClosed(client)).toBe(1);
    await Promise.all(c.pending);
    expect(c.exits.flat().map((r) => r.exit_reason)).toEqual(["removed"]);
  });

  it("before 20261111100000 the column is absent: the read errors and nothing is closed", async () => {
    const c = closer();
    const { client, asked } = stubClient((q) => (q.table === "job_board_verifications" ? { data: { verified_at: READ_AT } } : { error: { message: 'column job_board_postings.closes_at does not exist' } }));
    expect(await c.closeStatedClosed(client)).toBe(0);
    expect(asked.map((q) => q.table)).toEqual(["job_board_verifications", "job_board_postings"]);
  });

  it("only a date a board read has passed since closes a row: the read is what could have moved an extended date", async () => {
    const c = closer();
    const { client, asked } = stubClient(board(rows));
    await c.closeStatedClosed(client);
    const pick = asked.find((q) => q.ops[0]?.[1][0] === "id, company_token")!;
    expect(pick.ops.find(([m]) => m === "lt"), "closes_at before the board's last read, not before now").toEqual(["lt", ["closes_at", READ_AT]]);
    // Never read: nothing closes on a stored date alone.
    const none = closer();
    const unread = stubClient(board(rows, { readAt: null }));
    expect(await none.closeStatedClosed(unread.client)).toBe(0);
    expect(unread.asked.map((q) => q.table)).toEqual(["job_board_verifications"]);
  });

  it("a stored row takes the close date each read states, unlogged: an extension moves it, so the sweep never closes an open announcement", () => {
    // The diff loop's existing-row read selects closes_at on a USAJOBS board, and patches it as our reading.
    expect(INDEX).toMatch(/let closesCol = s\.source === "usajobs" \? ",closes_at" : "";/);
    expect(INDEX).toMatch(/posted_at,department\$\{closesCol\}/);
    const at = INDEX.indexOf("if (closesCol && row.closes_at && ");
    expect(at, "the diff loop never moves a stored closes_at").toBeGreaterThan(0);
    const stmt = INDEX.slice(at, INDEX.indexOf("\n", at));
    const put = new Function("closesCol", "row", "prev", "patch", `${jsOf(stmt)}\nreturn patch;`) as (c: string, r: Record<string, unknown>, p: Record<string, unknown>, patch: Record<string, unknown>) => Record<string, unknown>;
    expect(put(",closes_at", { closes_at: "2026-12-02T04:59:59.000Z" }, { closes_at: "2026-11-21T04:59:59+00:00" }, {}), "extended").toEqual({ closes_at: "2026-12-02T04:59:59.000Z" });
    expect(put(",closes_at", { closes_at: "2026-11-21T04:59:59.000Z" }, { closes_at: "2026-11-21T04:59:59+00:00" }, {}), "the same instant spelled by Postgres").toEqual({});
    expect(put(",closes_at", { closes_at: "2026-11-21T04:59:59.000Z" }, { closes_at: null }, {}), "a row stored before .102 gains its date").toEqual({ closes_at: "2026-11-21T04:59:59.000Z" });
    expect(put(",closes_at", { closes_at: null }, { closes_at: "2026-11-21T04:59:59+00:00" }, {}), "a read that states none leaves the date").toEqual({});
    expect(put("", { closes_at: "2026-12-02T04:59:59.000Z" }, {}, {}), "another vendor, or the column absent").toEqual({});
    // It is set on the patch directly, never through put()/note(), so the field-change log never sees it.
    expect(stmt).not.toMatch(/\bput\(|\bnote\(/);
    // Before 20261111100000 the existing-row read names a missing column: it is read again without it.
    expect(INDEX).toMatch(/if \(closesCol && res\.error\?\.message\?\.includes\("closes_at"\)\) \{ closesCol = ""; from -= 1000; continue; \}/);
  });

  it("an announcement already past its close date is not stored at ingest; one still open, another vendor or no date is", () => {
    const { statedClosed } = closer();
    const now = Date.parse("2026-11-15T12:00:00Z");
    expect(statedClosed({ source: "usajobs", closesAt: "2026-11-15T00:00:00Z" }, now)).toBe(true);
    expect(statedClosed({ source: "usajobs", closesAt: "2026-11-21T00:00:00Z" }, now)).toBe(false);
    expect(statedClosed({ source: "usajobs", closesAt: null }, now)).toBe(false);
    expect(statedClosed({ source: "usajobs" }, now)).toBe(false);
    expect(statedClosed({ source: "greenhouse", closesAt: "2026-11-01T00:00:00Z" }, now)).toBe(false);
    expect(INDEX).toMatch(/if \(isDatedBefore\(posted, freshCutoffMs\)\) \{ agedOutIds\.add\(j\.id\); continue; \}\n(?:\s*\/\/[^\n]*\n)*\s*if \(statedClosed\(j, Date\.now\(\)\)\) continue;/);
    expect(INDEX).toMatch(/\.\.\.\(j\.closesAt \? \{ closes_at: j\.closesAt \} : \{\}\),/);
  });

  it("an insert that names a missing closes_at is retried without the key, the way the agency fallback works", async () => {
    const a = INDEX.indexOf('if (error?.message?.includes("closes_at")) {');
    expect(a, "the closes_at fallback is gone").toBeGreaterThan(0);
    const block = INDEX.slice(a, INDEX.indexOf("\n          }\n", a) + 12);
    const sent: Array<Record<string, unknown>[]> = [];
    const client = { from: () => ({ upsert: async (r: Record<string, unknown>[]) => { sent.push(r); return { error: r.some((x) => "closes_at" in x) ? { message: "Could not find the 'closes_at' column" } : null }; } }) };
    const newRows = [{ id: "usajobs:usajobs:1", closes_at: "2026-11-21T00:00:00Z", title: "Ranger" }, { id: "usajobs:usajobs:2", title: "Nurse" }];
    const run = new Function("client", "newRows", `return (async () => { let i = 0; let { error } = await client.from().upsert(newRows); ${jsOf(block)}; return error; })();`);
    expect(await run(client, newRows)).toBeNull();
    expect(sent[1], "the retry carries every row, none naming closes_at").toEqual([{ id: "usajobs:usajobs:1", title: "Ranger" }, { id: "usajobs:usajobs:2", title: "Nurse" }]);
    expect(INDEX, "the exit's optional columns include exit_basis, so a database without it still takes the exit").toMatch(/"salary_min_annual", "salary_max_annual", "salary_period", "salary_currency",\n\s*"exit_basis",\n\] as const;/);
  });

  it("the sweep step reports how many it closed on their stated date", () => {
    expect(INDEX).toMatch(/const onDate = await closeStatedClosed\(client\);/);
    expect(INDEX).toMatch(/statedClosed: \(\(begun\.prior as \{ statedClosed\?: number \}\)\.statedClosed \?\? 0\) \+ \(r\.statedClosed \?\? 0\)/);
  });
});
