#!/usr/bin/env bash
# The chunks that can hold the US English strings the browser loads, for the
# verify sections that judge copy in the served bundle (50, 52, 62, 65, 72,
# 74, 94).
#
#   bash scripts/verify-us-english.sh <entry URL>
#
# <entry URL> is the served entry, $SITE/assets/index-<hash>.js. Prints chunk
# names under /assets/, one per line, in the order a section tries them for
# the key it looks for:
#   1. rb-en_all-<hash>.js, the whole of src/i18n/locales/en.json. Since the
#      English strings travel with the pages that read them (SEO-040,
#      enNamespaces in vite.config.ts), the entry names this chunk and no
#      longer carries en.json itself;
#   2. the entry itself, which carried en.json before SEO-040;
#   3. every other en-<hash>.js chunk the entry names: the US English shards
#      (the changelog's strings, the company and listing shards).
# It never prints an en-GB-<hash>.js chunk. en-GB carries most of the same
# keys in British spelling, so the sections that took the first en-* chunk
# holding their key read the British file once en.json left the entry: a
# correct page failed on a spelling ("Re-analyse to scan again"), and a
# regression made in en.json alone passed. When no chunk printed here holds a
# section's key, the section prints FAIL; it never falls back to en-GB.
#
# Read-only: one GET of the entry. Prints nothing when the URL names no
# /assets/ chunk or the entry cannot be read.
set -u
url="${1:-}"
case "$url" in */assets/*.js) ;; *) exit 0 ;; esac
entry="${url##*/assets/}"
body=$(curl -s -m 60 "$url")
[ -n "$body" ] || exit 0
chunks() { printf '%s' "$body" | grep -oE "\"\\./$1-[A-Za-z0-9_-]+\\.js\"" | tr -d '"' | sed 's|^\./||' | sort -u; }
chunks 'rb-en_all'
printf '%s\n' "$entry"
chunks 'en' | grep -v '^en-GB-'
exit 0
