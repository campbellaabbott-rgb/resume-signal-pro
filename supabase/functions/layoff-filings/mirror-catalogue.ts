// THE DEPLOY'S OWN VIEW OF THE CATALOGUE, BOUND TO THE MIRROR RULE.
//
// The layoff-filings function imports the board catalogue and the facet
// names directly -- the same modules job-board serves from -- so the mirror
// it writes is the catalogue the deploy carries, not a copy that could lag
// it. This is the one place under layoff-filings that reaches
// ../job-board/sources.ts (about 2.2 MB in its packed form); the bundle
// stays far under the ~4.5 MB ceiling past which a deploy "succeeds" and
// keeps serving the previous version, and the parity test measures nothing
// about that -- the deploy step does, by esbuild, before every publish.
//
// Kept apart from index.ts (which serves on import and cannot be loaded by a
// test) and from mirror-rows.ts (which the operator script imports under
// node and which must therefore never drag the catalogue in).

import { JOB_SOURCES } from "../job-board/sources.ts";
import { EMPLOYER_ALIASES } from "../job-board/employer-aliases.ts";
import { buildMirrorRows } from "./mirror-rows.ts";
import type { MirrorBuild } from "./mirror-rows.ts";

/** The rows the deployed function mirrors: every catalogue entry plus the facet's second names. */
export function deployMirrorRows(): MirrorBuild {
  return buildMirrorRows(JOB_SOURCES, EMPLOYER_ALIASES);
}
