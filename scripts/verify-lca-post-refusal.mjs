#!/usr/bin/env node
// What lca_wages writes: the bundle less its refusals, counted by the rules the
// loader itself runs, so scripts/verify-deploy.sh never types a count that goes
// false when the next file ships or the ledger grows. Run through tsx from the
// repository root. Printed as one JSON line. Each token named on the command
// line comes back in `printable` if it keeps a cell of three filings or more.
import { decodeLcaCells, refuseLcaCells, twinVendorTokens } from "../supabase/functions/layoff-filings/lca-cells.ts";
import { JOB_SOURCES } from "../supabase/functions/layoff-filings/board-sources.ts";

const rows = await decodeLcaCells();
const r = refuseLcaCells(rows, twinVendorTokens(JOB_SOURCES));
const lit = new Set(r.kept.filter((x) => x.filings_n >= 3).map((x) => x.company_token));
console.log(JSON.stringify({
  cells: r.kept.length,
  tokens: new Set(r.kept.map((x) => x.company_token)).size,
  filings: r.kept.reduce((n, x) => n + x.filings_n, 0),
  refused: r.tokens,
  printable: process.argv.slice(2).filter((t) => lit.has(t)),
}));
