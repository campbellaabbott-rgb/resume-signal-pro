// THE ROWS THE MIRROR TAKES, BUILT ONCE FOR BOTH RUNTIMES.
//
// public.layoff_board_names is what the matcher's exact rule compares a
// filer's name against, and it holds nothing until something writes it. Two
// callers build its rows: the deployed layoff-filings function (action
// "mirror", daily, from the catalogue it imports) and the operator script
// scripts/layoff-board-names-mirror.mjs (from the catalogue the text reader
// in src/test/helpers/catalog.ts parses). One rule, one module, so the two
// cannot drift; the Deno parity test runs both over today's catalogue and
// requires the same set, which is the check that the runtime catalogue and
// the text-parsed one still agree (the 2026-09-06 repack made every regex
// reader see 1% of the boards without a single test failing).
//
// This file stays pure: no Deno API, no import of the catalogue, only
// erasable TypeScript (interfaces and annotations), because the script
// imports it under plain node, which strips types but runs no transpiler.
//
// THE RULE. One row per catalogue entry: (vendor = the entry's source,
// company_token, display_name = the catalogue name). Then, for every employer
// in the facet table (the name the board's own company facet shows for a
// token: "Tyson Foods" where the catalogue says "Tysonfoods", "Wells Fargo"
// where it says "Wf"), a second row under vendor 'facet' for each catalogued
// token whose catalogue name(s) differ from the facet name. The mirror keys
// (vendor, token) and the matcher keys the employer on the token, so the
// extra row adds a spelling and never a second employer. A facet token no
// longer in the catalogue is skipped and counted (the facet file is
// regenerated, not hand-edited, so it lags a prune).

export interface MirrorSourceEntry {
  name: string;
  source: string;
  token: string;
}

export interface MirrorAlias {
  name: string;
  tokens: string[];
}

export interface MirrorRow {
  vendor: string;
  company_token: string;
  display_name: string;
}

export interface MirrorBuild {
  rows: MirrorRow[];
  /** Catalogue entries seen (one row each). */
  catalogue: number;
  /** Second-name rows emitted under vendor FACET_VENDOR. */
  facet: number;
  /** Facet tokens skipped because the catalogue no longer carries them. */
  facetSkipped: number;
}

/** The vendor the second-name rows carry. Not a JobSourceKind on purpose: it names a spelling's origin, never a board. */
export const FACET_VENDOR = "facet";

export function buildMirrorRows(
  catalog: readonly MirrorSourceEntry[],
  aliases: Readonly<Record<string, MirrorAlias>>,
  opts: { withFacetNames?: boolean } = {},
): MirrorBuild {
  const withFacetNames = opts.withFacetNames !== false;
  const rows: MirrorRow[] = [];
  const namesByToken = new Map<string, Set<string>>();
  for (const e of catalog) {
    rows.push({ vendor: e.source, company_token: e.token, display_name: e.name });
    let names = namesByToken.get(e.token);
    if (!names) {
      names = new Set<string>();
      namesByToken.set(e.token, names);
    }
    names.add(e.name);
  }
  let facet = 0;
  let facetSkipped = 0;
  if (withFacetNames) {
    for (const entry of Object.values(aliases)) {
      for (const token of entry.tokens) {
        const names = namesByToken.get(token);
        if (!names) {
          facetSkipped += 1;
          continue;
        }
        if (names.has(entry.name)) continue;
        rows.push({ vendor: FACET_VENDOR, company_token: token, display_name: entry.name });
        facet += 1;
      }
    }
  }
  return { rows, catalogue: catalog.length, facet, facetSkipped };
}

/** The byte the parity key joins its columns on: one no column carries (the writer rejects nothing, but
 *  a board token is a URL slug and a name is what a careers page prints). Written as an escape, never as
 *  the raw byte, so the separator is visible in the source and survives any editor. */
export const MIRROR_KEY_SEP = "\u0001";

/** The set key the parity test compares on: the three columns the writer stores verbatim, separated, so
 *  vendor "facet" + token "x" and vendor "face" + token "tx" stay two keys. */
export const mirrorRowKey = (r: MirrorRow): string => [r.vendor, r.company_token, r.display_name].join(MIRROR_KEY_SEP);
