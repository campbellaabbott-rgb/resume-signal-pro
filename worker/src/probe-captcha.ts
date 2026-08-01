/**
 * WHICH bot-detection product is on an apply form, and does it actually render?
 *
 * probe-vendor.ts answers a cruder question — does the string "recaptcha" appear
 * anywhere in the HTML — and that flagged 40 of 40 pages across Ashby, Lever,
 * Workable and Rippling. The control group saved it from being nonsense: the
 * same probe returns "no wall" for Breezy and Teamtailor, which I have driven
 * end to end. So the signal discriminates and the string really is there.
 *
 * It still does not answer the question that decides whether to build. These
 * are three different worlds:
 *
 *   1. A script referenced but never instantiated — often a privacy policy
 *      mention or a tag-manager bundle. No obstacle at all.
 *   2. reCAPTCHA v3 / Turnstile in invisible mode — no challenge appears, the
 *      submit succeeds, and a score decides silently whether a human ever sees
 *      the application. This is the WORST case for a candidate, because it
 *      looks exactly like success.
 *   3. An interactive checkbox or image challenge — a hard, honest stop.
 *
 * Only (3) is visible from the outside. (2) is the one that matters most and is
 * indistinguishable from (1) without submitting, which is not something to do
 * on a stranger's behalf to find out.
 *
 * So this records what CAN be established: which product, whether its script is
 * really fetched over the network, whether a widget is rendered and visible, and
 * whether the sitekey indicates invisible mode. Everything else is reported as
 * unknown rather than guessed.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const PRODUCTS: Array<[string, RegExp]> = [
  ["recaptcha-enterprise", /recaptcha\/enterprise/i],
  ["recaptcha", /recaptcha\/api\.js|google\.com\/recaptcha/i],
  ["hcaptcha", /hcaptcha\.com/i],
  ["turnstile", /challenges\.cloudflare\.com\/turnstile/i],
  ["cloudflare-challenge", /cdn-cgi\/challenge-platform/i],
];

async function main() {
  const vendor = process.argv[2]!;
  const sample: Array<{ company: string; apply_url: string }> =
    JSON.parse(readFileSync(`/tmp/${vendor}_sample.json`, "utf8"));
  const b = await chromium.launch({ headless: true });
  const out: Array<Record<string, unknown>> = [];

  for (const row of sample) {
    const page = await b.newPage();
    // NETWORK is the honest test of "is this thing actually loaded". A <script>
    // tag in the markup can be dead; a request that goes out is not.
    const reqs: string[] = [];
    page.on("request", (r) => {
      const u = r.url();
      for (const [name, re] of PRODUCTS) if (re.test(u)) reqs.push(name);
    });

    const rec: Record<string, unknown> = { company: row.company };
    try {
      await page.goto(row.apply_url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(2_500);
      const btn = page.getByRole("button", { name: /^(apply|apply now|apply for this job)/i })
        .or(page.getByRole("link", { name: /^(apply|apply now|apply for this job)/i })).first();
      if ((await btn.count().catch(() => 0)) > 0) {
        await btn.click({ timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(4_000);
      }

      const html = await page.content().catch(() => "");
      rec.inMarkup = PRODUCTS.filter(([, re]) => re.test(html)).map(([n]) => n);
      rec.networkLoaded = [...new Set(reqs)];

      // Does a widget actually EXIST on the page, and can a person see it?
      // An invisible v3 badge is not a challenge; a visible checkbox is.
      rec.widget = await page.evaluate(`(() => {
        const frames = [...document.querySelectorAll('iframe')].filter(f =>
          /recaptcha|hcaptcha|turnstile|challenge/i.test(f.src || ''));
        const visible = frames.filter(f => {
          const r = f.getBoundingClientRect();
          const s = getComputedStyle(f);
          return r.width > 20 && r.height > 20 && s.visibility !== 'hidden' && s.display !== 'none';
        });
        const badge = document.querySelector('.grecaptcha-badge');
        const sitekeyEl = document.querySelector('[data-sitekey]');
        return {
          iframes: frames.length,
          visibleIframes: visible.length,
          visibleSizes: visible.map(f => Math.round(f.getBoundingClientRect().width) + 'x' + Math.round(f.getBoundingClientRect().height)),
          // The v3 badge is the tell for INVISIBLE scoring: no challenge shown,
          // a score computed anyway.
          v3Badge: !!badge,
          dataSize: sitekeyEl ? sitekeyEl.getAttribute('data-size') : null,
        };
      })()`);
    } catch (e) { rec.error = String(e).slice(0, 80); }

    const w = (rec.widget ?? {}) as Record<string, unknown>;
    const net = (rec.networkLoaded as string[] ?? []);
    console.log(
      `  ${String(row.company).slice(0, 24).padEnd(24)} ` +
      `markup:${(rec.inMarkup as string[] ?? []).join("/") || "-"}  ` +
      `network:${net.join("/") || "NONE"}  ` +
      `iframes:${w.iframes ?? "-"} visible:${w.visibleIframes ?? "-"}${w.visibleSizes && (w.visibleSizes as string[]).length ? " " + (w.visibleSizes as string[]).join(",") : ""}  ` +
      `v3badge:${w.v3Badge ?? "-"}`);
    out.push(rec);
    await page.close();
  }
  await b.close();
  writeFileSync(`/tmp/${vendor}_captcha.json`, JSON.stringify(out, null, 2));
}
main();
