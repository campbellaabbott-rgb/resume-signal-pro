/**
 * BambooHR reachability probe. READ ONLY — nothing is filled, nothing clicked
 * that could submit.
 *
 * WHY THIS RE-RUN EXISTS. BambooHR was ruled out on an "87–100% CAPTCHA"
 * sample, and that number answered a different question than the one that
 * matters. "Does this page load a CAPTCHA script" and "would a CAPTCHA stop us
 * completing this form" are not the same measurement, and nearly every site
 * loads reCAPTCHA on pages that never challenge anyone. BambooHR is ~17% of
 * what a real user sees on the board, so the distinction is worth several
 * thousand postings.
 *
 * WHAT IT CLASSIFIES, and why the middle case is the dangerous one:
 *
 *   none              no CAPTCHA artefact at all -> drivable
 *   visible-challenge a widget a human must interact with (v2 checkbox,
 *                     hCaptcha, Turnstile managed) -> hard block, and an honest
 *                     one: we can see we are stopped
 *   invisible-score   grecaptcha v3 / Enterprise with no widget -> the WORST
 *                     case. A human sees nothing and sails through; a headless
 *                     browser is exactly what the score is for, and a low score
 *                     is rejected SILENTLY. The application looks sent to us and
 *                     never reaches a person. This counts as blocked.
 *
 * A per-TENANT sample, one posting each. Sampling many jobs from one employer
 * measures that employer's configuration repeatedly and reports it as a
 * vendor-wide fact — the same clustering error that made "% of the board"
 * unanswerable earlier.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { ENUMERATE_JS, type DomQuestion } from "./vendors/enumerate-dom.js";

/** Read the CAPTCHA situation from the live DOM, not from the network log. */
const CAPTCHA_JS = `(() => {
  const out = { frames: [], widgets: [], badge: false, globals: [], sitekeys: [] };
  const ifr = document.querySelectorAll("iframe");
  for (let i = 0; i < ifr.length; i++) {
    const s = ifr[i].src || "";
    if (/recaptcha|hcaptcha|turnstile|funcaptcha|arkose/i.test(s)) {
      const r = ifr[i].getBoundingClientRect();
      out.frames.push({ src: s.slice(0, 200), w: Math.round(r.width), h: Math.round(r.height) });
    }
  }
  const sel = ".g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]";
  const ws = document.querySelectorAll(sel);
  for (let i = 0; i < ws.length; i++) {
    const r = ws[i].getBoundingClientRect();
    const cs = getComputedStyle(ws[i]);
    out.widgets.push({
      cls: (ws[i].className || "").toString().slice(0, 40),
      w: Math.round(r.width), h: Math.round(r.height),
      shown: cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0,
    });
    const k = ws[i].getAttribute("data-sitekey");
    if (k) out.sitekeys.push(k.slice(0, 12));
  }
  out.badge = !!document.querySelector(".grecaptcha-badge");
  if (window.grecaptcha) out.globals.push(window.grecaptcha.enterprise ? "grecaptcha.enterprise" : "grecaptcha");
  if (window.hcaptcha) out.globals.push("hcaptcha");
  if (window.turnstile) out.globals.push("turnstile");
  return out;
})()`;

type Cap = {
  frames: Array<{ src: string; w: number; h: number }>;
  widgets: Array<{ cls: string; w: number; h: number; shown: boolean }>;
  badge: boolean; globals: string[]; sitekeys: string[];
};

function classify(c: Cap): "none" | "visible-challenge" | "invisible-score" {
  // A widget or frame with real size on screen is something a person must do.
  const bigFrame = c.frames.some((f) => f.w > 80 && f.h > 40);
  const shownWidget = c.widgets.some((w) => w.shown && w.w > 80 && w.h > 40);
  if (bigFrame || shownWidget) return "visible-challenge";
  // Anything else that is *present* scores in the background. The badge, an
  // anchor frame, or the grecaptcha object with no widget all mean v3/Enterprise.
  if (c.badge || c.globals.length > 0 || c.frames.length > 0 || c.widgets.length > 0) {
    return "invisible-score";
  }
  return "none";
}

/**
 * SELF-CHECK. Run the classifier against vendors already known to be clean and
 * already being driven. If those do not come back "none", the classifier cannot
 * discriminate and every result below is meaningless.
 *
 * This exists because the first run of this probe returned "visible-challenge"
 * for 24 of 24 tenants — an answer indistinguishable from a stuck classifier.
 * A probe that returns the same answer for two different states is not a
 * measurement, and the only way to know which it is, is to feed it a state whose
 * answer you already have.
 */
async function selfCheck(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<boolean> {
  const controls = [
    "https://gold-care-homes.breezy.hr/p/c28bbb4b32a901-nurse-bank-day-night",
    "https://trilongroup.pinpointhq.com/en/postings/017c3d36-b1ae-403b-b936-a8fba7a6d45c",
  ];
  for (const url of controls) {
    const page = await browser.newPage();
    let verdict = "error";
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(3_000);
      const cap = (await page.evaluate(CAPTCHA_JS)) as Cap;
      verdict = classify(cap);
    } catch { /* verdict stays "error" */ }
    await page.close();
    console.log(`  control ${verdict === "none" ? "OK  " : "FAIL"}  ${verdict.padEnd(18)} ${url.split("/")[2]}`);
    if (verdict !== "none") {
      console.error("\n  ABORT: the classifier flags a vendor we drive today as blocked.");
      console.error("  It cannot tell the two states apart, so no BambooHR result would mean anything.\n");
      return false;
    }
  }
  return true;
}

async function main() {
  const sample: Array<{ id: string; company: string; apply_url: string }> =
    JSON.parse(readFileSync("/tmp/bam_sample.json", "utf8"));
  const browser = await chromium.launch({ headless: true });
  if (!(await selfCheck(browser))) { await browser.close(); process.exit(3); }
  console.log("");
  const results: Array<Record<string, unknown>> = [];

  for (const row of sample) {
    const page = await browser.newPage();
    const rec: Record<string, unknown> = { company: row.company, url: row.apply_url };
    try {
      const resp = await page.goto(row.apply_url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      rec.status = resp?.status() ?? 0;
      await page.waitForTimeout(3_000);

      // Reveal the form. BambooHR renders the posting first and the application
      // behind an "Apply for This Job" control; a probe that stops at the
      // posting page measures the description, not the form.
      const applyBtn = page.locator(
        'a:has-text("Apply for This Job"), button:has-text("Apply for This Job"), ' +
        'a:has-text("Apply Now"), button:has-text("Apply"), a[href*="apply" i]',
      ).first();
      if ((await applyBtn.count().catch(() => 0)) > 0) {
        await applyBtn.click({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(4_000);
      }
      rec.landedOn = page.url();

      const qs = (await page.evaluate(ENUMERATE_JS).catch(() => null)) as DomQuestion[] | null;
      const cap = (await page.evaluate(CAPTCHA_JS).catch(() => null)) as Cap | null;

      if (qs) {
        const named = qs.filter((q) => q.name);
        rec.fields = named.length;
        rec.required = named.filter((q) => q.required).length;
        rec.hasFile = named.some((q) => q.type === "file");
        rec.names = named.map((q) => q.name).slice(0, 14);
        rec.questions = named.filter((q) => q.label).map((q) => q.label).slice(0, 8);
      } else rec.fields = -1;

      rec.captcha = cap ? classify(cap) : "unknown";
      // Full frame geometry, because that is what separates a v2 checkbox a
      // person must click (~300x78 on screen) from a v3 token minted invisibly
      // (0x0 / offscreen). Recording only the COUNT cannot tell them apart, and
      // the two have completely different consequences.
      rec.capDetail = cap ? { g: cap.globals, badge: cap.badge, frames: cap.frames, widgets: cap.widgets } : null;
      // The cleanest single signal that a token is expected at submit time.
      rec.responseField = (qs ?? []).some((q) => q.name === "g-recaptcha-response");
    } catch (e) {
      rec.error = String(e).slice(0, 90);
    }
    results.push(rec);
    console.log(
      `${String(rec.captcha ?? rec.error ?? "?").padEnd(18)} ${String(rec.fields ?? "-").padStart(3)} fields  ` +
      `${String(rec.required ?? "-").padStart(2)} req  ${String(row.company).slice(0, 30)}`,
    );
    await page.close();
  }
  await browser.close();
  writeFileSync("/tmp/bam_probe.json", JSON.stringify(results, null, 2));
  console.log("\nwrote /tmp/bam_probe.json");
}
main();
