/**
 * Driver harness: run the REAL applyToPosting all the way through a click.
 *
 * WHAT IS ACTUALLY UNTESTED. Dry runs cover everything up to the submit button
 * — form URL, field location, résumé attach, screening answers, and what
 * proceed() *would* do. Nothing past the click has ever executed: not the click
 * itself, not the settle, not confirmed(), and not the branch that turns a
 * verdict into submitted / not-submitted / uncertain. Those are the paths that
 * decide whether a real person's application is recorded as sent, and they have
 * never run once.
 *
 * WHAT THIS PROVES, precisely: that the driver can navigate, fill Breezy's real
 * field names, attach a file, find a control labelled "Submit Application",
 * click it, wait for the page to settle, and classify what comes back — across
 * all three outcomes.
 *
 * WHAT IT DOES NOT PROVE, and must not be read as proving: that a real Breezy
 * tenant behaves this way. Breezy is an Angular wizard whose form is built by
 * JavaScript and whose confirmation wording nobody here has seen. The saved
 * fixture cannot stand in for that — its scripts do not load offline, so
 * serving it would test a dead page. This harness uses Breezy's real field
 * NAMES and control LABELS against markup written here, which exercises the
 * adapter's selectors but is not the vendor.
 *
 * A harness that claimed to be the vendor would be worse than no harness: it
 * would retire the one open question — what a real confirmation page says —
 * by answering it with my own guess.
 *
 *   npx tsx src/harness.ts
 */
import { createServer } from "node:http";
import { chromium } from "playwright";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyToPosting } from "./apply.js";
import type { StandingAnswers } from "./questions/match.js";

/** Breezy's real control names, taken from the captured fixture. */
const FORM = (extraQuestions: string) => `<!doctype html>
<html><head><title>Senior Care Assistant — Apply</title></head><body>
<h1>Apply</h1>
<form method="POST" action="/submit" enctype="multipart/form-data">
  <input name="cName" placeholder="Full name" required />
  <input name="cEmail" type="email" placeholder="Email" required />
  <input name="cPhoneNumber" placeholder="Phone" />
  <input name="cAddress" placeholder="Address" />
  <input name="cSalary" placeholder="Desired Salary" />
  <textarea name="cSummary" placeholder="Work History"></textarea>
  <input name="cResume" type="file" required />
  <input name="nickname_hpcsaf" style="display:none" />
  ${extraQuestions}
  <button type="submit">Submit Application</button>
</form>
</body></html>`;

/** A screening question the matcher can answer, in Breezy's question shape. */
const SCREENING = `
  <div><label for="q0">Are you legally authorized to work in the US?</label>
    <input type="radio" id="q0a" name="section__question_0" value="Yes" required />
    <label for="q0a">Yes</label>
    <input type="radio" id="q0b" name="section__question_0" value="No" />
    <label for="q0b">No</label>
  </div>`;

/** One a candidate never answered — must refuse, never guess. */
const UNANSWERABLE = `
  <div><label for="q9">What is your ID Number?</label>
    <input id="q9" name="section__question_9" required /></div>`;

type Mode = "confirms" | "silent" | "form-still-there" | "failed-but-says-thanks" | "german";

function server(mode: Mode, extra: string, port: number) {
  return createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0]!;
    if (req.method === "POST" && url === "/submit") {
      // Drain the upload before replying, or the browser sees a broken pipe.
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/html" });
        if (mode === "confirms") {
          res.end(`<!doctype html><html><body><h1>Thank you!</h1>
            <p>Your application has been received. We will be in touch.</p></body></html>`);
        } else if (mode === "silent") {
          // Submitted, but says nothing a phrase list would catch. This is the
          // realistic first-contact case and MUST land as uncertain, not sent.
          res.end(`<!doctype html><html><body><h1>All done</h1>
            <p>Nothing here matches any phrase the adapter looks for.</p></body></html>`);
        } else if (mode === "german") {
          // Breezy tenants serve their own language. An English-only phrase
          // list sends most SUCCESSFUL sends to a human as "uncertain".
          res.end(`<!doctype html><html><body><h1>Vielen Dank!</h1>
            <p>Ihre Bewerbung ist bei uns eingegangen.</p></body></html>`);
        } else if (mode === "failed-but-says-thanks") {
          // THE ONE THAT WAS BROKEN. The submit did not take, the form is still
          // on screen, and the page carries ordinary job-ad copy containing
          // "thank you for your interest". Checking phrases before visibility
          // recorded this as SENT — an application silently lost, and the
          // duplicate guard then blocking the candidate from applying properly.
          res.end(FORM(extra).replace("<h1>Apply</h1>",
            "<h1>Apply</h1><p>Thank you for your interest in this role!</p>"));
        } else {
          // The submit did not take and the form is still on screen.
          res.end(FORM(extra));
        }
      });
      return;
    }
    if (url.endsWith("/apply")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(FORM(extra));
      return;
    }
    res.writeHead(404).end("no");
  }).listen(port);
}

const ANSWERS: StandingAnswers = {
  fullName: "Harness Test", firstName: "Harness", lastName: "Test",
  email: "harness@example.invalid", phone: "+44 7700 900000",
  city: "Leeds", country: "United Kingdom", address: "1 Test Street",
  linkedin: "", website: "", coverNote: "", salaryExpectation: "£50,000",
  earliestStart: "4 weeks", workAuthorized: true, requiresSponsorship: false,
  willingToRelocate: true, shareDemographics: false, consentToProcessing: true,
};

async function run(name: string, mode: Mode, extra: string, port: number, expect: string) {
  const srv = server(mode, extra, port);
  const browser = await chromium.launch({ headless: true });
  const dir = await mkdtemp(join(tmpdir(), "harness-"));
  const resume = join(dir, "resume.pdf");
  await writeFile(resume, "%PDF-1.4\n% harness\n");
  try {
    const out = await applyToPosting(browser, {
      applyUrl: `http://localhost:${port}/p/test-job`,
      source: "breezy",
      fields: {
        fullName: { value: "Harness Test", source: "profile" },
        email: { value: "harness@example.invalid", source: "profile" },
        phone: { value: "+44 7700 900000", source: "profile" },
        address: { value: "1 Test Street", source: "profile" },
        salaryExpectation: { value: "£50,000", source: "profile" },
      },
      resumePath: resume,
      answers: ANSWERS,
    });
    const got = out.kind;
    const ok = got === expect;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(34)} -> ${got}${ok ? "" : `  (expected ${expect})`}`);
    if (!ok || out.kind !== "submitted") {
      console.log(`        ${"reason" in out ? out.reason : "evidence" in out ? out.evidence : ""}`.slice(0, 150));
    }
    return ok;
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
    srv.close();
  }
}

async function main() {
  console.log("Driver harness — the real applyToPosting, past the click.\n");
  const results = [
    await run("confirmation page recognised", "confirms", SCREENING, 8731, "submitted"),
    await run("submitted but silent -> uncertain", "silent", SCREENING, 8732, "uncertain"),
    await run("form still showing -> not-submitted", "form-still-there", SCREENING, 8733, "not-submitted"),
    await run("unanswerable question -> refuse", "confirms", SCREENING + UNANSWERABLE, 8734, "not-submitted"),
    await run("German confirmation recognised", "german", SCREENING, 8735, "submitted"),
    await run("failed submit that says 'thank you'", "failed-but-says-thanks", SCREENING, 8736, "not-submitted"),
  ];
  const passed = results.filter(Boolean).length;
  console.log(`\n  ${passed}/${results.length} paths behaved as designed`);
  process.exit(passed === results.length ? 0 : 1);
}
main();
