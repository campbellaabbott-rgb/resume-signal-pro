# shellcheck shell=bash
# ── 87. PROFILES + DESIGN, PASS B (branch pd/wire, inside the profiles 0-2 and
# design upgrade integration): the board page mounts the design system's
# components. A FRONTEND-ONLY deploy (no edge function, no migration), so every
# claim is judged on the JavaScript the site serves: the entry, the Jobs chunk,
# the chunks it imports (the lander, the card, the pane and the filter row may
# be split out of it) and the English locale chunks. Sourced by
# scripts/verify-deploy.sh; $SITE is in scope.
#
# THE CLAIMS:
#   87a the lander chunk carries CompanyLander's strings (the company
#       vocabulary's keys and the header's one answer line) and NOT the legacy
#       lander's "verified open roles" answer: no jobsPage.companyYesHiring key
#       and no "verified open roles" literal anywhere in the graph.
#   87b the board chunk carries the new card, pane and filter row (the listing
#       vocabulary's keys, the decision row and the filter row markers).
#   87c the apply-agent pitch is gone: none of its locale keys in the graph or
#       in the English locale chunks, and no English string says the agent
#       fills and submits, or sells the $99 plan.
#   87d the English locale chunks carry the company title's new form and none
#       of the "verified openings" phrases the owner ruled out.
#
# Read-only: GETs of the site shell and its assets. Nothing is sent or
# written. Before the deploy 87a, 87b and 87c FAIL by design (the live chunks
# carry the legacy answer and the pitch, and no listing key).
echo "== 87. profiles + design pass B: the board serves the design system's lander, card, pane and filter row; the agent pitch is gone =="

SITE="$SITE" node -e '
const { SITE } = process.env;
const out = (s, m) => console.log(`${s.padEnd(5)} ${m}`);
const get = async (url) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); return r.ok ? await r.text() : ""; } catch { return ""; } };
(async () => {
  const home = await get(`${SITE}/`);
  const main = (home.match(/\/assets\/index-[^"]*\.js/) || [])[0];
  if (!main) { out("FAIL", "could not find the entry chunk in the served shell: nothing below can be judged"); return; }
  const mainJs = await get(`${SITE}${main}`);
  const jobsName = ((mainJs.match(/"\.\/Jobs-[A-Za-z0-9_-]*\.js"/) || [])[0] || "").replace(/"/g, "").replace(/^\.\//, "");
  if (!jobsName) { out("FAIL", `the entry ${main} names no Jobs chunk: the board is not in this build`); return; }
  const jobsJs = await get(`${SITE}/assets/${jobsName}`);
  // The graph: the Jobs chunk and what it imports, statically or lazily.
  const deps = [...new Set([...jobsJs.matchAll(/"\.\/([A-Za-z0-9_.-]+\.js)"/g)].map((m) => m[1]))].slice(0, 80);
  let graph = jobsJs;
  const depNames = [];
  for (const d of deps) { const js = await get(`${SITE}/assets/${d}`); if (js) { graph += "\n" + js; depNames.push(d); } }
  // The English strings: en.json rides in the entry; en-GB and the English
  // shards are lazy chunks named en-* / en-GB-*. A chunk named en-* that is
  // not a locale (the changelog entries in English are one) is left out: it is
  // read by content, a locale module carries the jobsPage, listing or
  // companyProfile family.
  const enNames = [...new Set([...mainJs.matchAll(/"\.\/(en(?:-GB)?-[A-Za-z0-9_-]+\.js)"/g)].map((m) => m[1]))].slice(0, 12);
  let en = mainJs;
  const localeNames = [];
  for (const d of enNames) {
    const js = await get(`${SITE}/assets/${d}`);
    if (/\bjobsPage:|\blisting:|\bcompanyProfile:/.test(js)) { en += "\n" + js; localeNames.push(d); }
  }
  const all = graph + "\n" + en;
  out("INFO", `graph: ${jobsName} + ${depNames.length} imported chunks (${graph.length.toLocaleString()} chars); English locale chunks beside the entry: ${localeNames.length} of ${enNames.length} en-* chunks`);

  // 87a: the lander.
  const landerKeys = ["companyProfile.zero.answer", "companyProfile.openRoles", "companyProfile.subtitle", "data-company-answer", "companyProfile.record.title"];
  const missingLander = landerKeys.filter((k) => !graph.includes(k));
  out(missingLander.length === 0 ? "PASS" : "FAIL", `87a the board graph carries CompanyLander (${landerKeys.length} markers${missingLander.length ? `; missing: ${missingLander.join(", ")}` : ""})`);
  const legacy = ["jobsPage.companyYesHiring\"", "jobsPage.companyYesHiringCapped\"", "verified open roles", "Verified Openings", "jobsPage.hhTitle\""];
  const legacyHits = legacy.filter((k) => all.includes(k));
  out(legacyHits.length === 0 ? "PASS" : "FAIL", `87a no served chunk carries the legacy lander answer${legacyHits.length ? ` (found: ${legacyHits.join(", ")})` : ""}`);

  // 87b: the card, the pane and the filter row.
  const listingKeys = ["listing.card.checkFitLabel", "listing.card.moreActions", "data-posting-actions", "listing.status.read", "data-filter-bar", "listing.detail.openRoles", "listing.actions.checkFit"];
  const missingListing = listingKeys.filter((k) => !graph.includes(k));
  out(missingListing.length === 0 ? "PASS" : "FAIL", `87b the board graph carries the listing card, pane and filter row (${listingKeys.length} markers${missingListing.length ? `; missing: ${missingListing.join(", ")}` : ""})`);

  // 87c: the pitch.
  const pitchKeys = ["jobsPage.agentPitchCounted", "jobsPage.agentPitchCta", "jobsPage.agentAppliesTip2", "jobsPage.agentOnlyTip", "jobsPage.savedMilestoneDesc", "jobsPage.queueBridge", "howApply.agentSubmits", "howApply.agentPrepares"];
  const pitchKeyHits = pitchKeys.filter((k) => graph.includes(k));
  out(pitchKeyHits.length === 0 ? "PASS" : "FAIL", `87c the board graph reads none of the pitch keys${pitchKeyHits.length ? ` (reads: ${pitchKeyHits.join(", ")})` : ""}`);
  // The locale chunk is the whole en.json, keys and values: the pitch keys are gone from it too.
  const enKeyHits = ["agentPitchCounted", "agentPitchCta", "agentAppliesTip2", "agentOnlyTip", "savedMilestoneDesc", "queueBridge", "agentSubmits", "agentPrepares", "bringYourOwnAgent", "chipAgentOnly"].filter((k) => en.includes(`"${k}"`) || en.includes(`${k}:`));
  // The pitch sentences themselves (board keys; the retired agent page and FAQ strings are wave 4 files, judged there).
  const enPhraseHits = ["fill and submit", "The Apply Agent can prep", "runs your search nightly", "our apply agent can fill", "or bring your own agent", "The Apply Agent can submit applications here", "The Apply Agent prepares your answers"].filter((p) => en.includes(p));
  out(en.length > 0 && enKeyHits.length === 0 && enPhraseHits.length === 0 ? "PASS" : "FAIL", `87c the English locale chunks carry no pitch key or sentence${en.length === 0 ? " (no English chunk loaded)" : ""}${enKeyHits.length ? ` (keys: ${enKeyHits.join(", ")})` : ""}${enPhraseHits.length ? ` (sentences: ${enPhraseHits.join(" | ")})` : ""}`);

  // 87d: the title form and the ruled-out phrases.
  const titleForm = en.includes("jobs: open roles from their own hiring system");
  // The ruled-out phrases as the board and home-hero keys used to spell them (the retired agent page copy is wave 4 territory).
  const banned = ["{{n}}+ verified openings", "Browse {{n}}+ verified jobs", "Browse verified openings", "Browse the verified job board", "every opening verified", "every posting verified", "{{total}} verified openings", "No verified openings match", "verified open roles right now", "{{count}} verified openings", "Real, Verified Openings", "Verified Openings", "Verified direct from", "all verified roles", "verified, fresh, re-checked", "verified live from the company", `statOpenings:"verified openings"`, "Verified Job Boards"].filter((p) => en.includes(p));
  out(en.length > 0 && titleForm && banned.length === 0 ? "PASS" : "FAIL", `87d the English locale chunks carry the company title form and none of the ruled-out phrases${!titleForm ? " (title form missing)" : ""}${banned.length ? ` (found: ${banned.join(" | ")})` : ""}`);
})();
'
