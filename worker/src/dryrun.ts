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
import { chromium } from "playwright";
import { writeFileSync, rmSync } from "node:fs";
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

async function main() {
  const [postingUrl, vendor] = process.argv.slice(2);
  const headed = process.argv.includes("--headed");
  if (!postingUrl || !vendor) {
    console.error("usage: tsx src/dryrun.ts <postingUrl> <vendor> [--headed]");
    process.exit(2);
  }

  const adapter = adapterFor(vendor);
  if (!adapter) {
    console.error(`no adapter for "${vendor}" — the worker would refuse this posting`);
    process.exit(1);
  }

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
    console.log(`  [3] fields`);
    let found = 0, missing = 0;
    for (const key of Object.keys(SAMPLE) as PacketFieldKey[]) {
      const t = await adapter.locate(page, key).catch(() => null);
      if (!t) continue; // this vendor has no such field — expected, not a fault
      const visible = await t.isVisible();
      console.log(`        ${visible ? "OK  " : "HIDDEN"}  ${key}`);
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
      const tmp = join(tmpdir(), `dryrun-resume-${Date.now()}.txt`);
      writeFileSync(tmp, "dry run placeholder — not a real resume");
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
        rmSync(tmp, { force: true });
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

    console.log(`\n  ${bad === 0 ? "DRY RUN CLEAN" : `${bad} problem(s)`} — nothing was submitted.\n`);
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
    process.exit(bad === 0 ? 0 : 1);
  }
}

main().catch((e) => { console.error("dry run threw:", e); process.exit(1); });
