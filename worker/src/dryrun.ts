// Drive a real posting with the REAL adapter code, and stop before the click.
//
// This is not a mock and not a re-implementation: it imports the same adapters
// the worker uses and calls the same methods in the same order. The only thing
// it will not do is press submit.
//
// WHY IT EXISTS. Every check before this one tested something adjacent. The
// fixtures compare selectors to a recorded inventory. The browser-tool
// reconnaissance ran hand-written JavaScript, not adapter code. Neither exercises
// Playwright itself — its shadow-DOM piercing, its visibility rules, its
// timeouts — which is where three of the four vendors actually live.
//
// It needs no database and no service-role key, so it can run on any laptop
// against any posting, before anyone decides whether to send anything.
//
//   npx tsx src/dryrun.ts <postingUrl> <vendor> [--headed]
//
// WITH --submit IT STOPS BEING A DRY RUN. That path presses the button and a
// real employer receives a real application, which cannot be withdrawn. It
// therefore demands a profile file of real details, refuses anything that still
// looks like an example, prints what it is about to send, and waits for the word
// SUBMIT to be typed. None of that is ceremony — it is the difference between a
// test and a stranger reading a fabricated CV.
//
//   npx tsx src/dryrun.ts <postingUrl> <vendor> --submit --profile ./applicant.json --headed
import { chromium } from "playwright";
import { writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adapterFor } from "./vendors/index.js";
import type { PacketFieldKey } from "./vendors/types.js";

// Obvious placeholders. Nothing is submitted, but if a keystroke ever escaped
// into a real form it should be unmistakably a test rather than a plausible
// half-application from a person who does not exist.
const SAMPLE: Partial<Record<PacketFieldKey, string>> = {
  fullName: "DRY RUN — DO NOT PROCESS",
  firstName: "DRYRUN",
  lastName: "DONOTPROCESS",
  email: "dry-run@example.invalid",
  confirmEmail: "dry-run@example.invalid",
  phone: "+10000000000",
  city: "Testville",
  address: "1 Test Street",
  linkedin: "https://example.invalid/in/dry-run",
  website: "https://example.invalid",
  coverNote: "Automated dry run. Nothing was submitted.",
  salaryExpectation: "0",
};

/**
 * Values that mean "nobody filled this in".
 *
 * The sample profile and this file's own placeholders both live in the repo, so
 * the realistic mistake is running --submit before editing anything. That would
 * send "DRY RUN — DO NOT PROCESS" to a recruiter. Cheap to catch, so caught.
 */
const PLACEHOLDER = /dry.?run|do.?not.?process|example\.invalid|^$|^changeme$|your.?name.?here/i;

type Profile = Record<string, string>;

function loadProfile(path: string): Profile {
  if (!existsSync(path)) {
    console.error(`\n  profile not found: ${path}`);
    console.error("  cp applicant.example.json applicant.json  and fill it in\n");
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  delete raw._README;
  const p: Profile = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string" && v.trim()) p[k] = v.trim();

  // Identity and contact are what an employer needs to reply. A submission
  // missing them is not an application, it is noise with someone's CV attached.
  const required = ["email", "resumePath"];
  const hasName = p.fullName || (p.firstName && p.lastName);
  const missing = required.filter((k) => !p[k]);
  if (!hasName) missing.push("fullName (or firstName + lastName)");
  if (missing.length) {
    console.error(`\n  profile is missing: ${missing.join(", ")}\n`);
    process.exit(2);
  }

  const fake = Object.entries(p).filter(([, v]) => PLACEHOLDER.test(v)).map(([k]) => k);
  if (fake.length) {
    console.error(`\n  these still look like examples: ${fake.join(", ")}`);
    console.error("  a real employer reads this. Fill them in properly.\n");
    process.exit(2);
  }
  const resumePath = p.resumePath ?? "";
  if (!resumePath || !existsSync(resumePath)) {
    console.error(`\n  résumé not found at ${resumePath || "(unset)"}\n`);
    process.exit(2);
  }
  return p;
}

async function confirmOrExit(url: string, vendor: string, p: Profile) {
  console.log("\n  ─────────────────────────────────────────────────────────");
  console.log("   THIS WILL SEND A REAL APPLICATION. It cannot be undone.");
  console.log("  ─────────────────────────────────────────────────────────");
  console.log(`   to:      ${url}`);
  console.log(`   vendor:  ${vendor}`);
  console.log(`   name:    ${p.fullName || `${p.firstName} ${p.lastName}`}`);
  console.log(`   email:   ${p.email}`);
  console.log(`   résumé:  ${p.resumePath}`);
  console.log("  ─────────────────────────────────────────────────────────");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("   Type SUBMIT to send, anything else to abort: ")).trim();
  rl.close();
  if (answer !== "SUBMIT") {
    console.log("\n  aborted — nothing was sent.\n");
    process.exit(0);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const [postingUrl, vendor] = argv;
  const headed = argv.includes("--headed");
  const doSubmit = argv.includes("--submit");
  const profilePath = argv[argv.indexOf("--profile") + 1];

  let profile: Profile | null = null;
  if (doSubmit) {
    if (!argv.includes("--profile") || !profilePath || profilePath.startsWith("--")) {
      console.error("\n  --submit requires --profile <file> with real details\n");
      process.exit(2);
    }
    profile = loadProfile(profilePath);
  }
  if (!postingUrl || !vendor) {
    console.error("usage: tsx src/dryrun.ts <postingUrl> <vendor> [--headed]");
    process.exit(2);
  }

  const adapter = adapterFor(vendor);
  if (!adapter) {
    console.error(`no adapter for "${vendor}" — the worker would refuse this posting`);
    process.exit(1);
  }

  if (doSubmit) await confirmOrExit(postingUrl, vendor, profile!);

  const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 300 : 0 });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  let bad = 0;

  try {
    console.log(`\n  vendor: ${adapter.key}`);
    console.log(`  posting: ${postingUrl}\n`);

    // 1. resolveFormUrl — the step that has already been wrong once, when a
    //    truncated href was recorded as the rule and 404'd on first use.
    const formUrl = await adapter.resolveFormUrl(page, postingUrl);
    console.log(`  [1] resolveFormUrl  ${formUrl ? "OK   " + formUrl : "FAILED — no form found"}`);
    if (!formUrl) { bad++; return; }

    // 2. A CAPTCHA on a vendor measured clean stops the worker. Check the same
    //    way it does, so a change in vendor protection shows up here first.
    const captcha = /recaptcha|hcaptcha|turnstile|arkoselabs/i.test(await page.content());
    console.log(`  [2] captcha         ${captcha ? "PRESENT — worker would refuse" : "none"}`);
    if (captcha) { bad++; return; }

    // 3. locate() for every field the packet could carry, through Playwright —
    //    so shadow DOM, visibility and timeouts are all genuinely exercised.
    // Placeholders on a dry run; the real person's details on a real send.
    const values: Partial<Record<PacketFieldKey, string>> = profile
      ? (profile as Partial<Record<PacketFieldKey, string>>)
      : SAMPLE;

    console.log(`  [3] fields`);
    let found = 0, missing = 0;
    for (const key of Object.keys(values) as PacketFieldKey[]) {
      const v = values[key];
      if (!v) continue;
      const t = await adapter.locate(page, key).catch(() => null);
      if (!t) continue; // this vendor has no such field — expected, not a fault
      const visible = await t.isVisible();
      // On a real send the values must actually be typed in. On a dry run we
      // only prove they are reachable, and type nothing.
      if (doSubmit && visible) await t.fill(v).catch(() => {});
      console.log(`        ${visible ? (doSubmit ? "FILLED" : "OK  ") : "HIDDEN"}  ${key}`);
      visible ? found++ : missing++;
    }
    console.log(`        ${found} locatable, ${missing} present-but-hidden`);
    if (found === 0) { console.log("        NO FIELDS FOUND — the adapter is broken for this posting"); bad++; }

    // 4. The résumé input, named rather than guessed. Attaching a CV to the
    //    wrong file input produces an application whose CV slot is empty while
    //    looking, to us, like it worked.
    const cv = await adapter.locateResume(page).catch(() => null);
    if (!cv) {
      console.log("  [4] résumé input    NOT FOUND");
      bad++;
    } else {
      // A hidden file input is NORMAL — vendors style a drop zone over it — and
      // Playwright's setInputFiles does not require visibility. But "does not
      // require" is a claim about the library, and the résumé is the one
      // attachment an application cannot do without, so it is proven here rather
      // than assumed: attach a real temp file and confirm the input took it.
      //
      // Nothing is uploaded. A file only leaves the machine on submit, which
      // this run never performs.
      const tmp = doSubmit ? (profile!.resumePath as string)
                           : join(tmpdir(), `dryrun-resume-${Date.now()}.txt`);
      if (!doSubmit) writeFileSync(tmp, "dry run placeholder — not a real resume");
      let attached = "FAILED";
      try {
        await cv.setFile(tmp);
        const n = await page.locator('input[type="file"]')
          .evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).files?.length).length)
          .catch(() => 0);
        attached = n > 0 ? `OK — ${n} input(s) now hold a file` : "setFile threw no error but no file landed";
        if (n === 0) bad++;
      } catch (e) {
        attached = `FAILED — ${String(e).slice(0, 80)}`;
        bad++;
      } finally {
        // Never delete the candidate's actual résumé.
        if (!doSubmit) rmSync(tmp, { force: true });
      }
      const visible = await cv.isVisible();
      console.log(`  [4] résumé input    ${visible ? "visible" : "hidden (normal — styled drop zone)"}; attach: ${attached}`);
    }

    // 5. Ask the ADAPTER what proceed() would do. Never guess from button text:
    //    the first version of this checked for "submit application"/"continue"
    //    and called Personio stuck, because its button reads "Bewerbung senden".
    const what = await adapter.canProceed(page).catch(() => "stuck" as const);
    console.log(`  [5] proceed() would ${what === "would-submit" ? "SUBMIT"
      : what === "would-advance" ? "ADVANCE a step (multi-step form)"
      : "return STUCK — no way forward found"}`);
    if (what === "stuck") bad++;

    if (!doSubmit) {
      console.log(`\n  ${bad === 0 ? "DRY RUN CLEAN" : `${bad} problem(s)`} — nothing was submitted.\n`);
      return;
    }

    // ---------------------------------------------------------------------
    // From here the tool sends. Refuse if anything above went wrong: a partial
    // application is worse than none — it burns the posting for this person and
    // the duplicate guard then blocks them applying properly later.
    // ---------------------------------------------------------------------
    if (bad > 0) {
      console.log(`\n  ${bad} problem(s) above — NOT submitting. Fix them first.\n`);
      return;
    }

    console.log("\n  [6] submitting…");
    // The real proceed(), stepping through as many pages as the form has. Same
    // ceiling as the worker, for the same reason: a form that never finishes is
    // not one to keep clicking through.
    let steps = 0, sent = false;
    while (steps++ < 6) {
      const r = await adapter.proceed(page).catch(() => "stuck" as const);
      console.log(`        step ${steps}: ${r}`);
      if (r === "submitted") { sent = true; break; }
      if (r === "stuck") break;
      await page.waitForTimeout(2_500);
      // Later steps can hold fields the first page did not.
      for (const key of Object.keys(values) as PacketFieldKey[]) {
        const v = values[key];
        if (!v) continue;
        const t = await adapter.locate(page, key).catch(() => null);
        if (t && await t.isVisible()) await t.fill(v).catch(() => {});
      }
    }

    if (!sent) {
      console.log("\n  never reached a submit control — nothing was sent.\n");
      bad++;
      return;
    }

    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    const verdict = await adapter.confirmed(page).catch(() => "unknown" as const);

    // THE ANSWER THIS WHOLE EXERCISE EXISTS FOR. The confirmation phrases were
    // written from what vendors typically say, never from what this one does.
    console.log(`\n  [7] confirmed(): ${verdict}`);
    if (verdict === "yes") {
      console.log("      The vendor's wording matched. Unattended sends on this");
      console.log("      vendor will be stamped as submitted correctly.");
    } else if (verdict === "unknown") {
      console.log("      SENT, but the wording did not match. In production this");
      console.log("      becomes `uncertain` and goes to a human — safe, but the");
      console.log("      unattended path does nothing until the phrase is added.");
      const body = ((await page.textContent("body").catch(() => "")) ?? "")
        .replace(/\s+/g, " ").trim().slice(0, 300);
      console.log(`\n      what the page actually says:\n      "${body}"`);
      console.log("\n      Add the real phrase to this vendor's confirmed().");
    } else {
      console.log("      The form is still showing — the submit did not take.");
    }
    console.log(`\n  screenshot: ${await page.screenshot({ path: `submit-${adapter.key}-${Date.now()}.png` })
      .then(() => "saved").catch(() => "failed")}\n`);
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
    process.exit(bad === 0 ? 0 : 1);
  }
}

main().catch((e) => { console.error("dry run threw:", e); process.exit(1); });
