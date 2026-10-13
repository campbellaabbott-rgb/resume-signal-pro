// Where things live. The fixtures (résumés, manifests, corpus, judgments,
// baselines) are committed under src/test/fixtures/match-bench so the CI gate
// can read them; the harness writes its working files to scripts/match-bench/out
// and keeps live answers in scripts/match-bench/cache (both git-ignored).
// MATCH_ENGINE_ROOT points the AFTER steps at another checkout (an upgraded
// branch) without editing anything here.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BENCH = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(BENCH, "../..");
export const FIX = join(ROOT, "src/test/fixtures/match-bench");
export const OUT = join(BENCH, "out");
export const CACHE = join(BENCH, "cache");
export const ENGINE_ROOT = process.env.MATCH_ENGINE_ROOT ? resolve(process.env.MATCH_ENGINE_ROOT) : ROOT;
