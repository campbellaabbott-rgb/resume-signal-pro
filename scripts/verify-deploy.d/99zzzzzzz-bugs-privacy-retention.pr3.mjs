// PR3 for 99zzzzzzz-bugs-privacy-retention: the served Privacy page.
// Its own file because the messages name page phrases, and threading those
// through a shell single-quoted node -e is how a verdict line gets mangled
// into a syntax error that reads as a silent section.
import fs from "node:fs";

let h = "";
try { h = fs.readFileSync("/tmp/vd_bpr_privacy.html", "utf8"); } catch { /* reported below */ }
if (!h || h.length < 2000) {
  console.log(`PR3 FAIL  /privacy served ${h.length} bytes; the page cannot be judged`);
  process.exit(0);
}
const txt = h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const m = /Last updated:?\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/.exec(txt);
if (!m) {
  console.log("PR3 FAIL  /privacy carries no Last-updated date, so nothing can be gated on the publish");
  process.exit(0);
}
const updated = m[1];
const ROUND_FROM = "2026-11-12";
const published = updated >= ROUND_FROM;

const say = (id, ok, what, detail) => {
  if (!published) {
    console.log(`PR3 INFO  ${id}: /privacy Last updated reads ${updated}, before the round (${ROUND_FROM}), so the copy has not published — ${what} is ${ok ? "already true" : "not yet true"}`);
    return;
  }
  console.log(`${ok ? "PR3 PASS  " : "PR3 FAIL  "}${id}: ${what}${ok ? "" : " — " + detail}`);
};

// (a) S14X-181: section 11 no longer carries the old processor phrase.
say("S14X-181a", !/AI models and fonts/i.test(txt),
  "section 11 no longer reads AI-models-and-fonts", "the old phrase is still served");

// (b) S14X-181: the SIGN-IN PROCESSOR SENTENCE names Resend. Scoped to that
// sentence and never grepped page-wide: Resend already appears twice on
// today's page, so a page-wide grep would pass while the processor line stayed
// wrong — one of the four shapes of a guard that looks like it works.
const signin = (txt.match(/[^.]*sign-?in[^.]*\./gi) || []).filter((x) => /email|mail|processor|send/i.test(x));
say("S14X-181b", signin.some((x) => /Resend/.test(x)),
  "the sign-in processor sentence names Resend",
  signin.length ? `the sign-in sentence found does not name it: ${signin[0].trim().slice(0, 120)}` : "no sign-in processor sentence was found at all");

// (c) S14X-181: the ipinfo line names the emailed report.
const ipinfo = txt.match(/[^.]*ipinfo[^.]*\./gi) || [];
say("S14X-181c", ipinfo.some((x) => /report/i.test(x)),
  "the ipinfo line names the emailed report",
  ipinfo.length ? `it reads ${ipinfo[0].trim().slice(0, 120)}` : "no ipinfo sentence was found");

// (d) S14X-097: the In-Your-Browser item mentions signing out.
const browser = /In Your Browser([\s\S]{0,700})/i.exec(txt);
say("S14X-097", !!browser && /sign(ing)? out|log(ging)? out/i.test(browser[1]),
  "the In-Your-Browser item says signing out clears what is held there",
  browser ? "the item does not mention signing out" : "the In-Your-Browser item was not found");

// (e) and (f): owner-gated. An absent answer judges nothing.
const gate = (id, key, env, what, test, detail) => {
  const choice = process.env[env] || "";
  if (!choice) {
    console.log(`PR3 INFO  ${id}: owner pending — the bug-round reservation in docs/deploy-ledger.json records no ownerDecided[${key}]. The answer exists in the round register (recorded 2026-11-15); the integrator copies it into the reservation when bugs/base is cut`);
    return;
  }
  if (!published) {
    console.log(`PR3 INFO  ${id}: owner answered ${choice}, and /privacy Last updated reads ${updated}, before the round, so the copy has not published yet`);
    return;
  }
  const ok = test();
  console.log(`${ok ? "PR3 PASS  " : "PR3 FAIL  "}${id}: owner answered ${choice} — ${what}${ok ? "" : " — " + detail}`);
};

gate("S14X-021", "S14X-021", "OG_021", "the page names the referral cookie",
  () => /affiliate_ref/.test(h) || /referral/i.test(txt),
  "neither affiliate_ref nor the word referral appears, so the ?ref cookie is still undisclosed");

gate("S14X-073", "S14X-073", "OG_073", "the Shortlist sentence states the recorded retention rule",
  () => {
    const c = (process.env.OG_073 || "").toUpperCase();
    const sl = (txt.match(/[^.]*Shortlist[^.]*\./gi) || []).join(" ");
    if (!sl) return false;
    return c.startsWith("A")
      ? /delete[\s\S]{0,80}(role|candidate)/i.test(sl) && /(four|4)[- ]year|4 years/i.test(sl)
      : /until[\s\S]{0,60}account/i.test(sl);
  },
  "the served Shortlist sentence does not state it");
