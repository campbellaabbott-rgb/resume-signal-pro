/**
 * Does the worker's idea of the broker match the broker?
 *
 * WHY THIS IS ITS OWN SCRIPT. The client in broker.ts was written from a
 * specification. The edge function was written from the same specification, by
 * someone else, and the two have never spoken. Every field name, every nesting
 * level and every null is an independent chance to disagree — and a
 * disagreement here does not throw. It produces a worker that claims a packet,
 * reads `answers.fullName` as undefined, fills a form with blanks, and refuses
 * the posting for a reason that looks like a missing profile.
 *
 * That is the failure this whole session kept finding in other clothes: a thing
 * that reports success while checking nothing. So this checks the contract
 * point by point and says which side is wrong.
 *
 * IT NEVER TOUCHES AN EMPLOYER. No browser is launched and nothing is
 * submitted. It calls ping, then claim — and if a real packet comes back it is
 * released straight away, because a diagnostic that leaves a customer's
 * application leased for ten minutes has caused the outage it was run to rule
 * out.
 *
 *   npx tsx src/smoke.ts
 */
import * as broker from "./broker.js";

const WORKER_ID = "smoke-check";
const VERSION = "smoke";

let failures = 0;
const pass = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string, detail = "") => { failures++; console.log(`  ✗ ${m}${detail ? `\n      ${detail}` : ""}`); };

/** Present and a string. `""` is fine — absent is not. */
const str = (o: Record<string, unknown>, k: string) => typeof o[k] === "string";
/** Trinary: true, false or null. `undefined` means the field never arrived. */
const tri = (o: Record<string, unknown>, k: string) =>
  o[k] === true || o[k] === false || o[k] === null;

async function main() {
  console.log("\nBroker contract check — nothing is submitted to any employer.\n");

  // ── 1. auth + reachability ───────────────────────────────────────────────
  const pong = await broker.ping(WORKER_ID, VERSION, 0);
  if (!pong.ok) {
    // Distinguish the three, because they need three different fixes and they
    // are trivially confusable from a log line that just says "failed".
    const hint = {
      auth: "APPLY_WORKER_SECRET does not match the edge secret of the same name.",
      misconfigured: "APPLY_BROKER_URL / APPLY_WORKER_SECRET missing from worker/.env.",
      network: "Could not reach the host at all — check APPLY_BROKER_URL.",
      server: "The broker answered, but with an error.",
    }[pong.kind];
    fail(`ping (${pong.kind})`, `${pong.detail}\n      ${hint}`);
    console.log("\n  Stopping — nothing else can be checked without a working call.\n");
    process.exit(1);
  }
  pass("ping accepted — URL and secret are both right");
  console.log("    (this also wrote a heartbeat, so the pricing card will show the");
  console.log("     agent as live for the next 15 minutes)");

  // ── 2. claim: shape, not just status ─────────────────────────────────────
  const c = await broker.claim(WORKER_ID, VERSION);
  if (!c.ok) {
    fail(`claim (${c.kind})`, c.detail);
    process.exit(1);
  }

  if (c.data === null) {
    pass("claim returned an empty queue cleanly");
    console.log("\n  The contract is only half-checked: no packet existed, so the");
    console.log("  payload shape is still unverified. Re-run this with one packet");
    console.log("  queued to finish the job — that is the half most likely to");
    console.log("  disagree, because it is the half with thirty field names in it.\n");
    process.exit(failures ? 1 : 0);
  }

  // A real packet. Check it, then hand it straight back.
  try {
    const { packet, answers, learned, resumeUrl } = c.data;

    for (const k of ["id", "user_id", "posting_id", "apply_url", "source"] as const) {
      if (packet?.[k] === undefined || packet?.[k] === null) fail(`packet.${k} missing`);
    }
    if (typeof packet?.id !== "number") fail("packet.id is not a number", `got ${typeof packet?.id}`);
    else pass("packet carries id, user_id, posting_id, apply_url, source");

    const a = (answers ?? {}) as unknown as Record<string, unknown>;
    const strings = ["fullName", "firstName", "lastName", "email", "phone", "city",
      "country", "address", "postcode", "linkedin", "website", "coverNote",
      "salaryExpectation", "earliestStart"];
    const missingStr = strings.filter((k) => !str(a, k));
    if (missingStr.length) fail(`answers missing string fields`, missingStr.join(", "));
    else pass(`answers carry all ${strings.length} text fields`);

    // THE ONE THAT MATTERS MOST. A trinary arriving as `undefined` would be
    // read as "not stated" by luck rather than by contract — and if the broker
    // ever coerced it to false instead, the agent would tell an employer
    // someone is NOT authorised to work somewhere they had simply not answered
    // about.
    const tris = ["workAuthorized", "requiresSponsorship", "willingToRelocate"];
    const badTri = tris.filter((k) => !tri(a, k));
    if (badTri.length) fail("trinaries are not true/false/null", `${badTri.join(", ")} — a missing field here becomes a false statement to an employer`);
    else pass("trinaries arrive as true/false/null, never undefined");

    if (!Array.isArray(a.workAuthorizedCountries)) fail("workAuthorizedCountries is not an array");
    else pass(`workAuthorizedCountries is an array (${(a.workAuthorizedCountries as unknown[]).length} entries)`);

    if (!Array.isArray(learned)) fail("learned is not an array");
    else pass(`learned answers arrive as an array (${learned.length})`);

    if (resumeUrl === undefined) fail("resumeUrl field absent entirely");
    else if (resumeUrl === null) pass("resumeUrl is null — this candidate has no résumé on file");
    else {
      // Fetch a byte. A signed URL that 403s is indistinguishable from a
      // missing résumé at submit time, and both end as "form wanted a CV".
      const head = await fetch(resumeUrl, { method: "GET", headers: { Range: "bytes=0-0" } })
        .then((r) => r.status).catch(() => 0);
      if (head >= 200 && head < 400) pass(`résumé URL fetches (HTTP ${head})`);
      else fail(`résumé URL did not fetch (HTTP ${head})`, "signed URL expired, wrong bucket, or wrong path");
    }
  } finally {
    // Always, even if a check above threw. A stranded lease is worse than a
    // failed smoke test.
    const back = await broker.release(c.data.packet.id, { status: "ready" });
    if (back.ok) pass(`packet ${c.data.packet.id} released back to the queue`);
    else fail("could not release the claimed packet", `${back.kind}: ${back.detail} — it will free itself when the 10-minute lease lapses`);
  }

  console.log(failures === 0
    ? "\n  Contract holds. The worker and the broker agree on every field.\n"
    : `\n  ${failures} mismatch(es) above. Fix before running the worker for real.\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error("smoke check crashed:", e); process.exit(1); });
