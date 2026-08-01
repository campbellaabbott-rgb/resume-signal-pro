// Teamtailor résumé question. The first pass found 0/10 file inputs, but it
// never dismissed the cookie banner — an overlay can stop the apply form
// rendering at all, and "no file input" would then be a fact about the banner.
// READ ONLY: cookie choice is DECLINE non-essential; nothing is submitted.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const DECLINE = /decline all non.?necessary|decline|reject all|only necessary|nur notwendige/i;
const APPLY = /^(apply for this job|apply now|apply|jetzt bewerben|bewerben|postuler)/i;

async function main() {
  const sample = JSON.parse(readFileSync("/tmp/teamtailor_sample.json", "utf8")) as Array<{company:string;apply_url:string}>;
  const b = await chromium.launch({ headless: true });
  for (const row of sample.slice(0, 6)) {
    const p = await b.newPage();
    const out: Record<string, unknown> = { company: row.company };
    try {
      await p.goto(row.apply_url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await p.waitForTimeout(2_500);

      // Most privacy-preserving option, and it also clears the overlay.
      const dec = p.getByRole("button", { name: DECLINE }).first();
      out.cookieBanner = (await dec.count().catch(() => 0)) > 0;
      if (out.cookieBanner) { await dec.click({ timeout: 5_000 }).catch(() => {}); await p.waitForTimeout(1_500); }

      const ap = p.getByRole("button", { name: APPLY }).or(p.getByRole("link", { name: APPLY })).first();
      if ((await ap.count().catch(() => 0)) > 0) { await ap.click({ timeout: 8_000 }).catch(() => {}); await p.waitForTimeout(4_000); }

      out.detail = await p.evaluate(`(() => {
        const t = document.body.innerText;
        const files = [...document.querySelectorAll('input[type=file]')];
        return {
          fileInputs: files.map(e => ({ name: e.name, accept: (e.accept||'').slice(0,40),
            shown: getComputedStyle(e).display !== 'none' })),
          // Teamtailor renders an upload widget rather than a bare input on some
          // configs; look for the affordance, not just the element.
          dropZone: /drag (and )?drop|upload (your )?(cv|resume|file)|ziehen|dateien/i.test(t),
          mentionsCv: /\\b(cv|resume|résumé|lebenslauf|curriculum)\\b/i.test(t),
          cvSentence: (t.match(/[^\\n]{0,70}\\b(cv|resume|résumé|lebenslauf)\\b[^\\n]{0,70}/i)||[])[0] || null,
          connectOnly: /connect(ing)? (with|to)|create (a )?profile|sign in with/i.test(t),
          fields: [...document.querySelectorAll('input:not([type=hidden]),select,textarea')]
            .map(e => e.name).filter(Boolean).slice(0,14)
        };
      })()`);
    } catch (e) { out.error = String(e).slice(0, 80); }
    const d = out.detail as Record<string, unknown> | undefined;
    const f = (d?.fileInputs as unknown[] | undefined) ?? [];
    console.log(`  ${String(row.company).slice(0,24).padEnd(24)} cookie=${out.cookieBanner ? "Y" : "n"} ` +
      `files=${f.length} drop=${d?.dropZone ? "Y" : "n"} cvText=${d?.mentionsCv ? "Y" : "n"}`);
    if (d?.cvSentence) console.log(`      "${String(d.cvSentence).trim().slice(0,88)}"`);
    if (f.length) console.log(`      ${JSON.stringify(f).slice(0,110)}`);
    await p.close();
  }
  await b.close();
}
main();
