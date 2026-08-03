#!/bin/bash
# Push worker source from this repo to the RUNNING copy at ~/apply-worker.
#
# WHY THERE ARE TWO COPIES AT ALL. macOS TCC will not let a launchd job execute
# anything under ~/Documents, ~/Desktop or ~/Downloads. Measured 2026-08-03: the
# scheduled job died with exit 126 "Operation not permitted" every five minutes
# while the identical command worked by hand, because an interactive shell has
# permissions launchd does not. A control job placed in ~/tcc-probe ran fine, so
# the block is the LOCATION, not the file. The repo lives in ~/Documents; the
# runtime cannot.
#
# A SECOND COPY IS A THING THAT GOES STALE — this codebase has been bitten by
# exactly that (an orphaned apply-automation.ts that the test suite pinned while
# nothing deployed it, and SENDABLE_VENDORS which needs a mirror test to stay
# honest). So: the repo is the source, this is the only sanctioned way to move
# code to the runtime, and it prints a diff summary rather than silently copying.
#
# NEVER SYNCED: .env holds the broker credential and belongs only to the runtime
# copy; apply.log is the runtime's own output. Clobbering either would disarm a
# working sender to "fix" it.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DST="$HOME/apply-worker"

if [ ! -d "$DST" ]; then
  echo "  no runtime copy at $DST"
  echo "  create it with:  rsync -a '$SRC/' '$DST/'  then '$DST/mac/applyd arm'"
  exit 1
fi

echo "  source : $SRC"
echo "  runtime: $DST"
echo

# Dry run first, so you see what is about to change before it changes.
CHANGES="$(rsync -a --itemize-changes --dry-run \
  --exclude '.env' --exclude 'mac/apply.log' --exclude 'node_modules' \
  "$SRC/" "$DST/" | grep -v '^\.d' || true)"

if [ -z "$CHANGES" ]; then
  echo "  already in sync — nothing to copy."
  exit 0
fi

echo "  changes:"
echo "$CHANGES" | sed 's/^/    /'
echo

rsync -a --exclude '.env' --exclude 'mac/apply.log' --exclude 'node_modules' \
  "$SRC/" "$DST/"

echo "  synced."
echo
# The plist embeds absolute paths and the PATH environment. A src-only change
# does not need a reinstall; a change to mac/applyd usually does.
if echo "$CHANGES" | grep -q 'mac/applyd'; then
  echo "  mac/applyd changed — reinstall so the plist picks it up:"
  echo "      $DST/mac/applyd install"
fi
echo "  verify:  $DST/mac/applyd check"
