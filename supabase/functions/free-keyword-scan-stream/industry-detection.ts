// Re-export of the canonical detection engine. This folder previously held a
// stale fork (2,361 lines vs 4,516) that silently missed every industry and
// accuracy improvement shipped to free-keyword-scan. One source of truth now —
// the golden regression corpus in src/test covers this module for both paths.
export * from "../free-keyword-scan/industry-detection.ts";
