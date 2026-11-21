# shellcheck shell=bash
# ── 52i. THE CHANGELOG OF 21 NOVEMBER: five entries for main at 4a3c2a0bd,
# which went live on 21 November carrying bug round B (PR #67) and job-board
# 2026-09-09.103 (PR #71): board searches that read back end and backend as
# one word and six employers joining the board; company pages that say when a
# figure counts a whole hiring system, and the German Austria page; counts,
# dates, the release notes and the skip link in the reader's language, and a
# move to another page said and focused; a Unicode .txt read at every upload
# box, the free report's one industry label and progress screens that name no
# model; and the affiliate banners. They were written after that deploy
# verified and ship in the frontend publish that follows. Each claim was read
# against production on 21 November, read-only: job-board's preflight build,
# the verify run's search-reach PASS lines and its row A reading,
# get_company_intel by GET for each employer, the published entry and the
# chunks it names (the US English strings, the Jobs, scanner, report, success,
# account, changelog and affiliate chunks, the résumé text reader, the German
# strings), the crawler copies of the two Austria pages, and the nine banner
# files. No sign-in, purchase, scan, model call or mail.
#
# BEFORE AND AFTER THAT PUBLISH, AS 52h. The US English changelog chunk the
# browser loads (scripts/verify-us-english.sh, never en-GB) tells the two
# apart; once it carries this batch's first key the publish has happened.
# Before it, every line about the entries themselves is INFO. The same rules
# as 52h then hold: each title on the crawler page dated 2026-11-21, or past
# the newest 30 entries with the US chunk carrying it; the page description's
# newest entry no older than 2026-11-21; one string per description, found
# once in the whole US shard; and each of the other eight languages'
# changelog chunk carrying all five keys, so an entry missing in any language
# FAILs.
#
# WHAT THE ENTRIES CLAIM. The features shipped before the entries do, so every
# claim is judged on today's production whether or not the entries are
# published yet: a claim that stops being true FAILs before its entry goes
# out. VD52I_CLAIMS lists, for each check, the entry it backs and the words of
# that entry's English description it backs; every sentence of each
# description carries one of them (the test holds that). The checks:
#   B1  job-board answers 2026-09-09.103 or later: the build whose search
#       joins back end, front end, full stack and dev ops into one word and
#       lets developer find engineer inside a software family. The search
#       itself is not asked here: every job-board action spends the anonymous
#       allowance and writes a row, and this section writes nothing. The verify
#       run of 21 November read it (SR pair lines: one total in each spelling;
#       full stack developer over the floor that rests on engineer).
#   B2  each employer the entry names serves open roles under its own hiring
#       system, read from get_company_intel by GET (PostgREST runs a GET in a
#       read-only transaction). One at zero while others serve is INFO, since
#       an employer can close every posting; none serving, or an answer that
#       cannot be read, FAILs.
#   C1-C3  the company page's pooled line and Pay median, the heading of a
#       board with no name, and the hiring badge's board: the English words in
#       the US English strings and their keys in the Jobs chunk or a chunk it
#       imports.
#   C4  the crawler copies of /de/lebenslauf-standards/oesterreich and
#       /cv-standards/austria state the same two conventions, and the German
#       one no longer says Zeugnisse werden erwartet.
#   L1  no bare toLocale string method or Intl formatter in the entry, the
#       board, the scanner, its report or the account page.
#   L2  the changelog page chunk carries data-changelog-lng.
#   L3  the entry localises the shell's skip link, and a German strings chunk
#       carries its German words.
#   L4  the entry carries the route announcer, a polite live region, and the
#       list of where focus lands on a new page.
#   U1  the scanner, the board and the success page read a .txt through the
#       chunk that decodes UTF-16 by its byte-order mark, and none reads one
#       with the UTF-8-only File text().
#   U2  the scanner and the success page refuse an unreadable .txt with the
#       ingest-parsers key.
#   U3  the report chunk carries the hero's and the card's marks, and neither
#       the card's own label map nor the hero's title-casing.
#   U4  no progress string in US English names a model, the success page's
#       overlay reads its title from the strings and names no model, and a
#       German strings chunk carries its German title.
#   K1-K3  the six banner files at their sizes, the three old addresses at
#       the sizes their labels named, and the kit naming the six fixed
#       addresses with a newsletter that says what the scan shows.
#
# Its own names only: every variable here starts VD52I_, because the sections
# share one shell and K, RB, B, SITE and UA belong to every section after it.
#
# Read-only: crawler GETs of /changelog and the two Austria pages, GETs of the
# home page, /resume-checker, the entry script and its chunks, the nine banner
# files and get_company_intel, and one OPTIONS preflight of job-board.
# Nothing is sent, bought or written.
echo "== 52i. changelog of 21 November on the crawler copy of /changelog, and what its entries claim on today's production =="
rm -rf /tmp/vd_52i_*
VD52I_CL=$(curl -s -m 30 -A "$UA" "$SITE/changelog")
curl -s -m 30 "$SITE/" -o /tmp/vd_52i_home.html
VD52I_MAIN=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' /tmp/vd_52i_home.html 2>/dev/null | head -1)
if [ -n "$VD52I_MAIN" ]; then curl -s -m 60 "$SITE$VD52I_MAIN" -o /tmp/vd_52i_entry.js; else : > /tmp/vd_52i_entry.js; fi

# The US English chunks verify-us-english.sh prints (never en-GB): all of them
# are the US English strings, and the first carrying the changelog's anchor is
# the US changelog chunk.
VD52I_US=""
VD52I_CH=""
: > /tmp/vd_52i_en.js
for VD52I_CX in $(bash scripts/verify-us-english.sh "$SITE$VD52I_MAIN"); do
  VD52I_TRY=$(curl -s -m 60 "$SITE/assets/$VD52I_CX")
  printf '%s\n' "$VD52I_TRY" >> /tmp/vd_52i_en.js
  [ -z "$VD52I_CH" ] || continue
  printf '%s' "$VD52I_TRY" | grep -q "workdayCompanyPagesLostTheirFacts" || continue
  VD52I_US=$VD52I_TRY
  VD52I_CH=$VD52I_CX
done
VD52I_PUB=0
if [ -z "$VD52I_US" ]; then
  echo "FAIL  no US English changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts (the frontend is not serving, or the bundle layout moved): nothing below can tell a published batch from an unpublished one"
elif printf '%s' "$VD52I_US" | grep -q "boardSearchesReadBothSpellingsAndListMoreEmployers"; then
  VD52I_PUB=1
  echo "PASS  the US English changelog chunk ($VD52I_CH) carries the 21 November entries: the frontend publish has happened, so every line about them is judged"
else
  echo "INFO  the US English changelog chunk ($VD52I_CH) does not carry the 21 November entries yet: their frontend publish has not happened, so every line about them is INFO (what they claim is judged below all the same)"
fi

VD52I_DATES=$(printf '%s' "$VD52I_CL" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} · [A-Za-z ·]*</p><h2' | cut -c1-10)
VD52I_N=$(printf '%s' "$VD52I_DATES" | grep -c '^[0-9]')
VD52I_OLDEST=$(printf '%s\n' "$VD52I_DATES" | sort | head -1)
while IFS='|' read -r VD52I_D VD52I_T; do
  [ -n "$VD52I_T" ] || continue
  VD52I_ROW=$(printf '%s' "$VD52I_CL" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2} · [A-Za-z ·]*</p><h2[^>]*>[^<]*<' | grep -F ">$VD52I_T<" | head -1 | cut -c1-10)
  if [ -n "$VD52I_ROW" ] && [ "$VD52I_ROW" = "$VD52I_D" ]; then echo "PASS  /changelog serves crawlers \"$VD52I_T\", dated $VD52I_D"
  elif [ "$VD52I_PUB" != 1 ]; then echo "INFO  /changelog does not serve \"$VD52I_T\" yet (the frontend publish after this deploy's record has not happened)"
  elif [ -n "$VD52I_ROW" ]; then echo "FAIL  /changelog dates \"$VD52I_T\" $VD52I_ROW, want $VD52I_D, the day its deploy went live"
  elif ! printf '%s' "$VD52I_US" | grep -qF "$VD52I_T"; then echo "FAIL  the 21 November entries are published, but neither /changelog nor the US English changelog strings carry \"$VD52I_T\" (an entry was dropped or retitled when it landed)"
  elif [ "$VD52I_N" -ge 30 ] && [ ! "$VD52I_OLDEST" \< "$VD52I_D" ]; then echo "PASS  \"$VD52I_T\" is past the newest 30 entries the crawler page lists, and the US English changelog strings carry it"
  else echo "FAIL  the US English changelog strings carry \"$VD52I_T\", but the crawler copy of /changelog does not (the prerender did not rebuild)"; fi
done <<'VD52I_TITLES'
2026-11-21|Board searches read back end and backend as one word, and more employers' jobs are listed
2026-11-21|Company pages say when a figure counts an employer's whole hiring system, and the German Austria page matches the English one
2026-11-21|Counts, dates, the release notes and the skip link follow the language you chose, and a move to another page is announced
2026-11-21|A .txt résumé saved as Unicode text is read wherever you upload one, and the free report names your industry in one set of words
2026-11-21|Affiliate banners are the size their labels say, at fixed addresses
VD52I_TITLES

VD52I_LATEST=$(printf '%s' "$VD52I_CL" | grep -oE 'Latest \([0-9]{4}-[0-9]{2}-[0-9]{2}\)' | head -1 | cut -c9-18)
if [ "$VD52I_PUB" != 1 ]; then echo "INFO  the date of the newest entry the page describes is judged after the publish"
elif [ -z "$VD52I_LATEST" ]; then echo "FAIL  /changelog's description names no newest entry (the bake fell back to its no-entries sentence, or its markup moved)"
elif [ "$VD52I_LATEST" \< "2026-11-21" ]; then echo "FAIL  /changelog's description names an entry of $VD52I_LATEST as the newest, older than this batch's 2026-11-21 (the prerender did not rebuild)"
else echo "PASS  /changelog's description names an entry of $VD52I_LATEST as the newest, no older than this batch's 2026-11-21"; fi

while IFS='|' read -r VD52I_K VD52I_M; do
  [ -n "$VD52I_M" ] || continue
  if [ "$VD52I_PUB" != 1 ]; then echo "INFO  the description of $VD52I_K is judged after the publish"
  elif printf '%s' "$VD52I_US" | grep -qF "$VD52I_M"; then echo "PASS  the US English changelog strings describe $VD52I_K with \"$VD52I_M\""
  else echo "FAIL  the US English changelog strings carry no \"$VD52I_M\" for $VD52I_K: its description is not the one read live on 21 November"; fi
done <<'VD52I_MUST'
boardSearchesReadBothSpellingsAndListMoreEmployers|so either spelling finds the same jobs
companyPagesSayWhenAFigureCountsAWholeHiringSystem|the line naming the countries with the most roles now says so
figuresDatesReleaseNotesAndSkipLinkFollowYourLanguage|now changes to your language once the site has loaded
aUnicodeTxtResumeIsReadWhereverYouUploadOne|Unicode option is now read as text wherever you upload a
affiliateBannersAreTheSizeTheirLabelsSay|still loads from its old address, now at the size its label named
VD52I_MUST

VD52I_KEYS="boardSearchesReadBothSpellingsAndListMoreEmployers companyPagesSayWhenAFigureCountsAWholeHiringSystem figuresDatesReleaseNotesAndSkipLinkFollowYourLanguage aUnicodeTxtResumeIsReadWhereverYouUploadOne affiliateBannersAreTheSizeTheirLabelsSay"
if [ "$VD52I_PUB" != 1 ]; then
  echo "INFO  the other eight languages' changelog strings are judged after the publish"
else
  for VD52I_L in en-GB de es fr hi nl pt tl; do
    VD52I_LC=""
    VD52I_LCH=""
    for VD52I_LCX in $(grep -oE "\"\\./$VD52I_L-[A-Za-z0-9_-]+\\.js\"" /tmp/vd_52i_entry.js | tr -d '"' | sed 's|^\./||' | sort -u); do
      VD52I_TRY=$(curl -s -m 30 "$SITE/assets/$VD52I_LCX")
      printf '%s' "$VD52I_TRY" | grep -q "workdayCompanyPagesLostTheirFacts" || continue
      VD52I_LC=$VD52I_TRY
      VD52I_LCH=$VD52I_LCX
      break
    done
    if [ -z "$VD52I_LC" ]; then echo "FAIL  no $VD52I_L changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts: the 21 November entries cannot be shown in $VD52I_L"; continue; fi
    VD52I_MISS=""
    for VD52I_K in $VD52I_KEYS; do printf '%s' "$VD52I_LC" | grep -q "$VD52I_K" || VD52I_MISS="$VD52I_MISS $VD52I_K"; done
    if [ -z "$VD52I_MISS" ]; then echo "PASS  the $VD52I_L changelog strings ($VD52I_LCH) carry all five 21 November entries"
    else echo "FAIL  the $VD52I_L changelog strings ($VD52I_LCH) lack$VD52I_MISS: the publish did not ship the 21 November entries in $VD52I_L"; fi
  done
fi

# ── What the entries claim, on today's production. ──────────────────────────
# B1: job-board's build, from its preflight (no database is touched).
curl -s -m 30 -X OPTIONS -D /tmp/vd_52i_jb.hdr -o /dev/null "$B/functions/v1/job-board"
VD52I_BUILD=$(grep -i '^x-fn-build:' /tmp/vd_52i_jb.hdr 2>/dev/null | head -1 | cut -d: -f2- | tr -d ' \r')
if build_ge job-board "$VD52I_BUILD" 2026-09-09 103; then
  echo "PASS  B1 job-board answers ${VD52I_BUILD} (2026-09-09.103 or later): the search serving the board reads back end, front end, full stack and dev ops as one word in either spelling, and lets developer find engineer inside a software family"
else
  echo "FAIL  B1 job-board answers ${VD52I_BUILD:-no build} (want 2026-09-09.103 or later): the search serving the board is not the one the board-search entry describes"
fi

# B2: each employer's open roles under its own hiring system, by GET.
while IFS='|' read -r VD52I_V VD52I_TOK VD52I_NAME; do
  [ -n "$VD52I_TOK" ] || continue
  curl -s -m 30 "$B/rest/v1/rpc/get_company_intel?p_token=$VD52I_TOK" -H "apikey: $K" -H "Authorization: Bearer $K" -o "/tmp/vd_52i_intel_$VD52I_TOK.json"
  printf '%s|%s|%s\n' "$VD52I_V" "$VD52I_TOK" "$VD52I_NAME" >> /tmp/vd_52i_employers.txt
done <<'VD52I_EMPLOYERS'
greenhouse|castelioncorporation|Castelion Corporation
greenhouse|aidocmedical|Aidoc
greenhouse|dropzoneai|Dropzone AI
teamtailor|sipearl|SiPearl
lever|upscale-ai|Upscale AI
lever|mythic-ai.com|Mythic
VD52I_EMPLOYERS

# C1-C3, L1, U1: the Jobs chunk with every chunk it imports.
: > /tmp/vd_52i_board.js
VD52I_JOBSN=$(grep -oE 'assets/Jobs-[A-Za-z0-9_-]+\.js' /tmp/vd_52i_entry.js 2>/dev/null | head -1 | sed 's#^assets/##')
if [ -n "$VD52I_JOBSN" ]; then
  curl -s -m 60 "$SITE/assets/$VD52I_JOBSN" -o /tmp/vd_52i_jobs.js
  cat /tmp/vd_52i_jobs.js >> /tmp/vd_52i_board.js 2>/dev/null
  for VD52I_C in $(grep -oE 'from"\./[A-Za-z0-9_-]+\.js"' /tmp/vd_52i_jobs.js 2>/dev/null | sed -E 's/^from"\.\/(.*)"$/\1/' | sort -u); do
    case "$VD52I_C" in index-*) continue;; esac
    curl -s -m 30 "$SITE/assets/$VD52I_C" -o "/tmp/vd_52i_dep.js"
    { echo; cat /tmp/vd_52i_dep.js 2>/dev/null; } >> /tmp/vd_52i_board.js
  done
fi

# U1-U3, L1: the scanner /resume-checker preloads, its report, and the page
# chunks the entry names.
curl -s -m 30 "$SITE/resume-checker" -o /tmp/vd_52i_rc.html
VD52I_IDX=$(grep -ao '/assets/Index-[A-Za-z0-9_-]*\.js' /tmp/vd_52i_rc.html 2>/dev/null | head -1)
if [ -n "$VD52I_IDX" ]; then curl -s -m 60 "$SITE$VD52I_IDX" -o /tmp/vd_52i_idx.js; else : > /tmp/vd_52i_idx.js; fi
VD52I_FKR=$(grep -ao 'FreeKeywordResults-[A-Za-z0-9_-]*\.js' /tmp/vd_52i_idx.js 2>/dev/null | head -1)
if [ -n "$VD52I_FKR" ]; then curl -s -m 60 "$SITE/assets/$VD52I_FKR" -o /tmp/vd_52i_fkr.js; else : > /tmp/vd_52i_fkr.js; fi
vd52i_page() { # $1 page chunk prefix, $2 file
  local n
  n=$(grep -oE "/$1-[A-Za-z0-9_-]+\\.js" /tmp/vd_52i_entry.js 2>/dev/null | head -1 | sed 's#^/##')
  if [ -n "$n" ]; then curl -s -m 60 "$SITE/assets/$n" -o "/tmp/vd_52i_$2.js"; else : > "/tmp/vd_52i_$2.js"; fi
  printf '%s' "$n"
}
VD52I_PSN=$(vd52i_page ProductSuccess ps)
VD52I_ACCN=$(vd52i_page Account acc)
VD52I_CLPN=$(vd52i_page Changelog clp)
VD52I_AFFN=$(vd52i_page Affiliates aff)
# The résumé text reader each upload box imports.
VD52I_DECN=$(cat /tmp/vd_52i_idx.js /tmp/vd_52i_ps.js /tmp/vd_52i_jobs.js 2>/dev/null | grep -oE 'from"\./resumeText-[A-Za-z0-9_-]+\.js"' | head -1 | sed -E 's/^from"\.\/(.*)"$/\1/')
if [ -n "$VD52I_DECN" ]; then curl -s -m 30 "$SITE/assets/$VD52I_DECN" -o /tmp/vd_52i_dec.js; else : > /tmp/vd_52i_dec.js; fi

# L3, U4: the German strings, from the de-*.js chunks the entry names.
VD52I_DESKIP=""
VD52I_DEKI=""
for VD52I_DC in $(grep -oE '"\./de-[A-Za-z0-9_-]+\.js"' /tmp/vd_52i_entry.js 2>/dev/null | tr -d '"' | sed 's|^\./||' | sort -u); do
  [ -n "$VD52I_DESKIP" ] && [ -n "$VD52I_DEKI" ] && break
  curl -s -m 30 "$SITE/assets/$VD52I_DC" -o /tmp/vd_52i_de.js
  [ -z "$VD52I_DESKIP" ] && grep -q 'Zum Hauptinhalt springen' /tmp/vd_52i_de.js 2>/dev/null && VD52I_DESKIP=$VD52I_DC
  [ -z "$VD52I_DEKI" ] && grep -q 'Die KI arbeitet' /tmp/vd_52i_de.js 2>/dev/null && VD52I_DEKI=$VD52I_DC
done

# C4: the two Austria pages, as a crawler reads them.
curl -s -m 60 -A "$UA" "$SITE/de/lebenslauf-standards/oesterreich" -o /tmp/vd_52i_at_de.html
curl -s -m 60 -A "$UA" "$SITE/cv-standards/austria" -o /tmp/vd_52i_at_en.html

# K1-K2: the banner files, with the status line and type the host sent.
VD52I_I=0
while IFS='|' read -r VD52I_KC VD52I_WH VD52I_PATH; do
  [ -n "$VD52I_PATH" ] || continue
  VD52I_I=$((VD52I_I + 1))
  curl -s -m 30 -D "/tmp/vd_52i_bn$VD52I_I.hdr" -o "/tmp/vd_52i_bn$VD52I_I.bin" "$SITE$VD52I_PATH"
  printf '%s|%s|%s|%s\n' "$VD52I_I" "$VD52I_KC" "$VD52I_WH" "$VD52I_PATH" >> /tmp/vd_52i_banners.txt
done <<'VD52I_BANNERS'
K1|728x90|/affiliate/banner-728x90.png
K1|300x250|/affiliate/banner-300x250.png
K1|160x600|/affiliate/banner-160x600.png
K1|728x90|/affiliate/banner-728x90.svg
K1|300x250|/affiliate/banner-300x250.svg
K1|160x600|/affiliate/banner-160x600.svg
K2|728x90|/assets/banner-leaderboard-7wRFqWjL.png
K2|300x250|/assets/banner-square-Cs_OOO75.png
K2|160x600|/assets/banner-skyscraper-CCTK8RI-.png
VD52I_BANNERS

# Each claim, the entry it backs, and the words of that entry's English
# description it backs. Every sentence of each description carries one.
cat > /tmp/vd_52i_claims.txt <<'VD52I_CLAIMS'
B1|boardSearchesReadBothSpellingsAndListMoreEmployers|so either spelling finds the same jobs
B1|boardSearchesReadBothSpellingsAndListMoreEmployers|developer now also finds jobs titled engineer
B2|boardSearchesReadBothSpellingsAndListMoreEmployers|lists the jobs of Castelion Corporation, Aidoc, Dropzone AI, SiPearl, Upscale AI and Mythic
C1|companyPagesSayWhenAFigureCountsAWholeHiringSystem|the line naming the countries with the most roles now says so, and so does the median on the Pay card
C2|companyPagesSayWhenAFigureCountsAWholeHiringSystem|is now headed with the name of its hiring system, or simply as this board
C3|companyPagesSayWhenAFigureCountsAWholeHiringSystem|the description of the actively hiring badge now says its record is for one of those boards
C4|companyPagesSayWhenAFigureCountsAWholeHiringSystem|the German page on CV conventions in Austria now says what the English page says
C4|companyPagesSayWhenAFigureCountsAWholeHiringSystem|It no longer says that references and certificates (Zeugnisse) are expected
L1|figuresDatesReleaseNotesAndSkipLinkFollowYourLanguage|are now written the way the language you chose on the site writes them
L2|figuresDatesReleaseNotesAndSkipLinkFollowYourLanguage|the release notes on this page now change with it
L3|figuresDatesReleaseNotesAndSkipLinkFollowYourLanguage|now changes to your language once the site has loaded
L4|figuresDatesReleaseNotesAndSkipLinkFollowYourLanguage|a screen reader now reads out the new page's title
L4|figuresDatesReleaseNotesAndSkipLinkFollowYourLanguage|keyboard focus moves to the new page's main content
U1|aUnicodeTxtResumeIsReadWhereverYouUploadOne|Unicode option is now read as text wherever you upload a
U2|aUnicodeTxtResumeIsReadWhereverYouUploadOne|a .txt file that is still not text is refused with a message in your language
U3|aUnicodeTxtResumeIsReadWhereverYouUploadOne|now name your industry in the same words as the menu where you can correct it
U4|aUnicodeTxtResumeIsReadWhereverYouUploadOne|no longer name an AI model
U4|aUnicodeTxtResumeIsReadWhereverYouUploadOne|the one for a paid document now uses your language
K1|affiliateBannersAreTheSizeTheirLabelsSay|is now the size its label states, as a PNG and as an SVG, at a fixed address on our site
K2|affiliateBannersAreTheSizeTheirLabelsSay|still loads from its old address, now at the size its label named
K3|affiliateBannersAreTheSizeTheirLabelsSay|now describes the free scan by what it shows
VD52I_CLAIMS
VD52I_P=/tmp/vd_52i_ VD52I_JOBSN="$VD52I_JOBSN" VD52I_IDX="$VD52I_IDX" VD52I_FKR="$VD52I_FKR" VD52I_PSN="$VD52I_PSN" VD52I_ACCN="$VD52I_ACCN" VD52I_CLPN="$VD52I_CLPN" VD52I_AFFN="$VD52I_AFFN" VD52I_DECN="$VD52I_DECN" VD52I_DESKIP="$VD52I_DESKIP" VD52I_DEKI="$VD52I_DEKI" VD52I_MAIN="$VD52I_MAIN" node -e '
const fs = require("fs");
const E = process.env, P = E.VD52I_P;
const txt = (f) => { try { return fs.readFileSync(P + f, "utf8"); } catch { return ""; } };
const bin = (f) => { try { return fs.readFileSync(P + f); } catch { return Buffer.alloc(0); } };
const count = (s, n) => s.split(n).length - 1;
const out = {};
const judge = (id, ok, m) => { out[id] = (ok === true ? "PASS" : ok === "info" ? "INFO" : "FAIL") + "  " + id + " " + m; };
const ENTRY = txt("entry.js"), EN = txt("en.js"), BOARD = txt("board.js"), IDX = txt("idx.js"), FKR = txt("fkr.js");
const PS = txt("ps.js"), ACC = txt("acc.js"), CLP = txt("clp.js"), AFF = txt("aff.js"), DEC = txt("dec.js");
const lacks = (s, list) => list.filter((x) => !s.includes(x));
const named = (n) => n || "(none named)";

// B2: each employer, by its own hiring system.
{
  const rows = txt("employers.txt").split("\n").filter(Boolean).map((l) => l.split("|"));
  const seen = [], zero = [], bad = [];
  for (const [v, tok, name] of rows) {
    let j = null; try { j = JSON.parse(txt("intel_" + tok + ".json")); } catch {}
    const src = j && Array.isArray(j.open_by_source) ? j.open_by_source : null;
    if (!src) { bad.push(name + " (" + v + ":" + tok + ")"); continue; }
    const n = Number((src.find((x) => x && x.source === v) || {}).open_roles || 0);
    (n > 0 ? seen : zero).push(name + " " + v + ":" + tok + " " + n);
  }
  if (!rows.length) judge("B2", false, "no employer was read");
  else if (bad.length) judge("B2", false, "get_company_intel answered no open_by_source for " + bad.join(", ") + ": the employers the board-search entry names cannot be read");
  else if (!seen.length) judge("B2", false, "none of the " + rows.length + " employers the board-search entry names serves an open role under its own hiring system: " + zero.join(", "));
  else if (zero.length) judge("B2", "info", seen.length + " of " + rows.length + " employers the entry names serve open roles under their own hiring system (" + seen.join(", ") + "); " + zero.join(", ") + " serve none today (an employer can close every posting)");
  else judge("B2", true, "every employer the board-search entry names serves open roles under its own hiring system, read by GET: " + seen.join(", "));
}

// C1-C3: the company page.
{
  const pages = (strings, keys) => {
    const s = lacks(EN, strings), k = lacks(BOARD, keys);
    return { ok: !s.length && !k.length, why: [s.length ? "the US English strings lack " + s.map((x) => JSON.stringify(x)).join(", ") : "", k.length ? "the Jobs chunk " + named(E.VD52I_JOBSN) + " and its imports lack " + k.join(", ") : ""].filter(Boolean).join("; ") };
  };
  const c1 = pages(["Most roles across the {{company}} hiring system in", "on this employer\x27s whole hiring system"], ["companyProfile.facts.countriesLabelPooled", "companyProfile.pay.floorPooled"]);
  judge("C1", c1.ok, c1.ok ? "the company page says when the countries line and the Pay median count the employer\x27s whole hiring system: both English phrasings and both keys are served" : c1.why);
  const c2 = pages(["Roles on a {{system}} board", "Roles on this board"], ["companyProfile.h1SystemBoard", "companyProfile.h1ThisBoard"]);
  judge("C2", c2.ok, c2.ok ? "a board with no name is headed with its hiring system or as this board: both English headings and both keys are served" : c2.why);
  const c3 = pages(["Hiring record for one of this employer\x27s {{n}} boards: {{board}}"], ["companyProfile.employerChipOneBoard", "data-employer-chip-board"]);
  judge("C3", c3.ok, c3.ok ? "the hiring badge on a pooled page names the one board its record is for: the English words, the key and the data attribute are served" : c3.why);
}

// C4: the two Austria pages, as a crawler reads them.
{
  const de = txt("at_de.html"), en = txt("at_en.html");
  const why = [];
  for (const m of lacks(de, ["Tabellarischer Lebenslauf nach deutschem Muster", "Akademische Titel (Mag., Dipl.-Ing.) zählen mehr als in Deutschland"])) why.push("the German page lacks " + JSON.stringify(m));
  if (de.includes("Zeugnisse werden erwartet")) why.push("the German page still says Zeugnisse werden erwartet");
  for (const m of lacks(en, ["German-style tabular Lebenslauf", "Formal titles (Mag., Dipl.-Ing.) matter more than in Germany"])) why.push("the English page lacks " + JSON.stringify(m));
  judge("C4", !why.length, !why.length ? "/de/lebenslauf-standards/oesterreich and /cv-standards/austria state the same two conventions, and the German page no longer says Zeugnisse werden erwartet" : why.join("; "));
}

// L1: figures and dates in the chosen language.
{
  const METHOD = /\.toLocale(?:Date|Time)?String\(\s*(?:\)|void 0\b|\[\s*\])/g;
  const INTL = /\bIntl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat|PluralRules|ListFormat)\(\s*(?:\)(?!\s*\.resolvedOptions\b)|void 0\b|\[\s*\])/g;
  const read = { entry: ENTRY, "the board": BOARD, "the scanner": IDX, "the report": FKR, "the account page": ACC };
  const unread = Object.entries(read).filter(([, s]) => !s).map(([n]) => n);
  const bare = Object.entries(read).map(([n, s]) => [n, (s.match(METHOD) || []).length + (s.match(INTL) || []).length]).filter(([, k]) => k);
  if (unread.length) judge("L1", false, "could not read " + unread.join(", ") + ": the bundle layout moved, so figures and dates cannot be judged");
  else judge("L1", !bare.length, !bare.length ? "the entry, the board, the scanner, its report and the account page let the browser pick the language of no figure or date" : "the browser still picks the language of a figure or a date in " + bare.map(([n, k]) => n + " x" + k).join(", "));
}

// L2: the release notes follow a switch.
judge("L2", /"data-changelog-lng":/.test(CLP), /"data-changelog-lng":/.test(CLP) ? "the changelog page chunk " + E.VD52I_CLPN + " carries data-changelog-lng: it holds the notes of the language shown" : "the changelog page chunk " + named(E.VD52I_CLPN) + " carries no data-changelog-lng");

// L3: the shell skip link in the reader language.
{
  const why = lacks(ENTRY, ["siteShell.skipToMain", "body > a[href=\"#main-content\"]"]).map((m) => "the entry lacks " + JSON.stringify(m));
  if (!E.VD52I_DESKIP) why.push("no de-*.js chunk the entry names says Zum Hauptinhalt springen");
  judge("L3", !why.length, !why.length ? "the entry localises the shell skip link (siteShell.skipToMain) and the German strings " + E.VD52I_DESKIP + " say Zum Hauptinhalt springen" : why.join("; "));
}

// L4: a move to another page is said and focused.
{
  const why = lacks(ENTRY, ["rb-route-announcer", "\"aria-live\":\"polite\"", "\"#main-content\",\"main\",\"h1\""]);
  judge("L4", !why.length, !why.length ? "the entry carries the route announcer (#rb-route-announcer), a polite live region, and the places focus lands on a new page (#main-content, main, h1)" : "the entry lacks " + why.map((x) => JSON.stringify(x)).join(", "));
}

// U1: a Unicode .txt read as text at the upload boxes.
{
  const TXT = /(?:"text\/plain"|"txt"|"\.txt"|\\\.txt\$)[^]{0,160}?await [A-Za-z_$][\w$]*\.text\(\)/g;
  const dec = E.VD52I_DECN || "";
  const why = [];
  if (!dec || !DEC.includes("\"utf-16le\"") || !DEC.includes("\"utf-16be\"")) why.push("no résumé text reader that decodes utf-16le and utf-16be is imported (" + named(dec) + ")");
  const boxes = { "the scanner": IDX, "the board": txt("jobs.js"), "the success page": PS };
  for (const [n, s] of Object.entries(boxes)) {
    if (!s) why.push(n + " could not be read");
    else if (!(dec && s.includes("\"./" + dec + "\"")) && !s.includes("\"utf-16le\"")) why.push(n + " neither imports " + named(dec) + " nor decodes utf-16le");
  }
  const reads = Object.entries({ entry: ENTRY, ...boxes, board: BOARD }).filter(([, s]) => (s.match(TXT) || []).length).map(([n]) => n);
  if (reads.length) why.push("a .txt is still read with the UTF-8-only File text() in " + reads.join(", "));
  judge("U1", !why.length, !why.length ? "the scanner, the board and the success page read a .txt through " + dec + ", which decodes UTF-16 by its byte-order mark, and none reads one with File text()" : why.join("; "));
}

// U2: an unreadable .txt refused in the reader language.
{
  const KEY = "ingestParsers.refusal.txtUnreadable";
  const why = Object.entries({ "the scanner": IDX, "the success page": PS }).filter(([, s]) => !s.includes(KEY)).map(([n]) => n);
  judge("U2", !why.length, !why.length ? "the scanner and the success page refuse an unreadable .txt with " + KEY : why.join(" and ") + " carry no " + KEY + ": that refusal is not in the reader language");
}

// U3: the report names its industry with one label.
{
  const MAP = /\bsoftware:"Software\/Tech"|\bhumanResources:"Human Resources"|\bhr:"Human Resources"|\bcreative:"Creative\/Design"/;
  const TITLE = /\.replace\(\/_\/g," "\)\.replace\(\/\\b\\w\/g,/;
  const why = [];
  if (!/"data-hero-industry":/.test(FKR)) why.push("the report chunk " + named(E.VD52I_FKR) + " lacks the hero mark data-hero-industry");
  if (!/"data-industry-label":/.test(FKR)) why.push("it lacks the card mark data-industry-label");
  if (MAP.test(FKR)) why.push("it still carries the card\x27s own label map");
  if (TITLE.test(FKR)) why.push("it still title-cases a raw industry id");
  judge("U3", !why.length, !why.length ? "the report chunk " + E.VD52I_FKR + " names the industry in the hero and the card with the menu\x27s label: both marks, no own map, no title-casing" : why.join("; "));
}

// U4: progress screens that name no model, in the reader language.
{
  const MODEL = /\bgemini\b|\bgpt[-\s]?\d|\bopenai\b|\bclaude\b|\bllama\b|\bmistral\b/i;
  const objects = (s, name) => {
    const found = [];
    for (let i = s.indexOf("\"" + name + "\":{"); i >= 0; i = s.indexOf("\"" + name + "\":{", i + 1)) {
      let d = 0, j = s.indexOf("{", i);
      for (let k = j; k < s.length; k++) { if (s[k] === "{") d++; else if (s[k] === "}") { d--; if (!d) { found.push(s.slice(j, k + 1)); break; } } }
    }
    return found;
  };
  const sp = objects(EN, "scanProgress"), ag = objects(EN, "aiGenerationProgress");
  const why = [];
  if (!sp.length || !ag.length) why.push("the US English strings carry " + sp.length + " scanProgress and " + ag.length + " aiGenerationProgress objects (want both)");
  const models = [...sp, ...ag].map((o) => (o.match(MODEL) || [""])[0]).filter(Boolean);
  if (models.length) why.push("a progress string names a model (" + models.join(", ") + ")");
  if (!PS) why.push("the success page " + named(E.VD52I_PSN) + " could not be read");
  else if (!PS.includes("aiGenerationProgress.title")) why.push("the success page " + E.VD52I_PSN + " does not read its overlay title from aiGenerationProgress.title");
  const literal = PS.match(/\bgemini\b|\bgpt[-\s]?\d/i);
  if (literal) why.push("the success page " + E.VD52I_PSN + " still writes " + JSON.stringify(literal[0]));
  if (!E.VD52I_DEKI) why.push("no de-*.js chunk the entry names says Die KI arbeitet");
  judge("U4", !why.length, !why.length ? "no scanProgress or aiGenerationProgress string names a model, the success page overlay reads aiGenerationProgress.title, and the German strings " + E.VD52I_DEKI + " carry Die KI arbeitet" : why.join("; "));
}

// K1-K2: the banner files.
{
  const rows = txt("banners.txt").split("\n").filter(Boolean).map((l) => l.split("|"));
  const by = { K1: [], K2: [] }, bad = { K1: [], K2: [] };
  for (const [i, k, wh, path] of rows) {
    const hdr = txt("bn" + i + ".hdr"), body = bin("bn" + i + ".bin");
    const blocks = hdr.split(/\r?\n\r?\n/).filter((b) => /^HTTP\//.test(b.trim()));
    const last = blocks.length ? blocks[blocks.length - 1].trim() : "";
    const status = Number((/^HTTP\/[0-9.]+ ([0-9]{3})/.exec(last) || [])[1] || 0);
    const ctype = ((/^content-type:[ \t]*([^\r\n]*)/im.exec(last) || [])[1] || "").split(";")[0].trim().toLowerCase();
    const svg = path.endsWith(".svg"), want = svg ? "image/svg+xml" : "image/png";
    const [w, h] = wh.split("x").map(Number);
    let size = "";
    if (svg) { const root = (/<svg\b[^>]*>/i.exec(body.toString("utf8")) || [""])[0]; const aw = /\swidth="([0-9.]+)"/.exec(root), ah = /\sheight="([0-9.]+)"/.exec(root); size = aw && ah ? aw[1] + "x" + ah[1] : ""; }
    else if (body.length >= 24 && body.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" && body.subarray(12, 16).toString("latin1") === "IHDR") size = body.readUInt32BE(16) + "x" + body.readUInt32BE(20);
    if (status === 200 && ctype === want && size === w + "x" + h) by[k].push(path.split("/").pop() + " " + size);
    else bad[k].push(path + " answers " + (status || "nothing") + " " + (ctype || "(no type)") + (size ? " at " + size : "") + " (want 200 " + want + " at " + wh + ")");
  }
  const kit = ["728x90", "300x250", "160x600"].flatMap((s) => ["/affiliate/banner-" + s + ".png", "/affiliate/banner-" + s + ".svg"]).filter((a) => !AFF.includes(a));
  if (!AFF) bad.K1.push("the Affiliates chunk " + named(E.VD52I_AFFN) + " could not be read");
  else if (kit.length) bad.K1.push("the kit " + E.VD52I_AFFN + " does not name " + kit.join(", "));
  judge("K1", !bad.K1.length && by.K1.length === 6, !bad.K1.length && by.K1.length === 6 ? "the kit " + E.VD52I_AFFN + " names its six banners at fixed /affiliate/ addresses, and each is the size its label states: " + by.K1.join(", ") : bad.K1.join("; ") || "fewer than six banner files were read");
  judge("K2", !bad.K2.length && by.K2.length === 3, !bad.K2.length && by.K2.length === 3 ? "the three addresses the earlier kit wrote into embeds still load, each at the size its label named: " + by.K2.join(", ") : bad.K2.join("; ") || "fewer than three old addresses were read");
}

// K3: the newsletter says what the scan shows.
{
  const why = lacks(AFF, ["Shows how your file parses", "Lists the keywords your resume is missing"]).map((m) => "the kit lacks " + JSON.stringify(m));
  for (const m of ["real ATS algorithms", "cause rejection"]) if (AFF.includes(m)) why.push("the kit still promises " + JSON.stringify(m));
  judge("K3", !!AFF && !why.length, AFF && !why.length ? "the kit\x27s newsletter template in " + E.VD52I_AFFN + " says how the file parses and which keywords the resume is missing, and promises no ATS algorithms or rejection" : AFF ? why.join("; ") : "the Affiliates chunk " + named(E.VD52I_AFFN) + " could not be read");
}

// Every claim the entries make, in the order VD52I_CLAIMS lists them; B1 is
// judged above, in the shell, from job-board\x27s build.
const ids = [...new Set(txt("claims.txt").split("\n").filter(Boolean).map((l) => l.split("|")[0]))];
for (const id of ids) {
  if (id === "B1") continue;
  console.log(out[id] || "FAIL  " + id + " has no check in this section: the entry claims it, and nothing here reads it");
}
'
