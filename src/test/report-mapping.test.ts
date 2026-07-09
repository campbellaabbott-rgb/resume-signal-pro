// Regression guard for the "silent dark card" bug class.
//
// The report reads dozens of fields off `freeKeywordResult` (e.g.
// `countryStandards={freeKeywordResult.countryStandards}`). Those values only
// exist if `setFreeKeywordResult({...})` actually puts them there. On 2026-07-09
// several fields were read but never mapped — so their cards rendered from
// `undefined` and silently never appeared. The fix was to spread the raw scan
// result (`...(result as any)`) so no field can be dropped.
//
// This test analyzes Index.tsx directly (like the i18n key-parity test reads the
// locale files) and fails if any data-setting `setFreeKeywordResult` block
// neither spreads the raw result NOR explicitly maps a field the report reads.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const INDEX_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../pages/Index.tsx"),
  "utf8",
);

interface MappingBlock { keys: Set<string>; hasSpread: boolean }

// Extract each `setFreeKeywordResult({ ... })` object literal (brace-matched),
// its top-level keys, and whether it spreads the raw result/data.
function mappingBlocks(source: string): MappingBlock[] {
  const marker = "setFreeKeywordResult({";
  const blocks: MappingBlock[] = [];
  let from = source.indexOf(marker);
  while (from !== -1) {
    const braceStart = from + marker.length - 1; // index of the "{"
    let depth = 0, end = braceStart;
    for (; end < source.length; end++) {
      const c = source[end];
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { end++; break; } }
    }
    const text = source.slice(braceStart, end);
    const keys = new Set<string>();
    let d = 0;
    for (const line of text.split("\n")) {
      if (d === 1) {
        const m = line.match(/^\s*([A-Za-z_]\w*)\s*:/);
        if (m) keys.add(m[1]);
      }
      for (const ch of line) { if (ch === "{") d++; else if (ch === "}") d--; }
    }
    blocks.push({ keys, hasSpread: /\.\.\.\(?\s*(?:result|data)\b/.test(text) });
    from = source.indexOf(marker, end);
  }
  return blocks;
}

// Fields read off freeKeywordResult that some data mapping fails to provide.
function darkFields(source: string): string[] {
  const reads = new Set(
    [...source.matchAll(/\bfreeKeywordResult\.([A-Za-z_]\w*)/g)].map((m) => m[1]),
  );
  const dark = new Set<string>();
  for (const b of mappingBlocks(source)) {
    if (b.hasSpread) continue; // spread carries every backend field through
    for (const f of reads) if (!b.keys.has(f)) dark.add(f);
  }
  return [...dark].sort();
}

describe("report mapping contract (Index.tsx)", () => {
  it("actually parses the file — guards against a vacuous pass", () => {
    const blocks = mappingBlocks(INDEX_SRC);
    const reads = [...INDEX_SRC.matchAll(/\bfreeKeywordResult\.([A-Za-z_]\w*)/g)];
    expect(blocks.length).toBeGreaterThanOrEqual(2); // main scan + handleJobAnalysis
    expect(reads.length).toBeGreaterThan(20);        // the report reads many fields
  });

  it("the detector correctly flags an unmapped read, and clears when spread", () => {
    const buggy = [
      "<Card countryStandards={freeKeywordResult.countryStandards} />",
      "setFreeKeywordResult({",
      "  atsScoreEstimate: result.atsScoreEstimate,",
      "  industry: result.industry,",
      "});",
    ].join("\n");
    expect(darkFields(buggy)).toContain("countryStandards");
    const fixed = buggy.replace("setFreeKeywordResult({", "setFreeKeywordResult({\n  ...(result as any),");
    expect(darkFields(fixed)).toEqual([]);
  });

  it("no field the report reads is left unmapped (spread or explicit)", () => {
    const dark = darkFields(INDEX_SRC);
    expect(
      dark,
      `These fields are read off freeKeywordResult but a setFreeKeywordResult block ` +
      `neither spreads the raw result nor maps them — they will render as undefined ` +
      `(silent dark cards): ${dark.join(", ")}. Fix: add \`...(result as any)\` / ` +
      `\`...(data as any)\` to the block, or map each field explicitly.`,
    ).toEqual([]);
  });
});
