// How many of a set of harvested forms could the agent complete end to end?
//
// The number this prints is the product ceiling: postings where every required
// question resolves to an answer the candidate actually gave. It reads the
// mapped-field set from the ADAPTER, because a hand-typed one already produced
// a wrong answer once — it reported "Full Name" as the top blocker on forms
// where the adapter had been filling it all along.
import { readFileSync } from "node:fs";
import { planAnswers, type StandingAnswers } from "./questions/match.js";
import { ADAPTERS } from "./vendors/index.js";
import type { DomQuestion } from "./vendors/enumerate-dom.js";

const file = process.argv[2] ?? "src/vendors/__fixtures__/breezy-questions.json";
const vendor = process.argv[3] ?? "breezy";
const forms: Array<{ host: string; questions: DomQuestion[] }> = JSON.parse(readFileSync(file, "utf8"));
const adapter = ADAPTERS[vendor];
if (!adapter) { console.error(`no adapter: ${vendor}`); process.exit(1); }
const mapped = adapter.mappedNames;

const A: StandingAnswers = {
  fullName: "Alex Fairweather", firstName: "Alex", lastName: "Fairweather",
  email: "alex@example.com", phone: "+44 7700 900123", city: "Leeds",
  country: "United Kingdom", address: "12 Example Street",
  linkedin: "https://linkedin.com/in/example", website: "", coverNote: "A short note.",
  salaryExpectation: "£55,000", earliestStart: "4 weeks",
  workAuthorized: true, requiresSponsorship: false, willingToRelocate: true,
  shareDemographics: false, consentToProcessing: true,
};

let ok = 0;
for (const f of forms) {
  const { answerable, blocking } = planAnswers(f.questions, A, mapped);
  if (!blocking.length) ok++;
  console.log(`${blocking.length ? "REFUSE" : "SEND  "} ${f.host.padEnd(42)} ${String(answerable.length).padStart(2)} answered  ${blocking.length} blocking`);
  for (const b of blocking) {
    if (b.r.kind === "unanswerable") console.log(`         BLOCK [${b.r.category}] ${b.r.why}`);
  }
  for (const a of answerable) console.log(`         ok    [${a.r.category}] ${(a.q.label || a.q.name).slice(0, 56)}`);
}
console.log(`\n  ${ok}/${forms.length} completable end to end`);
