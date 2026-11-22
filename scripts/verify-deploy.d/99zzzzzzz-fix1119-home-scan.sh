# shellcheck shell=bash
# ── 99zzzzzzz-fix1119-home-scan. THE BUG RECONCILE OF 2026-11-19, LANE
# HOME-SCAN (branch fix/1119-home-scan): S10-063, S10-070, S10-138, S10-153,
# S11-084 and the sweep's MATCH-08. The lane changes no function and no
# migration; the merge publishes it with the site. It adds one string shard
# (src/i18n/shards/home-scan, root homeScan), whose English strings the build
# ships as a chunk of their own beside the code that reads them.
#
# Named 99zzzzzzz-fix1119-* so it sorts after every 99zzzzzz-* file in byte
# order and under a locale that ignores the dash.
#
# THE CHUNKS, read from production, never assumed: /resume-checker preloads
# the scanner's chunk (/assets/Index-*.js), which names the tailoring modal's
# chunk (TailoredResumeModal-*.js). The modal's English strings ride in the
# modal's chunk as data (the old tailoredResumeModal namespace, whose unread
# key the site-copy sweep removes after integration), so every line below
# reads the CODE's own references, never a bare sentence the data may hold.
#
# THE STAGE: the lane's strings are read by key from both chunks: the
# scanner chunk reads homeScan.outcome.save and the modal chunk reads
# homeScan.tailoringNotes.download. Until both carry them the claims are INFO
# ("not yet published"); one without the other is a FAIL (not one commit);
# from then on every claim is PASS or FAIL.
#
# THE CLAIMS, one line each:
#   L0  both chunks can be read (FAIL when the layout moved).
#   L1  the stage.
#   S10-070  the scanner chunk reads the sign-in-first notice
#            (auth.checkout.signInFirstTitle): a Pro member whose session
#            ended is asked before the $5 checkout (0 references today).
#   S10-063  the modal's code no longer reads the "to send" button key, has
#            no placeholder name, writes no cover-letter-opening or
#            application-tips section into the file, and the scanner chunk
#            hands the modal the scan's name (originalName).
#   S10-138  the modal's code prints no "+N% better ATS keyword match" guess.
#   S10-153  the scanner chunk still records an emailed answer (the call is
#            there), and the call's own function is not the one that reads
#            the page address: loading the page records nothing. The line
#            names the call site it read.
#   S10-153a the scanner chunk checks the link's report id against the shape
#            the mail writes (letters and digits, 6 to 32) before it shows the
#            card, so a link cannot print its own sentence in the card's
#            title (src holds that pattern only in the outcome link's check,
#            so it is absent from the chunk before the lane).
#   S10-153m the mail's copy: the scan-report mails say one anonymous click
#            records the answer, and after this lane a click only picks it. A
#            send-scan-report copy change (a click and a confirm, nine
#            languages, FN_BUILD 2026-11-21) is handed to the lane that owns
#            the function and must ship with or before this publish. The line
#            reads send-scan-report's x-fn-build (an OPTIONS preflight): once
#            the lane is live, a build older than 2026-11-21 is a FAIL; a
#            newer one is INFO, as the words themselves are proved by that
#            function's own test, not from outside.
#   MATCH-08 the scanner chunk takes the board's résumé drop out on a scan
#            (it names rb_board_resume, which it never did before).
#   X1  INFO: what the browser does (one board search per query, coverage
#       read from the tailored text, the PDF's contents, a confirm press
#       before the answer is stored) is proved in the suite.
#
# READ-ONLY. GETs of /resume-checker and two chunks, and one OPTIONS
# preflight of send-scan-report. Nothing is posted, no scan is run, no mail
# is sent and no answer is recorded.
echo "== 99zzzzzzz-fix1119-home-scan. bug reconcile, home-scan lane: tailoring notes, the Pro ask, keyword coverage, the outcome link, one board search, the newest scan =="

rm -f /tmp/vd_fhs_page.html /tmp/vd_fhs_idx.js /tmp/vd_fhs_trm.js
curl -s -m 30 "$SITE/resume-checker" > /tmp/vd_fhs_page.html
VDFHS_IDX=$(grep -ao '/assets/Index-[A-Za-z0-9_-]*\.js' /tmp/vd_fhs_page.html | head -1)
[ -n "$VDFHS_IDX" ] && curl -s -m 60 "$SITE$VDFHS_IDX" > /tmp/vd_fhs_idx.js
VDFHS_TRM=$( { [ -f /tmp/vd_fhs_idx.js ] && grep -ao 'TailoredResumeModal-[A-Za-z0-9_-]*\.js' /tmp/vd_fhs_idx.js; } | head -1)
[ -n "$VDFHS_TRM" ] && curl -s -m 60 "$SITE/assets/$VDFHS_TRM" > /tmp/vd_fhs_trm.js
VDFHS_SSR=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/send-scan-report" -H "apikey: $K" -H "Authorization: Bearer $K" | tr -d '\r' | grep -i '^x-fn-build:' | sed -E 's/^[^:]+: *//')

VDFHS_N_IDX="$VDFHS_IDX" VDFHS_N_TRM="$VDFHS_TRM" VDFHS_N_SSR="$VDFHS_SSR" node -e '
const fs = require("fs");
const rd = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const E = process.env;
const idx = rd("/tmp/vd_fhs_idx.js");
const trm = rd("/tmp/vd_fhs_trm.js");
const say = (v, id, m) => console.log(v + "  " + id + " " + m);
const q = (s) => "\x27" + s + "\x27";

// L0: the layout.
const unread = [];
if (!E.VDFHS_N_IDX) unread.push("the scanner chunk (/resume-checker preloads no /assets/Index-*.js)");
else if (!idx) unread.push("the scanner chunk " + E.VDFHS_N_IDX + " (no body)");
else if (!E.VDFHS_N_TRM) unread.push("the modal chunk (the scanner chunk names no TailoredResumeModal-*.js)");
else if (!trm) unread.push("the modal chunk " + E.VDFHS_N_TRM + " (no body)");
else {
  if (!/"tailoredResumeModal\.title"/.test(trm)) unread.push("the modal (its chunk reads no tailoredResumeModal.title)");
  if (!/"scanOutcome\.recorded"/.test(idx)) unread.push("the outcome answer (the scanner chunk reads no scanOutcome.recorded)");
}
if (unread.length) {
  say("FAIL", "L0", "could not read " + unread.join(" or ") + ": the bundle layout moved, so the lane cannot be judged");
  process.exit(0);
}
say("INFO", "L0", "chunks read: " + E.VDFHS_N_IDX.replace("/assets/", "") + ", " + E.VDFHS_N_TRM);

// L1: the stage.
const idxMark = /"homeScan\.outcome\.save"/.test(idx);
const trmMark = /"homeScan\.tailoringNotes\.download"/.test(trm);
const live = idxMark && trmMark;
if (live) say("PASS", "L1", "both chunks read the lane\x27s strings (the outcome card\x27s save and the notes\x27 download): the merge carrying the lane published");
else if (idxMark || trmMark) say("FAIL", "L1", "only the " + (idxMark ? "scanner" : "modal") + " chunk reads the lane\x27s strings: the two chunks were not built from one commit of the lane");
else say("INFO", "L1", "neither chunk reads the lane\x27s strings: the merge carrying the lane has not published, so every claim below is INFO");

const judge = (id, ok, what, why) => {
  if (live) say(ok ? "PASS" : "FAIL", id, what + (ok ? "" : " — but " + why));
  else say("INFO", id, what + ": not yet published (today: " + (ok ? "already holds" : why) + ")");
};

// S10-070.
const asks = (idx.match(/"auth\.checkout\.signInFirstTitle"/g) || []).length;
judge("S10-070", asks > 0,
  "the $5 press on the scanner asks a Pro member whose session ended to sign in first (the scanner chunk reads auth.checkout.signInFirstTitle " + asks + " time(s))",
  "the scanner chunk never reads the sign-in-first notice, so a signed-out member is charged for what Pro includes");

// S10-063.
const sendKey = /"tailoredResumeModal\.downloadPdfToSend"/.test(trm);
const placeholder = /"Your Name"/.test(trm);
const letter = /[\w$]\("Cover Letter Opening"\)/.test(trm);
const tips = /[\w$]\("Application Tips"\)/.test(trm);
const named = /originalName:/.test(idx);
const sendData = /"Download PDF to Send"/.test(trm);
const why63 = [sendKey ? "the modal still reads the " + q("Download PDF to Send") + " button key (tailoredResumeModal.downloadPdfToSend)" : "",
  placeholder ? "the modal still holds the placeholder name" : "",
  letter ? "the file still gets a " + q("Cover Letter Opening") + " section" : "",
  tips ? "the file still gets an " + q("Application Tips") + " section" : "",
  named ? "" : "the scanner chunk hands the modal no originalName, so the file carries no scan name"].filter(Boolean).join("; ");
judge("S10-063", !why63,
  "the tailoring file is notes headed with the scan\x27s name: no " + q("to send") + " button, no placeholder name, no cover-letter opening and no application tips in it",
  why63);
if (sendData && !sendKey) say("INFO", "S10-063", "the English sentence " + q("Download PDF to Send") + " is still in the modal chunk\x27s string data, under a key the modal no longer reads; the site-copy sweep removes the key after integration");

// S10-138.
const guess = /better ATS keyword match/.test(trm);
judge("S10-138", !guess,
  "the tailoring card prints no guessed " + q("+N% better ATS keyword match"),
  "the modal still prints the writer\x27s unmeasured match gain");

// S10-153.
const CALL = "\"record_scan_outcome\"";
const at = idx.indexOf(CALL);
if (at < 0) {
  judge("S10-153", false, "an emailed answer is recorded on a confirm press, never on page load", "the scanner chunk no longer calls record_scan_outcome at all, so a person\x27s emailed answer cannot be recorded");
} else {
  const before = idx.slice(Math.max(0, at - 1500), at);
  const starts = [before.lastIndexOf("=>{"), before.lastIndexOf("function(")];
  const start = Math.max(...starts);
  const body = start < 0 ? before : before.slice(start);
  const onLoad = /location\.search/.test(body);
  const site = before.slice(-90).replace(/\s+/g, " ");
  judge("S10-153", !onLoad,
    "an emailed answer is stored on the person\x27s confirm press, not when the page loads: the call\x27s own function reads no page address (call site ...." + site + CALL + ")",
    "the call to record_scan_outcome sits in the function that reads window.location.search, so loading the page records the link\x27s answer and a mail scanner writes it");
}

// S10-153a: the card shows only a report id the mail could have written.
const shape = idx.includes("/^[A-Za-z0-9]{6,32}$/");
judge("S10-153a", shape,
  "the outcome card shows only a report id the mail could have written (letters and digits, 6 to 32): a link carrying any other text shows no card",
  "the scanner chunk holds no check of the link\x27s report id against the mail\x27s shape, so any text in the link is taken as a report id, and the card prints it in its title under our name");

// S10-153m: the mails stop promising that one click records the answer.
const ssr = E.VDFHS_N_SSR || "";
const ssrDay = (/\.(\d{4}-\d{2}-\d{2})\./.exec(ssr) || [])[1] || "";
const ONE_CLICK = "the scan-report mails (outcomeAsk, day6Outcome, day14Intro, nine languages) still promise one anonymous click, and a click now only picks the answer: a person who clicks and closes the tab records nothing";
if (!ssrDay) {
  if (live) say("FAIL", "S10-153m", "send-scan-report\x27s preflight carries no readable x-fn-build (" + (ssr || "none") + "), so whether its mails still promise one anonymous click cannot be read");
  else say("INFO", "S10-153m", "send-scan-report\x27s preflight carries no readable x-fn-build (" + (ssr || "none") + "): not yet published");
} else if (ssrDay < "2026-11-21") {
  if (live) say("FAIL", "S10-153m", "send-scan-report is still build " + ssr + ": " + ONE_CLICK + " (the hand-in\x27s copy change had to ship with or before this publish)");
  else say("INFO", "S10-153m", "not yet published (today send-scan-report is build " + ssr + ", whose mails promise one anonymous click; its copy change, a click and a confirm, ships with or before this lane)");
} else {
  say("INFO", "S10-153m", "send-scan-report is build " + ssr + " (2026-11-21 or later), so the copy change asking for a click and a confirm may have shipped; its words are proved by that function\x27s own test, not by this line");
}

// MATCH-08.
const drop = /rb_board_resume/.test(idx);
judge("MATCH-08", drop,
  "a fresh scan on the scanner takes the board\x27s résumé drop out of the tab, so the board ranks by the newest scan (the scanner chunk names rb_board_resume)",
  "the scanner chunk never names rb_board_resume, so an older résumé dropped on the board keeps outranking the newest scan");

say("INFO", "X1", "proved in the suite, not from outside: one board search per query (a-toast-on-the-homepage-does-not-search-the-board-again), coverage read from the tailored text (a-keyword-is-marked-covered-only-when-the-tailored-text-holds-it), the file\x27s contents (the-tailoring-notes-are-not-offered-as-a-resume-to-send), the confirm press and no card for a report id the mail never writes (a-mail-scanner-opening-the-outcome-link-records-nothing), the ask (a-pro-member-who-is-signed-out-is-asked-to-sign-in-before-the-five-dollar-checkout) and the drop (the-newest-scan-is-the-resume-the-board-ranks)");
'
