# shellcheck shell=bash
# ── 99zzzzzzz-bugs-auth-signin. THE 2026-11-08 BUG ROUND, PART A, LANE
# AUTH-SIGNIN (branch bugs/a-auth-signin): S14X-087, S14X-097, S14X-098,
# S14X-099, S14X-206, S14X-207, S14X-208, S14X-228 and S14X-236. No
# migration. Two functions carry a new build through _shared/mailbox-guard.ts
# (auth-signed-in, get-account-data); everything else ships in the frontend
# publish that the merge itself makes.
#
# Named 99zzzzzzz-bugs so it sorts after 99zzzzzzz-board-102-*.sh.
#
# THE CLAIMS, one line each. None FAILs on today's production, before the
# merge and the paste: each frontend line reads INFO until any of this lane's
# markers is live (the sign-out question, the "may still be signed in" notice,
# the verified-link retry, the masked remembered-address refusal or the
# revoked-keys notice: one publish carries them all), and is judged from then
# on, so a later publish that drops one is a FAIL.
#   A1  S14X-087: the account page's security card checks a mailed code with
#       the auth server (verifyOtp, type recovery) and sends no nonce with the
#       password change, and asks for no reauthentication code.
#   A2  S14X-236: the address change asks for its mails with a redirect (where
#       the auth hook reads the language), and the code mail is a reset mail
#       whose redirect is the reset step.
#   A3  S14X-097: signing out from the account page asks before it deletes a
#       builder résumé or Freelance Boost details kept only in this browser.
#   A4  S14X-098: a sign-out the server did not hear still signs this device
#       out and says other devices may still be signed in (the old shape threw
#       the result away inside try/finally).
#   A5  S14X-099: adopting a link's session reads the session this browser
#       holds before it hands the new one over.
#   A6  S14X-206: a spent reset link no longer says no password was set, and
#       says what to do if a code already set one.
#   A7  S14X-207: a refused password for the remembered address is answered
#       masked and returns before the create-account offer.
#   A8  S14X-208: a verified link whose hand-over blipped says so and offers
#       Try again.
#   A9  S14X-228: the frontend names keys the guard turned off.
#   F   S14X-228: auth-signed-in and get-account-data serve this round's build
#       (2026-11-12.1) or a later one. Both older is INFO (not pasted yet); one
#       new and one older is a partial paste, a FAIL; no build header is a
#       FAIL.
#
# NOT PROVABLE FROM OUTSIDE, so proved in the suite: the guard turning off the
# keys minted before the proof (a-key-minted-before-the-owner-proved-the-
# address-stops-with-the-old-password, pglite), what each page does on each
# answer (the seven a-*/signing-out-*/the-password-change-* tests of this
# lane).
#
# READ-ONLY. GETs of the homepage, its entry script, the Account and Auth
# chunks and the auth strings; two OPTIONS preflights. Nothing is posted and
# no key is sent.
echo "== 99zzzzzzz. bug round, auth-signin lane: the password code, sign-out, a link for another account, reset and sign-in wording, keys made before the proof =="

rm -f /tmp/vd_bas_home.html /tmp/vd_bas_entry.js /tmp/vd_bas_account.js /tmp/vd_bas_auth.js /tmp/vd_bas_authen.js /tmp/vd_bas_en_try.js

curl -s -m 30 "$SITE/" > /tmp/vd_bas_home.html
VDBAS_MAIN=$(grep -o '/assets/index-[A-Za-z0-9_-]*\.js' /tmp/vd_bas_home.html | head -1)
[ -n "$VDBAS_MAIN" ] && curl -s -m 60 "$SITE$VDBAS_MAIN" > /tmp/vd_bas_entry.js
VDBAS_ACCN=$( { [ -f /tmp/vd_bas_entry.js ] && grep -oE 'assets/Account-[A-Za-z0-9_-]+\.js' /tmp/vd_bas_entry.js; } | head -1 | sed 's#^assets/##')
VDBAS_AUTHN=$( { [ -f /tmp/vd_bas_entry.js ] && grep -oE 'assets/Auth-[A-Za-z0-9_-]+\.js' /tmp/vd_bas_entry.js; } | head -1 | sed 's#^assets/##')
[ -n "$VDBAS_ACCN" ] && curl -s -m 30 "$SITE/assets/$VDBAS_ACCN" > /tmp/vd_bas_account.js
[ -n "$VDBAS_AUTHN" ] && curl -s -m 30 "$SITE/assets/$VDBAS_AUTHN" > /tmp/vd_bas_auth.js
# The auth strings: a loader set names en, then en-GB. The entry carries more
# than one such set; the auth one is the chunk holding the sign-in refusal.
VDBAS_ENN=""
for VDBAS_C in $( { [ -f /tmp/vd_bas_entry.js ] && grep -oE 'en:\(\)=>[A-Za-z0-9_$]+\(\(\)=>import\("\./en-[A-Za-z0-9_-]+\.js"\),\[\]\),"en-GB"' /tmp/vd_bas_entry.js; } | grep -oE 'en-[A-Za-z0-9_-]+\.js' | head -3); do
  rm -f /tmp/vd_bas_en_try.js
  curl -s -m 30 "$SITE/assets/$VDBAS_C" > /tmp/vd_bas_en_try.js
  if grep -qF 'sign you in with that email and password' /tmp/vd_bas_en_try.js 2>/dev/null; then
    VDBAS_ENN=$VDBAS_C; mv /tmp/vd_bas_en_try.js /tmp/vd_bas_authen.js; break
  fi
done

VDBAS_READ=yes
if [ -z "$VDBAS_MAIN" ]; then VDBAS_READ=no; echo "FAIL  A0 the homepage names no /assets/index-*.js entry: the published app cannot be read"
elif ! [ -s /tmp/vd_bas_account.js ] || ! [ -s /tmp/vd_bas_auth.js ]; then
  VDBAS_READ=no; echo "FAIL  A0 the entry $VDBAS_MAIN names no readable Account and Auth chunks (${VDBAS_ACCN:-no Account chunk}, ${VDBAS_AUTHN:-no Auth chunk}): the bundle layout moved, so this lane's pages cannot be judged"
fi

if [ "$VDBAS_READ" = yes ]; then
  VDBAS_ACC=/tmp/vd_bas_account.js; VDBAS_AUTH=/tmp/vd_bas_auth.js; VDBAS_ENTRY=/tmp/vd_bas_entry.js
  # Each test answers yes or no from the published code.
  vdbas() { if grep -qE "$1" "$2" 2>/dev/null; then echo yes; else echo no; fi; }
  vdbasF() { if grep -qF "$1" "$2" 2>/dev/null; then echo yes; else echo no; fi; }
  VDBAS_NONCE=$(vdbas 'updateUser\([^;]{0,120}nonce:' "$VDBAS_ACC")
  VDBAS_REAUTH=$(vdbasF '.auth.reauthenticate(' "$VDBAS_ACC")
  VDBAS_RECOVERY=$(vdbas 'verifyOtp\(\{[^}]{0,120}type:"recovery"' "$VDBAS_ACC")
  VDBAS_BARE=$(vdbas 'updateUser\(\{email:[A-Za-z0-9_$]+\}\)' "$VDBAS_ACC")
  VDBAS_EMAILREDIR=$(vdbas 'updateUser\(\{email:[A-Za-z0-9_$]+\},\{emailRedirectTo:' "$VDBAS_ACC")
  VDBAS_RESETREDIR=$(vdbas 'resetPasswordForEmail\([A-Za-z0-9_$]+,\{redirectTo:[^;]{0,120}mode=reset' "$VDBAS_ACC")
  VDBAS_ASKS=$(vdbasF 'saved only in this browser' "$VDBAS_ACC")
  VDBAS_UNREAD=$(vdbas 'try\{await [A-Za-z0-9_$]+\.auth\.signOut\(\{scope:[A-Za-z0-9_$]+\}\)\}finally' "$VDBAS_ENTRY")
  VDBAS_TOLD=$(vdbasF 'may still be signed in' "$VDBAS_ENTRY")
  VDBAS_A5=$(node -e 'let s="";try{s=require("fs").readFileSync(process.argv[1],"utf8")}catch{}let f=0,c=0;for(const m of s.matchAll(/\.auth\.setSession\(\{access_token:[\w$]+\.session\.access_token/g)){const i=s.lastIndexOf("useCallback(async(",m.index);if(i<0||m.index-i>4000)continue;f=1;const g=s.slice(i,m.index);if(g.includes("getSession")&&g.includes(".id"))c=1}console.log(f?(c?"compares":"blind"):"none")' "$VDBAS_ENTRY" 2>/dev/null)
  VDBAS_SPENT_OLD=no
  grep -qF 'expired or was already used, so no password was set' "$VDBAS_AUTH" && VDBAS_SPENT_OLD=yes
  [ -n "$VDBAS_ENN" ] && grep -qF 'expired or was already used, so no password was set' /tmp/vd_bas_authen.js && VDBAS_SPENT_OLD=yes
  VDBAS_SPENT_NEW=no
  { grep -qF 'If you already chose a new password' "$VDBAS_AUTH" || { [ -n "$VDBAS_ENN" ] && grep -qF 'If you already chose a new password' /tmp/vd_bas_authen.js; }; } && VDBAS_SPENT_NEW=yes
  VDBAS_REMEMBERED=$(vdbasF '"auth.email.rememberedMismatch"' "$VDBAS_AUTH")
  VDBAS_REMRETURN=$(vdbas '"auth\.email\.rememberedMismatch","[^"]*",\{email:[A-Za-z0-9_$]+\}\)\);return\}' "$VDBAS_AUTH")
  VDBAS_BLIP=no
  { grep -qF "couldn't finish signing in" "$VDBAS_AUTH" || grep -qF "couldn't finish signing in" "$VDBAS_ENTRY"; } && VDBAS_BLIP=yes
  VDBAS_KEYS=$(vdbasF '"auth.guard.keysRevoked"' "$VDBAS_ENTRY")

  VDBAS_LIVE=no
  for VDBAS_M in "$VDBAS_ASKS" "$VDBAS_TOLD" "$VDBAS_BLIP" "$VDBAS_REMEMBERED" "$VDBAS_KEYS"; do [ "$VDBAS_M" = yes ] && VDBAS_LIVE=yes; done
  VDBAS_WHERE="entry $VDBAS_MAIN, $VDBAS_ACCN, $VDBAS_AUTHN, auth strings ${VDBAS_ENN:-not found}"

  if [ "$VDBAS_LIVE" = no ]; then
    echo "INFO  A0 none of this lane's markers is in the published app ($VDBAS_WHERE): the merge carrying the auth-signin lane has not published yet, so A1-A9 are not judged"
    echo "INFO  A1 S14X-087 today the security card $([ "$VDBAS_NONCE" = yes ] && echo 'sends the typed code as an unchecked nonce' || echo 'sends no nonce')$([ "$VDBAS_REAUTH" = yes ] && echo ', after a reauthentication mail') (not published yet)"
    echo "INFO  A2 S14X-236 today the address change $([ "$VDBAS_BARE" = yes ] && echo 'asks for its mails with no redirect' || echo 'carries a redirect') (not published yet)"
    echo "INFO  A3 S14X-097 today the account page's sign-out $([ "$VDBAS_ASKS" = yes ] && echo 'asks first' || echo 'deletes a builder résumé kept only in this browser without a word') (not published yet)"
    echo "INFO  A4 S14X-098 today a failed sign-out $([ "$VDBAS_UNREAD" = yes ] && echo 'is thrown away unread' || echo 'is read') (not published yet)"
    echo "INFO  A5 S14X-099 today adoptSession $([ "$VDBAS_A5" = compares ] && echo 'reads the current account first' || echo 'hands another account its session with nothing cleared') (not published yet)"
    echo "INFO  A6 S14X-206 today a spent reset link $([ "$VDBAS_SPENT_OLD" = yes ] && echo 'says no password was set' || echo 'no longer says no password was set') (not published yet)"
    echo "INFO  A7 S14X-207 today a refused remembered address $([ "$VDBAS_REMRETURN" = yes ] && echo 'is answered masked' || echo 'is offered an account under its full address') (not published yet)"
    echo "INFO  A8 S14X-208 today a verified link whose hand-over blipped $([ "$VDBAS_BLIP" = yes ] && echo 'offers Try again' || echo 'is called expired') (not published yet)"
    echo "INFO  A9 S14X-228 the revoked-keys notice is not published yet"
  else
    echo "INFO  A0 this lane's frontend is published ($VDBAS_WHERE)"
    if [ "$VDBAS_NONCE" = no ] && [ "$VDBAS_REAUTH" = no ] && [ "$VDBAS_RECOVERY" = yes ]; then
      echo "PASS  A1 S14X-087 the security card ($VDBAS_ACCN) checks the mailed code with verifyOtp type recovery, sends no nonce and asks for no reauthentication code"
    else
      echo "FAIL  A1 S14X-087 the security card ($VDBAS_ACCN): nonce sent with the password change $VDBAS_NONCE, reauthenticate called $VDBAS_REAUTH, the code checked by verifyOtp type recovery $VDBAS_RECOVERY: a typed code the auth server never checked can change a password"
    fi
    if [ "$VDBAS_BARE" = no ] && [ "$VDBAS_EMAILREDIR" = yes ] && [ "$VDBAS_RESETREDIR" = yes ] && [ "$VDBAS_REAUTH" = no ]; then
      echo "PASS  A2 S14X-236 the address change asks for its mails with an emailRedirectTo, and the code mail is a reset mail whose redirect is the reset step"
    else
      echo "FAIL  A2 S14X-236 the security mails ($VDBAS_ACCN): address change with no redirect $VDBAS_BARE, with one $VDBAS_EMAILREDIR; reset mail redirected to the reset step $VDBAS_RESETREDIR; reauthenticate called $VDBAS_REAUTH: a mail with no redirect carries no language"
    fi
    if [ "$VDBAS_ASKS" = yes ]; then echo "PASS  A3 S14X-097 the account page asks before signing out deletes a résumé saved only in this browser"
    else echo "FAIL  A3 S14X-097 $VDBAS_ACCN no longer carries the 'saved only in this browser' question though this lane's frontend is live: signing out deletes a builder draft without a word"; fi
    if [ "$VDBAS_UNREAD" = no ] && [ "$VDBAS_TOLD" = yes ]; then echo "PASS  A4 S14X-098 a sign-out the server did not hear signs this device out and says other devices may still be signed in"
    else echo "FAIL  A4 S14X-098 the entry: sign-out result thrown away in try/finally $VDBAS_UNREAD, the 'may still be signed in' notice present $VDBAS_TOLD"; fi
    case "$VDBAS_A5" in
      compares) echo "PASS  A5 S14X-099 adoptSession reads the session this browser holds before it hands over another" ;;
      blind) echo "FAIL  A5 S14X-099 adoptSession hands a link's session over with no look at the account this browser holds: the first account's data is used as the second's" ;;
      *) echo "FAIL  A5 S14X-099 no adoptSession (a useCallback that calls setSession with a probed session) found in $VDBAS_MAIN: the bundle layout moved, so it cannot be judged" ;;
    esac
    if [ -z "$VDBAS_ENN" ]; then echo "FAIL  A6 S14X-206 the entry names no auth strings chunk holding the sign-in refusal: the reset wording cannot be judged"
    elif [ "$VDBAS_SPENT_OLD" = no ] && [ "$VDBAS_SPENT_NEW" = yes ]; then echo "PASS  A6 S14X-206 a spent reset link no longer says no password was set, and says what to do if a code already set one ($VDBAS_ENN)"
    else echo "FAIL  A6 S14X-206 the reset wording ($VDBAS_AUTHN, $VDBAS_ENN): 'so no password was set' present $VDBAS_SPENT_OLD, the new sentence present $VDBAS_SPENT_NEW"; fi
    if [ "$VDBAS_REMRETURN" = yes ]; then echo "PASS  A7 S14X-207 a refused password for the remembered address is answered masked and returns before the create-account offer"
    elif [ "$VDBAS_REMEMBERED" = yes ]; then echo "FAIL  A7 S14X-207 $VDBAS_AUTHN carries the masked refusal but does not return before the offer: an account is offered for the remembered address in full"
    else echo "FAIL  A7 S14X-207 $VDBAS_AUTHN has no masked refusal for the remembered address: a wrong password shows it in full and offers an account for it"; fi
    if [ "$VDBAS_BLIP" = yes ]; then echo "PASS  A8 S14X-208 a verified link whose hand-over blipped says \"couldn't finish signing in\" and offers Try again"
    else echo "FAIL  A8 S14X-208 neither $VDBAS_AUTHN nor the entry says \"couldn't finish signing in\": a blip after a verified link reads as an expired link"; fi
    if [ "$VDBAS_KEYS" = yes ]; then echo "PASS  A9 S14X-228 the entry names the keys the guard turned off (auth.guard.keysRevoked)"
    else echo "FAIL  A9 S14X-228 the entry carries no auth.guard.keysRevoked notice though this lane's frontend is live: a member is not told which keys stopped"; fi
  fi
fi

# F. The guard's build, in both functions that import it.
VDBAS_NEW=""; VDBAS_OLD=""; VDBAS_NONE=""
for VDBAS_F in auth-signed-in get-account-data; do
  VDBAS_H=$(curl -s -m 30 -D - -o /dev/null -X OPTIONS "$B/functions/v1/$VDBAS_F" -H "Origin: $SITE" -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: authorization, apikey, content-type, x-client-info" | tr -d '\r' | grep -i '^x-fn-build:' | head -1 | sed -E 's/^[^:]+: *//; s/[[:space:]]+//g')
  if [ -z "$VDBAS_H" ]; then VDBAS_NONE="$VDBAS_NONE $VDBAS_F"
  elif build_ge "$VDBAS_F" "$VDBAS_H" 2026-11-12 1; then VDBAS_NEW="$VDBAS_NEW $VDBAS_F=$VDBAS_H"
  else VDBAS_OLD="$VDBAS_OLD $VDBAS_F=$VDBAS_H"; fi
done
for VDBAS_F in $VDBAS_NONE; do echo "FAIL  F S14X-228 $VDBAS_F preflight carries no x-fn-build (want $VDBAS_F.2026-11-12.1 or later)"; done
if [ -n "$VDBAS_NEW" ] && [ -z "$VDBAS_OLD" ] && [ -z "$VDBAS_NONE" ]; then
  echo "PASS  F S14X-228 both functions importing the mailbox guard serve this round's build or later:$VDBAS_NEW"
elif [ -n "$VDBAS_NEW" ]; then
  for VDBAS_P in $VDBAS_OLD; do echo "FAIL  F S14X-228 ${VDBAS_P%%=*} serves ${VDBAS_P#*=} while${VDBAS_NEW} serves this round's guard: a partial paste (want ${VDBAS_P%%=*}.2026-11-12.1 or later)"; done
elif [ -n "$VDBAS_OLD" ]; then
  for VDBAS_P in $VDBAS_OLD; do echo "INFO  F S14X-228 ${VDBAS_P%%=*} serves ${VDBAS_P#*=}: this round's mailbox guard is not pasted yet (want ${VDBAS_P%%=*}.2026-11-12.1 or later)"; done
fi
echo "INFO  T S14X-228 the guard turning off API and connector keys made before the address was proved needs a signed-in member, so it is proved on the shipped module (src/test/a-key-minted-before-the-owner-proved-the-address-stops-with-the-old-password.test.ts)"
