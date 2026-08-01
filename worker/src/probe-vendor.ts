// Recon probe for a vendor with no adapter: can its apply form be reached and
// read, and what stands in the way? READ ONLY — nothing filled, nothing clicked
// that could submit.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { ENUMERATE_JS, type DomQuestion } from "./vendors/enumerate-dom.js";

const APPLY_RE = /^(apply|apply now|apply for this job|apply to position|jetzt bewerben|bewerben|postuler|solicitar)/i;

async function main() {
  const vendor = process.argv[2]!;
  const sample: Array<{ company: string; apply_url: string }> =
    JSON.parse(readFileSync(`/tmp/${vendor}_sample.json`, "utf8"));
  const b = await chromium.launch({ headless: true });
  const out: Array<Record<string, unknown>> = [];

  for (const row of sample) {
    const page = await b.newPage();
    const rec: Record<string, unknown> = { company: row.company };
    try {
      const r = await page.goto(row.apply_url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      rec.status = r?.status() ?? 0;
      await page.waitForTimeout(3_500);

      // Try to reach the form the way a person would: click whatever says apply.
      const btn = page.getByRole("button", { name: APPLY_RE }).or(page.getByRole("link", { name: APPLY_RE })).first();
      if ((await btn.count().catch(() => 0)) > 0) {
        await btn.click({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(4_500);
      }
      rec.landed = page.url().slice(0, 110);

      const qs = (await page.evaluate(ENUMERATE_JS).catch(() => null)) as DomQuestion[] | null;
      const named = (qs ?? []).filter((q) => q.name && q.type !== "hidden");
      rec.fields = named.length;
      rec.required = named.filter((q) => q.required).length;
      rec.hasFile = named.some((q) => q.type === "file");
      rec.names = named.map((q) => q.name).slice(0, 12);
      rec.labels = named.filter((q) => q.label).map((q) => q.label.slice(0, 52)).slice(0, 8);

      // What kind of wall is this, if any?
      const txt = ((await page.textContent("body").catch(() => "")) ?? "").slice(0, 6_000);
      rec.wall = {
        signIn: /sign in|log ?in|create an account|register/i.test(txt),
        emailFirst: /enter your email|email address to (start|begin|continue)/i.test(txt),
        terms: /terms (and|&) conditions|privacy (policy|notice)|i agree/i.test(txt),
        captcha: /recaptcha|hcaptcha|turnstile/i.test(await page.content().catch(() => "")),
      };
    } catch (e) { rec.error = String(e).slice(0, 90); }
    out.push(rec);
    const w = rec.wall as Record<string, boolean> | undefined;
    console.log(
      `  ${String(rec.status ?? "ERR").padEnd(4)} ${String(rec.fields ?? "-").padStart(3)}f ` +
      `${String(rec.required ?? "-").padStart(2)}req  ` +
      `${w ? Object.entries(w).filter(([, v]) => v).map(([k]) => k).join(",") || "no wall" : rec.error}` +
      `  ${String(rec.company).slice(0, 26)}`);
    await page.close();
  }
  await b.close();
  writeFileSync(`/tmp/${vendor}_probe.json`, JSON.stringify(out, null, 2));
}
main();
