#!/usr/bin/env bash
# Semantic typechecking for supabase edge functions via `deno check`.
#
# WHY THIS EXISTS: the edge functions live outside the tsconfig project, so
# `npx tsc` never analyzes them and esbuild only validates syntax. That gap
# shipped a temporal-dead-zone crash (responseData used before declaration)
# that took the production scan down on 2026-07-05. This gate catches that
# entire class (TS2448 and friends) before commit.
#
# Usage: bash scripts/check-functions.sh          (requires deno in PATH;
#        install: curl -fsSL https://deno.land/install.sh | sh)
set -uo pipefail
export PATH="$HOME/.deno/bin:$PATH"

if ! command -v deno >/dev/null; then
  echo "deno not found — install it (curl -fsSL https://deno.land/install.sh | sh)"; exit 1
fi

# Pre-existing type debt, excluded until burned down. Do NOT add new entries —
# new functions must pass. Remove entries as they're fixed.
EXCLUDE=(
  free-keyword-scan-stream   # legacy fallback fork, 44 errors
  parse-docx                 # 3 errors
  parse-pdf                  # 2 errors
  process-email-queue        # 5 errors
  send-market-pulse          # 1 error
)

fails=0
for dir in supabase/functions/*/; do
  name=$(basename "$dir")
  [ "$name" = "_shared" ] && continue
  [ -f "$dir/index.ts" ] || continue
  skip=0
  for ex in "${EXCLUDE[@]}"; do [ "$name" = "$ex" ] && skip=1; done
  [ $skip -eq 1 ] && continue
  if ! deno check --quiet --config supabase/functions/deno.json "$dir/index.ts" >/dev/null 2>&1; then
    echo "FAIL: $name"
    deno check --config supabase/functions/deno.json "$dir/index.ts" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -A3 "ERROR" | head -12
    fails=$((fails+1))
  fi
done

if [ $fails -eq 0 ]; then
  echo "OK: all non-excluded edge functions typecheck clean"
else
  echo "$fails function(s) failed deno check"
  exit 1
fi
