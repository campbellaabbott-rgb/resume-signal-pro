// THE DEPLOY AND THE SCRIPT MIRROR THE SAME NAMES.
//
// The matcher compares filers against layoff_board_names, and two things
// write that table: the deployed function (action "mirror", from the
// catalogue module its bundle imports) and the operator script (from the
// catalogue the text reader in src/test/helpers/catalog.ts parses). The rule
// is one module; the READERS are two, and the 2026-09-06 repack proved a
// reader can go 99% blind without a test failing. So the parity test here
// runs the real script in its --emit mode (node, tsx, the text parser) and
// requires the same (vendor, company_token, display_name) set the function
// would post today. Both sides carry a size floor so a blind parse on each
// cannot agree on nothing.
//
// The entry point serves on import, so its contract (chunking under one
// run_started_at, pruning on the last chunk only, the read-log kind, the
// chain gate) is read from the source with comments stripped.
//
// Run: deno test --config supabase/functions/deno.json --allow-read --allow-env --allow-run supabase/functions/layoff-filings/

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildMirrorRows, FACET_VENDOR, MIRROR_KEY_SEP, mirrorRowKey } from "./mirror-rows.ts";
import type { MirrorRow } from "./mirror-rows.ts";
import { deployMirrorRows } from "./mirror-catalogue.ts";

const REPO = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const RAW = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, "\n").replace(/^\s*\/\/.*$/gm, "");

/** The catalogue is tens of thousands of boards; a parity check that passes on fewer is a blind parse agreeing with itself. */
const MIN_ROWS = 20_000;

Deno.test("the rule: one row per entry, a facet row only where the facet name differs, an uncatalogued facet token skipped and counted", () => {
  const catalog = [
    { name: "Tysonfoods", source: "workday", token: "tysonfoods~wd1~External" },
    { name: "Wf", source: "workday", token: "wf~wd1~WellsFargoJobs" },
    { name: "Stripe", source: "greenhouse", token: "stripe" },
    { name: "Stripe", source: "lever", token: "stripe" },
  ];
  const aliases = {
    tysonfoods: { name: "Tyson Foods", tokens: ["tysonfoods~wd1~External"] },
    wellsfargo: { name: "Wells Fargo", tokens: ["wf~wd1~WellsFargoJobs"] },
    stripe: { name: "Stripe", tokens: ["stripe"] },
    gone: { name: "Gone Inc", tokens: ["gone~wd1~External"] },
  };
  const b = buildMirrorRows(catalog, aliases);
  assertEquals(b.catalogue, 4);
  assertEquals(b.facet, 2);
  assertEquals(b.facetSkipped, 1);
  assertEquals(b.rows.length, 6);
  assertEquals(b.rows.slice(0, 4), catalog.map((e) => ({ vendor: e.source, company_token: e.token, display_name: e.name })));
  assertEquals(b.rows.slice(4), [
    { vendor: FACET_VENDOR, company_token: "tysonfoods~wd1~External", display_name: "Tyson Foods" },
    { vendor: FACET_VENDOR, company_token: "wf~wd1~WellsFargoJobs", display_name: "Wells Fargo" },
  ]);
  // A same-name facet entry adds nothing; the facet rows can be left out.
  const bare = buildMirrorRows(catalog, aliases, { withFacetNames: false });
  assertEquals(bare.rows.length, 4);
  assertEquals(bare.facet, 0);
  assertEquals(bare.facetSkipped, 0);
});

Deno.test("the parity key separates its columns: two rows whose columns concatenate alike are two keys, and no live column carries the separator", () => {
  const a = { vendor: "facet", company_token: "x", display_name: "N" };
  const b = { vendor: "face", company_token: "tx", display_name: "N" };
  assertEquals(`${a.vendor}${a.company_token}${a.display_name}`, `${b.vendor}${b.company_token}${b.display_name}`);
  assert(mirrorRowKey(a) !== mirrorRowKey(b), "a bare concatenation would read these as one row");
  assertEquals(mirrorRowKey(a).split(MIRROR_KEY_SEP), ["facet", "x", "N"]);
  assertEquals(MIRROR_KEY_SEP, "\u0001");
  // The separator is spelled as an escape in the source, never as the raw byte an editor could drop.
  const src = Deno.readTextFileSync(new URL("./mirror-rows.ts", import.meta.url));
  assert(!src.includes("\u0001"), "mirror-rows.ts carries a raw U+0001 byte");
  assertStringIncludes(src, 'MIRROR_KEY_SEP = "\\u0001"');
  for (const r of deployMirrorRows().rows) {
    assert(!r.vendor.includes(MIRROR_KEY_SEP) && !r.company_token.includes(MIRROR_KEY_SEP) && !r.display_name.includes(MIRROR_KEY_SEP), JSON.stringify(r));
  }
});

Deno.test("parity: the function's rows and the script's rows are one set over today's catalogue", async () => {
  const cmd = new Deno.Command("node", {
    args: ["scripts/layoff-board-names-mirror.mjs", "--emit"],
    cwd: REPO,
    stdout: "piped",
    stderr: "piped",
  });
  const out = await cmd.output();
  const stderr = new TextDecoder().decode(out.stderr);
  assert(out.success, `the script failed: ${stderr.slice(0, 600)}`);
  const scriptRows = JSON.parse(new TextDecoder().decode(out.stdout)) as MirrorRow[];
  const deploy = deployMirrorRows();

  assert(scriptRows.length >= MIN_ROWS, `the script emitted ${scriptRows.length} rows; a short parse is a blind one`);
  assert(deploy.rows.length >= MIN_ROWS, `the deploy built ${deploy.rows.length} rows; a short catalogue is a broken import`);

  const ofDeploy = new Set(deploy.rows.map(mirrorRowKey));
  const ofScript = new Set(scriptRows.map(mirrorRowKey));
  // Both sides are sets already: the mirror keys (vendor, token) and neither reader may emit a key twice.
  assertEquals(ofDeploy.size, deploy.rows.length, "the deploy's rows repeat a (vendor, token, name)");
  assertEquals(ofScript.size, scriptRows.length, "the script's rows repeat a (vendor, token, name)");

  const onlyDeploy = deploy.rows.filter((r) => !ofScript.has(mirrorRowKey(r)));
  const onlyScript = scriptRows.filter((r) => !ofDeploy.has(mirrorRowKey(r)));
  const show = (rs: MirrorRow[]) => JSON.stringify(rs.slice(0, 5));
  assertEquals(
    [onlyDeploy.length, onlyScript.length],
    [0, 0],
    `the two readers disagree: deploy-only=${onlyDeploy.length} ${show(onlyDeploy)} script-only=${onlyScript.length} ${show(onlyScript)}`,
  );
  assertEquals(deploy.rows.length, scriptRows.length);
  // The counts the script prints are the deploy's counts too.
  assertStringIncludes(stderr, `catalogue=${deploy.catalogue} facet_rows=${deploy.facet} facet_skipped_uncatalogued=${deploy.facetSkipped} rows=${deploy.rows.length}`);
});

Deno.test("the deploy's rows carry no duplicate (vendor, token) key and hold the names lane 3 matched exactly", () => {
  const deploy = deployMirrorRows();
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const r of deploy.rows) {
    const k = [r.vendor, r.company_token].join(MIRROR_KEY_SEP);
    if (seen.has(k)) dups.push(k);
    seen.add(k);
  }
  assertEquals(dups, []);
  const facetNames = new Set(deploy.rows.filter((r) => r.vendor === FACET_VENDOR).map((r) => r.display_name));
  for (const n of ["Tyson Foods", "Wells Fargo", "Stanley Black & Decker", "Baker Hughes", "CVS Health"]) {
    assert(facetNames.has(n), `${n} is not among the second names`);
  }
  // Every facet row names a token the catalogue carries under a real vendor.
  const catalogued = new Set(deploy.rows.filter((r) => r.vendor !== FACET_VENDOR).map((r) => r.company_token));
  for (const r of deploy.rows) if (r.vendor === FACET_VENDOR) assert(catalogued.has(r.company_token), r.company_token);
});

Deno.test("index.ts: the mirror action chunks under ONE run_started_at, prunes on the last chunk only, and stops at the first failed chunk", () => {
  assert(/case "mirror": return await runMirror\(client, body\);/.test(CODE));
  assertStringIncludes(CODE, "const built = deployMirrorRows();");
  assertStringIncludes(CODE, "const runStartedAt = new Date().toISOString();");
  assertEquals([...CODE.matchAll(/new Date\(\)\.toISOString\(\)/g)].length >= 1, true);
  assertStringIncludes(CODE, "const isLast = i === chunks.length - 1;");
  assertStringIncludes(CODE, 'client.rpc("layoff_board_names_mirror", { p_rows: chunk, p_run_started_at: runStartedAt, p_prune: isLast })');
  assertEquals([...CODE.matchAll(/layoff_board_names_mirror"/g)].length, 1, "one call site, one run_started_at");
  // A failed chunk throws out of the loop before the last chunk can pass p_prune.
  assert(/if \(error\) throw new Error\(`layoff_board_names_mirror chunk \$\{i \+ 1\}\/\$\{chunks\.length\}: \$\{error\.message\}`\);/.test(CODE));
  // Nothing here normalises a name: display_norm is the writer's.
  assert(!/layoff_norm/.test(CODE.slice(CODE.indexOf("async function runMirror"), CODE.indexOf("// ── the handler"))));
  assert(!/display_norm/.test(CODE));
});

Deno.test("index.ts: the mirror writes its read-log row as kind mirror with rows and total, prints the grep-able line, and chains only on chain:true after a good run", () => {
  assert(/type LogKind = [^;]*"mirror"/.test(CODE), "the read-log kind union admits mirror");
  assert(/readLog\(client, "mirror", \{\s*fetched: tally\.rows, kept: tally\.total, newRows: tally\.upserted, ok, ms,/.test(CODE));
  assertStringIncludes(CODE, "[layoff-filings] kind=mirror rows=${tally.rows} catalogue=${tally.catalogue} facet=${tally.facet}");
  assertStringIncludes(CODE, "upserted=${tally.upserted} pruned=${tally.pruned} total=${tally.total}");
  assertStringIncludes(CODE, "const chain = body.chain === true;");
  assert(/if \(ok && chain\) \{\s*chained\.push\(await rebuildMatches\(client\)\);\s*chained\.push\(await refreshPartition\(client\)\);\s*\}/.test(CODE));
  // A chained matcher or partition failure is reported in its line, never thrown: the response must
  // carry it as chainOk and answer 500, or a caller reads a failed rebuild as success.
  assertStringIncludes(CODE, 'const chainOk: boolean | null = chained.length === 0 ? null : chained.every((l) => !/ ok=false/.test(l));');
  assert(/return json\(\{ ok, kind: "mirror", \.\.\.tally, runStartedAt, chained, chainOk, ms, note, version: BUILD_VERSION \}, ok && chainOk !== false \? 200 : 500\);/.test(CODE));
  // The lines it reads are the ones the two helpers print on failure.
  assertStringIncludes(CODE, "`[layoff-filings] kind=matcher ok=false error=");
  assertStringIncludes(CODE, "`[layoff-filings] kind=partition ok=false error=");
});

Deno.test("the migration that admits the mirror kind lists every kind the function writes", () => {
  const dir = `${REPO}/supabase/migrations`;
  const files = [...Deno.readDirSync(dir)].map((e) => e.name).filter((n) => n.endsWith(".sql")).sort();
  const admits = files.filter((n) => {
    const sql = Deno.readTextFileSync(`${dir}/${n}`).replace(/^\s*--.*$/gm, "");
    return /ADD CONSTRAINT layoff_read_log_kind_check/.test(sql);
  });
  assertEquals(admits.length, 1, `exactly one migration widens the read-log kind check: ${admits.join(", ")}`);
  const sql = Deno.readTextFileSync(`${dir}/${admits[0]}`).replace(/^\s*--.*$/gm, "");
  const m = /CHECK \(kind IN \(([^)]*)\)\)/.exec(sql);
  assert(m, "the widened check names its kinds inline");
  const kinds = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  const union = /type LogKind = ([^;]*);/.exec(CODE)![1];
  const written = [...union.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  for (const k of [...written, "matcher", "partition"]) assert(kinds.includes(k), `the check does not admit ${k}`);
  assertEquals(kinds, ["edgar_atom", "edgar_backfill", "edgar_fts_audit", "matcher", "mirror", "partition", "warn"]);
});
