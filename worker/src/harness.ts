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
import { identityFields } from "./packet-fields.js";
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
  <textarea name="cCoverLetter" placeholder="Cover Letter"></textarea>
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

/**
 * Rails' hidden field before a control of the same name (S11-047): Pinpoint's
 * required consent box and a radio group. The answer must land on the box
 * and on the option it names, never on the hidden input in front of them.
 */
const RAILS_HIDDEN = `
  <fieldset><legend>Are you willing to relocate?</legend>
    <input type="hidden" name="application[relocate]" value="" />
    <input type="radio" id="r-yes" name="application[relocate]" value="yes" required /><label for="r-yes">Yes</label>
    <input type="radio" id="r-no" name="application[relocate]" value="no" /><label for="r-no">No</label>
  </fieldset>
  <div>
    <input type="hidden" name="application[process_information]" value="0" />
    <label><input type="checkbox" name="application[process_information]" value="1" required />
      I consent to the processing of my personal data</label>
  </div>`;
/** What the server must have received for RAILS_HIDDEN to count as sent right. */
const RAILS_SENT = [
  /name="application\[relocate\]"\r\n\r\nyes\r\n/,
  /name="application\[process_information\]"\r\n\r\n1\r\n/,
];
/** The last application body the native-POST server received. */
let lastBody = "";

/**
 * Breezy's real submit, in shape (S11-011). The live form posts from an
 * ng-click handler, with no navigation: the page that pressed the button is
 * the page that has to show the outcome. networkidle has already fired on that
 * page, so waiting for it returns at once; reading the form straight after the
 * click found it still on screen and recorded a send the employer received as
 * "not sent". `delay` is how long the server takes to answer the XHR.
 */
const FORM_XHR = (extraQuestions: string, onDone: "thank" | "stay" | "nothing") => `<!doctype html>
<html><head><title>Senior Care Assistant — Apply</title></head><body>
<h1>Apply</h1>
<form id="f" novalidate onsubmit="return false">
  <input name="cName" placeholder="Full name" required />
  <input name="cEmail" type="email" placeholder="Email" required />
  <input name="cPhoneNumber" placeholder="Phone" />
  <input name="cAddress" placeholder="Address" />
  <input name="cSalary" placeholder="Desired Salary" />
  <textarea name="cSummary" placeholder="Work History"></textarea>
  <textarea name="cCoverLetter" placeholder="Cover Letter"></textarea>
  <input name="cResume" type="file" required />
  ${extraQuestions}
  <button type="button" id="go">Submit Application</button>
</form>
<div id="done" style="display:none"><h1>Thank you!</h1><p>Your application has been received.</p></div>
<script>
document.getElementById("go").addEventListener("click", function () {
  if (${JSON.stringify(onDone)} === "nothing") return;
  fetch("/api/apply", { method: "POST", body: new FormData(document.getElementById("f")) })
    .then(function (r) { return r.json(); })
    .then(function () {
      if (${JSON.stringify(onDone)} !== "thank") return;
      document.getElementById("f").style.display = "none";
      document.getElementById("done").style.display = "block";
    });
});
</script>
</body></html>`;

type Mode =
  | "confirms" | "silent" | "form-still-there" | "failed-but-says-thanks" | "german"
  | "xhr-confirms" | "xhr-form-stays" | "xhr-nothing-sent";

/** Applications the server actually received, per run: the employer's side. */
let received = 0;

function server(mode: Mode, extra: string, port: number, delay = 0) {
  return createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0]!;
    if (req.method === "POST" && url === "/api/apply") {
      req.on("data", () => {});
      req.on("end", () => {
        received++;
        setTimeout(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        }, delay);
      });
      return;
    }
    if (url.endsWith("/apply") && mode.startsWith("xhr-")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(FORM_XHR(extra, mode === "xhr-confirms" ? "thank" : mode === "xhr-form-stays" ? "stay" : "nothing"));
      return;
    }
    if (req.method === "POST" && url === "/submit") {
      // Drain the upload before replying, or the browser sees a broken pipe.
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => { chunks.push(c); });
      req.on("end", () => {
        lastBody = Buffer.concat(chunks).toString("latin1");
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
  city: "Leeds", country: "United Kingdom", address: "1 Test Street", postcode: "LS1 4AP",
  linkedin: "", website: "", coverNote: "", salaryExpectation: "£50,000",
  earliestStart: "4 weeks", workAuthorized: true, requiresSponsorship: false,
  willingToRelocate: true, workAuthorizedCountries: ["US"],
  shareDemographics: false, consentToProcessing: true,
};

async function run(
  name: string, mode: Mode, extra: string, port: number, expect: string, delay = 0, mustSend: RegExp[] = [],
) {
  received = 0;
  lastBody = "";
  const srv = server(mode, extra, port, delay);
  const browser = await chromium.launch({ headless: true });
  const dir = await mkdtemp(join(tmpdir(), "harness-"));
  const resume = join(dir, "resume.pdf");
  await writeFile(resume, "%PDF-1.4\n% harness\n");
  try {
    const out = await applyToPosting(browser, {
      applyUrl: `http://localhost:${port}/p/test-job`,
      source: "breezy",
      // The production path: the live answers through identityFields, the
      // builder index.ts uses — not a hand-keyed field map, which is how the
      // harness passed while production left name boxes empty (1.13).
      fields: identityFields(ANSWERS),
      resumePath: resume,
      answers: ANSWERS,
    });
    const got = out.kind;
    const missed = mustSend.filter((re) => !re.test(lastBody));
    const ok = got === expect && missed.length === 0;
    if (missed.length) console.log(`        the employer did not receive ${missed.map(String).join(", ")}`);
    const employer = mode.startsWith("xhr-") ? `  [employer received ${received}]` : "";
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(34)} -> ${got}${ok ? "" : `  (expected ${expect})`}${employer}`);
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
    // S11-011: Breezy's XHR submit. A send the employer received is never
    // recorded as unsent; a click that sent nothing still is.
    await run("XHR submit, answered at once", "xhr-confirms", SCREENING, 8737, "submitted", 0),
    await run("XHR submit, answered in 300 ms", "xhr-confirms", SCREENING, 8738, "submitted", 300),
    await run("XHR submit, answered in 1.5 s", "xhr-confirms", SCREENING, 8739, "submitted", 1500),
    await run("XHR sent, form left up -> uncertain", "xhr-form-stays", SCREENING, 8740, "uncertain", 300),
    await run("click sent nothing -> not-submitted", "xhr-nothing-sent", SCREENING, 8741, "not-submitted"),
    // S11-047: a Rails hidden field in front of a consent box and a radio.
    await run("Rails hidden fields -> right controls", "confirms", SCREENING + RAILS_HIDDEN, 8742, "submitted", 0, RAILS_SENT),
  ];
  const passed = results.filter(Boolean).length;
  console.log(`\n  ${passed}/${results.length} paths behaved as designed`);
  process.exit(passed === results.length ? 0 : 1);
}
main();
