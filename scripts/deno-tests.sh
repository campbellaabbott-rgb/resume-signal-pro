#!/usr/bin/env bash
# Runs every Deno test beside an edge function (supabase/functions/**/*_test.ts).
#
# WHY THIS EXISTS. Sixty-two of them existed and no gate ran them: check-
# functions.sh only typechecked them, and CI never called check-functions.sh.
# They are Deno tests (Deno.test, jsr asserts), so vitest cannot run them, and
# the *.test.ts files under supabase/functions ARE vitest's and must not be
# handed to Deno -- hence the explicit list instead of `deno test` discovery.
#
# Usage: bash scripts/deno-tests.sh   (from anywhere; called by check-functions.sh and CI)
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.deno/bin:$PATH"
command -v deno >/dev/null || { echo "deno not found"; exit 1; }

files=()
while IFS= read -r f; do files+=("$f"); done < <(find supabase/functions -name '*_test.ts' -not -path '*/node_modules/*' | sort)
# An empty list would hand deno no files, and deno would then discover the
# vitest files instead: refuse rather than run the wrong suite or nothing.
[ "${#files[@]}" -gt 0 ] || { echo "no *_test.ts found under supabase/functions"; exit 1; }

# --allow-run=node: one layoff-filings test runs a node child process.
deno test --config supabase/functions/deno.json --allow-env --allow-read --allow-run=node "${files[@]}"
