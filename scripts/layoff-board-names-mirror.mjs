// THE MATCHER READS THE NAMES THE DEPLOY MIRRORED, NEVER THE LIVE ONES.
//
// (No shebang, on purpose: the file was never executable and every caller
// runs `node scripts/...`; vite hoists an import helper above line 1 of a
// module that uses import(), and a shebang there breaks the vitest that
// imports mirrorRows.)
//
// Emits the rows for public.layoff_board_names and, with --apply, writes them
// through layoff_board_names_mirror(p_rows, p_run_started_at, p_prune) in
// chunks that all carry ONE run_started_at, pruning on the last chunk only
// (SPEC 2026-09-18 section 5 rule 2, section 6; lane A's contract).
//
// WHERE THE NAMES COME FROM. The catalogue is read through
// src/test/helpers/catalog.ts -- the one reader every catalogue guard shares --
// via a tsx require, never a grep of sources.ts: the packed literals hold
// 44k boards in 406 strings and a regex over the file sees 1% of them. Each
// entry becomes {vendor: source, company_token: token, display_name: name}.
//
// A SECOND NAME PER TOKEN. For the ~500 employers with 250 or more postings,
// supabase/functions/job-board/employer-aliases.ts records the name the
// board's own company facet shows -- "Tyson Foods" where the catalogue entry
// says "Tysonfoods", "Wells Fargo" where it says "Wf", "Stanley Black &
// Decker" where it says "Sbdinc" (85 multi-word names differ this way). The
// lane-3 measurement that found 18 exact WARN matches with zero wrong ones
// was made WITH those names, and without them the exact rule cannot see
// Tyson Foods, Baker Hughes or CVS Health. So every facet name that differs
// from the catalogue name for a catalogued token is emitted as a second row
// under vendor 'facet'; the mirror keys (vendor, token), the matcher keys the
// employer on the token's first '~' segment, so the extra row adds a spelling
// and never a second employer. A facet entry whose token is no longer in the
// catalogue is skipped (the facet file is regenerated, not hand-edited).
//
// ONE RULE, TWO RUNTIMES. Since 2026-09-21 the deployed layoff-filings
// function writes this mirror itself (action "mirror", daily by cron), from
// the catalogue its bundle imports. The row rule lives in
// supabase/functions/layoff-filings/mirror-rows.ts and is imported here
// unchanged (plain node strips the types; the module carries nothing else),
// so this script and the deploy cannot disagree on what a row is. What CAN
// disagree is the catalogue each side reads -- the text parser here, the
// runtime module there -- and the function's parity test runs this script
// with --emit and requires the same set. The .ts is imported natively where
// node strips types (22.18+ / 23.6+; the repo runs 25) and through the same
// tsx require the catalogue already needs where it does not (CI pins 20).
//
// USAGE
//   node scripts/layoff-board-names-mirror.mjs                 # dry run: counts to stdout
//   node scripts/layoff-board-names-mirror.mjs --out rows.json # write the rows
//   node scripts/layoff-board-names-mirror.mjs --emit          # the rows as JSON on stdout, counts on stderr
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/layoff-board-names-mirror.mjs --apply         # write to the database
//   --no-facet-names   leave the second-name rows out
//   --chunk 2000       rows per RPC call (default 2000)
//
// Nothing here reads a live name, calls check_rate_limit, or touches the
// job-board function. --apply is the only mode that talks to a database, and
// it stops at the first failed chunk without pruning.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const RULE = resolve(REPO, "supabase/functions/layoff-filings/mirror-rows.ts");

/** Require TypeScript modules through tsx for the duration of one call. Not under vitest: tsx's esbuild
 *  refuses that environment, which is why the vitest passes the catalogue in and never reaches here. */
function withTsx(fn) {
  const require = createRequire(`${REPO}/package.json`);
  const { register } = require("tsx/cjs/api");
  const unregister = register();
  try {
    return fn(require);
  } finally {
    unregister();
  }
}

/** The row rule, the function's own module: imported natively where node strips types (and under vitest,
 *  which transforms it), through tsx on a node that refuses a .ts import (20, the CI pin). */
async function loadRule() {
  try {
    return await import("../supabase/functions/layoff-filings/mirror-rows.ts");
  } catch (e) {
    if (e?.code !== "ERR_UNKNOWN_FILE_EXTENSION") throw e;
    return withTsx((require) => require(RULE));
  }
}
const { buildMirrorRows } = await loadRule();
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };

/** Read the catalogue and the facet names through the TypeScript modules. */
export function loadCatalogueAndFacet() {
  return withTsx((require) => {
    const { CATALOG } = require(`${REPO}/src/test/helpers/catalog.ts`);
    const { EMPLOYER_ALIASES } = require(`${REPO}/supabase/functions/job-board/employer-aliases.ts`);
    return { CATALOG, EMPLOYER_ALIASES };
  });
}

/** The rows the mirror takes: one per catalogue entry, plus a 'facet' row where the facet name differs.
 *  The catalogue and the facet map are loaded through tsx unless the caller passes them (a vitest does).
 *  The rule itself is the function's (mirror-rows.ts); this only feeds it the text-parsed catalogue. */
export function mirrorRows({ withFacetNames = true, catalog = null, employerAliases = null } = {}) {
  const loaded = catalog && employerAliases ? { CATALOG: catalog, EMPLOYER_ALIASES: employerAliases } : loadCatalogueAndFacet();
  const { CATALOG, EMPLOYER_ALIASES } = loaded;
  return buildMirrorRows(CATALOG, EMPLOYER_ALIASES, { withFacetNames });
}

async function apply(rows, { chunk }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("--apply needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment");
  const runStartedAt = new Date().toISOString();
  const chunks = [];
  for (let i = 0; i < rows.length; i += chunk) chunks.push(rows.slice(i, i + chunk));
  let last = null;
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/layoff_board_names_mirror`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: key, authorization: `Bearer ${key}` },
      body: JSON.stringify({ p_rows: chunks[i], p_run_started_at: runStartedAt, p_prune: isLast }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`chunk ${i + 1}/${chunks.length} failed with HTTP ${res.status}; nothing pruned: ${text.slice(0, 300)}`);
    }
    const body = JSON.parse(text);
    last = Array.isArray(body) ? body[0] : body;
    console.log(`[layoff-board-names-mirror] chunk=${i + 1}/${chunks.length} rows=${chunks[i].length} upserted=${last.lb_upserted} pruned=${last.lb_pruned} total=${last.lb_total} run_started_at=${runStartedAt}`);
  }
  return last;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { rows, catalogue, facet, facetSkipped } = mirrorRows({ withFacetNames: !flag("--no-facet-names") });
  const vendors = {};
  for (const r of rows) vendors[r.vendor] = (vendors[r.vendor] ?? 0) + 1;
  // --emit keeps stdout for the rows alone so a caller can parse it; the counts move to stderr.
  const say = flag("--emit") ? console.error : console.log;
  say(`[layoff-board-names-mirror] catalogue=${catalogue} facet_rows=${facet} facet_skipped_uncatalogued=${facetSkipped} rows=${rows.length}`);
  say(`[layoff-board-names-mirror] by vendor: ${Object.entries(vendors).sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v}=${n}`).join(" ")}`);
  if (flag("--emit")) process.stdout.write(JSON.stringify(rows) + "\n");
  const out = opt("--out", null);
  if (out) {
    writeFileSync(out, JSON.stringify(rows));
    console.log(`[layoff-board-names-mirror] wrote ${rows.length} rows to ${out}`);
  }
  if (flag("--apply")) {
    const chunk = Number(opt("--chunk", "2000"));
    const last = await apply(rows, { chunk });
    console.log(`[layoff-board-names-mirror] done total=${last.lb_total} pruned_on_last_chunk=${last.lb_pruned}`);
  }
}
