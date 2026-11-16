# shellcheck shell=bash
# ── 99zzzzzzz-bugs-builder. THE BUG ROUND OF 2026-11-08, LANE BUILDER
# (branch bugs/a-builder): S14X-034, S14X-035, S14X-070, S14X-071, S14X-096,
# S14X-127, S14X-128, S14X-129, S14X-186, S14X-187, S14X-188, S14X-285,
# S14X-286, S14X-287, the builder's half of RC-S12-110 and the builder's part
# of NB-45. One function at 2026-11-12.1 (parse-resume-structured; the
# integrator stamps it), no migration, and the /builder page, its preview,
# its exporter and a new translation shard (src/i18n/shards/builder),
# published by the merge itself.
#
# Named 99zzzzzzz-bugs-* as the ledger's bug-round verifySections list it: it
# sorts after every 99zzzzzz-* file in byte order and under a locale that
# ignores the dash.
#
# THE STAGES, read from production, never assumed:
#   function  parse-resume-structured answers 2026-11-12.1 or later: the
#             round's paste is live. Until then an older build is INFO. The
#             page never waits on it: against an older function it still
#             knows the 20,000-character cap and says what was left out.
#   frontend  the published ResumeBuilder chunk, the chunk its preview lives
#             in, or the exporter's chunks carry any of the lane's marks
#             below: the merge published. Until then every mark is INFO; from
#             then on a missing mark, or a retired spelling still present, is
#             a FAIL.
# No line waits on an owner: no key of this lane is owner-gated.
#
# THE CLAIMS, one line each:
#   F1  parse-resume-structured serves 2026-11-12.1 or later: a long résumé
#       is cut at a line break and the answer says resumeTruncated,
#       importedChars and totalChars (S14X-071).
#   P1  S14X-070: a failed import says why, the day's limit told by the spend
#       gate's own code (rate_limited_function), with Try again.
#   P2  S14X-071: an import cut short says how much was read (resumeTruncated).
#   P3  RC-S12-110: a paid rewrite opens through the one-shot rb_builder_seed
#       hand-off, never over the scanned résumé.
#   P4  S14X-096: the page hears another tab's draft and a sign-out's clear
#       (a storage listener).
#   P5  S14X-128: the editor is held while an import runs (a disabled
#       fieldset).
#   P6  S14X-129: a browser that keeps nothing is told, and leaving with a
#       résumé asks first (a beforeunload listener).
#   P7  S14X-127: Import my latest scan (builderPage.importLatest).
#   P8  S14X-285: a report's hand-off made for another résumé is dropped (its
#       fingerprint compared).
#   P9  S14X-286: an import that applied none of the report's rewrites says
#       so (builderPage.importedNoneMatchedDescription).
#   P10 NB-45: each contact label is tied to its field (builder-contact- ids).
#   P11 S14X-188: jobs and schools move up and down (builderPage.moveUp).
#   P12 S14X-035: every entry, the last one too, has a named delete button
#       (builderPage.removeEntry).
#   N1  S14X-035: the page chunk holds no ".length>1&&" gate before a delete
#       button (the gate that kept the last entry from being deleted).
#   L1  S14X-187: the preview heads a résumé in its own language from the
#       exporter's own table, Tagalog included ("Karanasan sa Trabaho").
#   N2  S14X-187: the preview asks for no resumeBuilder.preview.<section>
#       heading (it headed every résumé in the interface language) and no
#       English "Role".
#   E1  S14X-287: a Word heading keeps with its section (keepNext).
#   E2  S14X-187: a line break in the Word file is a Word break (break:1).
#   E3  S14X-034: the exporter's text pass maps the ligatures a pasted PDF
#       carries (the "ffl" entry of its table) before the PDF check.
#   S1  the entry carries the English builder shard and names eight lazy
#       builder-shard chunks, each with the import, other-tab, storage and
#       editor strings.
#
# NOT PROVABLE FROM OUTSIDE, so proved in the suite: what the sanitizer maps
# and keeps (an-invisible-character-never-turns-the-pdf-into-a-word-file-
# word-cannot-open), the PDF's right edge and headings kept with their first
# entry (the-pdf-keeps-every-line-inside-the-page-and-every-heading-with-its-
# content), blank entries left out of every export (an-empty-section-is-not-
# exported-and-the-last-entry-can-be-deleted), the mark and the draft written
# together, mounted or not (the-builder-marks-a-scan-offered-only-once-it-
# was-answered-or-imported), a boost appended after the current job
# (builder-entries-can-be-reordered-and-a-boost-is-appended), and the
# function's cut at a line break (a-long-resume-import-is-cut-at-a-line-and-
# says-so).
#
# READ-ONLY. One OPTIONS preflight; GETs of the homepage, its entry, the
# ResumeBuilder chunk and the chunks it imports, the exporter's chunks and
# the eight builder-shard chunks. Nothing is posted.
echo "== 99zzzzzzz-bugs-builder. bug round, builder lane: an import says what went wrong and what it left out, the exports draw what the preview shows, the builder strings exist in nine languages =="

rm -f /tmp/vd_bb_home.html /tmp/vd_bb_entry.js /tmp/vd_bb_page.js /tmp/vd_bb_cand.js /tmp/vd_bb_preview.js /tmp/vd_bb_exp.js /tmp/vd_bb_shard.js

# F1: the function's build. The page falls back without it, so an older
# build is INFO, never a FAIL.
VDBB_FB=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/parse-resume-structured" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//')
if [ -z "$VDBB_FB" ]; then echo "FAIL  F1 parse-resume-structured preflight carries no x-fn-build (want parse-resume-structured.2026-11-12.1 or later)"
elif build_ge parse-resume-structured "$VDBB_FB" 2026-11-12 1; then echo "PASS  F1 parse-resume-structured x-fn-build = $VDBB_FB (2026-11-12.1 or later): a long résumé is cut at a line break and the answer says resumeTruncated, importedChars and totalChars (S14X-071)"
else echo "INFO  F1 parse-resume-structured x-fn-build = $VDBB_FB: the round's paste with 2026-11-12.1 has not landed (section 49 lists the gap); the builder says what the 20,000-character cap left out meanwhile"; fi

# The published app: the entry, the ResumeBuilder chunk, the chunk its
# preview lives in (the one asking for resumeBuilder.preview.yourName), and
# the exporter (the chunk the page imports on an export press, the one
# calling splitTextToSize) with every chunk it imports.
curl -s -m 30 "$SITE/" > /tmp/vd_bb_home.html
VDBB_MAIN=$(grep -o '/assets/index-[^"]*\.js' /tmp/vd_bb_home.html | head -1)
[ -n "$VDBB_MAIN" ] && curl -s -m 60 "$SITE$VDBB_MAIN" > /tmp/vd_bb_entry.js
VDBB_PAGEN=$( { [ -f /tmp/vd_bb_entry.js ] && grep -oE 'ResumeBuilder-[A-Za-z0-9_-]+\.js' /tmp/vd_bb_entry.js; } | head -1)
[ -n "$VDBB_PAGEN" ] && curl -s -m 30 "$SITE/assets/$VDBB_PAGEN" > /tmp/vd_bb_page.js

VDBB_PREVN=""
if [ -f /tmp/vd_bb_page.js ]; then
  if grep -qF 'resumeBuilder.preview.yourName' /tmp/vd_bb_page.js; then VDBB_PREVN=$VDBB_PAGEN; cp /tmp/vd_bb_page.js /tmp/vd_bb_preview.js
  else
    for VDBB_C in $(grep -oE 'from"\./[A-Za-z0-9_-]+\.js"' /tmp/vd_bb_page.js | sed -E 's/^from"\.\/(.*)"$/\1/' | sort -u); do
      case "$VDBB_C" in index-*) continue;; esac
      rm -f /tmp/vd_bb_cand.js
      curl -s -m 30 "$SITE/assets/$VDBB_C" > /tmp/vd_bb_cand.js
      if grep -qF 'resumeBuilder.preview.yourName' /tmp/vd_bb_cand.js; then VDBB_PREVN=$VDBB_C; cp /tmp/vd_bb_cand.js /tmp/vd_bb_preview.js; break; fi
    done
  fi
fi

VDBB_EXPN=""
if [ -f /tmp/vd_bb_page.js ]; then
  for VDBB_C in $(grep -oE 'import\("\./[A-Za-z0-9_-]+\.js"\)' /tmp/vd_bb_page.js | sed -E 's/^import\("\.\/(.*)"\)$/\1/' | sort -u); do
    rm -f /tmp/vd_bb_cand.js
    curl -s -m 30 "$SITE/assets/$VDBB_C" > /tmp/vd_bb_cand.js
    if grep -qF 'splitTextToSize' /tmp/vd_bb_cand.js; then VDBB_EXPN=$VDBB_C; cp /tmp/vd_bb_cand.js /tmp/vd_bb_exp.js; break; fi
  done
fi
if [ -n "$VDBB_EXPN" ]; then
  # The exporter's own imports (the text pass lives in pdf-text-support's chunk), and the entry it shares.
  for VDBB_C in $(grep -oE 'from"\./[A-Za-z0-9_-]+\.js"' /tmp/vd_bb_exp.js | sed -E 's/^from"\.\/(.*)"$/\1/' | sort -u); do
    case "$VDBB_C" in index-*) continue;; esac
    rm -f /tmp/vd_bb_cand.js
    curl -s -m 30 "$SITE/assets/$VDBB_C" > /tmp/vd_bb_cand.js
    cat /tmp/vd_bb_cand.js >> /tmp/vd_bb_exp.js
  done
  cat /tmp/vd_bb_entry.js >> /tmp/vd_bb_exp.js
fi

VDBB_READ=yes
if [ -z "$VDBB_MAIN" ]; then VDBB_READ=no; echo "FAIL  P1 the homepage names no /assets/index-*.js entry: the published app cannot be read"
elif [ -z "$VDBB_PAGEN" ] || ! grep -qF 'parse-resume-structured' /tmp/vd_bb_page.js 2>/dev/null; then
  VDBB_READ=no; echo "FAIL  P1 the entry $VDBB_MAIN names no ResumeBuilder chunk that calls parse-resume-structured (${VDBB_PAGEN:-none named}): the bundle layout moved, so the builder cannot be judged"
elif [ -z "$VDBB_PREVN" ]; then
  VDBB_READ=no; echo "FAIL  L1 neither the ResumeBuilder chunk ($VDBB_PAGEN) nor a chunk it imports asks for resumeBuilder.preview.yourName: the bundle layout moved, so the preview cannot be judged"
elif [ -z "$VDBB_EXPN" ]; then
  VDBB_READ=no; echo "FAIL  E1 no chunk the ResumeBuilder chunk ($VDBB_PAGEN) imports on demand calls splitTextToSize: the bundle layout moved, so the exporter cannot be judged"
fi

if [ "$VDBB_READ" = yes ]; then
  # Each mark: FILE|ERE|claim|what it proves. Any one present means the merge published.
  VDBB_MARKS='page|rate_limited_function|P1|S14X-070 a failed import says why, the day'"'"'s limit told by the spend gate'"'"'s own code, with Try again
page|resumeTruncated|P2|S14X-071 an import cut short says how much of the résumé was read
page|rb_builder_seed|P3|RC-S12-110 a paid rewrite opens through the one-shot rb_builder_seed hand-off, leaving the scanned résumé alone
page|addEventListener\("storage"|P4|S14X-096 the builder hears another tab'"'"'s draft and a sign-out'"'"'s clear
page|"fieldset",\{disabled:|P5|S14X-128 the editor is held while an import runs
page|addEventListener\("beforeunload"|P6|S14X-129 a browser that keeps nothing is told, and leaving with a résumé asks first
page|builderPage\.importLatest|P7|S14X-127 Import my latest scan imports a scan the old order marked offered
page|\.fingerprint!==|!==[A-Za-z_$][A-Za-z0-9_$.]*\.fingerprint[^A-Za-z0-9_$]|P8|S14X-285 a report hand-off made for another résumé is dropped
page|builderPage\.importedNoneMatchedDescription|P9|S14X-286 an import that applied none of the report'"'"'s rewrites says so
page|builder-contact-|P10|NB-45 each contact label is tied to its field, never named by its sample text
page|builderPage\.moveUp|P11|S14X-188 jobs and schools move up and down in place of the grip that did nothing
page|builderPage\.removeEntry|P12|S14X-035 every entry, the last one too, has a named delete button
preview|Karanasan sa Trabaho|L1|S14X-187 the preview heads a résumé in its own language from the exporter'"'"'s table, Tagalog and Hindi included
exp|keepNext:!0|E1|S14X-287 a Word heading keeps with its section
exp|break:1|E2|S14X-187 a line break in the Word file is a Word break
exp|:"ffl"|E3|S14X-034 the export text pass maps the ligatures a pasted PDF carries before the PDF check'
  VDBB_HITS=0
  while IFS= read -r VDBB_L; do
    VDBB_F=${VDBB_L%%|*}; VDBB_R=${VDBB_L#*|}; VDBB_R=${VDBB_R%|*|*}
    if grep -qE "$VDBB_R" "/tmp/vd_bb_$VDBB_F.js"; then VDBB_HITS=$((VDBB_HITS + 1)); fi
  done <<< "$VDBB_MARKS"
  VDBB_FE=old; [ "$VDBB_HITS" -gt 0 ] && VDBB_FE=published
  while IFS= read -r VDBB_L; do
    VDBB_F=${VDBB_L%%|*}; VDBB_R=${VDBB_L#*|}; VDBB_R=${VDBB_R%|*|*}
    VDBB_T=${VDBB_L#*|}; VDBB_T=${VDBB_T#"$VDBB_R"|}; VDBB_CL=${VDBB_T%%|*}; VDBB_W=${VDBB_T#*|}
    case "$VDBB_F" in page) VDBB_CH=$VDBB_PAGEN;; preview) VDBB_CH=$VDBB_PREVN;; *) VDBB_CH="$VDBB_EXPN and its imports";; esac
    if grep -qE "$VDBB_R" "/tmp/vd_bb_$VDBB_F.js"; then echo "PASS  $VDBB_CL $VDBB_W ($VDBB_CH)"
    elif [ "$VDBB_FE" = published ]; then echo "FAIL  $VDBB_CL $VDBB_W: missing from $VDBB_CH, though $VDBB_HITS of the lane's marks are published"
    else echo "INFO  $VDBB_CL $VDBB_W: not published yet ($VDBB_CH)"; fi
  done <<< "$VDBB_MARKS"

  # N1, N2: spellings the lane retired, judged once the lane published.
  VDBB_GATE=$(grep -oE '\.length>1&&[A-Za-z_$][A-Za-z0-9_$]*\.jsxs?\(' /tmp/vd_bb_page.js | wc -l | tr -d ' ')
  if [ "$VDBB_GATE" -eq 0 ]; then
    if [ "$VDBB_FE" = published ]; then echo "PASS  N1 S14X-035 the ResumeBuilder chunk holds no .length>1&& gate before a delete button: the last entry can be deleted ($VDBB_PAGEN)"
    else echo "INFO  N1 S14X-035 the ResumeBuilder chunk holds no .length>1&& gate, but the lane has not published, so nothing is proved yet ($VDBB_PAGEN)"; fi
  elif [ "$VDBB_FE" = published ]; then echo "FAIL  N1 S14X-035 the ResumeBuilder chunk still holds $VDBB_GATE .length>1&& gate(s) before an element, so the last job or school cannot be deleted ($VDBB_PAGEN)"
  else echo "INFO  N1 S14X-035 the ResumeBuilder chunk holds $VDBB_GATE .length>1&& gate(s) (2 on 2026-11-15): not published yet ($VDBB_PAGEN)"; fi

  VDBB_OLD=$(grep -oE 'resumeBuilder\.preview\.(summary|experience|education|skills|certifications|role)' /tmp/vd_bb_preview.js | sort -u | tr '\n' ' ' | sed 's/ $//')
  if [ -z "$VDBB_OLD" ]; then
    if [ "$VDBB_FE" = published ]; then echo "PASS  N2 S14X-187 the preview asks for no resumeBuilder.preview heading or Role: its headings come from the résumé's own language ($VDBB_PREVN)"
    else echo "INFO  N2 S14X-187 the preview asks for no resumeBuilder.preview heading, but the lane has not published, so nothing is proved yet ($VDBB_PREVN)"; fi
  elif [ "$VDBB_FE" = published ]; then echo "FAIL  N2 S14X-187 the preview still heads a résumé in the interface language: it asks for $VDBB_OLD ($VDBB_PREVN)"
  else echo "INFO  N2 S14X-187 the preview asks for $VDBB_OLD: not published yet ($VDBB_PREVN)"; fi

  # S1: the English shard rides the entry; the other eight load on demand.
  VDBB_SH=$(grep -oE '"\./shards/builder/[A-Za-z-]+\.json":\(\)=>[A-Za-z_$]+\(\(\)=>import\("\./[A-Za-z0-9_-]+\.js"' /tmp/vd_bb_entry.js)
  VDBB_EN=no; grep -qF '"./shards/builder/en.json":' /tmp/vd_bb_entry.js && VDBB_EN=yes
  if [ -z "$VDBB_SH" ] && [ "$VDBB_EN" = no ]; then
    if [ "$VDBB_FE" = published ]; then echo "FAIL  S1 the lane's page published but the entry loads no builder shard, so its new strings show as keys"
    else echo "INFO  S1 the entry loads no builder shard yet: not published yet"; fi
  else
    VDBB_MISS=""; VDBB_N=0
    while IFS= read -r VDBB_L; do
      [ -n "$VDBB_L" ] || continue
      VDBB_LNG=$(printf '%s' "$VDBB_L" | sed -E 's#.*shards/builder/([A-Za-z-]+)\.json.*#\1#')
      VDBB_SF=$(printf '%s' "$VDBB_L" | grep -oE '[A-Za-z0-9_-]+\.js"$' | tr -d '"')
      rm -f /tmp/vd_bb_shard.js
      curl -s -m 30 "$SITE/assets/$VDBB_SF" > /tmp/vd_bb_shard.js
      VDBB_N=$((VDBB_N + 1))
      for VDBB_KEY in importFailed importTruncated importLatest otherTab storageBlocked moveUp removeEntry removeBullet bullet importedNoneMatchedDescription_other; do
        grep -qF "$VDBB_KEY" /tmp/vd_bb_shard.js || VDBB_MISS="$VDBB_MISS $VDBB_LNG:$VDBB_KEY"
      done
    done <<< "$VDBB_SH"
    if [ "$VDBB_EN" = no ]; then echo "FAIL  S1 the entry names $VDBB_N lazy builder shards but not the English one it should carry"
    elif [ "$VDBB_N" -ne 8 ]; then echo "FAIL  S1 the entry names $VDBB_N non-English builder shards, not 8"
    elif [ -n "$VDBB_MISS" ]; then echo "FAIL  S1 builder shard strings missing:$VDBB_MISS"
    else echo "PASS  S1 the entry carries the English builder shard and names 8 more, each with the import, other-tab, storage and editor strings"; fi
  fi
fi
