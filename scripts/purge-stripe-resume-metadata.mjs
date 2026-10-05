#!/usr/bin/env node
// PURGE THE RÉSUMÉ TEXT STRIPE STILL HOLDS -- an owner-run, one-off tool.
//
// From 2025-12-23 until the create-checkout build "2026-10-04.no-resume-metadata",
// every full-analysis Checkout Session was minted with metadata.resumeData:
// the first 500 characters of the buyer's résumé (usually their name, email,
// phone and address). Our own copy in webhook_events is scrubbed by migration
// 20261004150000; Stripe's copy can only be removed through Stripe's API, with
// the account's secret key, which this repository never holds. So this script
// is run by the account owner, on their own machine:
//
//   STRIPE_SECRET_KEY=sk_live_... node scripts/purge-stripe-resume-metadata.mjs           # dry run: lists, changes nothing
//   STRIPE_SECRET_KEY=sk_live_... node scripts/purge-stripe-resume-metadata.mjs --apply   # removes the key from each session
//
// A restricted key with "Checkout Sessions: write" is enough. Setting a
// metadata key to the empty string is how Stripe deletes it; every other key
// on the session is left exactly as it is, so delivery (which recognises these
// sessions by originalCurrency/baseAmountUSD, see _shared/full-analysis.ts)
// is unaffected. Stripe may refuse to update a session in some states; each
// refusal is printed with Stripe's own message and the run carries on.

const KEY = process.env.STRIPE_SECRET_KEY || "";
const APPLY = process.argv.includes("--apply");
// The day before the $5 price cut that started writing the key.
const SINCE = Math.floor(Date.UTC(2025, 11, 1) / 1000);

if (!/^(sk|rk)_(live|test)_/.test(KEY)) {
  console.error("Set STRIPE_SECRET_KEY to the account's secret or restricted key (sk_... or rk_...). Nothing was read.");
  process.exit(2);
}

const auth = { Authorization: `Bearer ${KEY}` };

async function stripe(method, path, form) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { ...auth, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
}

let after = null;
let seen = 0;
const carrying = [];
for (;;) {
  const q = new URLSearchParams({ limit: "100", "created[gte]": String(SINCE) });
  if (after) q.set("starting_after", after);
  const page = await stripe("GET", `checkout/sessions?${q}`);
  for (const s of page.data) {
    seen++;
    const v = s.metadata?.resumeData;
    if (typeof v === "string" && v.length > 0) carrying.push({ id: s.id, created: new Date(s.created * 1000).toISOString(), chars: v.length });
  }
  if (!page.has_more || page.data.length === 0) break;
  after = page.data[page.data.length - 1].id;
}

console.log(`${seen} Checkout Session(s) since ${new Date(SINCE * 1000).toISOString().slice(0, 10)}; ${carrying.length} still carry metadata.resumeData.`);
// Ids and lengths only: the point of this tool is to stop copying the text around.
for (const c of carrying) console.log(`  ${c.id}  ${c.created}  ${c.chars} chars`);

if (!APPLY) {
  console.log(carrying.length ? "Dry run. Re-run with --apply to remove the key from each." : "Nothing to do.");
  process.exit(0);
}

let removed = 0;
const refused = [];
for (const c of carrying) {
  try {
    const s = await stripe("POST", `checkout/sessions/${c.id}`, { "metadata[resumeData]": "" });
    if (s.metadata && "resumeData" in s.metadata) refused.push({ id: c.id, why: "Stripe answered but the key is still present" });
    else removed++;
  } catch (e) {
    refused.push({ id: c.id, why: e.message });
  }
}
console.log(`Removed from ${removed} session(s).`);
for (const r of refused) console.log(`  NOT removed ${r.id}: ${r.why}`);
if (refused.length) {
  console.log("Sessions Stripe would not update keep the text at Stripe; ask Stripe support to redact them, quoting these ids.");
  process.exit(1);
}
