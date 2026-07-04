#!/usr/bin/env node
// Converts industry-correction digest data into draft golden-test fixtures.
//
// Usage:
//   node scripts/corrections-to-fixtures.mjs corrections.json
//
// where corrections.json is an array of rows from the weekly digest /
// get_industry_correction_stats():
//   [{ "detected": "consulting", "corrected": "finance", "corrections": 14 }, ...]
//
// Output: GoldenCase stubs (printed to stdout) to paste into
// src/test/industry-detection.golden.test.ts. Each stub needs a real
// representative resume filled in before committing — the stub encodes the
// EXPECTATION (corrected industry), which is the half users provided.

import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/corrections-to-fixtures.mjs <corrections.json>");
  process.exit(1);
}

const rows = JSON.parse(readFileSync(file, "utf8"));
const significant = rows.filter((r) => Number(r.corrections) >= 3);

if (significant.length === 0) {
  console.log("// No correction pairs with >= 3 occurrences — nothing to fixture yet.");
  process.exit(0);
}

console.log("// ── Draft fixtures from user corrections (fill in real resumes) ──────────");
for (const r of significant) {
  console.log(`  {
    // Users corrected "${r.detected}" -> "${r.corrected}" ${r.corrections}x this period.
    // TODO: replace the resume below with a real anonymized example of this class.
    name: "correction-mined: ${r.detected} misread as ${r.corrected}",
    expected: "${r.corrected}",
    acceptAlso: ["${r.detected}"], // remove once the engine reliably picks ${r.corrected}
    resume: \`FILL ME IN\\nRepresentative Title\\n\${EXPERIENCE}\\n- Representative ${r.corrected} responsibilities that the engine currently reads as ${r.detected}\`,
  },`);
}
console.log(`// ${significant.length} pair(s) above the 3-occurrence threshold.`);
