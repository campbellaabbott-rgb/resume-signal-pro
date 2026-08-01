/**
 * What does the matcher NOT understand, across real harvested forms?
 *
 * This exists because coverage was being chosen from intuition. The obvious
 * guesses — languages spoken, driving licence, years of experience — are
 * plausible and were on the build list, but nothing had checked whether they
 * actually appear on the forms the agent can reach. Building from a guess costs
 * the same as building from a measurement and is worth less.
 *
 * Feed it harvest.ts output. It prints every REQUIRED question the matcher
 * refuses, most frequent first, so the next thing to build is whatever is at
 * the top rather than whatever came to mind.
 *
 * Two exclusions, both deliberate:
 *
 *  - Fields the adapter already fills are not gaps. Read from the adapter's own
 *    `mappedNames`, never hand-listed — a hand-listed set previously reported
 *    "Full Name" as the top blocker on forms where the adapter had been filling
 *    it all along.
 *  - Honeypots are not questions. They are invisible traps, and counting them
 *    as unanswered coverage would put "fill the honeypot" on the roadmap.
 *
 * A refusal here is not automatically a gap either. "Nationality" and
 * "identity document" are refused on purpose and must stay refused; the output
 * separates deliberate refusals from genuinely unrecognised labels, because a
 * list that mixed them would invite someone to close the wrong ones.
 */
import { readFileSync } from "node:fs";
import { matchQuestion, type StandingAnswers } from "./questions/match.js";
import { ADAPTERS } from "./vendors/index.js";
import type { DomQuestion } from "./vendors/enumerate-dom.js";

/** A candidate who has answered everything the profile panel offers, so that
 *  anything still refused is a MISSING CAPABILITY rather than a missing
 *  answer. Measuring with a half-filled profile would blame the matcher for
 *  gaps that are really empty fields. */
const FULL: StandingAnswers = {
  fullName: "Alex Fairweather", firstName: "Alex", lastName: "Fairweather",
  email: "alex@example.com", phone: "+44 7700 900123", city: "Leeds",
  country: "United Kingdom", address: "12 Example Street", postcode: "LS1 4AP",
  linkedin: "https://linkedin.com/in/example", website: "https://example.com",
  coverNote: "A short note.", salaryExpectation: "£55,000", earliestStart: "4 weeks",
  workAuthorized: true, requiresSponsorship: false, willingToRelocate: true,
  workAuthorizedCountries: ["US", "IE", "DE"],
  shareDemographics: false, consentToProcessing: true,
};

type Form = { url: string; questions: DomQuestion[] };

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: coverage.ts <harvest.json> [more.json ...]  (name each file <vendor>.json or pass vendor:path)");
  process.exit(1);
}

const unrecognised = new Map<string, { n: number; sample: string; vendors: Set<string> }>();
const deliberate = new Map<string, number>();
let forms = 0, required = 0, answered = 0, mappedCount = 0, honeypots = 0;
// FORM-level, which is the number that decides whether anything gets sent. A
// posting with one unanswered required question is refused whole, so a
// question-level percentage flatters the product: 48 of 103 answered sounds
// like half the work done, while the forms those 55 sit on are all refused.
let completable = 0;
/** For each form, the categories that stopped it — so "what single fix would
 *  unblock the most POSTINGS" is answerable, rather than "what appears most
 *  often", which is a different question with a different answer. */
const blockedBy = new Map<string, number>();
const soleBlocker = new Map<string, number>();

for (const spec of files) {
  const parts = spec.includes(":") ? spec.split(/:(.+)/) : [spec.replace(/.*h_|\.json$/g, ""), spec];
  const vendor = parts[0] ?? "", path = parts[1] ?? "";
  const adapter = ADAPTERS[vendor];
  if (!adapter) { console.error(`no adapter: ${vendor} (from ${spec})`); process.exit(1); }
  const data: Form[] = JSON.parse(readFileSync(path, "utf8"));

  for (const f of data) {
    if (!f.questions?.length) continue;
    forms++;
    const blockers: string[] = [];
    for (const q of f.questions) {
      if (q.honeypot) { honeypots++; continue; }
      if (adapter.mappedNames.has(q.name)) { mappedCount++; continue; }
      // Requiredness comes from the LABEL where the vendor does not set the
      // attribute — Teamtailor sets it on 3 of 78 controls while 41 say so in
      // words, so trusting the attribute would report almost nothing required.
      const isReq = adapter.requiredAttributeIsTrustworthy === false
        ? q.required || /\*\s*$|\brequired\b|erforderlich|requis|obligatorisk/i.test(q.label)
        : q.required;
      if (!isReq) continue;
      required++;

      const r = matchQuestion(q, FULL);
      if (r && r.kind !== "unanswerable") { answered++; continue; }
      if (r && r.kind === "unanswerable" && r.category !== "unrecognised") {
        deliberate.set(r.category, (deliberate.get(r.category) ?? 0) + 1);
        blockers.push(r.category);
        continue;
      }
      blockers.push("unrecognised");
      const key = (q.label || q.name).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 70);
      const e = unrecognised.get(key) ?? { n: 0, sample: q.label || q.name, vendors: new Set<string>() };
      e.n++; e.vendors.add(vendor);
      unrecognised.set(key, e);
    }

    if (!blockers.length) { completable++; continue; }
    for (const b of new Set(blockers)) blockedBy.set(b, (blockedBy.get(b) ?? 0) + 1);
    const distinct = new Set(blockers);
    // A SOLE blocker is the interesting case: fix it and this form ships.
    // Anything else is one item on a list and fixing it changes nothing.
    if (distinct.size === 1) {
      const only = [...distinct][0]!;
      soleBlocker.set(only, (soleBlocker.get(only) ?? 0) + 1);
    }
  }
}

console.log(`\n  ${forms} forms, ${required} required questions beyond the adapter's own fields`);
console.log(`  ${answered} answered  ·  ${[...deliberate.values()].reduce((a, b) => a + b, 0)} refused on purpose  ·  ${unrecognised.size} distinct unrecognised`);
console.log(`  (${mappedCount} controls the adapter fills, ${honeypots} honeypots skipped — neither is a gap)\n`);

console.log(`  ${completable}/${forms} forms completable end to end — the only number that ships anything\n`);
console.log("  BLOCKS AT LEAST ONE FORM (and, in brackets, is the ONLY thing blocking it):");
for (const [c, n] of [...blockedBy].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(3)} forms  ${c}${soleBlocker.get(c) ? `   [sole blocker on ${soleBlocker.get(c)}]` : ""}`);
}

console.log("\n  REFUSED ON PURPOSE — these must stay refused:");
for (const [c, n] of [...deliberate].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(3)}  ${c}`);
}

console.log("\n  UNRECOGNISED — the honest build list, most frequent first:");
const ranked = [...unrecognised.values()].sort((a, b) => b.n - a.n);
for (const e of ranked) {
  console.log(`    ${String(e.n).padStart(3)}  [${[...e.vendors].join(",")}] ${e.sample.slice(0, 78)}`);
}
if (!ranked.length) console.log("    (none)");
