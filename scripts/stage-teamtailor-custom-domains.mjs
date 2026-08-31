// Stage net-new Teamtailor tenants from the custom-domain CNAME sweep.
//
// WHY STAGING IS A SEPARATE STEP. The CNAME sweep (2026-08-30) found 765
// employer-owned hostnames aliasing Teamtailor tenants. The catalog carries
// tenant SLUG tokens, not hostnames — merging hosts directly would carry the
// same board twice under two spellings, and the ingester would fetch both.
// So resolve-teamtailor-tokens.mjs first proves each host's token by a shared
// numeric job id (a 200 is not proof; that trap is documented in its header),
// and THIS script reduces the proven tokens to the genuinely net-new set.
// It stages a candidate file for the orchestrator; it never touches the
// catalog itself.
//
// THREE DEDUPE LAYERS, in order:
//   1. host -> token collapse: several custom hosts can alias ONE tenant
//      (brand sites of a single group). Keep one row per token, max count.
//   2. catalog dedupe: drop tokens the catalog already carries. Matching is
//      exact-string on the token (lowercased both sides); resolver-derived
//      tokens are already slugged lowercase.
//   3. nothing weaker: name similarity is NOT a dedupe key — distinct tenants
//      of one group are distinct boards on purpose (per-market tenants like
//      the mdpispain case in the resolver's header).
//
//   node scripts/stage-teamtailor-custom-domains.mjs <resolved.json> <sources.ts> <out.json>

import { readFileSync, writeFileSync } from "node:fs";

const [resolvedPath, sourcesPath, outPath] = process.argv.slice(2);
if (!outPath) {
  console.error("usage: node scripts/stage-teamtailor-custom-domains.mjs <resolved.json> <sources.ts> <out.json>");
  process.exit(2);
}

const rows = JSON.parse(readFileSync(resolvedPath, "utf8"));
const src = readFileSync(sourcesPath, "utf8");

// Carried tokens: pulled from entry declarations, not from a hand-kept list —
// hand-listed catalogs drift (the schema-drift lesson, applied to a file).
const carried = new Set(
  [...src.matchAll(/source:\s*"teamtailor"\s*,\s*token:\s*"([^"]+)"/g)]
    .map((m) => m[1].toLowerCase()),
);

const resolved = rows.filter((r) => r.token);
const unresolvable = rows.length - resolved.length;

// Layer 1: collapse aliasing hosts onto one row per token.
const byToken = new Map();
for (const r of resolved) {
  const t = r.token.toLowerCase();
  const prev = byToken.get(t);
  if (!prev || (r.jobs ?? 0) > (prev.jobs ?? 0)) {
    byToken.set(t, { ...r, hosts: [...(prev?.hosts ?? []), r.host] });
  } else {
    prev.hosts.push(r.host);
  }
}

// Layer 2: catalog dedupe.
const netNewRows = [];
let alreadyCarried = 0;
for (const [t, r] of byToken) {
  if (carried.has(t)) { alreadyCarried += 1; continue; }
  netNewRows.push({ token: r.token, name: r.name || r.org || r.token, count: r.jobs ?? 0 });
}
netNewRows.sort((a, b) => b.count - a.count);

const ledger = {
  resolved: resolved.length,
  unresolvable,
  alreadyCarried,
  netNew: netNewRows.length,
  netNewPostings: netNewRows.reduce((s, r) => s + r.count, 0),
};

writeFileSync(outPath, JSON.stringify({ ledger, staged: netNewRows }, null, 1));
console.log(JSON.stringify(ledger));
console.log(`hosts collapsed by aliasing: ${resolved.length - byToken.size}`);
console.log(`-> ${outPath} (staged only; the orchestrator merges)`);
