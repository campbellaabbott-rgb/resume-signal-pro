// Harvest the REAL required questions from live forms: label, type, options.
// Read-only. Nothing is filled, nothing is clicked.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { ADAPTERS } from "./vendors/index.js";
import { ENUMERATE_JS, type DomQuestion } from "./vendors/enumerate-dom.js";

async function main() {
  const [listPath, vendorKey] = [process.argv[2] ?? "", process.argv[3] ?? "breezy"];
  if (!listPath) { console.error("usage: harvest.ts <url-list-file> [vendor]"); process.exit(1); }
  const urls = readFileSync(listPath, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
  const ad = ADAPTERS[vendorKey];
  if (!ad) { console.error(`no adapter: ${vendorKey}`); process.exit(1); }
  const b = await chromium.launch({ headless: true });
  const out: unknown[] = [];

  for (const url of urls) {
    const page = await b.newPage();
    try {
      const form = await ad.resolveFormUrl(page, url);
      if (!form) { console.log(`no form: ${url}`); await page.close(); continue; }
      // Only navigate if we are not already there.
      //
      // resolveFormUrl does real work on the page — Teamtailor's form is inline
      // and only exists after the cookie overlay is declined and Apply is
      // clicked. Re-navigating to the same URL threw all of that away and
      // re-enumerated the closed page, so 7 of 8 Teamtailor forms harvested as
      // "0 fields, 0 required" while a dry run against the same tenant was
      // enumerating 14 controls. A vendor with a working adapter looked like a
      // vendor with no form at all.
      const same = (a: string, b: string) => a.replace(/[?#].*$/, "") === b.replace(/[?#].*$/, "");
      if (!same(page.url(), form)) {
        await page.goto(form, { waitUntil: "domcontentloaded", timeout: 45000 });
      }
      await page.waitForTimeout(3500);
      const qs = (await page.evaluate(ENUMERATE_JS)) as DomQuestion[];
      out.push({ url: form, questions: qs });
      const r = qs.filter((q) => q.required).length;
      console.log(`${form.split("/")[2]}: ${qs.length} fields, ${r} required`);
    } catch (e) { console.log(`ERR ${url}: ${String(e).slice(0, 80)}`); }
    await page.close();
  }
  await b.close();
  writeFileSync("/tmp/harvest.json", JSON.stringify(out, null, 2));
  console.log(`wrote /tmp/harvest.json`);
}
main();
