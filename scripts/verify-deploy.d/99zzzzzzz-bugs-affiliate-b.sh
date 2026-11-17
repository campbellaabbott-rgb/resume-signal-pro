# shellcheck shell=bash
# ── 99zzzzzzz-bugs-affiliate-b. THE BUG ROUND OF 2026-11-08, PART B, LANE
# AFFILIATE-B (branch bugs/b-affiliate): S14X-213, the affiliate Marketing
# Kit's banners and its newsletter template. The lane changes no function and
# no migration: the kit (src/components/affiliate/MarketingKit.tsx, which
# rides in the Affiliates page chunk) and six files under public/affiliate/
# arrive together with the frontend publish, which a merge may make by itself.
#
# Named 99zzzzzzz-bugs-* as the ledger's bug-round verifySections list it: it
# sorts after every 99zzzzzz-* file in byte order and under a locale that
# ignores the dash.
#
# THE STAGE, read from production, never assumed: the published Affiliates
# chunk names the kit's six fixed banner addresses (/affiliate/banner-WxH.png
# and .svg). Until it does, the old kit is INFO and a banner file that is not
# there is INFO; from then on both are a FAIL. A banner file that IS served,
# at any stage, must be the type, the size and the content it claims.
#
# THE CLAIMS, one line each:
#   K1  the published kit names the six fixed addresses, and carries neither
#       the newsletter's two promises (an analysis against vendors' ATS
#       algorithms, formatting that causes rejection) nor a content-hashed
#       banner (S14X-213).
#   S1-S3  /affiliate/banner-728x90.svg, -300x250.svg and -160x600.svg each
#       answer 200 image/svg+xml whose root says that width and height and
#       the viewBox 0 0 W H, lettered in text elements, with no script, no
#       event handler and no outside reference (S14X-213). The SPA's
#       text/html fallback or a 404 after the publish is a FAIL.
#   P1-P3  /affiliate/banner-728x90.png, -300x250.png and -160x600.png each
#       answer 200 image/png whose IHDR is that width and height (the old
#       files were JPEG bytes under .png names, at other sizes).
#   O1-O3  /assets/banner-leaderboard-7wRFqWjL.png, banner-square-Cs_OOO75.png
#       and banner-skyscraper-CCTK8RI-.png, the hashed addresses the old kit's
#       "Copy HTML embed" wrote into affiliates' pages, each answer 200
#       image/png at 728x90, 300x250 and 160x600 once this round's kit is
#       published (review of part B, 2026-11-17). Their source files left the
#       build with S14X-213 and a publish stops serving an earlier build's
#       hashed files, so public/assets/ carries the new banners under those
#       names. Before the publish they are the old kit's JPEG bytes at other
#       sizes, so every O line is INFO until K1 says the kit is published.
#
# NOT PROVABLE FROM OUTSIDE, so proved in the suite: the preview and the
# label read the same width and height, the embed code names the file by its
# fixed address and marks the link sponsored, and a download that does not
# answer saves nothing (the-affiliate-banners-are-the-size-their-labels-say).
#
# READ-ONLY. GETs of the homepage, its entry, the Affiliates chunk, the six
# banner files and the three old addresses. Nothing is posted.
echo "== 99zzzzzzz-bugs-affiliate-b. bug round part B, affiliate-b lane: banners the size their labels say, at fixed addresses, and a newsletter that promises what the scan shows =="

rm -f /tmp/vd_bafb_home.html /tmp/vd_bafb_entry.js /tmp/vd_bafb_page.js /tmp/vd_bafb_hdr.txt /tmp/vd_bafb_body.bin
VDAFB_SIZES="728x90 300x250 160x600"

# K1 sets the stage.
curl -s -m 30 "$SITE/" > /tmp/vd_bafb_home.html
VDAFB_MAIN=$(grep -o '/assets/index-[^"]*\.js' /tmp/vd_bafb_home.html | head -1)
[ -n "$VDAFB_MAIN" ] && curl -s -m 60 "$SITE$VDAFB_MAIN" > /tmp/vd_bafb_entry.js
VDAFB_PAGEN=$( { [ -f /tmp/vd_bafb_entry.js ] && grep -o 'Affiliates-[A-Za-z0-9_-]*\.js' /tmp/vd_bafb_entry.js; } | head -1)
[ -n "$VDAFB_PAGEN" ] && curl -s -m 30 "$SITE/assets/$VDAFB_PAGEN" > /tmp/vd_bafb_page.js

VDAFB_FE=unknown
if [ -z "$VDAFB_MAIN" ]; then echo "FAIL  K1 the homepage names no /assets/index-*.js entry: the published kit cannot be read"
elif [ -z "$VDAFB_PAGEN" ] || [ ! -s /tmp/vd_bafb_page.js ]; then echo "FAIL  K1 the entry $VDAFB_MAIN names no readable Affiliates chunk (${VDAFB_PAGEN:-none named}): the bundle layout moved, so the kit cannot be judged"
else
  VDAFB_NEW=0; VDAFB_MISSING=""
  for VDAFB_S in $VDAFB_SIZES; do
    for VDAFB_X in png svg; do
      if grep -qF "/affiliate/banner-$VDAFB_S.$VDAFB_X" /tmp/vd_bafb_page.js; then VDAFB_NEW=$((VDAFB_NEW + 1)); else VDAFB_MISSING="$VDAFB_MISSING /affiliate/banner-$VDAFB_S.$VDAFB_X"; fi
    done
  done
  VDAFB_OLD=""
  grep -qF 'real ATS algorithms' /tmp/vd_bafb_page.js && VDAFB_OLD="$VDAFB_OLD 'real ATS algorithms'"
  grep -qF 'cause rejection' /tmp/vd_bafb_page.js && VDAFB_OLD="$VDAFB_OLD 'cause rejection'"
  VDAFB_HASHED=$(grep -oE 'banner-(leaderboard|square|skyscraper)-[A-Za-z0-9_-]+\.png' /tmp/vd_bafb_page.js | head -1)
  [ -n "$VDAFB_HASHED" ] && VDAFB_OLD="$VDAFB_OLD $VDAFB_HASHED"
  if [ "$VDAFB_NEW" = 6 ] && [ -z "$VDAFB_OLD" ]; then VDAFB_FE=live; echo "PASS  K1 the published kit ($VDAFB_PAGEN) names its six banners by fixed /affiliate/ addresses, and its newsletter no longer promises an analysis against vendors' algorithms or formatting that causes rejection (S14X-213)"
  elif [ "$VDAFB_NEW" = 0 ] && [ -n "$VDAFB_OLD" ]; then VDAFB_FE=old; echo "INFO  K1 the published kit ($VDAFB_PAGEN) is the old one (it carries$VDAFB_OLD): the publish carrying part B has not happened"
  elif [ "$VDAFB_NEW" = 0 ]; then echo "FAIL  K1 the Affiliates chunk ($VDAFB_PAGEN) carries neither the old kit nor the new one: the kit moved out of the chunk, so it cannot be judged"
  else
    VDAFB_FE=live; VDAFB_WHY=""
    [ -n "$VDAFB_MISSING" ] && VDAFB_WHY=" it does not name$VDAFB_MISSING"
    [ -n "$VDAFB_OLD" ] && VDAFB_WHY="$VDAFB_WHY${VDAFB_WHY:+;} it still carries$VDAFB_OLD"
    echo "FAIL  K1 the published kit ($VDAFB_PAGEN) is neither the old one nor this round's:$VDAFB_WHY"
  fi
fi

# S1-S3 and P1-P3: each banner file, by GET. The verdict reads the status
# line and content type the host sent and the bytes themselves.
vdafb_file() { # $1 claim $2 WxH $3 png|svg [$4 an address the old kit wrote into embeds]
  rm -f /tmp/vd_bafb_hdr.txt /tmp/vd_bafb_body.bin
  VDAFB_P="${4:-/affiliate/banner-$2.$3}"
  curl -s -m 30 -D /tmp/vd_bafb_hdr.txt -o /tmp/vd_bafb_body.bin "$SITE$VDAFB_P"
  VDAFB_C="$1" VDAFB_WH="$2" VDAFB_EXT="$3" VDAFB_PATH="$VDAFB_P" VDAFB_LEGACY="${4:+1}" VDAFB_STAGE="$VDAFB_FE" node -e '
const fs=require("fs");const e=process.env;const c=e.VDAFB_C;
const path=e.VDAFB_PATH;const legacy=e.VDAFB_LEGACY==="1";
const w=Number(e.VDAFB_WH.split("x")[0]),h=Number(e.VDAFB_WH.split("x")[1]);
let hdr="";try{hdr=fs.readFileSync(process.argv[1],"utf8")}catch{}
let body=Buffer.alloc(0);try{body=fs.readFileSync(process.argv[2])}catch{}
const blocks=hdr.split(/\r?\n\r?\n/).filter((b)=>/^HTTP\//.test(b.trim()));
const last=blocks.length?blocks[blocks.length-1].trim():"";
const sm=/^HTTP\/[0-9.]+ ([0-9]{3})/.exec(last);const status=sm?Number(sm[1]):0;
const tm=/^content-type:[ \t]*([^\r\n]*)/im.exec(last);const ctype=tm?tm[1].trim().toLowerCase():"";
const want=e.VDAFB_EXT==="svg"?"image/svg+xml":"image/png";
const served=status===200&&ctype.split(";")[0].trim()===want;
const said="answers "+(status||"nothing")+" "+(ctype||"(no content type)");
if(legacy&&e.VDAFB_STAGE!=="live"){
  console.log("INFO  "+c+" "+path+" "+said+(e.VDAFB_STAGE==="old"?": the old kit serves its own file here until the publish carrying part B":": K1 could not tell whether the kit is published"));
  process.exit(0)}
if(!served&&legacy){
  console.log("FAIL  "+c+" "+path+" "+said+" though this round kit is published (want 200 "+want+"): every banner an affiliate embedded from the old kit shows nothing (S14X-213)");
  process.exit(0)}
if(!served){
  if(e.VDAFB_STAGE==="live")console.log("FAIL  "+c+" "+path+" "+said+" though the kit that names it is published (want 200 "+want+"): an embedded banner shows nothing");
  else if(e.VDAFB_STAGE==="old")console.log("INFO  "+c+" "+path+" "+said+": the publish carrying part B has not happened");
  else console.log("INFO  "+c+" "+path+" "+said+": K1 could not tell whether the kit is published");
  process.exit(0)}
const bad=[];let size=null;
if(e.VDAFB_EXT==="png"){
  if(body.length<24||body.subarray(0,8).toString("hex")!=="89504e470d0a1a0a"||body.subarray(12,16).toString("latin1")!=="IHDR")bad.push("its bytes are not a PNG (they begin "+body.subarray(0,4).toString("hex")+")");
  else size=body.readUInt32BE(16)+"x"+body.readUInt32BE(20);
}else{
  const s=body.toString("utf8");const root=(/<svg\b[^>]*>/i.exec(s)||[""])[0];
  if(!root)bad.push("it holds no svg element");
  else{
    const aw=/\swidth="([0-9.]+)"/.exec(root),ah=/\sheight="([0-9.]+)"/.exec(root),vb=/\sviewBox="([^"]*)"/.exec(root);
    size=(aw?aw[1]:"?")+"x"+(ah?ah[1]:"?");
    const box=vb?vb[1].trim().split(/[\s,]+/).map(Number):[];
    if(!(box.length===4&&box[0]===0&&box[1]===0&&box[2]===w&&box[3]===h))bad.push("its viewBox is "+(vb?JSON.stringify(vb[1]):"missing")+", not 0 0 "+w+" "+h);
  }
  if(!/<text\b/i.test(s))bad.push("its lettering is not text");
  if(/<script\b|<foreignObject\b|<image\b|\son[a-z]+\s*=|href\s*=\s*"(?!#)|url\(\s*["]?(?!#)/i.test(s))bad.push("it carries a script, a handler or an outside reference");
}
if(size!==null&&size!==w+"x"+h)bad.push("it is "+size+", not "+w+"x"+h);
if(bad.length)console.log("FAIL  "+c+" "+path+" is served as "+want+" but "+bad.join("; ")+" (S14X-213)");
else if(legacy)console.log("PASS  "+c+" "+path+" answers 200 "+want+" at "+w+"x"+h+": a banner embedded from the old kit still loads, now the size its label said (S14X-213)");
else console.log("PASS  "+c+" "+path+" answers 200 "+want+" at "+w+"x"+h+(e.VDAFB_EXT==="svg"?", lettered in text with no script or outside reference":"")+": the size its label says, at an address no rebuild moves (S14X-213)");' /tmp/vd_bafb_hdr.txt /tmp/vd_bafb_body.bin
}
vdafb_file S1 728x90 svg
vdafb_file S2 300x250 svg
vdafb_file S3 160x600 svg
vdafb_file P1 728x90 png
vdafb_file P2 300x250 png
vdafb_file P3 160x600 png
vdafb_file O1 728x90 png /assets/banner-leaderboard-7wRFqWjL.png
vdafb_file O2 300x250 png /assets/banner-square-Cs_OOO75.png
vdafb_file O3 160x600 png /assets/banner-skyscraper-CCTK8RI-.png
