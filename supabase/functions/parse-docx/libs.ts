/**
 * THE TWO LIBRARIES PARSE-DOCX READS A .DOCX WITH, AT THE VERSIONS IT DEPLOYS.
 *
 * One module, so the Deno tests beside this function (docx_test.ts) run the
 * very builds production runs, not the npm copies the Node suite has.
 *
 * mammoth 1.12.3 (register S11-034). 1.6.0 threw on a Strict Open XML
 * document (support arrived in 1.7.0) and on a text box in
 * mc:AlternateContent with no mc:Fallback (1.9.1), and 1.12.2 and 1.12.3 fix
 * a prototype pollution and a ReDoS reachable from a crafted document.
 * 1.13.0 is NOT usable here: it swapped bluebird for native promises through
 * a constructor whose prototype it sets with `__proto__`, which Deno does not
 * provide, so its extractRawText throws "resolve is not a function" on every
 * document, the plainest one included (measured under Deno 2.9 through both
 * esm.sh and npm:). Moving past 1.12.3 needs a build that runs under Deno.
 *
 * mammoth's and jszip's type defs export no default (TS1192); esm.sh's CJS
 * shim serves both shapes at runtime, so take the namespace and prefer
 * .default if the shim provides one.
 */
import * as mammothNs from "https://esm.sh/mammoth@1.12.3";
import * as jszipNs from "https://esm.sh/jszip@3.10.1";
import type { MammothLike, ZipLoader } from "./docx-text.ts";

export const mammoth = ((mammothNs as unknown as { default?: unknown }).default ?? mammothNs) as unknown as MammothLike;
export const JSZip = ((jszipNs as unknown as { default?: unknown }).default ?? jszipNs) as unknown as ZipLoader;
