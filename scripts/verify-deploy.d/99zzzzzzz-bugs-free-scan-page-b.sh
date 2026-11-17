# shellcheck shell=bash
# ── 99zzzzzzz-bugs-free-scan-page-b. THE BUG ROUND OF 2026-11-08, PART B,
# LANE FREE-SCAN-PAGE-B (branch bugs/b-free-scan-page): RC-S13-018, the free
# report names its industry with one label. The lane changes no function and
# no migration; the merge publishes it with the page.
#
# Named 99zzzzzzz-bugs-*-b as the ledger's bug-round verifySections list it:
# it sorts after every 99zzzzzz-* file in byte order and under a locale that
# ignores the dash.
#
# WHAT WAS WRONG: the report's "We read this as" select reads the scanner's
# label function in the reader's language, but the score hero title-cased the
# raw industry id and the industry card kept an English label map of its own,
# so an HR resume read three ways on one page and a German reader saw the hero
# and the card in English. Both now call the select's label function.
#
# THE CHUNKS, read from production, never assumed: /resume-checker preloads
# the scanner's chunk (/assets/Index-*.js), which names the report's chunk
# (FreeKeywordResults-*.js). The score hero and the industry card ride in the
# report chunk: it reads scoreHero.analysisComplete and
# industryConfidence.isThisRight.
#
# THE STAGE: the lane marks the two lines it changed, the hero's industry
# (data-hero-industry) and the card's heading (data-industry-label). Until the
# report chunk carries them the claim is INFO ("not yet published"); from then
# on it is PASS or FAIL.
#
# THE CLAIMS, one line each:
#   L0  the report chunk can be read and holds the hero and the card (FAIL
#       when the layout moved: the claim below could not be judged).
#   L1  the stage; FAIL when only one of the two marks is published.
#   RC-S13-018  the report chunk carries neither the card's own label map
#       (its software, hr, humanResources and creative pairs) nor the hero's
#       title-casing of the raw id.
#   X1  INFO: that the hero, the card and the select say the same words for
#       every id, in English and in German, is proved in the suite
#       (the-report-names-its-industry-with-one-label-in-the-hero-the-card-
#       and-the-select).
#
# READ-ONLY. GETs of /resume-checker and two chunks. Nothing is posted and no
# scan is run.
echo "== 99zzzzzzz-bugs-free-scan-page-b. bug round part B, free-scan-page-b lane: the report names its industry with one label =="

rm -f /tmp/vd_bfspb_page.html /tmp/vd_bfspb_idx.js /tmp/vd_bfspb_fkr.js
curl -s -m 30 "$SITE/resume-checker" > /tmp/vd_bfspb_page.html
VDFSB_IDX=$(grep -ao '/assets/Index-[A-Za-z0-9_-]*\.js' /tmp/vd_bfspb_page.html | head -1)
[ -n "$VDFSB_IDX" ] && curl -s -m 60 "$SITE$VDFSB_IDX" > /tmp/vd_bfspb_idx.js
VDFSB_FKR=$( { [ -f /tmp/vd_bfspb_idx.js ] && grep -ao 'FreeKeywordResults-[A-Za-z0-9_-]*\.js' /tmp/vd_bfspb_idx.js; } | head -1)
[ -n "$VDFSB_FKR" ] && curl -s -m 60 "$SITE/assets/$VDFSB_FKR" > /tmp/vd_bfspb_fkr.js

VDFSB_N_IDX="$VDFSB_IDX" VDFSB_N_FKR="$VDFSB_FKR" node -e '
const fs = require("fs");
const rd = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const E = process.env;
const fkr = rd("/tmp/vd_bfspb_fkr.js");
const say = (v, id, m) => console.log(v + "  " + id + " " + m);

// L0: the layout.
const unread = [];
if (!E.VDFSB_N_IDX) unread.push("the scanner chunk (/resume-checker preloads no /assets/Index-*.js)");
else if (!E.VDFSB_N_FKR) unread.push("the report chunk (the scanner chunk names no FreeKeywordResults-*.js)");
else if (!fkr) unread.push("the report chunk " + E.VDFSB_N_FKR + " (no body)");
else {
  if (!/scoreHero\.analysisComplete/.test(fkr)) unread.push("the score hero (the report chunk reads no scoreHero.analysisComplete)");
  if (!/industryConfidence\.isThisRight/.test(fkr)) unread.push("the industry card (the report chunk reads no industryConfidence.isThisRight)");
}
if (unread.length) {
  say("FAIL", "L0", "could not read " + unread.join(" or ") + ": the bundle layout moved, so RC-S13-018 cannot be judged");
  process.exit(0);
}
say("INFO", "L0", "chunks read: " + E.VDFSB_N_IDX.replace("/assets/", "") + ", " + E.VDFSB_N_FKR);

// L1: the stage.
const heroMark = /"data-hero-industry":/.test(fkr);
const cardMark = /"data-industry-label":/.test(fkr);
const live = heroMark && cardMark;
if (live) say("PASS", "L1", "the report chunk carries both of the lane\x27s marks (the hero\x27s industry line and the card\x27s heading): the merge carrying part B published");
else if (heroMark || cardMark) say("FAIL", "L1", "the report chunk carries only the " + (heroMark ? "hero\x27s" : "card\x27s") + " mark: the hero and the card were not built from one commit of the lane");
else say("INFO", "L1", "the report chunk carries neither of the lane\x27s marks: the merge carrying part B has not published, so RC-S13-018 is INFO");

// RC-S13-018.
const MAP = /\bsoftware:"Software\/Tech"|\bhumanResources:"Human Resources"|\bhr:"Human Resources"|\bcreative:"Creative\/Design"/;
const TITLE = /\.replace\(\/_\/g," "\)\.replace\(\/\\b\\w\/g,/;
const map = MAP.test(fkr), title = TITLE.test(fkr);
const what = "the hero and the industry card name the industry with the select\x27s label: the card\x27s own English map and the hero\x27s title-casing of the raw id are gone";
const why = [map ? "the report chunk still carries the card\x27s own label map (" + (fkr.match(MAP) || [""])[0] + ")" : "", title ? "the report chunk still title-cases a raw id the way the hero did (.replace(/_/g,\" \").replace(/\\b\\w/g, ...))" : ""].filter(Boolean).join("; ");
if (heroMark || cardMark) say(!map && !title ? "PASS" : "FAIL", "RC-S13-018", what + (why ? " — but " + why : ""));
else say("INFO", "RC-S13-018", what + ": not yet published" + (!map && !title ? " (already holds today: neither tell is in the report chunk)" : " (today: " + why + ")"));

say("INFO", "X1", "proved in the suite, not from outside: the hero, the card and the select say the same words for every id the scanner knows, in English and in German (the-report-names-its-industry-with-one-label-in-the-hero-the-card-and-the-select)");
'
