#!/usr/bin/env node
// Rung-3 vendor-copy update: every place the board states its vendor list must
// change in the SAME commit as the sources merge — the claim and the catalog
// move together. Handles the two string variants across all 9 locales:
//   (a) parenthetical list "…, Workable, BambooHR)" — identical in every locale
//   (b) prose list "…, Workable(,) <and> BambooHR" — localized conjunction

import fs from "node:fs";

const NEW_PAREN = "Greenhouse, Lever, Ashby, SmartRecruiters, Workable, BambooHR, Recruitee, Teamtailor, Personio, Breezy)";
const OLD_PAREN = "Greenhouse, Lever, Ashby, SmartRecruiters, Workable, BambooHR)";

// locale → [old prose tail, new prose tail]
const PROSE = {
  "en": ["Workable, and BambooHR", "Workable, BambooHR, Recruitee, Teamtailor, Personio, and Breezy"],
  "en-GB": ["Workable, and BambooHR", "Workable, BambooHR, Recruitee, Teamtailor, Personio, and Breezy"],
  "de": ["Workable und BambooHR", "Workable, BambooHR, Recruitee, Teamtailor, Personio und Breezy"],
  "es": ["Workable y BambooHR", "Workable, BambooHR, Recruitee, Teamtailor, Personio y Breezy"],
  "fr": ["Workable et BambooHR", "Workable, BambooHR, Recruitee, Teamtailor, Personio et Breezy"],
  "nl": ["Workable en BambooHR", "Workable, BambooHR, Recruitee, Teamtailor, Personio en Breezy"],
  "pt": ["Workable e BambooHR", "Workable, BambooHR, Recruitee, Teamtailor, Personio e Breezy"],
  "hi": ["Workable और BambooHR", "Workable, BambooHR, Recruitee, Teamtailor, Personio और Breezy"],
  "tl": ["Workable, at BambooHR", "Workable, BambooHR, Recruitee, Teamtailor, Personio, at Breezy"],
};

let changed = 0;
for (const [loc, [oldProse, newProse]] of Object.entries(PROSE)) {
  const path = `src/i18n/locales/${loc}.json`;
  let text = fs.readFileSync(path, "utf8");
  const before = text;
  text = text.split(OLD_PAREN).join(NEW_PAREN).split(oldProse).join(newProse);
  if (text !== before) { fs.writeFileSync(path, text); changed++; console.log(`updated ${path}`); }
  else console.warn(`WARN: no change in ${path} — check strings manually`);
}

// Code fallbacks (en): Jobs.tsx ×2, GhostJobIndex.tsx ×1
for (const path of ["src/pages/Jobs.tsx", "src/pages/GhostJobIndex.tsx"]) {
  let text = fs.readFileSync(path, "utf8");
  const before = text;
  text = text.split(OLD_PAREN).join(NEW_PAREN).split(PROSE.en[0]).join(PROSE.en[1]);
  if (text !== before) { fs.writeFileSync(path, text); changed++; console.log(`updated ${path}`); }
}
console.log(`done — ${changed} files updated`);
