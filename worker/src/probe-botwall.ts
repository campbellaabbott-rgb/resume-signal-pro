/**
 * Any bot wall, on any domain — not just the ones I thought to name.
 *
 * WHY THIS REPLACES THE DOMAIN LIST. probe-captcha.ts matched known vendor
 * hosts: google.com/recaptcha, hcaptcha.com, challenges.cloudflare.com. It
 * reported Recruitee as completely clean, 10 of 10, nothing on the network.
 * Recruitee serves hCaptcha from its OWN CDN:
 *
 *     https://captcha-base.recruiteecdn.com/1/secure-api.js?render=explicit&onload=hca…
 *
 * A first-party proxy defeats a domain allow-list completely, and the failure
 * is silent and confident — the probe does not error, it says "clean". That is
 * the worst shape a measurement can have, and it nearly put a bot-walled vendor
 * into production.
 *
 * So this matches on the PATH and query of every request the page makes,
 * whatever the host, and prints anything unclassified rather than dropping it.
 * A detector that only recognises what it was told about will keep making this
 * mistake on the next vendor that self-hosts.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const SIGNS: Array<[string, RegExp]> = [
  ["captcha", /captcha/i],
  ["turnstile", /turnstile/i],
  ["cf-challenge", /challenge-platform|cdn-cgi\/challenge/i],
  ["datadome", /datadome/i],
  ["perimeterx", /perimeterx|px-cloud|px-cdn/i],
  ["imperva", /incapsula|imperva/i],
  ["akamai-bot", /akam\/\d|_bm\/|akamaized.*sensor/i],
  ["fingerprint", /fingerprintjs|fpjs|botd/i],
  ["arkose", /arkoselabs|funcaptcha/i],
];

async function main() {
  const vendor = process.argv[2]!;
  const rows = JSON.parse(readFileSync(`/tmp/${vendor}_sample.json`, "utf8")) as Array<{ company: string; apply_url: string }>;
  const b = await chromium.launch({ headless: true });
  let anyHit = 0;

  for (const row of rows) {
    const page = await b.newPage();
    const hits = new Set<string>();
    const samples: string[] = [];
    page.on("request", (r) => {
      const u = r.url();
      for (const [name, re] of SIGNS) {
        if (re.test(u)) { hits.add(name); if (samples.length < 2) samples.push(u.slice(0, 96)); }
      }
    });
    try {
      await page.goto(row.apply_url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(2_500);
      // Reach the FORM, then wait. A wall that loads lazily at submit time
      // appears here and not on the posting page.
      const btn = page.getByRole("button", { name: /apply|solliciteer|postuler|bewerben|solicitar/i })
        .or(page.getByRole("link", { name: /apply|solliciteer|postuler|bewerben|solicitar/i })).first();
      if ((await btn.count().catch(() => 0)) > 0) {
        await btn.click({ timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(5_000);
      }
    } catch { /* recorded as whatever was seen before the failure */ }
    if (hits.size) anyHit++;
    console.log(`  ${row.company.slice(0, 24).padEnd(24)} ${hits.size ? [...hits].join(",") : "clean"}`);
    for (const s of samples) console.log(`      ${s}`);
    await page.close();
  }
  await b.close();
  console.log(`\n  ${anyHit}/${rows.length} tenants load a bot wall\n`);
}
main();
