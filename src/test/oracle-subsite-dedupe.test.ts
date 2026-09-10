/**
 * ONE ORACLE REQUISITION IS ONE STORED ROW, WHATEVER CAREER SITE LISTS IT.
 *
 * An Oracle tenant publishes the same requisition on several "career sites"
 * (CX_1, CX_3, CX_1001 ...), each its own catalog token, and the posting id is
 * `oracle:<token>:<reqId>` -- so until 2026-09-09.68 every mirror stored a full
 * second copy of every row. Measured live that day: Clean Harbors EN/FR
 * 703 = 703 with 200/200 sampled ids identical; Cummins' seven audience views
 * of one ~710-req tenant; Hearst's three 148-row mirrors. Board-wide estimate
 * ~23k duplicate servable rows (12k-52k), every one inflating an employer's
 * open count.
 *
 * Three guards with teeth, each of which FAILS on the code as it stood at
 * HEAD 87351855:
 *
 *   1. THE INGEST PROPERTY. Two sub-sites of one tenant yield ONE stored row
 *      per requisition, and a requisition that exists on only one sub-site
 *      survives -- in either visit order, and idempotently. On pre-fix code
 *      the planner does not exist and normalizeOracle alone stores two rows
 *      per shared requisition (the "naive" baseline asserted below).
 *   2. THE DEV-TENANT GUARD. No Oracle token in sources.ts belongs to a
 *      dev/test/stage/uat tenant. Pre-fix sources.ts carried 19 of them on 8
 *      tenants; the brief's regex (`-dev\d*~`) missed 8 of the 19 because
 *      `fa-exrr-dev2-saasfaprod1` puts `-saasfaprod1` between the suffix and
 *      the `~`. The guard tests the tenant segment.
 *   3. THE EXIT-REASON GUARD. A row the dedupe removes leaves as OUR action:
 *      exit_reason 'untracked', never a closure, never an absence_basis a
 *      fill curve could count -- in the edge function AND in the repair SQL.
 *      Pre-fix index.ts has no dedupe exit path at all.
 *   4. THE LIVE COPY WINS. A holder stamped missing_since is on its way to a
 *      closure and does not own the requisition: a sub-site's live copy must
 *      never be shed in favour of it (the row would close as a takedown the
 *      employer never made, and the sub-site would re-insert it as a fresh
 *      arrival). Asserted on the planner, and on the repair SQL's keeper.
 *
 * HOUSE RULE: code is asserted against comment-stripped source. A guard whose
 * literal appears in a comment passes while the code is dead.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CATALOG, CODE_SOURCE, stripTsComments } from "./helpers/catalog";
import {
  isOracleDevToken,
  normalizeOracle,
  ORACLE_DEV_TENANT_RE,
  oracleReqKey,
  oracleReqKeyOfId,
  planOracleSubsiteVisit,
  rankOracleSites,
  type OracleHolderRow,
} from "../../supabase/functions/job-board/normalize";

const FN_DIR = resolve(__dirname, "../../supabase/functions/job-board");
const MIGRATION = resolve(
  __dirname,
  "../../supabase/migrations/20260909216000_one_requisition_is_one_row_whatever_site_lists_it.sql",
);
const EXITS_CHECK_MIGRATION = resolve(
  __dirname,
  "../../supabase/migrations/20260817222407_94d82708-5188-47e6-ad4c-4990e411ba42.sql",
);

/** The canonical map, read from sources.ts CODE (not imported: the module is 44k entries). */
function parseCanonicalSites(): Record<string, string> {
  const m = /export\s+const\s+ORACLE_CANONICAL_SITES[^=]*=\s*\{([\s\S]*?)\}/.exec(CODE_SOURCE);
  if (!m) throw new Error("ORACLE_CANONICAL_SITES not found in sources.ts");
  const out: Record<string, string> = {};
  for (const pair of m[1].matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)) out[pair[1]] = pair[2];
  return out;
}

const stripSqlComments = (sql: string) =>
  sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

/** Extract a brace-balanced block starting at the first `{` after `anchor`. */
function blockAfter(code: string, anchor: string): string {
  const at = code.indexOf(anchor);
  if (at < 0) throw new Error(`anchor not found in code: ${anchor}`);
  const open = code.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") {
      depth--;
      if (depth === 0) return code.slice(at, i + 1);
    }
  }
  throw new Error(`unbalanced block after ${anchor}`);
}

// ── A tiny in-memory board: the fetcher's contract, without Deno or Postgres ──
type Row = { id: string; token: string; req_key: string };
const A = "acme~us2~CX_1"; // canonical (first-listed)
const B = "acme~us2~CX_3"; // sub-site (a French mirror, say)
const ORACLE_SITES = [{ source: "oracle", token: A }, { source: "oracle", token: B }];
const RANK = rankOracleSites(ORACLE_SITES, {});
const req = (Id: number, Title = `Role ${Id}`) => ({ Id, Title, PostedDate: "2026-09-01", PrimaryLocation: "Boston, MA, United States", PrimaryLocationCountry: "US" });

/** One ingest visit of `token`, applying the planner the way index.ts does. */
function visit(db: Map<string, Row>, token: string, items: ReturnType<typeof req>[], usePlanner = true) {
  const postings = normalizeOracle(items, "Acme", token);
  const fetched = postings.map((p) => p.id.split(":")[2]);
  const stored = new Map<string, string>();
  for (const r of db.values()) if (r.token === token) stored.set(r.id.split(":")[2], r.id);
  let keep = new Set(postings.map((p) => p.id));
  if (usePlanner) {
    const holders = new Map<string, OracleHolderRow[]>();
    for (const r of db.values()) {
      const list = holders.get(r.req_key) ?? [];
      list.push({ id: r.id, token: r.token, rank: RANK.get(r.token) ?? null });
      holders.set(r.req_key, list);
    }
    const plan = planOracleSubsiteVisit({ token, rank: RANK.get(token)!, fetched, stored, holders });
    keep = new Set(postings.filter((p) => !plan.dropReqIds.has(p.id.split(":")[2])).map((p) => p.id));
    for (const id of [...plan.shedMineIds, ...plan.shedSiblingIds]) db.delete(id);
    // The planner must never be handed a row it has not been told about.
    for (const id of plan.shedMineIds) expect(id.startsWith(`oracle:${token}:`)).toBe(true);
    for (const id of plan.shedSiblingIds) expect(id.startsWith(`oracle:${token}:`)).toBe(false);
    let inserted = 0;
    for (const p of postings) if (keep.has(p.id) && !db.has(p.id)) { db.set(p.id, { id: p.id, token, req_key: oracleReqKeyOfId(p.id)! }); inserted++; }
    const empty = plan.dropReqIds.size === 0 && plan.shedMineIds.length === 0 && plan.shedSiblingIds.length === 0 && inserted === 0;
    return { plan, inserted, empty };
  }
  let inserted = 0;
  for (const p of postings) if (!db.has(p.id)) { db.set(p.id, { id: p.id, token, req_key: oracleReqKeyOfId(p.id)! }); inserted++; }
  return { plan: null, inserted, empty: false };
}

const rowsPerKey = (db: Map<string, Row>) => {
  const n = new Map<string, number>();
  for (const r of db.values()) n.set(r.req_key, (n.get(r.req_key) ?? 0) + 1);
  return n;
};

describe("guard 1 — two sub-sites of one tenant store one row per requisition, and a sub-site-only req survives", () => {
  const SHARED = [req(1001), req(1002), req(1003), req(1004)];
  const ONLY_ON_B = req(2001, "Technicien bilingue (FR only)");

  it("pre-fix baseline: normalizeOracle alone stores every shared requisition twice", () => {
    const db = new Map<string, Row>();
    visit(db, A, SHARED, false);
    visit(db, B, [...SHARED, ONLY_ON_B], false);
    // This is the defect: 2 rows per shared req + the unique one.
    expect(db.size).toBe(SHARED.length * 2 + 1);
    expect([...rowsPerKey(db).values()].filter((n) => n > 1)).toHaveLength(SHARED.length);
  });

  it("canonical first, then the sub-site: shared reqs stay under the canonical, the FR-only req lands under the sub-site", () => {
    const db = new Map<string, Row>();
    visit(db, A, SHARED);
    const second = visit(db, B, [...SHARED, ONLY_ON_B]);
    expect(second.plan!.dropReqIds).toEqual(new Set(["1001", "1002", "1003", "1004"]));
    expect(second.plan!.shedMineIds).toEqual([]);
    expect(second.plan!.shedSiblingIds).toEqual([]);
    expect(db.size).toBe(SHARED.length + 1);
    expect([...rowsPerKey(db).values()].every((n) => n === 1)).toBe(true);
    expect(db.has(`oracle:${B}:2001`)).toBe(true);
    for (const r of SHARED) expect(db.has(`oracle:${A}:${r.Id}`)).toBe(true);
  });

  it("sub-site first, then the canonical: the canonical takes the shared reqs and the sub-site's copies are shed — the FR-only req is untouched", () => {
    const db = new Map<string, Row>();
    visit(db, B, [...SHARED, ONLY_ON_B]);
    expect(db.size).toBe(SHARED.length + 1); // B was the only holder: it stored everything
    const second = visit(db, A, SHARED);
    expect(second.plan!.dropReqIds.size).toBe(0);
    expect(second.plan!.shedSiblingIds.sort()).toEqual(SHARED.map((r) => `oracle:${B}:${r.Id}`).sort());
    expect(db.size).toBe(SHARED.length + 1);
    expect([...rowsPerKey(db).values()].every((n) => n === 1)).toBe(true);
    expect(db.has(`oracle:${B}:2001`)).toBe(true);
    // Now B visits again: it must drop the shared reqs it still serves and shed nothing (its copies are gone).
    const third = visit(db, B, [...SHARED, ONLY_ON_B]);
    expect(third.plan!.dropReqIds.size).toBe(SHARED.length);
    expect(third.plan!.shedMineIds).toEqual([]);
    expect(db.size).toBe(SHARED.length + 1);
  });

  it("is idempotent: re-running both visits produces empty plans and the same table", () => {
    const db = new Map<string, Row>();
    visit(db, A, SHARED);
    visit(db, B, [...SHARED, ONLY_ON_B]);
    const snapshot = [...db.keys()].sort();
    const again = visit(db, A, SHARED);
    expect(again.empty).toBe(true);
    const againB = visit(db, B, [...SHARED, ONLY_ON_B]);
    // B still serves the shared reqs, so it keeps dropping them, but sheds and inserts nothing.
    expect(againB.plan!.shedMineIds).toEqual([]);
    expect(againB.plan!.shedSiblingIds).toEqual([]);
    expect(againB.inserted).toBe(0);
    expect([...db.keys()].sort()).toEqual(snapshot);
  });

  it("a stale copy under the sub-site is shed even when the sub-site no longer serves it, and never enters the absence path", () => {
    // B stored req 1001 in the past; A now holds it; B's feed no longer lists it.
    const db = new Map<string, Row>();
    visit(db, B, [req(1001)]);
    visit(db, A, [req(1001)]); // sheds B's copy
    expect(db.has(`oracle:${B}:1001`)).toBe(false);
    // Reconstruct the stale case directly: B holds a copy A also holds.
    db.set(`oracle:${B}:1001`, { id: `oracle:${B}:1001`, token: B, req_key: oracleReqKey(B, "1001")! });
    const plan = planOracleSubsiteVisit({
      token: B, rank: RANK.get(B)!, fetched: [], stored: new Map([["1001", `oracle:${B}:1001`]]),
      holders: new Map([[oracleReqKey(B, "1001")!, [
        { id: `oracle:${A}:1001`, token: A, rank: 0 },
        { id: `oracle:${B}:1001`, token: B, rank: 1 },
      ]]]),
    });
    expect(plan.shedMineIds).toEqual([`oracle:${B}:1001`]);
    expect(plan.dropReqIds.size).toBe(0);
  });

  it("guard 4 — a stamped canonical copy does not own the requisition: the sub-site's live copy survives and the dying copy is shed, never closed", () => {
    const key = oracleReqKey(A, "500")!;
    // A's copy of 500 is stamped missing_since (A stopped listing it); B still serves it.
    const bVisit = planOracleSubsiteVisit({
      token: B, rank: 1, fetched: ["500"], stored: new Map([["500", `oracle:${B}:500`]]),
      holders: new Map([[key, [
        { id: `oracle:${A}:500`, token: A, rank: 0, missing: true },
        { id: `oracle:${B}:500`, token: B, rank: 1 },
      ]]]),
    });
    expect(bVisit.dropReqIds.size).toBe(0);            // B keeps serving it
    expect(bVisit.shedMineIds).toEqual([]);            // B's live row survives
    expect(bVisit.shedSiblingIds).toEqual([`oracle:${A}:500`]); // A's dying copy leaves as OUR action, not through the closure path
    // The same with B not yet holding a copy: B stores it, A's stamped copy is shed.
    const bNew = planOracleSubsiteVisit({
      token: B, rank: 1, fetched: ["500"], stored: new Map(),
      holders: new Map([[key, [{ id: `oracle:${A}:500`, token: A, rank: 0, missing: true }]]]),
    });
    expect(bNew.dropReqIds.size).toBe(0);
    expect(bNew.shedSiblingIds).toEqual([`oracle:${A}:500`]);
    // A live better-ranked holder still wins over B, stamped or not on B's side.
    const bLoses = planOracleSubsiteVisit({
      token: B, rank: 1, fetched: ["500"], stored: new Map([["500", `oracle:${B}:500`]]),
      holders: new Map([[key, [{ id: `oracle:${A}:500`, token: A, rank: 0 }, { id: `oracle:${B}:500`, token: B, rank: 1, missing: true }]]]),
    });
    expect(bLoses.dropReqIds).toEqual(new Set(["500"]));
    expect(bLoses.shedMineIds).toEqual([`oracle:${B}:500`]);
  });

  it("a requisition a FULL read no longer served here, still live on a sibling, is shed as our action instead of entering the absence path; a windowed read concludes nothing", () => {
    const key = oracleReqKey(A, "600")!;
    const holders = new Map([[key, [
      { id: `oracle:${A}:600`, token: A, rank: 0 },
      { id: `oracle:${B}:600`, token: B, rank: 1 },
    ]]]);
    const full = planOracleSubsiteVisit({ token: A, rank: 0, fetched: [], stored: new Map([["600", `oracle:${A}:600`]]), holders, fullRead: true });
    expect(full.shedMineIds).toEqual([`oracle:${A}:600`]);
    expect(full.shedSiblingIds).toEqual([]);
    const windowed = planOracleSubsiteVisit({ token: A, rank: 0, fetched: [], stored: new Map([["600", `oracle:${A}:600`]]), holders, fullRead: false });
    expect(windowed.shedMineIds).toEqual([]);
    // No live sibling: the ordinary absence path (grace, stamp, closure) keeps the case.
    const alone = planOracleSubsiteVisit({
      token: A, rank: 0, fetched: [], stored: new Map([["600", `oracle:${A}:600`]]), fullRead: true,
      holders: new Map([[key, [{ id: `oracle:${A}:600`, token: A, rank: 0 }, { id: `oracle:${B}:600`, token: B, rank: 1, missing: true }]]]),
    });
    expect(alone.shedMineIds).toEqual([]);
  });

  it("a key with ten holders (a Cummins requisition before the repair) is decided from ALL of them, so the lookup must be paged", () => {
    // 100 keys x 10 holders = 1,000 rows: exactly the PostgREST cap. The
    // planner is handed the full holder set here; the index.ts guard below
    // asserts the fetcher pages until a short page instead of trusting one.
    const sites = Array.from({ length: 10 }, (_, i) => `cummins~ocs~CX_${i}`);
    const entries = sites.map((token) => ({ source: "oracle", token }));
    const ranks = rankOracleSites(entries, {});
    const holders = new Map<string, OracleHolderRow[]>();
    const fetched: string[] = [];
    for (let k = 0; k < 100; k++) {
      const rq = String(9000 + k);
      fetched.push(rq);
      holders.set(oracleReqKey(sites[0], rq)!, sites.map((t) => ({ id: `oracle:${t}:${rq}`, token: t, rank: ranks.get(t)! })));
    }
    const plan = planOracleSubsiteVisit({ token: sites[0], rank: 0, fetched, stored: new Map(), holders });
    expect(plan.shedSiblingIds).toHaveLength(900);
    expect(plan.dropReqIds.size).toBe(0);
  });

  it("a partial read decides nothing about what it did not see; unranked holders are left to the orphan prune; the shed cap holds", () => {
    const key = oracleReqKey(A, "77")!;
    // A stores 77 but did not fetch it this (windowed) visit; B holds a copy too. Nothing is shed.
    const noSee = planOracleSubsiteVisit({
      token: A, rank: 0, fetched: [], stored: new Map([["77", `oracle:${A}:77`]]),
      holders: new Map([[key, [{ id: `oracle:${A}:77`, token: A, rank: 0 }, { id: `oracle:${B}:77`, token: B, rank: 1 }]]]),
    });
    expect(noSee.shedSiblingIds).toEqual([]);
    expect(noSee.shedMineIds).toEqual([]);
    // An unranked holder (a dev tenant's row, an untracked token) is never shed and never wins.
    const unranked = planOracleSubsiteVisit({
      token: A, rank: 0, fetched: ["77"], stored: new Map(),
      holders: new Map([[key, [{ id: "oracle:acme-dev1~us2~CX_1:77", token: "acme-dev1~us2~CX_1", rank: null }]]]),
    });
    expect(unranked.dropReqIds.size).toBe(0);
    expect(unranked.shedSiblingIds).toEqual([]);
    // Shed cap: 3 lower-ranked copies, cap 2.
    const capped = planOracleSubsiteVisit({
      token: A, rank: 0, fetched: ["1", "2", "3"], stored: new Map(), shedCap: 2,
      holders: new Map(["1", "2", "3"].map((r) => [oracleReqKey(A, r)!, [{ id: `oracle:${B}:${r}`, token: B, rank: 1 }]])),
    });
    expect(capped.shedSiblingIds).toHaveLength(2);
  });
});

describe("the rank rule", () => {
  // Resolved lazily inside each test, not at describe scope: a regression in
  // sources.ts would otherwise abort the whole file as "no tests" and hide
  // the other guards' verdicts.
  const load = () => {
    const canonical = parseCanonicalSites();
    const oracle = CATALOG.filter((e) => e.source === "oracle");
    return { canonical, oracle, ranks: rankOracleSites(oracle, canonical) };
  };

  it("every ORACLE_CANONICAL_SITES entry names a multi-site tenant and one of its own sites", () => {
    const { canonical, oracle, ranks } = load();
    for (const [tenant, token] of Object.entries(canonical)) {
      const sites = oracle.filter((e) => e.token.split("~")[0] === tenant).map((e) => e.token);
      expect(sites.length, `${tenant} has ${sites.length} site(s) in sources.ts — an override for a single-site tenant is dead`).toBeGreaterThanOrEqual(2);
      expect(sites, `${tenant}: canonical ${token} is not one of the tenant's catalogued sites`).toContain(token);
      expect(ranks.get(token), `${tenant}: the named canonical must rank 0`).toBe(0);
    }
  });

  it("Cummins is ranked under All Functions, not the larger-by-one Technicians view; Clean Harbors under its English site", () => {
    const { ranks } = load();
    expect(ranks.get("fa-espx-saasfaprod1~ocs~CX_1006")).toBe(0);
    expect(ranks.get("fa-espx-saasfaprod1~ocs~CX_3001")).toBeGreaterThan(0);
    expect(ranks.get("epyc~us2~CX_1")).toBe(0);
  });

  it("every multi-site tenant has exactly one rank-0 site; single-site tenants are not ranked at all", () => {
    const { oracle, ranks } = load();
    const byTenant = new Map<string, string[]>();
    for (const e of oracle) byTenant.set(e.token.split("~")[0], [...(byTenant.get(e.token.split("~")[0]) ?? []), e.token]);
    for (const [tenant, sites] of byTenant) {
      const zeros = sites.filter((t) => ranks.get(t) === 0);
      if (sites.length === 1) expect(ranks.has(sites[0]), `${tenant} is single-site and must not be ranked`).toBe(false);
      else expect(zeros, `${tenant}: ${zeros.length} rank-0 sites`).toHaveLength(1);
    }
    expect(ranks.size).toBeGreaterThan(500); // 723 at authoring; a collapse here means the reader went blind
  });

  it("the repair SQL reads the rank table the bundle publishes, and only SEEDS it when absent", () => {
    const sql = stripSqlComments(readFileSync(MIGRATION, "utf8"));
    const idx = stripTsComments(readFileSync(resolve(FN_DIR, "index.ts"), "utf8"));
    expect(sql).toMatch(/k = 'oracle_site_rank'/);
    expect(sql).toMatch(/VALUES \('oracle_site_rank'[\s\S]*?ON CONFLICT \(k\) DO NOTHING/);
    expect(idx).toMatch(/k: "oracle_site_rank"/);
    expect(idx).toMatch(/\.eq\("k", "oracle_site_rank"\)/); // hash-gated: read before write
  });
});

describe("guard 2 — no dev/test/stage/uat Oracle tenant is aboard", () => {
  it("the pattern tests the TENANT segment, so a suffix before -saasfaprod1 is caught and non-Oracle tokens are not", () => {
    for (const t of [
      "fa-exrr-dev2-saasfaprod1~ocs~CX_1", "fa-exdu-dev2-saasfaprod1~ocs~CX_1", "eodr-dev5~us2~CX_1001",
      "hdbt-dev1~us2~CX_1", "efzu-dev8~em2~CX_1", "iazmqy-dev2~ocs~CX_2", "abcd-test~us2~CX_1",
      "abcd-uat3~em2~CX_1", "abcd-stage~us6~CX_1", "ABCD-DEV1~us2~CX_1",
    ]) expect(isOracleDevToken(t), t).toBe(true);
    for (const t of [
      "fa-exrr-saasfaprod1~ocs~CX_1", "eodr~us2~CX_1001", "edel~us2~CX_1", "devops~us2~CX_1",
      "real-dev-inc", "convex-dev", "cambridge-gan-devices", "joe-testing", "hcwx~us2~CX_6",
    ]) expect(isOracleDevToken(t), t).toBe(false);
    // The brief's regex misses the -saasfaprod1 shape; this one must not.
    expect(/-(dev|test|stage|uat)\d*~/.test("fa-exrr-dev2-saasfaprod1~ocs~CX_1")).toBe(false);
    expect(ORACLE_DEV_TENANT_RE.test("fa-exrr-dev2-saasfaprod1")).toBe(true);
  });

  it("sources.ts carries no Oracle token on a sandbox tenant (19 were aboard at HEAD 87351855)", () => {
    const offenders = CATALOG.filter((e) => e.source === "oracle" && isOracleDevToken(e.token));
    expect(
      offenders.map((e) => `${e.token} (${e.name})`),
      "dev/test tenants are vendor sandboxes, not employers' boards; the orphan prune exits their rows as untracked once removed",
    ).toEqual([]);
  });

  it("the measured pure mirrors are out and the sub-sites that carry unique requisitions are still fetched", () => {
    const tokens = new Set(CATALOG.filter((e) => e.source === "oracle").map((e) => e.token));
    for (const gone of ["epyc~us2~CX_3", "eevd~us6~CX_1", "eevd~us6~CX_14001", "hcwx~us2~CX_5001"]) {
      expect(tokens.has(gone), `${gone} measured 0 unique reqs (exact mirror) and must not be fetched for nothing`).toBe(false);
    }
    for (const kept of [
      "epyc~us2~CX_1", "epyc~us2~CX_1001", "eexs~us2~CX_3001", "eexs~us2~CX_11009", "eevd~us6~CX", "eevd~us6~CX_6",
      "fa-espx-saasfaprod1~ocs~CX_1006", "fa-espx-saasfaprod1~ocs~CX_3001", "hcwx~us2~CX_6", "hcwx~us2~CX_1",
      "hcwp~us2~CX_7009", "hcrw~us2~CX_1001", "fa-euyk-saasfaprod1~ocs~CX_1001", "eodr~us2~CX_5001",
    ]) expect(tokens.has(kept), `${kept} carries requisitions no better-ranked site holds`).toBe(true);
  });
});

const DEDUPE_ANCHOR = 'if (s.source === "oracle" && ORACLE_SITE_RANK.has(s.token)';
const readIndex = () => stripTsComments(readFileSync(resolve(FN_DIR, "index.ts"), "utf8"));

describe("guard 3 — a dedupe exit is OUR action: untracked, never a closure", () => {
  it("the dedupe block exists at its anchor in index.ts", () => {
    expect(readIndex()).toContain(DEDUPE_ANCHOR);
  });

  it("the edge function's dedupe exit row carries exit_reason untracked, a stamped duration, and no closure field", () => {
    const block = blockAfter(readIndex(), DEDUPE_ANCHOR);
    const fn = blockAfter(block, "const exitRow = (r: Record<string, unknown>) =>");
    expect(fn).toMatch(/exit_reason:\s*"untracked"/);
    expect(fn).toMatch(/const t = tenureDays\(/);
    expect(fn).toMatch(/days_on_board:\s*t\.days/);
    expect(fn).toMatch(/origin_basis:\s*t\.basis/);
    for (const forbidden of ['"removed"', '"aged_out"', '"backdated"', "closures", "absence_basis", "closed_at", "superseded"]) {
      expect(fn, `dedupe exit row must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("the dedupe block ledgers through insertExits with that row, deletes by id, and removes shed rows from the stored set before the absence logic", () => {
    const idx = readIndex();
    const block = blockAfter(idx, DEDUPE_ANCHOR);
    expect(block).toContain("planOracleSubsiteVisit({");
    expect(block).toMatch(/await insertExits\(client, shedRows\.map\(exitRow\)/);
    expect(block).toMatch(/\.from\("job_board_postings"\)\.delete\(\)\.in\("id"/);
    expect(block).toContain("existingRows.splice(");
    expect(block).not.toContain("job_board_closures");
    // The block READS missing_since (a stamped holder does not own a
    // requisition) and never WRITES it: no stamp, no update, no toStamp.
    expect(block).not.toMatch(/missing_since:/);
    expect(block).not.toMatch(/\.update\(/);
    expect(block).not.toContain("toStamp");
    // The block must precede the stored-set derivation it protects.
    expect(idx.indexOf(DEDUPE_ANCHOR)).toBeLessThan(idx.indexOf("const existingById = new Map(existingRows.filter"));
    // And the rows it drops must leave `rows` (what newRows is filtered from), not only rowsById.
    expect(block).toContain("rows.splice(0, rows.length");
  });

  it("the holder lookup is paged past PostgREST's 1,000-row cap, carries missing_since, and tells the planner whether the read was full", () => {
    const block = blockAfter(readIndex(), DEDUPE_ANCHOR);
    // A Cummins key has 10 holders; 200 keys x 10 = 2,000 rows, silently cut
    // to 1,000 by an unpaged .in(). The read must page by id until a short page.
    expect(block).toMatch(/\.select\(`\$\{LIFECYCLE_SELECT\}, req_key, missing_since`\)/);
    expect(block).toMatch(/\.in\("req_key", chunk\)\s*\.order\("id"\)\s*\.range\(from, from \+ 999\)/);
    expect(block).toMatch(/if \(page\.length < 1000\) break;/);
    expect(block).toMatch(/missing: row\.missing_since != null/);
    // PROPERTY, NOT SPELLING. This pinned `fullRead: r.windowed !== true` and
    // collided with a-window-of-ours-is-not-a-closure-of-theirs, which requires
    // every reader of the flag to spell it `X.windowed === true` so three
    // derivations cannot drift into three meanings. The property here is that
    // the planner is handed the COMPLEMENT of that one canonical read.
    expect(block).toMatch(/const windowedRead = r\.windowed === true;[\s\S]{0,600}?fullRead: !windowedRead\b/);
    // A shed row the lookup did not return is read by id before it is ledgered.
    expect(block).toMatch(/const unread = shed\.filter\(\(id\) => !holderRows\.has\(id\)\)/);
    expect(block).toMatch(/\.select\(LIFECYCLE_SELECT\)\s*\.in\("id", unread\.slice/);
  });

  it("the board-state row reads its state from what the site SERVED, not from what survived the dedupe", () => {
    const idx = readIndex();
    expect(idx.indexOf("const servedThisVisit = rowsById.size;")).toBeLessThan(idx.indexOf(DEDUPE_ANCHOR));
    expect(idx).toMatch(/servedThisVisit === 0 \? \(existingById\.size > 0 \? "dark" : "empty"\) : "ok"/);
    expect(idx).not.toMatch(/rows\.length === 0 \? \(existingById\.size > 0 \? "dark" : "empty"\)/);
  });

  it("the repair SQL keeps the best-ranked LIVE copy: a stamped row never beats a live one, and unranked copies are left to the prune", () => {
    const sql = stripSqlComments(readFileSync(MIGRATION, "utf8"));
    const fn = /CREATE OR REPLACE FUNCTION public\.repair_oracle_subsite_duplicates[\s\S]*?\$fn\$;/.exec(sql)?.[0] ?? "";
    expect(fn).toMatch(/row_number\(\) OVER \(PARTITION BY r\.req_key ORDER BY \(r\.missing_since IS NULL\) DESC, r\.rank ASC, r\.id\)/);
    // Same population rule as the planner: only ranked holders take part.
    expect(fn).toMatch(/AND p\.req_key IS NOT NULL\s+AND \(ranks ->> p\.company_token\) IS NOT NULL/);
    expect(fn).not.toMatch(/NULLS LAST/);
    // And the verify pass counts ranked duplicates apart from the prune's.
    expect(fn).toMatch(/count\(\*\) FILTER \(WHERE ranked_n > 1\), count\(\*\) FILTER \(WHERE ranked_n <= 1\)/);
  });

  it("the repair SQL refuses its delete phase until a bundle that dedupes at ingest has answered, and 'done' is re-enterable", () => {
    const sql = stripSqlComments(readFileSync(MIGRATION, "utf8"));
    const fn = /CREATE OR REPLACE FUNCTION public\.repair_oracle_subsite_duplicates[\s\S]*?\$fn\$;/.exec(sql)?.[0] ?? "";
    // The receipt: oracle_site_rank.version (only .68+ stamps it; the seed
    // carries none) or the high-water reset done (only a smaller catalog can).
    expect(fn).toMatch(/k = 'oracle_site_rank' AND \(v ->> 'version'\) IS NOT NULL/);
    expect(fn).toMatch(/k = 'oracle_subsite_highwater_reset' AND \(v ->> 'state'\) = 'done'/);
    expect(fn).toMatch(/ELSIF NOT v_bundle_ok THEN/);
    expect(fn.indexOf("ELSIF NOT v_bundle_ok THEN")).toBeLessThan(fn.indexOf("DELETE FROM public.job_board_postings"));
    expect(fn).toMatch(/p_restart boolean DEFAULT false/);
    expect(fn).toMatch(/IF p_restart OR v_nullkeys > 0 OR v_remaining > 0 THEN/);
    expect(fn).toMatch(/cron\.schedule\('oracle-subsite-repair'/);
    // The seed never carries a version, so the receipt cannot be forged by the migration itself.
    const seed = /VALUES \('oracle_site_rank',[\s\S]*?ON CONFLICT \(k\) DO NOTHING/.exec(sql)?.[0] ?? "";
    expect(seed.length).toBeGreaterThan(100);
    expect(seed).not.toMatch(/"version"|'version'/);
    // And the bundle stamps it whenever its version differs, not only when the hash does.
    expect(readIndex()).toMatch(/rankStored\?\.hash !== rankHash \|\| rankStored\?\.version !== BUILD_VERSION/);
  });

  it("the index watcher never drops a build in flight and never queues an ACCESS EXCLUSIVE lock on the hot table", () => {
    const sql = stripSqlComments(readFileSync(MIGRATION, "utf8"));
    const watch = /'oneshot-oracle-req-key-idx-watch', '\* \* \* \* \*',[\s\S]*?\$job\$\);/.exec(sql)?.[0] ?? "";
    expect(watch.length).toBeGreaterThan(200);
    expect(watch).toMatch(/pg_stat_progress_create_index/);
    expect(watch).toMatch(/IF NOT v_building THEN/);
    expect(watch).toMatch(/SET LOCAL lock_timeout = '2s';\s*DROP INDEX IF EXISTS public\.job_board_postings_req_key_idx;/);
    expect(watch).toMatch(/EXCEPTION WHEN lock_not_available THEN/);
  });

  it("the high-water reset cron stops only after the lowered mark held for two ticks", () => {
    const sql = stripSqlComments(readFileSync(MIGRATION, "utf8"));
    const reset = /'oracle-catalog-highwater-reset', '\*\/5 \* \* \* \*',[\s\S]*?\$job\$\);/.exec(sql)?.[0] ?? "";
    expect(reset.length).toBeGreaterThan(200);
    expect(reset).toMatch(/done_candidate_at/);
    expect(reset).toMatch(/interval '9 minutes'/);
    // The unschedule sits inside the confirmed branch, after the candidate check.
    expect(reset.indexOf("done_candidate_at")).toBeLessThan(reset.indexOf("cron.unschedule('oracle-catalog-highwater-reset')"));
  });

  it("the repair SQL writes exits as untracked, never closures, never an absence_basis, and only after reading the row it deletes", () => {
    const sql = stripSqlComments(readFileSync(MIGRATION, "utf8"));
    const fn = /CREATE OR REPLACE FUNCTION public\.repair_oracle_subsite_duplicates[\s\S]*?\$fn\$;/.exec(sql)?.[0] ?? "";
    expect(fn.length).toBeGreaterThan(1000);
    expect(fn).toMatch(/INSERT INTO public\.job_board_exits[\s\S]*?'untracked'/);
    expect(fn).not.toMatch(/job_board_closures/);
    expect(fn).not.toMatch(/absence_basis/);
    for (const other of ["'removed'", "'aged_out'", "'backdated'", "'board_dormant'"]) expect(fn).not.toContain(other);
    // Ledger before delete.
    expect(fn.indexOf("INSERT INTO public.job_board_exits")).toBeLessThan(fn.indexOf("DELETE FROM public.job_board_postings"));
    // The reason is admitted by the ledger's CHECK.
    const check = stripSqlComments(readFileSync(EXITS_CHECK_MIGRATION, "utf8"));
    expect(check).toMatch(/CHECK \(exit_reason IN \([^)]*'untracked'[^)]*\)\)/);
    // Its own input: the function groups the live table, and nothing in it reads the estimate.
    expect(fn).toMatch(/GROUP BY req_key\s+HAVING count\(\*\) > 1/);
    expect(fn).toMatch(/pg_try_advisory_xact_lock/);
  });

  it("the repair refuses its delete phase until the req_key index is valid, and stops its own cron when done", () => {
    const sql = stripSqlComments(readFileSync(MIGRATION, "utf8"));
    expect(sql).toMatch(/ELSIF NOT v_index_ok THEN/);
    expect(sql).toMatch(/cron\.unschedule\('oracle-subsite-repair'\)/);
    expect(sql).toMatch(/CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_postings_req_key_idx/);
    // The high-water mark is lowered only through the maintenance action, never by writing the row.
    expect(sql).toMatch(/'resetCatalogHighwater', true/);
    expect(sql).not.toMatch(/UPDATE public\.job_board_meta[\s\S]{0,200}k = 'catalog_highwater'/);
    expect(sql).not.toMatch(/VALUES \('catalog_highwater'/);
  });
});
