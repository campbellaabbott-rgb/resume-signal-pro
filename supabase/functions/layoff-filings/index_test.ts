// (These files are named *_test.ts, Deno's other test suffix, so vitest --
// whose default include is *.test.ts and whose loader cannot follow a
// https: import -- never sweeps them into the repo's npm test run.)
//
// The entry point cannot be imported by a test (it serves on import), so
// its contract is read from the source with comments stripped: the actions
// it dispatches, the read-log kinds it writes, the log-line shapes the
// heartbeat greps, the mirror constants the site's copy derives from, and
// the two rate-limit RPCs it must never call.
//
// Run: deno test --allow-read --allow-env supabase/functions/layoff-filings/

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const RAW = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, "\n").replace(/^\s*\/\/.*$/gm, "");

Deno.test("the eight actions dispatch, and nothing else is an action", () => {
  const actions = ["edgar", "edgar_audit", "edgar_backfill", "warn", "matches", "partition", "mirror", "lca_wages"];
  for (const a of actions) {
    assert(new RegExp(`case "${a}":`).test(CODE), `action ${a}`);
  }
  assertEquals([...CODE.matchAll(/^\s*case "([a-z_]+)":/gm)].map((m) => m[1]).sort(), [...actions].sort());
  assertStringIncludes(CODE, 'default: return json({ error: `unknown action');
});

Deno.test("every run writes its read-log kind and prints the grep-able line the heartbeat expects", () => {
  for (const k of ["edgar_atom", "edgar_fts_audit", "edgar_backfill", "warn", "mirror", "lca_wages"]) {
    assert(new RegExp(`readLog\\(client, "${k}"`).test(CODE), `read log for ${k}`);
  }
  assertStringIncludes(CODE, "[layoff-filings] kind=edgar_atom fetched=");
  assertStringIncludes(CODE, "kept=${tally.kept} new=${tally.newRows} amend=${tally.amend}");
  assertStringIncludes(CODE, "[layoff-filings] kind=warn state=${f.state} feed=${f.feed}");
  assertStringIncludes(CODE, "latest_public=${latest ?? \"-\"} extract_failed=${extractFailed ?? \"-\"} stale=${stale}");
  assertStringIncludes(CODE, "[layoff-filings] kind=matcher exact_multitoken=");
  assertStringIncludes(CODE, "refused_single=${r?.lm_refused_single ?? 0} refused_ambiguous=${r?.lm_refused_ambiguous ?? 0}");
  assertStringIncludes(CODE, "[layoff-filings] kind=edgar_fts_audit fetched=");
  assertStringIncludes(CODE, "fts_only=${ftsOnly}");
  assertStringIncludes(CODE, "[layoff-filings] kind=mirror rows=");
  assertStringIncludes(CODE, "[layoff-filings] kind=lca_wages cells=");
});

Deno.test("the mirror constants are spelled once each, as src/config/layoffs.ts and the cross-runtime guard read them", () => {
  const want: Record<string, string> = {
    LAYOFF_LOOKBACK_DAYS: "90",
    LAYOFF_DISPLAY_MAX_AGE_DAYS: "90",
    LAYOFF_WARN_MIN_WORKERS: "50",
    LAYOFF_MIN_ARM_EMPLOYERS: "10",
    LAYOFF_MAX_EMPLOYER_SHARE: "0.40",
    LAYOFF_FEED_STALE_DAYS: "21",
    LAYOFF_RETENTION_DAYS: "365",
  };
  for (const [k, v] of Object.entries(want)) {
    const m = [...CODE.matchAll(new RegExp(`export const ${k} = ([\\d.]+);`, "g"))];
    assertEquals(m.length, 1, k);
    assertEquals(m[0][1], v, k);
  }
  assert(/export const LAYOFF_STALE_HOURS = \{ edgar: 6, warn: 48 \};/.test(CODE));
  assert(/export const LAYOFF_READ_CADENCE = \{ edgar: "hourly", warn: "nightly" \};/.test(CODE));
});

Deno.test("the poller never passes through the request budget and never lets the SEC floor above the published ceiling", () => {
  assert(!CODE.includes("check_rate_limit"));
  assert(!CODE.includes("check_global_rate_limit"));
  // Two intervals for sec.gov: 500 ms on the hourly poll and the audit, 250 ms on the backfill. The SEC's
  // ceiling is 10 requests a second; a 100 ms floor sits ON it, so every floor must be at least the
  // backfill's 250 ms (4/s), and the hourly poll and the audit at least 500 ms.
  const intervals = [...CODE.matchAll(/secHttp\((\d+)\)/g)].map((m) => +m[1]);
  assert(intervals.length >= 3);
  assert(intervals.every((ms) => ms >= 250), `sec.gov floor ${JSON.stringify(intervals)}`);
  assertEquals(intervals.filter((ms) => ms >= 500).length, 2, "the hourly poll and the audit run at 2/s");
  // The contact address rides the User-Agent.
  assertStringIncludes(CODE, "ResumeSignalPro layoff-filings (${SEC_CONTACT})");
  // The cron secret header is the only door.
  assertStringIncludes(CODE, 'req.headers.get("x-layoff-cron")');
  assertStringIncludes(CODE, 'client.rpc("layoff_cron_key_matches", { p_key: sent })');
  assert(/return json\(\{ error: "unauthorised" \}, 401\)/.test(CODE));
});

Deno.test("the writers are the SQL functions lane A shipped, called through the service client", () => {
  assertStringIncludes(CODE, 'client.rpc("layoff_filings_upsert", { p_rows: chunk })');
  assertStringIncludes(CODE, 'client.rpc("layoff_matches_rebuild")');
  assertStringIncludes(CODE, 'client.rpc("refresh_layoff_partition")');
  assertStringIncludes(CODE, 'client.rpc("layoff_board_names_mirror", { p_rows: chunk, p_run_started_at: runStartedAt, p_prune: isLast })');
  assertStringIncludes(CODE, "getServiceClient()");
  // Nothing here reads a filing for a surface: the only select on the table asks for ids it is about to write.
  const selects = [...CODE.matchAll(/from\("layoff_filings"\)\.select\("([^"]*)"\)/g)].map((m) => m[1]);
  assertEquals(selects, ["filing_id"]);
});

Deno.test("a slice's ok is decided by feedVerdict, and the run reader follows the last feed rather than preceding the first", () => {
  // The verdict function is tested behaviourally in warn_test.ts; here the entry point must be the one calling it.
  assertStringIncludes(CODE, "const v = feedVerdict(r, f.map);");
  assert(/if \(v === "refused"\) notes\.push\(`refused=\$\{f\.key\}`\);\s*else \{ allOk = false;/.test(CODE));
  // recordExtractFailures is awaited inside the `done` branch, after the loop, and nowhere before it.
  const loopAt = CODE.indexOf("for (let i = cursor; i < end; i++)");
  const doneAt = CODE.indexOf("const done = next >= WARN_FEEDS.length;");
  const extractAt = CODE.indexOf("notes.push(await recordExtractFailures(client, http));");
  assert(loopAt > 0 && doneAt > loopAt && extractAt > doneAt, `loop@${loopAt} done@${doneAt} extract@${extractAt}`);
  assertEquals([...CODE.matchAll(/recordExtractFailures\(client, http\)/g)].length, 1);
});

Deno.test("the gateway lets the cron in: config.toml turns JWT verification off for this function, as it does for job-board", () => {
  const toml = Deno.readTextFileSync(new URL("../../config.toml", import.meta.url));
  assert(/\[functions\.layoff-filings\]\s*\n\s*verify_jwt = false/.test(toml), "config.toml must carry [functions.layoff-filings] verify_jwt = false");
  assert(/\[functions\.job-board\]\s*\n\s*verify_jwt = false/.test(toml));
});
