// Oracle Recruiting Cloud recon, step 1: what does the email gate actually
// offer, and can the real form be reached without creating anything?
// STRICTLY READ ONLY — nothing typed, nothing clicked that could POST.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

async function main() {
  const sample = JSON.parse(readFileSync("/tmp/oracle_sample.json", "utf8")) as Array<{company:string;apply_url:string}>;
  const b = await chromium.launch({ headless: true });
  for (const row of sample.slice(0, 3)) {
    const p = await b.newPage();
    console.log(`\n──── ${row.company} ────`);
    try {
      await p.goto(row.apply_url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await p.waitForTimeout(2_000);
      const applyBtn = p.getByRole("button", { name: /^apply/i }).or(p.getByRole("link", { name: /^apply/i })).first();
      if ((await applyBtn.count().catch(() => 0)) > 0) {
        await applyBtn.click({ timeout: 10_000 }).catch(() => {});
        await p.waitForTimeout(2_500);
      }
      const d = await p.evaluate(`(() => {
        // Ignore the idle-session modal — reading it instead of the page is how
        // the first pass produced a button list that was mostly timeout dialog.
        const modal = [...document.querySelectorAll('*')].find(e => /Are You Still With Us/i.test(e.textContent||'') && e.children.length < 8);
        const t = document.body.innerText;
        return {
          url: location.href,
          // What is this page asking for, in its own words?
          heading: (document.querySelector('h1,h2')||{}).innerText || '',
          prompt: (t.match(/[^\\n]{0,110}(email)[^\\n]{0,110}/i)||[])[0] || '',
          // Every route out of here.
          buttons: [...document.querySelectorAll('button,a[role=button],input[type=submit]')]
            .map(e => (e.innerText||e.value||'').trim()).filter(Boolean).slice(0,14),
          // Does it offer applying WITHOUT an account?
          guest: /continue as guest|without (an )?account|no account needed|apply without/i.test(t),
          // WIDENED. The first version looked for "create an account"/"sign up"
          // and returned FALSE on a page whose own text reads "Your profile
          // will be created" — matching the words I expected instead of the
          // ones the page used.
          createsProfile: /profile will be created|create (an )?account|sign up|register|set a password|verification code|your profile/i.test(t),
          sessionModal: !!modal,
          links: [...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href'))
            .filter(h=>h && /apply|application/i.test(h)).slice(0,6)
        };
      })()`);
      console.log(JSON.stringify(d, null, 2).slice(0, 900));
    } catch (e) { console.log("  ERR", String(e).slice(0, 90)); }
    await p.close();
  }
  await b.close();
}
main();
