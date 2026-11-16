# shellcheck shell=bash
# ── 99zzzzzzz-bugs-ingest-parsers. THE BUG ROUND OF 2026-11-08, LANE
# INGEST-PARSERS (branch bugs/a-ingest-parsers; the owner half on
# bugs/a-ingest-parsers-owner). Three functions at 2026-11-12.1 (parse-pdf,
# parse-docx and parse-spreadsheet; the integrator stamps them), no
# migration, and three frontend pieces the merge itself publishes: the
# refusal and notice copy (src/lib/parse-failure-copy.ts), the résumé text
# reader (src/lib/resumeText.ts) and a translation shard
# (src/i18n/shards/ingest-parsers).
#
# Named 99zzzzzzz-bugs-* as the ledger's bug-round verifySections list it: it
# sorts after every 99zzzzzz-* file in byte order and under a locale that
# ignores the dash.
#
# THE STAGES, read from production, never assumed:
#   functions  each parser's preflight answers 2026-11-12.1 or later. Until
#              one does, an older build is INFO (not pasted yet); once one
#              does, another still older is a FAIL (a partial paste). A
#              preflight with no x-fn-build is a FAIL either way.
#   frontend   the entry carries the lane's English shard: the merge
#              published. Until then every frontend claim is INFO; from then
#              on a missing mark is a FAIL. The page works against the older
#              parsers: a refusal with no code keeps the page's own copy.
#
# THE CHUNKS, read from production: /resume-checker names the entry
# (/assets/index-*.js) and the scanner chunk (/assets/Index-*.js, the one
# holding the parse-refusal map, homepage.toast.fileDamaged); the entry names
# the Account chunk, and the résumé text reader is that chunk or the first
# chunk it imports that calls both parsers by name and tests a .txt name; the
# entry names the eight lazy shard chunks.
#
# THE CLAIMS, one line each:
#   B   parse-pdf (S14X-044 right-to-left order, S14X-123 and S14X-146 a Mac
#       CJK PDF's spaces and ideographs, S14X-147 link addresses, S14X-280
#       hyphens, S14X-282 image pages skipped and said, S14X-183 a code on
#       every refusal), parse-docx (S14X-124 a damaged part, S14X-125 tracked
#       moves, S14X-126 nested text boxes, S14X-281 web content,
#       RC-S13-037 list-style bullets, RC-S13-036 contact only in the header,
#       S14X-147, S14X-280, S14X-183) and parse-spreadsheet (S14X-148 an
#       Excel CSV's encoding, S14X-284 the Sheets tab a link names,
#       RC-S13-066 a patched SheetJS) serve 2026-11-12.1 or later.
#   L0  the chunks above can be read (FAIL when the layout moved: the claim
#       that needed the chunk could not be judged).
#   S1  S14X-183: the entry carries the English ingest-parsers shard and
#       names eight more (de, en-GB, es, fr, hi, nl, pt, tl), each holding
#       every string of the repo's own file for that language.
#   R1  S14X-183: the scanner chunk's refusal map names every refusal code
#       the parsers send, the ingestParsers refusal keys, and a title for a
#       Word document's garbled text (docxGarbled).
#   R2  S14X-044, S14X-282: the scanner chunk says the two new notices
#       (rtl_unreliable, image_pages_skipped).
#   T1  S14X-283, S14X-280: the résumé text reader decodes a .txt by its
#       byte-order mark (utf-16le, utf-16be), reads bytes that are not UTF-8
#       as windows-1252, and gives the text the parsers' intake cleanup.
#   O   S14X-101 (the parsers' failure alerts carry no address) prints INFO
#       owner pending until docs/deploy-ledger.json reservations['bug-round']
#       .ownerDecided names it; then parse-pdf and parse-docx must serve the
#       round's build.
#
# WHAT THIS SECTION CANNOT SEE: every parser behaviour needs an upload, which
# spends one of the caller's parse slots (check_rate_limit writes a row) and
# can write a parse_failures row, so it is proven in the suite on the shipped
# handlers and the fixtures (the a-*.test.ts files the lane added), and the
# build above is the one that carries them.
#
# READ-ONLY. Three OPTIONS preflights; GETs of /resume-checker, its entry, the
# scanner chunk, the Account chunk and the chunks it imports up to the
# reader, and the eight shard chunks. Nothing is posted and no file is parsed.
echo "== 99zzzzzzz-bugs-ingest-parsers. bug round, ingest-parsers lane: three parser builds, every refusal in the reader's language, a .txt read in its own encoding, owner gate =="

rm -f /tmp/vd_ip_hdr /tmp/vd_ip_page.html /tmp/vd_ip_entry.js /tmp/vd_ip_idx.js /tmp/vd_ip_acc.js /tmp/vd_ip_cand.js /tmp/vd_ip_reader.js /tmp/vd_ip_shard_*.js
VDIP_LEDGER="${VDIP_LEDGER:-docs/deploy-ledger.json}"
# The refusal codes parse-pdf and parse-docx send (PARSE_FAILURE_CODES less
# the two the page already knew); the suite holds this list to the module's.
VDIP_CODES="empty_file password_protected invalid_pdf too_many_pages scanned_or_empty legacy_doc_or_encrypted empty_or_too_short web_export rate_limited_budget rate_limited_function"

vdip_what() {
  case "$1" in
    parse-pdf) echo "S14X-044 S14X-123 S14X-146 S14X-147 S14X-280 S14X-282 S14X-183" ;;
    parse-docx) echo "S14X-124 S14X-125 S14X-126 S14X-281 RC-S13-037 RC-S13-036 S14X-147 S14X-280 S14X-183" ;;
    *) echo "S14X-148 S14X-284 RC-S13-066" ;;
  esac
}

# B: the three parsers' builds.
VDIP_NEW=""
VDIP_OLD=""
for VDIP_F in parse-pdf parse-docx parse-spreadsheet; do
  rm -f /tmp/vd_ip_hdr
  curl -s -m 30 -D /tmp/vd_ip_hdr -o /dev/null -X OPTIONS "$B/functions/v1/$VDIP_F" -H "apikey: $K" -H "Authorization: Bearer $K" \
    -H "Origin: https://resumebooster.work" -H "Access-Control-Request-Method: POST"
  VDIP_H=$(tr -d '\r' < /tmp/vd_ip_hdr 2>/dev/null | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g')
  if [ -n "$VDIP_H" ] && build_ge "$VDIP_F" "$VDIP_H" 2026-11-12 1; then VDIP_NEW="$VDIP_NEW $VDIP_F=$VDIP_H"
  else VDIP_OLD="$VDIP_OLD $VDIP_F=${VDIP_H:-none}"; fi
done
VDIP_LIVE=0
[ -n "$VDIP_NEW" ] && VDIP_LIVE=1
for VDIP_P in $VDIP_NEW; do
  VDIP_F=${VDIP_P%%=*}
  echo "PASS  B $VDIP_F preflight x-fn-build = ${VDIP_P#*=} (2026-11-12.1 or later: the round's parser, carrying $(vdip_what "$VDIP_F"))"
done
for VDIP_P in $VDIP_OLD; do
  VDIP_F=${VDIP_P%%=*}; VDIP_H=${VDIP_P#*=}
  if [ "$VDIP_H" = none ]; then echo "FAIL  B $VDIP_F preflight carries no x-fn-build (not deployed, or its preflight does not answer; want $VDIP_F.2026-11-12.1 or later)"
  elif [ "$VDIP_LIVE" = 1 ]; then echo "FAIL  B $VDIP_F preflight x-fn-build = $VDIP_H while another parser serves the round's build: a partial paste (want $VDIP_F.2026-11-12.1 or later, carrying $(vdip_what "$VDIP_F"))"
  else echo "INFO  B $VDIP_F preflight x-fn-build = $VDIP_H: bug round A's ingest-parsers (2026-11-12.1) is not pasted yet"; fi
done

# The published app: the entry, the scanner chunk, the Account chunk and the
# résumé text reader (component chunks first), and the lazy shard chunks.
curl -s -m 30 "$SITE/resume-checker" > /tmp/vd_ip_page.html
VDIP_ENTRY=$(grep -ao '/assets/index-[A-Za-z0-9_-]*\.js' /tmp/vd_ip_page.html | head -1)
VDIP_IDX=$(grep -ao '/assets/Index-[A-Za-z0-9_-]*\.js' /tmp/vd_ip_page.html | head -1)
[ -n "$VDIP_ENTRY" ] && curl -s -m 60 "$SITE$VDIP_ENTRY" > /tmp/vd_ip_entry.js
[ -n "$VDIP_IDX" ] && curl -s -m 60 "$SITE$VDIP_IDX" > /tmp/vd_ip_idx.js
VDIP_ACC=$( { [ -f /tmp/vd_ip_entry.js ] && grep -aoE 'assets/Account-[A-Za-z0-9_-]+\.js' /tmp/vd_ip_entry.js; } | head -1)
[ -n "$VDIP_ACC" ] && curl -s -m 60 "$SITE/$VDIP_ACC" > /tmp/vd_ip_acc.js

vdip_is_reader() { grep -qF '"parse-pdf"' "$1" 2>/dev/null && grep -qF '"parse-docx"' "$1" && grep -qF '.txt$/i' "$1"; }
VDIP_READER=""
if [ -f /tmp/vd_ip_acc.js ]; then
  if vdip_is_reader /tmp/vd_ip_acc.js; then VDIP_READER=${VDIP_ACC#assets/}; cp /tmp/vd_ip_acc.js /tmp/vd_ip_reader.js
  else
    for VDIP_C in $( { grep -aoE '"\./[A-Z][A-Za-z0-9_-]*\.js"' /tmp/vd_ip_acc.js; grep -aoE '"\./[a-z][A-Za-z0-9_-]*\.js"' /tmp/vd_ip_acc.js; } | tr -d '"' | sed 's#^\./##' | awk '!seen[$0]++'); do
      case "$VDIP_C" in index-*|rb-*) continue ;; esac
      rm -f /tmp/vd_ip_cand.js
      curl -s -m 30 "$SITE/assets/$VDIP_C" > /tmp/vd_ip_cand.js
      if vdip_is_reader /tmp/vd_ip_cand.js; then VDIP_READER=$VDIP_C; cp /tmp/vd_ip_cand.js /tmp/vd_ip_reader.js; break; fi
    done
  fi
fi

VDIP_SHARDS=$( { [ -f /tmp/vd_ip_entry.js ] && grep -aoE '"\./shards/ingest-parsers/[A-Za-z-]+\.json":\(\)=>([A-Za-z_$][A-Za-z0-9_$]*\(\(\)=>)?import\("\./[A-Za-z0-9_-]+\.js"' /tmp/vd_ip_entry.js; } \
  | sed -E 's#^"\./shards/ingest-parsers/([A-Za-z-]+)\.json".*import\("\./([A-Za-z0-9_-]+\.js)"$#\1=\2#')
for VDIP_P in $VDIP_SHARDS; do
  VDIP_L=${VDIP_P%%=*}
  rm -f "/tmp/vd_ip_shard_$VDIP_L.js"
  curl -s -m 30 "$SITE/assets/${VDIP_P#*=}" > "/tmp/vd_ip_shard_$VDIP_L.js"
done

VDIP_N_ENTRY="$VDIP_ENTRY" VDIP_N_IDX="$VDIP_IDX" VDIP_N_ACC="$VDIP_ACC" VDIP_N_READER="$VDIP_READER" VDIP_SHARDS="$VDIP_SHARDS" \
VDIP_CODES="$VDIP_CODES" VDIP_NEW="$VDIP_NEW" VDIP_LIVE="$VDIP_LIVE" node -e '
const fs = require("fs");
const rd = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const E = process.env;
const say = (v, id, m) => console.log(v + "  " + id + " " + m);
const base = (s) => s.replace(/^\/?assets\//, "");
const entry = rd("/tmp/vd_ip_entry.js"), idx = rd("/tmp/vd_ip_idx.js"), reader = rd("/tmp/vd_ip_reader.js");
const N = { entry: E.VDIP_N_ENTRY || "", idx: E.VDIP_N_IDX || "", acc: E.VDIP_N_ACC || "", reader: E.VDIP_N_READER || "" };

// L0: the layout.
const entryOk = N.entry !== "" && entry.length > 0;
const idxOk = N.idx !== "" && idx.includes("homepage.toast.fileDamaged");
const readerOk = N.reader !== "" && reader.length > 0;
if (!entryOk) say("FAIL", "L0", "/resume-checker names no readable /assets/index-*.js entry: the published app cannot be read, so S1 cannot be judged");
if (!idxOk) say("FAIL", "L0", N.idx ? "the scanner chunk " + base(N.idx) + " holds no parse-refusal map (homepage.toast.fileDamaged): the bundle layout moved, so R1 and R2 cannot be judged" : "/resume-checker names no /assets/Index-*.js scanner chunk: the bundle layout moved, so R1 and R2 cannot be judged");
if (!readerOk) say("FAIL", "L0", N.acc ? "neither the Account chunk (" + base(N.acc) + ") nor a chunk it imports holds the résumé text reader (it calls parse-pdf and parse-docx and tests a .txt name): the bundle layout moved, so T1 cannot be judged" : "the entry names no Account chunk, so the résumé text reader cannot be found and T1 cannot be judged");
if (entryOk && idxOk && readerOk) say("INFO", "L0", "chunks read: " + [N.entry, N.idx, N.reader].map(base).join(", "));

// The stage: the English shard rides in the entry.
const published = entryOk && entry.includes("\"./shards/ingest-parsers/en.json\":");
if (entryOk && !published) say("INFO", "S1", "the entry carries no ingest-parsers shard yet: the merge carrying the round has not published, so S1, R1, R2 and T1 are INFO");

// S1: the strings, as the repo writes them, in nine languages.
const LANGS = ["de", "en-GB", "es", "fr", "hi", "nl", "pt", "tl"];
const leaves = (o, p, out) => { for (const [k, v] of Object.entries(o || {})) { if (typeof v === "string") out.push([p + k, v]); else leaves(v, p + k + ".", out); } return out; };
const repo = (l) => { try { return leaves(JSON.parse(fs.readFileSync("src/i18n/shards/ingest-parsers/" + l + ".json", "utf8")).ingestParsers, "", []); } catch { return null; } };
if (published) {
  const shards = (E.VDIP_SHARDS || "").split(/\s+/).filter(Boolean).map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]);
  const named = shards.map(([l]) => l);
  const absent = LANGS.filter((l) => !named.includes(l));
  const miss = [];
  const en = repo("en");
  if (!en) miss.push("en: the repo has no src/i18n/shards/ingest-parsers/en.json to read");
  else for (const [k, v] of en) if (!entry.includes(v)) miss.push("en:" + k);
  for (const [l] of shards) {
    const vals = repo(l);
    if (!vals) { miss.push(l + ": no such shard in the repo"); continue; }
    const body = rd("/tmp/vd_ip_shard_" + l + ".js");
    for (const [k, v] of vals) if (!body.includes(v)) miss.push(l + ":" + k);
  }
  if (absent.length) say("FAIL", "S1", "S14X-183 the entry carries the English ingest-parsers shard but names no lazy shard for " + absent.join(", ") + ": those readers see keys where the refusals should be");
  else if (miss.length) say("FAIL", "S1", "S14X-183 ingest-parsers strings missing from the published shards: " + miss.slice(0, 12).join(", ") + (miss.length > 12 ? " and " + (miss.length - 12) + " more" : ""));
  else say("PASS", "S1", "S14X-183 the entry carries the English ingest-parsers shard and names 8 more (" + LANGS.join(", ") + "), each holding all " + en.length + " refusal and notice strings in the repo\x27s own words");
}

// R1, R2: the refusal map and the notices, in the scanner chunk.
if (idxOk) {
  const codes = (E.VDIP_CODES || "").split(" ").filter(Boolean);
  const missing = codes.filter((c) => !new RegExp("[{,]" + c + ":").test(idx));
  if (!idx.includes("ingestParsers.refusal.")) missing.push("the ingestParsers.refusal keys");
  if (!idx.includes("docxGarbled")) missing.push("a Word title for garbled text (docxGarbled)");
  const named = codes.filter((c) => new RegExp("[{,]" + c + ":").test(idx)).length;
  if (!published) say("INFO", "R1", "S14X-183 the scanner chunk " + base(N.idx) + " maps " + named + " of the " + codes.length + " refusal codes the round adds: not published yet");
  else if (missing.length) say("FAIL", "R1", "S14X-183 the scanner chunk " + base(N.idx) + " is the published round but its refusal map lacks " + missing.join(", ") + ": that refusal shows the page\x27s English fallback");
  else say("PASS", "R1", "S14X-183 the scanner chunk " + base(N.idx) + " maps every refusal code (" + codes.join(", ") + ") to the ingestParsers strings, and a Word document\x27s garbled text gets a title that does not say PDF");
  const notices = ["rtl_unreliable", "image_pages_skipped"].filter((c) => !idx.includes("\"" + c + "\""));
  if (!published) say("INFO", "R2", "S14X-044 S14X-282 the scanner chunk says " + (2 - notices.length) + " of the 2 new notices: not published yet");
  else if (notices.length) say("FAIL", "R2", "S14X-044 S14X-282 the scanner chunk " + base(N.idx) + " is the published round but says no " + notices.join(" or ") + " notice: an accepted upload that lost order or skipped pages says nothing");
  else say("PASS", "R2", "S14X-044 S14X-282 the scanner chunk says an Arabic PDF may read out of order (rtl_unreliable) and how many pages had no text (image_pages_skipped)");
}

// T1: the résumé text reader.
if (readerOk) {
  const lack = [];
  for (const [m, what] of [["utf-16le", "UTF-16 LE by its byte-order mark"], ["utf-16be", "UTF-16 BE by its byte-order mark"], ["windows-1252", "windows-1252 for bytes that are not UTF-8"]]) if (!reader.includes("\"" + m + "\"")) lack.push(what);
  if (!reader.includes("\\u2010-\\u2012") && !reader.includes("‐-‒")) lack.push("the intake cleanup of hyphens and invisible marks");
  if (!published) say("INFO", "T1", "S14X-283 S14X-280 the résumé text reader " + base(N.reader) + " lacks " + lack.length + " of its 4 marks: not published yet");
  else if (lack.length) say("FAIL", "T1", "S14X-283 S14X-280 the résumé text reader " + base(N.reader) + " is the published round but does not decode " + lack.join(", ") + ": a Notepad Unicode .txt still reads as NULs between letters");
  else say("PASS", "T1", "S14X-283 S14X-280 the résumé text reader " + base(N.reader) + " decodes a .txt by its byte-order mark (utf-16le, utf-16be), reads other bytes as windows-1252 when they are not UTF-8, and cleans hyphens and invisible marks as the parsers do");
}

// O: the owner-gated key. ownerDecided maps key -> choice (a string, or an
// object with a choice), written by the integrator alone.
let l = {}; try { l = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch {}
const d = ((l.reservations || {})["bug-round"] || {}).ownerDecided || {};
const v = d["S14X-101"];
const od = v == null ? "" : typeof v === "object" ? String(v.choice ?? v.option ?? JSON.stringify(v)) : String(v);
const live = " " + (E.VDIP_NEW || "") + " ";
const lag = ["parse-pdf", "parse-docx"].filter((f) => !live.includes(" " + f + "="));
if (od === "") say("INFO", "S14X-101", "owner pending: parse-pdf\x27s and parse-docx\x27s failure alerts still carry the uploader\x27s address until the owner\x27s answer is recorded");
else if (lag.length === 0) say("PASS", "S14X-101", "decided (" + od + "): parse-pdf and parse-docx, whose failure alerts no longer carry the uploader\x27s address, serve the round\x27s build (the alert body is proven in the suite: a live alert needs a failing upload)");
else if (E.VDIP_LIVE === "1") say("FAIL", "S14X-101", "decided (" + od + "), but " + lag.join(" and ") + " does not serve the round\x27s build while another parser does");
else say("INFO", "S14X-101", "decided (" + od + "); parse-pdf and parse-docx do not serve the round\x27s build yet");
' "$VDIP_LEDGER"

echo "INFO  proven in the suite, never here (each needs an upload, which spends a parse slot and can write a refusal row): Arabic and Hebrew PDFs in reading order, a Mac CJK PDF's spaces and radicals, link addresses kept, a hyphen or an invisible mark that splits no word, a résumé followed by image pages, a damaged, tracked-move, nested text box, web-content or list-style Word file, the header-only contact, an Excel CSV's encoding, the Sheets tab a link names, the patched SheetJS, and a code on every refusal"
