# shellcheck shell=bash
# ── 99zzzz-audit-rest-fixer. THE AUDIT-REST FIXER'S ANSWERS (branch
# fix/audit-rest, 2026-11-03): what the review of the round's four builders
# changed that the publishable key can see from outside. Migration
# 20261103195000; the functions it touched are already judged at 2026-11-03.1
# by the money, pages, abuse and account sections.
#
# Named 99zzzz-audit-rest-fixer so it sorts after the round's other four
# sections, in byte order and under a collating locale that ignores the dash.
#
# THE CLAIMS, one line each:
#   F1  the published product page tells a Stripe that did not answer apart
#       from a link that names no purchase, and sends a Pro grant made before
#       the update to sign in (its chunk carries the busy key and the
#       sign-in-again control);
#   F2  the published account page spends at most a few automatic fit checks
#       an hour (its chunks carry the hour's spend key);
#   F3  the published consent page lists the scopes a request asks for and
#       promises no "cannot" (its chunk carries the scopes line, and not the
#       old promise);
#   F4  the published privacy page names no font host (its chunk carries the
#       self-served fonts line, and not the Google Fonts processor);
#   F5  the published Freelance Boost page says a checkout whose payment has
#       not completed is not "no purchase";
#   F6  the published owner's dashboard says new and returning are
#       approximate when a read was cut short;
#   F7  company_claims.locale exists (20261103195000): an anon GET of the
#       column answers rows or [] (PASS), 42703 (FAIL: not applied), or a
#       refusal (INFO: the key may not read the table, so not judged);
#   S   Supabase Auth's /auth/v1/user must refuse a connector token. GoTrue
#       checks a token's signature, sub and session, never its audience, role
#       or client_id (its source, read 2026-11-02), so S9-001 is OPEN on that
#       path. With RB_CONNECTOR_TOKEN set (a token minted for a test client,
#       an owner step) one GET probes it: 401/403 PASS, 200 FAIL. Without it:
#       INFO while the OAuth server is off, FAIL once its discovery answers
#       200, since nothing has shown GoTrue refusing such a token.
# Not provable from outside, so proved in the suite: a decline recorded and
# mailed once whichever of its two events arrives, a Pro member's analysis
# mail in the page's language, the mail's grade on the page's bands, the
# claim and key mails in the asker's language, the reconcile mail judged by
# the order row, the unzip and body caps, the toasts on a failed plan read.
#
# READ-ONLY. GETs of the site's entry script and of route chunks and their
# direct imports, one GET of a column through PostgREST, one GET of the auth
# server's discovery document, and (only with RB_CONNECTOR_TOKEN) one GET of
# /auth/v1/user. Nothing is posted, the account endpoint is never sent a PUT,
# and no key or token is printed.
echo "== 99zzzz. audit-rest fixer: refusals said as they are, the gap report's hour, the consent scopes, the fonts line, the claim locale, the account endpoint =="

VDFX_MAIN=$(curl -s -m 30 "$SITE/" | grep -o '/assets/index-[^"]*\.js' | head -1)
VDFX_MAINJS=""
[ -n "$VDFX_MAIN" ] && VDFX_MAINJS=$(curl -s -m 30 "$SITE$VDFX_MAIN")
vdfx_chunk() { # $1 route chunk name -> its file name, from the entry
  printf '%s' "$VDFX_MAINJS" | grep -o "\"\./$1-[A-Za-z0-9_-]*\.js\"" | head -1 | tr -d '"' | sed 's|^\./||'
}
vdfx_text() { # $1 chunk file -> the chunk and every chunk it imports directly
  local js dep
  js=$(curl -s -m 30 "$SITE/assets/$1")
  printf '%s\n' "$js"
  for dep in $(printf '%s' "$js" | grep -o '"\./[A-Za-z0-9_.-]*\.js"' | tr -d '"' | sed 's|^\./||' | sort -u | head -40); do
    curl -s -m 30 "$SITE/assets/$dep"
    printf '\n'
  done
}
# vdfx_judge NAME CHUNK WANT [REFUSE] PASS-TEXT FAIL-TEXT
vdfx_judge() {
  local name="$1" chunk="$2" want="$3" refuse="$4" ok="$5" bad="$6" file text
  file=$(vdfx_chunk "$chunk")
  if [ -z "$file" ]; then echo "FAIL  $name: the served entry (${VDFX_MAIN:-none found}) names no $chunk chunk: the frontend is not serving, or the bundle layout moved"; return; fi
  text=$(vdfx_text "$file")
  if printf '%s' "$text" | grep -qF -- "$want" && { [ -z "$refuse" ] || ! printf '%s' "$text" | grep -qF -- "$refuse"; }; then echo "PASS  $name ($file): $ok"
  else echo "FAIL  $name ($file): $bad"; fi
}

vdfx_judge F1 ProductSuccess 'productSuccess.refusal.busy' '' \
  "a Stripe that did not answer is offered Try again, apart from a link that names no purchase" \
  "carries no busy refusal: the frontend publish with the fixer's S13-048 answer has not happened"
vdfx_judge F1b ProductSuccess 'sign-in-again' '' \
  "a Pro grant made before the update is sent to sign in, never told its plan lapsed" \
  "carries no sign-in-again control: the frontend publish with the fixer's legacy-grant answer has not happened"
vdfx_judge F2 Account 'rb_gap_auto_spend' '' \
  "the gap report spends at most a few automatic fit checks an hour across loads and tabs" \
  "carries no hourly spend record: the page still re-measures on every open"
vdfx_judge F3 OAuthConsent 'consent-scopes' 'It cannot buy anything' \
  "the consent page lists the request's scopes and promises no 'cannot'" \
  "lists no scopes, or still promises the connection cannot buy or change the plan"
vdfx_judge F4 Privacy 'data-fonts' "Google Fonts (your browser" \
  "the privacy page says the fonts are served from the site and names no font host" \
  "still names Google Fonts as a processor, or lacks the self-served fonts line"
vdfx_judge F5 FreelanceBoost 'completed Freelance Boost payment' '' \
  "a checkout whose payment has not completed is not told the link holds no purchase" \
  "still tells every refused link it holds no paid purchase"
vdfx_judge F6 AnalyticsDashboard 'approximate on every day' '' \
  "the owner's dashboard says new and returning are approximate when a read was cut short" \
  "still presents the read days' new and returning as complete"

# F7: the claim's language column, by a GET of the column alone.
rm -f /tmp/vd_99zzzz_fixer_claims.json
VDFX_CL=$(curl -s -m 30 -o /tmp/vd_99zzzz_fixer_claims.json -w '%{http_code}' "$B/rest/v1/company_claims?select=locale&limit=1" -H "apikey: $K" -H "Authorization: Bearer $K")
VDFX_CL_CODE=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync("/tmp/vd_99zzzz_fixer_claims.json","utf8"));process.stdout.write(Array.isArray(j)?"ROWS":String(j.code??"NOCODE"))}catch{process.stdout.write("NONJSON")}')
rm -f /tmp/vd_99zzzz_fixer_claims.json
case "$VDFX_CL_CODE" in
  ROWS) echo "PASS  company_claims.locale exists (20261103195000 applied): the 'verified' notice is written in the claimant's language";;
  42703) echo "FAIL  company_claims.locale does not exist (42703): migration 20261103195000 has not run, so the 'verified' notice stays English";;
  *) echo "INFO  company_claims.locale not judged: the publishable key's GET answered $VDFX_CL ${VDFX_CL_CODE}";;
esac

# S: Supabase Auth's own account endpoint.
rm -f /tmp/vd_99zzzz_fixer_oas.json
VDFX_OAS=$(curl -s -m 30 -o /tmp/vd_99zzzz_fixer_oas.json -w '%{http_code}' "$B/auth/v1/.well-known/oauth-authorization-server" -H "apikey: $K")
rm -f /tmp/vd_99zzzz_fixer_oas.json
if [ -n "${RB_CONNECTOR_TOKEN:-}" ]; then
  VDFX_USER=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$B/auth/v1/user" -H "apikey: $K" -H "Authorization: Bearer $RB_CONNECTOR_TOKEN")
  case "$VDFX_USER" in
    401|403) echo "PASS  /auth/v1/user refuses a connector token ($VDFX_USER): it cannot read or change the account there";;
    200) echo "FAIL  /auth/v1/user ANSWERS a connector token (200): whoever holds one can change the account's email or password there (a PUT, never sent by this probe). S9-001 is open: keep the OAuth server off";;
    *) echo "FAIL  /auth/v1/user answered ${VDFX_USER:-nothing} for the connector token: neither a refusal nor an answer, so S9-001 is not shown closed";;
  esac
else
  case "$VDFX_OAS" in
    200) echo "FAIL  the OAuth server's discovery answers 200 and /auth/v1/user is not probed: GoTrue's source accepts a connector token there (password and email changes), so S9-001 is open. Probe with RB_CONNECTOR_TOKEN, or switch the OAuth server off";;
    404) echo "INFO  /auth/v1/user not probed (set RB_CONNECTOR_TOKEN to a test client's token): GoTrue's source accepts any token it signed there, so S9-001 is open on that path, latent while the OAuth server is off";;
    *) echo "INFO  /auth/v1/user not probed, and the OAuth server's discovery answered ${VDFX_OAS:-nothing}: not judged this run";;
  esac
fi
