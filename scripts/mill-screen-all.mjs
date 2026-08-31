#!/usr/bin/env node
// Staffing-mill screen, all vendors (census-merge protocol): for every board
// ≥100 postings, sample REAL posting text from the vendor API and look for
// agency/mill evidence — postings recruited "on behalf of" clients rather than
// the company hiring for itself. Boards with evidence are EXCLUDED (printed
// for review); clean boards land in round3-mill-cleared.json.
// Vendors whose list feeds carry no posting text (workable/bamboohr/rippling)
// are screened on titles + posting-name patterns — weaker, so borderline
// cases print for eyeballing rather than silently passing.
//
// Usage: node scripts/mill-screen-all.mjs round3-mill-worklist.json

import fs from "node:fs";

const worklist = JSON.parse(fs.readFileSync(process.argv[2] ?? "round3-mill-worklist.json", "utf8"));
const UA = { "User-Agent": "resumebooster.work job board (contact: support@resumebooster.work)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ENGLISH ONLY WAS A BLIND SPOT, and the board is mostly European now.
//
// 2026-08-08: this screen CLEARED `teamtailor:jobtalentfrance` — Jobandtalent
// France, one of Europe's largest temp-staffing platforms. Its postings are
// repeated generic warehouse roles and one names the client outright
// ("A08-RHENUS-Préparateur de commandes"). Nothing matched, because every
// pattern below the fold was English and the postings are French.
//
// The vendors this catalogue grows fastest on — teamtailor, personio — are
// European, so an English-only mill screen fails exactly where it is most
// needed. Phrases added for FR/DE/ES/NL/IT, chosen to be industry terms rather
// than ordinary words: "agence d'intérim" and "Zeitarbeit" name the business
// model, whereas a bare "client"/"Kunde" appears in perfectly normal postings.
const MILL_TEXT = new RegExp([
  // English
  // "our client\u2019s success" is how a CONSULTANCY describes its own jobs —
  // the bare phrase convicted S&P Global, Publicis and Andersen on service
  // prose (2026-08-31). Mill usage is recruitment syntax: the client DOES a
  // hiring verb, or arrives as an appositive ("our client, a leading...").
  "\\bour (\\w+ )?client,? (is|are|seeks|is seeking|is looking|is hiring|has engaged|wishes to)\\b",
  "\\bour client, (a|an|the)\\b", "\\bjoin our client\\b",
  // SINGULAR "for our client" is the placement tell (one client, one req) —
  // CTG wrote "a position for our client. Location:" in 9/12 postings. The
  // plural ("value for our clients") and the hyphenated ("our client-facing
  // platforms") are how consultancies describe their own jobs; both stay out.
  "\\bfor our client\\b(?!s)(?!-)",
  "\\b(permanent|direct) placement\\b",
  // "on behalf of the MD" is what an executive assistant DOES — a bare
  // on-behalf-of match convicted Booking.com, Tufts and Principal on ordinary
  // corporate prose (2026-08-31, 7 boards at 1/12). Mill usage has a hiring
  // verb in front of it; require one within the same clause.
  "\\b(recruit\\w*|hir\\w*|sourcing|vacanc\\w*)\\b[^.!?]{0,60}\\bon behalf of (a|an|our|the)\\b", 
  "\\bclient of ours\\b", "\\bour customer is (hiring|looking)\\b",
  "\\bstaffing (agency|firm|partner)\\b", "\\brecruitment agency\\b",
  "\\bwe are (a|an) (staffing|recruiting|recruitment|talent) (agency|firm|partner)\\b",
  // French — intérim is the industry's own word for it
  "\\bnotre client\\b", "\\bpour le compte de\\b", "\\bagence d.int.rim\\b",
  "\\bagence de recrutement\\b", "\\bcabinet de recrutement\\b", "\\bsoci.t. d.int.rim\\b",
  // German — Zeitarbeit / Arbeitnehmerüberlassung are the regulated terms
  "\\bunser Kunde\\b", "\\bim Auftrag (unseres|eines|der)\\b", "\\bZeitarbeit\\b",
  "\\bPersonaldienstleist", "\\bArbeitnehmer.berlassung\\b", "\\bPersonalvermittlung\\b",
  // Spanish — ETT is the legal category
  "\\bnuestro cliente\\b", "\\bempresa de trabajo temporal\\b", "\\bagencia de empleo\\b",
  // Dutch — uitzendbureau / detachering
  "\\bonze klant\\b", "\\buitzendbureau\\b", "\\bdetacherings?bureau\\b",
  // Italian
  "\\bnostro cliente\\b", "\\bagenzia per il lavoro\\b", "\\bsomministrazione di lavoro\\b",
].join("|"), "i");
const strip = (h) => String(h ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

async function get(url, asText = false) {
  try {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return null;
    return asText ? await res.text() : await res.json();
  } catch { return null; }
}

async function sampleTexts(vendor, token) {
  if (vendor === "greenhouse") {
    // EU boards carry the routing prefix and are served ONLY by the EU API
    // host; the US host would return nothing and the thin-sample rule would
    // HOLD every large EU board forever — safe, but a screen that can never
    // clear what it is asked to screen.
    const eu = token.startsWith("eu~");
    const host = eu ? "boards.eu.greenhouse.io" : "boards-api.greenhouse.io";
    const d = await get(`https://${host}/v1/boards/${eu ? token.slice(3) : token}/jobs?content=true`);
    return (d?.jobs ?? []).slice(0, 12).map((j) => `${j.title}\n${strip(j.content)}`);
  }
  if (vendor === "lever") {
    // The list feed ships descriptionPlain in full — a real text screen, same
    // EU routing as greenhouse. Lever predates this protocol in the catalog,
    // so the branch arrives with the first census wave that can add lever
    // boards (the EU wave); without it every ≥100-posting hit would HOLD.
    const eu = token.startsWith("eu~");
    const host = eu ? "api.eu.lever.co" : "api.lever.co";
    const d = await get(`https://${host}/v0/postings/${eu ? token.slice(3) : token}?mode=json`);
    return (Array.isArray(d) ? d : []).slice(0, 12)
      .map((j) => `${j.text}\n${strip([j.descriptionPlain, j.descriptionBodyPlain, j.additionalPlain].filter(Boolean).join("\n"))}`);
  }
  if (vendor === "ashby") {
    const d = await get(`https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=false`);
    return (d?.jobs ?? []).slice(0, 12).map((j) => `${j.title}\n${strip(j.descriptionPlain ?? j.descriptionHtml)}`);
  }
  if (vendor === "smartrecruiters") {
    const list = await get(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=6`);
    const out = [];
    for (const p of (list?.content ?? []).slice(0, 6)) {
      const d = await get(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings/${p.id}`);
      const sections = d?.jobAd?.sections ?? {};
      out.push(`${p.name}\n${strip(Object.values(sections).map((s) => s?.text ?? "").join(" "))}`);
      await sleep(150);
    }
    return out;
  }
  if (vendor === "recruitee") {
    const d = await get(`https://${token}.recruitee.com/api/offers/`);
    return (d?.offers ?? []).slice(0, 12).map((o) => `${o.title}\n${strip(o.description)}`);
  }
  if (vendor === "breezy") {
    const d = await get(`https://${token}.breezy.hr/json`);
    return (Array.isArray(d) ? d : []).slice(0, 12).map((p) => `${p.name}\n${strip(p.description)}`);
  }
  if (vendor === "teamtailor") {
    const x = await get(`https://${token}.teamtailor.com/jobs.rss`, true);
    return x ? x.split("<item>").slice(1, 13).map((b) => strip(b)) : [];
  }
  if (vendor === "personio") {
    for (const host of ["jobs.personio.de", "jobs.personio.com"]) {
      const x = await get(`https://${token}.${host}/xml`, true);
      if (x && x.includes("<position")) return x.split("<position>").slice(1, 13).map((b) => strip(b));
    }
    return [];
  }
  // workable / bamboohr / rippling: list feeds carry no posting text —
  // titles-only screen (weaker; flagged in output).
  if (vendor === "workable") {
    const d = await get(`https://apply.workable.com/api/v1/widget/accounts/${token}?details=false`);
    return (d?.jobs ?? []).slice(0, 20).map((j) => String(j.title ?? ""));
  }
  if (vendor === "bamboohr") {
    const d = await get(`https://${token}.bamboohr.com/careers/list`);
    return (d?.result ?? []).slice(0, 20).map((j) => String(j.jobOpeningName ?? ""));
  }
  if (vendor === "rippling") {
    const x = await get(`https://ats.rippling.com/${token}/jobs`, true);
    const m = x?.match(/__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return [];
    try {
      const d = JSON.parse(m[1]);
      const q = (d?.props?.pageProps?.dehydratedState?.queries ?? []).find((z) => z.queryKey?.[2] === "job-posts");
      return (q?.state?.data?.items ?? []).slice(0, 20).map((j) => String(j.name ?? ""));
    } catch { return []; }
  }
  if (vendor === "paylocity") {
    // Same two-step shape as smartrecruiters: the board page embeds the whole
    // posting list, but every embedded description is cut to a 110-char
    // preview — too short for phrase evidence — so the screen walks
    // per-posting detail pages, whose structured-data block carries the full
    // text. Titles ride along as the first line for the duplicate-title check.
    const html = await get(`https://recruiting.paylocity.com/recruiting/jobs/All/${token}`, true);
    const m = html?.match(/window\.pageData\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
    if (!m) return [];
    let jobs;
    try { jobs = JSON.parse(m[1])?.Jobs ?? []; } catch { return []; }
    const out = [];
    for (const j of jobs.slice(0, 6)) {
      const det = await get(`https://recruiting.paylocity.com/recruiting/jobs/Details/${j.JobId}`, true);
      const ld = det?.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
      let full = "";
      try { full = String(JSON.parse(ld?.[1] ?? "null")?.description ?? ""); } catch { /* fall through to the thin-sample HOLD */ }
      // A 110-char preview cannot carry phrase evidence. When the detail read
      // fails, contribute NOTHING, so a throttled run starves the sample and
      // the thin-sample rule HOLDs the board — it must never clear it. A
      // titles-only degradation is how two convicted mills nearly re-entered
      // the catalog on 2026-08-30.
      if (full) out.push(`${j.JobTitle}\n${strip(full)}`);
      await sleep(150);
    }
    return out;
  }
  if (vendor === "adp") {
    // Same two-step shape as paylocity: the list payload carries no posting
    // text at all, so the screen walks per-requisition DETAIL calls on the
    // same public endpoint, whose description field carries the full HTML JD
    // (measured 2026-08-31: ~7k chars against nothing in the list row).
    // Titles ride along as the first line for the duplicate-title check. A
    // failed detail read contributes NOTHING, so a throttled run starves the
    // sample and the thin-sample rule HOLDs the board rather than clearing it.
    const [cid, ccIdRaw] = String(token).split("~");
    const ccId = ccIdRaw || "19000101_000001";
    const base = "https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions";
    const qs = `cid=${cid}&ccId=${ccId}&timeStamp=${Date.now()}&lang=en_US&locale=en_US`;
    const d = await get(`${base}?${qs}&$top=20&$skip=1`);
    const reqs = Array.isArray(d?.jobRequisitions) ? d.jobRequisitions : [];
    const out = [];
    for (const r of reqs.slice(0, 6)) {
      const det = r?.itemID ? await get(`${base}/${r.itemID}?${qs}`) : null;
      const full = String(det?.requisitionDescription ?? "");
      if (full) out.push(`${String(r?.requisitionTitle ?? "")}\n${strip(full)}`);
      await sleep(250);
    }
    return out;
  }
  if (vendor === "icims") {
    // Descriptions RIDE THE LIST PAYLOAD (BOARD_DESC_SOURCES) — one request
    // yields full posting text, so this is a real text screen and icims must
    // never join the titles-only set. Verified live 2026-08-31: sampled list
    // items carry description + qualifications + responsibilities.
    const d = await get(`https://${token}/api/jobs?page=1&limit=12`);
    return (d?.jobs ?? []).slice(0, 12).map((j) => {
      const x = j?.data ?? j ?? {};
      const text = [x.description, x.responsibilities, x.qualifications]
        .filter(Boolean).map((t) => strip(String(t))).join("\n");
      return `${String(x.title ?? "")}\n${text}`;
    });
  }
  if (vendor === "pinpoint") {
    // postings.json carries full description HTML — real text screen.
    const d = await get(`https://${token}.pinpointhq.com/postings.json`);
    return (d?.data ?? []).slice(0, 12).map((j) => strip(String(j.description ?? j.title ?? "")));
  }
  return [];
}

const TITLE_ONLY = new Set(["workable", "bamboohr", "rippling"]);
const cleared = [];
const excluded = [];
let i = 0;
for (const b of worklist) {
  i++;
  const texts = await sampleTexts(b.vendor, b.token);
  const hits = texts.filter((t) => MILL_TEXT.test(t)).length;
  const weak = TITLE_ONLY.has(b.vendor);

  // ONE LISTING, POSTED A THOUSAND TIMES, IS NOT A THOUSAND OPENINGS.
  //
  // The phrase patterns above look for a mill SAYING what it is. Two boards on
  // 2026-08-08 cleared every one of them and were still not employers:
  //
  //   Next Job Abroad — 3,173 postings, every sample identical
  //     ("Auswandern nach Griechenland | Customer Support für Deutsche")
  //   Schwertfels Consulting — 1,001 postings, every sample identical
  //     ("(Angehender) Steuerberater (m/w/d)")
  //
  // Between them, 4,174 postings of one advert each. The tell is not what the
  // text says, it is that there is only one text. A real employer with 500
  // openings has 500-ish different titles; a recruiter multiplying one
  // placement across every city has one.
  //
  // Only applied to boards big enough for the ratio to mean something — a
  // 4-posting board legitimately repeating a title is noise, not evidence.
  // A BOARD WE COULD NOT READ MUST NOT CLEAR.
  //
  // The verdict below is `if (spam) exclude; else if (hits) exclude; else
  // clear`, so an EMPTY sample — a 429, a dead endpoint, a shape this script
  // does not parse — produced hits=0, spam=false, and a clean bill of health.
  // "We could not look" and "we looked and it is fine" were the same outcome.
  //
  // Measured 2026-08-08: Workable rate-limited this run (Cloudflare 1015), and
  // `next-job-abroad` cleared with zero postings read — a board whose 3,173
  // postings are all ONE advert ("Auswandern nach Griechenland"), which I had
  // already confirmed by hand. Schwertfels Consulting cleared the same way,
  // 1,001 copies of one placement. Between them 4,174 postings of spam, waved
  // through by a filter that never saw a single line.
  //
  // Held, not excluded-forever: the board is simply not admitted on this run.
  // Re-run when the vendor is not throttling and it gets a real verdict.
  if (texts.length < 3) {
    excluded.push({ ...b, hits: 0, sampled: texts.length, reason: "not-sampled" });
    console.log(`HOLD    ${b.vendor}:${b.token} "${b.name}" (${b.count}p) — only ${texts.length} postings readable; NOT cleared`);
    await sleep(250);
    continue;
  }

  const firstLines = texts.map((t) => String(t).split("\n")[0].trim().toLowerCase()).filter(Boolean);
  const distinct = new Set(firstLines).size;
  const dupSpam = b.count >= 100 && firstLines.length >= 6 && distinct <= Math.max(1, Math.floor(firstLines.length * 0.2));

  if (dupSpam) {
    excluded.push({ ...b, hits, sampled: texts.length, reason: "duplicate-titles" });
    console.log(`EXCLUDE ${b.vendor}:${b.token} "${b.name}" — ${distinct} distinct title(s) across ${firstLines.length} sampled of ${b.count} postings`);
  } else if (hits > 0) {
    excluded.push({ ...b, hits, sampled: texts.length });
    console.log(`EXCLUDE ${b.vendor}:${b.token} "${b.name}" — ${hits}/${texts.length} sampled postings show mill evidence`);
  } else {
    cleared.push({ vendor: b.vendor, token: b.token });
    if (weak) console.log(`clear*  ${b.vendor}:${b.token} "${b.name}" (${b.count}p) — titles-only screen, review name above`);
    else if (i % 10 === 0) console.log(`  …${i}/${worklist.length} screened`);
  }
  await sleep(250);
}
fs.writeFileSync("round3-mill-cleared.json", JSON.stringify(cleared, null, 1));
console.log(`\nCleared ${cleared.length}/${worklist.length}; excluded ${excluded.length}. Wrote round3-mill-cleared.json`);
