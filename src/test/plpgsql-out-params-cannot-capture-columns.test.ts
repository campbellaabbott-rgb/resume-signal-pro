import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A PL/pgSQL FUNCTION SHIPPED A 400 ON EVERY CALL.
 *
 *   {"code":"42702","message":"column reference \"superseded\" is ambiguous",
 *    "details":"It could refer to either a PL/pgSQL variable or a table column."}
 *
 * get_board_flow was rewritten from LANGUAGE sql to LANGUAGE plpgsql. That
 * rewrite turns every name in `RETURNS TABLE (...)` into an OUT PARAMETER that
 * is in scope for the whole body. One of them — `superseded` — is also a column
 * on job_board_closures, and the body referenced it bare:
 *
 *     count(*) FILTER (WHERE superseded)
 *
 * The identical line was CORRECT in the LANGUAGE sql version, because SQL
 * functions have no such scope. The ambiguity was manufactured by a declaration
 * forty lines away, which is precisely why reading the changed lines did not
 * catch it — and why this check is mechanical rather than a habit.
 *
 * THE RULE: inside a plpgsql body, any name that is BOTH an OUT parameter and a
 * real column of a table the body reads must be qualified through an alias.
 * Qualifying costs nothing; the collision list changes every time someone edits
 * a return shape.
 */
const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");

/** Column names of the tables these functions actually read. */
const COLUMNS_BY_TABLE: Record<string, string[]> = {
  job_board_closures: ["superseded", "closed_at", "posting_id", "company_token", "category", "first_seen", "posted_at", "source", "company", "title"],
  job_board_postings: ["first_seen", "last_seen", "missing_since", "effective_posted", "posted_at", "category", "source", "company_token", "remote", "salary", "title", "location", "work_mode"],
  job_board_exits: ["exited_at", "exit_reason", "days_on_board", "posting_id", "category", "source", "company_token"],
  job_board_pool_samples: ["sampled_at", "serving", "total"],
  // Added after the SECOND occurrence of this defect, 2026-08-26.
  api_keys: ["id", "key_hash", "key_prefix", "name", "owner_email", "tier", "rate_per_min", "daily_quota", "created_at", "last_used_at", "revoked_at", "notes", "user_id"],
  api_usage: ["key_id", "day", "endpoint", "calls"],
  api_rate: ["key_id", "minute", "calls"],
  // The Other-bucket anchor table (20260909224500): category_knn RETURNS TABLE
  // (id, field, title, sim) over exactly these column names -- the third
  // function in the repo with this collision shape.
  job_board_category_anchors: ["id", "version", "field", "title", "embedding", "loaded_at"],
  // The MCP server's unkeyed meter (20260915100000): mcp_anon_check RETURNS
  // TABLE five names over a three-column table, and its body writes the
  // table through ON CONFLICT -- the api_key_check shape exactly, so it is
  // held to the same zero-collision rule below.
  mcp_anon_rate: ["day", "bucket", "calls"],
  // The six-hour pass (20260917100000 onwards). api_key_check reads
  // agent_passes for its overlay; agent_pass_grant writes it;
  // agent_queue_enqueue writes agent_queue and increments the pass;
  // agent_pass_metrics reads all of these plus the two Stripe ledgers. Every
  // one of them is held to the zero-collision rule below.
  api_quota: ["key_id", "day", "calls"],
  agent_passes: [
    "id", "user_id", "stripe_session_id", "stripe_payment_intent_id", "amount_cents", "session_hours",
    "applications_total", "applications_used", "rate_per_min", "daily_quota", "purchased_at", "shelf_expires_at",
    "activated_at", "expires_at", "activated_via", "activated_user_agent", "closed_at", "close_reason", "created_at",
  ],
  agent_queue: [
    "id", "user_id", "posting_id", "title", "company", "company_token", "location", "apply_url", "salary",
    "category", "posted_at", "fit_pct", "reasons", "status", "created_at", "decided_at", "search_id", "search_label", "pass_id",
  ],
  agent_submissions: [
    "id", "user_id", "posting_id", "title", "company", "company_token", "apply_url", "source", "status",
    "fields", "questions", "questions_are_real", "answers", "blockers", "resume_version_id", "cover_letter", "fit_pct",
    "prepared_at", "submitted_at", "submitted_via", "error", "created_at", "updated_at", "released_at", "release_refusal",
    "claimed_at", "claimed_by", "attempts", "claimable_at", "sent_answers", "sent_evidence", "pass_id", "pass_refunded_at",
  ],
  used_stripe_sessions: ["session_id", "used_at", "ip_address", "product_type"],
  // The adoption reader (20260917200000) reads api_keys, api_usage,
  // mcp_anon_rate, agent_passes and this search log; it is held to the
  // zero-collision rule below, and this table's columns are the words a
  // naive per-day reader would pick (total, results, at, caller).
  job_board_search_events: [
    "id", "search_id", "q", "location", "filters", "route", "rescued", "results", "total", "offset_n", "at",
    "took_ms", "shown", "caller",
  ],
  product_deliveries: [
    "id", "created_at", "stripe_session_id", "customer_email", "product_type", "product_name", "amount_cents",
    "payment_completed_at", "content_generation_started_at", "content_generation_completed_at", "email_sent_at",
    "email_delivered_at", "status", "generation_success", "generation_error", "email_success", "email_error",
    "ai_response_valid", "ai_parse_error", "generation_duration_ms", "metadata", "ai_model_used", "max_retries",
    "next_retry_at", "retry_count",
  ],
  // The layoff-filings tables (20260918100000 onwards). layoff_matches_rebuild
  // reads five of them plus job_board_postings; refresh_layoff_partition joins
  // layoff_filings and layoff_matches to the closure ledgers, the postings,
  // the snapshots and the observability table. Every OUT name of those
  // writers carries a prefix (lm_, lw_, lu_, lb_, lr_) and every reader's
  // (lf_, la_, lp_), so none is a column here; the map exists so the strict
  // loop can see the tables at all.
  layoff_filings: [
    "filing_id", "source", "filer_raw", "filer_norm", "event_date", "event_basis", "public_date", "public_basis",
    "source_read_at", "source_url", "source_name", "status", "supersedes_id", "cik", "adsh", "form", "amends_adsh",
    "amend_unresolved", "section_text", "excerpt", "pct", "headcount", "headcount_basis", "timing_text",
    "is_workforce_event", "parse_confidence", "parser_version", "state", "feed", "bln_hash_id", "site_raw", "site_city",
    "site_county", "workers", "effective_date", "effective_raw", "event_type", "is_temporary", "notice_pdf_url",
    "first_seen_at", "last_seen_at",
  ],
  layoff_employer_aliases: [
    "alias_id", "alias_norm", "cik", "company_token", "relation", "state_scope", "decision", "evidence", "decided_at", "decided_by",
  ],
  layoff_board_names: ["vendor", "company_token", "display_name", "display_norm", "mirrored_at"],
  layoff_matches: ["filing_id", "company_token", "matched_via", "matched_norm", "alias_id", "relation", "matched_at"],
  layoff_feed_health: [
    "feed", "state", "last_ok_at", "last_attempt_at", "latest_public_date", "rows_last_run", "etag", "extract_failed", "stale", "note",
  ],
  layoff_read_log: ["id", "kind", "read_at", "fetched", "kept", "new_rows", "ok", "ms", "note"],
  layoff_filing_rollup: ["month", "source", "state", "filings", "workers_sum", "rolled_at"],
  job_board_layoff_partition: [
    "arm", "taken_down_30", "still_open_30", "still_open_30_lo", "still_open_30_hi", "half_width_30", "relist_rate_30",
    "n_at_risk_30", "employers_n", "max_employer_share", "gate_share_30", "sum_check_30", "cohort_from", "cohort_to",
    "sufficient_30", "insufficient_reason", "newest_filing_event_date", "warn_lag_p50_days", "warn_lag_n", "computed_at",
    "filings_read_at",
  ],
  job_board_board_observability: ["company_token", "bucket", "lap_w0", "as_of"],
  job_board_company_snapshots: ["company_token", "snapshot_date", "open_roles"],
};

/**
 * THE SILENT SKIP, ENDED. `tablesTouched` used to be "the tables in the map
 * that the body names" — so a body reading a table nobody had mapped was
 * checked against nothing and passed. That is how api_quota went unmapped
 * for three weeks under a guard written for the very function that reads
 * it. Now every `public.<name>` a checked body references must be a mapped
 * table (or a function it calls, or itself), or the test fails and names
 * the table to add.
 */
const FUNCTIONS_KNOWN = new Set<string>();
function unmappedTablesIn(body: string, self: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/(?<!FUNCTION\s)(?<!PERFORM\s)public\.([a-z_][a-z0-9_]*)/g)) {
    const name = m[1];
    if (name === self || name in COLUMNS_BY_TABLE || FUNCTIONS_KNOWN.has(name)) continue;
    // A call — `public.fn(` — is not a table read; but `INSERT INTO
    // public.t (cols)` and `UPDATE public.t` are, whatever follows them.
    const before = body.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0);
    const after = body.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 2);
    const tableKeyword = /\b(?:INTO|FROM|UPDATE|JOIN|TABLE|ON)\s+$/i.test(before);
    if (!tableKeyword && /^\s*\(/.test(after)) { FUNCTIONS_KNOWN.add(name); continue; }
    out.add(name);
  }
  return [...out].sort();
}

/** The plpgsql body of one function: from its AS $$ to the matching $$;. */
function bodyOfFunction(sql: string, fn: string): string {
  const defAt = sql.indexOf(`FUNCTION public.${fn}(`);
  if (defAt < 0) return "";
  const after = sql.slice(defAt);
  const bodyStart = after.indexOf("AS $$");
  const bodyEnd = after.indexOf("$$;", bodyStart + 5);
  return stripComments(after.slice(bodyStart + 5, bodyEnd < 0 ? after.length : bodyEnd));
}

/** Strip SQL comments so prose about a name is never mistaken for a reference. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The newest migration that defines this function — earlier ones are superseded. */
function newestDefining(fnName: string): { file: string; sql: string } {
  const files = readdirSync(MIG_DIR)
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .filter((n) => {
      // -a semantics: read as utf8 regardless; a NUL byte anywhere in a file
      // makes /usr/bin/grep skip it silently, and that has produced false
      // "no match" conclusions in this repo before.
      const s = readFileSync(resolve(MIG_DIR, n), "utf8");
      return new RegExp(`FUNCTION public\\.${fnName}\\s*\\(`).test(s);
    });
  const file = files[files.length - 1];
  return { file, sql: readFileSync(resolve(MIG_DIR, file), "utf8") };
}

describe("plpgsql OUT parameters cannot silently capture a column", () => {
  const { file, sql } = newestDefining("get_board_flow");

  it("is defined by a migration we can find", () => {
    expect(file, "no migration defines get_board_flow").toBeTruthy();
  });

  it("qualifies every OUT-parameter name that is also a column it reads", () => {
    const body = stripComments(sql.slice(sql.indexOf("AS $$"), sql.lastIndexOf("$$")));
    const outs = /RETURNS TABLE \(([\s\S]*?)\)\s*\nLANGUAGE/.exec(sql)?.[1] ?? "";
    expect(outs, "RETURNS TABLE not found").not.toBe("");
    const outNames = outs
      .split("\n")
      .map((l) => l.trim().split(/\s+/)[0])
      .filter(Boolean);

    // Which tables does this body actually read?
    const tablesRead = Object.keys(COLUMNS_BY_TABLE).filter((t) =>
      new RegExp(`public\\.${t}\\b`).test(body),
    );
    expect(tablesRead.length, "body reads no known table — update COLUMNS_BY_TABLE").toBeGreaterThan(0);

    const colliding = outNames.filter((n) =>
      tablesRead.some((t) => COLUMNS_BY_TABLE[t].includes(n)),
    );
    // `superseded` and `serving` collide today. If this list ever empties, the
    // check below is vacuous — so assert it is non-empty and the guard is real.
    expect(colliding.length, "expected at least one OUT name to collide with a column").toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const name of colliding) {
      // A bare reference: the name NOT preceded by `alias.` and not part of a
      // longer identifier. Declarations and the RETURN QUERY select list use
      // v_-prefixed locals, so they cannot match.
      const bare = new RegExp(`(?<![\\w.])${name}(?![\\w])`, "g");
      for (const m of body.matchAll(bare)) {
        const before = body.slice(Math.max(0, m.index! - 40), m.index!);
        // Allowed: inside the INSERT column list of a table we write, and in
        // the DECLARE/RETURN plumbing which only names v_ locals.
        if (/INSERT INTO[\s\S]*\($/.test(before)) continue;
        offenders.push(`${name} @ "...${before.slice(-32).replace(/\s+/g, " ")}[${name}]"`);
      }
    }
    expect(
      offenders,
      `unqualified reference to a name that is BOTH an OUT parameter and a real column — ` +
        `this is the 42702 that took get_board_flow down. Qualify it through a table alias ` +
        `(c.superseded, s.serving). Offenders:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("aliases every table it selects from", () => {
    const body = stripComments(sql.slice(sql.indexOf("AS $$"), sql.lastIndexOf("$$")));
    const unaliased: string[] = [];
    for (const m of body.matchAll(/FROM\s+public\.(\w+)\s*(\w*)/g)) {
      const [, table, alias] = m;
      if (!alias || /^(WHERE|ORDER|LIMIT|GROUP|ON|AND|INTO)$/i.test(alias)) unaliased.push(table);
    }
    expect(
      unaliased,
      `every table must carry an alias so its columns can be qualified: ${unaliased.join(", ")}`,
    ).toEqual([]);
  });
});

/**
 * THIRD SHAPE, 2026-09-14: category_knn (20260909225000) RETURNS TABLE (id,
 * field, title, sim) and reads job_board_category_anchors, whose columns ARE
 * id, field and title. It ships fully alias-qualified; this block is what
 * catches the regression, because the harness that executes the body is a
 * script nobody re-runs. A mutated copy with the select list unqualified
 * raises 42702 in pglite at CALL time and must turn this red.
 */
function unqualifiedCollisions(fn: string, sqlText: string): { outNames: string[]; colliding: string[]; offenders: string[] } {
  const defAt = sqlText.indexOf(`FUNCTION public.${fn}(`);
  const after = sqlText.slice(defAt);
  const outs = /RETURNS TABLE \(([\s\S]*?)\)\s*\nLANGUAGE/.exec(after)?.[1] ?? "";
  // One line or many: split on commas, first token of each is the OUT name.
  const outNames = outs.split(/,|\n/).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  // The plpgsql body alone: from AS $$ to the FIRST $$; -- the COMMENT ON
  // FUNCTION string and the DO blocks after it are not the body, and the
  // COMMENT legitimately says "as (id, field, title, sim)".
  const bodyStart = after.indexOf("AS $$");
  const bodyEnd = after.indexOf("$$;", bodyStart + 5);
  const body = stripComments(after.slice(bodyStart + 5, bodyEnd));
  const tablesRead = Object.keys(COLUMNS_BY_TABLE).filter((t) => new RegExp(`public\\.${t}\\b`).test(body));
  const colliding = outNames.filter((n) => tablesRead.some((t) => COLUMNS_BY_TABLE[t].includes(n)));
  const offenders: string[] = [];
  for (const name of colliding) {
    const bare = new RegExp(`(?<![\\w.])${name}(?![\\w])`, "g");
    for (const m of body.matchAll(bare)) {
      const before = body.slice(Math.max(0, m.index! - 40), m.index!);
      if (/INSERT INTO[\s\S]*\($/.test(before)) continue;
      offenders.push(`${name} @ "...${before.slice(-32).replace(/\s+/g, " ")}[${name}]"`);
    }
  }
  return { outNames, colliding, offenders };
}

describe("category_knn qualifies every OUT name that is also an anchor column", () => {
  const { file, sql } = newestDefining("category_knn");

  it("is defined by a migration we can find, and its OUT names collide with the anchor table by construction", () => {
    expect(file, "no migration defines category_knn").toBeTruthy();
    const r = unqualifiedCollisions("category_knn", sql);
    expect(r.outNames).toEqual(["id", "field", "title", "sim"]);
    expect(r.colliding.sort()).toEqual(["field", "id", "title"]);
  });

  it("every colliding name is alias-qualified in the body", () => {
    const r = unqualifiedCollisions("category_knn", sql);
    expect(r.offenders, `42702 at CALL time -- qualify through the alias a.: ${r.offenders.join("\n  ")}`).toEqual([]);
  });

  it("teeth: an unqualified select list is reported", () => {
    const bad = sql.replace("SELECT a.id, a.field, a.title, (1 - (a.embedding <=> q))::real", "SELECT id, field, title, (1 - (a.embedding <=> q))::real");
    expect(bad).not.toBe(sql);
    const r = unqualifiedCollisions("category_knn", bad);
    expect(r.offenders.length).toBe(3);
    // and a copy that only unqualifies the ORDER BY is caught too
    const bad2 = sql.replace("ORDER BY a.embedding <=> q, a.id", "ORDER BY a.embedding <=> q, id");
    expect(unqualifiedCollisions("category_knn", bad2).offenders.length).toBe(1);
  });
});

/**
 * SECOND OCCURRENCE, 2026-08-26 — and it cost the API its first working hour.
 *
 * api_key_check declared key_id, tier and daily_quota in RETURNS TABLE. All
 * three are real columns of api_keys / api_usage / api_rate, and the body used
 * one in an ON CONFLICT inference clause:
 *
 *     ON CONFLICT (key_id, minute) DO UPDATE ...
 *
 * Every authenticated call returned 42702 and the caller saw a flat 503. Key
 * ISSUANCE worked throughout, which is what disguised it: api_key_issue names
 * the same words but only inside an INSERT column list, and a column list is
 * not an expression, so nothing is substituted there. A key could be minted and
 * then never authenticated.
 *
 * The rule above says "qualify the collision through an alias". An ON CONFLICT
 * target cannot be alias-qualified, so for these functions the standard is
 * stricter and simpler: DO NOT COLLIDE. Every OUT name is checked against every
 * column of every table the body touches, and the answer must be none.
 */
/**
 * The pass RPCs (20260917110000 / 140000 / 160000) join the same loop: each
 * RETURNS TABLE over tables whose columns are exactly the words a naive
 * author would pick as OUT names (id, user_id, status, expires_at,
 * applications_used, pass_id …), and agent_queue_enqueue writes through ON
 * CONFLICT like api_key_check does. agent_pass_refund_on_failure returns a
 * trigger, not a table, and has no OUT names to collide.
 */
const STRICT_FUNCTIONS = [
  "api_key_check", "api_key_issue", "api_key_issue_agent", "mcp_anon_check",
  "agent_pass_grant", "agent_queue_enqueue", "agent_pass_metrics", "agent_adoption_metrics",
  // The layoff matcher and the partition writer (20260918100400 / 100700):
  // plpgsql, RETURNS TABLE, over the two locked layoff tables and the
  // closure ledgers. Both ship fully prefixed.
  "layoff_matches_rebuild", "refresh_layoff_partition",
];

describe("the API key functions do not name a column in their return shape", () => {
  // mcp_anon_check (20260915100000) meters the MCP server's unkeyed tier
  // the way api_key_check meters keys -- an ON CONFLICT upsert per bucket --
  // so the same stricter rule applies: no OUT name may be a column at all.
  for (const fn of STRICT_FUNCTIONS) {
    it(`${fn}: no OUT parameter shares a name with a column it touches`, () => {
      const { file, sql } = newestDefining(fn);
      expect(file, `no migration defines ${fn}`).toBeTruthy();
      const defAt = sql.indexOf(`FUNCTION public.${fn}(`);
      const outs = /RETURNS TABLE \(([\s\S]*?)\)\s*\nLANGUAGE/.exec(sql.slice(defAt))?.[1] ?? "";
      expect(outs, "RETURNS TABLE not found").not.toBe("");
      const outNames = outs.split("\n").map((l) => l.trim().split(/\s+/)[0].replace(/,$/, "")).filter(Boolean);
      expect(outNames.length, "parsed no OUT names — the check would be vacuous").toBeGreaterThan(3);

      // The function's OWN body, not the rest of the file: a migration that
      // defines two functions must not have the second one's tables read as
      // the first one's.
      const body = bodyOfFunction(sql, fn);
      expect(body.length, "body not found").toBeGreaterThan(100);
      expect(
        unmappedTablesIn(body, fn),
        `${fn} references a table absent from COLUMNS_BY_TABLE — an unmapped table is a silent skip; add its columns:`,
      ).toEqual([]);
      const tablesTouched = Object.keys(COLUMNS_BY_TABLE).filter((t) => new RegExp(`public\\.${t}\\b`).test(body));
      expect(tablesTouched.length, "body touches no known table — update COLUMNS_BY_TABLE").toBeGreaterThan(0);

      const colliding = outNames.filter((n) => tablesTouched.some((t) => COLUMNS_BY_TABLE[t].includes(n)));
      expect(
        colliding,
        `${fn} declares OUT parameter(s) that are also columns of ${tablesTouched.join(", ")}. ` +
          `An ON CONFLICT target cannot be alias-qualified, so this must be fixed by RENAMING ` +
          `the OUT parameter, not by qualifying it. Colliding:`,
      ).toEqual([]);
    });
  }
});

describe("teeth: an unmapped table is a failure, not a skip", () => {
  it("a body reading a table the map does not know is reported by name", () => {
    const { sql } = newestDefining("agent_queue_enqueue");
    const body = bodyOfFunction(sql, "agent_queue_enqueue");
    expect(unmappedTablesIn(body, "agent_queue_enqueue")).toEqual([]);
    const mutated = body.replace("public.agent_queue (", "public.agent_queue_shadow (");
    expect(mutated).not.toBe(body);
    expect(unmappedTablesIn(mutated, "agent_queue_enqueue")).toEqual(["agent_queue_shadow"]);
  });

  it("a function call, the function itself, and a comment are not table reads", () => {
    const body = stripComments(
      "-- public.commentary is prose\n" +
      "PERFORM public.agent_prepare_now();\n" +
      "SELECT public.some_fn(1) INTO v;\n" +
      "SELECT ap.id FROM public.agent_passes ap;",
    );
    expect(unmappedTablesIn(body, "agent_prepare_now")).toEqual([]);
  });

  it("the strict loop covers every pass RPC that returns a table", () => {
    for (const fn of ["agent_pass_grant", "agent_queue_enqueue", "agent_pass_metrics", "api_key_check", "agent_adoption_metrics"]) {
      expect(STRICT_FUNCTIONS).toContain(fn);
    }
    // api_key_check now reads agent_passes: the overlay must be visible to
    // the collision check, or a future OUT name like expires_at slips by.
    const { sql } = newestDefining("api_key_check");
    expect(bodyOfFunction(sql, "api_key_check")).toMatch(/public\.agent_passes\b/);
    // The adoption reader reads five tables; the collision check is only as
    // wide as the tables the body names, so all five must be visible to it.
    const reader = bodyOfFunction(newestDefining("agent_adoption_metrics").sql, "agent_adoption_metrics");
    for (const t of ["api_keys", "api_usage", "mcp_anon_rate", "agent_passes", "job_board_search_events"]) {
      expect(reader, `agent_adoption_metrics no longer reads public.${t}`).toMatch(new RegExp(`public\\.${t}\\b`));
    }
  });
});
