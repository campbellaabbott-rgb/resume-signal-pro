#!/usr/bin/env node
// THE MATCHER READS THE NAMES THE DEPLOY MIRRORED, NEVER THE LIVE ONES.
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
// USAGE
//   node scripts/layoff-board-names-mirror.mjs                 # dry run: counts to stdout
//   node scripts/layoff-board-names-mirror.mjs --out rows.json # write the rows
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
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };

/** Read the catalogue and the facet names through the TypeScript modules. */
export function loadCatalogueAndFacet() {
  const require = createRequire(`${REPO}/package.json`);
  const { register } = require("tsx/cjs/api");
  const unregister = register();
  try {
    const { CATALOG } = require(`${REPO}/src/test/helpers/catalog.ts`);
    const { EMPLOYER_ALIASES } = require(`${REPO}/supabase/functions/job-board/employer-aliases.ts`);
    return { CATALOG, EMPLOYER_ALIASES };
  } finally {
    unregister();
  }
}

/** The rows the mirror takes: one per catalogue entry, plus a 'facet' row where the facet name differs.
 *  The catalogue and the facet map are loaded through tsx unless the caller passes them (a vitest does). */
export function mirrorRows({ withFacetNames = true, catalog = null, employerAliases = null } = {}) {
  const loaded = catalog && employerAliases ? { CATALOG: catalog, EMPLOYER_ALIASES: employerAliases } : loadCatalogueAndFacet();
  const { CATALOG, EMPLOYER_ALIASES } = loaded;
  const rows = [];
  const byToken = new Map();
  for (const e of CATALOG) {
    rows.push({ vendor: e.source, company_token: e.token, display_name: e.name });
    if (!byToken.has(e.token)) byToken.set(e.token, []);
    byToken.get(e.token).push(e);
  }
  let facet = 0, facetSkipped = 0;
  if (withFacetNames) {
    for (const entry of Object.values(EMPLOYER_ALIASES)) {
      for (const token of entry.tokens) {
        const es = byToken.get(token);
        if (!es) { facetSkipped++; continue; }
        if (es.some((e) => e.name === entry.name)) continue;
        rows.push({ vendor: "facet", company_token: token, display_name: entry.name });
        facet++;
      }
    }
  }
  return { rows, catalogue: CATALOG.length, facet, facetSkipped };
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
  console.log(`[layoff-board-names-mirror] catalogue=${catalogue} facet_rows=${facet} facet_skipped_uncatalogued=${facetSkipped} rows=${rows.length}`);
  console.log(`[layoff-board-names-mirror] by vendor: ${Object.entries(vendors).sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v}=${n}`).join(" ")}`);
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
